import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError, isUniqueConstraintError } from "@/lib/errors";
import { weightedAverageCostPaisa } from "@/lib/money";
import { recordAudit } from "@/lib/audit";

/**
 * Inventory movement engine.
 *
 * Every stock change in the platform — receipts, adjustments, reservations,
 * dispatches, damage, inspection, exchange returns — goes through
 * `applyStockMovement`. It is the only code that writes `InventoryBalance`, and
 * it always writes the matching immutable `InventoryMovement` row in the same
 * transaction, so the ledger and the counters cannot diverge.
 *
 * Concurrency: the balance row is locked with `SELECT … FOR UPDATE` before the
 * counters are read, so two concurrent transactions cannot both see the same
 * "available" quantity. Counters are additionally protected in SQL by CHECK
 * constraints (see prisma/migrations/extra-constraints.sql), which means an
 * oversell attempt fails the transaction even if application logic is bypassed.
 */

export type StockConditionValue = "SELLABLE" | "DAMAGED" | "INSPECTION";

export interface StockMovementInput {
  businessId: string;
  locationId: string;
  variantId: string;
  type:
    | "OPENING"
    | "PURCHASE_RECEIPT"
    | "PURCHASE_RECEIPT_REVERSAL"
    | "SALE_DISPATCH"
    | "SALE_REVERSAL"
    | "RESERVATION"
    | "RESERVATION_RELEASE"
    | "ADJUSTMENT_INCREASE"
    | "ADJUSTMENT_DECREASE"
    | "DAMAGE_RECORDED"
    | "DAMAGE_RELEASED"
    | "INSPECTION_IN"
    | "INSPECTION_OUT"
    | "PREORDER_ALLOCATION"
    | "EXCHANGE_RETURN_IN"
    | "EXCHANGE_REPLACEMENT_OUT"
    | "CORRECTION";
  onHandDelta?: number;
  reservedDelta?: number;
  damagedDelta?: number;
  inspectionDelta?: number;
  preorderCommittedDelta?: number;
  incomingDelta?: number;
  /** Unit cost in paisa; required for receipts so the weighted average stays exact. */
  unitCostPaisa?: number | null;
  condition?: StockConditionValue;
  sourceType?: string | null;
  sourceId?: string | null;
  reference?: string | null;
  reason?: string | null;
  note?: string | null;
  actorUserId?: string | null;
  actorCustomerId?: string | null;
  /** Replaying the same key returns the original movement instead of moving stock twice. */
  idempotencyKey?: string | null;
  /** Skip the "sellable" guard (used for corrections performed by an administrator). */
  allowNegativeAvailable?: boolean;
}

export interface StockMovementResult {
  movementId: string;
  reused: boolean;
  balance: {
    onHand: number;
    reserved: number;
    damaged: number;
    inspection: number;
    preorderCommitted: number;
    incomingQuantity: number;
    averageCostPaisa: number;
    available: number;
  };
}

type Tx = Prisma.TransactionClient;

interface BalanceRow {
  id: string;
  onHand: number;
  reserved: number;
  damaged: number;
  inspection: number;
  preorderCommitted: number;
  incomingQuantity: number;
  averageCostPaisa: number;
}

export function availableQuantity(balance: {
  onHand: number;
  reserved: number;
  damaged: number;
  inspection: number;
}): number {
  return balance.onHand - balance.reserved - balance.damaged - balance.inspection;
}

/**
 * Load the balance row with a write lock, creating it when it does not exist yet.
 * The INSERT is guarded by ON CONFLICT so concurrent creators are safe.
 */
async function lockBalance(tx: Tx, input: { locationId: string; variantId: string }): Promise<BalanceRow> {
  const rows = await tx.$queryRaw<BalanceRow[]>`
    SELECT "id", "onHand", "reserved", "damaged", "inspection",
           "preorderCommitted", "incomingQuantity", "averageCostPaisa"
    FROM "InventoryBalance"
    WHERE "locationId" = ${input.locationId} AND "variantId" = ${input.variantId}
    FOR UPDATE`;

  const existing = rows[0];
  if (existing) return existing;

  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "locationId", "variantId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${input.locationId}, ${input.variantId}, now(), now())
    ON CONFLICT ("locationId", "variantId") DO NOTHING`;

  const created = await tx.$queryRaw<BalanceRow[]>`
    SELECT "id", "onHand", "reserved", "damaged", "inspection",
           "preorderCommitted", "incomingQuantity", "averageCostPaisa"
    FROM "InventoryBalance"
    WHERE "locationId" = ${input.locationId} AND "variantId" = ${input.variantId}
    FOR UPDATE`;

  const row = created[0];
  if (!row) throw AppError.internal("Inventory balance row could not be created");
  return row;
}

export async function applyStockMovement(tx: Tx, input: StockMovementInput): Promise<StockMovementResult> {
  const {
    onHandDelta = 0,
    reservedDelta = 0,
    damagedDelta = 0,
    inspectionDelta = 0,
    preorderCommittedDelta = 0,
    incomingDelta = 0,
  } = input;

  if (onHandDelta === 0 && reservedDelta === 0 && damagedDelta === 0 && inspectionDelta === 0 && preorderCommittedDelta === 0 && incomingDelta === 0) {
    throw AppError.validation("A stock movement must change at least one counter");
  }

  if (input.idempotencyKey) {
    const existing = await tx.inventoryMovement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        // The balance is looked up explicitly: movements are global, balances are per location.
        variant: { select: { id: true } },
      },
    });
    if (existing) {
      const rows = await tx.$queryRaw<BalanceRow[]>`
        SELECT "id", "onHand", "reserved", "damaged", "inspection",
               "preorderCommitted", "incomingQuantity", "averageCostPaisa"
        FROM "InventoryBalance"
        WHERE "locationId" = ${existing.locationId} AND "variantId" = ${existing.variantId}`;
      const balance = rows[0];
      return {
        movementId: existing.id,
        reused: true,
        balance: {
          onHand: balance?.onHand ?? 0,
          reserved: balance?.reserved ?? 0,
          damaged: balance?.damaged ?? 0,
          inspection: balance?.inspection ?? 0,
          preorderCommitted: balance?.preorderCommitted ?? 0,
          incomingQuantity: balance?.incomingQuantity ?? 0,
          averageCostPaisa: balance?.averageCostPaisa ?? 0,
          available: availableQuantity({
            onHand: balance?.onHand ?? 0,
            reserved: balance?.reserved ?? 0,
            damaged: balance?.damaged ?? 0,
            inspection: balance?.inspection ?? 0,
          }),
        },
      };
    }
  }

  const balance = await lockBalance(tx, { locationId: input.locationId, variantId: input.variantId });

  const next = {
    onHand: balance.onHand + onHandDelta,
    reserved: balance.reserved + reservedDelta,
    damaged: balance.damaged + damagedDelta,
    inspection: balance.inspection + inspectionDelta,
    preorderCommitted: balance.preorderCommitted + preorderCommittedDelta,
    incomingQuantity: balance.incomingQuantity + incomingDelta,
  };

  if (next.onHand < 0) {
    throw AppError.insufficientStock(
      `Not enough physical stock: ${balance.onHand} on hand, ${Math.abs(onHandDelta)} required`,
    );
  }
  for (const [key, value] of Object.entries(next)) {
    if (value < 0) {
      throw AppError.validation(`Stock counter "${key}" cannot become negative`);
    }
  }
  if (next.reserved > next.onHand - next.damaged - next.inspection && !input.allowNegativeAvailable) {
    throw AppError.insufficientStock("Reserved stock cannot exceed the quantity that is physically available");
  }

  // Weighted average cost: only positive on-hand movements with a known unit cost
  // change the average. Everything else keeps the current average.
  let averageCostPaisa = balance.averageCostPaisa;
  if (onHandDelta > 0 && input.unitCostPaisa != null) {
    averageCostPaisa = weightedAverageCostPaisa({
      oldQuantity: balance.onHand,
      oldAverageCostPaisa: balance.averageCostPaisa,
      receivedQuantity: onHandDelta,
      receivedUnitCostPaisa: input.unitCostPaisa,
    });
  }

  const unitCostForValue = input.unitCostPaisa ?? (onHandDelta > 0 ? balance.averageCostPaisa : balance.averageCostPaisa);
  const valueDeltaPaisa = onHandDelta === 0 ? 0 : onHandDelta * unitCostForValue;

  await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      onHand: next.onHand,
      reserved: next.reserved,
      damaged: next.damaged,
      inspection: next.inspection,
      preorderCommitted: next.preorderCommitted,
      incomingQuantity: next.incomingQuantity,
      averageCostPaisa,
      lastMovementAt: new Date(),
    },
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      businessId: input.businessId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: input.type,
      condition: input.condition ?? "SELLABLE",
      quantityDelta: onHandDelta,
      reservedDelta,
      damagedDelta,
      inspectionDelta,
      onHandAfter: next.onHand,
      reservedAfter: next.reserved,
      damagedAfter: next.damaged,
      inspectionAfter: next.inspection,
      unitCostPaisa: input.unitCostPaisa ?? null,
      valueDeltaPaisa,
      averageCostAfterPaisa: averageCostPaisa,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      reference: input.reference ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
      actorUserId: input.actorUserId ?? null,
      actorCustomerId: input.actorCustomerId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      preorderCommittedAfter: next.preorderCommitted,
      incomingAfter: next.incomingQuantity,
    },
  });

  return {
    movementId: movement.id,
    reused: false,
    balance: {
      ...next,
      averageCostPaisa,
      available: availableQuantity(next),
    },
  };
}

/** Ensure a balance row exists (used by product creation so inventory screens list every variant). */
export async function ensureBalance(tx: Tx, input: { locationId: string; variantId: string }): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "locationId", "variantId", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${input.locationId}, ${input.variantId}, now(), now())
    ON CONFLICT ("locationId", "variantId") DO NOTHING`;
}

export interface StockAdjustmentInput {
  variantId: string;
  locationId?: string;
  direction: "INCREASE" | "DECREASE";
  condition: StockConditionValue;
  quantity: number;
  reasonCode: string;
  note?: string | null;
  reference?: string | null;
  actorUserId: string;
  businessId: string;
}

/**
 * Manual stock correction. A reason is mandatory and the movement is recorded
 * with the actor, which is what makes inventory auditable.
 */
export async function recordStockAdjustment(input: StockAdjustmentInput): Promise<StockMovementResult & { adjustmentId: string }> {
  if (input.quantity <= 0) throw AppError.validation("Adjustment quantity must be greater than zero");

  const reason = await prisma.stockAdjustmentReason.findFirst({
    where: { businessId: input.businessId, code: input.reasonCode, isActive: true },
  });
  if (!reason) throw AppError.validation("Select a valid adjustment reason");
  if (reason.requiresNote && !input.note?.trim()) {
    throw AppError.validation(`A note is required for the reason "${reason.label}"`);
  }
  if (reason.direction !== "BOTH" && reason.direction !== input.direction) {
    throw AppError.validation(`The reason "${reason.label}" only allows ${reason.direction.toLowerCase()} adjustments`);
  }

  const locationId = input.locationId ?? (await defaultLocationId(input.businessId));
  const signedQuantity = input.direction === "INCREASE" ? input.quantity : -input.quantity;

  return withTransaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: { id: input.variantId, product: { businessId: input.businessId, deletedAt: null } },
      select: { id: true, sku: true, product: { select: { name: true } } },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    const movementType =
      input.condition === "DAMAGED"
        ? input.direction === "INCREASE"
          ? "DAMAGE_RECORDED"
          : "DAMAGE_RELEASED"
        : input.condition === "INSPECTION"
          ? input.direction === "INCREASE"
            ? "INSPECTION_IN"
            : "INSPECTION_OUT"
          : input.direction === "INCREASE"
            ? "ADJUSTMENT_INCREASE"
            : "ADJUSTMENT_DECREASE";

    const result = await applyStockMovement(tx, {
      businessId: input.businessId,
      locationId,
      variantId: input.variantId,
      type: movementType,
      onHandDelta: signedQuantity,
      damagedDelta: input.condition === "DAMAGED" ? signedQuantity : 0,
      inspectionDelta: input.condition === "INSPECTION" ? signedQuantity : 0,
      condition: input.condition,
      reason: input.reasonCode,
      note: input.note ?? null,
      reference: input.reference ?? null,
      actorUserId: input.actorUserId,
      sourceType: "StockAdjustment",
    });

    const adjustment = await tx.stockAdjustment.create({
      data: {
        businessId: input.businessId,
        locationId,
        variantId: input.variantId,
        reasonId: reason.id,
        reasonCode: input.reasonCode,
        direction: input.direction,
        condition: input.condition,
        quantity: input.quantity,
        note: input.note ?? null,
        reference: input.reference ?? null,
        actorUserId: input.actorUserId,
        inventoryMovementId: result.movementId,
      },
    });

    await recordAudit(
      {
        businessId: input.businessId,
        actorType: "USER",
        actorUserId: input.actorUserId,
        action: "inventory.adjusted",
        entityType: "Variant",
        entityId: input.variantId,
        summary: `${input.direction === "INCREASE" ? "Increased" : "Decreased"} ${input.condition.toLowerCase()} stock of ${variant.sku} by ${input.quantity} (${reason.label})`,
        before: { available: result.reused ? null : result.balance.available + signedQuantity * -1 },
        after: {
          available: result.balance.available,
          onHand: result.balance.onHand,
          averageCostPaisa: result.balance.averageCostPaisa,
        },
        changedFields: ["inventory"],
        reason: input.reasonCode,
      },
      tx,
    );

    return { ...result, adjustmentId: adjustment.id };
  });
}

export async function defaultLocationId(businessId: string): Promise<string> {
  const location = await prisma.inventoryLocation.findFirst({
    where: { businessId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!location) throw AppError.conflict("No active inventory location is configured");
  return location.id;
}

/** Idempotency guard for document-driven stock writes (receipts, dispatches). */
export async function findMovementByKey(key: string) {
  return prisma.inventoryMovement.findUnique({ where: { idempotencyKey: key } });
}

export { isUniqueConstraintError };
export type { Tx as InventoryTransactionClient };
