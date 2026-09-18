import "server-only";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logging";
import { getIntegrationSecrets } from "@/modules/integrations/secrets";
import { getCourierAdapter } from "@/modules/couriers/providers";
import { updateShipmentStatus } from "@/modules/couriers/service";

/**
 * Periodic tracking sync.
 *
 * Couriers deliver webhooks for most status changes, but they are not something a
 * business should depend on: this job pulls the status of in-flight shipments
 * from the provider API so the board stays accurate even when a webhook is lost.
 * Manual providers are skipped.
 */

export async function refreshStaleShipments(input: { olderThanMinutes?: number; limit?: number } = {}): Promise<number> {
  const olderThan = new Date(Date.now() - (input.olderThanMinutes ?? 180) * 60 * 1000);
  const shipments = await prisma.shipment.findMany({
    where: {
      status: { in: ["PENDING", "CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "EXCEPTION"] },
      providerCode: { in: ["PATHAO", "STEADFAST", "CARRYBEE"] },
      courierProviderId: { not: null },
      OR: [{ lastStatusAt: null }, { lastStatusAt: { lt: olderThan } }],
    },
    orderBy: { lastStatusAt: "asc" },
    take: input.limit ?? 20,
  });

  let updated = 0;

  for (const shipment of shipments) {
    const provider = shipment.courierProviderId
      ? await prisma.courierProvider.findUnique({ where: { id: shipment.courierProviderId } })
      : null;
    if (!provider || !provider.isEnabled) continue;

    const adapter = getCourierAdapter(provider.code);
    if (!adapter) continue;

    try {
      const credentials = await getIntegrationSecrets({ courierProviderId: provider.id });
      const result = await adapter.fetchTracking({
        credentials,
        sandbox: provider.testMode,
        trackingCode: shipment.trackingCode,
        providerConsignmentId: shipment.providerConsignmentId,
      });

      if (result.status !== shipment.status || result.providerStatusRaw !== shipment.providerStatusRaw) {
        await updateShipmentStatus({
          shipmentId: shipment.id,
          status: result.status,
          providerStatusRaw: result.providerStatusRaw,
          note: "Synced from the provider",
          source: "SYNC",
        });
        updated += 1;
      } else {
        await prisma.shipment.update({ where: { id: shipment.id }, data: { lastStatusAt: new Date(), providerStatusRaw: result.providerStatusRaw } });
      }
    } catch (error) {
      logger.warn("courier.tracking_sync_failed", { shipmentId: shipment.id, provider: provider.code }, error);
    }
  }

  return updated;
}
