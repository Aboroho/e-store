import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { normalizeBdPhone } from "@/lib/utils";
import {
  availableTransitions,
  displayStatus,
  evaluateOrderEditPermission,
  holdsPermission,
  isDeletable,
  isDispatchEligible,
  statusGroupOf,
  type InternalOrderStatus,
  type OrderTypeValue,
} from "@/modules/orders/status";
import { orderScopeWhere, statusActorFrom, type ManualOrderContext } from "@/modules/orders/manual";
import { orderStatusSubject } from "@/modules/orders/lifecycle";
import { userDisplayNames } from "@/modules/users/queries";

/**
 * Order lookups for the management screens.
 *
 * Every read is scoped by `orderScopeWhere`, so a reseller only ever sees their
 * own orders and a staff member without `order.view_all` only sees what they
 * created — the filter is applied in the query, never by hiding rows afterwards.
 */

const SORT_COLUMNS = {
  placedAt: "placedAt",
  orderNumber: "orderNumber",
  grandTotalPaisa: "grandTotalPaisa",
  duePaisa: "duePaisa",
  codCollectPaisa: "codCollectPaisa",
  updatedAt: "updatedAt",
  status: "status",
} as const;

export interface OrderListFilters {
  search?: string;
  /** One status, a comma separated list, or a status group name. */
  status?: string;
  statuses?: string[];
  orderType?: string;
  paymentStatus?: string;
  channel?: string;
  districtCode?: string;
  createdByUserId?: string;
  createdByUserRole?: string;
  resellerId?: string;
  /** `mine` restricts to the signed-in user's own orders. */
  creator?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface OrderListRow {
  id: string;
  orderNumber: string;
  channel: string;
  orderType: string;
  status: string;
  statusLabel: string;
  courierStatus: string | null;
  paymentStatus: string;
  fulfillmentStatus: string;
  customerName: string | null;
  customerPhone: string | null;
  customerPhoneNormalized: string | null;
  customerEmail: string | null;
  shippingDistrictCode: string | null;
  shippingArea: string | null;
  shippingAddressLine: string | null;
  itemsSubtotalPaisa: number;
  discountTotalPaisa: number;
  deliveryFeePaisa: number;
  grandTotalPaisa: number;
  paidPaisa: number;
  duePaisa: number;
  codCollectPaisa: number;
  inventoryCostPaisa: number;
  createdByUserId: string | null;
  createdByUserRole: string | null;
  creatorName: string | null;
  resellerId: string | null;
  resellerName: string | null;
  placedAt: Date;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  lineCount: number;
  unitCount: number;
  hasPreorder: boolean;
  shipment: {
    id: string;
    status: string;
    providerCode: string;
    courierName: string | null;
    internalCode: string;
    trackingCode: string | null;
    consignmentId: string | null;
    codAmountPaisa: number;
    collectedPaisa: number;
    lastStatusAt: Date | null;
  } | null;
  items: Array<{
    id: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    unitPricePaisa: number;
    lineTotalPaisa: number;
    status: string;
    isPreorder: boolean;
    returnedQuantity: number;
    cancelledQuantity: number;
  }>;
}

function statusFilter(values: string | string[] | undefined): string[] {
  const raw = Array.isArray(values) ? values : (values ?? "").split(",").map((entry) => entry.trim());
  return raw.filter((entry) => entry && entry !== "ALL");
}

/** Build the Prisma `where` for the order list, including the visibility scope. */
export function orderListWhere(context: ManualOrderContext, filters: OrderListFilters): Prisma.OrderWhereInput {
  const statuses = statusFilter(filters.statuses?.length ? filters.statuses : filters.status);
  const search = filters.search?.trim();
  const phone = search ? normalizeBdPhone(search) : null;

  const where: Prisma.OrderWhereInput = {
    businessId: context.businessId,
    deletedAt: null,
    ...orderScopeWhere(context),
    ...(statuses.length > 0 ? { status: { in: statuses as InternalOrderStatus[] } } : {}),
    ...(filters.orderType && filters.orderType !== "ALL" ? { orderType: filters.orderType as OrderTypeValue } : {}),
    ...(filters.paymentStatus && filters.paymentStatus !== "ALL"
      ? { paymentStatus: filters.paymentStatus as "UNPAID" }
      : {}),
    ...(filters.channel && filters.channel !== "ALL" ? { channel: filters.channel as "ADMIN" } : {}),
    ...(filters.districtCode && filters.districtCode !== "ALL" ? { shippingDistrictCode: filters.districtCode } : {}),
    ...(filters.resellerId ? { resellerId: filters.resellerId } : {}),
    ...(filters.createdByUserRole && filters.createdByUserRole !== "ALL"
      ? { createdByUserRole: filters.createdByUserRole }
      : {}),
    ...(filters.creator === "mine"
      ? { createdByUserId: context.userId }
      : filters.createdByUserId
        ? { createdByUserId: filters.createdByUserId }
        : {}),
    ...(filters.from || filters.to
      ? { placedAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" } },
            { customerName: { contains: search, mode: "insensitive" } },
            { customerPhone: { contains: search, mode: "insensitive" } },
            { customerEmail: { contains: search, mode: "insensitive" } },
            { sourceReference: { contains: search, mode: "insensitive" } },
            { shippingAddressLine: { contains: search, mode: "insensitive" } },
            // Courier identifiers live on the shipment, not on the order.
            { shipments: { some: { trackingCode: { contains: search, mode: "insensitive" } } } },
            { shipments: { some: { providerConsignmentId: { contains: search, mode: "insensitive" } } } },
            { shipments: { some: { internalCode: { contains: search, mode: "insensitive" } } } },
            { shipments: { some: { merchantOrderId: { contains: search, mode: "insensitive" } } } },
            // A fully typed phone number is matched on its normalized form, so
            // `+8801712…`, `8801712…` and `01712…` find the same orders.
            ...(phone ? [{ customerPhoneNormalized: phone }] : []),
          ],
        }
      : {}),
  };

  return where;
}

const LIST_INCLUDE = {
  items: {
    orderBy: { position: "asc" as const },
    select: {
      id: true,
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      unitPricePaisa: true,
      lineTotalPaisa: true,
      status: true,
      isPreorder: true,
      returnedQuantity: true,
      cancelledQuantity: true,
    },
  },
  shipments: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      status: true,
      providerCode: true,
      internalCode: true,
      trackingCode: true,
      providerConsignmentId: true,
      providerStatusRaw: true,
      codAmountPaisa: true,
      collectedPaisa: true,
      lastStatusAt: true,
      courier: { select: { name: true } },
    },
  },
  reseller: { select: { id: true, name: true } },
} as const;

/** Search the orders the actor may see. */
export async function searchOrders(
  context: ManualOrderContext,
  filters: OrderListFilters,
): Promise<{ orders: OrderListRow[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const sortDir = filters.sortDir === "asc" ? "asc" : "desc";
  const sortBy =
    filters.sortBy && SORT_COLUMNS[filters.sortBy as keyof typeof SORT_COLUMNS]
      ? (SORT_COLUMNS[filters.sortBy as keyof typeof SORT_COLUMNS] as keyof typeof SORT_COLUMNS)
      : "placedAt";

  const where = orderListWhere(context, filters);
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.order.count({ where }),
  ]);

  const names = await userDisplayNames(rows.map((row) => row.createdByUserId));

  const mayViewCosts = holdsPermission(statusActorFrom(context), "order.view_cost");
  const orders = rows.map((row) => {
    const shipment = row.shipments[0] ?? null;
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      channel: row.channel,
      orderType: row.orderType,
      status: row.status,
      statusLabel: displayStatus(row.status, shipment?.providerStatusRaw ?? null),
      courierStatus: shipment?.providerStatusRaw ?? null,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      customerPhoneNormalized: row.customerPhoneNormalized,
      customerEmail: row.customerEmail,
      shippingDistrictCode: row.shippingDistrictCode,
      shippingArea: row.shippingArea,
      shippingAddressLine: row.shippingAddressLine,
      itemsSubtotalPaisa: row.itemsSubtotalPaisa,
      discountTotalPaisa: row.discountTotalPaisa,
      deliveryFeePaisa: row.deliveryFeePaisa,
      grandTotalPaisa: row.grandTotalPaisa,
      paidPaisa: row.paidPaisa,
      duePaisa: row.duePaisa,
      codCollectPaisa: row.codCollectPaisa,
      inventoryCostPaisa: mayViewCosts ? row.inventoryCostPaisa : 0,
      createdByUserId: row.createdByUserId,
      createdByUserRole: row.createdByUserRole,
      creatorName: row.createdByUserId ? names.get(row.createdByUserId) ?? null : null,
      resellerId: row.resellerId,
      resellerName: row.reseller?.name ?? null,
      placedAt: row.placedAt,
      deliveredAt: row.deliveredAt,
      cancelledAt: row.cancelledAt,
      lineCount: row.items.length,
      unitCount: row.items.reduce((total, item) => total + item.quantity, 0),
      hasPreorder: row.items.some((item) => item.isPreorder),
      shipment: shipment
        ? {
            id: shipment.id,
            status: shipment.status,
            providerCode: shipment.providerCode,
            courierName: shipment.courier?.name ?? null,
            internalCode: shipment.internalCode,
            trackingCode: shipment.trackingCode,
            consignmentId: shipment.providerConsignmentId,
            codAmountPaisa: shipment.codAmountPaisa,
            collectedPaisa: shipment.collectedPaisa,
            lastStatusAt: shipment.lastStatusAt,
          }
        : null,
      items: row.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        variantName: item.variantName,
        sku: item.sku,
        quantity: item.quantity,
        unitPricePaisa: item.unitPricePaisa,
        lineTotalPaisa: item.lineTotalPaisa,
        status: item.status,
        isPreorder: item.isPreorder,
        returnedQuantity: item.returnedQuantity,
        cancelledQuantity: item.cancelledQuantity,
      })),
    } satisfies OrderListRow;
  });

  return { orders, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Aggregate tiles for the order list header, computed on the same scope. */
export async function orderListSummary(context: ManualOrderContext, filters: Omit<OrderListFilters, "status">) {
  const base = orderListWhere(context, filters);
  const withStatus = (statuses: InternalOrderStatus[]) => ({ ...base, status: { in: statuses } });

  const [awaitingConfirmation, inCourier, delivered, cancelled, onHold, collectible] = await Promise.all([
    prisma.order.count({ where: withStatus(["PENDING", "PROCESSING", "READY_TO_SHIP"]) }),
    prisma.order.count({ where: withStatus(["SHIPPED"]) }),
    prisma.order.count({ where: withStatus(["DELIVERED", "COMPLETED", "PARTIALLY_DELIVERED"]) }),
    prisma.order.count({ where: withStatus(["CANCELLED"]) }),
    prisma.order.count({ where: withStatus(["ON_HOLD"]) }),
    prisma.order.aggregate({
      where: { ...base, status: { notIn: ["CANCELLED"] } },
      _sum: { codCollectPaisa: true, grandTotalPaisa: true },
    }),
  ]);

  return {
    awaitingConfirmation,
    inCourier,
    delivered,
    cancelled,
    onHold,
    collectiblePaisa: collectible._sum.codCollectPaisa ?? 0,
    valuePaisa: collectible._sum.grandTotalPaisa ?? 0,
  };
}

/** People who created orders — powers the "Created by" filter. */
export async function orderCreatorOptions(context: ManualOrderContext) {
  if (!holdsPermission(statusActorFrom(context), "order.view_all")) return [];
  const rows = await prisma.order.findMany({
    where: { businessId: context.businessId, deletedAt: null, createdByUserId: { not: null } },
    distinct: ["createdByUserId"],
    select: { createdByUserId: true, createdByUserRole: true },
    take: 200,
  });
  const names = await userDisplayNames(rows.map((row) => row.createdByUserId));
  return rows
    .filter((row) => row.createdByUserId)
    .map((row) => ({
      value: row.createdByUserId as string,
      label: names.get(row.createdByUserId as string) ?? "Unknown user",
      role: row.createdByUserRole,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Role labels present on orders — powers the "Creator role" filter. */
export async function orderCreatorRoleOptions(context: ManualOrderContext) {
  if (!holdsPermission(statusActorFrom(context), "order.view_all")) return [];
  const rows = await prisma.order.groupBy({
    by: ["createdByUserRole"],
    where: { businessId: context.businessId, deletedAt: null, createdByUserRole: { not: null } },
    _count: { _all: true },
  });
  return rows
    .filter((row) => row.createdByUserRole)
    .map((row) => ({ value: row.createdByUserRole as string, label: row.createdByUserRole as string, count: row._count._all }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ----------------------------------------------------------------- phone lookup

export interface SavedAddressLookupResult {
  found: boolean;
  phone: string | null;
  customer: { id: string; name: string | null; email: string | null; ordersCount: number } | null;
  addresses: Array<{
    id: string;
    label: string | null;
    recipientName: string;
    phone: string | null;
    districtCode: string | null;
    districtName: string | null;
    area: string | null;
    addressLine: string;
    isDefault: boolean;
    lastUsedAt: Date | null;
  }>;
  /** The most recent shipping details on this phone, offered as a shortcut. */
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    placedAt: Date;
    customerName: string | null;
    districtCode: string | null;
    districtName: string | null;
    area: string | null;
    addressLine: string | null;
  }>;
}

/**
 * Find saved customer details for a phone number.
 *
 * Matching is on the normalized Bangladeshi form (`01XXXXXXXXX`), so `+880…`,
 * `880…`, `01…` and a number typed with spaces or dashes all resolve to the same
 * customer. When nothing matches, `found` is false and the UI shows the
 * "No address found" toast — the operator keeps typing the address by hand.
 */
export async function lookupSavedAddresses(
  context: ManualOrderContext,
  rawPhone: string,
): Promise<SavedAddressLookupResult> {
  const phone = normalizeBdPhone(rawPhone ?? "");
  if (!phone) return { found: false, phone: null, customer: null, addresses: [], recentOrders: [] };

  const [addresses, orders] = await Promise.all([
    prisma.customerAddress.findMany({
      where: { phoneNormalized: phone, isActive: true, customer: { businessId: context.businessId } },
      include: { customer: { select: { id: true, name: true, email: true } }, district: { select: { name: true } } },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.order.findMany({
      where: {
        businessId: context.businessId,
        deletedAt: null,
        customerPhoneNormalized: phone,
        shippingAddressLine: { not: null },
        ...orderScopeWhere(context),
      },
      orderBy: { placedAt: "desc" },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        customerName: true,
        customerId: true,
        shippingDistrictCode: true,
        shippingArea: true,
        shippingAddressLine: true,
      },
    }),
  ]);

  const customer = addresses[0]?.customer ?? null;
  const ordersCount = customer
    ? await prisma.order.count({ where: { customerId: customer.id, businessId: context.businessId, deletedAt: null } })
    : 0;

  const districtNames = await prisma.district.findMany({
    where: { code: { in: orders.map((order) => order.shippingDistrictCode).filter((code): code is string => Boolean(code)) } },
    select: { code: true, name: true },
  });
  const districtName = (code: string | null) => districtNames.find((entry) => entry.code === code)?.name ?? null;

  return {
    found: addresses.length > 0 || orders.length > 0,
    phone,
    customer: customer ? { id: customer.id, name: customer.name, email: customer.email, ordersCount } : null,
    addresses: addresses.map((address) => ({
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      districtCode: address.districtCode,
      districtName: address.district?.name ?? null,
      area: address.area,
      addressLine: address.addressLine,
      isDefault: address.isDefault,
      lastUsedAt: address.updatedAt,
    })),
    recentOrders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      customerName: order.customerName,
      districtCode: order.shippingDistrictCode,
      districtName: districtName(order.shippingDistrictCode),
      area: order.shippingArea,
      addressLine: order.shippingAddressLine,
    })),
  };
}

// --------------------------------------------------------------- order detail

export type OrderScreenOrder = NonNullable<Awaited<ReturnType<typeof fetchOrderForScreen>>>;

export interface OrderScreenData {
  order: OrderScreenOrder;
  statusLabel: string;
  statusGroup: string;
  courierStatus: string | null;
  transitions: ReturnType<typeof availableTransitions>;
  edit: ReturnType<typeof evaluateOrderEditPermission>;
  dispatch: { eligible: boolean; reason?: string };
  deletable: boolean;
  deletionBlockers: string[];
  mayViewCosts: boolean;
  mayDelete: boolean;
  mayDispatch: boolean;
  earnings: Array<{
    id: string;
    eligibilityStatus: string;
    collectedPaisa: number;
    resellerCostPaisa: number;
    earningsPaisa: number;
    settledPaisa: number;
    eligibleAt: Date | null;
    createdAt: Date;
  }>;
}

/** Load one order with everything the detail screen renders. */
async function fetchOrderForScreen(context: ManualOrderContext, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, businessId: context.businessId, deletedAt: null, ...orderScopeWhere(context) },
    include: {
      items: { orderBy: { position: "asc" } },
      adjustments: { orderBy: { createdAt: "asc" } },
      addresses: true,
      statusHistory: { orderBy: { createdAt: "desc" } },
      shipments: {
        orderBy: { createdAt: "desc" },
        include: { courier: { select: { id: true, name: true, code: true } }, statusHistory: { orderBy: { recordedAt: "desc" }, take: 12 } },
      },
      payments: { orderBy: { createdAt: "desc" } },
      customer: { select: { id: true, name: true, email: true, phone: true } },
      reseller: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

/** Everything the order detail screen renders, already permission-filtered. */
export async function getOrderScreen(context: ManualOrderContext, orderId: string): Promise<OrderScreenData> {
  const order = await fetchOrderForScreen(context, orderId);
  if (!order) throw AppError.notFound("Order not found");

  const actor = statusActorFrom(context);
  const subject = await orderStatusSubject(order);
  const shipment = order.shipments[0] ?? null;
  const mayViewCosts = holdsPermission(actor, "order.view_cost");

  const earnings =
    order.resellerId && (mayViewCosts || context.resellerId === order.resellerId)
      ? await prisma.resellerOrderEarning.findMany({
          where: { orderId: order.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            eligibilityStatus: true,
            collectedPaisa: true,
            resellerCostPaisa: true,
            earningsPaisa: true,
            settledPaisa: true,
            eligibleAt: true,
            createdAt: true,
          },
        })
      : [];

  const deletable = isDeletable(order);
  const deletionBlockers: string[] = [];
  if (deletable) {
    const [payments, refunds, codCollections, settlementEntries, earningCount, exchanges, charges] = await Promise.all([
      prisma.payment.count({ where: { orderId: order.id, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } } }),
      prisma.refund.count({ where: { orderId: order.id } }),
      prisma.codCollection.count({ where: { orderId: order.id } }),
      prisma.courierSettlementEntry.count({ where: { shipment: { orderId: order.id } } }),
      prisma.resellerOrderEarning.count({ where: { orderId: order.id } }),
      prisma.exchangeRequest.count({ where: { orderId: order.id } }),
      prisma.courierCharge.count({ where: { shipment: { orderId: order.id } } }),
    ]);
    if (payments > 0) deletionBlockers.push(`${payments} collected payment(s)`);
    if (refunds > 0) deletionBlockers.push(`${refunds} refund(s)`);
    if (codCollections > 0) deletionBlockers.push("a courier COD collection");
    if (settlementEntries > 0) deletionBlockers.push("a courier settlement entry");
    if (charges > 0) deletionBlockers.push("recorded courier charges");
    if (earningCount > 0) deletionBlockers.push("reseller earning records");
    if (exchanges > 0) deletionBlockers.push("an exchange request");
    if (shipment) deletionBlockers.push(`courier shipment ${shipment.trackingCode ?? shipment.internalCode}`);
  }

  return {
    order,
    statusLabel: displayStatus(order.status, shipment?.providerStatusRaw ?? null),
    statusGroup: statusGroupOf(order.status),
    courierStatus: shipment?.providerStatusRaw ?? null,
    transitions: availableTransitions({ actor, subject }),
    edit: evaluateOrderEditPermission({ actor, subject }),
    dispatch: isDispatchEligible({
      status: order.status,
      orderType: order.orderType,
      channel: order.channel,
      shipmentState: subject.shipmentState,
      hasShippingAddress: Boolean(order.shippingDistrictCode && order.shippingAddressLine),
    }),
    deletable: deletable && deletionBlockers.length === 0,
    deletionBlockers,
    mayViewCosts,
    mayDelete: deletable && holdsPermission(actor, "order.delete"),
    mayDispatch: holdsPermission(actor, "order.dispatch"),
    earnings,
  };
}

/** Orders that can be sent to the courier right now (bulk dispatch picker). */
export async function dispatchableOrders(context: ManualOrderContext, take = 50) {
  const orders = await prisma.order.findMany({
    where: {
      businessId: context.businessId,
      deletedAt: null,
      status: "CONFIRMED",
      orderType: { not: "IN_STORE" },
      channel: { not: "IN_STORE" },
      shippingAddressLine: { not: null },
      shipments: { none: {} },
      ...orderScopeWhere(context),
    },
    orderBy: { confirmedAt: "asc" },
    take,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      shippingDistrictCode: true,
      codCollectPaisa: true,
      grandTotalPaisa: true,
      confirmedAt: true,
    },
  });
  return orders;
}
