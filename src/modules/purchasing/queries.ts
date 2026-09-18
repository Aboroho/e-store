import "server-only";
import { prisma } from "@/lib/db/client";
import { userDisplayNames } from "@/modules/users/queries";

/** Purchase order read queries. */

export async function listPurchaseOrders(
  businessId: string,
  query: { search?: string; status?: string; supplierId?: string; skip: number; take: number; sortDir: "asc" | "desc" },
) {
  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "DRAFT" } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" as const } },
            { supplier: { name: { contains: query.search, mode: "insensitive" as const } } },
            { note: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: query.sortDir },
      skip: query.skip,
      take: query.take,
      include: {
        supplier: { select: { id: true, name: true } },
        items: { select: { orderedQuantity: true, receivedQuantity: true } },
        _count: { select: { receipts: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { orders, total };
}

export async function getPurchaseOrder(businessId: string, purchaseOrderId: string) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, businessId },
    include: {
      supplier: true,
      items: {
        orderBy: { position: "asc" },
        include: {
          variant: { select: { id: true, sku: true, name: true, product: { select: { id: true, name: true } } } },
          receiptItems: { include: { goodsReceipt: { select: { code: true, receivedAt: true } } } },
        },
      },
      receipts: {
        orderBy: { receivedAt: "desc" },
        include: { items: { select: { quantity: true, lineCostPaisa: true } } },
      },
      expenses: true,
      payments: { orderBy: { paidAt: "desc" } },
    },
  });

  if (!order) return null;

  const names = await userDisplayNames(order.receipts.map((receipt) => receipt.receivedByUserId));
  return {
    ...order,
    receipts: order.receipts.map((receipt) => ({
      ...receipt,
      receivedByName: receipt.receivedByUserId ? (names.get(receipt.receivedByUserId) ?? null) : null,
    })),
  };
}

export async function listSuppliers(businessId: string, search?: string) {
  return prisma.supplier.findMany({
    where: {
      businessId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { contactName: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { purchaseOrders: true } },
    },
  });
}

export async function supplierSummaries(businessId: string) {
  const suppliers = await prisma.supplier.findMany({
    where: { businessId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, paymentTerms: true },
  });

  const totals = await prisma.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: { businessId, status: { not: "CANCELLED" } },
    _sum: { totalPaisa: true, paidPaisa: true },
  });

  const bySupplier = new Map(totals.map((total) => [total.supplierId, total]));
  return suppliers.map((supplier) => {
    const total = bySupplier.get(supplier.id);
    const orderedPaisa = total?._sum.totalPaisa ?? 0;
    const paidPaisa = total?._sum.paidPaisa ?? 0;
    return { ...supplier, orderedPaisa, paidPaisa, outstandingPaisa: orderedPaisa - paidPaisa };
  });
}
