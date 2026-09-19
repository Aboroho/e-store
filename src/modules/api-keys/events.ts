import "server-only";
import { logger } from "@/lib/logging";
import { queueWebhooks } from "./service";

/**
 * Domain → webhook fan-out.
 *
 * Services call this *after* their transaction commits, never inside it: the delivery row
 * is written by a short separate statement and the worker owns the HTTP call. A failure
 * here is logged and swallowed — a broken integration must never block a checkout, and
 * anything that was queued is retried by the worker anyway.
 */
export async function emitWebhookEvent(input: {
  businessId: string;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}): Promise<number> {
  try {
    return await queueWebhooks(input);
  } catch (error) {
    logger.error("webhook.queue_failed", error, { eventType: input.eventType, dedupeKey: input.dedupeKey });
    return 0;
  }
}

/** Round money to a JSON-safe integer (never a float). */
function money(value: bigint | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

export interface WebhookOrderLike {
  id: string;
  orderNumber: string;
  status: string;
  channel?: string | null;
  grandTotalPaisa?: number | null;
  duePaisa?: number | null;
  customerName?: string | null;
}

export function orderPayload(order: WebhookOrderLike): Record<string, unknown> {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    channel: order.channel ?? null,
    grandTotalPaisa: money(order.grandTotalPaisa),
    duePaisa: money(order.duePaisa),
    customerName: order.customerName ?? null,
  };
}
