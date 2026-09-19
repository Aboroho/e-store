import "server-only";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import { nextDocumentNumber } from "@/lib/numbering";
import { getBusinessSetting, BUSINESS_SETTINGS } from "@/lib/settings";
import type { ResellerActor } from "./service";
import type { ResellerPayoutInput } from "./schemas";

/**
 * Reseller payouts.
 *
 * A payout is a claim on a set of ledger entries. Three guarantees matter:
 *
 *  1. **Only eligible, unpaid entries can be allocated.** `ResellerPayoutEntry`
 *     carries a unique constraint on `ledgerEntryId`, so even two concurrent
 *     requests cannot allocate the same entry twice.
 *  2. **A payout can never exceed the eligible balance.** The amount is recomputed
 *     from the entries under a transaction, never trusted from the request.
 *  3. **Money is only "paid" when someone records the transfer**, with a reference;
 *     cancelling a payout releases every entry back to the eligible pool.
 */

export async function createPayout(actor: ResellerActor, input: ResellerPayoutInput) {
  return withTransaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.resellerPayout.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { payout: existing, reused: true as const, allocatedPaisa: existing.amountPaisa, entryCount: 0 };
    }

    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");
    if (reseller.status === "SUSPENDED") throw AppError.invalidState("A suspended reseller cannot be paid out");

    const eligible = await tx.resellerLedgerEntry.findMany({
      where: {
        businessId: actor.businessId,
        resellerId: reseller.id,
        status: "ELIGIBLE",
        payoutId: null,
        ...(input.ledgerEntryIds && input.ledgerEntryIds.length > 0 ? { id: { in: input.ledgerEntryIds } } : {}),
        ...(input.periodStart || input.periodEnd
          ? { createdAt: { ...(input.periodStart ? { gte: input.periodStart } : {}), ...(input.periodEnd ? { lte: input.periodEnd } : {}) } }
          : {}),
      },
      orderBy: { createdAt: "asc" },
    });

    if (eligible.length === 0) {
      throw AppError.invalidState("There is no eligible ledger entry to pay out — the selection is no longer payable or has already been allocated to another payout");
    }

    const totalPaisa = eligible.reduce(
      (total, entry) => total + (entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa),
      0,
    );
    if (totalPaisa <= 0) throw AppError.validation("The selected entries do not produce a positive payout");

    if (input.amountPaisa != null && input.amountPaisa > totalPaisa) {
      throw AppError.validation(
        `A payout cannot exceed the eligible balance of ${formatPaisa(totalPaisa)}. Adjust the selection instead of overpaying.`,
      );
    }

    const minimum = Math.max(
      reseller.minimumPayoutPaisa,
      Number((await getBusinessSetting(actor.businessId, BUSINESS_SETTINGS.resellerPayoutMinimumPaisa.key)) ?? 0),
    );
    if (totalPaisa < minimum) {
      throw AppError.validation(`The minimum payout for this reseller is ${formatPaisa(minimum)}`);
    }

    const payoutNumber = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "reseller_payout" });
    const payout = await tx.resellerPayout.create({
      data: {
        businessId: actor.businessId,
        resellerId: reseller.id,
        payoutNumber,
        status: "PENDING_APPROVAL",
        method: input.method,
        amountPaisa: totalPaisa,
        accountNumber: input.accountNumber ?? reseller.payoutAccountNumber,
        accountName: input.accountName ?? reseller.payoutAccountName,
        periodStart: input.periodStart ?? eligible[0]!.createdAt,
        periodEnd: input.periodEnd ?? eligible[eligible.length - 1]!.createdAt,
        note: input.note ?? null,
        requestedByUserId: actor.userId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        entries: {
          // Debit entries are stored as their magnitude (the column is positive by
          // construction) and netted off with their direction when totals are read.
          create: eligible.map((entry) => ({ ledgerEntryId: entry.id, amountPaisa: entry.amountPaisa })),
        },
      },
      include: { entries: true },
    });

    // The claim is recorded on the entry as well, so the ledger shows which payout
    // each amount belongs to while it is still ELIGIBLE (not yet paid).
    await tx.resellerLedgerEntry.updateMany({
      where: { id: { in: eligible.map((entry) => entry.id) } },
      data: { payoutId: payout.id },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.payout_created",
        entityType: "ResellerPayout",
        entityId: payout.id,
        summary: `Payout ${payoutNumber} for ${reseller.code}: ${formatPaisa(totalPaisa)} across ${eligible.length} entr${eligible.length === 1 ? "y" : "ies"}`,
        after: { amountPaisa: totalPaisa, entries: eligible.length, method: input.method },
        changedFields: ["reseller_payout"],
      },
      tx,
    );

    return { payout, reused: false as const, allocatedPaisa: totalPaisa, entryCount: eligible.length };
  });
}

export async function approvePayout(actor: ResellerActor, input: { payoutId: string; note?: string | null }) {
  return withTransaction(async (tx) => {
    const payout = await tx.resellerPayout.findFirst({ where: { id: input.payoutId, businessId: actor.businessId } });
    if (!payout) throw AppError.notFound("Payout not found");
    if (payout.status === "APPROVED") return payout;
    if (payout.status !== "PENDING_APPROVAL" && payout.status !== "PENDING" && payout.status !== "DRAFT") {
      throw AppError.invalidState(`A payout in ${payout.status.toLowerCase()} status cannot be approved`);
    }

    const updated = await tx.resellerPayout.update({
      where: { id: payout.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedByUserId: actor.userId ?? null, note: input.note ?? payout.note },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.payout_approved",
        entityType: "ResellerPayout",
        entityId: payout.id,
        summary: `Payout ${payout.payoutNumber} approved (${formatPaisa(payout.amountPaisa)})`,
        before: { status: payout.status },
        after: { status: "APPROVED" },
        changedFields: ["status"],
      },
      tx,
    );

    return updated;
  });
}

/**
 * Mark a payout as transferred. The ledger entries move to PAID here — this is the
 * only place where money leaves the outstanding balance.
 */
export async function markPayoutPaid(
  actor: ResellerActor,
  input: { payoutId: string; transactionReference: string; paidAt?: Date; note?: string | null },
) {
  return withTransaction(async (tx) => {
    const payout = await tx.resellerPayout.findFirst({ where: { id: input.payoutId, businessId: actor.businessId } });
    if (!payout) throw AppError.notFound("Payout not found");
    if (payout.status === "PAID") {
      // Replaying the same reference is a safe retry; a second, different transfer
      // against an already-paid payout is not.
      if (payout.transactionReference && payout.transactionReference !== input.transactionReference) {
        throw AppError.invalidState(
          `Payout ${payout.payoutNumber} was already paid with reference ${payout.transactionReference}`,
        );
      }
      return payout;
    }
    if (payout.status === "CANCELLED" || payout.status === "FAILED") {
      throw AppError.invalidState(`A ${payout.status.toLowerCase()} payout cannot be paid`);
    }

    const paidAt = input.paidAt ?? new Date();
    const entries = await tx.resellerPayoutEntry.findMany({ where: { payoutId: payout.id } });

    if (entries.length === 0) throw AppError.invalidState("This payout has no ledger entries allocated");

    const updated = await tx.resellerPayout.update({
      where: { id: payout.id },
      data: {
        status: "PAID",
        paidAt,
        paidByUserId: actor.userId ?? null,
        transactionReference: input.transactionReference,
        note: input.note ?? payout.note,
      },
    });

    await tx.resellerLedgerEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.ledgerEntryId) } },
      data: { status: "PAID", paidAt },
    });

    await tx.resellerPayoutTransaction.create({
      data: {
        payoutId: payout.id,
        status: "PAID",
        providerName: payout.method,
        providerReference: input.transactionReference,
        responsePayload: { paidAt: paidAt.toISOString(), reference: input.transactionReference },
        createdByUserId: actor.userId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.payout_paid",
        entityType: "ResellerPayout",
        entityId: payout.id,
        summary: `Payout ${payout.payoutNumber} paid (${formatPaisa(payout.amountPaisa)}, ref ${input.transactionReference})`,
        before: { status: payout.status },
        after: { status: "PAID", transactionReference: input.transactionReference },
        changedFields: ["status", "reseller_ledger"],
      },
      tx,
    );

    return updated;
  });
}

/** Cancel an unpaid payout and release every entry back to the eligible pool. */
export async function cancelPayout(actor: ResellerActor, input: { payoutId: string; reason: string }) {
  return withTransaction(async (tx) => {
    const payout = await tx.resellerPayout.findFirst({ where: { id: input.payoutId, businessId: actor.businessId } });
    if (!payout) throw AppError.notFound("Payout not found");
    if (payout.status === "PAID") throw AppError.invalidState("A paid payout cannot be cancelled; record an adjustment or a reversal instead");
    if (payout.status === "CANCELLED") return payout;

    const entries = await tx.resellerPayoutEntry.findMany({ where: { payoutId: payout.id } });
    await tx.resellerLedgerEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.ledgerEntryId) } },
      data: { payoutId: null },
    });
    await tx.resellerPayoutEntry.deleteMany({ where: { payoutId: payout.id } });

    const updated = await tx.resellerPayout.update({
      where: { id: payout.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.payout_cancelled",
        entityType: "ResellerPayout",
        entityId: payout.id,
        summary: `Payout ${payout.payoutNumber} cancelled: ${input.reason}`,
        before: { status: payout.status },
        after: { status: "CANCELLED", releasedEntries: entries.length },
        reason: input.reason,
        changedFields: ["status", "reseller_ledger"],
      },
      tx,
    );

    return updated;
  });
}

export async function failPayout(actor: ResellerActor, input: { payoutId: string; reason: string }) {
  return withTransaction(async (tx) => {
    const payout = await tx.resellerPayout.findFirst({ where: { id: input.payoutId, businessId: actor.businessId } });
    if (!payout) throw AppError.notFound("Payout not found");
    if (payout.status === "PAID") throw AppError.invalidState("A paid payout cannot be marked as failed");

    const updated = await tx.resellerPayout.update({
      where: { id: payout.id },
      data: { status: "FAILED", failureReason: input.reason },
    });

    await tx.resellerPayoutTransaction.create({
      data: {
        payoutId: payout.id,
        status: "FAILED",
        providerName: payout.method,
        errorMessage: input.reason,
        createdByUserId: actor.userId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.payout_failed",
        entityType: "ResellerPayout",
        entityId: payout.id,
        summary: `Payout ${payout.payoutNumber} failed: ${input.reason}`,
        after: { status: "FAILED", reason: input.reason },
        reason: input.reason,
        changedFields: ["status"],
      },
      tx,
    );

    return updated;
  });
}

/** The eligible, unpaid entries a payout could be built from. */
export async function eligiblePayoutEntries(businessId: string, resellerId: string) {
  const entries = await prisma.resellerLedgerEntry.findMany({
    where: { businessId, resellerId, status: "ELIGIBLE", payoutId: null },
    orderBy: { createdAt: "asc" },
    include: { order: { select: { orderNumber: true, placedAt: true } } },
    take: 500,
  });

  const totalPaisa = entries.reduce(
    (total, entry) => total + (entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa),
    0,
  );

  return { entries, totalPaisa };
}
