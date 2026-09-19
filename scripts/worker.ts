/**
 * Outbox worker.
 *
 * The web app never calls a courier or payment provider inside a database
 * transaction: it writes an `OutboxEvent` and returns. This worker claims those
 * rows and performs the outbound HTTP calls, with exponential backoff and a
 * dead-letter state after `maxAttempts`.
 *
 * Usage:
 *   npm run worker            # poll forever (default every 5s)
 *   npm run worker -- --once  # single pass, useful for cron and tests
 *   npm run worker -- --interval 30
 */

import "dotenv/config";
import { prisma } from "../src/lib/db/client";
import { logger } from "../src/lib/logging";
import { processShipmentCreateEvent } from "../src/modules/couriers/service";
import { deliverDueWebhooks } from "../src/modules/api-keys/delivery";
import { deliverDueMarketingEvents } from "../src/modules/marketing/delivery";
import { refreshStaleShipments } from "../src/modules/couriers/tracking";

const DEFAULT_INTERVAL_SECONDS = 5;
const BATCH_SIZE = 10;

interface WorkerOptions {
  once: boolean;
  intervalSeconds: number;
}

function parseOptions(argv: string[]): WorkerOptions {
  const once = argv.includes("--once");
  const intervalIndex = argv.indexOf("--interval");
  const interval = intervalIndex >= 0 ? Number(argv[intervalIndex + 1]) : NaN;
  return {
    once,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS,
  };
}

/**
 * Claim a batch of due events.
 *
 * The claim is a single `UPDATE ... WHERE status = 'PENDING'` so two workers can
 * never process the same event: only the rows this update touched are returned.
 */
async function claimEvents(limit: number) {
  const candidates = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { availableAt: "asc" },
    take: limit,
    select: { id: true },
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((row) => row.id);
  await prisma.outboxEvent.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "PROCESSING" },
  });

  return prisma.outboxEvent.findMany({ where: { id: { in: ids }, status: "PROCESSING" }, orderBy: { availableAt: "asc" } });
}

export async function runOnce(): Promise<{
  processed: number;
  failed: number;
  webhooks: { delivered: number; failed: number; dead: number; skipped: number };
  marketing: { sent: number; failed: number; discarded: number; skipped: number };
}> {
  const webhooks = await deliverDueWebhooks(BATCH_SIZE).catch((error) => {
    logger.error("worker.webhook_delivery_failed", error);
    return { delivered: 0, failed: 0, dead: 0, skipped: 0 };
  });

  const marketing = await deliverDueMarketingEvents(BATCH_SIZE).catch((error) => {
    logger.error("worker.marketing_delivery_failed", error);
    return { sent: 0, failed: 0, discarded: 0, skipped: 0 };
  });

  const events = await claimEvents(BATCH_SIZE);
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      switch (event.eventType) {
        case "courier.shipment.create": {
          const result = await processShipmentCreateEvent(event.id);
          if (result.ok) processed += 1;
          else failed += 1;
          break;
        }
        default: {
          // Unknown event types are parked rather than retried forever; the
          // payload stays inspectable on the operations screen.
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: "DEAD",
              processedAt: new Date(),
              lastError: `No handler is registered for "${event.eventType}"`,
            },
          });
          failed += 1;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown worker error";
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PENDING", availableAt: new Date(Date.now() + 60_000), lastError: message.slice(0, 1000) },
      });
      logger.error("worker.event_failed", error, { eventId: event.id, eventType: event.eventType });
    }
  }

  if (events.length > 0) logger.info("worker.batch", { claimed: events.length, processed, failed });
  if (webhooks.delivered > 0 || webhooks.failed > 0 || webhooks.dead > 0) {
    logger.info("worker.webhooks", { ...webhooks });
  }
  if (marketing.sent > 0 || marketing.failed > 0 || marketing.discarded > 0) {
    logger.info("worker.marketing", { ...marketing });
  }
  return { processed, failed, webhooks, marketing };
}

/** Refresh tracking for shipments that have been in flight for a while. */
async function runTrackingSync(): Promise<number> {
  try {
    const updated = await refreshStaleShipments({ olderThanMinutes: 180, limit: 20 });
    if (updated > 0) logger.info("worker.tracking_synced", { updated });
    return updated;
  } catch (error) {
    logger.error("worker.tracking_failed", error);
    return 0;
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  logger.info("worker.started", { once: options.once, intervalSeconds: options.intervalSeconds });

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let trackingTick = 0;
  do {
    const { processed, failed, webhooks, marketing } = await runOnce();
    if (processed === 0 && failed === 0 && webhooks.delivered === 0 && webhooks.failed === 0 && marketing.sent === 0 && marketing.failed === 0) {
      // Idle: check in-flight shipments every ~10 minutes.
      trackingTick += 1;
      if (trackingTick >= Math.max(1, Math.round(600 / options.intervalSeconds))) {
        trackingTick = 0;
        await runTrackingSync();
      }
    }

    if (options.once) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalSeconds * 1000));
  } while (running);

  await prisma.$disconnect();
  logger.info("worker.stopped");
}

main().catch(async (error) => {
  logger.error("worker.crashed", error);
  await prisma.$disconnect();
  process.exit(1);
});
