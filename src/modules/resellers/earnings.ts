import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import { logger } from "@/lib/logging";
import type { ResellerActor } from "./service";

/**
 * The reseller ledger: what the business owes a reseller, and when it becomes
 * payable.
 *
 * Two rules from the specification drive this file:
 *
 *  1. **Earnings come from order snapshots.** Nothing here reads the current
 *     catalogue price. The amounts were frozen on the order line when the order was
 *     created (`unitPricePaisa`) and on the order when the collection was agreed
 *     (`resellerCollectionPaisa`).
 *  2. **Delivery is not money.** A delivered order only creates *pending* entries.
 *     They become `ELIGIBLE` (payable) when the cash actually reached the business
 *     and was reconciled — i.e. the shipment's COD collection is attached to a
 *     courier settlement that is `RECONCILED`. Orders that were paid directly
 *     (no courier collecting cash) have nothing to reconcile and become eligible
 *     once they are fully paid.
 *
 * Every entry is immutable: corrections are new entries (REVERSAL/ADJUSTMENT), never
 * edits, and `idempotencyKey` makes the whole thing safe to replay.
 */

type Tx = Prisma.TransactionClient;

export interface EarningsResult {
  created: number;
  alreadyRecorded: number;
  earningPaisa: number;
  pendingPaisa: number;
  eligiblePaisa: number;
}

/**
 * Snapshot a delivered reseller order into the ledger.
 *
 * Safe to call repeatedly: the per-order idempotency keys make a second delivery
 * event a no-op.
 */
export async function recordResellerEarnings(
  tx: Tx,
  input: { orderId: string; actorUserId?: string | null },
): Promise<EarningsResult> {
  const order = await tx.order.findFirst({
    where: { id: input.orderId },
    include: { items: true, reseller: true, shipments: { select: { id: true, codCollection: { select: { id: true } } } } },
  });
  if (!order) throw AppError.notFound("Order not found");
  if (!order.resellerId || !order.reseller) return { created: 0, alreadyRecorded: 0, earningPaisa: 0, pendingPaisa: 0, eligiblePaisa: 0 };
  if (order.status === "CANCELLED") return { created: 0, alreadyRecorded: 0, earningPaisa: 0, pendingPaisa: 0, eligiblePaisa: 0 };

  const reseller = order.reseller;
  const existing = await tx.resellerLedgerEntry.findUnique({ where: { idempotencyKey: `reseller:${order.id}:earning` } });
  if (existing) {
    const amounts = await resellerBalance(tx, reseller.id);
    return { created: 0, alreadyRecorded: 1, earningPaisa: existing.amountPaisa, ...amounts };
  }

  const units = order.items.reduce((total, item) => total + item.quantity, 0);
  const packagingPaisa = reseller.packagingIncluded ? 0 : reseller.packagingCostPaisa * units;
  const collectionPaisa = order.resellerCollectionPaisa ?? order.grandTotalPaisa + packagingPaisa;
  const costPaisa = order.resellerCostPaisa || order.grandTotalPaisa + packagingPaisa;
  const courierChargePaisa = Math.max(order.deliveryFeePaisa, 0);
  const codChargePaisa = Math.max(order.codSurchargePaisa, 0);

  // The reseller keeps everything they collected from their customer, less the
  // wholesale price of the goods, the packaging we billed, and the delivery and COD
  // charges they carry. Packaging, delivery and COD are posted as their own debit
  // lines, so the earning credit starts from the goods value alone — the charges are
  // never deducted twice.
  const goodsCostPaisa = costPaisa - packagingPaisa - courierChargePaisa - codChargePaisa;
  const itemsEarningPaisa = collectionPaisa - goodsCostPaisa;
  const earningsPaisa = collectionPaisa - costPaisa;

  const settlementEntryId = await findReconciledSettlementEntryId(tx, order);
  const eligibleNow = await isOrderPayable(tx, order);

  const existingEarning = await tx.resellerOrderEarning.findFirst({ where: { orderId: order.id } });
  const earningData = {
    collectedPaisa: collectionPaisa,
    resellerPricePaisa: costPaisa,
    packagingCostPaisa: packagingPaisa,
    courierChargePaisa,
    codChargePaisa,
    earningsPaisa,
  };
  await tx.resellerOrderEarning.upsert({
    where: { id: existingEarning?.id ?? "00000000-0000-0000-0000-000000000000" },
    create: {
      businessId: order.businessId,
      resellerId: reseller.id,
      orderId: order.id,
      collectedPaisa: collectionPaisa,
      resellerPricePaisa: costPaisa,
      resellerCostPaisa: order.inventoryCostPaisa,
      packagingCostPaisa: packagingPaisa,
      courierChargePaisa,
      codChargePaisa,
      earningsPaisa,
      expectedCodPaisa: order.codCollectPaisa || order.grandTotalPaisa,
      settledPaisa: eligibleNow ? collectionPaisa : 0,
      eligibilityStatus: eligibleNow ? "ELIGIBLE" : "PENDING",
      eligibleAt: eligibleNow ? new Date() : null,
    },
    update: {
      ...earningData,
      ...(eligibleNow ? { eligibilityStatus: "ELIGIBLE", eligibleAt: new Date(), settledPaisa: collectionPaisa } : {}),
    },
  });

  const status: "ELIGIBLE" | "PENDING" = eligibleNow ? "ELIGIBLE" : "PENDING";
  const eligibleAt = eligibleNow ? new Date() : null;

  const entries: Prisma.ResellerLedgerEntryCreateManyInput[] = [
    {
      businessId: order.businessId,
      resellerId: reseller.id,
      type: "EARNING",
      direction: "CREDIT",
      amountPaisa: Math.max(itemsEarningPaisa, 0),
      status,
      orderId: order.id,
      settlementEntryId,
      description: `Earnings on ${order.orderNumber} (${units} unit(s))`,
      eligibleAt,
      idempotencyKey: `reseller:${order.id}:earning`,
      createdByUserId: input.actorUserId ?? null,
    },
  ];

  if (packagingPaisa > 0) {
    entries.push({
      businessId: order.businessId,
      resellerId: reseller.id,
      type: "PACKAGING_CHARGE",
      direction: "DEBIT",
      amountPaisa: packagingPaisa,
      status,
      orderId: order.id,
      settlementEntryId,
      description: `Packaging charged on ${order.orderNumber}`,
      eligibleAt,
      idempotencyKey: `reseller:${order.id}:packaging`,
      createdByUserId: input.actorUserId ?? null,
    });
  }

  if (courierChargePaisa > 0) {
    entries.push({
      businessId: order.businessId,
      resellerId: reseller.id,
      type: "COURIER_CHARGE",
      direction: "DEBIT",
      amountPaisa: courierChargePaisa,
      status,
      orderId: order.id,
      settlementEntryId,
      description: `Courier charge on ${order.orderNumber}`,
      eligibleAt,
      idempotencyKey: `reseller:${order.id}:courier`,
      createdByUserId: input.actorUserId ?? null,
    });
  }

  if (codChargePaisa > 0) {
    entries.push({
      businessId: order.businessId,
      resellerId: reseller.id,
      type: "COD_CHARGE",
      direction: "DEBIT",
      amountPaisa: codChargePaisa,
      status,
      orderId: order.id,
      settlementEntryId,
      description: `COD charge on ${order.orderNumber}`,
      eligibleAt,
      idempotencyKey: `reseller:${order.id}:cod`,
      createdByUserId: input.actorUserId ?? null,
    });
  }

  await tx.resellerLedgerEntry.createMany({ data: entries, skipDuplicates: true });

  await recordAudit(
    {
      businessId: order.businessId,
      actorType: input.actorUserId ? "USER" : "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      action: "reseller.earnings_recorded",
      entityType: "Order",
      entityId: order.id,
      summary: `Reseller ${reseller.code}: ${formatPaisa(earningsPaisa)} earnings on ${order.orderNumber} (${status.toLowerCase()})`,
      after: { earningsPaisa, collectionPaisa, costPaisa, status, settlementEntryId },
      changedFields: ["reseller_ledger"],
    },
    tx,
  );

  return { created: entries.length, alreadyRecorded: 0, earningPaisa: earningsPaisa, pendingPaisa: 0, eligiblePaisa: 0 };
}

/**
 * The statement row that carried this order's COD cash, if any.
 *
 * A row counts once it has been matched to the shipment and its statement has been
 * taken in — either fully reconciled or partially reconciled, in which case the rows
 * that did match are the ones that brought cash in.
 */
async function findReconciledSettlementEntryId(tx: Tx, order: { id: string; shipments?: Array<{ id: string }> }): Promise<string | null> {
  const shipments = order.shipments ?? (await tx.shipment.findMany({ where: { orderId: order.id }, select: { id: true } }));
  if (shipments.length === 0) return null;

  const entry = await tx.courierSettlementEntry.findFirst({
    where: {
      shipmentId: { in: shipments.map((shipment) => shipment.id) },
      status: "MATCHED",
      settlement: { status: { in: ["RECONCILED", "PARTIALLY_RECONCILED"] } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return entry?.id ?? null;
}

/**
 * Is this order's cash actually in hand and reconciled?
 *
 *  - A courier collected the money → the COD collection must be attached to a
 *    settlement that has been reconciled.
 *  - The customer paid the business directly (no courier cash) → the order must be
 *    fully paid; there is nothing for a courier to remit.
 */
async function isOrderPayable(
  tx: Tx,
  order: { id: string; duePaisa: number; paymentStatus: string; shipments?: Array<{ id: string }> },
): Promise<boolean> {
  const shipments = order.shipments ?? (await tx.shipment.findMany({ where: { orderId: order.id }, select: { id: true } }));

  if (shipments.length > 0) {
    const shipmentIds = shipments.map((shipment) => shipment.id);

    // The shipment's own statement row has to be matched: a row the courier
    // short-paid stays open (UNMATCHED/DISPUTED) and unlocks nothing until a human
    // decides what to do with it.
    const matchedRow = await tx.courierSettlementEntry.findFirst({
      where: {
        shipmentId: { in: shipmentIds },
        status: "MATCHED",
        settlement: { status: { in: ["RECONCILED", "PARTIALLY_RECONCILED"] } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!matchedRow) return false;

    const collection = await tx.codCollection.findFirst({
      where: { shipmentId: { in: shipmentIds }, settlementId: { not: null } },
      include: { settlement: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (!collection) return false;
    return collection.settlement?.status === "RECONCILED" || collection.settlement?.status === "PARTIALLY_RECONCILED";
  }

  return order.duePaisa <= 0 && ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus);
}

/**
 * Promote pending entries to payable.
 *
 * Called after a settlement is reconciled (and by the admin/worker as a safety net).
 * Only entries whose order now passes `isOrderPayable` move, so this can never make
 * money payable that has not been received.
 */
export async function refreshResellerEligibility(
  businessId: string,
  input: { resellerId?: string; settlementId?: string } = {},
): Promise<{ promoted: number; promotedPaisa: number }> {
  return withTransaction(async (tx) => {
    // A settlement unlocks the orders its statement rows matched. The ledger entries
    // of those orders are linked to a settlement row only once they are promoted, so
    // the orders (not the entries) are what the filter has to start from.
    let settlementOrderIds: string[] | undefined;
    if (input.settlementId) {
      const rows = await tx.courierSettlementEntry.findMany({
        where: { settlementId: input.settlementId, orderId: { not: null } },
        select: { orderId: true },
      });
      settlementOrderIds = [...new Set(rows.map((row) => row.orderId!))];
      if (settlementOrderIds.length === 0) return { promoted: 0, promotedPaisa: 0 };
    }

    const pending = await tx.resellerLedgerEntry.findMany({
      where: {
        businessId,
        status: "PENDING",
        ...(input.resellerId ? { resellerId: input.resellerId } : {}),
        ...(settlementOrderIds ? { orderId: { in: settlementOrderIds } } : {}),
      },
      include: { order: { select: { id: true, duePaisa: true, paymentStatus: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    let promoted = 0;
    let promotedPaisa = 0;
    // Only the orders whose ledger actually moved may have their snapshot updated —
    // otherwise an order whose cash has not arrived would be marked payable too.
    const promotedOrderIds = new Set<string>();

    for (const entry of pending) {
      if (!entry.orderId || !entry.order) continue;
      const payable = await isOrderPayable(tx, { id: entry.order.id, duePaisa: entry.order.duePaisa, paymentStatus: entry.order.paymentStatus });
      if (!payable) continue;
      promotedOrderIds.add(entry.orderId);

      const settlementEntryId = await findReconciledSettlementEntryId(tx, { id: entry.order.id });
      await tx.resellerLedgerEntry.update({
        where: { id: entry.id },
        data: {
          status: "ELIGIBLE",
          eligibleAt: new Date(),
          ...(settlementEntryId ? { settlementEntryId } : {}),
        },
      });
      promoted += 1;
      promotedPaisa += entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa;
    }

    if (promoted > 0) {
      // Keep the per-order snapshot in step with the ledger.
      await tx.resellerOrderEarning.updateMany({
        where: { orderId: { in: [...promotedOrderIds] }, eligibilityStatus: "PENDING" },
        data: { eligibilityStatus: "ELIGIBLE", eligibleAt: new Date() },
      });
      logger.info("reseller.eligibility_refreshed", { businessId, promoted, promotedPaisa });
    }

    return { promoted, promotedPaisa };
  });
}

/**
 * Void the ledger of a cancelled or returned reseller order.
 *
 * Entries that have not been paid are voided in place — the rows stay for the audit
 * trail and stop counting towards a balance. If an entry was already claimed by a
 * payout that has not actually paid out yet, the claim is released first and the
 * payout is re-costed (or cancelled when nothing is left in it). Only money that
 * genuinely left the business is answered with an opposing REVERSAL entry, because a
 * paid entry can never be edited away.
 */
export async function voidResellerEarnings(
  tx: Tx,
  input: { orderId: string; reason: string; actorUserId?: string | null; resellerId?: string | null },
): Promise<{ voided: number; reversedPaisa: number; affectedPayoutIds: string[] }> {
  const entries = await tx.resellerLedgerEntry.findMany({
    where: { orderId: input.orderId, status: { in: ["PENDING", "ELIGIBLE"] } },
  });
  if (entries.length === 0) return { voided: 0, reversedPaisa: 0, affectedPayoutIds: [] };

  let reversedPaisa = 0;
  const resellerId = input.resellerId ?? entries[0]!.resellerId;
  const affectedPayoutIds = new Set<string>();

  for (const entry of entries) {
    if (entry.payoutId) {
      await tx.resellerPayoutEntry.deleteMany({ where: { ledgerEntryId: entry.id } });
      affectedPayoutIds.add(entry.payoutId);
    }
    await tx.resellerLedgerEntry.update({
      where: { id: entry.id },
      data: { status: "VOID", voidedAt: new Date(), payoutId: null, reason: input.reason },
    });
  }

  // Entries already paid out cannot be voided: the money moved, so the correction is
  // a new opposing entry that future payouts will net off.
  const paidEntries = await tx.resellerLedgerEntry.findMany({ where: { orderId: input.orderId, status: "PAID" } });
  for (const entry of paidEntries) {
    await tx.resellerLedgerEntry.create({
      data: {
        businessId: entry.businessId,
        resellerId,
        type: "REVERSAL",
        direction: entry.direction === "CREDIT" ? "DEBIT" : "CREDIT",
        amountPaisa: entry.amountPaisa,
        status: "ELIGIBLE",
        orderId: entry.orderId,
        description: `Reversal of a paid ${entry.type.toLowerCase().replace(/_/g, " ")} after ${input.reason}`,
        reason: input.reason,
        reversesEntryId: entry.id,
        idempotencyKey: `reversal:${entry.id}`,
        createdByUserId: input.actorUserId ?? null,
      },
    });
    reversedPaisa += entry.amountPaisa;
  }

  await tx.resellerOrderEarning.updateMany({ where: { orderId: input.orderId }, data: { eligibilityStatus: "VOID" } });

  await recordAudit(
    {
      businessId: entries[0]!.businessId,
      actorType: input.actorUserId ? "USER" : "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      action: "reseller.earnings_voided",
      entityType: "Order",
      entityId: input.orderId,
      summary: `Reseller ledger voided for order ${input.orderId}: ${input.reason}`,
      after: { voided: entries.length, reversedPaisa, payouts: [...affectedPayoutIds] },
      reason: input.reason,
      changedFields: ["reseller_ledger"],
    },
    tx,
  );

  return { voided: entries.length, reversedPaisa, affectedPayoutIds: [...affectedPayoutIds] };
}

/**
 * Re-cost a payout whose entries were taken away, cancelling it when nothing is left.
 * Called after a cancellation released the claims on a pending payout.
 */
export async function reconcilePayoutAfterVoid(
  tx: Tx,
  input: { payoutId: string; reason: string; actorUserId?: string | null },
): Promise<{ payoutId: string; status: string; amountPaisa: number }> {
  const payout = await tx.resellerPayout.findUnique({
    where: { id: input.payoutId },
    include: { entries: { include: { ledgerEntry: { select: { direction: true } } } } },
  });
  if (!payout) throw AppError.notFound("Payout not found");
  if (payout.status === "PAID" || payout.status === "CANCELLED") {
    return { payoutId: payout.id, status: payout.status, amountPaisa: payout.amountPaisa };
  }

  const netPaisa = payout.entries.reduce(
    (total, entry) => total + (entry.ledgerEntry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa),
    0,
  );

  if (payout.entries.length === 0 || netPaisa <= 0) {
    // The requested amount stays on the record (the column must stay positive), but
    // the payout is cancelled and can no longer be paid.
    const cancelled = await tx.resellerPayout.update({
      where: { id: payout.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
    });
    return { payoutId: cancelled.id, status: cancelled.status, amountPaisa: cancelled.amountPaisa };
  }

  const updated = await tx.resellerPayout.update({ where: { id: payout.id }, data: { amountPaisa: netPaisa } });
  return { payoutId: updated.id, status: updated.status, amountPaisa: updated.amountPaisa };
}

/** Manual adjustment (positive = business owes more, negative = reseller owes). */
export async function recordLedgerAdjustment(
  actor: ResellerActor,
  input: { resellerId: string; amountPaisa: number; description: string; reason?: string | null; orderId?: string },
) {
  if (input.amountPaisa === 0) throw AppError.validation("Enter a non-zero adjustment amount");

  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");

    // Adjustments are approved by a human decision, so they are payable immediately.
    const entry = await tx.resellerLedgerEntry.create({
      data: {
        businessId: actor.businessId,
        resellerId: reseller.id,
        type: "ADJUSTMENT",
        direction: input.amountPaisa > 0 ? "CREDIT" : "DEBIT",
        amountPaisa: Math.abs(input.amountPaisa),
        status: "ELIGIBLE",
        orderId: input.orderId ?? null,
        description: input.description,
        reason: input.reason ?? null,
        eligibleAt: new Date(),
        createdByUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.adjustment_recorded",
        entityType: "ResellerLedgerEntry",
        entityId: entry.id,
        summary: `Reseller ${reseller.code}: ${input.amountPaisa > 0 ? "+" : "−"}${formatPaisa(Math.abs(input.amountPaisa))} — ${input.description}`,
        after: { amountPaisa: input.amountPaisa, description: input.description },
        reason: input.reason ?? null,
        changedFields: ["reseller_ledger"],
      },
      tx,
    );

    return entry;
  });
}

/** Balances derived from the ledger — never stored as a single mutable number. */
export async function resellerBalance(client: Tx | typeof prisma, resellerId: string) {
  const entries = await client.resellerLedgerEntry.findMany({
    where: { resellerId, status: { in: ["PENDING", "ELIGIBLE", "PAID"] } },
    select: { direction: true, amountPaisa: true, status: true, payoutId: true },
  });

  let pendingPaisa = 0;
  let eligiblePaisa = 0;
  let allocatedPaisa = 0;
  let paidPaisa = 0;

  for (const entry of entries) {
    const signed = entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa;
    if (entry.status === "PENDING") pendingPaisa += signed;
    else if (entry.status === "PAID") paidPaisa += signed;
    // Payable now is what a payout can still claim; an eligible entry already claimed
    // by a payout awaiting approval is held, not spendable twice.
    else if (entry.payoutId) allocatedPaisa += signed;
    else eligiblePaisa += signed;
  }

  return {
    pendingPaisa,
    eligiblePaisa,
    allocatedPaisa,
    paidPaisa,
    /** Everything still owed to the reseller, however it is parked. */
    outstandingPaisa: pendingPaisa + eligiblePaisa + allocatedPaisa,
  };
}

/** Ledger rows for the reseller detail screen and exports. */
export async function listResellerLedger(
  businessId: string,
  resellerId: string,
  query: { status?: string; type?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));

  const where: Prisma.ResellerLedgerEntryWhereInput = {
    businessId,
    resellerId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PENDING" } : {}),
    ...(query.type && query.type !== "ALL" ? { type: query.type as "EARNING" } : {}),
  };

  const [rows, total, aggregated] = await Promise.all([
    prisma.resellerLedgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        order: { select: { id: true, orderNumber: true, placedAt: true, status: true } },
        payout: { select: { id: true, payoutNumber: true, status: true } },
      },
    }),
    prisma.resellerLedgerEntry.count({ where }),
    prisma.resellerLedgerEntry.groupBy({ by: ["status", "direction"], where, _sum: { amountPaisa: true } }),
  ]);

  return { rows, total, page, pageSize, aggregated };
}

export { prisma };
