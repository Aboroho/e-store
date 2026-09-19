import "server-only";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logging";
import { webhookSecret, webhookSignature } from "./service";

/**
 * Webhook delivery.
 *
 * Rows are written by `queueWebhooks` inside the business flow; this is the only place
 * that performs the outbound HTTP call. Delivery is at-least-once and the payload carries
 * a stable `id` plus the `x-webhook-dedupe-key` header so an integrator can make their
 * handler idempotent.
 *
 * Retries use exponential backoff (1m, 2m, 4m … capped at 6h) and a delivery moves to
 * DEAD after `maxAttempts`. A failing endpoint is never retried from more than one
 * worker: the row is leased by pushing `nextAttemptAt` forward before the request.
 */

const RESPONSE_SNIPPET_BYTES = 2000;
const REQUEST_TIMEOUT_MS = 10_000;
const LEASE_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

export function webhookBackoffMs(attempts: number): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  const jitter = Math.round(base * 0.1 * Math.random());
  return base + jitter;
}

function snippet(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > RESPONSE_SNIPPET_BYTES ? `${value.slice(0, RESPONSE_SNIPPET_BYTES)}…` : value;
}

export interface DeliveryResult {
  delivered: number;
  failed: number;
  dead: number;
  skipped: number;
}

/** Deliver one batch of due webhooks. Safe to run concurrently: rows are leased first. */
export async function deliverDueWebhooks(batchSize = 10): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, failed: 0, dead: 0, skipped: 0 };
  const now = new Date();

  const candidates = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    include: { subscription: true },
  });
  if (candidates.length === 0) return result;

  for (const delivery of candidates) {
    // Lease: only the worker whose update matched a row still due processes it.
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    const claimed = await prisma.webhookDelivery.updateMany({
      where: {
        id: delivery.id,
        status: "PENDING",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      data: { nextAttemptAt: leaseUntil },
    });
    if (claimed.count === 0) {
      result.skipped += 1;
      continue;
    }

    const subscription = delivery.subscription;
    if (!subscription.isActive) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "DEAD", lastError: "Subscription was disabled before delivery" },
      });
      result.dead += 1;
      continue;
    }

    const attempts = delivery.attempts + 1;
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.eventType,
      createdAt: delivery.createdAt.toISOString(),
      data: delivery.payload,
    });

    let secret = "";
    try {
      secret = webhookSecret(subscription);
    } catch (error) {
      logger.error("webhook.secret_unreadable", error, { subscriptionId: subscription.id });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "DEAD", attempts, lastError: "Signing secret could not be decrypted" },
      });
      result.dead += 1;
      continue;
    }

    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "e-store-webhooks/1.0",
          "x-webhook-id": delivery.id,
          "x-webhook-event": delivery.eventType,
          "x-webhook-attempt": String(attempts),
          ...(delivery.dedupeKey ? { "x-webhook-dedupe-key": delivery.dedupeKey } : {}),
          "x-webhook-signature": webhookSignature(secret, body),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const text = await response.text().catch(() => "");

      if (response.ok) {
        await prisma.$transaction([
          prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "SUCCESS",
              attempts,
              responseStatus: response.status,
              responseBody: snippet(text),
              lastError: null,
              nextAttemptAt: null,
              deliveredAt: new Date(),
            },
          }),
          prisma.webhookSubscription.update({
            where: { id: subscription.id },
            data: { lastSuccessAt: new Date(), failureCount: 0 },
          }),
        ]);
        result.delivered += 1;
        continue;
      }

      const dead = attempts >= delivery.maxAttempts;
      const message = `HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: dead ? "DEAD" : "PENDING",
            attempts,
            responseStatus: response.status,
            responseBody: snippet(text),
            lastError: message,
            nextAttemptAt: dead ? null : new Date(Date.now() + webhookBackoffMs(attempts)),
          },
        }),
        prisma.webhookSubscription.update({
          where: { id: subscription.id },
          data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
        }),
      ]);
      if (dead) result.dead += 1;
      else result.failed += 1;
    } catch (error) {
      const dead = attempts >= delivery.maxAttempts;
      const message = error instanceof Error ? error.message : "Webhook request failed";
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: dead ? "DEAD" : "PENDING",
            attempts,
            lastError: message.slice(0, 1000),
            nextAttemptAt: dead ? null : new Date(Date.now() + webhookBackoffMs(attempts)),
          },
        }),
        prisma.webhookSubscription.update({
          where: { id: subscription.id },
          data: { lastFailureAt: new Date(), failureCount: { increment: 1 } },
        }),
      ]);
      if (dead) result.dead += 1;
      else result.failed += 1;
      logger.warn("webhook.delivery_failed", { deliveryId: delivery.id, attempts, error: message });
    }
  }

  return result;
}

/** Queue a one-off test event so an integrator can verify their endpoint. */
export async function sendTestWebhook(businessId: string, webhookId: string) {
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: webhookId, businessId } });
  if (!subscription) return { queued: 0 };
  await prisma.webhookDelivery.create({
    data: {
      subscriptionId: subscription.id,
      eventType: "webhook.test",
      payload: { message: "Test delivery from e-store", subscriptionId: subscription.id } as never,
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
  });
  return { queued: 1 };
}
