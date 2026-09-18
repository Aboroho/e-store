import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";

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
