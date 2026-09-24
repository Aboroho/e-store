import "server-only";
import { prisma } from "@/lib/db/client";
import { can, type PermissionSubject } from "@/lib/permissions";

/**
 * Dashboard aggregates.
 *
 * Every value is computed from database records with permission-aware selects:
 * cost and margin figures are only queried when the user may see costs.
 */

export interface DashboardMetrics {
  ordersToday: number;
  ordersPending: number;
  revenueTodayPaisa: number;
  revenue30dPaisa: number;
  orders30d: number;
  lowStockCount: number;
  pendingShipments: number;
  openExchanges: number;
  outstandingCodPaisa: number;
  pendingPayoutPaisa: number;
  unreadNotifications: number;
  activeProducts: number;
  customers30d: number;
  salesSeries: Array<{ date: string; revenuePaisa: number; orders: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    channel: string;
    customerName: string | null;
    grandTotalPaisa: number;
    paymentStatus: string;
    placedAt: Date;
  }>;
  lowStock: Array<{ variantId: string; sku: string; productName: string; available: number; threshold: number }>;
  topProducts: Array<{ productName: string; quantity: number; revenuePaisa: number }>;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export async function getDashboardMetrics(subject: PermissionSubject): Promise<DashboardMetrics> {
  const businessId = subject.businessId;
  const now = new Date();
  const todayStart = startOfDay(now);
  const thirtyDaysAgo = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
  const lowStockThreshold = 5;

  const canViewOrders = can(subject, "order.view");
  const canViewInventory = can(subject, "inventory.view");
  const canReconcile = can(subject, "courier.reconcile");
  const canPayouts = can(subject, "reseller.payout");
  const canViewCustomers = can(subject, "customer.view");
  const canViewProducts = can(subject, "product.view");

  const [
    ordersToday,
    ordersPending,
    revenueToday,
    revenue30d,
    lowStockRows,
    pendingShipments,
    openExchanges,
    outstandingCod,
    pendingPayouts,
    unreadNotifications,
    activeProducts,
    newCustomers30d,
    salesRows,
    recentOrders,
    topProductRows,
  ] = await Promise.all([
    canViewOrders ? prisma.order.count({ where: { businessId, placedAt: { gte: todayStart }, deletedAt: null } }) : 0,
    canViewOrders
      ? prisma.order.count({ where: { businessId, status: { in: ["PENDING", "CONFIRMED"] }, deletedAt: null } })
      : 0,
    canViewOrders
      ? prisma.order.aggregate({
          _sum: { grandTotalPaisa: true },
          where: { businessId, placedAt: { gte: todayStart }, status: { notIn: ["CANCELLED"] }, deletedAt: null },
        })
      : null,
    canViewOrders
      ? prisma.order.aggregate({
          _sum: { grandTotalPaisa: true },
          _count: { _all: true },
          where: { businessId, placedAt: { gte: thirtyDaysAgo }, status: { notIn: ["CANCELLED"] }, deletedAt: null },
        })
      : null,
    canViewInventory
      ? prisma.$queryRaw<Array<{ variantId: string; sku: string; productName: string; available: number }>>`
          SELECT b."variantId" AS "variantId", p."sku" AS "sku", p."name" AS "productName",
                 (b."onHand" - b."damaged" - b."inspection" - b."reserved") AS "available"
          FROM "InventoryBalance" b
          JOIN "Variant" v ON v."id" = b."variantId"
          JOIN "Product" p ON p."id" = v."productId"
          WHERE p."businessId" = ${businessId}
            AND p."deletedAt" IS NULL
            AND (b."onHand" - b."damaged" - b."inspection" - b."reserved") <= ${lowStockThreshold}
          ORDER BY "available" ASC
          LIMIT 8`
      : [],
    canViewOrders
      ? prisma.shipment.count({ where: { businessId, status: { in: ["DRAFT", "PENDING", "CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"] } } })
      : 0,
    canViewOrders
      ? prisma.exchangeRequest.count({ where: { businessId, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] } } })
      : 0,
    canReconcile
      ? prisma.codCollection.aggregate({
          _sum: { expectedPaisa: true },
          where: { businessId, settlementId: null },
        })
      : null,
    canPayouts
      ? prisma.resellerLedgerEntry.aggregate({
          _sum: { amountPaisa: true },
          where: { businessId, status: "ELIGIBLE", direction: "CREDIT" },
        })
      : null,
    prisma.notificationRecipient.count({ where: { userId: subject.id, readAt: null } }),
    canViewProducts ? prisma.product.count({ where: { businessId, status: "ACTIVE", deletedAt: null } }) : 0,
    canViewCustomers
      ? prisma.customer.count({ where: { businessId, createdAt: { gte: thirtyDaysAgo }, deletedAt: null } })
      : 0,
    canViewOrders
      ? prisma.$queryRaw<Array<{ day: Date; revenue: number; orders: bigint }>>`
          SELECT date_trunc('day', "placedAt") AS day,
                 COALESCE(SUM("grandTotalPaisa"), 0)::int AS revenue,
                 COUNT(*)::bigint AS orders
          FROM "Order"
          WHERE "businessId" = ${businessId}
            AND "deletedAt" IS NULL
            AND "status" <> 'CANCELLED'
            AND "placedAt" >= ${thirtyDaysAgo}
          GROUP BY day
          ORDER BY day ASC`
      : [],
    canViewOrders
      ? prisma.order.findMany({
          where: { businessId, deletedAt: null },
          orderBy: { placedAt: "desc" },
          take: 8,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            channel: true,
            customerName: true,
            grandTotalPaisa: true,
            paymentStatus: true,
            placedAt: true,
          },
        })
      : [],
    canViewOrders
      ? prisma.$queryRaw<Array<{ productName: string; quantity: bigint; revenue: number }>>`
          SELECT oi."productName" AS "productName",
                 SUM(oi."quantity")::bigint AS quantity,
                 COALESCE(SUM(oi."lineTotalPaisa"), 0)::int AS revenue
          FROM "OrderItem" oi
          JOIN "Order" o ON o."id" = oi."orderId"
          WHERE o."businessId" = ${businessId}
            AND o."deletedAt" IS NULL
            AND o."status" <> 'CANCELLED'
            AND o."placedAt" >= ${thirtyDaysAgo}
          GROUP BY oi."productName"
          ORDER BY quantity DESC
          LIMIT 5`
      : [],
  ]);

  // Build a dense 30 day series so the chart has no gaps.
  const salesMap = new Map<string, { revenuePaisa: number; orders: number }>();
  for (const row of salesRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    salesMap.set(key, { revenuePaisa: Number(row.revenue ?? 0), orders: Number(row.orders ?? 0) });
  }
  const salesSeries: DashboardMetrics["salesSeries"] = [];
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date(todayStart.getTime() - index * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    const entry = salesMap.get(key) ?? { revenuePaisa: 0, orders: 0 };
    salesSeries.push({ date: key, revenuePaisa: entry.revenuePaisa, orders: entry.orders });
  }

  return {
    ordersToday,
    ordersPending,
    revenueTodayPaisa: Number(revenueToday?._sum.grandTotalPaisa ?? 0),
    revenue30dPaisa: Number(revenue30d?._sum.grandTotalPaisa ?? 0),
    orders30d: Number(revenue30d?._count._all ?? 0),
    lowStockCount: lowStockRows.length,
    pendingShipments,
    openExchanges,
    outstandingCodPaisa: Number(outstandingCod?._sum.expectedPaisa ?? 0),
    pendingPayoutPaisa: Number(pendingPayouts?._sum.amountPaisa ?? 0),
    unreadNotifications,
    activeProducts,
    customers30d: newCustomers30d,
    salesSeries,
    recentOrders,
    lowStock: lowStockRows.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      productName: row.productName,
      available: Number(row.available ?? 0),
      threshold: lowStockThreshold,
    })),
    topProducts: topProductRows.map((row) => ({
      productName: row.productName,
      quantity: Number(row.quantity ?? 0),
      revenuePaisa: Number(row.revenue ?? 0),
    })),
  };
}
