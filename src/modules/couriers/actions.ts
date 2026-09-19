"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { recordAudit } from "@/lib/audit";
import { getIntegrationSecrets, setIntegrationSecret, listSecretKeys } from "@/modules/integrations/secrets";
import { getCourierAdapter } from "@/modules/couriers/providers";
import { providerSetupRequirements } from "@/modules/couriers/service";
import type { ActionState } from "@/modules/auth/actions";

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
  logger.error("Courier action failed", error);
  return { status: "error", message: fallback };
}

/** Turn a courier provider on/off, set it as preferred and store pickup details. */
export async function saveCourierProviderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage couriers");
  }

  const raw = formDataToObject(formData);
  const providerId = String(raw.providerId ?? "");
  const enabled = raw.isEnabled === "on" || raw.isEnabled === "true";
  const testMode = raw.testMode === "on" || raw.testMode === "true";
  const priority = Number(raw.priority ?? 0);

  try {
    const provider = await withTransaction(async (tx) => {
      const existing = await tx.courierProvider.findFirst({ where: { id: providerId, businessId: context.businessId } });
      if (!existing) throw AppError.notFound("Courier provider not found");

      const updated = await tx.courierProvider.update({
        where: { id: existing.id },
        data: {
          isEnabled: enabled,
          testMode,
          priority: Number.isFinite(priority) ? priority : 0,
          pickupName: raw.pickupName ? String(raw.pickupName).trim() : existing.pickupName,
          pickupPhone: raw.pickupPhone ? String(raw.pickupPhone).trim() : existing.pickupPhone,
          pickupAddress: raw.pickupAddress ? String(raw.pickupAddress).trim() : existing.pickupAddress,
          pickupCity: raw.pickupCity ? String(raw.pickupCity).trim() : existing.pickupCity,
          pickupArea: raw.pickupArea ? String(raw.pickupArea).trim() : existing.pickupArea,
          defaultWeightGrams: raw.defaultWeightGrams ? Number(raw.defaultWeightGrams) : existing.defaultWeightGrams,
          config: raw.config ? safeJson(raw.config, existing.config) : existing.config ?? undefined,
        },
      });

      await recordAudit(
        {
          businessId: context.businessId,
          actorType: "USER",
          actorUserId: context.userId,
          action: "courier.provider_updated",
          entityType: "CourierProvider",
          entityId: existing.id,
          summary: `${existing.name}: ${enabled ? "enabled" : "disabled"}${testMode ? " (sandbox)" : " (live)"}`,
          before: { isEnabled: existing.isEnabled, testMode: existing.testMode, priority: existing.priority },
          after: { isEnabled: enabled, testMode, priority },
        },
        tx,
      );

      return updated;
    });

    revalidatePath("/admin/couriers");
    return { status: "success", message: `${provider.name} saved` };
  } catch (error) {
    return toState(error, "Unable to save the courier provider");
  }
}

function safeJson(value: unknown, fallback: unknown): Prisma.InputJsonObject {
  const resolved: unknown =
    typeof value === "string" && value.trim() !== "" ? parseJsonOrThrow(value) : (fallback ?? {});
  return (resolved ?? {}) as Prisma.InputJsonObject;
}

function parseJsonOrThrow(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw AppError.validation("The provider configuration is not valid JSON");
  }
}

/**
 * Store a courier credential. Secrets are encrypted at rest and never echoed
 * back to the browser — the screen only shows which keys are present.
 */
export async function saveCourierCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage couriers");
  }

  const raw = formDataToObject(formData);
  const providerId = String(raw.providerId ?? "");
  const key = String(raw.key ?? "").trim();
  const value = String(raw.value ?? "").trim();

  try {
    const provider = await prisma.courierProvider.findFirst({ where: { id: providerId, businessId: context.businessId } });
    if (!provider) throw AppError.notFound("Courier provider not found");

    if (!key || !value) throw AppError.validation("Enter both the credential name and its value");

    const known = providerSetupRequirements(provider.code);
    if (value.length > 500) throw AppError.validation("The credential value is too long");

    await setIntegrationSecret({
      courierProviderId: provider.id,
      key,
      plaintext: value,
      description: known.includes(key) ? `Required by ${provider.code}` : null,
      updatedByUserId: context.userId,
    });

    await recordAudit({
      businessId: context.businessId,
      actorType: "USER",
      actorUserId: context.userId,
      action: "courier.credential_saved",
      entityType: "CourierProvider",
      entityId: provider.id,
      summary: `Credential "${key}" updated for ${provider.name}`,
      changedFields: ["credentials"],
    });

    revalidatePath("/admin/couriers");
    return { status: "success", message: `Credential "${key}" saved` };
  } catch (error) {
    return toState(error, "Unable to save the credential");
  }
}

export async function deleteCourierCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage couriers");
  }

  const raw = formDataToObject(formData);
  const providerId = String(raw.providerId ?? "");
  const key = String(raw.key ?? "").trim();

  try {
    const provider = await prisma.courierProvider.findFirst({ where: { id: providerId, businessId: context.businessId } });
    if (!provider) throw AppError.notFound("Courier provider not found");

    await prisma.integrationSecret.deleteMany({ where: { courierProviderId: provider.id, key } });
    await recordAudit({
      businessId: context.businessId,
      actorType: "USER",
      actorUserId: context.userId,
      action: "courier.credential_deleted",
      entityType: "CourierProvider",
      entityId: provider.id,
      summary: `Credential "${key}" removed from ${provider.name}`,
      changedFields: ["credentials"],
    });

    revalidatePath("/admin/couriers");
    return { status: "success", message: `Credential "${key}" removed` };
  } catch (error) {
    return toState(error, "Unable to remove the credential");
  }
}

/** Courier providers with the credential keys present (no values). */
export async function courierProviderSecretKeys(providerId: string) {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const provider = await prisma.courierProvider.findFirst({ where: { id: providerId, businessId: session.businessId }, select: { id: true } });
  if (!provider) return [];
  return listSecretKeys({ courierProviderId: provider.id });
}

export async function savePaymentIntegrationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("integration.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage integrations");
  }

  const raw = formDataToObject(formData);
  const provider = String(raw.provider ?? "").toLowerCase();
  if (!["bkash", "sslcommerz"].includes(provider)) return { status: "error", message: "Unknown payment provider" };

  try {
    const integration = await withTransaction(async (tx) => {
      const existing = await tx.integration.findFirst({
        where: { businessId: context.businessId, kind: "PAYMENT", provider },
      });

      const data = {
        isEnabled: raw.isEnabled === "on" || raw.isEnabled === "true",
        testMode: raw.testMode === "on" || raw.testMode === "true",
        config: safeJson(raw.config ?? "", existing?.config ?? {}),
      };

      const row = existing
        ? await tx.integration.update({ where: { id: existing.id }, data })
        : await tx.integration.create({
            data: {
              businessId: context.businessId,
              kind: "PAYMENT",
              provider,
              name: provider === "bkash" ? "bKash" : "SSLCommerz",
              scopeKey: "",
              createdByUserId: context.userId,
              ...data,
            },
          });

      await recordAudit(
        {
          businessId: context.businessId,
          actorType: "USER",
          actorUserId: context.userId,
          action: "payment.integration_updated",
          entityType: "Integration",
          entityId: row.id,
          summary: `${row.name}: ${data.isEnabled ? "enabled" : "disabled"}${data.testMode ? " (sandbox)" : " (live)"}`,
          after: { isEnabled: data.isEnabled, testMode: data.testMode },
        },
        tx,
      );

      return row;
    });

    revalidatePath("/admin/couriers");
    revalidatePath("/admin/settings");
    return { status: "success", message: `${integration.name} saved` };
  } catch (error) {
    return toState(error, "Unable to save the payment integration");
  }
}

export async function savePaymentCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("integration.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage integrations");
  }

  const raw = formDataToObject(formData);
  const provider = String(raw.provider ?? "").toLowerCase();
  const key = String(raw.key ?? "").trim();
  const value = String(raw.value ?? "").trim();
  if (!key || !value) return { status: "error", message: "Enter both the credential name and its value" };

  try {
    const integration = await prisma.integration.findFirst({ where: { businessId: context.businessId, kind: "PAYMENT", provider } });
    if (!integration) return { status: "error", message: `Save the ${provider} integration before adding credentials` };

    await setIntegrationSecret({ integrationId: integration.id, key, plaintext: value, updatedByUserId: context.userId });
    await recordAudit({
      businessId: context.businessId,
      actorType: "USER",
      actorUserId: context.userId,
      action: "payment.credential_saved",
      entityType: "Integration",
      entityId: integration.id,
      summary: `Credential "${key}" updated for ${integration.name}`,
      changedFields: ["credentials"],
    });

    revalidatePath("/admin/couriers");
    return { status: "success", message: `Credential "${key}" saved` };
  } catch (error) {
    return toState(error, "Unable to save the credential");
  }
}

/**
 * Ask the provider whether the stored credentials actually work.
 *
 * Nothing is written to the shipment tables: the probe is a read-only call, and
 * providers that have no safe probe report that instead of a fake success.
 */
export async function testCourierConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.manage");
  } catch (error) {
    return toState(error, "You are not allowed to test courier credentials");
  }

  const raw = formDataToObject(formData);
  const providerId = String(raw.providerId ?? "");

  try {
    const provider = await prisma.courierProvider.findFirst({ where: { id: providerId, businessId: context.businessId } });
    if (!provider) throw AppError.notFound("Courier provider not found");

    const adapter = getCourierAdapter(provider.code);
    if (!adapter) return { status: "error", message: `${provider.name} has no provider API to test — shipments are handled manually` };
    if (!adapter.testConnection) {
      return { status: "error", message: `${provider.name} has no credential probe endpoint; the first real shipment will validate the setup` };
    }

    const credentials = await getIntegrationSecrets({ courierProviderId: provider.id });
    const result = await adapter.testConnection({ credentials, sandbox: provider.testMode });

    await recordAudit({
      businessId: context.businessId,
      actorType: "USER",
      actorUserId: context.userId,
      action: "courier.connection_tested",
      entityType: "CourierProvider",
      entityId: provider.id,
      summary: `${provider.name}: credential check ${result.ok ? "succeeded" : "failed"}`,
      after: { ok: result.ok, detail: result.detail },
    });

    return { status: result.ok ? "success" : "error", message: result.detail };
  } catch (error) {
    return toState(error, "Unable to reach the courier provider");
  }
}
