import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { nextDocumentNumber } from "@/lib/numbering";
import { getBusinessSettings } from "@/lib/settings";
import { normalizeBdPhone } from "@/lib/utils";
import { applyStockMovement, defaultLocationId, lockAvailableQuantity } from "@/modules/inventory/service";
import { createPreorderCommitment, fulfilPreorderCommitment } from "@/modules/preorders/service";
import { resolveVariantPrice } from "@/modules/pricing/service";
import { findOrCreateCustomer, recalculateCustomerStats } from "@/modules/customers/service";
import type { CreateOrderInput } from "@/modules/orders/schemas";

/**
 * Order lifecycle.
 *
 * The rules that matter, in one place:
 *  - every money value is computed on the server from snapshots taken inside the
 *    same transaction, never from a browser payload;
 *  - stock is reserved (and shortages promised as preorders) inside the same
 *    transaction that creates the order, so two concurrent orders can never
 *    reserve the same unit;
 *  - dispatch consumes the reservation and decrements physical stock exactly
 *    once, guarded by a per-item idempotency key;
 *  - cancelling releases reservations, cancels preorder commitments and never
 *    double-releases (again, per-item idempotency keys).
 */

export interface OrderActor {
  businessId: string;
  userId?: string | null;
  customerId?: string | null;
  actorType?: "USER" | "CUSTOMER" | "SYSTEM" | "API_KEY";
  actorLabel?: string | null;
  ipAddress?: string | null;
}

type Tx = Prisma.TransactionClient;

/**
 * Accept both shapes of customer data: a nested `customer` object (checkout API)
 * and the flat fields the staff form posts.
 */
export function normalizeCustomerInput(input: CreateOrderInput): {
  name: string | null;
  phone: string | null;
  email?: string;
  districtCode?: string;
  addressLine?: string;
  area?: string;
} | null {
  if (input.customer) {
    return {
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email || undefined,
      districtCode: input.customer.districtCode,
      addressLine: input.customer.addressLine,
      area: input.customer.area,
    };
  }
  if (input.customerName || input.customerPhone) {
    return {
      name: input.customerName ?? "Customer",
      phone: input.customerPhone ?? null,
      email: input.customerEmail || undefined,
      districtCode: input.shippingDistrictCode,
      addressLine: input.shippingAddressLine,
      area: input.shippingArea,
    };
  }
  return null;
}

// --------------------------------------------------------------------- creation

export interface CreateOrderResult {
  order: { id: string; orderNumber: string; status: string; grandTotalPaisa: number; duePaisa: number };
  reservedUnits: number;
  preorderUnits: number;
  paymentId: string | null;
  reused: boolean;
}

export async function createOrder(actor: OrderActor, input: CreateOrderInput): Promise<CreateOrderResult> {
  const existing = await prisma.order.findFirst({
    where: { businessId: actor.businessId, idempotencyKey: input.idempotencyKey },
    select: { id: true, orderNumber: true, status: true, grandTotalPaisa: true, duePaisa: true },
  });
  if (existing) {
    return {
      order: {
        id: existing.id,
        orderNumber: existing.orderNumber,
        status: existing.status,
        grandTotalPaisa: existing.grandTotalPaisa,
        duePaisa: existing.duePaisa,
      },
      reservedUnits: 0,
      preorderUnits: 0,
      paymentId: null,
      reused: true,
    };
  }

  const settings = await getBusinessSettings(actor.businessId);

  return withTransaction(async (tx) => {
    const locationId = await defaultLocationId(actor.businessId);

    // ------------------------------------------------------------------ customer
    const customer = normalizeCustomerInput(input);
    let customerId = input.customerId ?? actor.customerId ?? null;
    if (customer) {
      const created = await findOrCreateCustomer(tx, {
        businessId: actor.businessId,
        name: customer.name ?? "Customer",
        phone: customer.phone ?? "",
        email: customer.email || undefined,
        districtCode: customer.districtCode,
        addressLine: customer.addressLine,
        area: customer.area,
        createdByUserId: actor.userId ?? null,
      });
      customerId = created.id;
    }

    const phoneNormalized = customer?.phone ? normalizeBdPhone(customer.phone) : null;

    // -------------------------------------------------------------------- pricing
    const priceListId = await resolvePriceListId(tx, actor.businessId, input);
    const variantIds = [...new Set(input.items.map((item) => item.variantId))];
    const variants = await tx.variant.findMany({
      where: { id: { in: variantIds }, product: { businessId: actor.businessId, deletedAt: null } },
      include: {
        product: { select: { id: true, name: true, isPreorderEnabled: true } },
        attributeValues: { include: { attribute: true, attributeValue: true } },
      },
    });
    if (variants.length !== variantIds.length) throw AppError.validation("One or more items are no longer available");
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    const preparedItems: Array<{
      variantId: string;
      productId: string;
      sku: string;
      productName: string;
      variantName: string;
      variantAttributes: Prisma.InputJsonValue;
      quantity: number;
      unitPricePaisa: number;
      compareAtPricePaisa: number | null;
      unitCostPaisa: number;
      packagingCostPaisa: number;
      discountPaisa: number;
      lineSubtotalPaisa: number;
      lineTotalPaisa: number;
      taxPaisa: number;
      isPreorderAllowed: boolean;
      pricingSource: string;
      priceListId: string | null;
      note: string | null;
    }> = [];

    let itemsSubtotalPaisa = 0;
    let packagingCostPaisa = 0;

    for (const item of input.items) {
      const variant = variantById.get(item.variantId)!;
      if (variant.status !== "ACTIVE") throw AppError.validation(`${variant.sku} is not available`);

      const canOverride = input.channel === "ADMIN" || input.channel === "RESELLER" || input.channel === "IN_STORE";
      const resolved = await resolveVariantPrice(variant.id, { priceListId });
      const unitPricePaisa = canOverride && item.unitPricePaisa != null ? item.unitPricePaisa : resolved.pricePaisa;
      if (unitPricePaisa <= 0) throw AppError.validation(`${variant.sku} has no price configured`);

      const lineSubtotalPaisa = unitPricePaisa * item.quantity;
      const discountPaisa = Math.min(item.discountPaisa, lineSubtotalPaisa);
      const itemPackaging = item.packagingCostPaisa ?? variant.packagingCostPaisa ?? 0;
      // Tax is not part of v1 (no VAT module); the column stays so a later step can
      // add it without touching historical orders.
      const taxPaisa = 0;

      preparedItems.push({
        variantId: variant.id,
        productId: variant.product.id,
        sku: variant.sku,
        productName: variant.product.name,
        variantName: variant.name,
        variantAttributes: variant.attributeValues.map((value) => ({
          name: value.attribute.name,
          value: value.attributeValue.value,
        })) as Prisma.InputJsonValue,
        quantity: item.quantity,
        unitPricePaisa,
        compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
        unitCostPaisa: variant.costPaisa ?? 0,
        packagingCostPaisa: itemPackaging,
        discountPaisa,
        lineSubtotalPaisa,
        lineTotalPaisa: lineSubtotalPaisa - discountPaisa,
        taxPaisa,
        isPreorderAllowed: variant.product.isPreorderEnabled,
        pricingSource: resolved.source,
        priceListId: resolved.priceListId,
        note: item.note ?? null,
      });

      itemsSubtotalPaisa += lineSubtotalPaisa;
      packagingCostPaisa += itemPackaging * item.quantity;
    }

    const discountTotalPaisa = Math.min(input.discountTotalPaisa, itemsSubtotalPaisa);
    const delivery = await resolveDeliveryFee(tx, actor.businessId, input, itemsSubtotalPaisa, locationId);
    const extraChargePaisa = input.extraCharges.reduce((total, charge) => total + charge.amountPaisa, 0);
    // Cash on delivery is charged by the delivery zone when the zone defines a fee;
    // otherwise the business-wide setting applies. Staff can still override it.
    const isCashOnDelivery = (input.paymentMethod ?? "COD") === "COD";
    const codSurchargePaisa =
      input.codSurchargePaisa ??
      (isCashOnDelivery
        ? delivery.codFeePaisa > 0
          ? delivery.codFeePaisa
          : Number(settings["order.cod_surcharge_paisa"] ?? 0)
        : 0);
    const inventoryCostPaisa = preparedItems.reduce((total, item) => total + item.unitCostPaisa * item.quantity, 0);
    const grandTotalPaisa =
      itemsSubtotalPaisa - discountTotalPaisa + delivery.feePaisa + extraChargePaisa + packagingCostPaisa + codSurchargePaisa;

    const isInStore = input.channel === "IN_STORE";
    const orderNumber = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "order" });

    const order = await tx.order.create({
      data: {
        businessId: actor.businessId,
        orderNumber,
        storefrontId: input.storefrontId ?? null,
        channel: input.channel,
        customerId,
        resellerId: input.resellerId ?? null,
        status: isInStore ? "COMPLETED" : "PENDING",
        paymentStatus: isInStore ? "PAID" : "UNPAID",
        fulfillmentStatus: isInStore ? "FULFILLED" : "UNFULFILLED",
        itemsSubtotalPaisa,
        discountTotalPaisa,
        deliveryFeePaisa: delivery.feePaisa,
        extraChargePaisa,
        packagingCostPaisa,
        codSurchargePaisa,
        inventoryCostPaisa,
        grandTotalPaisa,
        paidPaisa: isInStore ? grandTotalPaisa : 0,
        duePaisa: isInStore ? 0 : grandTotalPaisa,
        codCollectPaisa: isInStore ? 0 : grandTotalPaisa,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        customerPhoneNormalized: phoneNormalized,
        customerEmail: customer?.email || null,
        shippingDistrictCode: customer?.districtCode ?? null,
        shippingAddressLine: customer?.addressLine ?? null,
        shippingArea: customer?.area ?? null,
        deliveryZoneId: delivery.zoneId,
        customerNote: input.customerNote ?? null,
        internalNote: input.internalNote ?? null,
        sourceReference: input.sourceReference ?? null,
        createdByUserId: actor.userId ?? null,
        idempotencyKey: input.idempotencyKey,
        ...(isInStore ? { confirmedAt: new Date(), processingAt: new Date(), completedAt: new Date() } : {}),
      },
    });

    const createdItems: Array<{ id: string; variantId: string | null; quantity: number; isPreorderAllowed: boolean; productName: string; sku: string }> = [];
    for (const [index, item] of preparedItems.entries()) {
      const created = await tx.orderItem.create({
        data: {
          orderId: order.id,
          variantId: item.variantId,
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          variantName: item.variantName,
          variantAttributes: item.variantAttributes,
          quantity: item.quantity,
          unitPricePaisa: item.unitPricePaisa,
          compareAtPricePaisa: item.compareAtPricePaisa,
          unitCostPaisa: item.unitCostPaisa,
          packagingCostPaisa: item.packagingCostPaisa,
          discountPaisa: item.discountPaisa,
          lineSubtotalPaisa: item.lineSubtotalPaisa,
          lineTotalPaisa: item.lineTotalPaisa,
          taxPaisa: item.taxPaisa,
          pricingSource: item.pricingSource,
          priceListId: item.priceListId,
          note: item.note,
          position: index,
          status: isInStore ? "DELIVERED" : "PENDING",
        },
      });
      createdItems.push({
        id: created.id,
        variantId: created.variantId,
        quantity: created.quantity,
        isPreorderAllowed: item.isPreorderAllowed,
        productName: item.productName,
        sku: item.sku,
      });
    }

    if (discountTotalPaisa > 0) {
      await tx.orderAdjustment.create({
        data: { orderId: order.id, type: "DISCOUNT", label: input.discountReason ?? "Order discount", amountPaisa: -discountTotalPaisa, createdByUserId: actor.userId ?? null },
      });
    }
    if (delivery.feePaisa > 0) {
      await tx.orderAdjustment.create({ data: { orderId: order.id, type: "DELIVERY_FEE", label: "Delivery fee", amountPaisa: delivery.feePaisa } });
    }
    for (const charge of input.extraCharges) {
      await tx.orderAdjustment.create({
        data: { orderId: order.id, type: "EXTRA_CHARGE", label: charge.label, amountPaisa: charge.amountPaisa, note: charge.note ?? null },
      });
    }
    if (codSurchargePaisa > 0) {
      await tx.orderAdjustment.create({ data: { orderId: order.id, type: "COD_SURCHARGE", label: "Cash on delivery charge", amountPaisa: codSurchargePaisa } });
    }

    if (customer?.addressLine && customer.name) {
      await tx.orderAddress.create({
        data: {
          orderId: order.id,
          type: "SHIPPING",
          recipientName: customer.name!,
          phone: customer.phone ?? "",
          phoneNormalized,
          districtCode: customer.districtCode ?? null,
          addressLine: customer.addressLine!,
          area: customer.area ?? null,
        },
      });
    }

    // ------------------------------------------------ reservation / preorder split
    let reservedUnits = 0;
    let preorderUnits = 0;

    for (const item of createdItems) {
      if (!item.variantId) continue;
      const available = await lockAvailableQuantity(tx, locationId, item.variantId);
      const reserveNow = Math.min(available, item.quantity);
      const shortfall = item.quantity - reserveNow;

      if (reserveNow > 0) {
        const reservation = await tx.stockReservation.create({
          data: {
            businessId: actor.businessId,
            locationId,
            variantId: item.variantId,
            orderId: order.id,
            orderItemId: item.id,
            quantity: reserveNow,
            idempotencyKey: `order:${order.id}:reserve:${item.id}`,
          },
        });
        const movement = await applyStockMovement(tx, {
          businessId: actor.businessId,
          locationId,
          variantId: item.variantId,
          type: "RESERVATION",
          reservedDelta: reserveNow,
          sourceType: "Order",
          sourceId: order.id,
          reference: order.orderNumber,
          actorUserId: actor.userId ?? null,
          idempotencyKey: `order:${order.id}:reserve-move:${item.id}`,
        });
        await tx.reservationAllocation.create({
          data: { reservationId: reservation.id, quantity: reserveNow, kind: "RESERVE", inventoryMovementId: movement.movementId },
        });
        await tx.orderItem.update({
          where: { id: item.id },
          data: { reservedQuantity: reserveNow, status: "RESERVED" },
        });
        reservedUnits += reserveNow;
      }

      if (shortfall > 0) {
        // A shortfall is only allowed when the product accepts preorders. Anything
        // else is a real oversell and must fail loudly instead of promising stock
        // that does not exist.
        if (!item.isPreorderAllowed) {
          throw AppError.insufficientStock(
            `${item.productName} (${item.sku}) only has ${reserveNow} unit(s) left — enable preorders for this product to accept the rest`,
          );
        }
        await createPreorderCommitment(tx, {
          businessId: actor.businessId,
          locationId,
          variantId: item.variantId,
          orderId: order.id,
          orderItemId: item.id,
          quantity: shortfall,
          expectedAt: null,
          note: `Shortfall of ${shortfall} unit(s) on ${order.orderNumber}`,
        });
        await tx.orderItem.update({
          where: { id: item.id },
          data: { preorderQuantity: shortfall, isPreorder: true, status: "PREORDER_PENDING" },
        });
        preorderUnits += shortfall;
      }
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER",
        toStatus: order.status,
        note: isInStore ? "In-store sale completed" : "Order created",
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
        actorCustomerId: actor.customerId ?? null,
      },
    });

    let paymentId: string | null = null;
    if (isInStore) {
      const payment = await tx.payment.create({
        data: {
          businessId: actor.businessId,
          orderId: order.id,
          method: "CASH",
          status: "PAID",
          amountPaisa: grandTotalPaisa,
          paidPaisa: grandTotalPaisa,
          collectedByUserId: actor.userId ?? null,
          recordedByUserId: actor.userId ?? null,
          receivedAt: new Date(),
          verifiedAt: new Date(),
          note: "Paid at the counter",
        },
      });
      paymentId = payment.id;
      await dispatchUnits(tx, {
        actor,
        order: { id: order.id, orderNumber: order.orderNumber, businessId: actor.businessId },
        reason: "in_store_sale",
      });
      if (customerId) await recalculateCustomerStats(tx, customerId);
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorLabel: actor.actorLabel ?? null,
        actorCustomerId: actor.customerId ?? null,
        action: "order.created",
        entityType: "Order",
        entityId: order.id,
        summary: `${orderNumber} created from ${input.channel.toLowerCase()} for ${grandTotalPaisa} paisa`,
        after: { orderNumber, grandTotalPaisa, reservedUnits, preorderUnits, channel: input.channel },
        ipAddress: actor.ipAddress ?? null,
      },
      tx,
    );

    logger.info("order.created", { orderId: order.id, orderNumber, channel: input.channel, reservedUnits, preorderUnits });

    // The customer row keeps lifetime aggregates; every new order refreshes them.
    if (customerId) await recalculateCustomerStats(tx, customerId);

    return {
      order: { id: order.id, orderNumber, status: order.status, grandTotalPaisa, duePaisa: isInStore ? 0 : grandTotalPaisa },
      reservedUnits,
      preorderUnits,
      paymentId,
      reused: false,
    };
  });
}

async function resolvePriceListId(tx: Tx, businessId: string, input: CreateOrderInput): Promise<string | null> {
  if (input.priceListId) {
    const list = await tx.priceList.findFirst({ where: { id: input.priceListId, businessId }, select: { id: true } });
    if (!list) throw AppError.validation("The selected price list does not exist");
    return list.id;
  }
  if (input.storefrontId) {
    const storefrontList = await tx.priceList.findFirst({
      where: { businessId, storefrontId: input.storefrontId, status: "ACTIVE" },
      orderBy: { priority: "desc" },
      select: { id: true },
    });
    if (storefrontList) return storefrontList.id;
  }
  const fallback = await tx.priceList.findFirst({
    where: { businessId, status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
    select: { id: true },
  });
  return fallback?.id ?? null;
}

async function resolveDeliveryFee(
  tx: Tx,
  businessId: string,
  input: CreateOrderInput,
  itemsSubtotalPaisa: number,
  locationId: string,
): Promise<{ feePaisa: number; zoneId: string | null; codFeePaisa: number }> {
  void locationId;
  if (input.deliveryFeePaisa != null) return { feePaisa: input.deliveryFeePaisa, zoneId: input.deliveryZoneId ?? null, codFeePaisa: 0 };

  const districtCode = normalizeCustomerInput(input)?.districtCode;
  if (!districtCode) return { feePaisa: 0, zoneId: null, codFeePaisa: 0 };

  const zone = input.deliveryZoneId
    ? await tx.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, businessId } })
    : await tx.deliveryZone.findFirst({
        where: {
          businessId,
          districtCode,
          isActive: true,
          ...(input.storefrontId ? { OR: [{ storefrontId: input.storefrontId }, { storefrontId: null }] } : {}),
        },
        orderBy: [{ storefrontId: "desc" }, { feePaisa: "asc" }],
      });
  if (!zone) return { feePaisa: 0, zoneId: null, codFeePaisa: 0 };

  const freeThreshold = zone.freeDeliveryThresholdPaisa;
  if (freeThreshold != null && itemsSubtotalPaisa >= freeThreshold) {
    return { feePaisa: 0, zoneId: zone.id, codFeePaisa: zone.codFeePaisa };
  }
  return { feePaisa: zone.feePaisa, zoneId: zone.id, codFeePaisa: zone.codFeePaisa };
}

// ------------------------------------------------------------------- preorders

/**
 * Cancel the preorder promise attached to an order line, inside the caller's
 * transaction. Unallocated quantity leaves the `preorderCommitted` counter;
 * already-allocated quantity goes back to sellable stock. The two quantities are
 * disjoint, so cancelling an order can never release the same unit twice.
 */
export async function cancelPreorderForItem(
  tx: Tx,
  input: { orderItemId: string; reason: string; actorUserId?: string | null },
): Promise<void> {
  const commitment = await tx.preorderCommitment.findUnique({ where: { orderItemId: input.orderItemId } });
  if (!commitment) return;
  if (!["OPEN", "PARTIALLY_ALLOCATED", "ALLOCATED"].includes(commitment.status)) return;

  const unallocated = commitment.quantity - commitment.allocatedQuantity;
  if (unallocated > 0 || commitment.allocatedQuantity > 0) {
    await applyStockMovement(tx, {
      businessId: commitment.businessId,
      locationId: commitment.locationId,
      variantId: commitment.variantId,
      type: "CORRECTION",
      preorderCommittedDelta: -unallocated,
      reservedDelta: -commitment.allocatedQuantity,
      sourceType: "PreorderCommitment",
      sourceId: commitment.id,
      reason: "preorder_cancelled",
      note: input.reason,
      actorUserId: input.actorUserId ?? null,
    });
  }

  await tx.preorderCommitment.update({
    where: { id: commitment.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason, allocatedQuantity: 0 },
  });
}

// ------------------------------------------------------------------ lifecycle

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "READY_TO_SHIP", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "DELIVERED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function transitionOrder(
  actor: OrderActor,
  input: { orderId: string; status: "CONFIRMED" | "PROCESSING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "COMPLETED"; note?: string },
) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (!ALLOWED_TRANSITIONS[order.status]?.includes(input.status)) {
      throw AppError.invalidState(`An order in ${order.status} cannot move to ${input.status}`);
    }

    const timestamps: Record<string, Prisma.OrderUpdateInput> = {
      CONFIRMED: { confirmedAt: new Date() },
      PROCESSING: { processingAt: new Date() },
      READY_TO_SHIP: { readyToShipAt: new Date() },
      SHIPPED: { shippedAt: new Date(), fulfillmentStatus: "PARTIALLY_FULFILLED" },
      DELIVERED: { deliveredAt: new Date(), fulfillmentStatus: "FULFILLED" },
      COMPLETED: { completedAt: new Date() },
    };

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: input.status, updatedByUserId: actor.userId ?? null, ...(timestamps[input.status] ?? {}) },
    });

    if (input.status === "DELIVERED" || input.status === "COMPLETED") {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: { in: ["RESERVED", "ALLOCATED", "DISPATCHED", "PREORDER_PENDING"] } },
        data: { status: "DELIVERED" },
      });
      if (order.customerId) await recalculateCustomerStats(tx, order.customerId);
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER",
        fromStatus: order.status,
        toStatus: input.status,
        note: input.note ?? null,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
        actorCustomerId: actor.customerId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorCustomerId: actor.customerId ?? null,
        action: "order.status_changed",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber}: ${order.status} → ${input.status}`,
        before: { status: order.status },
        after: { status: input.status },
        reason: input.note ?? null,
      },
      tx,
    );

    return updated;
  });
}

export async function cancelOrder(actor: OrderActor, input: { orderId: string; reason: string; restock?: boolean }) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!order) throw AppError.notFound("Order not found");
    if (order.status === "CANCELLED") throw AppError.invalidState("This order is already cancelled");
    if (order.status === "SHIPPED" && actor.actorType === "CUSTOMER") {
      throw AppError.invalidState("This order has already shipped — contact support");
    }

    let releasedUnits = 0;
    let restockedUnits = 0;

    for (const item of order.items) {
      if (!item.variantId) continue;
      const reservation = await tx.stockReservation.findUnique({ where: { orderItemId: item.id } });
      if (reservation && reservation.status !== "RELEASED" && reservation.status !== "CONSUMED") {
        const outstanding = reservation.quantity - reservation.consumedQuantity - reservation.releasedQuantity;
        if (outstanding > 0) {
          const key = `order:${order.id}:release:${item.id}`;
          const existingMove = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: key } });
          if (!existingMove) {
            const movement = await applyStockMovement(tx, {
              businessId: actor.businessId,
              locationId: reservation.locationId,
              variantId: item.variantId,
              type: "RESERVATION_RELEASE",
              reservedDelta: -outstanding,
              sourceType: "Order",
              sourceId: order.id,
              reference: order.orderNumber,
              reason: input.reason,
              actorUserId: actor.userId ?? null,
              idempotencyKey: key,
            });
            await tx.reservationAllocation.create({
              data: { reservationId: reservation.id, quantity: outstanding, kind: "RELEASE", inventoryMovementId: movement.movementId },
            });
            releasedUnits += outstanding;
          }
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { status: "RELEASED", releasedAt: new Date(), releasedQuantity: { increment: outstanding }, releasedReason: input.reason },
          });
        }
      }

      if (reservation && reservation.status === "CONSUMED" && input.restock !== false) {
        const dispatched = item.dispatchedQuantity;
        if (dispatched > 0) {
          const key = `order:${order.id}:restock:${item.id}`;
          const existingMove = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: key } });
          if (!existingMove) {
            await applyStockMovement(tx, {
              businessId: actor.businessId,
              locationId: reservation.locationId,
              variantId: item.variantId,
              type: "SALE_REVERSAL",
              onHandDelta: dispatched,
              sourceType: "Order",
              sourceId: order.id,
              reference: order.orderNumber,
              reason: input.reason,
              actorUserId: actor.userId ?? null,
              idempotencyKey: key,
            });
            restockedUnits += dispatched;
          }
        }
      }

      await cancelPreorderForItem(tx, { orderItemId: item.id, reason: input.reason, actorUserId: actor.userId ?? null });
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          cancelledQuantity: item.cancelledQuantity + Math.max(item.quantity - item.dispatchedQuantity - item.cancelledQuantity, 0),
          status: "CANCELLED",
        },
      });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        fulfillmentStatus: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: input.reason,
        cancelledByUserId: actor.userId ?? null,
        codCollectPaisa: 0,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER",
        fromStatus: order.status,
        toStatus: "CANCELLED",
        note: input.reason,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
        actorCustomerId: actor.customerId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorCustomerId: actor.customerId ?? null,
        action: "order.cancelled",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber} cancelled: ${input.reason}`,
        after: { releasedUnits, restockedUnits, restock: input.restock !== false },
        reason: input.reason,
      },
      tx,
    );

    return { order: updated, releasedUnits, restockedUnits };
  });
}

/**
 * Consume reservations and take stock out of the location.
 *
 * Guarded per order item by an idempotency key, so calling this twice (retry,
 * double click, repeated webhook) moves stock once.
 */
async function dispatchUnits(
  tx: Tx,
  input: { actor: OrderActor; order: { id: string; orderNumber: string; businessId: string }; reason?: string },
): Promise<{ units: number }> {
  const items = await tx.orderItem.findMany({ where: { orderId: input.order.id } });
  let units = 0;

  for (const item of items) {
    if (!item.variantId) continue;
    const reservation = await tx.stockReservation.findUnique({ where: { orderItemId: item.id } });
    const outstanding = reservation ? reservation.quantity - reservation.consumedQuantity - reservation.releasedQuantity : 0;

    // Stock promised through a preorder is reserved on the balance without a
    // reservation row of its own, so it is released from `reserved` here too.
    const commitment = await tx.preorderCommitment.findUnique({ where: { orderItemId: item.id } });
    const allocated = commitment && commitment.status !== "CANCELLED" && !commitment.fulfilledAt ? commitment.allocatedQuantity : 0;

    const pending = item.quantity - item.dispatchedQuantity - item.cancelledQuantity;
    const dispatchable = outstanding + allocated;
    if (dispatchable < pending) {
      throw AppError.invalidState(
        `${item.sku}: ${pending - dispatchable} unit(s) are still on preorder — allocate stock or cancel the line before dispatching`,
      );
    }
    if (dispatchable <= 0) continue;

    const key = `order:${input.order.id}:dispatch:${item.id}`;
    const existingMove = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: key } });
    if (existingMove) continue;

    const movement = await applyStockMovement(tx, {
      businessId: input.order.businessId,
      locationId: reservation?.locationId ?? (await defaultLocationId(input.order.businessId)),
      variantId: item.variantId,
      type: "SALE_DISPATCH",
      onHandDelta: -dispatchable,
      reservedDelta: -dispatchable,
      sourceType: "Order",
      sourceId: input.order.id,
      reference: input.order.orderNumber,
      reason: input.reason ?? "order_dispatched",
      actorUserId: input.actor.userId ?? null,
      idempotencyKey: key,
    });

    if (reservation && outstanding > 0) {
      await tx.reservationAllocation.create({
        data: { reservationId: reservation.id, quantity: outstanding, kind: "CONSUME", inventoryMovementId: movement.movementId },
      });
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          status: "CONSUMED",
          consumedAt: new Date(),
          consumedQuantity: { increment: outstanding },
        },
      });
    }

    await tx.orderItem.update({
      where: { id: item.id },
      data: { dispatchedQuantity: item.dispatchedQuantity + dispatchable, status: "DISPATCHED", reservedQuantity: 0, allocatedQuantity: 0 },
    });
    await fulfilPreorderCommitment(tx, item.id);
    units += dispatchable;
  }

  return { units };
}

/** Move an order to SHIPPED without a courier (own delivery, in-store handover). */
export async function markOrderReadyForCourier(actor: OrderActor, orderId: string) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (!["CONFIRMED", "PROCESSING", "READY_TO_SHIP"].includes(order.status)) {
      throw AppError.invalidState("Only confirmed or in-progress orders can be packed");
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: "READY_TO_SHIP", readyToShipAt: new Date(), updatedByUserId: actor.userId ?? null },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "FULFILLMENT",
        fromStatus: order.status,
        toStatus: "READY_TO_SHIP",
        note: "Packed and ready for dispatch",
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });
    return updated;
  });
}


/**
 * Dispatch an order: consume reservations (exactly once) and create the shipment
 * plus the outbox event that the worker turns into a courier API call. No external
 * call happens inside this transaction.
 */
export async function dispatchOrder(
  actor: OrderActor,
  input: { orderId: string; courierProviderId?: string | null; courierChargePaisa?: number; declaredWeightGrams?: number },
) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, businessId: actor.businessId },
      include: { items: true },
    });
    if (!order) throw AppError.notFound("Order not found");
    if (!["CONFIRMED", "PROCESSING", "READY_TO_SHIP"].includes(order.status)) {
      throw AppError.invalidState(`An order in ${order.status} cannot be dispatched`);
    }
    if (!order.shippingAddressLine && order.channel !== "IN_STORE") {
      throw AppError.validation("Add a delivery address before dispatching");
    }

    const provider = input.courierProviderId
      ? await tx.courierProvider.findFirst({ where: { id: input.courierProviderId, businessId: actor.businessId } })
      : await tx.courierProvider.findFirst({
          where: { businessId: actor.businessId, isEnabled: true },
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        });

    const existingShipment = await tx.shipment.findFirst({
      where: { idempotencyKey: `order:${order.id}:shipment` },
      select: { id: true },
    });
    if (existingShipment) {
      throw AppError.invalidState("A shipment already exists for this order — update it instead of dispatching again");
    }

    const { units } = await dispatchUnits(tx, {
      actor,
      order: { id: order.id, orderNumber: order.orderNumber, businessId: actor.businessId },
      reason: "order_dispatched",
    });
    if (units === 0) throw AppError.invalidState("There is nothing left to dispatch on this order");

    const internalCode = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "shipment" });
    const shipment = await tx.shipment.create({
      data: {
        businessId: actor.businessId,
        orderId: order.id,
        courierProviderId: provider?.id ?? null,
        providerCode: provider?.code ?? "MANUAL",
        type: "SALE",
        status: "PENDING",
        internalCode,
        merchantOrderId: order.orderNumber,
        recipientName: order.customerName ?? "Customer",
        recipientPhone: order.customerPhone ?? "",
        recipientPhoneNormalized: order.customerPhoneNormalized,
        recipientDistrictCode: order.shippingDistrictCode,
        recipientAddress: order.shippingAddressLine ?? order.shippingArea ?? "Pickup",
        recipientArea: order.shippingArea,
        recipientNote: order.deliveryNotes,
        itemDescription: order.items.map((item) => `${item.productName} (${item.sku}) × ${item.quantity}`).join(", ").slice(0, 400),
        itemQuantity: order.items.reduce((total, item) => total + item.quantity, 0),
        declaredWeightGrams: input.declaredWeightGrams ?? provider?.defaultWeightGrams ?? 500,
        codAmountPaisa: order.codCollectPaisa,
        expectedCollectionPaisa: order.codCollectPaisa,
        deliveryFeePaisa: order.deliveryFeePaisa,
        courierChargePaisa: input.courierChargePaisa ?? 0,
        requestedAt: new Date(),
        idempotencyKey: `order:${order.id}:shipment`,
        createdByUserId: actor.userId ?? null,
      },
    });

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "SHIPPED",
        shippedAt: new Date(),
        fulfillmentStatus: "PARTIALLY_FULFILLED",
        updatedByUserId: actor.userId ?? null,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "FULFILLMENT",
        fromStatus: order.status,
        toStatus: "SHIPPED",
        note: `Dispatched as ${internalCode}${provider ? ` via ${provider.name}` : ""}`,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });

    // The provider call happens in the worker, never inside this transaction.
    await tx.outboxEvent.create({
      data: {
        businessId: actor.businessId,
        eventType: "courier.shipment.create",
        aggregateType: "Shipment",
        aggregateId: shipment.id,
        shipmentId: shipment.id,
        payload: { shipmentId: shipment.id, providerCode: shipment.providerCode } as Prisma.InputJsonValue,
        dedupeKey: `shipment:${shipment.id}:create`,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "order.dispatched",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber} dispatched as ${internalCode} (${units} unit(s))`,
        after: { shipmentId: shipment.id, internalCode, providerCode: shipment.providerCode, units },
      },
      tx,
    );

    return { order: updated, shipment, dispatchedUnits: units };
  });
}

/** Mark an order delivered (own delivery or courier confirmed delivery). */
export async function markOrderDelivered(actor: OrderActor, orderId: string, note?: string) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");
    if (!["READY_TO_SHIP", "SHIPPED"].includes(order.status)) {
      throw AppError.invalidState("Only a packed or shipped order can be marked delivered");
    }

    if (order.status === "READY_TO_SHIP") {
      await dispatchUnits(tx, { actor, order: { id: order.id, orderNumber: order.orderNumber, businessId: actor.businessId }, reason: "delivered" });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        fulfillmentStatus: "FULFILLED",
        updatedByUserId: actor.userId ?? null,
      },
    });
    await tx.orderItem.updateMany({
      where: { orderId: order.id, status: { in: ["RESERVED", "ALLOCATED", "DISPATCHED", "PREORDER_PENDING", "PENDING"] } },
      data: { status: "DELIVERED" },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "FULFILLMENT",
        fromStatus: order.status,
        toStatus: "DELIVERED",
        note: note ?? "Delivered to the customer",
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
      },
    });
    if (order.customerId) await recalculateCustomerStats(tx, order.customerId);

    return updated;
  });
}

/** Public order tracking: requires the order number *and* a matching phone/customer. */
export async function findOrderForTracking(input: { orderNumber: string; phone?: string; customerId?: string }) {
  const normalized = input.phone ? normalizeBdPhone(input.phone) : null;
  if (!normalized && !input.customerId) return null;

  const order = await prisma.order.findFirst({
    where: {
      orderNumber: input.orderNumber,
      deletedAt: null,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(normalized ? { customerPhoneNormalized: normalized } : {}),
    },
    select: {
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      grandTotalPaisa: true,
      duePaisa: true,
      placedAt: true,
      deliveredAt: true,
      shippingDistrictCode: true,
      items: { select: { productName: true, variantName: true, sku: true, quantity: true, lineTotalPaisa: true, status: true } },
      shipments: { select: { status: true, trackingCode: true, providerCode: true, lastStatusAt: true } },
    },
  });

  return order;
}

export { dispatchUnits };
