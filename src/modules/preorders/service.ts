import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { applyStockMovement, availableQuantity } from "@/modules/inventory/service";

/**
 * Preorders.
 *
 * A preorder commitment records stock that has been promised to a customer but
 * is not on hand yet. Commitments never make stock negative; they are tracked in
 * the `preorderCommitted` counter, which is separate from reserved/on-hand.
 *
 * When new stock arrives the oldest eligible commitment is served first (FIFO on
 * `priorityAt`). Allocating a commitment moves quantity from `preorderCommitted`
 * into `reserved`, which is what prevents the same units from being promised to
 * two customers.
 */

export interface PreorderActor {
  userId: string;
  businessId: string;
  actorLabel?: string;
}

export interface CreateCommitmentInput {
  businessId: string;
  locationId: string;
  variantId: string;
  orderId: string;
  orderItemId: string;
  quantity: number;
  expectedAt?: Date | null;
  note?: string | null;
  createdByUserId?: string | null;
}

/**
 * Create the commitment for a shortfall on an order line. Called by the order
 * service when a customer orders more than the sellable quantity.
 */
export async function createPreorderCommitment(tx: Prisma.TransactionClient, input: CreateCommitmentInput) {
  if (input.quantity <= 0) throw AppError.validation("A preorder commitment needs a positive quantity");

  const existing = await tx.preorderCommitment.findUnique({ where: { orderItemId: input.orderItemId } });
  if (existing) {
    // Idempotent: extend the existing commitment instead of creating a second one.
    // The committed counter must move with it or the balance and queue drift apart.
    await applyStockMovement(tx, {
      businessId: input.businessId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: "CORRECTION",
      preorderCommittedDelta: input.quantity,
      sourceType: "PreorderCommitment",
      sourceId: input.orderItemId,
      reason: "preorder_extended",
      actorUserId: input.createdByUserId ?? null,
    });

    return tx.preorderCommitment.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + input.quantity,
        status: existing.allocatedQuantity >= existing.quantity + input.quantity ? "ALLOCATED" : "OPEN",
      },
    });
  }

  await applyStockMovement(tx, {
    businessId: input.businessId,
    locationId: input.locationId,
    variantId: input.variantId,
    type: "CORRECTION",
    preorderCommittedDelta: input.quantity,
    sourceType: "PreorderCommitment",
    sourceId: input.orderItemId,
    reason: "preorder_created",
    actorUserId: input.createdByUserId ?? null,
  });

  return tx.preorderCommitment.create({
    data: {
      businessId: input.businessId,
      locationId: input.locationId,
      variantId: input.variantId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      quantity: input.quantity,
      expectedAt: input.expectedAt ?? null,
      note: input.note ?? null,
    },
  });
}

export interface AllocationResult {
  allocated: number;
  commitments: Array<{ commitmentId: string; orderId: string; orderItemId: string; quantity: number; status: string }>;
  skipped: number;
}

/**
 * Allocate received stock to the oldest open preorder commitments for a variant.
 *
 * Runs inside the caller's transaction. The reservation movement is applied per
 * commitment, so if the stock is not actually available the allocation fails
 * instead of silently promising units that do not exist.
 */
export async function allocatePreorders(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    locationId: string;
    variantId: string;
    quantity: number;
    actorUserId?: string | null;
    note?: string | null;
  },
): Promise<AllocationResult> {
  if (input.quantity <= 0) throw AppError.validation("Enter a quantity greater than zero to allocate");

  const commitments = await tx.preorderCommitment.findMany({
    where: {
      businessId: input.businessId,
      variantId: input.variantId,
      status: { in: ["OPEN", "PARTIALLY_ALLOCATED"] },
    },
    orderBy: [{ priorityAt: "asc" }, { createdAt: "asc" }],
  });

  let remaining = input.quantity;
  let allocated = 0;
  const results: AllocationResult["commitments"] = [];

  for (const commitment of commitments) {
    if (remaining <= 0) break;
    const outstanding = commitment.quantity - commitment.allocatedQuantity;
    if (outstanding <= 0) continue;
    const take = Math.min(outstanding, remaining);

    const movement = await applyStockMovement(tx, {
      businessId: input.businessId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: "PREORDER_ALLOCATION",
      reservedDelta: take,
      preorderCommittedDelta: -take,
      sourceType: "PreorderCommitment",
      sourceId: commitment.id,
      reference: commitment.id,
      note: input.note ?? null,
      actorUserId: input.actorUserId ?? null,
    });

    await tx.preorderAllocation.create({
      data: {
        preorderCommitmentId: commitment.id,
        quantity: take,
        inventoryMovementId: movement.movementId,
        createdByUserId: input.actorUserId ?? null,
        note: input.note ?? null,
      },
    });

    const totalAllocated = commitment.allocatedQuantity + take;
    const status = totalAllocated >= commitment.quantity ? "ALLOCATED" : "PARTIALLY_ALLOCATED";

    await tx.preorderCommitment.update({
      where: { id: commitment.id },
      data: { allocatedQuantity: totalAllocated, status },
    });

    results.push({
      commitmentId: commitment.id,
      orderId: commitment.orderId,
      orderItemId: commitment.orderItemId,
      quantity: take,
      status,
    });

    allocated += take;
    remaining -= take;
  }

  return { allocated, commitments: results, skipped: remaining };
}

/** Operator triggered allocation for one variant (used from the preorder queue). */
export async function allocatePreorderQueue(
  actor: PreorderActor,
  input: { variantId: string; locationId?: string; quantity: number; note?: string | null },
): Promise<AllocationResult> {
  return withTransaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: { id: input.variantId, product: { businessId: actor.businessId } },
      select: { id: true, sku: true },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    const locationId =
      input.locationId ??
      (
        await tx.inventoryLocation.findFirst({
          where: { businessId: actor.businessId, isActive: true },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: { id: true },
        })
      )?.id;
    if (!locationId) throw AppError.conflict("No active inventory location is configured");

    // Allocate at most what is physically available: the operator asks for a
    // quantity, the queue serves what the shelf actually holds and reports the
    // rest as skipped. Requesting more than exists must not be an error, but it
    // must also never reserve stock that is not there.
    const balanceRows = await tx.$queryRaw<Array<{ onHand: number; reserved: number; damaged: number; inspection: number }>>`
      SELECT "onHand", "reserved", "damaged", "inspection"
      FROM "InventoryBalance"
      WHERE "locationId" = ${locationId} AND "variantId" = ${input.variantId}
      FOR UPDATE`;
    const balance = balanceRows[0];
    const available = balance ? availableQuantity(balance) : 0;
    const toAllocate = Math.min(input.quantity, Math.max(available, 0));

    const result =
      toAllocate > 0
        ? await allocatePreorders(tx, {
            businessId: actor.businessId,
            locationId,
            variantId: input.variantId,
            quantity: toAllocate,
            actorUserId: actor.userId,
            note: input.note ?? null,
          })
        : { allocated: 0, commitments: [], skipped: 0 };

    const skipped = result.skipped + (input.quantity - toAllocate);

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel ?? null,
        action: "preorder.allocated",
        entityType: "Variant",
        entityId: input.variantId,
        summary: `Allocated ${result.allocated} unit(s) of ${variant.sku} to ${result.commitments.length} preorder(s)`,
        after: { allocated: result.allocated, skipped, commitments: result.commitments.length, available },
        changedFields: ["preorderCommitted", "reserved"],
      },
    });

    return { ...result, skipped };
  });
}

export async function cancelPreorderCommitment(actor: PreorderActor, commitmentId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw AppError.validation("Give a reason for cancelling the preorder commitment");

  await withTransaction(async (tx) => {
    const commitment = await tx.preorderCommitment.findFirst({
      where: { id: commitmentId, businessId: actor.businessId },
    });
    if (!commitment) throw AppError.notFound("Preorder commitment not found");
    if (commitment.status === "CANCELLED") throw AppError.invalidState("This commitment is already cancelled");
    if (commitment.status === "FULFILLED") throw AppError.invalidState("A fulfilled commitment cannot be cancelled");

    const unallocated = commitment.quantity - commitment.allocatedQuantity;
    if (unallocated > 0 || commitment.allocatedQuantity > 0) {
      await applyStockMovement(tx, {
        businessId: actor.businessId,
        locationId: commitment.locationId,
        variantId: commitment.variantId,
        type: "CORRECTION",
        preorderCommittedDelta: -unallocated,
        // Releasing the allocation returns the units to sellable stock.
        reservedDelta: -commitment.allocatedQuantity,
        sourceType: "PreorderCommitment",
        sourceId: commitment.id,
        reason: "preorder_cancelled",
        note: reason,
        actorUserId: actor.userId,
      });
    }

    await tx.preorderCommitment.update({
      where: { id: commitment.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel ?? null,
        action: "preorder.cancelled",
        entityType: "PreorderCommitment",
        entityId: commitment.id,
        summary: `Cancelled preorder commitment of ${commitment.quantity} unit(s)`,
        reason,
        before: { status: commitment.status, allocatedQuantity: commitment.allocatedQuantity },
        after: { status: "CANCELLED" },
        changedFields: ["status", "cancelledAt", "cancelReason"],
      },
    });
  });
}

/** Mark a commitment fulfilled once its order line has been dispatched. */
export async function fulfilPreorderCommitment(tx: Prisma.TransactionClient, orderItemId: string): Promise<void> {
  await tx.preorderCommitment.updateMany({
    where: { orderItemId, status: { in: ["ALLOCATED", "PARTIALLY_ALLOCATED"] } },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });
}
