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
import { reconcilePayoutAfterVoid, recordResellerEarnings, voidResellerEarnings } from "@/modules/resellers/earnings";
import type { CreateOrderInput } from "@/modules/orders/schemas";
import { calculateManualOrderTotals, discountAllocationSnapshot } from "@/modules/orders/totals";
import {
  INITIAL_STATUS_BY_ORDER_TYPE,
  isBackwardTransition,
  statusGroupOf,
  statusLabel,
  type OrderTypeValue,
} from "@/modules/orders/status";
import { emitWebhookEvent, orderPayload } from "@/modules/api-keys/events";
import { queueMarketingEvent } from "@/modules/marketing/service";
import type { WebhookOrderLike } from "@/modules/api-keys/events";

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
  /**
   * Role label snapshot of the creator ("Owner", "Reseller", …). Stored on the
   * order so the list can show who created it even after roles change.
   */
  roleLabel?: string | null;
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

  const result = await withTransaction(async (tx) => {
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
    // A storefront can switch preorders off for its own channel; staff channels
    // (admin, in-store, reseller) follow the catalogue setting only.
    const storefrontAllowsPreorder = input.storefrontId
      ? Boolean(
          (await tx.storefront.findFirst({
            where: { id: input.storefrontId, businessId: actor.businessId },
            select: { preorderEnabled: true },
          }))?.preorderEnabled ?? true,
        )
      : true;
    const variantIds = [...new Set(input.items.map((item) => item.variantId))];
    const variants = await tx.variant.findMany({
      where: { id: { in: variantIds }, product: { businessId: actor.businessId, deletedAt: null } },
      include: {
        product: { select: { id: true, name: true, sku: true, isPreorderEnabled: true, packagingCostPaisa: true } },
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
      optionKey: string | null;
      variantCode: string | null;
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

    // Manual channels may promise stock that is not there: an explicit pre-order
    // selection (order type PREORDER or a line flagged `allowPreorder`) is always
    // accepted, and the shortfall becomes a real preorder commitment.
    const isManualChannel = input.channel === "ADMIN" || input.channel === "RESELLER" || input.channel === "IN_STORE";
    const manualPreorderOrder = isManualChannel && input.orderType === "PREORDER";

    for (const item of input.items) {
      const variant = variantById.get(item.variantId)!;
      // SKU belongs to the product; the variant is identified by its id and by
      // the snapshot of its option key, so renaming a product never rewrites a
      // completed order line and two variants of one product stay distinct.
      const lineSku = variant.product.sku ?? "";
      if (variant.status !== "ACTIVE") throw AppError.validation(`${variant.product.name} — ${variant.name} is not available`);

      // The price is resolved here, inside the transaction, from the applicable
      // price list and quantity tier. No caller — staff form, reseller screen,
      // REST API or storefront — can submit a unit price.
      const resolved = await resolveVariantPrice(variant.id, { priceListId, quantity: item.quantity });
      const unitPricePaisa = resolved.pricePaisa;
      if (unitPricePaisa <= 0) throw AppError.validation(`${variant.product.name} — ${variant.name} has no price configured`);

      const lineSubtotalPaisa = unitPricePaisa * item.quantity;
      const discountPaisa = Math.min(item.discountPaisa, lineSubtotalPaisa);
      const itemPackaging = item.packagingCostPaisa ?? variant.packagingCostPaisa ?? variant.product.packagingCostPaisa ?? 0;
      // Tax is not part of v1 (no VAT module); the column stays so a later step can
      // add it without touching historical orders.
      const taxPaisa = 0;

      preparedItems.push({
        variantId: variant.id,
        productId: variant.product.id,
        sku: lineSku,
        productName: variant.product.name,
        variantName: variant.name,
        variantAttributes: variant.attributeValues.map((value) => ({
          name: value.attribute.name,
          value: value.attributeValue.value,
        })) as Prisma.InputJsonValue,
        optionKey: variant.optionKey ?? null,
        variantCode: variant.product?.sku ?? null,
        quantity: item.quantity,
        unitPricePaisa,
        compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
        unitCostPaisa: variant.costPaisa ?? 0,
        packagingCostPaisa: itemPackaging,
        discountPaisa,
        lineSubtotalPaisa,
        lineTotalPaisa: lineSubtotalPaisa - discountPaisa,
        taxPaisa,
        // Preorder eligibility follows the same inheritance chain as the rest of
        // the catalogue: a variant override wins over the product default, and a
        // storefront that has preorders switched off refuses them altogether.
        // The manual pre-order workflow is the one documented exception: an
        // authorised operator may accept an uncovered quantity on purpose.
        isPreorderAllowed:
          (manualPreorderOrder || isManualChannel && item.allowPreorder === true
            ? true
            : (variant.isPreorderEnabled ?? variant.product.isPreorderEnabled) && storefrontAllowsPreorder),
        pricingSource: resolved.source,
        priceListId: resolved.priceListId,
        note: item.note ?? null,
      });

      void lineSubtotalPaisa;
      void itemPackaging;
    }

    // ------------------------------------------------------------- totals
    // One calculation feeds the stored snapshot and the live preview shown while
    // the operator builds the order, so the two can never disagree. Integer paisa
    // arithmetic only (see modules/orders/totals.ts).
    const provisionalSubtotalPaisa = preparedItems.reduce((total, item) => total + item.lineSubtotalPaisa, 0);
    const delivery = await resolveDeliveryFee(tx, actor.businessId, {
      districtCode: customer?.districtCode ?? null,
      storefrontId: input.storefrontId ?? null,
      deliveryZoneId: input.deliveryZoneId ?? null,
    }, provisionalSubtotalPaisa);
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

    const orderType: OrderTypeValue =
      input.orderType ?? (input.channel === "IN_STORE" ? "IN_STORE" : "ONLINE_DELIVERY");
    const isInStore = orderType === "IN_STORE";
    const maxDiscountPercent = Number(settings["order.max_discount_percent"] ?? 100);
    const orderDiscount =
      input.discountType && input.discountValue != null
        ? { type: input.discountType, value: input.discountValue }
        : input.discountTotalPaisa > 0
          ? { type: "FLAT" as const, value: input.discountTotalPaisa }
          : null;

    const totals = calculateManualOrderTotals({
      orderType,
      lines: preparedItems.map((item, index) => ({
        key: `line-${index}`,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPricePaisa: item.unitPricePaisa,
        itemDiscountPaisa: item.discountPaisa,
        packagingCostPaisa: item.packagingCostPaisa,
        unitCostPaisa: item.unitCostPaisa,
      })),
      orderDiscount,
      maxDiscountBps: Math.max(0, Math.min(10_000, Math.round(maxDiscountPercent * 100))),
      deliveryFee: { calculatedPaisa: delivery.calculatedFeePaisa, manualPaisa: input.deliveryFeePaisa ?? null },
      extraChargesPaisa: input.extraCharges.reduce((total, charge) => total + charge.amountPaisa, 0),
      codSurchargePaisa,
      paymentMethod: input.paymentMethod ?? "COD",
    });

    const itemsSubtotalPaisa = totals.itemsSubtotalPaisa;
    const discountTotalPaisa = totals.itemDiscountPaisa + totals.orderDiscountPaisa;
    const deliveryFeePaisa = totals.deliveryFeePaisa;
    const extraChargePaisa = totals.extraChargePaisa;
    const packagingCostPaisa = totals.packagingCostPaisa;
    const inventoryCostPaisa = totals.inventoryCostPaisa;
    const grandTotalPaisa = totals.grandTotalPaisa;
    const lineTotalsByKey = new Map(totals.lines.map((line, index) => [index, line]));

    // The initial status is decided here, never by the client: counter sales are
    // completed on the spot, storefront orders wait for confirmation, and manual
    // delivery/pre-order orders start in the pre-courier group (docs/BUSINESS_RULES.md).
    const initialStatus = isInStore
      ? "COMPLETED"
      : input.channel === "STOREFRONT"
        ? "PENDING"
        : INITIAL_STATUS_BY_ORDER_TYPE[orderType];

    const orderNumber = await nextDocumentNumber(tx, { businessId: actor.businessId, key: "order" });

    const order = await tx.order.create({
      data: {
        businessId: actor.businessId,
        orderNumber,
        storefrontId: input.storefrontId ?? null,
        channel: input.channel,
        orderType,
        customerId,
        resellerId: input.resellerId ?? null,
        status: initialStatus,
        paymentStatus: isInStore ? "PAID" : "UNPAID",
        fulfillmentStatus: isInStore ? "FULFILLED" : "UNFULFILLED",
        itemsSubtotalPaisa,
        discountTotalPaisa,
        discountType: orderDiscount?.type ?? null,
        discountValue: orderDiscount?.value ?? null,
        discountAllocation: discountAllocationSnapshot(totals) as unknown as Prisma.InputJsonValue,
        deliveryFeePaisa,
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
        deliveryNotes: input.deliveryNotes ?? null,
        deliveryFeeCalculatedPaisa: totals.deliveryFeeCalculatedPaisa,
        ...(totals.deliveryFeeOverridden
          ? {
              deliveryFeeOverriddenAt: new Date(),
              deliveryFeeOverriddenByUserId: actor.userId ?? null,
              deliveryFeeOverrideNote: input.deliveryFeeNote ?? null,
            }
          : {}),
        deliveryZoneId: delivery.zoneId,
        customerNote: input.customerNote ?? null,
        internalNote: input.internalNote ?? null,
        sourceReference: input.sourceReference ?? null,
        createdByUserId: actor.userId ?? null,
        createdByUserRole: actor.roleLabel ?? null,
        idempotencyKey: input.idempotencyKey,
        ...(isInStore
          ? { confirmedAt: new Date(), processingAt: new Date(), completedAt: new Date() }
          : initialStatus === "PROCESSING"
            ? { processingAt: new Date() }
            : {}),
      },
    });

    const createdItems: Array<{ id: string; variantId: string | null; quantity: number; isPreorderAllowed: boolean; productName: string; sku: string }> = [];
    for (const [index, item] of preparedItems.entries()) {
      // The stored line keeps the item-level discount in `discountPaisa` and the
      // allocated share of the order-level discount inside `lineTotalPaisa`, so
      // historical lines always add up to the order total.
      const lineTotals = lineTotalsByKey.get(index)!;
      const created = await tx.orderItem.create({
        data: {
          orderId: order.id,
          variantId: item.variantId,
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          variantName: item.variantName,
          variantAttributes: item.variantAttributes,
          optionKey: item.optionKey,
          variantCode: item.variantCode,
          quantity: item.quantity,
          unitPricePaisa: item.unitPricePaisa,
          compareAtPricePaisa: item.compareAtPricePaisa,
          unitCostPaisa: item.unitCostPaisa,
          packagingCostPaisa: item.packagingCostPaisa,
          discountPaisa: lineTotals.itemDiscountPaisa,
          lineSubtotalPaisa: lineTotals.lineSubtotalPaisa,
          lineTotalPaisa: lineTotals.lineTotalPaisa,
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
    if (deliveryFeePaisa > 0) {
      // The adjustment records what is actually charged, including a manual
      // override; the calculated value stays on the order for auditability.
      await tx.orderAdjustment.create({
        data: {
          orderId: order.id,
          type: "DELIVERY_FEE",
          label: totals.deliveryFeeOverridden ? "Delivery fee (manual override)" : "Delivery fee",
          amountPaisa: deliveryFeePaisa,
          note: totals.deliveryFeeOverridden
            ? `Calculated ${totals.deliveryFeeCalculatedPaisa}${input.deliveryFeeNote ? ` · ${input.deliveryFeeNote}` : ""}`
            : null,
          createdByUserId: totals.deliveryFeeOverridden ? (actor.userId ?? null) : null,
        },
      });
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
        actorRole: actor.roleLabel ?? null,
        toGroup: statusGroupOf(order.status),
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
        after: {
          orderNumber,
          grandTotalPaisa,
          reservedUnits,
          preorderUnits,
          channel: input.channel,
          orderType,
          status: order.status,
          deliveryFeePaisa,
          deliveryFeeCalculatedPaisa: totals.deliveryFeeCalculatedPaisa,
          deliveryFeeOverridden: totals.deliveryFeeOverridden,
          discountTotalPaisa,
          actorRole: actor.roleLabel ?? null,
        },
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

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "order.created",
    dedupeKey: result.order.id,
    payload: { ...orderPayload(result.order), reservedUnits: result.reservedUnits, preorderUnits: result.preorderUnits },
  });

  // Server-side conversion event. The dedupe key is the order id, so a replayed
  // request can never double-count a purchase, and nothing is sent when the shopper
  // did not consent (the integration records it as skipped instead).
  await queueMarketingEvent(
    { businessId: actor.businessId },
    {
      eventName: "Purchase",
      dedupeKey: `order:${result.order.id}:purchase`,
      storefrontId: input.storefrontId ?? null,
      customerId: null,
      orderId: result.order.id,
      consentGranted: input.marketingConsent,
      valuePaisa: result.order.grandTotalPaisa,
      items: undefined,
    },
  ).catch(() => undefined);

  return result;
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

export interface DeliveryFeeResolution {
  /** What the delivery-zone rules produce, before any manual override. */
  calculatedFeePaisa: number;
  zoneId: string | null;
  zoneName: string | null;
  /** Cash-on-delivery fee configured on the zone (a separate concept). */
  codFeePaisa: number;
  freeDeliveryApplied: boolean;
}

/**
 * Resolve the delivery charge from the configured delivery zones.
 *
 * The calculated value is always returned, even when the caller passes a manual
 * override: `calculateManualOrderTotals` decides which one is charged and the
 * order stores both, so an override never erases what the rules said.
 */
export async function resolveDeliveryFee(
  tx: Tx | typeof prisma,
  businessId: string,
  input: { districtCode?: string | null; storefrontId?: string | null; deliveryZoneId?: string | null },
  itemsSubtotalPaisa: number,
): Promise<DeliveryFeeResolution> {
  const districtCode = input.districtCode ?? null;
  if (!districtCode && !input.deliveryZoneId) {
    return { calculatedFeePaisa: 0, zoneId: null, zoneName: null, codFeePaisa: 0, freeDeliveryApplied: false };
  }

  const zone = input.deliveryZoneId
    ? await tx.deliveryZone.findFirst({ where: { id: input.deliveryZoneId, businessId } })
    : await tx.deliveryZone.findFirst({
        where: {
          businessId,
          districtCode: districtCode!,
          isActive: true,
          ...(input.storefrontId ? { OR: [{ storefrontId: input.storefrontId }, { storefrontId: null }] } : {}),
        },
        orderBy: [{ storefrontId: "desc" }, { feePaisa: "asc" }],
      });
  if (!zone) return { calculatedFeePaisa: 0, zoneId: null, zoneName: null, codFeePaisa: 0, freeDeliveryApplied: false };

  const district = await tx.district.findUnique({ where: { code: zone.districtCode }, select: { name: true } });
  const zoneName = district?.name ?? zone.note ?? null;

  const freeThreshold = zone.freeDeliveryThresholdPaisa;
  if (freeThreshold != null && itemsSubtotalPaisa >= freeThreshold) {
    return { calculatedFeePaisa: 0, zoneId: zone.id, zoneName, codFeePaisa: zone.codFeePaisa, freeDeliveryApplied: true };
  }
  return {
    calculatedFeePaisa: zone.feePaisa,
    zoneId: zone.id,
    zoneName,
    codFeePaisa: zone.codFeePaisa,
    freeDeliveryApplied: false,
  };
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

/**
 * Low-level status transition.
 *
 * Transitions follow the status-group model instead of a rigid forward-only
 * machine (docs/BUSINESS_RULES.md → "Status transitions"):
 *   - any move inside one group is allowed, forwards and backwards;
 *   - a forward move across groups is allowed;
 *   - a backward move across groups, and any move out of CANCELLED, needs the
 *     administrative override (`adminOverride: true`), which the permission-aware
 *     caller in `modules/orders/lifecycle.ts` only sets after an explicit
 *     confirmation;
 *   - moving into courier (SHIPPED) consumes the reserved stock exactly once, so a
 *     status label can never leave stock reserved and shipped at the same time;
 *   - CANCELLED is not a transition: `cancelOrder` releases reservations, cancels
 *     preorder commitments and reverses reseller earnings.
 *
 * This function does not check permissions — every caller does, and the UI never
 * calls it directly.
 */
export async function transitionOrder(
  actor: OrderActor,
  input: {
    orderId: string;
    status: "CONFIRMED" | "PROCESSING" | "ON_HOLD" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED" | "COMPLETED";
    note?: string;
    reason?: string | null;
    /** Set by the permission-aware lifecycle service after an explicit confirmation. */
    adminOverride?: boolean;
    confirmationAcknowledged?: boolean;
    courierEventId?: string | null;
  },
) {
  const updated = await withTransaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, businessId: actor.businessId } });
    if (!order) throw AppError.notFound("Order not found");

    const from = order.status;
    const to = input.status;
    if (from === to) throw AppError.invalidState(`This order is already ${statusLabel(to)}`);

    const fromGroup = statusGroupOf(from);
    const toGroup = statusGroupOf(to);
    const backward = isBackwardTransition(from, to);
    const override = input.adminOverride === true;

    if (to === "CANCELLED" as typeof to) {
      throw AppError.invalidState("Use the cancel workflow: cancelling releases stock and preorder commitments");
    }
    if (from === "CANCELLED" && !override) {
      throw AppError.invalidState(
        "A cancelled order can only be reopened with the administrative override, because its stock reservations were released",
      );
    }
    if (backward && fromGroup !== toGroup && !override) {
      throw AppError.invalidState(
        `Moving an order backward from ${statusLabel(from)} to ${statusLabel(to)} needs the administrative override`,
      );
    }

    const timestamps: Record<string, Prisma.OrderUpdateInput> = {
      CONFIRMED: { confirmedAt: new Date() },
      PROCESSING: { processingAt: new Date() },
      ON_HOLD: { onHoldAt: new Date() },
      READY_TO_SHIP: { readyToShipAt: new Date() },
      SHIPPED: { shippedAt: new Date(), fulfillmentStatus: "PARTIALLY_FULFILLED" },
      DELIVERED: { deliveredAt: new Date(), fulfillmentStatus: "FULFILLED" },
      PARTIALLY_DELIVERED: { partiallyDeliveredAt: new Date(), fulfillmentStatus: "PARTIALLY_FULFILLED" },
      RETURNED: { returnedAt: new Date(), fulfillmentStatus: "CANCELLED" },
      COMPLETED: { completedAt: new Date() },
    };

    // Reopening a cancelled order re-reserves what is available now; the shortfall
    // becomes a preorder commitment again when the product allows it.
    if (from === "CANCELLED") {
      await restoreOrderReservations(tx, { actor, orderId: order.id, orderNumber: order.orderNumber });
    }

    // Handing an order to a courier consumes the reservation exactly once.
    if (to === "SHIPPED") {
      await dispatchUnits(tx, {
        actor,
        order: { id: order.id, orderNumber: order.orderNumber, businessId: actor.businessId },
        reason: "moved_in_courier",
      });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: to,
        updatedByUserId: actor.userId ?? null,
        ...(from === "CANCELLED" ? { cancelledAt: null, fulfillmentStatus: "UNFULFILLED" as const } : {}),
        ...(timestamps[to] ?? {}),
      },
    });

    if (to === "DELIVERED" || to === "COMPLETED") {
      if (from !== "SHIPPED") {
        await dispatchUnits(tx, {
          actor,
          order: { id: order.id, orderNumber: order.orderNumber, businessId: actor.businessId },
          reason: "delivered",
        });
      }
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: { in: ["RESERVED", "ALLOCATED", "DISPATCHED", "PREORDER_PENDING"] } },
        data: { status: "DELIVERED" },
      });
      if (order.customerId) await recalculateCustomerStats(tx, order.customerId);
      // Delivery is not money: this writes a *pending* ledger entry that only
      // becomes payable once the courier COD settlement is reconciled.
      if (order.resellerId) {
        await recordResellerEarnings(tx, { orderId: order.id, actorUserId: actor.userId ?? null });
      }
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        field: "ORDER",
        fromStatus: from,
        toStatus: to,
        note: input.note ?? null,
        reason: input.reason ?? null,
        actorUserId: actor.userId ?? null,
        actorType: actor.actorType ?? "USER",
        actorCustomerId: actor.customerId ?? null,
        actorRole: actor.roleLabel ?? null,
        isAdminOverride: override,
        confirmationAcknowledged: input.confirmationAcknowledged === true,
        toGroup,
        courierEventId: input.courierEventId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorCustomerId: actor.customerId ?? null,
        actorLabel: actor.actorLabel ?? null,
        action: override ? "order.status_override" : "order.status_changed",
        entityType: "Order",
        entityId: order.id,
        summary: `${order.orderNumber}: ${statusLabel(from)} → ${statusLabel(to)}${override ? " (administrative override)" : ""}`,
        before: { status: from, group: fromGroup },
        after: { status: to, group: toGroup, backward, confirmed: input.confirmationAcknowledged === true },
        changedFields: ["status"],
        reason: input.reason ?? input.note ?? null,
      },
      tx,
    );

    return updated;
  });

  await emitOrderStatusWebhook(actor.businessId, updated, input.status);
  return updated;
}

/**
 * Re-reserve stock for an order that is reopened after cancellation.
 *
 * Only what is available *now* is reserved; anything else becomes a preorder
 * commitment when the line allows it, and the transition is refused when neither
 * is possible — an order must never promise units that do not exist and are not
 * recorded as a preorder.
 */
export async function restoreOrderReservations(
  tx: Tx,
  input: { actor: OrderActor; orderId: string; orderNumber: string },
): Promise<{ reservedUnits: number; preorderUnits: number }> {
  const businessId = input.actor.businessId;
  const locationId = await defaultLocationId(businessId);
  const items = await tx.orderItem.findMany({
    where: { orderId: input.orderId },
    include: { variant: { select: { id: true, isPreorderEnabled: true, product: { select: { isPreorderEnabled: true } } } } },
  });

  let reservedUnits = 0;
  let preorderUnits = 0;

  for (const item of items) {
    if (!item.variantId) continue;
    const outstanding = item.quantity - item.dispatchedQuantity - item.cancelledQuantity;
    if (outstanding <= 0) continue;

    const available = await lockAvailableQuantity(tx, locationId, item.variantId);
    const reserveNow = Math.min(available, outstanding);
    const shortfall = outstanding - reserveNow;

    if (reserveNow > 0) {
      const key = `order:${input.orderId}:rereserve:${item.id}:${Date.now()}`;
      const reservation = await tx.stockReservation.upsert({
        where: { orderItemId: item.id },
        create: {
          businessId,
          locationId,
          variantId: item.variantId,
          orderId: input.orderId,
          orderItemId: item.id,
          quantity: reserveNow,
          status: "ACTIVE",
          idempotencyKey: key,
        },
        update: {
          quantity: reserveNow,
          status: "ACTIVE",
          releasedQuantity: 0,
          consumedQuantity: 0,
          releasedAt: null,
          releasedReason: null,
          idempotencyKey: key,
        },
      });
      const movement = await applyStockMovement(tx, {
        businessId,
        locationId,
        variantId: item.variantId,
        type: "RESERVATION",
        reservedDelta: reserveNow,
        sourceType: "Order",
        sourceId: input.orderId,
        reference: input.orderNumber,
        reason: "order_reopened",
        actorUserId: input.actor.userId ?? null,
        idempotencyKey: key,
      });
      await tx.reservationAllocation.create({
        data: { reservationId: reservation.id, quantity: reserveNow, kind: "RESERVE", inventoryMovementId: movement.movementId },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { reservedQuantity: reserveNow, cancelledQuantity: item.dispatchedQuantity > 0 ? item.cancelledQuantity : 0, status: "RESERVED" },
      });
      reservedUnits += reserveNow;
    }

    if (shortfall > 0) {
      const allowsPreorder = item.variant?.isPreorderEnabled ?? item.variant?.product?.isPreorderEnabled ?? false;
      if (!allowsPreorder) {
        throw AppError.insufficientStock(
          `${item.productName} (${item.sku}) has only ${reserveNow} unit(s) available and does not accept preorders — the order cannot be reopened`,
        );
      }
      await createPreorderCommitment(tx, {
        businessId,
        locationId,
        variantId: item.variantId,
        orderId: input.orderId,
        orderItemId: item.id,
        quantity: shortfall,
        expectedAt: null,
        note: `Reopened ${input.orderNumber}: ${shortfall} unit(s) still on preorder`,
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { preorderQuantity: shortfall, isPreorder: true, status: "PREORDER_PENDING" },
      });
      preorderUnits += shortfall;
    }
  }

  return { reservedUnits, preorderUnits };
}

/**
 * Map an order status change onto the published webhook events. Only the milestone
 * statuses integrators subscribe to are emitted; internal steps stay in the audit log.
 */
async function emitOrderStatusWebhook(businessId: string, order: WebhookOrderLike, status: string) {
  const eventType =
    status === "CONFIRMED" ? "order.confirmed" : status === "SHIPPED" ? "order.dispatched" : status === "DELIVERED" || status === "COMPLETED" ? "order.delivered" : null;
  if (!eventType) return;
  await emitWebhookEvent({ businessId, eventType, dedupeKey: `${order.id}:${status}`, payload: orderPayload(order) });
}

export async function cancelOrder(actor: OrderActor, input: { orderId: string; reason: string; restock?: boolean }) {
  const result = await withTransaction(async (tx) => {
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

    // Cancelling a reseller order voids anything not yet payable and reverses whatever
    // was already allocated to a payout, so no money can be paid twice.
    if (order.resellerId) {
      const voided = await voidResellerEarnings(tx, {
        orderId: order.id,
        reason: `Order cancelled: ${input.reason}`,
        actorUserId: actor.userId ?? null,
        resellerId: order.resellerId,
      });

      // A payout that was waiting on those entries is re-costed, or cancelled when
      // nothing is left in it — it must never be paid for money that is no longer owed.
      for (const payoutId of voided.affectedPayoutIds) {
        await reconcilePayoutAfterVoid(tx, {
          payoutId,
          reason: `Order ${order.orderNumber} cancelled: ${input.reason}`,
          actorUserId: actor.userId ?? null,
        });
      }
    }

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

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "order.cancelled",
    dedupeKey: `${result.order.id}:cancelled`,
    payload: { ...orderPayload(result.order), releasedUnits: result.releasedUnits, restockedUnits: result.restockedUnits },
  });

  return result;
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
  const result = await withTransaction(async (tx) => {
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

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "order.dispatched",
    dedupeKey: `${result.shipment.id}:dispatched`,
    payload: {
      ...orderPayload(result.order),
      shipmentId: result.shipment.id,
      providerCode: result.shipment.providerCode,
      trackingCode: result.shipment.trackingCode,
      dispatchedUnits: result.dispatchedUnits,
    },
  });

  return result;
}

/** Mark an order delivered (own delivery or courier confirmed delivery). */
export async function markOrderDelivered(actor: OrderActor, orderId: string, note?: string) {
  const updated = await withTransaction(async (tx) => {
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

    // A delivered reseller order becomes a *pending* ledger entry: delivery is not
    // money. It only becomes payable once the COD settlement is reconciled
    // (see modules/resellers/earnings.ts).
    if (order.resellerId) {
      await recordResellerEarnings(tx, { orderId: order.id, actorUserId: actor.userId ?? null });
    }

    return updated;
  });

  await emitWebhookEvent({
    businessId: actor.businessId,
    eventType: "order.delivered",
    dedupeKey: `${updated.id}:delivered`,
    payload: orderPayload(updated),
  });

  return updated;
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
