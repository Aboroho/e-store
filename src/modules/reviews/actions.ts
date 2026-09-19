"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { enforceRateLimit, RateLimits } from "@/lib/rate-limit";
import { formDataToObject } from "@/lib/validation";
import { moderateReview, reportReview, reviewImageLimits, submitReview } from "./service";
import type { ActionState } from "@/modules/auth/action-state";

/**
 * Review actions.
 *
 * Customer submissions are rate limited and gated on the purchase rule before anything
 * is written. Review images use the same signed-upload handshake as the media manager,
 * with its own (smaller) limits and no media-library permission required.
 */

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries((error.details as Array<{ path?: (string | number)[]; message?: string }>).map((issue) => [(issue.path ?? []).join(".") || "_", [issue.message ?? "Invalid value"]]))
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Review action failed", error);
  return { status: "error", message: fallback };
}

async function clientIp(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown"
  );
}

/** The business a public (unauthenticated) submission belongs to. */
async function publicBusinessId(): Promise<string> {
  const business = await prisma.business.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!business) throw AppError.notFound("No business is configured");
  return business.id;
}

export async function submitReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getCustomerSession();
  if (!session) return { status: "error", message: "Please sign in to your account to leave a review" };

  const ip = await clientIp();
  try {
    await enforceRateLimit({ scope: "review-submit", key: session.id, ...RateLimits.reviewSubmit }, "You have submitted several reviews already — please try again later");
  } catch (error) {
    return toState(error, "Too many review attempts");
  }

  const raw = formDataToObject(formData);
  const imageAssetIds = Array.isArray(raw.imageAssetId) ? raw.imageAssetId : raw.imageAssetId ? [raw.imageAssetId] : [];

  try {
    const result = await submitReview(
      { businessId: session.businessId, customerId: session.id, actorLabel: session.phoneNormalized, ipAddress: ip },
      {
        productId: String(raw.productId ?? ""),
        rating: Number(raw.rating ?? 0),
        title: String(raw.title ?? "").trim() || undefined,
        body: String(raw.body ?? "").trim(),
        imageAssetIds,
      },
    );

    revalidatePath("/admin/reviews");
    return {
      status: "success",
      message: result.autoPublished ? "Thank you — your review is live" : "Thank you — your review is waiting for moderation",
    };
  } catch (error) {
    return toState(error, "We could not save your review");
  }
}

/** Public "report this review" endpoint used by the storefront review list. */
export async function reportReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getCustomerSession();
  const raw = formDataToObject(formData);
  try {
    const businessId = session?.businessId ?? (await publicBusinessId());
    const ip = await clientIp();
    await enforceRateLimit({ scope: "review-report", key: ip, ...RateLimits.reviewSubmit }, "Too many reports from this connection");
    await reportReview({
      businessId,
      reviewId: String(raw.reviewId ?? ""),
      customerId: session?.id ?? null,
      reason: String(raw.reason ?? "OTHER"),
      note: String(raw.note ?? "").trim() || undefined,
    });
    return { status: "success", message: "Thanks — our team will take a look" };
  } catch (error) {
    return toState(error, "We could not record that report");
  }
}

/** Moderation (admin). */
export async function moderateReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: { businessId: string; userId: string; actorLabel: string };
  try {
    const session = await requireSession();
    assertPermission(session, "review.moderate");
    context = { businessId: session.businessId, userId: session.id, actorLabel: session.email };
  } catch (error) {
    return toState(error, "You are not allowed to moderate reviews");
  }

  const raw = formDataToObject(formData);
  try {
    await moderateReview(context, {
      reviewId: String(raw.reviewId ?? ""),
      decision: String(raw.decision ?? "APPROVE") as "APPROVE",
      note: String(raw.note ?? "").trim() || undefined,
      reason: String(raw.reason ?? "").trim() || undefined,
    });
    revalidatePath("/admin/reviews");
    revalidatePath("/", "layout");
    return { status: "success", message: "Review updated" };
  } catch (error) {
    return toState(error, "Unable to update the review");
  }
}

/** Used by the storefront page to size the uploader without exposing settings. */
export async function reviewLimitsForCurrentCustomerAction() {
  const session = await getCustomerSession();
  const cookieList = await cookies();
  void cookieList;
  if (!session) return { signedIn: false as const, maxImages: 0, maxBytes: 0 };
  const limits = await reviewImageLimits(session.businessId);
  return { signedIn: true as const, maxImages: limits.maxImages, maxBytes: limits.maxBytes };
}
