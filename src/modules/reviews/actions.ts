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
import { storageIsConfigured } from "@/modules/media/storage";
import { confirmUpload, requestUpload } from "@/modules/media/service";
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

/**
 * Step 1 of a review image upload. Any signed-in customer may request one, within the
 * configured image count/size limits and the public rate limit.
 */
export async function requestReviewImageUploadAction(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string;
}): Promise<{ ok: true; assetId: string; uploadUrl: string; headers: Record<string, string> } | { ok: false; message: string }> {
  const session = await getCustomerSession();
  if (!session) return { ok: false, message: "Please sign in again" };
  if (!storageIsConfigured()) return { ok: false, message: "Image uploads are not configured on this store" };

  const ip = await clientIp();
  try {
    await enforceRateLimit({ scope: "review-upload", key: ip, ...RateLimits.reviewSubmit }, "Too many uploads from this connection");
  } catch (error) {
    const state = toState(error, "Too many uploads");
    return { ok: false, message: state.message ?? "Too many uploads" };
  }

  try {
    const limits = await reviewImageLimits(session.businessId);
    if (!input.mimeType.startsWith("image/")) return { ok: false, message: "Only images can be attached to a review" };

    // Per-image cap: the whole review may total `maxBytes`, so a single image above it
    // can never be valid either.
    if (input.sizeBytes > limits.maxBytes) {
      return { ok: false, message: `Each image must be under ${Math.round(limits.maxBytes / (1024 * 1024))} MB` };
    }

    const asset = await requestUpload(
      { businessId: session.businessId, userId: session.id, actorLabel: `customer:${session.phoneNormalized}` },
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        visibility: "PUBLIC",
        checksum: input.checksum,
        title: "Review image",
      },
    );

    if (!asset.upload) {
      // Identical bytes already stored: reuse the asset without a second upload.
      return { ok: false, message: "This image has already been uploaded for this review" };
    }

    return { ok: true, assetId: asset.asset.id, uploadUrl: asset.upload.url, headers: asset.upload.headers };
  } catch (error) {
    const state = toState(error, "Unable to start the upload");
    return { ok: false, message: state.message ?? "Unable to start the upload" };
  }
}

export async function confirmReviewImageUploadAction(input: { assetId: string; checksum?: string; width?: number; height?: number }) {
  const session = await getCustomerSession();
  if (!session) return { ok: false as const, message: "Please sign in again" };
  try {
    await confirmUpload({ businessId: session.businessId, userId: session.id, actorLabel: `customer:${session.phoneNormalized}` }, input);
    return { ok: true as const };
  } catch (error) {
    const state = toState(error, "Unable to confirm the upload");
    return { ok: false as const, message: state.message ?? "Unable to confirm the upload" };
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
