import "server-only";
import { replaceMediaReferences } from "@/modules/media/references";
import type { CourierProviderCode, Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { refreshResellerEligibility } from "@/modules/resellers/earnings";
import { formatPaisa } from "@/lib/money";

/**
 * Courier COD settlements.
 *
 * A settlement is the courier's own statement of what it collected on our
 * behalf. Importing it and matching every line against a shipment is what turns
 * "the courier says it delivered" into money the business can rely on — and, in
 * step 4, into reseller earnings that may be paid out.
 *
 * Matching is deliberately conservative: a line only becomes MATCHED when a
 * shipment is identified *and* the amounts agree. Anything else stays UNMATCHED
 * with the difference recorded, so nothing is silently written off.
 */

export interface SettlementActor {
  businessId: string;
  userId?: string | null;
  actorType?: "USER" | "SYSTEM" | "API_KEY";
}

export interface SettlementRowInput {
  trackingCode?: string | null;
  orderNumber?: string | null;
  grossPaisa: number;
  courierFeePaisa?: number;
  codChargePaisa?: number;
  otherDeductionPaisa?: number;
  reference?: string | null;
  note?: string | null;
}

export interface ImportSettlementInput {
  providerCode: CourierProviderCode;
  reference: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  settlementDate?: Date | null;
  bankReference?: string | null;
  sourceFileName?: string | null;
  sourceMediaId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  rows: SettlementRowInput[];
}

/** Import a courier statement and match each row to a shipment. */
export async function importCourierSettlement(actor: SettlementActor, input: ImportSettlementInput) {
  if (input.rows.length === 0) throw AppError.validation("The settlement has no rows");
  if (input.rows.length > 5000) throw AppError.validation("Split statements larger than 5000 rows before importing");

  const result = await withTransaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.courierSettlement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { settlement: existing, reused: true as const, matched: 0, unmatched: 0 };
    }

    const duplicate = await tx.courierSettlement.findUnique({
      where: { businessId_providerCode_reference: { businessId: actor.businessId, providerCode: input.providerCode, reference: input.reference } },
    });
    if (duplicate) throw AppError.conflict(`Settlement ${input.reference} was already imported for this courier`);

    const provider = await tx.courierProvider.findFirst({ where: { businessId: actor.businessId, code: input.providerCode } });

    const totals = input.rows.reduce(
      (accumulator, row) => {
        const courierFee = row.courierFeePaisa ?? 0;
        const codCharge = row.codChargePaisa ?? 0;
        const other = row.otherDeductionPaisa ?? 0;
        return {
          gross: accumulator.gross + row.grossPaisa,
          courierFee: accumulator.courierFee + courierFee,
          codCharge: accumulator.codCharge + codCharge,
          other: accumulator.other + other,
          net: accumulator.net + (row.grossPaisa - courierFee - codCharge - other),
        };
      },
      { gross: 0, courierFee: 0, codCharge: 0, other: 0, net: 0 },
    );

    const settlement = await tx.courierSettlement.create({
      data: {
        businessId: actor.businessId,
        courierProviderId: provider?.id ?? null,
        providerCode: input.providerCode,
        reference: input.reference,
        status: "IMPORTED",
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        settlementDate: input.settlementDate ?? null,
        bankReference: input.bankReference ?? null,
        grossCollectedPaisa: totals.gross,
        courierFeePaisa: totals.courierFee,
        codChargePaisa: totals.codCharge,
        otherDeductionPaisa: totals.other,
        netReceivedPaisa: totals.net,
        note: input.note ?? null,
        sourceFileName: input.sourceFileName ?? null,
        sourceMediaId: input.sourceMediaId ?? null,
        importedByUserId: actor.userId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    let matched = 0;
    let unmatched = 0;
    let matchedGrossPaisa = 0;
    let unmatchedGrossPaisa = 0;

    if (input.sourceMediaId) await replaceMediaReferences(tx, actor.businessId, "SETTLEMENT", settlement.id, "source", [input.sourceMediaId]);

    for (const row of input.rows) {
      const courierFee = row.courierFeePaisa ?? 0;
      const codCharge = row.codChargePaisa ?? 0;
      const other = row.otherDeductionPaisa ?? 0;
      const net = row.grossPaisa - courierFee - codCharge - other;

      const shipment = row.trackingCode
        ? await tx.shipment.findFirst({ where: { businessId: actor.businessId, trackingCode: row.trackingCode } })
        : row.orderNumber
          ? await tx.shipment.findFirst({
              where: { businessId: actor.businessId, order: { orderNumber: row.orderNumber } },
              orderBy: { createdAt: "desc" },
            })
          : null;

      const expected = shipment?.expectedCollectionPaisa ?? 0;
      const difference = shipment ? row.grossPaisa - expected : 0;
      const isMatched = Boolean(shipment) && difference === 0;
      if (isMatched) {
        matched += 1;
        matchedGrossPaisa += row.grossPaisa;
      } else {
        unmatched += 1;
        unmatchedGrossPaisa += row.grossPaisa;
      }

      await tx.courierSettlementEntry.create({
        data: {
          settlementId: settlement.id,
          shipmentId: shipment?.id ?? null,
          orderId: shipment?.orderId ?? null,
          reference: row.reference ?? shipment?.merchantOrderId ?? row.orderNumber ?? null,
          trackingCode: row.trackingCode ?? shipment?.trackingCode ?? null,
          grossPaisa: row.grossPaisa,
          courierFeePaisa: courierFee,
          codChargePaisa: codCharge,
          otherDeductionPaisa: other,
          netPaisa: net,
          status: isMatched ? "MATCHED" : "UNMATCHED",
          matchMethod: shipment ? (row.trackingCode ? "TRACKING_CODE" : "ORDER_NUMBER") : null,
          discrepancyPaisa: shipment ? difference : 0,
          discrepancyReason: !shipment
            ? "No shipment matches this row"
            : difference !== 0
              ? `Courier collected ${formatPaisa(row.grossPaisa)} but the shipment expects ${formatPaisa(expected)}`
              : null,
          note: row.note ?? null,
          matchedAt: isMatched ? new Date() : null,
        },
      });

      if (shipment && isMatched) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            collectedPaisa: row.grossPaisa,
            courierChargePaisa: courierFee,
            codChargePaisa: codCharge,
          },
        });
        // The courier's own fee figures are what actually came off the cash, so the
        // collection row is rewritten with them and the net recomputed.
        const collection = await tx.codCollection.findUnique({ where: { shipmentId: shipment.id } });
        if (collection) {
          await tx.codCollection.update({
            where: { id: collection.id },
            data: {
              settlementId: settlement.id,
              status: "SETTLED",
              courierChargePaisa: courierFee,
              codChargePaisa: codCharge,
              netPaisa: collection.collectedPaisa - courierFee - codCharge,
            },
          });
        }
      }
    }

    const status = unmatched === 0 ? "RECONCILED" : matched > 0 ? "PARTIALLY_RECONCILED" : "DISPUTED";
    const updated = await tx.courierSettlement.update({
      where: { id: settlement.id },
      data: {
        status,
        reconciledPaisa: matchedGrossPaisa,
        unmatchedPaisa: unmatchedGrossPaisa,
        ...(unmatched === 0 ? { reconciledByUserId: actor.userId ?? null, reconciledAt: new Date() } : {}),
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "settlement.imported",
        entityType: "CourierSettlement",
        entityId: settlement.id,
        summary: `Imported ${input.providerCode} settlement ${input.reference}: ${matched} matched, ${unmatched} unmatched`,
        after: { matched, unmatched, net: totals.net, status },
        changedFields: ["settlement"],
      },
      tx,
    );

    return { settlement: updated, reused: false as const, matched, unmatched };
  });

  // Every row that matched brought cash in, so the reseller earnings those orders
  // carried can become payable straight away — the rows still in dispute cannot.
  if (!result.reused && ["RECONCILED", "PARTIALLY_RECONCILED"].includes(result.settlement.status)) {
    await promoteResellerEarnings(actor.businessId, result.settlement.id);
  }

  return result;
}

/** Manually attach an unmatched row to a shipment (or ignore it). */
export async function resolveSettlementEntry(
  actor: SettlementActor,
  input: { entryId: string; shipmentId?: string; ignore?: boolean; note?: string | null },
) {
  return withTransaction(async (tx) => {
    const entry = await tx.courierSettlementEntry.findUnique({
      where: { id: input.entryId },
      include: { settlement: true },
    });
    if (!entry || entry.settlement.businessId !== actor.businessId) throw AppError.notFound("Settlement row not found");

    if (input.ignore) {
      const ignored = await tx.courierSettlementEntry.update({
        where: { id: entry.id },
        data: { status: "IGNORED", note: input.note ?? entry.note, matchedByUserId: actor.userId ?? null, matchedAt: new Date() },
      });
      const after = await recomputeSettlement(tx, entry.settlementId);
      return { resolved: ignored, settlementStatus: after.status, settlementId: entry.settlementId };
    }

    if (!input.shipmentId) throw AppError.validation("Choose the shipment this row belongs to");
    const shipment = await tx.shipment.findFirst({ where: { id: input.shipmentId, businessId: actor.businessId } });
    if (!shipment) throw AppError.notFound("Shipment not found");

    const difference = entry.grossPaisa - shipment.expectedCollectionPaisa;
    const resolved = await tx.courierSettlementEntry.update({
      where: { id: entry.id },
      data: {
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        trackingCode: entry.trackingCode ?? shipment.trackingCode,
        status: difference === 0 ? "MATCHED" : "DISPUTED",
        matchMethod: "MANUAL",
        discrepancyPaisa: difference,
        discrepancyReason:
          difference === 0 ? null : `Manual match: courier ${formatPaisa(entry.grossPaisa)} vs expected ${formatPaisa(shipment.expectedCollectionPaisa)}`,
        matchedByUserId: actor.userId ?? null,
        matchedAt: new Date(),
        note: input.note ?? entry.note,
      },
    });

    if (entry.status !== "MATCHED") {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { collectedPaisa: entry.grossPaisa, courierChargePaisa: entry.courierFeePaisa, codChargePaisa: entry.codChargePaisa },
      });
      await tx.codCollection.updateMany({
        where: { shipmentId: shipment.id },
        data: { settlementId: entry.settlementId, status: "SETTLED" },
      });
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "settlement.entry_resolved",
        entityType: "CourierSettlementEntry",
        entityId: entry.id,
        summary: `Settlement row matched to shipment ${shipment.internalCode}`,
        after: { status: resolved.status, differencePaisa: difference },
      },
      tx,
    );

    const settlementAfter = await recomputeSettlement(tx, entry.settlementId);
    return { resolved, settlementStatus: settlementAfter.status, settlementId: entry.settlementId };
  }).then(async (result) => {
    if (result.settlementStatus === "RECONCILED" || result.settlementStatus === "PARTIALLY_RECONCILED") {
      await promoteResellerEarnings(actor.businessId, result.settlementId);
    }
    return result.resolved;
  });
}

/** Recompute a settlement's headline numbers from its rows. */
export async function recomputeSettlement(tx: Prisma.TransactionClient, settlementId: string) {
  const [matched, unmatched, disputed, totals] = await Promise.all([
    tx.courierSettlementEntry.count({ where: { settlementId, status: "MATCHED" } }),
    tx.courierSettlementEntry.count({ where: { settlementId, status: "UNMATCHED" } }),
    tx.courierSettlementEntry.count({ where: { settlementId, status: "DISPUTED" } }),
    tx.courierSettlementEntry.aggregate({ where: { settlementId }, _sum: { grossPaisa: true, netPaisa: true } }),
  ]);

  const status = unmatched === 0 && disputed === 0 ? "RECONCILED" : matched > 0 ? "PARTIALLY_RECONCILED" : "DISPUTED";

  return tx.courierSettlement.update({
    where: { id: settlementId },
    data: {
      status,
      reconciledPaisa: totals._sum?.grossPaisa ?? 0,
      unmatchedPaisa: 0,
      ...(status === "RECONCILED" ? { reconciledAt: new Date() } : {}),
    },
  });
}

/** Close a settlement: only allowed when every row is matched or ignored. */
export async function reconcileSettlement(actor: SettlementActor, settlementId: string) {
  return withTransaction(async (tx) => {
    const settlement = await tx.courierSettlement.findFirst({ where: { id: settlementId, businessId: actor.businessId } });
    if (!settlement) throw AppError.notFound("Settlement not found");

    const openRows = await tx.courierSettlementEntry.count({
      where: { settlementId, status: { in: ["UNMATCHED", "DISPUTED"] } },
    });
    if (openRows > 0) throw AppError.invalidState(`${openRows} row(s) still need a decision before this settlement can be closed`);

    const updated = await tx.courierSettlement.update({
      where: { id: settlementId },
      data: { status: "RECONCILED", reconciledByUserId: actor.userId ?? null, reconciledAt: new Date(), receivedAt: settlement.receivedAt ?? new Date() },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "settlement.reconciled",
        entityType: "CourierSettlement",
        entityId: settlement.id,
        summary: `Settlement ${settlement.reference} reconciled (${formatPaisa(settlement.netReceivedPaisa)} net)`,
        after: { status: "RECONCILED", netReceivedPaisa: settlement.netReceivedPaisa },
        changedFields: ["settlement"],
      },
      tx,
    );

    return updated;
  });
}

/**
 * Promote reseller earnings that this settlement has now paid for.
 *
 * Runs after the settlement is reconciled: a reseller is only paid once the courier's
 * cash has actually reached the business and been matched to a shipment.
 */
export async function promoteResellerEarnings(businessId: string, settlementId: string) {
  return refreshResellerEligibility(businessId, { settlementId });
}

export async function listSettlements(businessId: string, params: Record<string, string | string[] | undefined>) {
  const status = typeof params.status === "string" && params.status !== "ALL" ? params.status : undefined;
  const providerCode = typeof params.provider === "string" && params.provider !== "ALL" ? params.provider : undefined;

  const where: Prisma.CourierSettlementWhereInput = {
    businessId,
    ...(status ? { status: status as "IMPORTED" } : {}),
    ...(providerCode ? { providerCode: providerCode as CourierProviderCode } : {}),
  };

  const [rows, total, aggregated] = await Promise.all([
    prisma.courierSettlement.findMany({
      where,
      orderBy: [{ settlementDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { _count: { select: { entries: true } } },
    }),
    prisma.courierSettlement.count({ where }),
    prisma.courierSettlement.aggregate({ where, _sum: { grossCollectedPaisa: true, netReceivedPaisa: true, courierFeePaisa: true } }),
  ]);

  return {
    rows,
    total,
    grossPaisa: aggregated._sum?.grossCollectedPaisa ?? 0,
    netPaisa: aggregated._sum?.netReceivedPaisa ?? 0,
    feesPaisa: aggregated._sum?.courierFeePaisa ?? 0,
  };
}

export async function getSettlementDetail(businessId: string, settlementId: string) {
  const settlement = await prisma.courierSettlement.findFirst({
    where: { id: settlementId, businessId },
    include: {
      entries: {
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        include: {
          shipment: { select: { id: true, internalCode: true, trackingCode: true, status: true, courierChargePaisa: true, expectedCollectionPaisa: true } },
          order: { select: { id: true, orderNumber: true, customerName: true } },
        },
      },
    },
  });
  if (!settlement) throw AppError.notFound("Settlement not found");

  const provider = settlement.courierProviderId
    ? await prisma.courierProvider.findUnique({ where: { id: settlement.courierProviderId }, select: { id: true, name: true, code: true } })
    : null;

  const summary = settlement.entries.reduce(
    (accumulator, entry) => {
      accumulator.byStatus[entry.status] = (accumulator.byStatus[entry.status] ?? 0) + 1;
      accumulator.grossPaisa += entry.grossPaisa;
      accumulator.netPaisa += entry.netPaisa;
      accumulator.discrepancyPaisa += entry.discrepancyPaisa;
      return accumulator;
    },
    { byStatus: {} as Record<string, number>, grossPaisa: 0, netPaisa: 0, discrepancyPaisa: 0 },
  );

  return { settlement, provider, summary };
}

/** Candidate shipments for manually matching a settlement row. */
export async function findSettlementMatchCandidates(businessId: string, search: string) {
  if (search.trim().length < 3) return [];
  return prisma.shipment.findMany({
    where: {
      businessId,
      status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"] },
      OR: [
        { internalCode: { contains: search, mode: "insensitive" } },
        { trackingCode: { contains: search, mode: "insensitive" } },
        { merchantOrderId: { contains: search, mode: "insensitive" } },
        { recipientPhoneNormalized: { contains: search } },
      ],
    },
    orderBy: { deliveredAt: "desc" },
    take: 20,
    select: { id: true, internalCode: true, trackingCode: true, status: true, expectedCollectionPaisa: true, merchantOrderId: true },
  });
}
