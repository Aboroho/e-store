import "server-only";
import { prisma } from "@/lib/db/client";
import { userDisplayNames } from "@/modules/users/queries";

/** Order read queries for the admin screens and the REST API. */

const SORT_COLUMNS = {
  placedAt: "placedAt",
  orderNumber: "orderNumber",
  grandTotalPaisa: "grandTotalPaisa",
  duePaisa: "duePaisa",
  updatedAt: "updatedAt",
} as const;

const LIST_INCLUDE = {
  items: {
    orderBy: { position: "asc" as const },
    select: { id: true, productName: true, variantName: true, sku: true, quantity: true, lineTotalPaisa: true, status: true, isPreorder: true },
  },
  shipments: { select: { id: true, status: true, trackingCode: true, providerCode: true, internalCode: true } },
} as const;

export interface OrderListQuery {
  search?: string;
  status?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  channel?: string;
  storefrontId?: string;
  customerId?: string;
  resellerId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  skip?: number;
  take?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export async function listOrders(businessId: string, query: OrderListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? query.take ?? 20));
  const skip = query.skip ?? (page - 1) * pageSize;
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  const sortBy = query.sortBy && SORT_COLUMNS[query.sortBy as keyof typeof SORT_COLUMNS] ? (query.sortBy as keyof typeof SORT_COLUMNS) : "placedAt";

  const where = {
    businessId,
    deletedAt: null,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PENDING" } : {}),
    ...(query.paymentStatus && query.paymentStatus !== "ALL" ? { paymentStatus: query.paymentStatus as "UNPAID" } : {}),
    ...(query.fulfillmentStatus && query.fulfillmentStatus !== "ALL" ? { fulfillmentStatus: query.fulfillmentStatus as "UNFULFILLED" } : {}),
    ...(query.channel && query.channel !== "ALL" ? { channel: query.channel as "ADMIN" } : {}),
    ...(query.storefrontId ? { storefrontId: query.storefrontId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.resellerId ? { resellerId: query.resellerId } : {}),
    ...(query.from || query.to
      ? { placedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { orderNumber: { contains: query.search, mode: "insensitive" as const } },
            { customerName: { contains: query.search, mode: "insensitive" as const } },
            { customerPhone: { contains: query.search, mode: "insensitive" as const } },
            { sourceReference: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { [sortBy]: sortDir }, skip, take: pageSize, include: LIST_INCLUDE }),
    prisma.order.count({ where }),
  ]);

  return { rows: orders, orders, total, page, pageSize };
}

export async function orderStats(businessId: string) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [open, awaitingDispatch, today, unpaid, preorderOrders, refundQueue] = await Promise.all([
    prisma.order.count({ where: { businessId, deletedAt: null, status: { in: ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP"] } } }),
    prisma.order.count({ where: { businessId, deletedAt: null, status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"] } } }),
    prisma.order.count({ where: { businessId, deletedAt: null, placedAt: { gte: dayStart } } }),
    prisma.order.aggregate({ where: { businessId, deletedAt: null, duePaisa: { gt: 0 }, status: { notIn: ["CANCELLED"] } }, _sum: { duePaisa: true } }),
    prisma.order.count({ where: { businessId, deletedAt: null, items: { some: { isPreorder: true, status: { in: ["PREORDER_PENDING"] } } } } }),
    prisma.refund.count({ where: { businessId, status: { in: ["REQUESTED", "PROCESSING"] } } }),
  ]);

  return {
    open,
    awaitingDispatch,
    today,
    unpaidDuePaisa: unpaid._sum.duePaisa ?? 0,
    preorderOrders,
    refundQueue,
    // Filled in by the reports step; kept here so the tile has one source of truth.
    salesPaisa: 0,
    collectedPaisa: 0,
  };
}

export async function getOrderDetail(businessId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: {
          reservation: true,
          preorder: true,
          exchangeItems: { select: { id: true, direction: true, quantity: true, exchangeRequestId: true } },
        },
      },
      adjustments: { orderBy: { createdAt: "asc" } },
      addresses: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: {
        orderBy: { createdAt: "desc" },
        include: { refunds: { orderBy: { createdAt: "desc" } }, attempts: { orderBy: { createdAt: "desc" } } },
      },
      refunds: { orderBy: { createdAt: "desc" } },
      exchanges: { orderBy: { createdAt: "desc" }, include: { items: true } },
      shipments: {
        orderBy: { createdAt: "desc" },
        include: {
          statusHistory: { orderBy: { recordedAt: "desc" } },
          charges: { orderBy: { createdAt: "desc" } },
          codCollection: true,
          settlementEntries: true,
        },
      },
      customer: { select: { id: true, name: true, phone: true, email: true, status: true, totalOrders: true, totalSpentPaisa: true, districtCode: true, addressLine: true, area: true } },
      reseller: { select: { id: true, name: true, phone: true } },
      storefront: { select: { id: true, name: true, code: true } },
    },
  });
  if (!order) return null;

  const names = await userDisplayNames([
    ...order.statusHistory.map((entry) => entry.actorUserId),
    order.createdByUserId,
    ...order.shipments.flatMap((shipment) => shipment.charges.map((charge) => charge.recordedByUserId)),
  ]);

  const preorder = order.items
    .filter((item) => item.preorder)
    .map((item) => ({ ...item.preorder!, sku: item.sku, productName: item.productName }));
  const openPreorderUnits = preorder
    .filter((entry) => entry.status === "OPEN" || entry.status === "PARTIALLY_ALLOCATED")
    .reduce((total, entry) => total + (entry.quantity - entry.allocatedQuantity), 0);
  const paymentAttempts = order.payments.flatMap((payment) => payment.attempts.map((attempt) => ({ ...attempt, method: payment.method })));

  return {
    order: {
      ...order,
      statusHistory: order.statusHistory.map((entry) => ({
        ...entry,
        actorName: entry.actorUserId ? (names.get(entry.actorUserId) ?? null) : null,
      })),
      createdByName: order.createdByUserId ? (names.get(order.createdByUserId) ?? null) : null,
    },
    shipments: order.shipments.map((shipment) => ({
      ...shipment,
      charges: shipment.charges.map((charge) => ({
        ...charge,
        recordedByName: charge.recordedByUserId ? (names.get(charge.recordedByUserId) ?? null) : null,
      })),
    })),
    preorder,
    openPreorderUnits,
    paymentAttempts,
    paidPaisa: order.payments.filter((payment) => payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED").reduce((total, payment) => total + payment.paidPaisa, 0),
  };
}

export async function listShipments(
  businessId: string,
  query: { search?: string; status?: string; providerCode?: string; page?: number; pageSize?: number; skip?: number; take?: number; sortBy?: string; sortDir?: "asc" | "desc" },
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? query.take ?? 20));
  const skip = query.skip ?? (page - 1) * pageSize;

  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "PENDING" } : {}),
    ...(query.providerCode && query.providerCode !== "ALL" ? { providerCode: query.providerCode as "MANUAL" } : {}),
    ...(query.search
      ? {
          OR: [
            { internalCode: { contains: query.search, mode: "insensitive" as const } },
            { trackingCode: { contains: query.search, mode: "insensitive" as const } },
            { recipientName: { contains: query.search, mode: "insensitive" as const } },
            { recipientPhone: { contains: query.search, mode: "insensitive" as const } },
            { order: { orderNumber: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { createdAt: query.sortDir === "asc" ? "asc" : "desc" },
      skip,
      take: pageSize,
      include: {
        order: { select: { id: true, orderNumber: true, status: true, customerName: true } },
        courier: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.shipment.count({ where }),
  ]);

  return { rows, shipments: rows, total, page, pageSize };
}

export async function shipmentStats(businessId: string) {
  const [inFlight, delivered, returned, exceptions] = await Promise.all([
    prisma.shipment.count({ where: { businessId, status: { in: ["PENDING", "CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"] } } }),
    prisma.shipment.count({ where: { businessId, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] } } }),
    prisma.shipment.count({ where: { businessId, status: "RETURNED" } }),
    prisma.shipment.count({ where: { businessId, status: { in: ["FAILED", "EXCEPTION"] } } }),
  ]);
  return { inFlight, delivered, returned, exceptions };
}

export async function getShipmentDetail(businessId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, businessId },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          customerName: true,
          customerPhone: true,
          grandTotalPaisa: true,
          items: { select: { id: true, productName: true, variantName: true, sku: true, quantity: true } },
        },
      },
      exchange: { select: { id: true, exchangeNumber: true, status: true } },
      courier: { select: { id: true, code: true, name: true, isEnabled: true } },
      statusHistory: { orderBy: { recordedAt: "desc" } },
      charges: { orderBy: { createdAt: "desc" } },
      codCollection: true,
      settlementEntries: { include: { settlement: { select: { reference: true, status: true } } } },
      outbox: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, attempts: true, lastError: true, availableAt: true, processedAt: true } },
    },
  });
  if (!shipment) return null;

  const names = await userDisplayNames([
    ...shipment.statusHistory.map((entry) => entry.actorUserId),
    ...shipment.charges.map((charge) => charge.recordedByUserId),
  ]);

  return {
    ...shipment,
    statusHistory: shipment.statusHistory.map((entry) => ({
      ...entry,
      actorName: entry.actorUserId ? (names.get(entry.actorUserId) ?? null) : null,
    })),
    charges: shipment.charges.map((charge) => ({
      ...charge,
      recordedByName: charge.recordedByUserId ? (names.get(charge.recordedByUserId) ?? null) : null,
    })),
  };
}

export async function listExchanges(
  businessId: string,
  query: { search?: string; status?: string; page?: number; pageSize?: number; skip?: number; take?: number },
) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? query.take ?? 20));
  const skip = query.skip ?? (page - 1) * pageSize;

  const where = {
    businessId,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "REQUESTED" } : {}),
    ...(query.search
      ? {
          OR: [
            { exchangeNumber: { contains: query.search, mode: "insensitive" as const } },
            { reasonCode: { contains: query.search, mode: "insensitive" as const } },
            { order: { orderNumber: { contains: query.search, mode: "insensitive" as const } } },
            { order: { customerPhoneNormalized: { contains: query.search } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.exchangeRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        order: { select: { id: true, orderNumber: true, customerName: true, customerPhone: true, deliveredAt: true } },
        items: { select: { id: true, direction: true, sku: true, productName: true, quantity: true, inspectionOutcome: true } },
      },
    }),
    prisma.exchangeRequest.count({ where }),
  ]);

  return { rows, exchanges: rows, total, page, pageSize };
}

export async function exchangeStats(businessId: string) {
  const [requested, inTransit, completed, payable] = await Promise.all([
    prisma.exchangeRequest.count({ where: { businessId, status: "REQUESTED" } }),
    prisma.exchangeRequest.count({ where: { businessId, status: { in: ["APPROVED", "IN_TRANSIT", "RECEIVED", "INSPECTED"] } } }),
    prisma.exchangeRequest.count({ where: { businessId, status: "COMPLETED" } }),
    prisma.exchangeRequest.aggregate({ where: { businessId, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] }, differencePaisa: { gt: 0 } }, _sum: { differencePaisa: true } }),
  ]);
  return { requested, inTransit, completed, payablePaisa: payable._sum.differencePaisa ?? 0 };
}

export async function getExchangeDetail(businessId: string, exchangeId: string) {
  const exchange = await prisma.exchangeRequest.findFirst({
    where: { id: exchangeId, businessId },
    include: {
      order: { select: { id: true, orderNumber: true, status: true, placedAt: true, deliveredAt: true, grandTotalPaisa: true, customerName: true, customerPhone: true } },
      customer: { select: { id: true, name: true, phone: true } },
      reason: true,
      items: { orderBy: { createdAt: "asc" }, include: { variant: { select: { id: true, sku: true, name: true, product: { select: { name: true } } } } } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      shipments: { select: { id: true, internalCode: true, type: true, status: true, trackingCode: true, courier: { select: { name: true } } } },
    },
  });
  if (!exchange) return null;

  const names = await userDisplayNames([...exchange.statusHistory.map((entry) => entry.actorUserId), exchange.approvedByUserId, exchange.inspectedByUserId]);
  return {
    ...exchange,
    statusHistory: exchange.statusHistory.map((entry) => ({ ...entry, actorName: entry.actorUserId ? (names.get(entry.actorUserId) ?? null) : null })),
    approvedByName: exchange.approvedByUserId ? (names.get(exchange.approvedByUserId) ?? null) : null,
    inspectedByName: exchange.inspectedByUserId ? (names.get(exchange.inspectedByUserId) ?? null) : null,
  };
}

export async function exchangeEligibleOrders(businessId: string, search?: string) {
  return prisma.order.findMany({
    where: {
      businessId,
      deletedAt: null,
      status: { in: ["DELIVERED", "COMPLETED"] },
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: "insensitive" as const } },
              { customerName: { contains: search, mode: "insensitive" as const } },
              { customerPhone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { deliveredAt: "desc" },
    take: 30,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      deliveredAt: true,
      status: true,
      grandTotalPaisa: true,
      items: {
        orderBy: { position: "asc" },
        select: { id: true, sku: true, productName: true, variantName: true, quantity: true, unitPricePaisa: true, returnedQuantity: true, exchangedQuantity: true, variantId: true },
      },
    },
  });
}

export async function exchangeReasons(businessId: string) {
  return prisma.exchangeReason.findMany({ where: { businessId, isActive: true }, orderBy: [{ position: "asc" }, { label: "asc" }] });
}

export async function courierProviders(businessId: string, enabledOnly = false) {
  return prisma.courierProvider.findMany({
    where: { businessId, ...(enabledOnly ? { isEnabled: true } : {}) },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
}
