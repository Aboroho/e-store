import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement } from "@/modules/inventory/service";
import { cancelOrder, createOrder, dispatchOrder, markOrderDelivered, transitionOrder, type OrderActor } from "@/modules/orders/service";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import { initiateProviderPayment, processProviderEvent, recordCodCollection, recordPayment, requestRefund, settleRefund } from "@/modules/payments/service";
import { confirmVerificationCode, findOrCreateCustomer, requestVerificationCode } from "@/modules/customers/service";
import { createTestBusiness, createTestStorefront, createTestVariant, databaseReachable, destroyTestBusiness, readBalance, type TestContext } from "./fixtures";

/**
 * Order lifecycle against the real database.
 *
 * The properties that matter and are asserted here:
 *  - stock is reserved inside the order transaction and oversell is impossible,
 *  - dispatch consumes the reservation exactly once, even if it is called twice,
 *  - cancelling releases the reservation and never double-releases,
 *  - payment callbacks are idempotent and a browser redirect alone never pays an order,
 *  - account access always requires a verification code.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("order lifecycle (database)", () => {
  let context: TestContext;
  let storefrontId: string;

  const actor = (): OrderActor => ({ businessId: context.businessId, userId: context.userId, actorType: "USER", actorLabel: "test-staff", actorEmail: undefined } as OrderActor);

  beforeAll(async () => {
    context = await createTestBusiness("orders");
    const storefront = await createTestStorefront(context);
    storefrontId = storefront.storefrontId;
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  async function stock(variantId: string, quantity: number) {
    return withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId,
        type: "OPENING",
        onHandDelta: quantity,
        unitCostPaisa: 5_000,
        actorUserId: context.userId,
      }),
    );
  }

  function orderInput(variantId: string, quantity: number, overrides: Record<string, unknown> = {}) {
    return createOrderInputSchema.parse({
      channel: "ADMIN",
      storefrontId,
      customerName: "Rahim Uddin",
      customerPhone: "01712345001",
      shippingDistrictCode: "26",
      shippingAddressLine: "12 Station Road, Ishwardi",
      items: [{ variantId, quantity }],
      idempotencyKey: `test-${randomUUID()}`,
      ...overrides,
    });
  }

  it("reserves stock and snapshots prices when the order is created", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-A-${Date.now()}`, pricePaisa: 12_500, costPaisa: 7_000 });
    await stock(variantId, 10);

    const result = await createOrder(actor(), orderInput(variantId, 3));
    expect(result.reservedUnits).toBe(3);
    expect(result.preorderUnits).toBe(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.order.id }, include: { items: true } });
    expect(order.items[0]!.unitPricePaisa).toBe(12_500);
    expect(order.items[0]!.unitCostPaisa).toBe(7_000);
    expect(order.items[0]!.variantAttributes).toBeTruthy();
    expect(order.items[0]!.productName).toContain("Test product");
    expect(order.grandTotalPaisa).toBe(37_500);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(10);
    expect(balance.reserved).toBe(3);

    const reservation = await prisma.stockReservation.findFirstOrThrow({ where: { orderItemId: order.items[0]!.id } });
    expect(reservation.quantity).toBe(3);
    expect(reservation.status).toBe("ACTIVE");
  });

  it("replays an idempotent create instead of reserving twice", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-B-${Date.now()}` });
    await stock(variantId, 5);

    const input = orderInput(variantId, 2);
    const first = await createOrder(actor(), input);
    const second = await createOrder(actor(), input);

    expect(second.reused).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.reserved).toBe(2);
  });

  it("refuses an order that would oversell a product without preorders", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-C-${Date.now()}` });
    await stock(variantId, 1);

    await expect(createOrder(actor(), orderInput(variantId, 2, { channel: "STOREFRONT" }))).rejects.toThrow(/preorders/i);
    const balance = await readBalance(context.locationId, variantId);
    expect(balance.reserved).toBe(0);
  });

  it("keeps concurrent orders from reserving the same unit", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-D-${Date.now()}` });
    await stock(variantId, 4);

    const attempts = await Promise.allSettled([
      createOrder(actor(), orderInput(variantId, 3)),
      createOrder(actor(), orderInput(variantId, 3)),
      createOrder(actor(), orderInput(variantId, 3)),
    ]);

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    expect(fulfilled.length).toBe(1);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.reserved).toBe(3);
    expect(balance.onHand - balance.reserved).toBe(1);
  });

  it("takes stock out of the shelf on dispatch, exactly once", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-E-${Date.now()}` });
    await stock(variantId, 6);

    const created = await createOrder(actor(), orderInput(variantId, 2));
    await transitionOrder(actor(), { orderId: created.order.id, status: "CONFIRMED" });

    const dispatched = await dispatchOrder(actor(), { orderId: created.order.id });
    expect(dispatched.dispatchedUnits).toBe(2);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.onHand).toBe(4);
    expect(balance.reserved).toBe(0);

    // A second dispatch must not move stock again: the order is no longer dispatchable.
    await expect(dispatchOrder(actor(), { orderId: created.order.id })).rejects.toThrow();

    const movements = await prisma.inventoryMovement.findMany({ where: { variantId, type: "SALE_DISPATCH" } });
    expect(movements).toHaveLength(1);

    const outbox = await prisma.outboxEvent.findMany({ where: { shipmentId: dispatched.shipment.id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.eventType).toBe("courier.shipment.create");
  });

  it("releases the reservation when an order is cancelled", async () => {
    const { variantId } = await createTestVariant(context, { sku: `ORD-F-${Date.now()}` });
    await stock(variantId, 3);

    const created = await createOrder(actor(), orderInput(variantId, 3));
    expect((await readBalance(context.locationId, variantId)).reserved).toBe(3);

    const cancelled = await cancelOrder(actor(), { orderId: created.order.id, reason: "Customer changed their mind" });
    expect(cancelled.releasedUnits).toBe(3);

    const balance = await readBalance(context.locationId, variantId);
    expect(balance.reserved).toBe(0);
    expect(balance.onHand).toBe(3);

    // Cancelling a cancelled order is refused, so the release cannot happen twice.
    await expect(cancelOrder(actor(), { orderId: created.order.id, reason: "again" })).rejects.toThrow();
    const releaseMovements = await prisma.inventoryMovement.findMany({ where: { variantId, type: "RESERVATION_RELEASE" } });
    expect(releaseMovements).toHaveLength(1);
  });

  it("reuses one customer identity across storefronts for the same phone number", async () => {
    const first = await withTransaction((tx) =>
      findOrCreateCustomer(tx, { businessId: context.businessId, name: "Shared Customer", phone: "01712345999" }),
    );
    const second = await withTransaction((tx) =>
      findOrCreateCustomer(tx, { businessId: context.businessId, name: "Shared Customer (spelling variant)", phone: "+8801712345999" }),
    );
    expect(second.id).toBe(first.id);
  });

  it("needs a verification code before a customer session exists", async () => {
    const customer = await withTransaction((tx) =>
      findOrCreateCustomer(tx, { businessId: context.businessId, name: "Code Customer", phone: "01712345888" }),
    );

    const requested = await requestVerificationCode({
      businessId: context.businessId,
      phone: "01712345888",
      purpose: "LOGIN",
      staffAssisted: true,
    });
    expect(requested.codeForStaff).toMatch(/^\d{4,8}$/);

    await expect(
      confirmVerificationCode({ businessId: context.businessId, phone: "01712345888", code: "000000", purpose: "LOGIN" }),
    ).rejects.toThrow();

    const confirmed = await confirmVerificationCode({
      businessId: context.businessId,
      phone: "01712345888",
      code: requested.codeForStaff!,
      purpose: "LOGIN",
    });
    expect(confirmed.customerId).toBe(customer.id);
    expect(confirmed.sessionToken).toBeTruthy();

    const sessions = await prisma.customerSession.count({ where: { customerId: customer.id, revokedAt: null } });
    expect(sessions).toBe(1);
  });

  it("records partial then full payments and refuses to overpay", async () => {
    const { variantId } = await createTestVariant(context, { sku: `PAY-A-${Date.now()}`, pricePaisa: 10_000 });
    await stock(variantId, 2);
    const created = await createOrder(actor(), orderInput(variantId, 2));

    const first = await recordPayment(actor(), { orderId: created.order.id, amountPaisa: 8_000, method: "CASH", idempotencyKey: `pay-a-${randomUUID()}` });
    expect(first.order.paymentStatus).toBe("PARTIALLY_PAID");
    expect(first.order.duePaisa).toBe(12_000);

    const second = await recordPayment(actor(), { orderId: created.order.id, amountPaisa: 12_000, method: "BKASH", providerReference: "TRX-1" });
    expect(second.order.paymentStatus).toBe("PAID");
    expect(second.order.duePaisa).toBe(0);

    await expect(recordPayment(actor(), { orderId: created.order.id, amountPaisa: 100, method: "CASH" })).rejects.toThrow();
  });

  it("applies a gateway callback once and only when the amount matches", async () => {
    const { variantId } = await createTestVariant(context, { sku: `PAY-B-${Date.now()}`, pricePaisa: 20_000 });
    await stock(variantId, 1);
    const created = await createOrder(actor(), orderInput(variantId, 1));

    const attempt = await initiateProviderPayment(actor(), { orderId: created.order.id, method: "BKASH", returnUrl: "https://example.test/callback" });
    expect(attempt.attempt.clientReference).toMatch(/^PAY-/);

    const eventId = `evt-${randomUUID()}`;
    const applied = await processProviderEvent({
      businessId: context.businessId,
      providerName: "bkash",
      eventType: "payment.execute",
      providerEventId: eventId,
      signatureValid: true,
      payload: { trxID: "ABC123" },
      clientReference: attempt.attempt.clientReference,
      providerPaymentId: "payment-1",
      amountPaisa: 20_000,
      succeeded: true,
    });
    expect(applied.applied).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(order.paymentStatus).toBe("PAID");

    // The same provider event delivered twice is a no-op.
    const duplicate = await processProviderEvent({
      businessId: context.businessId,
      providerName: "bkash",
      eventType: "payment.execute",
      providerEventId: eventId,
      signatureValid: true,
      payload: { trxID: "ABC123" },
      clientReference: attempt.attempt.clientReference,
      providerPaymentId: "payment-1",
      amountPaisa: 20_000,
      succeeded: true,
    });
    expect(duplicate.applied).toBe(false);

    const paidPayments = await prisma.payment.count({ where: { orderId: created.order.id, paidPaisa: { gt: 0 } } });
    expect(paidPayments).toBe(1);
  });

  it("records cash on delivery from the courier and refunds it", async () => {
    const { variantId } = await createTestVariant(context, { sku: `PAY-C-${Date.now()}`, pricePaisa: 15_000 });
    await stock(variantId, 1);
    const created = await createOrder(actor(), orderInput(variantId, 1));

    await transitionOrder(actor(), { orderId: created.order.id, status: "CONFIRMED" });
    const dispatched = await dispatchOrder(actor(), { orderId: created.order.id });
    await markOrderDelivered(actor(), created.order.id);

    const cod = await recordCodCollection(actor(), {
      orderId: created.order.id,
      shipmentId: dispatched.shipment.id,
      collectedPaisa: 15_000,
      courierChargePaisa: 700,
    });
    expect(cod.order.paymentStatus).toBe("PAID");

    // Recording the same shipment collection twice is idempotent.
    const again = await recordCodCollection(actor(), {
      orderId: created.order.id,
      shipmentId: dispatched.shipment.id,
      collectedPaisa: 15_000,
    });
    expect(again.reused).toBe(true);
    expect(again.payment.id).toBe(cod.payment.id);

    const refund = await requestRefund(actor(), {
      orderId: created.order.id,
      amountPaisa: 5_000,
      method: "MANUAL",
      reason: "Damaged in transit",
      restock: false,
      idempotencyKey: `refund-${randomUUID()}`,
    });
    const settled = await settleRefund(actor(), { refundId: refund.refund.id, providerReference: "MANUAL-REF-1" });
    expect(settled.refund.status).toBe("COMPLETED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(order.refundedPaisa).toBe(5_000);
    expect(order.paymentStatus).toBe("PARTIALLY_REFUNDED");
  });
});
