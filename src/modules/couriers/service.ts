import "server-only";
import type { Prisma, ShipmentStatus } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import { getIntegrationSecrets } from "@/modules/integrations/secrets";
import { getCourierAdapter, listCourierAdapters } from "@/modules/couriers/providers";
import { CourierRequestError, asRecord, type OutgoingShipmentData } from "@/modules/couriers/providers/types";

/**
 * Courier service.
 *
 * Outbound provider calls are never made inside a database transaction: the order
 * module writes an `OutboxEvent`, and `scripts/worker.ts` (or the manual "push"
 * action) executes the call and records the result. Inbound provider webhooks are
 * stored first (`CourierWebhookEvent`, unique per provider event) and applied once.
 */

const PROVIDER_DEFAULTS: Record<string, { credentialKeys: string[] }> = {
  PATHAO: { credentialKeys: ["client_id", "client_secret", "username", "password", "webhook_secret"] },
  STEADFAST: { credentialKeys: ["api_key", "secret_key", "webhook_secret"] },
  CARRYBEE: { credentialKeys: ["api_key", "secret_key", "auth_token", "webhook_secret"] },
  MANUAL: { credentialKeys: [] },
};

export interface CourierActor {
  businessId: string;
  userId?: string | null;
  actorType?: "USER" | "SYSTEM" | "API_KEY";
  actorLabel?: string | null;
}

export function providerSetupRequirements(code: string): string[] {
  return listCourierAdapters().find((adapter) => adapter.code === code)?.credentialKeys ?? PROVIDER_DEFAULTS[code]?.credentialKeys ?? [];
}

/** Turn a Shipment row into the provider-agnostic payload adapters expect. */
export async function buildOutgoingShipmentData(shipmentId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<OutgoingShipmentData> {
  const shipment = await client.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  const provider = shipment.courierProviderId
    ? await client.courierProvider.findUnique({ where: { id: shipment.courierProviderId } })
    : null;

  return {
    internalCode: shipment.internalCode,
    merchantOrderId: shipment.merchantOrderId,
    recipientName: shipment.recipientName,
    recipientPhone: shipment.recipientPhone,
    recipientPhoneNormalized: shipment.recipientPhoneNormalized,
    recipientDistrictCode: shipment.recipientDistrictCode,
    recipientAddress: shipment.recipientAddress,
    recipientArea: shipment.recipientArea,
    recipientNote: shipment.recipientNote,
    itemDescription: shipment.itemDescription,
    itemQuantity: shipment.itemQuantity,
    declaredWeightGrams: shipment.declaredWeightGrams,
    codAmountPaisa: shipment.codAmountPaisa,
    deliveryType: shipment.deliveryType,
    providerConfig: asRecord(provider?.config),
  };
}

/**
 * Execute the outbound "create shipment" call for a queued outbox event.
 * Called by the worker; every failure path updates the shipment and leaves the
 * event retryable.
 */
export async function processShipmentCreateEvent(eventId: string): Promise<{ ok: boolean; status?: ShipmentStatus; error?: string }> {
  const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Outbox event not found" };
  if (event.status === "PUBLISHED") return { ok: true };
  if (!event.shipmentId) return { ok: false, error: "The event has no shipment" };

  const shipment = await prisma.shipment.findUnique({ where: { id: event.shipmentId } });
  if (!shipment) return { ok: false, error: "Shipment not found" };

  const provider = shipment.courierProviderId
    ? await prisma.courierProvider.findUnique({ where: { id: shipment.courierProviderId } })
    : null;
  const adapter = provider ? getCourierAdapter(provider.code) : null;

  const markEventStarted = async () => {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
  };

  // Manual couriers (own rider, hand delivery) need no provider call.
  if (!adapter) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "PUBLISHED", processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    if (shipment.providerCode === "MANUAL" && shipment.status === "PENDING") {
      await updateShipmentStatus({
        shipmentId: shipment.id,
        status: "CREATED",
        providerStatusRaw: "created_manually",
        note: "Queued for hand delivery",
        source: "MANUAL",
      });
    }
    return { ok: true, status: "CREATED" };
  }

  await markEventStarted();

  try {
    const credentials = provider?.id ? await getIntegrationSecrets({ courierProviderId: provider.id }) : {};
    const data = await buildOutgoingShipmentData(shipment.id);

    await prisma.shipment.update({ where: { id: shipment.id }, data: { requestedAt: new Date(), attemptCount: { increment: 1 } } });
    await updateShipmentStatus({
      shipmentId: shipment.id,
      status: "PENDING",
      note: `Sent to ${provider?.name ?? shipment.providerCode}`,
      source: "API",
    });

    const result = await adapter.createShipment({
      credentials,
      sandbox: provider?.testMode ?? true,
      shipment: data,
    });

    await withTransaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          providerConsignmentId: result.providerConsignmentId,
          trackingCode: result.trackingCode,
          providerStatusRaw: result.providerStatusRaw,
          failureReason: null,
          metadata: result.raw as Prisma.InputJsonValue,
        },
      });
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PUBLISHED", processedAt: new Date(), lastError: null },
      });
    });

    await updateShipmentStatus({
      shipmentId: shipment.id,
      status: result.status,
      providerStatusRaw: result.providerStatusRaw,
      note: `Accepted by ${provider?.name ?? shipment.providerCode}`,
      source: "API",
    });

    return { ok: true, status: result.status };
  } catch (error) {
    const message = error instanceof CourierRequestError ? error.message : error instanceof Error ? error.message : "Unknown courier error";
    const isLastAttempt = event.attempts + 1 >= event.maxAttempts;
    const backoffSeconds = Math.min(3600, 30 * 2 ** Math.max(event.attempts, 0));

    await prisma.$transaction([
      prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: isLastAttempt ? "FAILED" : "PENDING",
          lastError: message.slice(0, 1000),
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
        },
      }),
      prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          status: isLastAttempt ? "FAILED" : shipment.status,
          failureReason: message.slice(0, 500),
          providerStatusRaw: "request_failed",
        },
      }),
    ]);

    logger.warn("courier.create_failed", { shipmentId: shipment.id, provider: provider?.code, attempts: event.attempts + 1, message });
    return { ok: false, error: message };
  }
}

/**
 * Record a shipment status change with history, keeping order/shipment states in
 * step. Safe to call repeatedly with the same status.
 */
export async function updateShipmentStatus(input: {
  shipmentId: string;
  status: ShipmentStatus;
  providerStatusRaw?: string | null;
  note?: string | null;
  source?: "MANUAL" | "WEBHOOK" | "API" | "SYNC";
  actorUserId?: string | null;
  collectedPaisa?: number | null;
  courierChargePaisa?: number | null;
  providerEventId?: string | null;
}) {
  return withTransaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
    if (!shipment) throw AppError.notFound("Shipment not found");

    const unchanged = shipment.status === input.status;
    const timestamps: Record<string, Record<string, Date>> = {
      PICKED_UP: { dispatchedAt: new Date() },
      DELIVERED: { deliveredAt: new Date() },
      RETURNED: { returnedAt: new Date() },
      CANCELLED: { cancelledAt: new Date() },
    };

    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: input.status,
        lastStatusAt: new Date(),
        ...(input.providerStatusRaw ? { providerStatusRaw: input.providerStatusRaw } : {}),
        ...(timestamps[input.status] ?? {}),
        ...(input.collectedPaisa != null && input.collectedPaisa > 0 ? { collectedPaisa: input.collectedPaisa } : {}),
        ...(input.courierChargePaisa != null ? { courierChargePaisa: input.courierChargePaisa } : {}),
        ...(input.status === "PARTIALLY_DELIVERED" ? { partialDelivery: true } : {}),
      },
    });

    if (!unchanged || input.providerStatusRaw) {
      await tx.shipmentStatusHistory.create({
        data: {
          shipmentId: shipment.id,
          fromStatus: unchanged ? null : shipment.status,
          toStatus: input.status,
          providerStatus: input.providerStatusRaw ?? null,
          source: input.source ?? "API",
          note: input.note ?? null,
          actorUserId: input.actorUserId ?? null,
        },
      });
    }

    // Mirror courier progress onto the order.
    if (shipment.orderId) {
      const order = await tx.order.findUnique({ where: { id: shipment.orderId } });
      if (order) {
        const orderPatch: Prisma.OrderUpdateInput = {};
        if (input.status === "DELIVERED" && order.status !== "DELIVERED" && order.status !== "COMPLETED") {
          orderPatch.status = "DELIVERED";
          orderPatch.deliveredAt = new Date();
          orderPatch.fulfillmentStatus = "FULFILLED";
          await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: "DELIVERED" } });
        }
        if (input.status === "PARTIALLY_DELIVERED" && order.status !== "DELIVERED" && order.status !== "COMPLETED") {
          orderPatch.fulfillmentStatus = "PARTIALLY_FULFILLED";
        }
        if (input.status === "RETURNED" && order.status !== "CANCELLED") {
          orderPatch.fulfillmentStatus = "PARTIALLY_FULFILLED";
        }
        if (input.status === "CANCELLED" && order.status !== "COMPLETED" && order.status !== "CANCELLED") {
          orderPatch.fulfillmentStatus = "CANCELLED";
        }
        if (Object.keys(orderPatch).length > 0) {
          await tx.order.update({ where: { id: order.id }, data: orderPatch });
        }
        if (input.status === "DELIVERED") {
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              field: "FULFILLMENT",
              fromStatus: order.status,
              toStatus: "DELIVERED",
              note: `Courier reported delivery (${shipment.trackingCode ?? shipment.internalCode})`,
              actorUserId: input.actorUserId ?? null,
              actorType: "SYSTEM",
            },
          });
        }
      }
    }

    return updated;
  });
}

/**
 * Apply a courier status webhook exactly once.
 *
 * The event row is written with `(providerCode, providerEventId)` unique, so the
 * second delivery of the same webhook is recorded and ignored instead of
 * re-running the status change (and, later, re-triggering settlement maths).
 */
export async function processCourierWebhook(input: {
  providerCode: "PATHAO" | "STEADFAST" | "CARRYBEE" | "MANUAL";
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  signatureValid: boolean;
  ipAddress?: string | null;
}) {
  const adapter = getCourierAdapter(input.providerCode);
  if (!adapter) throw AppError.validation(`${input.providerCode} does not send webhooks; update shipments manually`);

  const parsed = adapter.parseWebhook(input.payload);
  const providerEventId =
    parsed.providerEventId ??
    (parsed.providerConsignmentId ? `${parsed.providerConsignmentId}:${parsed.providerStatusRaw ?? ""}` : null);

  if (!providerEventId) throw AppError.validation("The webhook payload does not identify an event");

  const existing = await prisma.courierWebhookEvent.findFirst({
    where: { providerCode: input.providerCode, providerEventId },
  });

  if (existing) {
    await prisma.courierWebhookEvent.update({
      where: { id: existing.id },
      data: { attempts: { increment: 1 }, processedAt: existing.processedAt ?? new Date(), processingResult: "Duplicate delivery ignored" },
    });
    return { duplicate: true, status: existing.status, message: "This webhook was already processed" };
  }

  const provider = await prisma.courierProvider.findFirst({ where: { code: input.providerCode }, orderBy: { createdAt: "asc" } });

  const event = await prisma.courierWebhookEvent.create({
    data: {
      courierProviderId: provider?.id ?? null,
      providerCode: input.providerCode,
      providerEventId,
      eventType: "shipment.status",
      trackingCode: parsed.trackingCode,
      signatureValid: input.signatureValid,
      payload: input.payload as Prisma.InputJsonValue,
      headers: input.headers as Prisma.InputJsonValue,
      status: "PROCESSING",
      ipAddress: input.ipAddress ?? null,
    },
  });

  if (!input.signatureValid) {
    await prisma.courierWebhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", errorMessage: "Signature verification failed", processedAt: new Date() },
    });
    throw AppError.forbidden("The webhook signature is not valid");
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [
        ...(parsed.providerConsignmentId ? [{ providerConsignmentId: parsed.providerConsignmentId }] : []),
        ...(parsed.trackingCode ? [{ trackingCode: parsed.trackingCode }] : []),
      ],
    },
  });

  if (!shipment) {
    await prisma.courierWebhookEvent.update({
      where: { id: event.id },
      data: { status: "IGNORED", processingResult: "No shipment matches this tracking code", processedAt: new Date() },
    });
    return { duplicate: false, status: "IGNORED" as const, message: "No shipment matches this webhook" };
  }

  await updateShipmentStatus({
    shipmentId: shipment.id,
    status: parsed.status,
    providerStatusRaw: parsed.providerStatusRaw,
    note: parsed.detail ?? `Courier reported ${parsed.status.toLowerCase()}`,
    source: "WEBHOOK",
    collectedPaisa: parsed.collectedPaisa,
    courierChargePaisa: parsed.courierChargePaisa,
    providerEventId,
  });

  await prisma.courierWebhookEvent.update({
    where: { id: event.id },
    data: { status: "PROCESSED", processingResult: `Shipment moved to ${parsed.status}`, processedAt: new Date() },
  });

  await recordAudit({
    businessId: shipment.businessId,
    actorType: "SYSTEM",
    action: "shipment.webhook_processed",
    entityType: "Shipment",
    entityId: shipment.id,
    summary: `${input.providerCode} reported ${parsed.providerStatusRaw ?? parsed.status}`,
    after: { status: parsed.status, providerStatusRaw: parsed.providerStatusRaw },
    changedFields: ["shipment", "order"],
  });

  return { duplicate: false, status: "PROCESSED" as const, message: `Shipment moved to ${parsed.status}` };
}

/** Pull the latest status from a provider (manual refresh and the polling worker). */
export async function refreshShipmentTracking(actor: CourierActor, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, businessId: actor.businessId } });
  if (!shipment) throw AppError.notFound("Shipment not found");
  const provider = shipment.courierProviderId
    ? await prisma.courierProvider.findUnique({ where: { id: shipment.courierProviderId } })
    : null;
  if (!provider) throw AppError.validation("This shipment has no courier provider");

  const adapter = getCourierAdapter(provider.code);
  if (!adapter) return { shipment, skipped: true as const, message: "Manual shipments are updated by hand" };

  const credentials = await getIntegrationSecrets({ courierProviderId: provider.id });
  const result = await adapter.fetchTracking({
    credentials,
    sandbox: provider.testMode,
    trackingCode: shipment.trackingCode,
    providerConsignmentId: shipment.providerConsignmentId,
  });

  const updated = await updateShipmentStatus({
    shipmentId: shipment.id,
    status: result.status,
    providerStatusRaw: result.providerStatusRaw,
    note: result.detail ?? "Status refreshed from the provider",
    source: "API",
    actorUserId: actor.userId ?? null,
  });

  return { shipment: updated, skipped: false as const, message: `Provider reports ${result.providerStatusRaw ?? result.status}` };
}

/** Record a courier charge (delivery fee, COD fee, return fee) against a shipment. */
export async function recordCourierCharge(
  actor: CourierActor,
  input: { shipmentId: string; type?: "DELIVERY" | "COD" | "RETURN" | "WEIGHT_ADJUSTMENT" | "OTHER"; amountPaisa: number; codChargePaisa?: number; note?: string | null },
) {
  return withTransaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({ where: { id: input.shipmentId, businessId: actor.businessId } });
    if (!shipment) throw AppError.notFound("Shipment not found");
    if (input.amountPaisa < 0) throw AppError.validation("A courier charge cannot be negative");

    const charge = await tx.courierCharge.create({
      data: {
        shipmentId: shipment.id,
        type: input.type ?? "DELIVERY",
        amountPaisa: input.amountPaisa,
        codChargePaisa: input.codChargePaisa ?? 0,
        note: input.note ?? null,
        recordedByUserId: actor.userId ?? null,
      },
    });

    const totals = await tx.courierCharge.aggregate({
      where: { shipmentId: shipment.id, type: { in: ["DELIVERY", "WEIGHT_ADJUSTMENT", "OTHER"] } },
      _sum: { amountPaisa: true, codChargePaisa: true },
    });

    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        courierChargePaisa: totals._sum?.amountPaisa ?? 0,
        codChargePaisa: totals._sum?.codChargePaisa ?? 0,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "courier.charge_recorded",
        entityType: "Shipment",
        entityId: shipment.id,
        summary: `Courier charge of ${formatPaisa(input.amountPaisa)} recorded`,
        after: { type: input.type ?? "DELIVERY", amountPaisa: input.amountPaisa },
      },
      tx,
    );

    return charge;
  });
}

/** Requeue a failed courier push (staff action on the shipment screen). */
export async function requeueShipmentCreate(actor: CourierActor, shipmentId: string) {
  return withTransaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, businessId: actor.businessId } });
    if (!shipment) throw AppError.notFound("Shipment not found");
    if (shipment.providerConsignmentId) throw AppError.invalidState("The courier already accepted this shipment");

    const dedupeKey = `shipment:${shipment.id}:create`;
    const existing = await tx.outboxEvent.findUnique({ where: { dedupeKey } });
    if (existing && existing.status !== "PUBLISHED") {
      const event = await tx.outboxEvent.update({
        where: { id: existing.id },
        data: { status: "PENDING", availableAt: new Date(), attempts: 0, lastError: null },
      });
      return { event, reused: true as const };
    }
    if (existing) return { event: existing, reused: true as const };

    const event = await tx.outboxEvent.create({
      data: {
        businessId: actor.businessId,
        eventType: "courier.shipment.create",
        aggregateType: "Shipment",
        aggregateId: shipment.id,
        shipmentId: shipment.id,
        payload: { shipmentId: shipment.id, providerCode: shipment.providerCode },
        dedupeKey,
      },
    });
    return { event, reused: false as const };
  });
}

/** Pending outbox events for the dashboard/ops screen. */
export async function listPendingOutboxEvents(businessId: string, limit = 50) {
  return prisma.outboxEvent.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { shipment: { select: { internalCode: true, providerCode: true, status: true } } },
  });
}

/** Courier provider list with masked credential keys for the admin UI. */
export async function listCourierProviders(businessId: string) {
  const providers = await prisma.courierProvider.findMany({
    where: { businessId },
    orderBy: [{ priority: "desc" }, { code: "asc" }],
  });

  const secrets = await prisma.integrationSecret.findMany({
    where: { courierProviderId: { in: providers.map((provider) => provider.id) } },
    select: { courierProviderId: true, key: true, updatedAt: true, lastRotatedAt: true },
  });

  return providers.map((provider) => {
    const keys = secrets.filter((secret) => secret.courierProviderId === provider.id);
    return {
      ...provider,
      credentialKeys: keys.map((key) => key.key).sort(),
      credentialsUpdatedAt: keys.reduce<Date | null>((latest, key) => (!latest || key.updatedAt > latest ? key.updatedAt : latest), null),
      requiredCredentialKeys: providerSetupRequirements(provider.code),
    };
  });
}
