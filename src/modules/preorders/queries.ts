import "server-only";
import { prisma } from "@/lib/db/client";

/** Preorder queue queries. */

export async function listPreorderCommitments(
  businessId: string,
  query: { status?: string; search?: string; skip: number; take: number },
) {
  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "OPEN" } : {}),
    ...(query.search
      ? {
          OR: [
            { variant: { sku: { contains: query.search, mode: "insensitive" as const } } },
            { variant: { product: { name: { contains: query.search, mode: "insensitive" as const } } } },
            { order: { orderNumber: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [commitments, total, summary] = await Promise.all([
    prisma.preorderCommitment.findMany({
      where,
      orderBy: [{ priorityAt: "asc" }],
      skip: query.skip,
      take: query.take,
      include: {
        variant: { select: { id: true, sku: true, name: true, product: { select: { id: true, name: true } } } },
        order: { select: { id: true, orderNumber: true, customerName: true, status: true } },
        allocations: { select: { quantity: true, createdAt: true } },
      },
    }),
    prisma.preorderCommitment.count({ where }),
    prisma.preorderCommitment.groupBy({
      by: ["status"],
      where: { businessId },
      _count: { _all: true },
      _sum: { quantity: true, allocatedQuantity: true },
    }),
  ]);

  return { commitments, total, summary };
}

/** Variants that have open commitments, with the outstanding quantity per variant. */
export async function preorderBacklog(businessId: string) {
  const rows = await prisma.preorderCommitment.findMany({
    where: { businessId, status: { in: ["OPEN", "PARTIALLY_ALLOCATED"] } },
    select: {
      variantId: true,
      quantity: true,
      allocatedQuantity: true,
      variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
    },
  });

  const byVariant = new Map<
    string,
    { variantId: string; sku: string; variantName: string; productName: string; outstanding: number; commitments: number }
  >();
  for (const row of rows) {
    const outstanding = row.quantity - row.allocatedQuantity;
    if (outstanding <= 0) continue;
    const entry = byVariant.get(row.variantId) ?? {
      variantId: row.variantId,
      sku: row.variant.sku,
      variantName: row.variant.name,
      productName: row.variant.product.name,
      outstanding: 0,
      commitments: 0,
    };
    entry.outstanding += outstanding;
    entry.commitments += 1;
    byVariant.set(row.variantId, entry);
  }

  return [...byVariant.values()].sort((a, b) => b.outstanding - a.outstanding);
}
