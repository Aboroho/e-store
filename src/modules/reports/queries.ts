import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Report definitions and queries.
 *
 * Every report is a database aggregation returning the same shape — `columns`,
 * `rows`, `totals` and `meta` — so one renderer serves the screen, the PDF and the
 * XLSX export. Amounts are integer paisa and are formatted at the edge.
 *
 * The vocabulary is deliberate: **revenue is not profit**. A sales report shows
 * revenue; only the profit report subtracts inventory cost, packaging, courier and
 * COD charges and refunds, each as its own column.
 */

export type ReportColumnFormat = "text" | "number" | "paisa" | "date" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  format: ReportColumnFormat;
  align?: "left" | "right";
  /** Hidden in the on-screen table but present in exports. */
  hideOnScreen?: boolean;
}

export interface ReportResult {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, number>;
  meta: Record<string, string | number | null>;
  /** Grouped reports return several tables under one key. */
  sections?: Array<{ title: string; columns: ReportColumn[]; rows: Array<Record<string, string | number | null>>; totals?: Record<string, number> }>;
}

export interface ReportRange {
  from?: Date;
  to?: Date;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: "Sales" | "Catalogue" | "Inventory" | "Purchasing" | "Money" | "Resellers";
  /** Requires `report.view_cost` to see cost/profit columns. */
  sensitive?: boolean;
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  { key: "sales-by-date", title: "Sales by date", description: "Revenue per day for the selected range, split by channel and storefront.", group: "Sales" },
  { key: "sales-by-product", title: "Sales by product", description: "Units sold, revenue and cost per variant, from order snapshots.", group: "Sales", sensitive: true },
  { key: "inventory-valuation", title: "Inventory valuation", description: "On-hand quantity and value at weighted-average cost, per location and variant.", group: "Inventory", sensitive: true },
  { key: "inventory-movements", title: "Inventory movement history", description: "Every ledger movement in the range with its source document.", group: "Inventory" },
  { key: "damaged-stock", title: "Damaged & inspection stock", description: "Units sitting in the damaged and inspection buckets, with their reason.", group: "Inventory" },
  { key: "preorders-outstanding", title: "Outstanding preorders", description: "Preorder commitments that are still waiting for stock, oldest first.", group: "Sales" },
  { key: "purchase-history", title: "Purchase history & costs", description: "Goods receipts with their invoice value, allocated expenses and landed unit cost.", group: "Purchasing", sensitive: true },
  { key: "profit-summary", title: "Gross profit", description: "Revenue less inventory cost, packaging, courier and COD charges, refunds and payouts.", group: "Money", sensitive: true },
  { key: "payments-collected", title: "Payments & refunds", description: "Money in by method, and refunds paid out, for the range.", group: "Money" },
  { key: "courier-charges", title: "Courier charges & settlement differences", description: "Courier fees, COD charges and every statement row that did not agree.", group: "Money" },
  { key: "reseller-earnings", title: "Reseller earnings & unpaid balances", description: "Per-reseller earnings, what is payable now and what is still awaiting settlement.", group: "Resellers" },
];

export function reportDefinition(key: string): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((definition) => definition.key === key);
}

function dayStart(date?: Date): Date {
  const value = date ? new Date(date) : new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function dayEnd(date?: Date): Date {
  const value = date ? new Date(date) : new Date();
  value.setHours(23, 59, 59, 999);
  return value;
}

export function resolveRange(input: { from?: string; to?: string } = {}): { from: Date; to: Date } {
  const to = input.to ? dayEnd(new Date(input.to)) : dayEnd();
  const from = input.from
    ? dayStart(new Date(input.from))
    : dayStart(new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000));
  return { from, to };
}

const ORDER_STATUSES = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

// ------------------------------------------------------------------- sales

async function salesByDate(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const orders = await prisma.order.findMany({
    where: { businessId, deletedAt: null, status: { in: [...ORDER_STATUSES] }, placedAt: { gte: range.from, lte: range.to } },
    select: {
      placedAt: true,
      channel: true,
      storefrontId: true,
      grandTotalPaisa: true,
      refundedPaisa: true,
      inventoryCostPaisa: true,
      packagingCostPaisa: true,
      deliveryFeePaisa: true,
      codSurchargePaisa: true,
      storefront: { select: { name: true } },
      items: { select: { quantity: true } },
    },
  });

  const byDay = new Map<string, { date: string; orders: number; units: number; revenuePaisa: number; refundedPaisa: number }>();
  const byChannel = new Map<string, { channel: string; orders: number; revenuePaisa: number }>();
  const byStorefront = new Map<string, { storefront: string; orders: number; revenuePaisa: number }>();

  for (const order of orders) {
    const day = order.placedAt.toISOString().slice(0, 10);
    const units = order.items.reduce((total, item) => total + item.quantity, 0);

    const dayRow = byDay.get(day) ?? { date: day, orders: 0, units: 0, revenuePaisa: 0, refundedPaisa: 0 };
    dayRow.orders += 1;
    dayRow.units += units;
    dayRow.revenuePaisa += order.grandTotalPaisa;
    dayRow.refundedPaisa += order.refundedPaisa;
    byDay.set(day, dayRow);

    const channelRow = byChannel.get(order.channel) ?? { channel: order.channel, orders: 0, revenuePaisa: 0 };
    channelRow.orders += 1;
    channelRow.revenuePaisa += order.grandTotalPaisa;
    byChannel.set(order.channel, channelRow);

    const storefrontName = order.storefront?.name ?? (order.channel === "STOREFRONT" ? "(deleted storefront)" : "(no storefront)");
    const storefrontRow = byStorefront.get(storefrontName) ?? { storefront: storefrontName, orders: 0, revenuePaisa: 0 };
    storefrontRow.orders += 1;
    storefrontRow.revenuePaisa += order.grandTotalPaisa;
    byStorefront.set(storefrontName, storefrontRow);
  }

  const rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, netRevenuePaisa: row.revenuePaisa - row.refundedPaisa }));
  const revenue = rows.reduce((total, row) => total + row.revenuePaisa, 0);
  const refunded = rows.reduce((total, row) => total + row.refundedPaisa, 0);

  return {
    key: "sales-by-date",
    title: "Sales by date",
    description: "Revenue per day for the selected range (cancelled orders excluded).",
    columns: [
      { key: "date", label: "Date", format: "text" },
      { key: "orders", label: "Orders", format: "number", align: "right" },
      { key: "units", label: "Units", format: "number", align: "right" },
      { key: "revenuePaisa", label: "Revenue", format: "paisa", align: "right" },
      { key: "refundedPaisa", label: "Refunded", format: "paisa", align: "right" },
      { key: "netRevenuePaisa", label: "Net revenue", format: "paisa", align: "right" },
    ],
    rows,
    totals: { revenuePaisa: revenue, refundedPaisa: refunded, netRevenuePaisa: revenue - refunded, orders: rows.reduce((t, r) => t + r.orders, 0) },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
    sections: [
      {
        title: "By channel",
        columns: [
          { key: "channel", label: "Channel", format: "text" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "revenuePaisa", label: "Revenue", format: "paisa", align: "right" },
        ],
        rows: [...byChannel.values()].sort((a, b) => b.revenuePaisa - a.revenuePaisa),
      },
      {
        title: "By storefront",
        columns: [
          { key: "storefront", label: "Storefront", format: "text" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "revenuePaisa", label: "Revenue", format: "paisa", align: "right" },
        ],
        rows: [...byStorefront.values()].sort((a, b) => b.revenuePaisa - a.revenuePaisa),
      },
    ],
  };
}

async function salesByProduct(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  // Aggregated from order-item snapshots: historical reports never re-price.
  const items = await prisma.orderItem.findMany({
    where: {
      order: { businessId, deletedAt: null, status: { in: [...ORDER_STATUSES] }, placedAt: { gte: range.from, lte: range.to } },
    },
    select: {
      variantId: true,
      sku: true,
      productName: true,
      variantName: true,
      quantity: true,
      lineTotalPaisa: true,
      unitCostPaisa: true,
      returnedQuantity: true,
      exchangedQuantity: true,
      cancelledQuantity: true,
    },
  });

  const byVariant = new Map<
    string,
    { sku: string; product: string; variant: string; units: number; returned: number; revenuePaisa: number; costPaisa: number }
  >();

  for (const item of items) {
    const key = item.sku;
    const row =
      byVariant.get(key) ??
      { sku: item.sku, product: item.productName, variant: item.variantName, units: 0, returned: 0, revenuePaisa: 0, costPaisa: 0 };
    row.units += item.quantity;
    row.returned += item.returnedQuantity + item.cancelledQuantity;
    row.revenuePaisa += item.lineTotalPaisa;
    row.costPaisa += item.unitCostPaisa * item.quantity;
    byVariant.set(key, row);
  }

  const rows = [...byVariant.values()]
    .map((row) => ({ ...row, netUnits: row.units - row.returned, grossProfitPaisa: row.revenuePaisa - row.costPaisa }))
    .sort((a, b) => b.revenuePaisa - a.revenuePaisa);

  return {
    key: "sales-by-product",
    title: "Sales by product",
    description: "Units and revenue per variant from the order snapshots, with the inventory cost recorded at sale time.",
    columns: [
      { key: "sku", label: "SKU", format: "text" },
      { key: "product", label: "Product", format: "text" },
      { key: "variant", label: "Variant", format: "text" },
      { key: "units", label: "Units sold", format: "number", align: "right" },
      { key: "returned", label: "Returned/cancelled", format: "number", align: "right" },
      { key: "netUnits", label: "Net units", format: "number", align: "right" },
      { key: "revenuePaisa", label: "Revenue", format: "paisa", align: "right" },
      { key: "costPaisa", label: "Inventory cost", format: "paisa", align: "right", hideOnScreen: false },
      { key: "grossProfitPaisa", label: "Gross profit", format: "paisa", align: "right" },
    ],
    rows,
    totals: {
      units: rows.reduce((total, row) => total + row.units, 0),
      revenuePaisa: rows.reduce((total, row) => total + row.revenuePaisa, 0),
      costPaisa: rows.reduce((total, row) => total + row.costPaisa, 0),
      grossProfitPaisa: rows.reduce((total, row) => total + row.grossProfitPaisa, 0),
    },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10), variants: rows.length },
  };
}

// --------------------------------------------------------------- inventory

async function inventoryValuation(businessId: string): Promise<ReportResult> {
  const balances = await prisma.inventoryBalance.findMany({
    where: { variant: { product: { businessId } } },
    include: {
      location: { select: { name: true, code: true } },
      variant: { select: { sku: true, name: true, costPaisa: true, product: { select: { name: true } } } },
    },
    orderBy: [{ location: { name: "asc" } }, { variant: { sku: "asc" } }],
    take: 5000,
  });

  const rows = balances.map((balance) => ({
    location: balance.location.name,
    sku: balance.variant.sku,
    product: balance.variant.product.name,
    variant: balance.variant.name,
    onHand: balance.onHand,
    reserved: balance.reserved,
    damaged: balance.damaged,
    inspection: balance.inspection,
    available: balance.onHand - balance.reserved - balance.damaged - balance.inspection,
    averageCostPaisa: balance.averageCostPaisa,
    valuePaisa: balance.onHand * balance.averageCostPaisa,
  }));

  return {
    key: "inventory-valuation",
    title: "Inventory valuation",
    description: "On-hand quantity valued at weighted-average cost. Damaged and inspection units are shown separately and are not counted as available.",
    columns: [
      { key: "location", label: "Location", format: "text" },
      { key: "sku", label: "SKU", format: "text" },
      { key: "product", label: "Product", format: "text" },
      { key: "variant", label: "Variant", format: "text" },
      { key: "onHand", label: "On hand", format: "number", align: "right" },
      { key: "reserved", label: "Reserved", format: "number", align: "right" },
      { key: "damaged", label: "Damaged", format: "number", align: "right" },
      { key: "inspection", label: "Inspection", format: "number", align: "right" },
      { key: "available", label: "Available", format: "number", align: "right" },
      { key: "averageCostPaisa", label: "Avg cost", format: "paisa", align: "right" },
      { key: "valuePaisa", label: "Value", format: "paisa", align: "right" },
    ],
    rows,
    totals: {
      onHand: rows.reduce((total, row) => total + row.onHand, 0),
      available: rows.reduce((total, row) => total + row.available, 0),
      damaged: rows.reduce((total, row) => total + row.damaged, 0),
      valuePaisa: rows.reduce((total, row) => total + row.valuePaisa, 0),
    },
    meta: { asOf: new Date().toISOString(), variants: rows.length },
  };
}

async function inventoryMovements(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const movements = await prisma.inventoryMovement.findMany({
    where: { businessId, createdAt: { gte: range.from, lte: range.to } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    include: {
      variant: { select: { sku: true, name: true } },
      location: { select: { name: true } },
    },
  });

  const rows = movements.map((movement) => ({
    createdAt: movement.createdAt.toISOString(),
    type: movement.type,
    sku: movement.variant?.sku ?? "(deleted variant)",
    location: movement.location?.name ?? "—",
    onHandDelta: movement.quantityDelta,
    reservedDelta: movement.reservedDelta,
    damagedDelta: movement.damagedDelta,
    inspectionDelta: movement.inspectionDelta,
    reference: movement.reference ?? "",
    source: movement.sourceType ?? "",
    reason: movement.reason ?? "",
  }));

  return {
    key: "inventory-movements",
    title: "Inventory movement history",
    description: "The stock ledger itself — every counter change with the document that caused it.",
    columns: [
      { key: "createdAt", label: "When", format: "date" },
      { key: "type", label: "Type", format: "text" },
      { key: "sku", label: "SKU", format: "text" },
      { key: "location", label: "Location", format: "text" },
      { key: "onHandDelta", label: "On hand", format: "number", align: "right" },
      { key: "reservedDelta", label: "Reserved", format: "number", align: "right" },
      { key: "damagedDelta", label: "Damaged", format: "number", align: "right" },
      { key: "inspectionDelta", label: "Inspection", format: "number", align: "right" },
      { key: "reference", label: "Reference", format: "text" },
      { key: "reason", label: "Reason", format: "text" },
    ],
    rows,
    totals: { onHandDelta: rows.reduce((total, row) => total + Number(row.onHandDelta), 0), movements: rows.length },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
  };
}

async function damagedStock(businessId: string): Promise<ReportResult> {
  const [damagedMovements, damagedBalances] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { businessId, damagedDelta: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: { variant: { select: { sku: true, name: true } }, location: { select: { name: true } } },
    }),
    prisma.inventoryBalance.findMany({
      where: { variant: { product: { businessId } }, OR: [{ damaged: { gt: 0 } }, { inspection: { gt: 0 } }] },
      include: { variant: { select: { sku: true, name: true } }, location: { select: { name: true } } },
      orderBy: { damaged: "desc" },
    }),
  ]);

  return {
    key: "damaged-stock",
    title: "Damaged & inspection stock",
    description: "What is currently unusable, plus the movements that made it unusable (with their recorded reason).",
    columns: [
      { key: "location", label: "Location", format: "text" },
      { key: "sku", label: "SKU", format: "text" },
      { key: "variant", label: "Variant", format: "text" },
      { key: "damaged", label: "Damaged", format: "number", align: "right" },
      { key: "inspection", label: "Inspection", format: "number", align: "right" },
      { key: "valuePaisa", label: "Value", format: "paisa", align: "right" },
    ],
    rows: damagedBalances.map((balance) => ({
      location: balance.location.name,
      sku: balance.variant.sku,
      variant: balance.variant.name,
      damaged: balance.damaged,
      inspection: balance.inspection,
      valuePaisa: (balance.damaged + balance.inspection) * balance.averageCostPaisa,
    })),
    totals: {
      damaged: damagedBalances.reduce((total, row) => total + row.damaged, 0),
      inspection: damagedBalances.reduce((total, row) => total + row.inspection, 0),
      valuePaisa: damagedBalances.reduce((total, row) => total + (row.damaged + row.inspection) * row.averageCostPaisa, 0),
    },
    meta: { asOf: new Date().toISOString() },
    sections: [
      {
        title: "Recent damage movements",
        columns: [
          { key: "createdAt", label: "When", format: "date" },
          { key: "sku", label: "SKU", format: "text" },
          { key: "quantity", label: "Quantity", format: "number", align: "right" },
          { key: "reason", label: "Reason", format: "text" },
          { key: "reference", label: "Reference", format: "text" },
        ],
        rows: damagedMovements.map((movement) => ({
          createdAt: movement.createdAt.toISOString(),
          sku: movement.variant?.sku ?? "—",
          quantity: movement.damagedDelta,
          reason: movement.reason ?? "",
          reference: movement.reference ?? "",
        })),
      },
    ],
  };
}

async function preordersOutstanding(businessId: string): Promise<ReportResult> {
  const commitments = await prisma.preorderCommitment.findMany({
    where: { businessId, status: { in: ["OPEN", "PARTIALLY_ALLOCATED"] } },
    orderBy: [{ priorityAt: "asc" }],
    take: 2000,
    include: {
      order: { select: { orderNumber: true, customerName: true, customerPhoneNormalized: true } },
      variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
      location: { select: { name: true } },
    },
  });

  const rows = commitments.map((commitment) => ({
    priorityAt: commitment.priorityAt.toISOString(),
    orderNumber: commitment.order.orderNumber,
    customer: commitment.order.customerName ?? "",
    phone: commitment.order.customerPhoneNormalized ?? "",
    product: commitment.variant?.product.name ?? "—",
    sku: commitment.variant?.sku ?? "—",
    location: commitment.location.name,
    quantity: commitment.quantity,
    allocated: commitment.allocatedQuantity,
    outstanding: commitment.quantity - commitment.allocatedQuantity,
    expectedAt: commitment.expectedAt?.toISOString().slice(0, 10) ?? "",
    status: commitment.status,
  }));

  return {
    key: "preorders-outstanding",
    title: "Outstanding preorders",
    description: "Promised units that stock has not served yet, oldest commitment first (the allocation order).",
    columns: [
      { key: "priorityAt", label: "Queued at", format: "date" },
      { key: "orderNumber", label: "Order", format: "text" },
      { key: "customer", label: "Customer", format: "text" },
      { key: "product", label: "Product", format: "text" },
      { key: "sku", label: "SKU", format: "text" },
      { key: "quantity", label: "Promised", format: "number", align: "right" },
      { key: "allocated", label: "Allocated", format: "number", align: "right" },
      { key: "outstanding", label: "Outstanding", format: "number", align: "right" },
      { key: "expectedAt", label: "Expected", format: "text" },
    ],
    rows,
    totals: {
      promised: rows.reduce((total, row) => total + Number(row.quantity), 0),
      outstanding: rows.reduce((total, row) => total + Number(row.outstanding), 0),
    },
    meta: { commitments: rows.length },
  };
}

// -------------------------------------------------------------- purchasing

async function purchaseHistory(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { purchaseOrder: { businessId }, receivedAt: { gte: range.from, lte: range.to } },
    orderBy: { receivedAt: "desc" },
    take: 2000,
    include: {
      purchaseOrder: { select: { code: true, supplier: { select: { name: true } } } },
      items: { select: { quantity: true, lineCostPaisa: true, allocatedExpensePaisa: true, unitCostPaisa: true } },
      location: { select: { name: true } },
    },
  });

  const rows = receipts.map((receipt) => {
    const invoicePaisa = receipt.items.reduce((total, item) => total + item.quantity * item.unitCostPaisa, 0);
    const expensesPaisa = receipt.items.reduce((total, item) => total + item.allocatedExpensePaisa, 0);
    const units = receipt.totalQuantity || receipt.items.reduce((total, item) => total + item.quantity, 0);
    return {
      receivedAt: receipt.receivedAt.toISOString(),
      receipt: receipt.code,
      purchaseOrder: receipt.purchaseOrder.code,
      supplier: receipt.purchaseOrder.supplier?.name ?? "—",
      location: receipt.location.name,
      units,
      invoicePaisa,
      expensesPaisa,
      landedPaisa: receipt.totalCostPaisa,
      landedUnitCostPaisa: units > 0 ? Math.round(receipt.totalCostPaisa / units) : 0,
    };
  });

  return {
    key: "purchase-history",
    title: "Purchase history & costs",
    description: "Goods receipts with the invoice value, the allocated freight/duty share and the resulting landed unit cost.",
    columns: [
      { key: "receivedAt", label: "Received", format: "date" },
      { key: "receipt", label: "Receipt", format: "text" },
      { key: "purchaseOrder", label: "PO", format: "text" },
      { key: "supplier", label: "Supplier", format: "text" },
      { key: "location", label: "Location", format: "text" },
      { key: "units", label: "Units", format: "number", align: "right" },
      { key: "invoicePaisa", label: "Invoice value", format: "paisa", align: "right" },
      { key: "expensesPaisa", label: "Allocated costs", format: "paisa", align: "right" },
      { key: "landedPaisa", label: "Landed cost", format: "paisa", align: "right" },
      { key: "landedUnitCostPaisa", label: "Landed unit cost", format: "paisa", align: "right" },
    ],
    rows,
    totals: {
      invoicePaisa: rows.reduce((total, row) => total + row.invoicePaisa, 0),
      expensesPaisa: rows.reduce((total, row) => total + row.expensesPaisa, 0),
      landedPaisa: rows.reduce((total, row) => total + row.landedPaisa, 0),
      units: rows.reduce((total, row) => total + row.units, 0),
    },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
  };
}

// ------------------------------------------------------------------- money

async function profitSummary(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const [orders, courierCharges, refunds, payouts, settlements] = await Promise.all([
    prisma.order.aggregate({
      where: { businessId, deletedAt: null, status: { in: [...ORDER_STATUSES] }, placedAt: { gte: range.from, lte: range.to } },
      _sum: { grandTotalPaisa: true, inventoryCostPaisa: true, packagingCostPaisa: true, deliveryFeePaisa: true, codSurchargePaisa: true, refundedPaisa: true, paidPaisa: true },
      _count: { _all: true },
    }),
    prisma.courierCharge.aggregate({
      where: { shipment: { businessId }, createdAt: { gte: range.from, lte: range.to } },
      _sum: { amountPaisa: true },
    }),
    prisma.refund.aggregate({
      where: { businessId, status: "COMPLETED", processedAt: { gte: range.from, lte: range.to } },
      _sum: { amountPaisa: true },
    }),
    prisma.resellerPayout.aggregate({
      where: { businessId, status: "PAID", paidAt: { gte: range.from, lte: range.to } },
      _sum: { amountPaisa: true },
    }),
    prisma.courierSettlement.aggregate({
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      _sum: { courierFeePaisa: true, codChargePaisa: true, otherDeductionPaisa: true, netReceivedPaisa: true, grossCollectedPaisa: true },
    }),
  ]);

  const revenuePaisa = orders._sum.grandTotalPaisa ?? 0;
  const inventoryCostPaisa = orders._sum.inventoryCostPaisa ?? 0;
  const packagingPaisa = orders._sum.packagingCostPaisa ?? 0;
  const deliveryRevenuePaisa = orders._sum.deliveryFeePaisa ?? 0;
  const codRevenuePaisa = orders._sum.codSurchargePaisa ?? 0;
  const courierExpensePaisa = courierCharges._sum.amountPaisa ?? 0;
  const settlementFeesPaisa =
    (settlements._sum.courierFeePaisa ?? 0) + (settlements._sum.codChargePaisa ?? 0) + (settlements._sum.otherDeductionPaisa ?? 0);
  const refundedPaisa = refunds._sum.amountPaisa ?? orders._sum.refundedPaisa ?? 0;
  const resellerPayoutsPaisa = payouts._sum.amountPaisa ?? 0;

  // Gross profit is revenue − cost of the goods − the costs of getting them out of
  // the door. Reseller payouts are not an expense (the reseller's margin was never
  // our revenue); they are shown so the cash position is visible.
  const grossProfitPaisa = revenuePaisa - inventoryCostPaisa - packagingPaisa - courierExpensePaisa - refundedPaisa;

  const rows = [
    { line: "Revenue (order totals)", amountPaisa: revenuePaisa, kind: "revenue" },
    { line: "  of which delivery fees charged", amountPaisa: deliveryRevenuePaisa, kind: "memo" },
    { line: "  of which COD surcharges", amountPaisa: codRevenuePaisa, kind: "memo" },
    { line: "Inventory cost of goods sold", amountPaisa: -inventoryCostPaisa, kind: "cost" },
    { line: "Packaging & fulfilment", amountPaisa: -packagingPaisa, kind: "cost" },
    { line: "Courier charges recorded", amountPaisa: -courierExpensePaisa, kind: "cost" },
    { line: "Refunds (completed)", amountPaisa: -refundedPaisa, kind: "cost" },
    { line: "Gross profit", amountPaisa: grossProfitPaisa, kind: "total" },
    { line: "Reseller payouts made (cash out, not an expense)", amountPaisa: -resellerPayoutsPaisa, kind: "memo" },
    { line: "Courier fees per reconciled statements (reference)", amountPaisa: -settlementFeesPaisa, kind: "memo" },
  ];

  return {
    key: "profit-summary",
    title: "Gross profit",
    description:
      "Revenue is not profit: this report subtracts the recorded cost of goods, packaging, courier charges and refunds. Reseller payouts are cash movements of margin that was never our revenue.",
    columns: [
      { key: "line", label: "Line", format: "text" },
      { key: "amountPaisa", label: "Amount", format: "paisa", align: "right" },
      { key: "kind", label: "Kind", format: "text" },
    ],
    rows,
    totals: {
      revenuePaisa,
      inventoryCostPaisa,
      packagingPaisa,
      courierExpensePaisa,
      refundedPaisa,
      grossProfitPaisa,
      resellerPayoutsPaisa,
    },
    meta: {
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
      orders: orders._count._all,
      marginPercent: revenuePaisa > 0 ? Math.round((grossProfitPaisa / revenuePaisa) * 10_000) / 100 : 0,
      note: "Reseller margin is settled through payouts, not counted as revenue.",
    },
  };
}

async function paymentsCollected(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      select: { method: true, status: true, paidPaisa: true, refundedPaisa: true, amountPaisa: true },
    }),
    prisma.refund.findMany({
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      select: { method: true, status: true, amountPaisa: true, processedAt: true },
    }),
  ]);

  const byMethod = new Map<string, { method: string; count: number; collectedPaisa: number; refundedPaisa: number }>();
  for (const payment of payments) {
    const row = byMethod.get(payment.method) ?? { method: payment.method, count: 0, collectedPaisa: 0, refundedPaisa: 0 };
    row.count += 1;
    row.collectedPaisa += payment.paidPaisa;
    row.refundedPaisa += payment.refundedPaisa;
    byMethod.set(payment.method, row);
  }

  const refundRows = refunds.map((refund) => ({
    method: refund.method,
    status: refund.status,
    amountPaisa: refund.amountPaisa,
    processedAt: refund.processedAt?.toISOString() ?? "",
  }));

  const rows = [...byMethod.values()].sort((a, b) => b.collectedPaisa - a.collectedPaisa).map((row) => ({ ...row, netPaisa: row.collectedPaisa - row.refundedPaisa }));

  return {
    key: "payments-collected",
    title: "Payments & refunds",
    description: "Money actually received by method, with the refunds paid back out of each method.",
    columns: [
      { key: "method", label: "Method", format: "text" },
      { key: "count", label: "Payments", format: "number", align: "right" },
      { key: "collectedPaisa", label: "Collected", format: "paisa", align: "right" },
      { key: "refundedPaisa", label: "Refunded", format: "paisa", align: "right" },
      { key: "netPaisa", label: "Net", format: "paisa", align: "right" },
    ],
    rows,
    totals: {
      collectedPaisa: rows.reduce((total, row) => total + row.collectedPaisa, 0),
      refundedPaisa: rows.reduce((total, row) => total + row.refundedPaisa, 0),
      netPaisa: rows.reduce((total, row) => total + row.netPaisa, 0),
    },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
    sections: [
      {
        title: "Refunds in range",
        columns: [
          { key: "method", label: "Method", format: "text" },
          { key: "status", label: "Status", format: "text" },
          { key: "amountPaisa", label: "Amount", format: "paisa", align: "right" },
          { key: "processedAt", label: "Processed", format: "date" },
        ],
        rows: refundRows,
      },
    ],
  };
}

async function courierCharges(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const [charges, entries] = await Promise.all([
    prisma.courierCharge.findMany({
      where: { shipment: { businessId }, createdAt: { gte: range.from, lte: range.to } },
      select: { type: true, amountPaisa: true, shipment: { select: { providerCode: true } } },
    }),
    prisma.courierSettlementEntry.findMany({
      where: { settlement: { businessId }, createdAt: { gte: range.from, lte: range.to }, status: { in: ["UNMATCHED", "DISPUTED"] } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: { settlement: { select: { reference: true, providerCode: true, status: true } }, order: { select: { orderNumber: true } } },
    }),
  ]);

  const chargeTotals = new Map<string, { provider: string; type: string; count: number; amountPaisa: number }>();
  for (const charge of charges) {
    const key = `${charge.shipment.providerCode}:${charge.type}`;
    const row = chargeTotals.get(key) ?? { provider: charge.shipment.providerCode, type: charge.type, count: 0, amountPaisa: 0 };
    row.count += 1;
    row.amountPaisa += charge.amountPaisa;
    chargeTotals.set(key, row);
  }
  const rows = [...chargeTotals.values()].sort((a, b) => b.amountPaisa - a.amountPaisa);

  return {
    key: "courier-charges",
    title: "Courier charges & settlement differences",
    description: "What the couriers charged, plus every statement row that did not agree with the expected collection.",
    columns: [
      { key: "provider", label: "Provider", format: "text" },
      { key: "type", label: "Charge type", format: "text" },
      { key: "count", label: "Charges", format: "number", align: "right" },
      { key: "amountPaisa", label: "Amount", format: "paisa", align: "right" },
    ],
    rows,
    totals: { amountPaisa: rows.reduce((total, row) => total + row.amountPaisa, 0), charges: rows.reduce((total, row) => total + row.count, 0) },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10) },
    sections: [
      {
        title: "Unmatched / disputed statement rows",
        columns: [
          { key: "settlement", label: "Statement", format: "text" },
          { key: "provider", label: "Provider", format: "text" },
          { key: "orderNumber", label: "Order", format: "text" },
          { key: "trackingCode", label: "Tracking", format: "text" },
          { key: "grossPaisa", label: "Collected", format: "paisa", align: "right" },
          { key: "discrepancyPaisa", label: "Difference", format: "paisa", align: "right" },
          { key: "discrepancyReason", label: "Why", format: "text" },
          { key: "status", label: "Status", format: "text" },
        ],
        rows: entries.map((entry) => ({
          settlement: entry.settlement.reference,
          provider: entry.settlement.providerCode,
          orderNumber: entry.order?.orderNumber ?? "",
          trackingCode: entry.trackingCode ?? "",
          grossPaisa: entry.grossPaisa,
          discrepancyPaisa: entry.discrepancyPaisa,
          discrepancyReason: entry.discrepancyReason ?? "",
          status: entry.status,
        })),
      },
    ],
  };
}

async function resellerEarnings(businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  const resellers = await prisma.reseller.findMany({
    where: { businessId },
    select: { id: true, code: true, name: true, status: true },
    orderBy: { name: "asc" },
  });

  const [ledger, earnings] = await Promise.all([
    prisma.resellerLedgerEntry.groupBy({
      by: ["resellerId", "status", "direction", "payoutId"],
      where: { businessId },
      _sum: { amountPaisa: true },
    }),
    prisma.resellerOrderEarning.groupBy({
      by: ["resellerId", "eligibilityStatus"],
      where: { businessId, createdAt: { gte: range.from, lte: range.to } },
      _sum: { earningsPaisa: true, collectedPaisa: true },
      _count: { _all: true },
    }),
  ]);

  const rows = resellers.map((reseller) => {
    const balanceFor = (status: string, claimed?: boolean) =>
      ledger
        .filter(
          (row) =>
            row.resellerId === reseller.id &&
            row.status === status &&
            (claimed === undefined ? true : claimed ? row.payoutId !== null : row.payoutId === null),
        )
        .reduce((total, row) => total + (row.direction === "CREDIT" ? 1 : -1) * (row._sum.amountPaisa ?? 0), 0);
    const earningsFor = (status: string) =>
      earnings
        .filter((row) => row.resellerId === reseller.id && row.eligibilityStatus === status)
        .reduce((total, row) => total + (row._sum.earningsPaisa ?? 0), 0);

    return {
      code: reseller.code,
      reseller: reseller.name,
      status: reseller.status,
      orders: earnings.filter((row) => row.resellerId === reseller.id).reduce((total, row) => total + row._count._all, 0),
      earningsPaisa: earningsFor("ELIGIBLE") + earningsFor("PENDING"),
      awaitingSettlementPaisa: balanceFor("PENDING"),
      eligiblePaisa: balanceFor("ELIGIBLE", false),
      inPayoutPaisa: balanceFor("ELIGIBLE", true),
      paidPaisa: balanceFor("PAID"),
    };
  });

  return {
    key: "reseller-earnings",
    title: "Reseller earnings & unpaid balances",
    description:
      "Earnings computed from order snapshots. 'Awaiting settlement' is not payable yet: it becomes payable only once the courier COD statement has been reconciled.",
    columns: [
      { key: "code", label: "Code", format: "text" },
      { key: "reseller", label: "Reseller", format: "text" },
      { key: "status", label: "Status", format: "text" },
      { key: "orders", label: "Orders", format: "number", align: "right" },
      { key: "earningsPaisa", label: "Earnings", format: "paisa", align: "right" },
      { key: "awaitingSettlementPaisa", label: "Awaiting settlement", format: "paisa", align: "right" },
      { key: "eligiblePaisa", label: "Payable now", format: "paisa", align: "right" },
      { key: "inPayoutPaisa", label: "Claimed by a payout", format: "paisa", align: "right" },
      { key: "paidPaisa", label: "Paid", format: "paisa", align: "right" },
    ],
    rows,
    totals: {
      earningsPaisa: rows.reduce((total, row) => total + row.earningsPaisa, 0),
      awaitingSettlementPaisa: rows.reduce((total, row) => total + row.awaitingSettlementPaisa, 0),
      eligiblePaisa: rows.reduce((total, row) => total + row.eligiblePaisa, 0),
      inPayoutPaisa: rows.reduce((total, row) => total + row.inPayoutPaisa, 0),
      paidPaisa: rows.reduce((total, row) => total + row.paidPaisa, 0),
    },
    meta: { from: range.from.toISOString().slice(0, 10), to: range.to.toISOString().slice(0, 10), resellers: rows.length },
  };
}

/** Run a report by key. */
export async function runReport(key: string, businessId: string, range: { from: Date; to: Date }): Promise<ReportResult> {
  switch (key) {
    case "sales-by-date":
      return salesByDate(businessId, range);
    case "sales-by-product":
      return salesByProduct(businessId, range);
    case "inventory-valuation":
      return inventoryValuation(businessId);
    case "inventory-movements":
      return inventoryMovements(businessId, range);
    case "damaged-stock":
      return damagedStock(businessId);
    case "preorders-outstanding":
      return preordersOutstanding(businessId);
    case "purchase-history":
      return purchaseHistory(businessId, range);
    case "profit-summary":
      return profitSummary(businessId, range);
    case "payments-collected":
      return paymentsCollected(businessId, range);
    case "courier-charges":
      return courierCharges(businessId, range);
    case "reseller-earnings":
      return resellerEarnings(businessId, range);
    default:
      throw new Error(`Unknown report: ${key}`);
  }
}

/** Dashboard tiles for the reports hub. */
export async function reportHighlights(businessId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [monthOrders, inventoryValue, outstandingPreorders, awaitingSettlement] = await Promise.all([
    prisma.order.aggregate({
      where: { businessId, deletedAt: null, status: { in: [...ORDER_STATUSES] }, placedAt: { gte: monthStart } },
      _sum: { grandTotalPaisa: true, inventoryCostPaisa: true },
      _count: { _all: true },
    }),
    prisma.inventoryBalance.aggregate({
      where: { variant: { product: { businessId } } },
      _sum: { onHand: true },
    }),
    prisma.preorderCommitment.count({ where: { businessId, status: { in: ["OPEN", "PARTIALLY_ALLOCATED"] } } }),
    prisma.resellerLedgerEntry.aggregate({ where: { businessId, status: "PENDING" }, _sum: { amountPaisa: true } }),
  ]);

  return {
    monthRevenuePaisa: monthOrders._sum.grandTotalPaisa ?? 0,
    monthOrders: monthOrders._count._all,
    monthCostPaisa: monthOrders._sum.inventoryCostPaisa ?? 0,
    onHandUnits: inventoryValue._sum.onHand ?? 0,
    outstandingPreorders,
    resellerAwaitingSettlementPaisa: awaitingSettlement._sum.amountPaisa ?? 0,
  };
}
