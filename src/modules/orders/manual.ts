import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { getBusinessSettings } from "@/lib/settings";
import { normalizeBdPhone } from "@/lib/utils";
import type { SessionUser } from "@/lib/auth/session";
import { availableQuantity, defaultLocationId, lockAvailableQuantity } from "@/modules/inventory/service";
import { createPreorderCommitment } from "@/modules/preorders/service";
import { applyStockMovement } from "@/modules/inventory/service";
import { resolveVariantPrice } from "@/modules/pricing/service";
import { findOrCreateCustomer, recalculateCustomerStats } from "@/modules/customers/service";
import { resellerPriceList } from "@/modules/resellers/service";
import { recordCollectionChange } from "@/modules/resellers/service";
import { createOrder, resolveDeliveryFee, cancelPreorderForItem, type OrderActor } from "@/modules/orders/service";
import { calculateManualOrderTotals, type ManualOrderTotals } from "@/modules/orders/totals";
import { searchOrderCatalog, type OrderCatalogSearchProduct } from "@/modules/orders/catalog";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import type { ManualOrderInput, ManualOrderUpdateInput } from "@/modules/orders/schemas";
import { getCheckoutFields, requiredFieldsFor, type CheckoutFieldKey } from "@/modules/orders/checkout-fields";
import {
  INITIAL_STATUS_BY_ORDER_TYPE,
  ORDER_TYPE_LABELS,
  evaluateOrderEditPermission,
  holdsPermission,
  statusGroupOf,
  statusLabel,
  type OrderTypeValue,
  type StatusActor,
} from "@/modules/orders/status";

/**
 * Manual order creation and editing (admin & reseller screens).
 *
 * Everything the browser sends is a *selection*: product, variant, quantity,
 * discount, delivery-charge override and customer details. Prices, availability,
 * the delivery charge, the totals, the initial status and the reseller context are
 * resolved here (and re-resolved inside the creating transaction), so a crafted
 * request can never change what an order costs or how much stock it reserves.
 *
 * The workflow reuses the existing domain services — one `createOrder`, one
 * inventory ledger, one preorder allocator, one reseller ledger. There is no
 * parallel order system.
 */

export interface ManualOrderContext {
  businessId: string;
  userId: string;
  permissions: Set<string>;
  isOwner: boolean;
  /** Role label snapshot stored on the order and in the audit trail. */
  roleLabel: string | null;
  /** Set when the signed-in user owns a reseller profile. */
  resellerId: string | null;
  actorLabel: string | null;
  ipAddress?: string | null;
}

export interface SalesContext {
  channel: "ADMIN" | "RESELLER" | "IN_STORE";
  resellerId: string | null;
  priceListId: string | null;
  priceListName: string | null;
  /** Resellers must never see business costs. */
  mayViewCosts: boolean;
}

export async function manualOrderContext(session: SessionUser, meta: { ipAddress?: string | null } = {}): Promise<ManualOrderContext> {
  const reseller = await prisma.reseller.findFirst({
    where: { businessId: session.businessId, userId: session.id },
    select: { id: true, status: true },
  });
  return {
    businessId: session.businessId,
    userId: session.id,
    permissions: session.permissions instanceof Set ? session.permissions : new Set(session.permissions),
    isOwner: session.isOwner,
    roleLabel: session.roles.map((role) => role.name).slice(0, 2).join(", ") || null,
    resellerId: reseller?.id ?? null,
    actorLabel: session.name || session.email,
    ipAddress: meta.ipAddress ?? null,
  };
}

export function statusActorFrom(context: ManualOrderContext): StatusActor {
  return {
    userId: context.userId,
    permissions: context.permissions,
    isOwner: context.isOwner,
    roleLabel: context.roleLabel,
    resellerId: context.resellerId,
  };
}

export function orderActorFrom(context: ManualOrderContext): OrderActor {
  return {
    businessId: context.businessId,
    userId: context.userId,
    actorType: "USER",
    actorLabel: context.actorLabel,
    roleLabel: context.roleLabel,
    ipAddress: context.ipAddress ?? null,
  };
}

/** Without `order.view_all` a user only ever sees the orders they created. */
export function canViewAllOrders(context: ManualOrderContext): boolean {
  return holdsPermission(statusActorFrom(context), "order.view_all");
}

/** Prisma fragment that enforces reseller/creator isolation at query level. */
export function orderScopeWhere(context: ManualOrderContext): Prisma.OrderWhereInput {
  if (canViewAllOrders(context)) return {};
  return {
    OR: [
      { createdByUserId: context.userId },
      ...(context.resellerId ? [{ resellerId: context.resellerId }] : []),
    ],
  };
}

export async function resolveSalesContext(context: ManualOrderContext): Promise<SalesContext> {
  const mayViewCosts = holdsPermission(statusActorFrom(context), "order.view_cost");

  if (context.resellerId) {
    const reseller = await prisma.reseller.findFirst({
      where: { id: context.resellerId, businessId: context.businessId },
      select: { id: true, status: true },
    });
    if (!reseller) throw AppError.forbidden("This reseller profile is no longer available");
    if (reseller.status !== "ACTIVE") {
      throw AppError.invalidState(`This reseller account is ${reseller.status.toLowerCase()} and cannot take orders`);
    }
    const priceList = await withTransaction((tx) => resellerPriceList(tx, context.businessId, reseller.id));
    return {
      channel: "RESELLER",
      resellerId: reseller.id,
      priceListId: priceList.id,
      priceListName: priceList.name,
      // Confidential business costs are never exposed to a reseller.
      mayViewCosts: false,
    };
  }

  const fallback = await prisma.priceList.findFirst({
    where: { businessId: context.businessId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
    select: { id: true, name: true },
  });
  return {
    channel: "ADMIN",
    resellerId: null,
    priceListId: fallback?.id ?? null,
    priceListName: fallback?.name ?? null,
    mayViewCosts,
  };
}

// --------------------------------------------------------------------- search

export interface OrderProductSearchResult {
  products: OrderCatalogSearchProduct[];
  priceListName: string | null;
  mayViewCosts: boolean;
}

/** Server-backed, paginated product search for the order screen. */
export async function searchProductsForOrder(
  context: ManualOrderContext,
  input: { query?: string; take?: number },
): Promise<OrderProductSearchResult> {
  const actor = statusActorFrom(context);
  if (!holdsPermission(actor, "order.create") && !holdsPermission(actor, "order.view")) {
    throw AppError.forbidden("You are not allowed to take orders");
  }
  const sales = await resolveSalesContext(context);
  const products = await searchOrderCatalog(context.businessId, {
    query: input.query,
    take: input.take ?? 8,
    priceListId: sales.priceListId,
  });
  return { products, priceListName: sales.priceListName, mayViewCosts: sales.mayViewCosts };
}

// ---------------------------------------------------------------------- lines

export interface ResolvedManualLine {
  key: string;
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  attributes: Array<{ name: string; value: string }>;
  imageUrl: string | null;
  quantity: number;
  unitPricePaisa: number;
  compareAtPricePaisa: number | null;
  itemDiscountPaisa: number;
  packagingCostPaisa: number;
  unitCostPaisa: number;
  available: number;
  reserveUnits: number;
  preorderUnits: number;
  allowPreorder: boolean;
  isPreorderAllowed: boolean;
  /** Present when the line cannot be fulfilled as requested. */
  error?: string;
  note?: string | null;
}

/**
 * Duplicate lines for the same variant are merged (quantities added) instead of
 * appearing twice — the documented behaviour of "Add item" on the order screen.
 */
export function mergeManualOrderLines(
  items: Array<{ key: string; variantId: string; quantity: number; itemDiscountPaisa?: number; allowPreorder?: boolean; note?: string }>,
): Array<{ key: string; variantId: string; quantity: number; itemDiscountPaisa: number; allowPreorder: boolean; note?: string }> {
  const byVariant = new Map<string, { key: string; variantId: string; quantity: number; itemDiscountPaisa: number; allowPreorder: boolean; note?: string }>();
  for (const item of items) {
    const existing = byVariant.get(item.variantId);
    if (existing) {
      existing.quantity += item.quantity;
      existing.itemDiscountPaisa += item.itemDiscountPaisa ?? 0;
      existing.allowPreorder = existing.allowPreorder || item.allowPreorder === true;
      existing.note = existing.note ?? item.note;
    } else {
      byVariant.set(item.variantId, {
        key: item.key,
        variantId: item.variantId,
        quantity: item.quantity,
        itemDiscountPaisa: item.itemDiscountPaisa ?? 0,
        allowPreorder: item.allowPreorder === true,
        note: item.note,
      });
    }
  }
  return [...byVariant.values()];
}

interface ResolveLinesOptions {
  context: ManualOrderContext;
  sales: SalesContext;
  items: Array<{ key: string; variantId: string; quantity: number; itemDiscountPaisa?: number; allowPreorder?: boolean; note?: string }>;
  orderType: OrderTypeValue;
  /** Collect problems instead of throwing (used by the live preview). */
  soft?: boolean;
}

async function resolveManualLines(options: ResolveLinesOptions): Promise<ResolvedManualLine[]> {
  const { context, sales, orderType, soft } = options;
  const merged = mergeManualOrderLines(options.items);
  if (merged.length === 0) {
    if (soft) return [];
    throw AppError.validation("Add at least one item");
  }

  const variantIds = merged.map((item) => item.variantId);
  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds }, deletedAt: null, product: { businessId: context.businessId, deletedAt: null } },
    include: {
      product: {
        select: { id: true, name: true, sku: true, isPreorderEnabled: true, packagingCostPaisa: true, primaryImageMediaId: true },
      },
      attributeValues: { include: { attribute: { select: { name: true } }, attributeValue: { select: { value: true } } } },
    },
  });
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const balances = await prisma.inventoryBalance.findMany({
    where: { variantId: { in: variantIds } },
    select: { variantId: true, onHand: true, reserved: true, damaged: true, inspection: true },
  });
  const availableByVariant = new Map<string, number>();
  for (const balance of balances) {
    availableByVariant.set(balance.variantId, (availableByVariant.get(balance.variantId) ?? 0) + availableQuantity(balance));
  }

  const settings = await getBusinessSettings(context.businessId);
  const defaultPackaging = Number(settings["order.packaging_cost_paisa"] ?? 0);
  const isManualPreorder = orderType === "PREORDER";

  const lines: ResolvedManualLine[] = [];
  for (const item of merged) {
    const variant = variantById.get(item.variantId);
    if (!variant) {
      if (soft) continue;
      throw AppError.validation("One or more selected items are no longer available");
    }
    if (variant.status !== "ACTIVE") {
      const message = `${variant.product.name} — ${variant.name} is not available`;
      if (!soft) throw AppError.validation(message);
      lines.push(emptyLine(item, variant, message));
      continue;
    }

    const resolved = await resolveVariantPrice(variant.id, { priceListId: sales.priceListId, quantity: item.quantity });
    if (resolved.pricePaisa <= 0) {
      const message = `${variant.product.name} — ${variant.name} has no price configured`;
      if (!soft) throw AppError.validation(message);
      lines.push(emptyLine(item, variant, message));
      continue;
    }

    const available = Math.max(0, availableByVariant.get(variant.id) ?? 0);
    const quantity = Math.max(1, Math.trunc(item.quantity));
    const reserveUnits = Math.min(available, quantity);
    const preorderUnits = Math.max(0, quantity - reserveUnits);
    const cataloguePreorder = variant.isPreorderEnabled ?? variant.product.isPreorderEnabled;
    const isPreorderAllowed = isManualPreorder || item.allowPreorder === true || cataloguePreorder;

    let error: string | undefined;
    if (preorderUnits > 0 && !isPreorderAllowed) {
      error = `Only ${available} unit(s) available and this product does not accept preorders`;
      if (!soft) {
        throw AppError.insufficientStock(`${variant.product.name} (${variant.product.sku ?? "no SKU"}): ${error}`);
      }
    }

    lines.push({
      key: item.key,
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      variantName: variant.name,
      sku: variant.product.sku ?? "",
      attributes: variant.attributeValues.map((value) => ({ name: value.attribute.name, value: value.attributeValue.value })),
      imageUrl: null,
      quantity,
      unitPricePaisa: resolved.pricePaisa,
      compareAtPricePaisa: resolved.compareAtPricePaisa,
      itemDiscountPaisa: Math.max(0, Math.trunc(item.itemDiscountPaisa ?? 0)),
      packagingCostPaisa: variant.packagingCostPaisa ?? variant.product.packagingCostPaisa ?? defaultPackaging,
      unitCostPaisa: sales.mayViewCosts ? (variant.costPaisa ?? 0) : 0,
      available,
      reserveUnits,
      preorderUnits,
      allowPreorder: item.allowPreorder === true || isManualPreorder,
      isPreorderAllowed,
      error,
      note: item.note ?? null,
    });
  }

  return lines;
}

function emptyLine(
  item: { key: string; variantId: string; quantity: number },
  variant: { id: string; name: string; product: { id: string; name: string; sku: string | null } },
  error: string,
): ResolvedManualLine {
  return {
    key: item.key,
    variantId: item.variantId,
    productId: variant.product.id,
    productName: variant.product.name,
    variantName: variant.name,
    sku: variant.product.sku ?? "",
    attributes: [],
    imageUrl: null,
    quantity: item.quantity,
    unitPricePaisa: 0,
    compareAtPricePaisa: null,
    itemDiscountPaisa: 0,
    packagingCostPaisa: 0,
    unitCostPaisa: 0,
    available: 0,
    reserveUnits: 0,
    preorderUnits: 0,
    allowPreorder: false,
    isPreorderAllowed: false,
    error,
  };
}

// ------------------------------------------------------------------- customer

export interface ManualCustomerInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  districtCode?: string | null;
  addressLine?: string | null;
  area?: string | null;
}

const FIELD_TO_KEY: Record<string, CheckoutFieldKey> = {
  phone: "phone",
  name: "full_name",
  districtCode: "district",
  addressLine: "address",
  area: "area",
  email: "email",
};

/**
 * Validate the customer block for the chosen order type.
 *
 * Delivery orders follow the configured checkout fields; in-store orders never
 * force customer details, but whatever is entered must still be valid.
 */
export async function validateManualCustomer(
  context: ManualOrderContext,
  orderType: OrderTypeValue,
  customer: ManualCustomerInput,
): Promise<{ customer: ManualCustomerInput; phoneNormalized: string | null; fieldErrors: Record<string, string[]> }> {
  const fields = await getCheckoutFields(context.businessId);
  const required = new Set(requiredFieldsFor(fields, orderType));
  const enabled = new Set(fields.filter((field) => field.isEnabled).map((field) => field.key));
  const fieldErrors: Record<string, string[]> = {};

  const clean: ManualCustomerInput = {
    name: (customer.name ?? "").trim() || null,
    phone: (customer.phone ?? "").trim() || null,
    email: (customer.email ?? "").trim() || null,
    districtCode: (customer.districtCode ?? "").trim() || null,
    addressLine: (customer.addressLine ?? "").trim() || null,
    area: (customer.area ?? "").trim() || null,
  };

  const phoneNormalized = clean.phone ? normalizeBdPhone(clean.phone) : null;
  if (clean.phone && !phoneNormalized) {
    fieldErrors.phone = ["Enter a valid Bangladesh mobile number (for example 01712345678)"];
  }
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) {
    fieldErrors.email = ["Enter a valid email address"];
  }
  if (clean.districtCode) {
    const district = await prisma.district.findUnique({ where: { code: clean.districtCode }, select: { code: true, isActive: true } });
    if (!district || !district.isActive) fieldErrors.districtCode = ["Choose a district"];
  }

  for (const key of required) {
    const field = Object.entries(FIELD_TO_KEY).find(([, value]) => value === key)?.[0];
    if (!field) continue;
    const value = clean[field as keyof ManualCustomerInput];
    if (!value || !String(value).trim()) {
      const label = fields.find((entry) => entry.key === key)?.label ?? key;
      (fieldErrors[field] ??= []).push(`${label} is required for ${ORDER_TYPE_LABELS[orderType].toLowerCase()} orders`);
    }
  }

  // A disabled field is dropped rather than stored, so the configuration is honoured.
  for (const [field, key] of Object.entries(FIELD_TO_KEY)) {
    if (!enabled.has(key)) clean[field as keyof ManualCustomerInput] = null;
  }

  return { customer: clean, phoneNormalized, fieldErrors };
}

// -------------------------------------------------------------------- preview

export interface ManualOrderPreview {
  orderType: OrderTypeValue;
  lines: ResolvedManualLine[];
  totals: ManualOrderTotals;
  delivery: {
    calculatedPaisa: number;
    chargedPaisa: number;
    overridden: boolean;
    zoneId: string | null;
    zoneName: string | null;
    freeDeliveryApplied: boolean;
  };
  codSurchargePaisa: number;
  initialStatus: string;
  initialStatusLabel: string;
  requiredFields: CheckoutFieldKey[];
  fieldErrors: Record<string, string[]>;
  warnings: string[];
  mayViewCosts: boolean;
}

/**
 * Authoritative preview used by the live summary on the order screen.
 *
 * The same resolution runs again inside the creating transaction; the preview
 * exists so the operator sees the real numbers before submitting, never so the
 * browser can dictate them.
 */
export async function previewManualOrder(context: ManualOrderContext, input: ManualOrderInput): Promise<ManualOrderPreview> {
  const sales = await resolveSalesContext(context);
  const orderType = resolveOrderType(input.orderType, sales);
  const lines = await resolveManualLines({ context, sales, items: input.items, orderType, soft: true });

  const { customer, fieldErrors } = await validateManualCustomer(context, orderType, input.customer ?? {});

  const subtotalPaisa = lines.reduce((total, line) => total + line.unitPricePaisa * line.quantity, 0);
  const delivery = await resolveDeliveryFee(
    prisma,
    context.businessId,
    { districtCode: customer.districtCode ?? null, storefrontId: input.storefrontId ?? null },
    subtotalPaisa,
  );

  const settings = await getBusinessSettings(context.businessId);
  const paymentMethod = effectivePaymentMethod(orderType, input.paymentMethod);
  const codSurchargePaisa =
    paymentMethod === "COD" && orderType !== "IN_STORE"
      ? delivery.codFeePaisa > 0
        ? delivery.codFeePaisa
        : Number(settings["order.cod_surcharge_paisa"] ?? 0)
      : 0;

  const maxDiscountPercent = Number(settings["order.max_discount_percent"] ?? 100);
  const totals = calculateManualOrderTotals({
    orderType,
    lines: lines.map((line) => ({
      key: line.key,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPricePaisa: line.unitPricePaisa,
      itemDiscountPaisa: line.itemDiscountPaisa,
      packagingCostPaisa: line.packagingCostPaisa,
      unitCostPaisa: line.unitCostPaisa,
    })),
    orderDiscount:
      input.orderDiscountType && input.orderDiscountValue != null && input.orderDiscountValue > 0
        ? { type: input.orderDiscountType, value: input.orderDiscountValue }
        : null,
    maxDiscountBps: Math.max(0, Math.min(10_000, Math.round(maxDiscountPercent * 100))),
    deliveryFee: { calculatedPaisa: delivery.calculatedFeePaisa, manualPaisa: input.deliveryFeeManualPaisa ?? null },
    extraChargesPaisa: (input.extraCharges ?? []).reduce((total, charge) => total + charge.amountPaisa, 0),
    codSurchargePaisa,
    paymentMethod,
  });

  const fields = await getCheckoutFields(context.businessId);
  const warnings = [...totals.warnings, ...lines.flatMap((line) => (line.error ? [`${line.productName}: ${line.error}`] : []))];
  if (orderType === "IN_STORE" && (input.deliveryFeeManualPaisa ?? 0) > 0) {
    warnings.push("In-store orders do not carry a courier delivery charge");
  }
  const preorderUnits = lines.reduce((total, line) => total + line.preorderUnits, 0);
  if (preorderUnits > 0) {
    warnings.push(
      `${preorderUnits} unit(s) are not covered by stock and will be recorded as preorder commitments (allocated FIFO when stock arrives)`,
    );
  }

  const initialStatus =
    orderType === "IN_STORE" ? "COMPLETED" : INITIAL_STATUS_BY_ORDER_TYPE[orderType];

  return {
    orderType,
    lines,
    totals,
    delivery: {
      calculatedPaisa: delivery.calculatedFeePaisa,
      chargedPaisa: totals.deliveryFeePaisa,
      overridden: totals.deliveryFeeOverridden,
      zoneId: delivery.zoneId,
      zoneName: delivery.zoneName,
      freeDeliveryApplied: delivery.freeDeliveryApplied,
    },
    codSurchargePaisa,
    initialStatus,
    initialStatusLabel: statusLabel(initialStatus),
    requiredFields: requiredFieldsFor(fields, orderType),
    fieldErrors,
    warnings,
    mayViewCosts: sales.mayViewCosts,
  };
}

function resolveOrderType(requested: OrderTypeValue | undefined, sales: SalesContext): OrderTypeValue {
  const orderType = requested ?? "ONLINE_DELIVERY";
  // A reseller's own counter sale is still an in-store order; the channel records
  // that a reseller created it.
  void sales;
  return orderType;
}

function effectivePaymentMethod(orderType: OrderTypeValue, requested?: string): string {
  if (orderType === "IN_STORE") return requested && requested !== "COD" ? requested : "CASH";
  return requested ?? "COD";
}

// --------------------------------------------------------------------- create

export interface CreateManualOrderResult {
  orderId: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  orderType: OrderTypeValue;
  grandTotalPaisa: number;
  collectiblePaisa: number;
  reservedUnits: number;
  preorderUnits: number;
  reused: boolean;
}

/**
 * Create an order from the manual order screen.
 *
 * The initial status is decided here from the order type — the client never sends
 * one. Delivery and pre-order orders start in the pre-courier group
 * (`PROCESSING`); in-store sales follow the documented counter lifecycle and are
 * completed and paid immediately by `createOrder`.
 */
export async function createManualOrder(
  context: ManualOrderContext,
  input: ManualOrderInput,
): Promise<CreateManualOrderResult> {
  const actor = statusActorFrom(context);
  if (!holdsPermission(actor, "order.create")) {
    throw AppError.forbidden("You are not allowed to create orders");
  }
  const sales = await resolveSalesContext(context);
  const orderType = resolveOrderType(input.orderType, sales);

  const preview = await previewManualOrder(context, input);
  const hardErrors = Object.entries(preview.fieldErrors).filter(([, messages]) => messages.length > 0);
  if (hardErrors.length > 0) {
    throw AppError.validation("Check the customer details", hardErrors.map(([field, messages]) => ({ path: field, message: messages[0] })));
  }
  const unusable = preview.lines.filter((line) => line.error || line.unitPricePaisa <= 0);
  if (unusable.length > 0) {
    throw AppError.validation(
      unusable.map((line) => `${line.productName}: ${line.error ?? "no price configured"}`).join("; "),
      unusable.map((line) => ({ path: `item.${line.key}`, message: line.error ?? "no price configured" })),
    );
  }
  if (preview.lines.length === 0) throw AppError.validation("Add at least one item");

  const paymentMethod = effectivePaymentMethod(orderType, input.paymentMethod) as "COD" | "CASH" | "BKASH" | "SSLCOMMERZ" | "BANK_TRANSFER" | "MANUAL";
  const customer = preview.lines.length > 0 ? input.customer ?? {} : {};

  const orderInput = createOrderInputSchema.parse({
    channel: orderType === "IN_STORE" ? "IN_STORE" : sales.channel,
    orderType,
    resellerId: sales.resellerId ?? undefined,
    priceListId: sales.priceListId ?? undefined,
    storefrontId: input.storefrontId ?? undefined,
    customerId: input.customerId ?? undefined,
    customerName: (customer.name ?? "").trim() || undefined,
    customerPhone: (customer.phone ?? "").trim() || undefined,
    customerEmail: (customer.email ?? "").trim() || undefined,
    shippingDistrictCode: (customer.districtCode ?? "").trim() || undefined,
    shippingAddressLine: (customer.addressLine ?? "").trim() || undefined,
    shippingArea: (customer.area ?? "").trim() || undefined,
    deliveryNotes: input.courierNote?.trim() || undefined,
    customerNote: input.customerNote?.trim() || undefined,
    internalNote: input.orderNote?.trim() || undefined,
    paymentMethod,
    deliveryFeePaisa: preview.totals.deliveryFeeOverridden ? preview.totals.deliveryFeePaisa : undefined,
    deliveryFeeNote: input.deliveryFeeNote?.trim() || undefined,
    deliveryZoneId: preview.delivery.zoneId ?? undefined,
    discountType: input.orderDiscountType ?? undefined,
    discountValue: input.orderDiscountValue ?? undefined,
    discountTotalPaisa: preview.totals.orderDiscountPaisa,
    discountReason: input.orderDiscountType === "PERCENTAGE" ? `Order discount ${input.orderDiscountValue! / 100}%` : undefined,
    codSurchargePaisa: preview.codSurchargePaisa,
    extraCharges: input.extraCharges,
    expectedDeliveryAt: input.expectedDeliveryAt ?? undefined,
    items: preview.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      discountPaisa: line.itemDiscountPaisa,
      packagingCostPaisa: line.packagingCostPaisa,
      allowPreorder: line.allowPreorder,
      note: line.note ?? undefined,
    })),
    idempotencyKey: input.idempotencyKey,
  });

  const created = await createOrder(orderActorFrom(context), orderInput);

  // A reseller's own order records what they collect from their customer, exactly
  // like the reseller screen does: default is the order total plus the packaging
  // the business bills them. Earnings stay pending until the COD settlement is
  // reconciled (see modules/resellers/earnings.ts).
  if (sales.resellerId && !created.reused) {
    const order = await prisma.order.findUnique({ where: { id: created.order.id } });
    const reseller = await prisma.reseller.findUnique({ where: { id: sales.resellerId } });
    if (order && reseller) {
      const packagingPaisa = reseller.packagingIncluded ? 0 : order.packagingCostPaisa;
      await recordCollectionChange(
        { businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: context.actorLabel },
        {
          orderId: order.id,
          amountPaisa: order.grandTotalPaisa + packagingPaisa,
          reason: "Collection recorded when the reseller created the order",
        },
      ).catch((error: unknown) => logger.warn("Failed to snapshot the reseller collection", { orderId: order.id }, error));
    }
  }

  return {
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    status: created.order.status,
    statusLabel: statusLabel(created.order.status),
    orderType,
    grandTotalPaisa: created.order.grandTotalPaisa,
    collectiblePaisa: orderType === "IN_STORE" ? 0 : created.order.grandTotalPaisa,
    reservedUnits: created.reservedUnits,
    preorderUnits: created.preorderUnits,
    reused: created.reused,
  };
}

// --------------------------------------------------------------------- update

export interface UpdateManualOrderResult {
  orderId: string;
  orderNumber: string;
  status: string;
  grandTotalPaisa: number;
  changedFields: string[];
  postCourierEdit: boolean;
  shipmentUpdated: boolean;
  warnings: string[];
}

/**
 * Edit an order.
 *
 * Allowed while the order is inside the actor's permitted status range. Editing
 * after the courier stage needs `order.edit_post_courier` plus an explicit
 * confirmation, and it is refused outright when the change would silently
 * contradict a shipment the courier already accepted (cancel the shipment first).
 * Unit prices are re-resolved by the server; they can never be typed in.
 */
export async function updateManualOrder(
  context: ManualOrderContext,
  input: ManualOrderUpdateInput,
): Promise<UpdateManualOrderResult> {
  const actor = statusActorFrom(context);
  const scope = orderScopeWhere(context);

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, businessId: context.businessId, deletedAt: null, ...scope },
    include: {
      items: { orderBy: { position: "asc" } },
      shipments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) throw AppError.notFound("Order not found");

  const shipment = order.shipments[0] ?? null;
  const shipmentState = !shipment
    ? "NONE"
    : shipment.providerConsignmentId
      ? ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"].includes(shipment.status)
        ? "FINAL"
        : "CREATED"
      : "REQUESTED";

  const editDecision = evaluateOrderEditPermission({
    actor,
    subject: { status: order.status, orderType: order.orderType, channel: order.channel, shipmentState },
    confirmed: input.confirmPostCourierEdit,
  });
  if (!editDecision.allowed) {
    throw AppError.forbidden(editDecision.deniedReason ?? "You are not allowed to edit this order");
  }
  if (order.status === "CANCELLED") {
    throw AppError.invalidState("A cancelled order cannot be edited — reopen it first with the administrative override");
  }

  const dispatchedUnits = order.items.reduce((total, item) => total + item.dispatchedQuantity, 0);
  const itemsChanged = input.items != null;
  if (itemsChanged && dispatchedUnits > 0) {
    throw AppError.invalidState(
      `${dispatchedUnits} unit(s) were already dispatched, so the items can no longer change. Cancel the order or use an exchange instead.`,
    );
  }
  if (shipment?.providerConsignmentId && (itemsChanged || input.customer != null || input.deliveryFeeManualPaisa !== undefined)) {
    throw AppError.invalidState(
      `The courier already accepted shipment ${shipment.trackingCode ?? shipment.internalCode}. Cancel that shipment with the courier before changing the items, the address or the collectible amount.`,
    );
  }

  const sales = await resolveSalesContext(context);
  const orderType = order.orderType as OrderTypeValue;
  const warnings: string[] = [];
  const changedFields: string[] = [];

  const customerInput = input.customer ?? null;
  const validated = customerInput
    ? await validateManualCustomer(context, orderType, {
        name: customerInput.name ?? order.customerName ?? "",
        phone: customerInput.phone ?? order.customerPhone ?? "",
        email: customerInput.email ?? order.customerEmail ?? "",
        districtCode: customerInput.districtCode ?? order.shippingDistrictCode ?? "",
        addressLine: customerInput.addressLine ?? order.shippingAddressLine ?? "",
        area: customerInput.area ?? order.shippingArea ?? "",
      })
    : null;
  if (validated && Object.values(validated.fieldErrors).some((messages) => messages.length > 0)) {
    throw AppError.validation(
      "Check the customer details",
      Object.entries(validated.fieldErrors).map(([field, messages]) => ({ path: field, message: messages[0] })),
    );
  }

  const lines = itemsChanged
    ? await resolveManualLines({ context, sales, items: input.items!, orderType, soft: false })
    : order.items.map((item) => ({
        key: item.id,
        variantId: item.variantId ?? "",
        productId: item.productId ?? "",
        productName: item.productName,
        variantName: item.variantName,
        sku: item.sku,
        attributes: [],
        imageUrl: null,
        quantity: item.quantity,
        unitPricePaisa: item.unitPricePaisa,
        compareAtPricePaisa: item.compareAtPricePaisa,
        itemDiscountPaisa: item.discountPaisa,
        packagingCostPaisa: item.packagingCostPaisa,
        unitCostPaisa: item.unitCostPaisa,
        available: 0,
        reserveUnits: item.reservedQuantity,
        preorderUnits: item.preorderQuantity,
        allowPreorder: item.isPreorder,
        isPreorderAllowed: item.isPreorder,
        note: item.note,
      }));

  const paymentMethod = "COD";
  const delivery = await resolveDeliveryFee(
    prisma,
    context.businessId,
    {
      districtCode: validated?.customer.districtCode ?? order.shippingDistrictCode,
      storefrontId: order.storefrontId,
      deliveryZoneId: order.deliveryZoneId,
    },
    lines.reduce((total, line) => total + line.unitPricePaisa * line.quantity, 0),
  );

  const settings = await getBusinessSettings(context.businessId);
  const manualDelivery = input.deliveryFeeManualPaisa === undefined ? order.deliveryFeePaisa : input.deliveryFeeManualPaisa;
  const codSurchargePaisa =
    paymentMethod === "COD" && orderType !== "IN_STORE"
      ? delivery.codFeePaisa > 0
        ? delivery.codFeePaisa
        : Number(settings["order.cod_surcharge_paisa"] ?? 0)
      : 0;

  const totals = calculateManualOrderTotals({
    orderType,
    lines: lines.map((line) => ({
      key: line.key,
      variantId: line.variantId,
      quantity: line.quantity,
      unitPricePaisa: line.unitPricePaisa,
      itemDiscountPaisa: line.itemDiscountPaisa,
      packagingCostPaisa: line.packagingCostPaisa,
      unitCostPaisa: line.unitCostPaisa,
    })),
    orderDiscount:
      input.orderDiscountType && input.orderDiscountValue != null
        ? { type: input.orderDiscountType, value: input.orderDiscountValue }
        : order.discountType && order.discountValue != null
          ? { type: order.discountType, value: order.discountValue }
          : null,
    maxDiscountBps: Math.max(0, Math.min(10_000, Math.round(Number(settings["order.max_discount_percent"] ?? 100) * 100))),
    deliveryFee: { calculatedPaisa: delivery.calculatedFeePaisa, manualPaisa: manualDelivery ?? null },
    extraChargesPaisa: input.extraCharges ? input.extraCharges.reduce((total, charge) => total + charge.amountPaisa, 0) : order.extraChargePaisa,
    codSurchargePaisa,
    paymentMethod,
  });
  warnings.push(...totals.warnings);

  const before = {
    status: order.status,
    grandTotalPaisa: order.grandTotalPaisa,
    deliveryFeePaisa: order.deliveryFeePaisa,
    discountTotalPaisa: order.discountTotalPaisa,
    customerName: order.customerName,
    customerPhone: order.customerPhoneNormalized,
    shippingDistrictCode: order.shippingDistrictCode,
    shippingAddressLine: order.shippingAddressLine,
    itemCount: order.items.length,
    units: order.items.reduce((total, item) => total + item.quantity, 0),
  };

  const updated = await withTransaction(async (tx) => {
    const locationId = await defaultLocationId(context.businessId);

    // ------------------------------------------------------------ items
    if (itemsChanged) {
      await applyItemChanges(tx, {
        businessId: context.businessId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        locationId,
        actorUserId: context.userId,
        existing: order.items,
        requested: lines,
      });
    }

    // ------------------------------------------------------------ customer
    let customerId = order.customerId;
    if (validated) {
      const { customer, phoneNormalized } = validated;
      if (customer.phone || customer.name) {
        const record = await findOrCreateCustomer(tx, {
          businessId: context.businessId,
          name: customer.name ?? order.customerName ?? "Customer",
          phone: customer.phone ?? order.customerPhone ?? "",
          email: customer.email || undefined,
          districtCode: customer.districtCode ?? undefined,
          addressLine: customer.addressLine ?? undefined,
          area: customer.area ?? undefined,
          createdByUserId: context.userId,
        });
        customerId = record.id;
      }
      const patch: Prisma.OrderUpdateInput = {
        customerName: validated.customer.name ?? order.customerName,
        customerPhone: validated.customer.phone ?? order.customerPhone,
        customerPhoneNormalized: phoneNormalized ?? order.customerPhoneNormalized,
        customerEmail: validated.customer.email ?? order.customerEmail,
        shippingDistrictCode: validated.customer.districtCode ?? order.shippingDistrictCode,
        shippingAddressLine: validated.customer.addressLine ?? order.shippingAddressLine,
        shippingArea: validated.customer.area ?? order.shippingArea,
      };
      await tx.order.update({ where: { id: order.id }, data: patch });
      for (const [field, value] of Object.entries(patch)) {
        if (String(before[field as keyof typeof before] ?? "") !== String(value ?? "")) changedFields.push(field);
      }

      if (validated.customer.addressLine && validated.customer.name) {
        const existingAddress = await tx.orderAddress.findFirst({ where: { orderId: order.id, type: "SHIPPING" } });
        const addressData = {
          recipientName: validated.customer.name,
          phone: validated.customer.phone ?? "",
          phoneNormalized,
          districtCode: validated.customer.districtCode ?? null,
          addressLine: validated.customer.addressLine,
          area: validated.customer.area ?? null,
        };
        if (existingAddress) await tx.orderAddress.update({ where: { id: existingAddress.id }, data: addressData });
        else await tx.orderAddress.create({ data: { orderId: order.id, type: "SHIPPING", ...addressData } });
      }
    }

    // ------------------------------------------------------------ money
    const moneyPatch: Prisma.OrderUpdateInput = {
      itemsSubtotalPaisa: totals.itemsSubtotalPaisa,
      discountTotalPaisa: totals.itemDiscountPaisa + totals.orderDiscountPaisa,
      discountType: input.orderDiscountType ?? order.discountType,
      discountValue: input.orderDiscountValue ?? order.discountValue,
      deliveryFeePaisa: totals.deliveryFeePaisa,
      deliveryFeeCalculatedPaisa: totals.deliveryFeeCalculatedPaisa,
      extraChargePaisa: totals.extraChargePaisa,
      packagingCostPaisa: totals.packagingCostPaisa,
      codSurchargePaisa: totals.codSurchargePaisa,
      inventoryCostPaisa: totals.inventoryCostPaisa,
      grandTotalPaisa: totals.grandTotalPaisa,
      codCollectPaisa: orderType === "IN_STORE" ? 0 : totals.grandTotalPaisa,
      duePaisa: order.paymentStatus === "PAID" ? 0 : Math.max(0, totals.grandTotalPaisa - order.paidPaisa),
      updatedByUserId: context.userId,
      ...(input.courierNote !== undefined ? { deliveryNotes: input.courierNote || null } : {}),
      ...(input.orderNote !== undefined ? { internalNote: input.orderNote || null } : {}),
      ...(input.customerNote !== undefined ? { customerNote: input.customerNote || null } : {}),
      ...(totals.deliveryFeeOverridden
        ? {
            deliveryFeeOverriddenAt: new Date(),
            deliveryFeeOverriddenByUserId: context.userId,
            deliveryFeeOverrideNote: input.deliveryFeeNote ?? null,
          }
        : { deliveryFeeOverriddenAt: null, deliveryFeeOverriddenByUserId: null, deliveryFeeOverrideNote: null }),
    };
    const updatedOrder = await tx.order.update({ where: { id: order.id }, data: moneyPatch });

    // Adjustments are rewritten from the new totals so the order's own breakdown
    // always adds up; each rewrite is recorded in the audit trail below.
    await tx.orderAdjustment.deleteMany({ where: { orderId: order.id, type: { in: ["DISCOUNT", "DELIVERY_FEE", "EXTRA_CHARGE", "COD_SURCHARGE"] } } });
    if (totals.itemDiscountPaisa + totals.orderDiscountPaisa > 0) {
      await tx.orderAdjustment.create({
        data: {
          orderId: order.id,
          type: "DISCOUNT",
          label: totals.orderDiscountPaisa > 0 && totals.itemDiscountPaisa > 0 ? "Item and order discounts" : totals.orderDiscountPaisa > 0 ? "Order discount" : "Item discounts",
          amountPaisa: -(totals.itemDiscountPaisa + totals.orderDiscountPaisa),
          createdByUserId: context.userId,
        },
      });
    }
    if (totals.deliveryFeePaisa > 0) {
      await tx.orderAdjustment.create({
        data: {
          orderId: order.id,
          type: "DELIVERY_FEE",
          label: totals.deliveryFeeOverridden ? "Delivery fee (manual override)" : "Delivery fee",
          amountPaisa: totals.deliveryFeePaisa,
          note: totals.deliveryFeeOverridden ? `Calculated ${totals.deliveryFeeCalculatedPaisa}` : null,
          createdByUserId: totals.deliveryFeeOverridden ? context.userId : null,
        },
      });
    }
    for (const charge of input.extraCharges ?? []) {
      await tx.orderAdjustment.create({
        data: { orderId: order.id, type: "EXTRA_CHARGE", label: charge.label, amountPaisa: charge.amountPaisa, note: charge.note ?? null, createdByUserId: context.userId },
      });
    }
    if (totals.codSurchargePaisa > 0) {
      await tx.orderAdjustment.create({
        data: { orderId: order.id, type: "COD_SURCHARGE", label: "Cash on delivery charge", amountPaisa: totals.codSurchargePaisa, createdByUserId: context.userId },
      });
    }

    // Keep an already-requested (not yet accepted) shipment in sync so the courier
    // push uses the corrected data instead of the stale snapshot.
    let shipmentUpdated = false;
    if (shipment && !shipment.providerConsignmentId) {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          recipientName: updatedOrder.customerName ?? shipment.recipientName,
          recipientPhone: updatedOrder.customerPhone ?? shipment.recipientPhone,
          recipientPhoneNormalized: updatedOrder.customerPhoneNormalized ?? shipment.recipientPhoneNormalized,
          recipientDistrictCode: updatedOrder.shippingDistrictCode ?? shipment.recipientDistrictCode,
          recipientAddress: updatedOrder.shippingAddressLine ?? shipment.recipientAddress,
          recipientArea: updatedOrder.shippingArea ?? shipment.recipientArea,
          recipientNote: updatedOrder.deliveryNotes ?? shipment.recipientNote,
          codAmountPaisa: updatedOrder.codCollectPaisa,
          expectedCollectionPaisa: updatedOrder.codCollectPaisa,
          deliveryFeePaisa: updatedOrder.deliveryFeePaisa,
        },
      });
      shipmentUpdated = true;
    }

    if (customerId && customerId !== order.customerId) await recalculateCustomerStats(tx, customerId);

    await recordAudit(
      {
        businessId: context.businessId,
        actorType: "USER",
        actorUserId: context.userId,
        actorLabel: context.actorLabel,
        action: editDecision.isPostCourier ? "order.edited_post_courier" : "order.edited",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber} edited (${statusLabel(order.status)})`,
        before: before as unknown as Prisma.InputJsonValue,
        after: {
          grandTotalPaisa: totals.grandTotalPaisa,
          deliveryFeePaisa: totals.deliveryFeePaisa,
          deliveryFeeCalculatedPaisa: totals.deliveryFeeCalculatedPaisa,
          discountTotalPaisa: totals.itemDiscountPaisa + totals.orderDiscountPaisa,
          customerName: updatedOrder.customerName,
          shippingDistrictCode: updatedOrder.shippingDistrictCode,
          units: lines.reduce((total, line) => total + line.quantity, 0),
          postCourierEdit: editDecision.isPostCourier,
          confirmed: editDecision.requiresConfirmation,
        } as unknown as Prisma.InputJsonValue,
        changedFields,
        reason: input.reason ?? null,
        ipAddress: context.ipAddress ?? null,
      },
      tx,
    );

    return { order: updatedOrder, shipmentUpdated };
  });

  return {
    orderId: updated.order.id,
    orderNumber: updated.order.orderNumber,
    status: updated.order.status,
    grandTotalPaisa: updated.order.grandTotalPaisa,
    changedFields,
    postCourierEdit: editDecision.isPostCourier,
    shipmentUpdated: updated.shipmentUpdated,
    warnings,
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Apply item changes to an order that has not dispatched anything yet.
 *
 * Removing a line releases its reservation and cancels its preorder commitment;
 * raising a quantity reserves what is available and promises the rest as a
 * preorder (only when that is allowed); lowering one releases the difference.
 * Every movement carries an idempotency key, so a retried edit cannot move the
 * same unit twice.
 */
async function applyItemChanges(
  tx: Tx,
  input: {
    businessId: string;
    orderId: string;
    orderNumber: string;
    locationId: string;
    actorUserId: string | null;
    existing: Array<{
      id: string;
      variantId: string | null;
      quantity: number;
      dispatchedQuantity: number;
      cancelledQuantity: number;
      reservedQuantity: number;
      preorderQuantity: number;
      position: number;
    }>;
    requested: ResolvedManualLine[];
  },
): Promise<void> {
  const requestedByVariant = new Map(input.requested.map((line) => [line.variantId, line]));
  const existingByVariant = new Map(input.existing.filter((item) => item.variantId).map((item) => [item.variantId as string, item]));

  // ------------------------------------------------------------- removed lines
  for (const item of input.existing) {
    if (!item.variantId || requestedByVariant.has(item.variantId)) continue;
    const reservation = await tx.stockReservation.findUnique({ where: { orderItemId: item.id } });
    const outstanding = reservation ? reservation.quantity - reservation.consumedQuantity - reservation.releasedQuantity : 0;
    if (outstanding > 0) {
      const key = `order:${input.orderId}:edit-release:${item.id}`;
      const movement = await applyStockMovement(tx, {
        businessId: input.businessId,
        locationId: reservation!.locationId,
        variantId: item.variantId,
        type: "RESERVATION_RELEASE",
        reservedDelta: -outstanding,
        sourceType: "Order",
        sourceId: input.orderId,
        reference: input.orderNumber,
        reason: "line_removed_on_edit",
        actorUserId: input.actorUserId,
        idempotencyKey: key,
      });
      await tx.reservationAllocation.create({
        data: { reservationId: reservation!.id, quantity: outstanding, kind: "RELEASE", inventoryMovementId: movement.movementId },
      });
      await tx.stockReservation.update({
        where: { id: reservation!.id },
        data: { status: "RELEASED", releasedAt: new Date(), releasedQuantity: { increment: outstanding }, releasedReason: "Removed while editing the order" },
      });
    }
    await cancelPreorderForItem(tx, { orderItemId: item.id, reason: "Removed while editing the order", actorUserId: input.actorUserId });
    await tx.orderItem.delete({ where: { id: item.id } });
  }

  // --------------------------------------------------- added and changed lines
  for (const [index, line] of input.requested.entries()) {
    const existingItem = existingByVariant.get(line.variantId);

    if (!existingItem) {
      const available = await lockAvailableQuantity(tx, input.locationId, line.variantId);
      const reserveNow = Math.min(available, line.quantity);
      const shortfall = line.quantity - reserveNow;
      if (shortfall > 0 && !line.isPreorderAllowed) {
        throw AppError.insufficientStock(`${line.productName} (${line.sku}): only ${available} unit(s) available`);
      }

      const created = await tx.orderItem.create({
        data: {
          orderId: input.orderId,
          variantId: line.variantId,
          productId: line.productId,
          sku: line.sku,
          productName: line.productName,
          variantName: line.variantName,
          variantAttributes: line.attributes as unknown as Prisma.InputJsonValue,
          quantity: line.quantity,
          unitPricePaisa: line.unitPricePaisa,
          compareAtPricePaisa: line.compareAtPricePaisa,
          unitCostPaisa: line.unitCostPaisa,
          packagingCostPaisa: line.packagingCostPaisa,
          discountPaisa: line.itemDiscountPaisa,
          lineSubtotalPaisa: line.unitPricePaisa * line.quantity,
          lineTotalPaisa: line.unitPricePaisa * line.quantity - line.itemDiscountPaisa,
          reservedQuantity: reserveNow,
          preorderQuantity: shortfall,
          isPreorder: shortfall > 0,
          status: shortfall > 0 ? "PREORDER_PENDING" : reserveNow > 0 ? "RESERVED" : "PENDING",
          note: line.note ?? null,
          position: index,
        },
      });

      if (reserveNow > 0) {
        const key = `order:${input.orderId}:edit-reserve:${created.id}`;
        const reservation = await tx.stockReservation.create({
          data: {
            businessId: input.businessId,
            locationId: input.locationId,
            variantId: line.variantId,
            orderId: input.orderId,
            orderItemId: created.id,
            quantity: reserveNow,
            idempotencyKey: key,
          },
        });
        const movement = await applyStockMovement(tx, {
          businessId: input.businessId,
          locationId: input.locationId,
          variantId: line.variantId,
          type: "RESERVATION",
          reservedDelta: reserveNow,
          sourceType: "Order",
          sourceId: input.orderId,
          reference: input.orderNumber,
          reason: "line_added_on_edit",
          actorUserId: input.actorUserId,
          idempotencyKey: key,
        });
        await tx.reservationAllocation.create({
          data: { reservationId: reservation.id, quantity: reserveNow, kind: "RESERVE", inventoryMovementId: movement.movementId },
        });
      }
      if (shortfall > 0) {
        await createPreorderCommitment(tx, {
          businessId: input.businessId,
          locationId: input.locationId,
          variantId: line.variantId,
          orderId: input.orderId,
          orderItemId: created.id,
          quantity: shortfall,
          expectedAt: null,
          note: `Added while editing ${input.orderNumber}`,
        });
      }
      continue;
    }

    // Existing line: re-price, re-quantity and reconcile the reservation.
    const delta = line.quantity - existingItem.quantity;
    const reservation = await tx.stockReservation.findUnique({ where: { orderItemId: existingItem.id } });
    const commitment = await tx.preorderCommitment.findUnique({ where: { orderItemId: existingItem.id } });
    const reservedOutstanding = reservation ? reservation.quantity - reservation.consumedQuantity - reservation.releasedQuantity : 0;
    const openPreorder = commitment && commitment.status !== "CANCELLED" ? commitment.quantity - commitment.allocatedQuantity : 0;

    if (delta > 0) {
      const available = await lockAvailableQuantity(tx, input.locationId, line.variantId);
      const reserveNow = Math.min(available, delta);
      const shortfall = delta - reserveNow;
      if (shortfall > 0 && !line.isPreorderAllowed) {
        throw AppError.insufficientStock(`${line.productName} (${line.sku}): only ${available} unit(s) available`);
      }
      if (reserveNow > 0) {
        const key = `order:${input.orderId}:edit-increase:${existingItem.id}:${reserveNow}`;
        if (reservation) {
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { quantity: reservation.quantity + reserveNow, status: "ACTIVE" },
          });
          const movement = await applyStockMovement(tx, {
            businessId: input.businessId,
            locationId: reservation.locationId,
            variantId: line.variantId,
            type: "RESERVATION",
            reservedDelta: reserveNow,
            sourceType: "Order",
            sourceId: input.orderId,
            reference: input.orderNumber,
            reason: "quantity_increased_on_edit",
            actorUserId: input.actorUserId,
            idempotencyKey: key,
          });
          await tx.reservationAllocation.create({
            data: { reservationId: reservation.id, quantity: reserveNow, kind: "RESERVE", inventoryMovementId: movement.movementId },
          });
        } else {
          const created = await tx.stockReservation.create({
            data: {
              businessId: input.businessId,
              locationId: input.locationId,
              variantId: line.variantId,
              orderId: input.orderId,
              orderItemId: existingItem.id,
              quantity: reserveNow,
              idempotencyKey: key,
            },
          });
          const movement = await applyStockMovement(tx, {
            businessId: input.businessId,
            locationId: input.locationId,
            variantId: line.variantId,
            type: "RESERVATION",
            reservedDelta: reserveNow,
            sourceType: "Order",
            sourceId: input.orderId,
            reference: input.orderNumber,
            reason: "quantity_increased_on_edit",
            actorUserId: input.actorUserId,
            idempotencyKey: key,
          });
          await tx.reservationAllocation.create({
            data: { reservationId: created.id, quantity: reserveNow, kind: "RESERVE", inventoryMovementId: movement.movementId },
          });
        }
      }
      if (shortfall > 0) {
        if (commitment && commitment.status !== "CANCELLED") {
          await tx.preorderCommitment.update({
            where: { id: commitment.id },
            data: { quantity: commitment.quantity + shortfall, status: openPreorder > 0 ? "OPEN" : "PARTIALLY_ALLOCATED" },
          });
          await applyStockMovement(tx, {
            businessId: input.businessId,
            locationId: input.locationId,
            variantId: line.variantId,
            type: "CORRECTION",
            preorderCommittedDelta: shortfall,
            sourceType: "PreorderCommitment",
            sourceId: commitment.id,
            reference: input.orderNumber,
            reason: "quantity_increased_on_edit",
            actorUserId: input.actorUserId,
            idempotencyKey: `order:${input.orderId}:edit-preorder:${existingItem.id}:${shortfall}`,
          });
        } else {
          await createPreorderCommitment(tx, {
            businessId: input.businessId,
            locationId: input.locationId,
            variantId: line.variantId,
            orderId: input.orderId,
            orderItemId: existingItem.id,
            quantity: shortfall,
            expectedAt: null,
            note: `Quantity increased while editing ${input.orderNumber}`,
          });
        }
      }
    } else if (delta < 0) {
      const reduce = -delta;
      const fromPreorder = Math.min(openPreorder, reduce);
      const fromReservation = reduce - fromPreorder;
      if (fromReservation > reservedOutstanding) {
        throw AppError.invalidState(
          `${line.productName}: only ${reservedOutstanding + openPreorder} unit(s) can still be released from this line`,
        );
      }
      if (fromPreorder > 0 && commitment) {
        await tx.preorderCommitment.update({
          where: { id: commitment.id },
          data: { quantity: Math.max(0, commitment.quantity - fromPreorder) },
        });
        await applyStockMovement(tx, {
          businessId: input.businessId,
          locationId: input.locationId,
          variantId: line.variantId,
          type: "CORRECTION",
          preorderCommittedDelta: -fromPreorder,
          sourceType: "PreorderCommitment",
          sourceId: commitment.id,
          reference: input.orderNumber,
          reason: "quantity_reduced_on_edit",
          actorUserId: input.actorUserId,
          idempotencyKey: `order:${input.orderId}:edit-preorder-release:${existingItem.id}:${fromPreorder}`,
        });
      }
      if (fromReservation > 0 && reservation) {
        const key = `order:${input.orderId}:edit-decrease:${existingItem.id}:${fromReservation}`;
        const movement = await applyStockMovement(tx, {
          businessId: input.businessId,
          locationId: reservation.locationId,
          variantId: line.variantId,
          type: "RESERVATION_RELEASE",
          reservedDelta: -fromReservation,
          sourceType: "Order",
          sourceId: input.orderId,
          reference: input.orderNumber,
          reason: "quantity_reduced_on_edit",
          actorUserId: input.actorUserId,
          idempotencyKey: key,
        });
        await tx.reservationAllocation.create({
          data: { reservationId: reservation.id, quantity: fromReservation, kind: "RELEASE", inventoryMovementId: movement.movementId },
        });
        const remaining = reservation.quantity - fromReservation;
        await tx.stockReservation.update({
          where: { id: reservation.id },
          data: remaining > 0 ? { quantity: remaining } : { quantity: 0, status: "RELEASED", releasedAt: new Date(), releasedReason: "Quantity reduced while editing" },
        });
      }
    }

    await tx.orderItem.update({
      where: { id: existingItem.id },
      data: {
        quantity: line.quantity,
        unitPricePaisa: line.unitPricePaisa,
        compareAtPricePaisa: line.compareAtPricePaisa,
        unitCostPaisa: line.unitCostPaisa,
        packagingCostPaisa: line.packagingCostPaisa,
        discountPaisa: line.itemDiscountPaisa,
        lineSubtotalPaisa: line.unitPricePaisa * line.quantity,
        lineTotalPaisa: line.unitPricePaisa * line.quantity - line.itemDiscountPaisa,
        note: line.note ?? null,
        position: index,
      },
    });
  }
}

/** Order-type aware guard used by the courier dispatch workflow. */
export function orderTypeLabel(orderType: OrderTypeValue | string | null): string {
  return ORDER_TYPE_LABELS[(orderType ?? "ONLINE_DELIVERY") as OrderTypeValue] ?? "Online delivery";
}

export { statusGroupOf };
