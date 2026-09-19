"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { deleteMarketingIntegration, listMarketingEvents, saveMarketingIntegration, setMarketingEnabled } from "./service";
import { marketingProvider } from "./providers";

/** Marketing integration actions. Permissions are asserted server-side, always. */

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? "_", [issue.message ?? "Invalid value"]]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Marketing action failed", error);
  return { status: "error", message: fallback };
}

function revalidate() {
  revalidatePath("/admin/integrations");
}

export async function saveMarketingIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("integration.manage");
    const raw = formDataToObject(formData);
    const providerKey = String(raw["provider"] ?? "");
    const provider = marketingProvider(providerKey);
    if (!provider) throw AppError.validation("Choose a provider");

    const publicConfig: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of provider.fields) {
      const value = String(raw[field.key] ?? "").trim();
      if (field.secret) {
        if (value) secrets[field.key] = value;
      } else {
        if (value) publicConfig[field.key] = value;
      }
    }

    await saveMarketingIntegration(session, {
      id: String(raw["id"] ?? "").trim() || undefined,
      provider: provider.key,
      name: String(raw["name"] ?? "").trim() || provider.label,
      storefrontId: String(raw["storefrontId"] ?? "").trim() || null,
      isEnabled: raw["isEnabled"] === "on" || raw["isEnabled"] === "true",
      consentRequired: raw["consentRequired"] !== "false",
      testEventCode: String(raw["testEventCode"] ?? "").trim() || undefined,
      publicConfig,
      secrets,
      trackProductView: raw["trackProductView"] === "on",
      trackAddToCart: raw["trackAddToCart"] === "on",
      trackInitiateCheckout: raw["trackInitiateCheckout"] === "on",
      trackPurchase: raw["trackPurchase"] === "on",
    });

    revalidate();
    return { status: "success", message: `${provider.label} saved.${Object.keys(secrets).length > 0 ? " Credentials were encrypted at rest." : ""}` };
  } catch (error) {
    return toState(error, "Could not save the marketing integration");
  }
}

export async function toggleMarketingIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("integration.manage");
    const raw = formDataToObject(formData);
    const enable = String(raw["isEnabled"] ?? "") === "true";
    await setMarketingEnabled(session, String(raw["integrationId"] ?? ""), enable);
    revalidate();
    return { status: "success", message: enable ? "Integration enabled." : "Integration disabled — no events are queued while it is off." };
  } catch (error) {
    return toState(error, "Could not change the integration state");
  }
}

export async function deleteMarketingIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("integration.manage");
    const raw = formDataToObject(formData);
    await deleteMarketingIntegration(session, String(raw["integrationId"] ?? ""));
    revalidate();
    return { status: "success", message: "Integration deleted with its stored credentials and event history." };
  } catch (error) {
    return toState(error, "Could not delete the integration");
  }
}

/** Retry every discarding-not delivery of one integration (used by the admin screen). */
export async function retryMarketingEventsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("integration.manage");
    const raw = formDataToObject(formData);
    const integrationId = String(raw["integrationId"] ?? "");
    const events = await listMarketingEvents(session.businessId, { status: "FAILED", limit: 200 });
    const ids = events.filter((event) => event.marketingIntegrationId === integrationId).map((event) => event.id);
    if (ids.length === 0) return { status: "success", message: "Nothing to retry." };

    const { prisma } = await import("@/lib/db/client");
    await prisma.marketingEvent.updateMany({ where: { id: { in: ids } }, data: { status: "PENDING", nextAttemptAt: new Date() } });
    revalidate();
    return { status: "success", message: `${ids.length} event(s) queued for another attempt.` };
  } catch (error) {
    return toState(error, "Could not retry the events");
  }
}
