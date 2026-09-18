import "server-only";
import { prisma } from "@/lib/db/client";
import { availableQuantity } from "@/modules/inventory/service";
import { userDisplayNames } from "@/modules/users/queries";

/** Inventory read queries: balances, movement history and adjustment reasons. */

export interface InventoryRow {
  variantId: string;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
  locationName: string;
  onHand: number;
  reserved: number;
  damaged: number;
  inspection: number;
  preorderCommitted: number;
  incoming: number;
  available: number;
  averageCostPaisa: number;
  lastMovementAt: Date | null;
  isLowStock: boolean;
}

export async function listInventory(
  businessId: string,
  query: { search?: string; locationId?: string; lowStockOnly?: boolean; lowStockThreshold: number; skip: number; take: number; sortBy?: string; sortDir: "asc" | "desc" },
): Promise<{ rows: InventoryRow[]; total: number }> {
  const where = {
    variant: {
      product: { businessId, deletedAt: null },
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: "insensitive" as const } },
              { name: { contains: query.search, mode: "insensitive" as const } },
              { product: { name: { contains: query.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    ...(query.locationId ? { locationId: query.locationId } : {}),
  };

  const orderBy =
    query.sortBy === "sku"
      ? { variant: { sku: query.sortDir } }
      : query.sortBy === "onHand"
        ? { onHand: query.sortDir }
        : { updatedAt: query.sortDir };

  const [balances, total] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.take,
      include: {
        location: { select: { name: true } },
        variant: { select: { id: true, sku: true, name: true, product: { select: { id: true, name: true } } } },
      },
    }),
    prisma.inventoryBalance.count({ where }),
  ]);

  const rows: InventoryRow[] = balances
    .map((balance) => ({
      variantId: balance.variant.id,
      sku: balance.variant.sku,
      variantName: balance.variant.name,
      productId: balance.variant.product.id,
      productName: balance.variant.product.name,
      locationName: balance.location.name,
      onHand: balance.onHand,
      reserved: balance.reserved,
      damaged: balance.damaged,
      inspection: balance.inspection,
      preorderCommitted: balance.preorderCommitted,
      incoming: balance.incomingQuantity,
      available: availableQuantity(balance),
      averageCostPaisa: balance.averageCostPaisa,
      lastMovementAt: balance.lastMovementAt,
      isLowStock: availableQuantity(balance) <= query.lowStockThreshold,
    }))
    .filter((row) => !query.lowStockOnly || row.isLowStock);

  return { rows, total };
}

export async function getVariantInventoryDetail(businessId: string, variantId: string) {
  const variant = await prisma.variant.findFirst({
    where: { id: variantId, product: { businessId } },
    include: {
      product: { select: { id: true, name: true, status: true, isPreorderEnabled: true } },
      inventory: { include: { location: { select: { id: true, name: true } } } },
      attributeValues: {
        include: {
          attribute: { select: { name: true } },
          attributeValue: { select: { value: true, colorHex: true } },
        },
      },
      preorders: { orderBy: { priorityAt: "asc" }, take: 20 },
    },
  });
  if (!variant) return null;

  const [movementRows, adjustmentRows] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.stockAdjustment.findMany({
      where: { variantId },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const names = await userDisplayNames([
    ...movementRows.map((movement) => movement.actorUserId),
    ...adjustmentRows.map((adjustment) => adjustment.actorUserId),
  ]);

  return {
    variant,
    movements: movementRows.map((movement) => ({ ...movement, actorName: movement.actorUserId ? (names.get(movement.actorUserId) ?? null) : null })),
    adjustments: adjustmentRows.map((adjustment) => ({ ...adjustment, actorName: adjustment.actorUserId ? (names.get(adjustment.actorUserId) ?? null) : null })),
  };
}

export async function listAdjustments(
  businessId: string,
  query: { search?: string; skip: number; take: number },
) {
  const where = {
    businessId,
    ...(query.search
      ? {
          OR: [
            { reasonCode: { contains: query.search, mode: "insensitive" as const } },
            { note: { contains: query.search, mode: "insensitive" as const } },
            { variant: { sku: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: query.skip,
      take: query.take,
      include: {
        variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
      },
    }),
    prisma.stockAdjustment.count({ where }),
  ]);

  const names = await userDisplayNames(rows.map((adjustment) => adjustment.actorUserId));
  const adjustments = rows.map((adjustment) => ({
    ...adjustment,
    actorName: adjustment.actorUserId ? (names.get(adjustment.actorUserId) ?? null) : null,
  }));

  return { adjustments, total };
}

export async function listAdjustmentReasons(businessId: string) {
  return prisma.stockAdjustmentReason.findMany({
    where: { businessId, isActive: true },
    orderBy: { label: "asc" },
  });
}

export async function listLocations(businessId: string) {
  return prisma.inventoryLocation.findMany({
    where: { businessId, isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

/** Variants for pickers (product create/edit, purchase orders, adjustments). */
export async function searchVariants(businessId: string, search?: string, take = 40) {
  return prisma.variant.findMany({
    where: {
      product: { businessId, deletedAt: null },
      status: "ACTIVE",
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
              { product: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { sku: "asc" },
    take,
    select: {
      id: true,
      sku: true,
      name: true,
      costPaisa: true,
      priceOverridePaisa: true,
      product: { select: { id: true, name: true } },
      inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true } },
    },
  });
}
