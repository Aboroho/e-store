import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement } from "@/modules/inventory/service";
import { placeStorefrontOrder, resolveStorefront } from "@/modules/orders/checkout";
import { processCourierWebhook } from "@/modules/couriers/service";
import { confirmVerificationCode, requestVerificationCode, findOrCreateCustomer } from "@/modules/customers/service";
import { getOrderDetail } from "@/modules/orders/queries";
import { AppError } from "@/lib/errors";
import { createTestBusiness, createTestStorefront, createTestVariant, databaseReachable, destroyTestBusiness, readBalance, type TestContext } from "./fixtures";

/**
 * Storefront checkout and courier webhooks.
 *
 * The point of these tests is that a shopper can never influence money: the only
 * input is a variant id and a quantity, and every price is resolved server-side
 * from the storefront's price list, the delivery zone and the storefront flags.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("storefront checkout (database)", () => {
  let context: TestContext;
  let storefrontId: string;
  let slug: string;

  beforeAll(async () => {
    context = await createTestBusiness("storefront");
    const storefront = await createTestStorefront(context);
    storefrontId = storefront.storefrontId;
    slug = storefront.slug;
    await prisma.storefront.update({
      where: { id: storefrontId },
      data: { codEnabled: true, freeDeliveryThresholdPaisa: null },
    });
    // 26 = Pabna in the seeded district list.
    await prisma.deliveryZone.create({
      data: {
        businessId: context.businessId,
        storefrontId,
        districtCode: "26",
        feePaisa: 6_000,
        codEnabled: true,
        codFeePaisa: 1_000,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  async function stockedVariant(priceOverridePaisa = 10_000, listPricePaisa?: number) {
    const variant = await createTestVariant(context, { sku: `SF-${randomUUID().slice(0, 8)}`, pricePaisa: priceOverridePaisa, costPaisa: 4_000 });
    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        type: "OPENING",
        onHandDelta: 25,
        unitCostPaisa: 4_000,
        actorUserId: context.userId,
      }),
    );
    if (listPricePaisa !== undefined) {
      await prisma.priceListItem.create({
        data: { priceListId: context.priceListId, variantId: variant.variantId, pricePaisa: listPricePaisa, minQuantity: 1 },
      });
    }
    return variant;
  }

  it("resolves the default active storefront", async () => {
    const storefront = await resolveStorefront(slug);
    expect(storefront.id).toBe(storefrontId);
    expect(storefront.businessId).toBe(context.businessId);
    expect(storefront.priceListId).toBe(context.priceListId);
    expect(storefront.locationId).toBe(context.locationId);
  });

  it("prices the order from the storefront price list and adds the zone fee", async () => {
    const variant = await stockedVariant(10_000, 5_555);

    const placed = await placeStorefrontOrder({
      storefrontSlug: slug,
      customerName: "Nadia Akter",
      customerPhone: "01715550001",
      districtCode: "26",
      addressLine: "Holding 7, Ishwardi",
      items: [{ variantId: variant.variantId, quantity: 2 }],
      idempotencyKey: `sf-${randomUUID()}`,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id }, include: { items: true } });
    // The price-list entry wins over the variant override; the shopper sent neither.
    expect(order.items[0]!.unitPricePaisa).toBe(5_555);
    expect(order.deliveryFeePaisa).toBe(6_000);
    expect(order.codSurchargePaisa).toBe(1_000);
    expect(order.grandTotalPaisa).toBe(2 * 5_555 + 6_000 + 1_000);
    expect(order.channel).toBe("STOREFRONT");
    expect(order.paymentStatus).toBe("UNPAID");
    expect(order.sourceReference).toBe(`storefront:${slug}`);

    const detail = await getOrderDetail(context.businessId, order.id);
    expect(detail?.order.orderNumber).toBe(order.orderNumber);
    expect(detail?.shipments).toHaveLength(0);
  });

  it("is idempotent for a double-submitted checkout", async () => {
    const variant = await stockedVariant(9_000);
    const key = `sf-dup-${randomUUID()}`;
    const input = {
      storefrontSlug: slug,
      customerName: "Repeat Shopper",
      customerPhone: "01715550002",
      districtCode: "26",
      addressLine: "Station Road, Ishwardi",
      items: [{ variantId: variant.variantId, quantity: 1 }],
      idempotencyKey: key,
    };

    const first = await placeStorefrontOrder(input);
    const second = await placeStorefrontOrder(input);
    expect(second.reused).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const balance = await readBalance(context.locationId, variant.variantId);
    expect(balance.reserved).toBe(1);
  });

  it("refuses a quantity the shelf cannot serve when preorders are off", async () => {
    const variant = await stockedVariant(9_000);
    await expect(
      placeStorefrontOrder({
        storefrontSlug: slug,
        customerName: "Too Greedy",
        customerPhone: "01715550003",
        districtCode: "26",
        addressLine: "Nowhere 1",
        items: [{ variantId: variant.variantId, quantity: 999 }],
        idempotencyKey: `sf-over-${randomUUID()}`,
      }),
    ).rejects.toThrow(AppError);

    const balance = await readBalance(context.locationId, variant.variantId);
    expect(balance.reserved).toBe(0);
  });

  it("rejects an unknown storefront slug instead of guessing", async () => {
    await expect(resolveStorefront("not-a-storefront")).rejects.toThrow();
  });

  it("links the shopper to one customer record per phone number", async () => {
    const variant = await stockedVariant(7_000);
    const phone = "01715550009";
    await placeStorefrontOrder({
      storefrontSlug: slug,
      customerName: "One Customer",
      customerPhone: phone,
      districtCode: "26",
      addressLine: "First address",
      items: [{ variantId: variant.variantId, quantity: 1 }],
      idempotencyKey: `sf-cust-${randomUUID()}`,
    });
    await placeStorefrontOrder({
      storefrontSlug: slug,
      customerName: "One Customer",
      customerPhone: phone,
      districtCode: "26",
      addressLine: "Second address",
      items: [{ variantId: variant.variantId, quantity: 1 }],
      idempotencyKey: `sf-cust-${randomUUID()}`,
    });

    const customers = await prisma.customer.findMany({ where: { businessId: context.businessId, phoneNormalized: { contains: phone.slice(1) } } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.totalOrders).toBeGreaterThanOrEqual(2);
    expect(customers[0]!.hasAccount).toBe(false);
  });

  it("lets the shopper claim those guest orders after verifying the phone", async () => {
    const customer = await withTransaction((tx) => findOrCreateCustomer(tx, { businessId: context.businessId, name: "Claimer", phone: "01715550011" }));
    await prisma.order.create({
      data: {
        businessId: context.businessId,
        storefrontId,
        orderNumber: `GUEST-${randomUUID().slice(0, 8)}`,
        channel: "STOREFRONT",
        status: "CONFIRMED",
        paymentStatus: "UNPAID",
        fulfillmentStatus: "UNFULFILLED",
        customerName: "Claimer",
        customerPhone: "01715550011",
        customerPhoneNormalized: "01715550011",
        grandTotalPaisa: 1_000,
        duePaisa: 1_000,
      },
    });

    const requested = await requestVerificationCode({ businessId: context.businessId, phone: "01715550011", purpose: "LOGIN", staffAssisted: true });
    const confirmed = await confirmVerificationCode({
      businessId: context.businessId,
      phone: "01715550011",
      code: requested.codeForStaff!,
      purpose: "LOGIN",
    });

    expect(confirmed.customerId).toBe(customer.id);
    expect(confirmed.claimedOrders).toBe(1);

    const claimed = await prisma.order.findFirstOrThrow({ where: { orderNumber: { startsWith: "GUEST-" }, businessId: context.businessId } });
    expect(claimed.customerId).toBe(customer.id);
  });
});

describe.skipIf(!reachable)("courier webhooks (database)", () => {
  let context: TestContext;
  let expeditedBusinessId: string;

  beforeAll(async () => {
    context = await createTestBusiness("webhook");
    await prisma.courierProvider.create({
      data: { businessId: context.businessId, code: "STEADFAST", name: "Steadfast", isEnabled: true, testMode: true, priority: 1 },
    });
    expeditedBusinessId = context.businessId;
  });

  afterAll(async () => {
    await destroyTestBusiness(expeditedBusinessId);
    await prisma.$disconnect();
  });

  async function shippedParcel(trackingCode: string) {
    const variant = await createTestVariant(context, { sku: `WH-${randomUUID().slice(0, 8)}` });
    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.variantId,
        type: "OPENING",
        onHandDelta: 2,
        unitCostPaisa: 1_000,
        actorUserId: context.userId,
      }),
    );
    const order = await prisma.order.create({
      data: {
        businessId: context.businessId,
        orderNumber: `WH-${randomUUID().slice(0, 8)}`,
        channel: "ADMIN",
        status: "SHIPPED",
        paymentStatus: "UNPAID",
        fulfillmentStatus: "PARTIALLY_FULFILLED",
        customerName: "Webhook Tester",
        customerPhone: "01715551234",
        customerPhoneNormalized: "8801715551234",
        shippingDistrictCode: "26",
        shippingAddressLine: "Ishwardi",
        grandTotalPaisa: 2_000,
        duePaisa: 2_000,
        items: {
          create: [
            {
              variantId: variant.variantId,
              sku: variant.sku,
              productName: "Webhook product",
              variantName: "Default",
              quantity: 1,
              unitPricePaisa: 2_000,
              lineSubtotalPaisa: 2_000,
              lineTotalPaisa: 2_000,
              dispatchedQuantity: 1,
            },
          ],
        },
        shipments: {
          create: [
            {
              businessId: context.businessId,
              internalCode: `SHP-${randomUUID().slice(0, 8)}`,
              providerCode: "STEADFAST",
              status: "IN_TRANSIT",
              trackingCode,
              recipientName: "Webhook Tester",
              recipientPhone: "8801715551234",
              recipientAddress: "Ishwardi",
              expectedCollectionPaisa: 2_000,
              codAmountPaisa: 2_000,
            },
          ],
        },
      },
    });
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } });
    return { orderId: order.id, shipmentId: shipment.id };
  }

  it("records and applies a signed status webhook exactly once", async () => {
    const trackingCode = `SF-TRK-${randomUUID().slice(0, 6)}`;
    const { orderId, shipmentId } = await shippedParcel(trackingCode);

    const payload = { consignment_id: `CN-${randomUUID().slice(0, 6)}`, tracking_code: trackingCode, status: "delivered", delivery_charge: 80 };
    const first = await processCourierWebhook({ providerCode: "STEADFAST", payload, headers: {}, signatureValid: true });
    expect(first.duplicate).toBe(false);
    expect(first.status).toBe("PROCESSED");

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(shipment.status).toBe("DELIVERED");
    expect(shipment.trackingCode).toBe(trackingCode);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");

    const second = await processCourierWebhook({ providerCode: "STEADFAST", payload, headers: {}, signatureValid: true });
    expect(second.duplicate).toBe(true);

    const history = await prisma.shipmentStatusHistory.findMany({ where: { shipmentId } });
    expect(history.filter((entry) => entry.toStatus === "DELIVERED")).toHaveLength(1);
  });

  it("stores an unsigned webhook as failed and refuses it", async () => {
    const trackingCode = `SF-BAD-${randomUUID().slice(0, 6)}`;
    await shippedParcel(trackingCode);

    await expect(
      processCourierWebhook({
        providerCode: "STEADFAST",
        payload: { consignment_id: `CN-${trackingCode}`, tracking_code: trackingCode, status: "delivered" },
        headers: {},
        signatureValid: false,
      }),
    ).rejects.toThrow();

    const event = await prisma.courierWebhookEvent.findFirstOrThrow({ where: { trackingCode } });
    expect(event.status).toBe("FAILED");
    expect(event.signatureValid).toBe(false);
  });

  it("ignores a webhook whose tracking code matches nothing", async () => {
    const result = await processCourierWebhook({
      providerCode: "STEADFAST",
      payload: { consignment_id: "CN-NOT-OURS", tracking_code: "NOT-OURS-123", status: "in_transit" },
      headers: {},
      signatureValid: true,
    });
    expect(result.status).toBe("IGNORED");
  });
});
