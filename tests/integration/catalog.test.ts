import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { archiveProduct, createAttribute, createCategory, createProduct, updateProduct } from "@/modules/catalog/service";
import { setPriceListItem, resolveVariantPrice } from "@/modules/pricing/service";
import { applyStockMovement } from "@/modules/inventory/service";
import { withTransaction } from "@/lib/db/client";
import { createTestBusiness, databaseReachable, destroyTestBusiness, type TestContext } from "./fixtures";

/**
 * Catalog and pricing services against the real database: slug generation,
 * server-side duplicate SKU detection, price-list resolution and the archive
 * guards that stop a variant with stock or order history from disappearing.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("catalog and pricing (database)", () => {
  let context: TestContext;
  const actor = () => ({ userId: context.userId, businessId: context.businessId, actorLabel: "test-actor" });

  beforeAll(async () => {
    context = await createTestBusiness("catalog");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  it("creates a product with variants, price list items and balance rows", async () => {
    const createdAttribute = await createAttribute(actor(), {
      name: `Colour ${context.slug}`,
      type: "COLOR",
      unit: undefined,
      isVariantDefining: true,
      values: [
        { value: "Red", colorHex: "#dc2626" },
        { value: "Blue", colorHex: "#2563eb" },
      ],
    });

    const attributeValues = await prisma.attributeValue.findMany({
      where: { attributeId: createdAttribute.id },
      orderBy: { position: "asc" },
    });
    expect(attributeValues).toHaveLength(2);

    const created = await createProduct(actor(), {
      name: "Kitchen Scarf",
      slug: undefined,
      productType: "VARIABLE",
      status: "ACTIVE",
      shortDescription: "Soft cotton scarf",
      unitLabel: "piece",
      requiresShipping: true,
      isFeatured: false,
      isPreorderEnabled: false,
      taxRateBps: 0,
      packagingCostPaisa: 0,
      sku: `SCARF-${context.slug}`,
      mediaIds: [],
      categoryIds: [],
      attributeIds: [createdAttribute.id],
      variants: attributeValues.map((value, index) => ({
        name: value.value,
        pricePaisa: 12_500 + index * 500,
        costPaisa: 7_000,
        attributeValueIds: [value.id],
        isPreorderEnabled: false,
      })),
    });

    expect(created.slug).toContain("kitchen-scarf");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: created.id },
      include: { variants: { orderBy: { position: "asc" } } },
    });
    expect(product.variants).toHaveLength(2);

    for (const variant of product.variants) {
      const priceItem = await prisma.priceListItem.findFirst({
        where: { variantId: variant.id, minQuantity: 1 },
      });
      expect(priceItem?.pricePaisa ?? variant.priceOverridePaisa).toBeGreaterThan(0);

      const balance = await prisma.inventoryBalance.findUnique({
        where: { locationId_variantId: { locationId: context.locationId, variantId: variant.id } },
      });
      expect(balance).not.toBeNull();
      expect(balance?.onHand).toBe(0);
    }

    // The generated slug must be unique even when the same name is used twice.
    const second = await createProduct(actor(), {
      name: "Kitchen Scarf",
      slug: undefined,
      productType: "SIMPLE",
      status: "DRAFT",
      unitLabel: "piece",
      requiresShipping: true,
      isFeatured: false,
      isPreorderEnabled: false,
      taxRateBps: 0,
      packagingCostPaisa: 0,
      mediaIds: [],
      categoryIds: [],
      attributeIds: [],
      sku: `SCARF-ALT-${context.slug}`,
      variants: [
        { name: "Default", pricePaisa: 9_900, attributeValueIds: [], isPreorderEnabled: false },
      ],
    });
    expect(second.slug).not.toBe(product.slug);
  });

  it("creates an attribute with values even if the AuditLog.changedFields default is missing", async () => {
    // Regression test: databases that lost the column default (for example
    // after `prisma db push` without the schema default) used to fail every
    // attribute write with "Null constraint violation on the (not available)"
    // because the audit row omitted the NOT NULL array column. Audit writes
    // must always supply `changedFields` so they never depend on the default.
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ALTER COLUMN "changedFields" DROP DEFAULT');
    try {
      const attribute = await createAttribute(actor(), {
        name: `Size ${context.slug}`,
        slug: undefined,
        type: "SELECT",
        unit: undefined,
        isVariantDefining: true,
        values: [{ value: "S" }, { value: "M" }, { value: "L" }],
      });

      const values = await prisma.attributeValue.findMany({
        where: { attributeId: attribute.id },
        orderBy: { position: "asc" },
      });
      expect(values.map((value) => value.value)).toEqual(["S", "M", "L"]);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: attribute.id, action: "attribute.created" },
        select: { changedFields: true, summary: true },
      });
      expect(audit).not.toBeNull();
      expect(audit?.changedFields).toEqual(["attribute"]);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ALTER COLUMN "changedFields" SET DEFAULT ARRAY[]::TEXT[]');
    }
  });

  it("rejects duplicate product SKUs instead of letting the database fail", async () => {
    const duplicateSku = `DUP-${context.slug}`;

    await createProduct(actor(), {
      name: "Duplicate SKU product A",
      slug: undefined,
      productType: "SIMPLE",
      status: "DRAFT",
      unitLabel: "piece",
      requiresShipping: true,
      isFeatured: false,
      isPreorderEnabled: false,
      taxRateBps: 0,
      packagingCostPaisa: 0,
      sku: duplicateSku,
      mediaIds: [],
      categoryIds: [],
      attributeIds: [],
      variants: [{ name: "One", pricePaisa: 10_000, attributeValueIds: [], isPreorderEnabled: false }],
    });

    await expect(
      createProduct(actor(), {
        name: "Duplicate SKU product B",
        slug: undefined,
        productType: "SIMPLE",
        status: "DRAFT",
        unitLabel: "piece",
        requiresShipping: true,
        isFeatured: false,
        isPreorderEnabled: false,
        taxRateBps: 0,
        packagingCostPaisa: 0,
        sku: duplicateSku,
        mediaIds: [],
        categoryIds: [],
        attributeIds: [],
        variants: [{ name: "Two", pricePaisa: 10_000, attributeValueIds: [], isPreorderEnabled: false }],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("creates categories with a materialised path and blocks cycles", async () => {
    const parentCreated = await createCategory(actor(), {
      name: `Apparel ${context.slug}`,
      slug: undefined,
      parentId: undefined,
      position: 0,
      isActive: true,
      isFeatured: false,
    });
    const childCreated = await createCategory(actor(), {
      name: `Winter ${context.slug}`,
      slug: undefined,
      parentId: parentCreated.id,
      position: 0,
      isActive: true,
      isFeatured: false,
    });

    const parent = await prisma.category.findUniqueOrThrow({ where: { id: parentCreated.id } });
    const child = await prisma.category.findUniqueOrThrow({ where: { id: childCreated.id } });
    expect(child.path).toBe(`${parent.slug}/${child.slug}`);
    expect(parent.path).toBe(parent.slug);
    expect(parent.parentId).toBeNull();

    await expect(
      updateProduct(actor(), "00000000-0000-0000-0000-000000000000", { name: "Nope" }),
    ).rejects.toThrowError(/not found/i);

    const { updateCategory } = await import("@/modules/catalog/service");
    await expect(updateCategory(actor(), parent.id, { parentId: child.id })).rejects.toThrowError(/cycle|own|descendant/i);
  });

  it("resolves prices from the price list and honours the variant override fallback", async () => {
    const product = await createProduct(actor(), {
      name: "Priced product",
      slug: undefined,
      productType: "SIMPLE",
      status: "ACTIVE",
      unitLabel: "piece",
      requiresShipping: true,
      isFeatured: false,
      isPreorderEnabled: false,
      taxRateBps: 0,
      packagingCostPaisa: 0,
      mediaIds: [],
      categoryIds: [],
      attributeIds: [],
      sku: `PRICED-${context.slug}`,
      variants: [
        { name: "Default", pricePaisa: 20_000, attributeValueIds: [], isPreorderEnabled: false },
      ],
    });

    const [variant] = await prisma.variant.findMany({ where: { productId: product.id } });
    if (!variant) throw new Error("product did not create a variant");

    await setPriceListItem(actor(), { priceListId: context.priceListId, variantId: variant.id, pricePaisa: 19_500 });

    const resolved = await resolveVariantPrice(variant.id, { quantity: 1, priceListId: context.priceListId });
    expect(resolved.pricePaisa).toBe(19_500);

    // Bulk pricing tier wins for larger quantities.
    await setPriceListItem(actor(), { priceListId: context.priceListId, variantId: variant.id, pricePaisa: 17_000, minQuantity: 10 });
    const bulk = await resolveVariantPrice(variant.id, { quantity: 12, priceListId: context.priceListId });
    expect(bulk.pricePaisa).toBe(17_000);

    const single = await resolveVariantPrice(variant.id, { quantity: 1, priceListId: context.priceListId });
    expect(single.pricePaisa).toBe(19_500);
  });

  it("refuses to archive a variant that still has stock, and allows it once the stock is gone", async () => {
    const product = await createProduct(actor(), {
      name: "Archivable product",
      slug: undefined,
      productType: "SIMPLE",
      status: "ACTIVE",
      unitLabel: "piece",
      requiresShipping: true,
      isFeatured: false,
      isPreorderEnabled: false,
      taxRateBps: 0,
      packagingCostPaisa: 0,
      sku: `ARCH-${context.slug}`,
      mediaIds: [],
      categoryIds: [],
      attributeIds: [],
      variants: [
        { name: "Default", pricePaisa: 5_000, attributeValueIds: [], isPreorderEnabled: false },
      ],
    });

    const [variant] = await prisma.variant.findMany({ where: { productId: product.id } });
    if (!variant) throw new Error("product did not create a variant");

    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.id,
        type: "OPENING",
        onHandDelta: 4,
        unitCostPaisa: 3_000,
        actorUserId: context.userId,
      }),
    );

    await expect(archiveProduct(actor(), product.id)).rejects.toThrowError(/stock|reserved|preorder/i);

    await withTransaction((tx) =>
      applyStockMovement(tx, {
        businessId: context.businessId,
        locationId: context.locationId,
        variantId: variant.id,
        type: "CORRECTION",
        onHandDelta: -4,
        actorUserId: context.userId,
      }),
    );

    await archiveProduct(actor(), product.id, "test cleanup");
    const archived = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.deletedAt).not.toBeNull();
  });
});
