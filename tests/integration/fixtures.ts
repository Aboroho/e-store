import { randomUUID } from "node:crypto";
import { prisma, withTransaction } from "@/lib/db/client";
import { applyStockMovement } from "@/modules/inventory/service";

/**
 * Shared fixtures for database-backed integration tests.
 *
 * Every suite builds its own business (unique slug) so parallel test files never
 * collide, and tears it down afterwards. Deleting the business cascades to
 * catalog, purchasing, inventory and order rows.
 */

export async function databaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export interface TestContext {
  businessId: string;
  userId: string;
  locationId: string;
  priceListId: string;
  slug: string;
}

export async function createTestBusiness(label: string): Promise<TestContext> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `test-${label}-${suffix}`;

  const business = await prisma.business.create({
    data: { name: `Test ${label} ${suffix}`, slug },
  });

  const user = await prisma.user.create({
    data: {
      businessId: business.id,
      email: `${slug}@example.test`,
      name: `Tester ${label}`,
      passwordHash: "not-used-in-tests",
      status: "ACTIVE",
    },
  });

  const location = await prisma.inventoryLocation.create({
    data: { businessId: business.id, name: "Test Warehouse", code: "MAIN", isDefault: true, isActive: true },
  });

  const priceList = await prisma.priceList.create({
    data: { businessId: business.id, name: "Default", slug: "default", isDefault: true, channel: "DEFAULT" },
  });

  for (const reason of [
    { code: "STOCK_COUNT", label: "Stock count correction", direction: "BOTH" as const, requiresNote: false },
    { code: "DAMAGE", label: "Damaged in warehouse", direction: "DECREASE" as const, requiresNote: true },
    { code: "FOUND", label: "Found stock", direction: "INCREASE" as const, requiresNote: false },
  ]) {
    await prisma.stockAdjustmentReason.create({
      data: { businessId: business.id, ...reason },
    });
  }

  return {
    businessId: business.id,
    userId: user.id,
    locationId: location.id,
    priceListId: priceList.id,
    slug,
  };
}

/**
 * Remove everything the suites created.
 *
 * Some relations are `Restrict` (users, locations and variants from ledger rows),
 * so the rows are removed explicitly in dependency order instead of relying on
 * the business cascade alone.
 */
export async function destroyTestBusiness(businessId: string): Promise<void> {
  // Stage 3 rows first: exchanges restrict their order, and settlements/COD
  // collections point at shipments, so they must go before the orders.
  await prisma.resellerPayoutEntry.deleteMany({ where: { payout: { businessId } } });
  await prisma.resellerPayoutTransaction.deleteMany({ where: { payout: { businessId } } });
  await prisma.resellerPayout.deleteMany({ where: { businessId } });
  await prisma.resellerLedgerEntry.deleteMany({ where: { businessId, reversesEntryId: null } });
  await prisma.resellerLedgerEntry.deleteMany({ where: { businessId } });
  await prisma.resellerOrderEarning.deleteMany({ where: { businessId } });
  await prisma.resellerCollectionChange.deleteMany({ where: { resellerId: { in: (await prisma.reseller.findMany({ where: { businessId }, select: { id: true } })).map((r) => r.id) } } });
  await prisma.exchangeItem.deleteMany({ where: { exchangeRequest: { businessId } } });
  await prisma.exchangeStatusHistory.deleteMany({ where: { exchangeRequest: { businessId } } });
  await prisma.refundAttempt.deleteMany({ where: { refund: { businessId } } });
  await prisma.refund.deleteMany({ where: { businessId } });
  await prisma.paymentEvent.deleteMany({ where: { payment: { businessId } } });
  await prisma.paymentAttempt.deleteMany({ where: { payment: { businessId } } });
  await prisma.paymentAllocation.deleteMany({ where: { payment: { businessId } } });
  await prisma.payment.deleteMany({ where: { businessId } });
  await prisma.codCollection.deleteMany({ where: { businessId } });
  await prisma.courierSettlementEntry.deleteMany({ where: { settlement: { businessId } } });
  await prisma.courierSettlement.deleteMany({ where: { businessId } });
  await prisma.courierCharge.deleteMany({ where: { shipment: { businessId } } });
  await prisma.shipmentStatusHistory.deleteMany({ where: { shipment: { businessId } } });
  await prisma.codCollection.deleteMany({ where: { businessId } });
  await prisma.shipment.deleteMany({ where: { businessId } });
  await prisma.courierWebhookEvent.deleteMany({ where: { courierProviderId: { not: null } } });
  await prisma.courierProvider.deleteMany({ where: { businessId } });
  await prisma.exchangeRequest.deleteMany({ where: { businessId } });
  await prisma.exchangeReason.deleteMany({ where: { businessId } });
  await prisma.outboxEvent.deleteMany({ where: { businessId } });
  await prisma.orderAdjustment.deleteMany({ where: { order: { businessId } } });
  await prisma.orderStatusHistory.deleteMany({ where: { order: { businessId } } });
  await prisma.orderAddress.deleteMany({ where: { order: { businessId } } });
  await prisma.customerSession.deleteMany({ where: { customer: { businessId } } });
  await prisma.verificationCode.deleteMany({ where: { businessId } });
  await prisma.customerAddress.deleteMany({ where: { customer: { businessId } } });
  await prisma.customerNote.deleteMany({ where: { customer: { businessId } } });
  await prisma.customer.deleteMany({ where: { businessId } });
  await prisma.deliveryZone.deleteMany({ where: { businessId } });
  await prisma.integrationSecret.deleteMany({ where: { courierProviderId: { not: null } } });
  await prisma.integration.deleteMany({ where: { businessId } });
  await prisma.storefront.deleteMany({ where: { businessId } });
  await prisma.preorderAllocation.deleteMany({ where: { preorderCommitment: { businessId } } });
  await prisma.reservationAllocation.deleteMany({ where: { reservation: { businessId } } });
  await prisma.stockReservation.deleteMany({ where: { businessId } });
  await prisma.stockAdjustment.deleteMany({ where: { businessId } });
  await prisma.inventoryMovement.deleteMany({ where: { businessId } });
  await prisma.goodsReceipt.deleteMany({ where: { purchaseOrder: { businessId } } });
  await prisma.purchaseOrder.deleteMany({ where: { businessId } });
  await prisma.supplierPayment.deleteMany({ where: { businessId } });
  await prisma.preorderCommitment.deleteMany({ where: { businessId } });
  await prisma.order.deleteMany({ where: { businessId } });
  await prisma.supplier.deleteMany({ where: { businessId } });
  await prisma.reseller.deleteMany({ where: { businessId } });
  await prisma.priceListItem.deleteMany({ where: { priceList: { businessId } } });
  await prisma.inventoryBalance.deleteMany({ where: { variant: { product: { businessId } } } });
  await prisma.product.deleteMany({ where: { businessId } });
  await prisma.priceList.deleteMany({ where: { businessId } });
  await prisma.category.deleteMany({ where: { businessId } });
  await prisma.attribute.deleteMany({ where: { businessId } });
  await prisma.stockAdjustmentReason.deleteMany({ where: { businessId } });
  await prisma.session.deleteMany({ where: { user: { businessId } } });
  await prisma.auditLog.deleteMany({ where: { businessId } });
  await prisma.user.deleteMany({ where: { businessId } });
  await prisma.inventoryLocation.deleteMany({ where: { businessId } });
  await prisma.business.delete({ where: { id: businessId } });
}

/** Minimal catalog fixture: one product with a single variant, priced. */
export async function createTestVariant(
  context: TestContext,
  options: { name?: string; sku?: string; pricePaisa?: number; costPaisa?: number } = {},
): Promise<{ productId: string; variantId: string; sku: string }> {
  const suffix = randomUUID().slice(0, 6);
  const sku = options.sku ?? `SKU-${suffix}`;

  const product = await prisma.product.create({
    data: {
      businessId: context.businessId,
      name: options.name ?? `Test product ${suffix}`,
      slug: `test-product-${suffix}`,
      productType: "SIMPLE",
      status: "ACTIVE",
      unitLabel: "piece",
      variants: {
        create: [
          {
            sku,
            name: "Default",
            optionKey: "default",
            status: "ACTIVE",
            priceOverridePaisa: options.pricePaisa ?? 10_000,
            costPaisa: options.costPaisa ?? 6_000,
          },
        ],
      },
    },
    include: { variants: true },
  });

  const variant = product.variants[0];
  if (!variant) throw new Error("fixture variant was not created");

  await prisma.inventoryBalance.create({
    data: { locationId: context.locationId, variantId: variant.id },
  });

  return { productId: product.id, variantId: variant.id, sku };
}

/** Minimal order fixture so preorder commitments (which require an order line) can be created. */
export async function createTestOrderLine(
  context: TestContext,
  variantId: string,
  quantity: number,
): Promise<{ orderId: string; orderItemId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const order = await prisma.order.create({
    data: {
      businessId: context.businessId,
      orderNumber: `TEST-${suffix}`,
      status: "PENDING",
      paymentStatus: "UNPAID",
      fulfillmentStatus: "UNFULFILLED",
      customerName: "Test Customer",
      customerPhone: "01700000000",
      customerPhoneNormalized: `88017000${suffix.slice(0, 5)}`,
      items: {
        create: [
          {
            variantId,
            sku: `SKU-${suffix}`,
            productName: "Fixture product",
            variantName: "Default",
            quantity,
            unitPricePaisa: 10_000,
            lineSubtotalPaisa: 10_000 * quantity,
            lineTotalPaisa: 10_000 * quantity,
          },
        ],
      },
    },
    include: { items: true },
  });

  const item = order.items[0];
  if (!item) throw new Error("fixture order item was not created");
  return { orderId: order.id, orderItemId: item.id };
}

export async function readBalance(locationId: string, variantId: string) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { locationId_variantId: { locationId, variantId } },
  });
  if (!balance) throw new Error("inventory balance row is missing");
  return balance;
}

/** Storefront fixture: needed before an order can be created from a storefront. */
export async function createTestStorefront(
  context: TestContext,
  options: { code?: string; priceListId?: string; locationId?: string } = {},
): Promise<{ storefrontId: string; slug: string }> {
  const suffix = randomUUID().slice(0, 6);
  const storefront = await prisma.storefront.create({
    data: {
      businessId: context.businessId,
      name: `Test storefront ${suffix}`,
      slug: `shop-${suffix}`,
      code: options.code ?? `SHOP-${suffix}`,
      status: "ACTIVE",
      isDefault: true,
      // Required list columns have no database default, so every fixture has to
      // supply them explicitly.
      allowedPaymentMethods: [],
      allowedCourierProviders: [],
      defaultPriceListId: options.priceListId ?? context.priceListId,
      defaultLocationId: options.locationId ?? context.locationId,
    },
  });
  return { storefrontId: storefront.id, slug: storefront.slug };
}

/** Put stock on the shelf through the real inventory service. */
export async function addTestStock(context: TestContext, variantId: string, quantity: number, unitCostPaisa = 5_000) {
  return withTransaction((tx) =>
    applyStockMovement(tx, {
      businessId: context.businessId,
      locationId: context.locationId,
      variantId,
      type: "OPENING",
      onHandDelta: quantity,
      unitCostPaisa,
      actorUserId: context.userId,
    }),
  );
}
