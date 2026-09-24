import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import {
  createManualOrder,
  updateManualOrder,
  type ManualOrderContext,
} from "@/modules/orders/manual";
import {
  bulkChangeOrderStatus,
  changeOrderStatus,
  deleteCancelledOrder,
  sendOrdersToCourier,
} from "@/modules/orders/lifecycle";
import {
  lookupSavedAddresses,
  searchOrders,
} from "@/modules/orders/lookup";
import {
  getCheckoutFields,
  saveCheckoutField,
} from "@/modules/orders/checkout-fields";
import {
  resolveOrderColumns,
  saveOrderColumns,
} from "@/modules/orders/columns";
import {
  addTestStock,
  createTestBusiness,
  createTestVariant,
  databaseReachable,
  destroyTestBusiness,
  type TestContext,
} from "./fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("manual order workflows and lifecycle (database)", () => {
  let context: TestContext;
  let secondUserId: string;

  const adminCtx = (overrides: Partial<ManualOrderContext> = {}): ManualOrderContext => ({
    businessId: context.businessId,
    userId: context.userId,
    permissions: new Set(["*"]),
    isOwner: true,
    roleLabel: "Owner",
    resellerId: null,
    actorLabel: "Test Owner",
    ipAddress: "127.0.0.1",
    ...overrides,
  });

  const staffCtx = (userId: string, permissions: string[] = ["order.create", "order.view", "order.update", "order.status.pre_courier", "order.cancel"]): ManualOrderContext => ({
    businessId: context.businessId,
    userId,
    permissions: new Set(permissions),
    isOwner: false,
    roleLabel: "Order Staff",
    resellerId: null,
    actorLabel: "Staff User",
    ipAddress: "127.0.0.1",
  });

  beforeAll(async () => {
    context = await createTestBusiness("manual-orders");

    // Create a manual courier provider for dispatch testing
    await prisma.courierProvider.create({
      data: {
        businessId: context.businessId,
        code: "MANUAL",
        name: "Manual Delivery",
        isEnabled: true,
        priority: 1,
      },
    });

    // Create a second user in the business for isolation tests
    const secondUser = await prisma.user.create({
      data: {
        businessId: context.businessId,
        email: `staff-${randomUUID().slice(0, 6)}@test.local`,
        name: "Second Staff",
        status: "ACTIVE",
      },
    });
    secondUserId = secondUser.id;
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  describe("manual order creation", () => {
    it("creates an online delivery order in PROCESSING with reserved stock and server-resolved pricing", async () => {
      const { variantId } = await createTestVariant(context, { pricePaisa: 15_000, costPaisa: 9_000 });
      await addTestStock(context, variantId, 10);

      const result = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: {
          name: "Karim Ahmed",
          phone: "01711223344",
          districtCode: "26",
          addressLine: "Road 5, Block B, Dhaka",
        },
        items: [{ key: "line-1", variantId, quantity: 2, allowPreorder: false }],
        paymentMethod: "COD",
        idempotencyKey: `man-${randomUUID()}`,
      });

      expect(result.orderId).toBeTruthy();
      expect(result.orderNumber).toMatch(/^ORD-/);
      expect(result.status).toBe("PROCESSING");
      expect(result.statusLabel).toBe("Processing");
      expect(result.orderType).toBe("ONLINE_DELIVERY");
      expect(result.reservedUnits).toBe(2);
      expect(result.preorderUnits).toBe(0);
      expect(result.reused).toBe(false);

      // Verify server snapshot
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: result.orderId },
        include: { items: true, reservations: true },
      });
      expect(order.items[0]?.unitPricePaisa).toBe(15_000);
      expect(order.items[0]?.quantity).toBe(2);
      expect(order.items[0]?.lineTotalPaisa).toBe(30_000);
      expect(order.reservations).toHaveLength(1);
    });

    it("re-uses existing order when submitted with duplicate idempotencyKey", async () => {
      const { variantId } = await createTestVariant(context, { pricePaisa: 8_000 });
      await addTestStock(context, variantId, 5);
      const idempotencyKey = `idem-${randomUUID()}`;

      const first = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Test User", phone: "01711000111", districtCode: "26", addressLine: "House 1" },
        items: [{ key: "l1", variantId, quantity: 1, allowPreorder: false }],
        paymentMethod: "COD",
        idempotencyKey,
      });

      const second = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Test User", phone: "01711000111", districtCode: "26", addressLine: "House 1" },
        items: [{ key: "l1", variantId, quantity: 1, allowPreorder: false }],
        paymentMethod: "COD",
        idempotencyKey,
      });

      expect(second.orderId).toBe(first.orderId);
      expect(second.reused).toBe(true);
    });

    it("creates a preorder commitment when stock is 0 and allowPreorder is set", async () => {
      const { variantId } = await createTestVariant(context, { pricePaisa: 20_000 });
      // Zero stock added

      const result = await createManualOrder(adminCtx(), {
        orderType: "PREORDER",
        customer: { name: "Preorder Customer", phone: "01811223344", districtCode: "26", addressLine: "Chattogram" },
        items: [{ key: "p1", variantId, quantity: 3, allowPreorder: true }],
        paymentMethod: "COD",
        idempotencyKey: `pre-${randomUUID()}`,
      });

      expect(result.status).toBe("PROCESSING");
      expect(result.reservedUnits).toBe(0);
      expect(result.preorderUnits).toBe(3);

      const commitments = await prisma.preorderCommitment.findMany({
        where: { businessId: context.businessId, variantId },
      });
      expect(commitments.length).toBeGreaterThanOrEqual(1);
    });

    it("creates an in-store counter order completed immediately", async () => {
      const { variantId } = await createTestVariant(context, { pricePaisa: 5_000 });
      await addTestStock(context, variantId, 10);

      const result = await createManualOrder(adminCtx(), {
        orderType: "IN_STORE",
        items: [{ key: "instore-1", variantId, quantity: 1, allowPreorder: false }],
        paymentMethod: "CASH",
        idempotencyKey: `ins-${randomUUID()}`,
      });

      expect(result.orderType).toBe("IN_STORE");
      expect(result.status).toBe("COMPLETED");
      expect(result.collectiblePaisa).toBe(0);
    });

    it("rejects manual order creation without customer district or address for delivery orders", async () => {
      const { variantId } = await createTestVariant(context);

      await expect(
        createManualOrder(adminCtx(), {
          orderType: "ONLINE_DELIVERY",
          customer: { name: "No Address" },
          items: [{ key: "err-1", variantId, quantity: 1, allowPreorder: false }],
          idempotencyKey: `fail-${randomUUID()}`,
        }),
      ).rejects.toThrow(/customer/i);
    });
  });

  describe("order status transitions and lifecycle", () => {
    it("allows creator to transition pre-courier order forward and backward within group", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const staff = staffCtx(secondUserId);
      const created = await createManualOrder(staff, {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Flow Test", phone: "01722334455", districtCode: "26", addressLine: "Sylhet" },
        items: [{ key: "f1", variantId, quantity: 1, allowPreorder: false }],
        paymentMethod: "COD",
        idempotencyKey: `flow-${randomUUID()}`,
      });

      // PROCESSING -> CONFIRMED
      const confirmed = await changeOrderStatus(staff, {
        orderId: created.orderId,
        status: "CONFIRMED",
      });
      expect(confirmed.to).toBe("CONFIRMED");

      // CONFIRMED -> ON_HOLD (requires reason)
      const onHold = await changeOrderStatus(staff, {
        orderId: created.orderId,
        status: "ON_HOLD",
        reason: "Customer requested next week delivery",
      });
      expect(onHold.to).toBe("ON_HOLD");

      // ON_HOLD -> CONFIRMED
      const backToConfirmed = await changeOrderStatus(staff, {
        orderId: created.orderId,
        status: "CONFIRMED",
      });
      expect(backToConfirmed.to).toBe("CONFIRMED");
    });

    it("releases stock reservations when order is cancelled", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const created = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Cancel Test", phone: "01733445566", districtCode: "26", addressLine: "Rajshahi" },
        items: [{ key: "c1", variantId, quantity: 2, allowPreorder: false }],
        paymentMethod: "COD",
        idempotencyKey: `cancel-${randomUUID()}`,
      });

      const cancelResult = await changeOrderStatus(adminCtx(), {
        orderId: created.orderId,
        status: "CANCELLED",
        reason: "Customer cancelled over phone",
      });
      expect(cancelResult.to).toBe("CANCELLED");
      expect(cancelResult.releasedUnits).toBe(2);

      const activeReservations = await prisma.stockReservation.findMany({
        where: { orderId: created.orderId, status: "ACTIVE" },
      });
      expect(activeReservations).toHaveLength(0);
    });

    it("performs bulk status changes and reports updated and skipped orders", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 10);

      const o1 = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Bulk 1", phone: "01744556677", districtCode: "26", addressLine: "Address 1" },
        items: [{ key: "b1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `bulk1-${randomUUID()}`,
      });

      const o2 = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Bulk 2", phone: "01744556688", districtCode: "26", addressLine: "Address 2" },
        items: [{ key: "b2", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `bulk2-${randomUUID()}`,
      });

      const bulkResult = await bulkChangeOrderStatus(adminCtx(), {
        orderIds: [o1.orderId, o2.orderId, randomUUID()], // includes a nonexistent ID
        status: "CONFIRMED",
      });

      expect(bulkResult.updated).toHaveLength(2);
      expect(bulkResult.skipped).toHaveLength(1);
      expect(bulkResult.skipped[0]?.reason).toBeTruthy();
    });
  });

  describe("courier dispatch", () => {
    it("sends confirmed orders to courier and rejects unconfirmed orders", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const o1 = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Dispatch Confirmed", phone: "01755667788", districtCode: "26", addressLine: "Dhaka Address" },
        items: [{ key: "d1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `disp1-${randomUUID()}`,
      });
      await changeOrderStatus(adminCtx(), { orderId: o1.orderId, status: "CONFIRMED" });

      const o2 = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Dispatch Processing", phone: "01755667799", districtCode: "26", addressLine: "Dhaka Address 2" },
        items: [{ key: "d2", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `disp2-${randomUUID()}`,
      }); // left in PROCESSING

      const dispatchResult = await sendOrdersToCourier(adminCtx(), {
        orderIds: [o1.orderId, o2.orderId],
      });

      expect(dispatchResult.submitted).toBe(1);
      expect(dispatchResult.skipped).toBe(1);
      expect(dispatchResult.entries[0]?.status).toBe("submitted");
      expect(dispatchResult.entries[0]?.shipmentId).toBeTruthy();
      expect(dispatchResult.entries[1]?.status).toBe("skipped");
      expect(dispatchResult.entries[1]?.reason).toMatch(/Only confirmed orders/);

      // Attempting to dispatch o1 again is skipped (prevent duplicate dispatch)
      const repeatDispatch = await sendOrdersToCourier(adminCtx(), {
        orderIds: [o1.orderId],
      });
      expect(repeatDispatch.submitted).toBe(0);
      expect(repeatDispatch.skipped).toBe(1);
      expect(repeatDispatch.entries[0]?.reason).toMatch(/Only confirmed orders|already sent/);
    });
  });

  describe("order editing", () => {
    it("updates pre-courier order customer details and notes", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const created = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Old Name", phone: "01766778899", districtCode: "26", addressLine: "Old Address" },
        items: [{ key: "e1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `edit-${randomUUID()}`,
      });

      const updated = await updateManualOrder(adminCtx(), {
        orderId: created.orderId,
        customer: { name: "Updated Name", phone: "01766778899", districtCode: "26", addressLine: "New Address Road 12" },
        courierNote: "Call before delivering",
        orderNote: "VIP customer",
      });

      expect(updated.orderId).toBe(created.orderId);
      expect(updated.changedFields).toContain("customerName");

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: created.orderId },
      });
      expect(order.customerName).toBe("Updated Name");
      expect(order.shippingAddressLine).toBe("New Address Road 12");
      expect(order.deliveryNotes).toBe("Call before delivering");
      expect(order.internalNote).toBe("VIP customer");
    });
  });

  describe("search and lookup isolation", () => {
    it("enforces order visibility: staff without order.view_all sees only own orders", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 10);

      const staff = staffCtx(secondUserId);

      // Staff creates an order
      await createManualOrder(staff, {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Staff Customer", phone: "01777889900", districtCode: "26", addressLine: "Loc 1" },
        items: [{ key: "s1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `staff-ord-${randomUUID()}`,
      });

      // Admin creates an order
      await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Admin Customer", phone: "01777889911", districtCode: "26", addressLine: "Loc 2" },
        items: [{ key: "a1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `admin-ord-${randomUUID()}`,
      });

      const staffSearchResult = await searchOrders(staff, {});
      const adminSearchResult = await searchOrders(adminCtx(), {});

      // Staff only sees the orders created by staff user
      expect(staffSearchResult.orders.length).toBeGreaterThanOrEqual(1);
      expect(staffSearchResult.orders.every((o) => o.createdByUserId === secondUserId)).toBe(true);
      expect(adminSearchResult.total).toBeGreaterThan(staffSearchResult.total);
    });

    it("looks up saved addresses and past order addresses by normalized phone", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const phone = "01788990011";
      await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Saved Address User", phone, districtCode: "26", addressLine: "Saved Street 42" },
        items: [{ key: "sa1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `addr-${randomUUID()}`,
      });

      const lookup = await lookupSavedAddresses(adminCtx(), "01788-990011");
      expect(lookup.found).toBe(true);
      expect(lookup.phone).toBe("01788990011");
      expect(lookup.recentOrders.length).toBeGreaterThanOrEqual(1);
      expect(lookup.recentOrders[0]?.addressLine).toBe("Saved Street 42");
    });
  });

  describe("order deletion", () => {
    it("refuses to delete non-cancelled orders", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const created = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Non Cancelled", phone: "01799001122", districtCode: "26", addressLine: "Khulna" },
        items: [{ key: "nc1", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `del-nc-${randomUUID()}`,
      });

      await expect(
        deleteCancelledOrder(adminCtx(), { orderId: created.orderId, confirmed: true }),
      ).rejects.toThrow(/Only cancelled orders/);
    });

    it("permanently deletes cancelled order, creates OrderDeletionRecord snapshot, and keeps customer intact", async () => {
      const { variantId } = await createTestVariant(context);
      await addTestStock(context, variantId, 5);

      const created = await createManualOrder(adminCtx(), {
        orderType: "ONLINE_DELIVERY",
        customer: { name: "Deletable Customer", phone: "01799001133", districtCode: "26", addressLine: "Barishal" },
        items: [{ key: "del-item", variantId, quantity: 1, allowPreorder: false }],
        idempotencyKey: `del-ok-${randomUUID()}`,
      });

      // Cancel the order first
      await changeOrderStatus(adminCtx(), {
        orderId: created.orderId,
        status: "CANCELLED",
        reason: "Duplicate entry",
      });

      const result = await deleteCancelledOrder(adminCtx(), {
        orderId: created.orderId,
        confirmed: true,
        reason: "Clean up test order",
      });

      expect(result.deleted).toBe(true);
      expect(result.orderNumber).toBe(created.orderNumber);

      // Order should no longer exist in DB
      const orderCheck = await prisma.order.findUnique({ where: { id: created.orderId } });
      expect(orderCheck).toBeNull();

      // Deletion log record exists with snapshot
      const deletionRecord = await prisma.orderDeletionRecord.findFirst({
        where: { orderId: created.orderId },
      });
      expect(deletionRecord).not.toBeNull();
      expect(deletionRecord?.orderNumber).toBe(created.orderNumber);
      expect(deletionRecord?.reason).toBe("Clean up test order");

      // Customer still exists
      const customer = await prisma.customer.findFirst({
        where: { businessId: context.businessId, phoneNormalized: "01799001133" },
      });
      expect(customer).not.toBeNull();
    });
  });

  describe("checkout fields configuration", () => {
    it("allows updating checkout field visibility and requirement", async () => {
      const initialFields = await getCheckoutFields(context.businessId);
      expect(initialFields.length).toBeGreaterThan(0);

      const updated = await saveCheckoutField(
        { businessId: context.businessId, userId: context.userId, permissions: new Set(["checkout_fields.manage"]) },
        {
          fieldKey: "email",
          isEnabled: true,
          isRequired: true,
          label: "Customer Email Address",
        },
      );

      const emailField = updated.find((f) => f.key === "email");
      expect(emailField?.isRequired).toBe(true);
      expect(emailField?.customLabel).toBe("Customer Email Address");
    });
  });

  describe("order list column preferences", () => {
    it("saves and resolves user column preferences", async () => {
      const columnsToSet = ["order", "created", "customer", "status", "total", "actions"];
      await saveOrderColumns(adminCtx(), columnsToSet);

      const resolved = await resolveOrderColumns(adminCtx());
      expect(resolved.source).toBe("user");
      expect(resolved.columns).toEqual(columnsToSet);
    });
  });
});
