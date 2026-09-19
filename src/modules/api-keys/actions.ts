"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { createApiKey, createWebhook, deleteWebhook, revokeApiKey, rotateApiKey, rotateWebhookSecret, updateWebhook } from "./service";
import { sendTestWebhook } from "./delivery";

/**
 * API key and webhook actions.
 *
 * Secrets are returned exactly once through `ActionState.data.secret`; they are never
 * stored in plaintext and never re-shown from the database afterwards.
 */

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" as const };
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
  logger.error("API key action failed", error);
  return { status: "error", message: fallback };
}

function revalidate() {
  revalidatePath("/admin/api-keys");
}

function readScopes(raw: Record<string, string | string[]>): string[] {
  const value = raw["scopes"];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readEvents(raw: Record<string, string | string[]>): string[] {
  const value = raw["events"];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function createApiKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const expires = String(raw["expiresAt"] ?? "").trim();
    const result = await createApiKey(session, {
      name: String(raw["name"] ?? "").trim(),
      description: String(raw["description"] ?? "").trim() || undefined,
      scopes: readScopes(raw),
      expiresAt: expires || undefined,
      rateLimitPerMinute: raw["rateLimitPerMinute"] ? Number(raw["rateLimitPerMinute"]) : undefined,
      allowedIpAddresses: String(raw["allowedIpAddresses"] ?? "")
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    });
    revalidate();
    return { status: "success", message: `API key "${result.key.name}" created. Copy the secret now — it is not shown again.`, data: { secret: result.plaintext, keyId: result.key.id } };
  } catch (error) {
    return toState(error, "Could not create the API key");
  }
}

export async function revokeApiKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    await revokeApiKey(session, { apiKeyId: String(raw["apiKeyId"] ?? ""), reason: String(raw["reason"] ?? "Revoked from the admin") });
    revalidate();
    return { status: "success", message: "API key revoked. Requests with it now fail with 401." };
  } catch (error) {
    return toState(error, "Could not revoke the API key");
  }
}

export async function rotateApiKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const result = await rotateApiKey(session, {
      apiKeyId: String(raw["apiKeyId"] ?? ""),
      gracePeriodSeconds: raw["gracePeriodSeconds"] ? Number(raw["gracePeriodSeconds"]) : 0,
    });
    revalidate();
    return { status: "success", message: result.note, data: { secret: result.plaintext, keyId: result.key.id } };
  } catch (error) {
    return toState(error, "Could not rotate the API key");
  }
}

export async function createWebhookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const result = await createWebhook(session, {
      name: String(raw["name"] ?? "").trim(),
      url: String(raw["url"] ?? "").trim(),
      events: readEvents(raw),
      apiKeyId: String(raw["apiKeyId"] ?? "").trim() || undefined,
    });
    revalidate();
    return { status: "success", message: `Webhook created. Signing secret: ${result.secret} — store it now, it cannot be shown again.`, data: { secret: result.secret, webhookId: result.subscription.id } };
  } catch (error) {
    return toState(error, "Could not create the webhook");
  }
}

export async function updateWebhookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const events = readEvents(raw);
    const action = String(raw["action"] ?? "update");
    await updateWebhook(session, {
      webhookId: String(raw["webhookId"] ?? ""),
      ...(action === "enable" ? { isActive: true } : {}),
      ...(action === "disable" ? { isActive: false } : {}),
      ...(events.length > 0 ? { events } : {}),
      ...(raw["url"] ? { url: String(raw["url"]).trim() } : {}),
    });
    revalidate();
    return { status: "success", message: action === "enable" ? "Webhook enabled." : action === "disable" ? "Webhook disabled." : "Webhook updated." };
  } catch (error) {
    return toState(error, "Could not update the webhook");
  }
}

export async function rotateWebhookSecretAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const result = await rotateWebhookSecret(session, String(raw["webhookId"] ?? ""));
    revalidate();
    return { status: "success", message: `New signing secret: ${result.secret} — deliveries signed with the old secret will fail from now on.`, data: { secret: result.secret } };
  } catch (error) {
    return toState(error, "Could not rotate the signing secret");
  }
}

export async function deleteWebhookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    await deleteWebhook(session, String(raw["webhookId"] ?? ""));
    revalidate();
    return { status: "success", message: "Webhook deleted with its delivery history." };
  } catch (error) {
    return toState(error, "Could not delete the webhook");
  }
}

export async function sendTestWebhookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("api_key.manage");
    const raw = formDataToObject(formData);
    const result = await sendTestWebhook(session.businessId, String(raw["webhookId"] ?? ""));
    revalidate();
    return result.queued > 0
      ? { status: "success", message: "Test event queued — the worker delivers it within a few seconds and the delivery log shows the result." }
      : { status: "error", message: "Webhook not found" };
  } catch (error) {
    return toState(error, "Could not queue the test event");
  }
}
