import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import type { RecordPaymentInput, RefundInput } from "@/modules/orders/schemas";
import { emitWebhookEvent } from "@/modules/api-keys/events";

/**
 * Payments.
 *
 * Rules that this module exists to enforce:
 *  - an order only becomes PAID because of a verified server-side record, never
 *    because a browser said so;
 *  - the same provider event is applied at most once (`PaymentEvent` unique key);
 *  - the same manual payment submitted twice (retry, double click) is recorded once
 *    (`Payment.idempotencyKey`);
 *  - overpayment and negative amounts are rejected.
 */

export interface PaymentActor {
  businessId: string;
  userId?: string | null;
  actorLabel?: string | null;
  actorType?: "USER" | "CUSTOMER" | "SYSTEM" | "API_KEY";
  actorCustomerId?: string | null;
}

type Tx = Prisma.TransactionClient;

/** Recompute the order's payment figures from its payment records. */
async function recalculateOrderPayments(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const payments = await tx.payment.findMany({ where: { orderId, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } });

  const paidPaisa = payments.reduce((total, payment) => total + payment.paidPaisa - payment.refundedPaisa, 0);
  const refundedPaisa = payments.reduce((total, payment) => total + payment.refundedPaisa, 0);
  const netPaid = Math.max(paidPaisa, 0);

  const paymentStatus =
    netPaid <= 0
      ? refundedPaisa > 0
        ? "REFUNDED"
        : "UNPAID"
      : refundedPaisa > 0 && netPaid < order.grandTotalPaisa
        ? "PARTIALLY_REFUNDED"
        : netPaid >= order.grandTotalPaisa
          ? refundedPaisa > 0
            ? "PARTIALLY_REFUNDED"
            : "PAID"
          : "PARTIALLY_PAID";

  return tx.order.update({
    where: { id: orderId },
    data: {
      paidPaisa: netPaid,
      refundedPaisa,
      duePaisa: Math.max(order.grandTotalPaisa - netPaid, 0),
      paymentStatus,
      // Once the customer has paid, the courier must not collect the money again.
      codCollectPaisa: netPaid >= order.grandTotalPaisa ? 0 : order.codCollectPaisa,
    },
  });
}

/** Staff-recorded payment (cash, bank transfer, manual confirmation of a wallet payment). */
export async function recordPayment(actor: PaymentActor, input: RecordPaymentInput) {
  const result = await withTransaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        const order = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId } });
        return { payment: existing, order, reused: true as const };
      }
    }

    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status === "CANCELLED") throw AppError.invalidState("A cancelled order cannot be paid");
    if (input.amountPaisa > order.grandTotalPaisa - order.paidPaisa + order.refundedPaisa) {
      throw AppError.validation(
        `The amount exceeds the outstanding balance of ${formatPaisa(Math.max(order.duePaisa, 0))}`,
      );
    }

    const payment = await tx.payment.create({
      data: {
        businessId: actor.businessId,
        orderId: order.id,
        method: input.method,
        status: "PAID",
        amountPaisa: input.amountPaisa,
        paidPaisa: input.amountPaisa,
        providerName: input.method === "COD" ? null : input.method,
        providerReference: input.providerReference ?? null,
        receivedAt: new Date(),
        verifiedAt: new Date(),
        recordedByUserId: actor.userId ?? null,
        collectedByUserId: input.method === "COD" ? (actor.userId ?? null) : null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, orderId: order.id, amountPaisa: input.amountPaisa, direction: "COLLECT" },
    });

    const updated = await recalculateOrderPayments(tx, order.id);

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "PAYMENT",
        fromStatus: order.paymentStatus,
        toStatus: updated.paymentStatus,
        note: `${input.method} payment of ${formatPaisa(input.amountPaisa)} recorded`,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
        actorCustomerId: actor.actorCustomerId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorLabel: actor.actorLabel ?? null,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        summary: `${input.method} payment of ${formatPaisa(input.amountPaisa)} for ${order.orderNumber}`,
        after: { amountPaisa: input.amountPaisa, method: input.method, paymentStatus: updated.paymentStatus },
        changedFields: ["payment", "order"],
      },
      tx,
    );

    return { payment, order: updated, reused: false as const };
  });

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "payment.recorded",
    dedupeKey: result.payment.id,
    payload: {
      paymentId: result.payment.id,
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      amountPaisa: result.payment.amountPaisa,
      method: result.payment.method,
      paymentStatus: result.order.paymentStatus,
      duePaisa: result.order.duePaisa,
    },
  });

  return result;
}

/**
 * Start a provider payment. The attempt row is created first (with a stable
 * client reference used as the provider's merchant reference), then the caller —
 * a route handler or the worker — performs the outbound API call outside any
 * transaction.
 */
export async function initiateProviderPayment(
  actor: PaymentActor,
  input: { orderId: string; method: "BKASH" | "SSLCOMMERZ"; amountPaisa?: number; returnUrl: string },
) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status === "CANCELLED") throw AppError.invalidState("A cancelled order cannot be paid");

    const amountPaisa = input.amountPaisa ?? Math.max(order.duePaisa, 0);
    if (amountPaisa <= 0) throw AppError.validation("There is nothing left to pay on this order");

    const attempt = await tx.paymentAttempt.create({
      data: {
        businessId: actor.businessId,
        orderId: order.id,
        method: input.method,
        status: "INITIATED",
        amountPaisa,
        providerName: input.method,
        clientReference: `PAY-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`,
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
        createdByUserId: actor.userId ?? null,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "PAYMENT",
        toStatus: order.paymentStatus,
        note: `${input.method} payment attempt started (${attempt.clientReference})`,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });

    return { attempt, order, returnUrl: input.returnUrl };
  });
}

export interface ProviderEventInput {
  businessId: string;
  providerName: string;
  eventType: string;
  providerEventId?: string | null;
  signatureValid: boolean;
  payload: Prisma.InputJsonValue;
  headers?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  clientReference?: string | null;
  providerPaymentId?: string | null;
  providerTransactionId?: string | null;
  amountPaisa?: number | null;
  succeeded: boolean;
  failureReason?: string | null;
  rawStatus?: string | null;
}

/**
 * Store a provider callback and apply its effect exactly once.
 *
 * The unique key `(providerName, providerEventId)` makes replay safe; when a
 * provider does not send an event id we fall back to the client reference, which
 * is unique per attempt.
 */
export async function processProviderEvent(input: ProviderEventInput) {
  return withTransaction(async (tx) => {
    const providerEventId = input.providerEventId ?? input.clientReference ?? null;

    const existing = providerEventId
      ? await tx.paymentEvent.findFirst({ where: { providerName: input.providerName, providerEventId } })
      : null;
    if (existing) {
      return { event: existing, applied: false as const, reason: "duplicate" as const };
    }

    // Find the attempt this callback belongs to.
    const attempt = input.clientReference
      ? await tx.paymentAttempt.findFirst({ where: { clientReference: input.clientReference, businessId: input.businessId } })
      : input.providerPaymentId
        ? await tx.paymentAttempt.findFirst({
            where: { providerPaymentId: input.providerPaymentId, businessId: input.businessId },
            orderBy: { createdAt: "desc" },
          })
        : null;

    const event = await tx.paymentEvent.create({
      data: {
        businessId: input.businessId,
        providerName: input.providerName,
        eventType: input.eventType,
        providerEventId,
        signatureValid: input.signatureValid,
        payload: input.payload,
        headers: input.headers ?? undefined,
        orderId: attempt?.orderId ?? null,
        paymentAttemptId: attempt?.id ?? null,
        ipAddress: input.ipAddress ?? null,
        status: "PROCESSING",
      },
    });

    if (!attempt) {
      await tx.paymentEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", processingResult: "No matching payment attempt", processedAt: new Date() },
      });
      return { event, applied: false as const, reason: "unknown_attempt" as const };
    }

    if (attempt.status === "VERIFIED") {
      await tx.paymentEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", processingResult: "Attempt already verified", processedAt: new Date(), paymentId: null },
      });
      return { event, applied: false as const, reason: "already_verified" as const };
    }

    if (!input.signatureValid) {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: "FAILED", failureReason: "Callback signature could not be verified" },
      });
      await tx.paymentEvent.update({
        where: { id: event.id },
        data: { status: "FAILED", errorMessage: "Invalid signature", processedAt: new Date() },
      });
      return { event, applied: false as const, reason: "invalid_signature" as const };
    }

    if (!input.succeeded) {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "FAILED",
          failureReason: input.failureReason ?? input.rawStatus ?? "Provider reported a failure",
          responsePayload: input.payload,
        },
      });
      await tx.paymentEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processingResult: "Attempt marked failed", processedAt: new Date() },
      });
      return { event, applied: true as const, reason: "payment_failed" as const };
    }

    const amountPaisa = input.amountPaisa ?? attempt.amountPaisa;
    if (amountPaisa <= 0) throw AppError.validation("The provider did not report a payment amount");

    // A wallet provider can legitimately report a smaller amount (partial payment).
    const order = await tx.order.findUniqueOrThrow({ where: { id: attempt.orderId } });
    if (order.paidPaisa + amountPaisa > order.grandTotalPaisa + order.refundedPaisa) {
      throw AppError.validation("The reported payment exceeds the order total");
    }

    let payment = await tx.payment.findFirst({
      where: { orderId: attempt.orderId, method: attempt.method, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (!payment) {
      payment = await tx.payment.create({
        data: {
          businessId: input.businessId,
          orderId: attempt.orderId,
          method: attempt.method,
          status: "PAID",
          amountPaisa: attempt.amountPaisa,
          providerName: input.providerName,
          providerReference: input.clientReference ?? attempt.clientReference,
          providerPaymentId: input.providerPaymentId ?? null,
          receivedAt: new Date(),
          verifiedAt: new Date(),
        },
      });
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        paidPaisa: payment.paidPaisa + amountPaisa,
        providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
        providerReference: input.clientReference ?? payment.providerReference,
        verifiedAt: new Date(),
        integrationId: payment.integrationId,
      },
    });

    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, orderId: attempt.orderId, amountPaisa, direction: "COLLECT" },
    });

    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        paymentId: payment.id,
        status: "VERIFIED",
        providerPaymentId: input.providerPaymentId ?? attempt.providerPaymentId,
        providerTransactionId: input.providerTransactionId ?? attempt.providerTransactionId,
        verifiedAt: new Date(),
        responsePayload: input.payload,
      },
    });

    const updatedOrder = await recalculateOrderPayments(tx, attempt.orderId);

    await tx.orderStatusHistory.create({
      data: {
        orderId: attempt.orderId,
        field: "PAYMENT",
        fromStatus: order.paymentStatus,
        toStatus: updatedOrder.paymentStatus,
        note: `${input.providerName} payment of ${formatPaisa(amountPaisa)} verified`,
        actorType: "SYSTEM",
      },
    });

    await tx.paymentEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processingResult: "Payment recorded", paymentId: payment.id, processedAt: new Date() },
    });

    await recordAudit(
      {
        businessId: input.businessId,
        actorType: "SYSTEM",
        action: "payment.provider_verified",
        entityType: "Payment",
        entityId: payment.id,
        summary: `${input.providerName} payment of ${formatPaisa(amountPaisa)} verified for ${order.orderNumber}`,
        after: { paymentStatus: updatedOrder.paymentStatus, amountPaisa, provider: input.providerName },
        changedFields: ["payment", "order"],
      },
      tx,
    );

    return { event, applied: true as const, reason: "payment_recorded" as const, payment, order: updatedOrder };
  });
}

// ---------------------------------------------------------------------- refunds

export async function requestRefund(actor: PaymentActor, input: RefundInput) {
  return withTransaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { refund: existing, reused: true as const };
    }

    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");

    const refundablePaisa = order.paidPaisa - order.refundedPaisa;
    if (input.amountPaisa > refundablePaisa) {
      throw AppError.validation(`Only ${formatPaisa(Math.max(refundablePaisa, 0))} of this order is refundable`);
    }

    const payment =
      input.paymentId != null
        ? await tx.payment.findFirst({ where: { id: input.paymentId, orderId: order.id } })
        : await tx.payment.findFirst({
            where: { orderId: order.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
            orderBy: { createdAt: "asc" },
          });
    if (!payment) throw AppError.validation("There is no payment to refund on this order");

    const refund = await tx.refund.create({
      data: {
        businessId: actor.businessId,
        orderId: order.id,
        paymentId: payment.id,
        exchangeRequestId: input.exchangeRequestId ?? null,
        method: input.method,
        status: "REQUESTED",
        amountPaisa: input.amountPaisa,
        reason: input.reason,
        note: input.note ?? null,
        providerName: input.method === "BKASH" || input.method === "SSLCOMMERZ" ? input.method : null,
        requestedByUserId: actor.userId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "PAYMENT",
        toStatus: order.paymentStatus,
        note: `Refund of ${formatPaisa(input.amountPaisa)} requested (${input.reason})`,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });

    return { refund, reused: false as const };
  });
}

/** Mark a refund complete and fold it into the order's payment figures. */
export async function settleRefund(
  actor: PaymentActor,
  input: { refundId: string; providerReference?: string | null; failed?: boolean; failureReason?: string | null },
) {
  const result = await withTransaction(async (tx) => {
    const refund = await tx.refund.findFirst({ where: { id: input.refundId, businessId: actor.businessId } });
    if (!refund) throw AppError.notFound("Refund not found");
    if (refund.status === "COMPLETED") return { refund, order: null, reused: true as const };

    if (input.failed) {
      const failed = await tx.refund.update({
        where: { id: refund.id },
        data: { status: "FAILED", failureReason: input.failureReason ?? "Provider rejected the refund" },
      });
      await tx.refundAttempt.create({
        data: { refundId: refund.id, status: "FAILED", providerName: refund.providerName, errorMessage: input.failureReason ?? null },
      });
      return { refund: failed, order: null, reused: false as const };
    }

    const completed = await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        processedByUserId: actor.userId ?? null,
        providerReference: input.providerReference ?? refund.providerReference,
      },
    });

    await tx.refundAttempt.create({
      data: { refundId: refund.id, status: "COMPLETED", providerName: refund.providerName, providerReference: input.providerReference ?? null },
    });

    if (refund.paymentId) {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      const refundedPaisa = payment.refundedPaisa + refund.amountPaisa;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          refundedPaisa,
          status: refundedPaisa >= payment.paidPaisa ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });
    }

    const order = refund.orderId ? await recalculateOrderPayments(tx, refund.orderId) : null;

    if (refund.orderId) {
      await tx.orderStatusHistory.create({
        data: {
          orderId: refund.orderId,
          field: "PAYMENT",
          toStatus: order?.paymentStatus ?? "REFUNDED",
          note: `Refund of ${formatPaisa(refund.amountPaisa)} completed`,
          actorUserId: actor.userId ?? null,
          actorType: actor.actorType ?? "USER",
        },
      });
    }

    if (refund.exchangeRequestId) {
      await tx.exchangeRequest.update({
        where: { id: refund.exchangeRequestId },
        data: { refundId: refund.id },
      });
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "refund.completed",
        entityType: "Refund",
        entityId: refund.id,
        summary: `Refunded ${formatPaisa(refund.amountPaisa)}`,
        after: { amountPaisa: refund.amountPaisa, method: refund.method, orderId: refund.orderId },
      },
      tx,
    );

    return { refund: completed, order, reused: false as const };
  });

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "payment.refunded",
    dedupeKey: `${result.refund.id}:refunded`,
    payload: {
      refundId: result.refund.id,
      orderId: result.refund.orderId,
      amountPaisa: result.refund.amountPaisa,
      method: result.refund.method,
      status: result.refund.status,
    },
  });

  return result;
}

/** COD money collected by the courier and recorded against the order. */
export async function recordCodCollection(
  actor: PaymentActor,
  input: { orderId: string; shipmentId?: string | null; collectedPaisa: number; courierChargePaisa?: number; codChargePaisa?: number; note?: string | null },
) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (input.collectedPaisa <= 0) throw AppError.validation("Enter the amount the courier collected");

    // One cash-on-delivery collection per shipment: a repeated webhook, a second
    // settlement row or a double click must not record the same cash twice.
    if (input.shipmentId) {
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: `cod:${input.shipmentId}` } });
      if (existing) {
        const current = await tx.order.findUniqueOrThrow({ where: { id: existing.orderId } });
        return { payment: existing, order: current, reused: true as const };
      }
    }

    const payment = await tx.payment.create({
      data: {
        businessId: actor.businessId,
        orderId: order.id,
        method: "COD",
        status: "PAID",
        amountPaisa: input.collectedPaisa,
        paidPaisa: input.collectedPaisa,
        providerName: "COD",
        receivedAt: new Date(),
        verifiedAt: new Date(),
        recordedByUserId: actor.userId ?? null,
        note: input.note ?? null,
        idempotencyKey: input.shipmentId ? `cod:${input.shipmentId}` : null,
      },
    });

    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, orderId: order.id, amountPaisa: input.collectedPaisa, direction: "COLLECT" },
    });

    if (input.shipmentId) {
      const shipment = await tx.shipment.findFirst({ where: { id: input.shipmentId, businessId: actor.businessId } });
      if (shipment) {
        await tx.codCollection.upsert({
          where: { shipmentId: shipment.id },
          create: {
            businessId: actor.businessId,
            orderId: order.id,
            shipmentId: shipment.id,
            expectedPaisa: shipment.expectedCollectionPaisa,
            collectedPaisa: input.collectedPaisa,
            courierChargePaisa: input.courierChargePaisa ?? shipment.courierChargePaisa,
            codChargePaisa: input.codChargePaisa ?? shipment.codChargePaisa,
            netPaisa:
              input.collectedPaisa - (input.courierChargePaisa ?? shipment.courierChargePaisa) - (input.codChargePaisa ?? shipment.codChargePaisa),
            collectedAt: new Date(),
            recordedByUserId: actor.userId ?? null,
            status: "RECORDED",
          },
          update: {
            collectedPaisa: input.collectedPaisa,
            netPaisa:
              input.collectedPaisa - (input.courierChargePaisa ?? shipment.courierChargePaisa) - (input.codChargePaisa ?? shipment.codChargePaisa),
            collectedAt: new Date(),
          },
        });
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            collectedPaisa: input.collectedPaisa,
            courierChargePaisa: input.courierChargePaisa ?? shipment.courierChargePaisa,
            codChargePaisa: input.codChargePaisa ?? shipment.codChargePaisa,
          },
        });
      }
    }

    const updated = await recalculateOrderPayments(tx, order.id);
    return { payment, order: updated, reused: false as const };
  });
}

/** Payment history for an order (admin screens and API). */
export async function listOrderPayments(orderId: string) {
  return prisma.payment.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    include: { refunds: true, attempts: { orderBy: { createdAt: "desc" } } },
  });
}
