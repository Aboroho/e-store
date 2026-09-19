import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import { defaultLocationId, ensureBalance } from "@/modules/inventory/service";
import type { AttributeInput, CategoryInput, ProductInput, VariantInput } from "@/modules/catalog/schemas";

/**
 * Catalog service: products, variants, attributes, categories.
 *
 * Business rules enforced here:
 *  - a variant combination (its option key) is unique inside a product;
 *  - SKUs are unique;
 *  - variants referenced by historical documents are archived, never deleted;
 *  - every product gets an inventory balance row so stock screens list it;
 *  - category slugs are unique per business and a category cannot parent itself.
 */

export interface CatalogActor {
  userId: string;
  businessId: string;
  actorLabel: string;
}

function optionKeyFor(values: Array<{ attributeId: string; attributeSlug: string; valueSlug: string }>): string {
  return [...values]
    .sort((a, b) => (a.attributeSlug === b.attributeSlug ? a.valueSlug.localeCompare(b.valueSlug) : a.attributeSlug.localeCompare(b.attributeSlug)))
    .map((entry) => `${entry.attributeSlug}:${entry.valueSlug}`)
    .join("|");
}

async function uniqueSlug(
  tx: Prisma.TransactionClient,
  businessId: string,
  desired: string,
  kind: "product" | "category",
): Promise<string> {
  const base = desired || "item";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    // Soft-deleted rows still occupy the database unique index, so the check
    // deliberately ignores `deletedAt`.
    const existing =
      kind === "product"
        ? await tx.product.findFirst({ where: { businessId, slug: candidate }, select: { id: true } })
        : await tx.category.findFirst({ where: { businessId, slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 200) throw AppError.conflict("Unable to generate a unique slug");
  }
}

async function loadDefaultPriceList(tx: Prisma.TransactionClient, businessId: string): Promise<{ id: string }> {
  const list = await tx.priceList.findFirst({
    where: { businessId, isDefault: true },
    select: { id: true },
  });
  if (list) return list;
  const anyList = await tx.priceList.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (anyList) return anyList;
  throw AppError.conflict("Create a price list before adding products");
}

/** How many historical documents point at this variant? */
export async function variantReferenceCounts(variantId: string): Promise<{
  orderItems: number;
  purchaseItems: number;
  exchangeItems: number;
  movements: number;
  total: number;
}> {
  const [orderItems, purchaseItems, exchangeItems, movements] = await Promise.all([
    prisma.orderItem.count({ where: { variantId } }),
    prisma.purchaseOrderItem.count({ where: { variantId } }),
    prisma.exchangeItem.count({ where: { variantId } }),
    prisma.inventoryMovement.count({ where: { variantId } }),
  ]);
  return { orderItems, purchaseItems, exchangeItems, movements, total: orderItems + purchaseItems + exchangeItems + movements };
}

export async function createProduct(actor: CatalogActor, input: ProductInput) {
  const baseSlug = input.slug ?? slugify(input.name);
  if (!baseSlug) throw AppError.validation("Enter a product name that can be turned into a URL slug");

  return withTransaction(async (tx) => {
    const locationId = await defaultLocationId(actor.businessId);
    const slug = await uniqueSlug(tx, actor.businessId, baseSlug, "product");
    const priceList = await loadDefaultPriceList(tx, actor.businessId);

    // Attribute values must exist and belong to this business.
    const attributeValueIds = [...new Set(input.variants.flatMap((variant) => variant.attributeValueIds))];
    const attributeValues = attributeValueIds.length
      ? await tx.attributeValue.findMany({
          where: { id: { in: attributeValueIds } },
          include: { attribute: { select: { id: true, slug: true, businessId: true, name: true } } },
        })
      : [];
    if (attributeValues.length !== attributeValueIds.length) {
      throw AppError.validation("One or more attribute values do not exist");
    }
    for (const value of attributeValues) {
      if (value.attribute.businessId !== actor.businessId) {
        throw AppError.validation(`Attribute value "${value.value}" belongs to another business`);
      }
    }
    const valueById = new Map(attributeValues.map((value) => [value.id, value]));

    // Validate the combinations before writing anything.
    const seenOptionKeys = new Set<string>();
    const seenSkus = new Set<string>();
    for (const variant of input.variants) {
      const key = optionKeyFor(
        variant.attributeValueIds.map((id) => {
          const value = valueById.get(id)!;
          return { attributeId: value.attribute.id, attributeSlug: value.attribute.slug, valueSlug: value.slug };
        }),
      );
      if (key && seenOptionKeys.has(key)) {
        throw AppError.validation(`Two variants share the same option combination (${key.replace(/\|/g, " + ")})`);
      }
      if (key) seenOptionKeys.add(key);
      const sku = variant.sku.toUpperCase();
      if (seenSkus.has(sku)) throw AppError.validation(`Duplicate SKU in this product: ${sku}`);
      seenSkus.add(sku);
    }

    const product = await tx.product.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug,
        productType: input.productType,
        status: input.status,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        brand: input.brand ?? null,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        unitLabel: input.unitLabel,
        weightGrams: input.weightGrams ?? null,
        requiresShipping: input.requiresShipping,
        isFeatured: input.isFeatured,
        isPreorderEnabled: input.isPreorderEnabled,
        preorderNote: input.preorderNote ?? null,
        preorderExpectedAt: input.preorderExpectedAt ?? null,
        taxRateBps: input.taxRateBps,
        packagingCostPaisa: input.packagingCostPaisa,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        seoKeywords: input.seoKeywords ?? null,
        publishedAt: input.status === "ACTIVE" ? new Date() : null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        categories: input.categoryIds.length
          ? {
              create: input.categoryIds.map((categoryId, index) => ({
                categoryId,
                isPrimary: input.primaryCategoryId ? categoryId === input.primaryCategoryId : index === 0,
                position: index,
              })),
            }
          : undefined,
        attributes: input.attributeIds.length
          ? { create: input.attributeIds.map((attributeId, index) => ({ attributeId, position: index })) }
          : undefined,
      },
    });

    for (const [index, variantInput] of input.variants.entries()) {
      const optionKey = optionKeyFor(
        variantInput.attributeValueIds.map((id) => {
          const value = valueById.get(id)!;
          return { attributeId: value.attribute.id, attributeSlug: value.attribute.slug, valueSlug: value.slug };
        }),
      );

      const variant = await tx.variant.create({
        data: {
          productId: product.id,
          sku: variantInput.sku.toUpperCase(),
          barcode: variantInput.barcode ?? null,
          name: variantInput.name,
          optionKey: optionKey || "default",
          position: index,
          weightGrams: variantInput.weightGrams ?? null,
          priceOverridePaisa: variantInput.pricePaisa,
          compareAtPricePaisa: variantInput.compareAtPricePaisa ?? null,
          costPaisa: variantInput.costPaisa ?? null,
          isPreorderEnabled: variantInput.isPreorderEnabled,
          attributesSummary: optionKey
            ? Object.fromEntries(
                variantInput.attributeValueIds.map((id) => {
                  const value = valueById.get(id)!;
                  return [value.attribute.slug, value.slug];
                }),
              )
            : undefined,
          attributeValues: variantInput.attributeValueIds.length
            ? {
                create: variantInput.attributeValueIds.map((id) => {
                  const value = valueById.get(id)!;
                  return { attributeId: value.attribute.id, attributeValueId: value.id };
                }),
              }
            : undefined,
        },
        select: { id: true, sku: true, name: true },
      });

      await tx.priceListItem.create({
        data: {
          priceListId: priceList.id,
          variantId: variant.id,
          productId: product.id,
          pricePaisa: variantInput.pricePaisa,
          compareAtPricePaisa: variantInput.compareAtPricePaisa ?? null,
        },
      });

      await ensureBalance(tx, { locationId, variantId: variant.id });
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorType: "USER",
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "product.created",
        entityType: "Product",
        entityId: product.id,
        summary: `Created product ${product.name} with ${input.variants.length} variant(s)`,
        after: { name: product.name, slug: product.slug, status: product.status, variants: input.variants.map((v) => v.sku) },
        changedFields: ["product"],
      },
    });

    return product;
  });
}

export async function updateProduct(actor: CatalogActor, productId: string, input: Partial<ProductInput>) {
  return withTransaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, businessId: actor.businessId, deletedAt: null },
      select: { id: true, name: true, slug: true, status: true, publishedAt: true },
    });
    if (!product) throw AppError.notFound("Product not found");

    const data: Prisma.ProductUpdateInput = {
      updatedByUserId: actor.userId,
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.shortDescription !== undefined) data.shortDescription = input.shortDescription ?? null;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.brand !== undefined) data.brand = input.brand ?? null;
    if (input.sku !== undefined) data.sku = input.sku ?? null;
    if (input.barcode !== undefined) data.barcode = input.barcode ?? null;
    if (input.unitLabel !== undefined) data.unitLabel = input.unitLabel;
    if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams ?? null;
    if (input.requiresShipping !== undefined) data.requiresShipping = input.requiresShipping;
    if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
    if (input.isPreorderEnabled !== undefined) data.isPreorderEnabled = input.isPreorderEnabled;
    if (input.preorderNote !== undefined) data.preorderNote = input.preorderNote ?? null;
    if (input.preorderExpectedAt !== undefined) data.preorderExpectedAt = input.preorderExpectedAt ?? null;
    if (input.taxRateBps !== undefined) data.taxRateBps = input.taxRateBps;
    if (input.packagingCostPaisa !== undefined) data.packagingCostPaisa = input.packagingCostPaisa;
    if (input.seoTitle !== undefined) data.seoTitle = input.seoTitle ?? null;
    if (input.seoDescription !== undefined) data.seoDescription = input.seoDescription ?? null;
    if (input.seoKeywords !== undefined) data.seoKeywords = input.seoKeywords ?? null;
    if (input.productType !== undefined) data.productType = input.productType;
    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === "ACTIVE" && !product.publishedAt) data.publishedAt = new Date();
      if (input.status === "ARCHIVED") data.archivedAt = new Date();
    }
    if (input.slug !== undefined && input.slug !== product.slug) {
      data.slug = await uniqueSlug(tx, actor.businessId, input.slug, "product");
    }

    const updated = await tx.product.update({ where: { id: productId }, data, select: { id: true, name: true, slug: true, status: true } });

    if (input.categoryIds) {
      await tx.productCategory.deleteMany({ where: { productId } });
      if (input.categoryIds.length > 0) {
        await tx.productCategory.createMany({
          data: input.categoryIds.map((categoryId, index) => ({
            productId,
            categoryId,
            isPrimary: input.primaryCategoryId ? categoryId === input.primaryCategoryId : index === 0,
            position: index,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (input.attributeIds) {
      await tx.productAttribute.deleteMany({ where: { productId } });
      if (input.attributeIds.length > 0) {
        await tx.productAttribute.createMany({
          data: input.attributeIds.map((attributeId, index) => ({ productId, attributeId, position: index })),
          skipDuplicates: true,
        });
      }
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "product.updated",
        entityType: "Product",
        entityId: productId,
        summary: `Updated product ${updated.name}`,
        before: { name: product.name, slug: product.slug, status: product.status },
        after: { name: updated.name, slug: updated.slug, status: updated.status },
        changedFields: Object.keys(input),
      },
    });

    return updated;
  });
}

export async function archiveProduct(actor: CatalogActor, productId: string, reason?: string): Promise<void> {
  await withTransaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: productId, businessId: actor.businessId, deletedAt: null },
      include: { variants: { select: { id: true } } },
    });
    if (!product) throw AppError.notFound("Product not found");

    const balances = await tx.inventoryBalance.findMany({
      where: { variantId: { in: product.variants.map((variant) => variant.id) } },
      select: { onHand: true, reserved: true },
    });
    const stockInPlay = balances.reduce((total, balance) => total + balance.onHand + balance.reserved, 0);
    if (stockInPlay > 0) {
      throw AppError.conflict(
        "This product still has stock on hand or reservations. Adjust the stock to zero before archiving.",
      );
    }

    await tx.product.update({
      where: { id: productId },
      data: { status: "ARCHIVED", archivedAt: new Date(), deletedAt: new Date(), updatedByUserId: actor.userId },
    });
    await tx.variant.updateMany({ where: { productId }, data: { status: "ARCHIVED" } });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "product.archived",
        entityType: "Product",
        entityId: productId,
        summary: `Archived product ${product.name}`,
        reason: reason ?? null,
        changedFields: ["status", "deletedAt"],
      },
    });
  });
}

export async function restoreProduct(actor: CatalogActor, productId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, businessId: actor.businessId } });
    if (!product) throw AppError.notFound("Product not found");
    await tx.product.update({
      where: { id: productId },
      data: { status: "DRAFT", archivedAt: null, deletedAt: null, updatedByUserId: actor.userId },
    });
    await tx.variant.updateMany({ where: { productId }, data: { status: "ACTIVE" } });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "product.restored",
        entityType: "Product",
        entityId: productId,
        summary: `Restored product ${product.name} as a draft`,
        changedFields: ["status", "deletedAt"],
      },
    });
  });
}

/** Update a single variant; price changes are written as new price list items. */
export async function updateVariant(actor: CatalogActor, variantId: string, input: Partial<VariantInput>) {
  return withTransaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: { id: variantId, product: { businessId: actor.businessId } },
      select: { id: true, sku: true, name: true, priceOverridePaisa: true, costPaisa: true, productId: true },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    if (input.sku && input.sku.toUpperCase() !== variant.sku) {
      const clash = await tx.variant.findFirst({
        where: { sku: input.sku.toUpperCase(), id: { not: variantId } },
        select: { id: true },
      });
      if (clash) throw AppError.conflict(`SKU ${input.sku.toUpperCase()} is already used by another variant`);
    }

    const updated = await tx.variant.update({
      where: { id: variantId },
      data: {
        name: input.name ?? undefined,
        sku: input.sku ? input.sku.toUpperCase() : undefined,
        barcode: input.barcode !== undefined ? input.barcode || null : undefined,
        priceOverridePaisa: input.pricePaisa ?? undefined,
        compareAtPricePaisa: input.compareAtPricePaisa !== undefined ? input.compareAtPricePaisa : undefined,
        costPaisa: input.costPaisa !== undefined ? input.costPaisa : undefined,
        weightGrams: input.weightGrams !== undefined ? input.weightGrams : undefined,
        isPreorderEnabled: input.isPreorderEnabled ?? undefined,
      },
      select: { id: true, sku: true, name: true, priceOverridePaisa: true, costPaisa: true },
    });

    if (input.pricePaisa !== undefined) {
      const priceList = await loadDefaultPriceList(tx, actor.businessId);
      await tx.priceListItem.upsert({
        where: { priceListId_variantId_minQuantity: { priceListId: priceList.id, variantId, minQuantity: 1 } },
        create: {
          priceListId: priceList.id,
          variantId,
          productId: variant.productId,
          pricePaisa: input.pricePaisa,
          compareAtPricePaisa: input.compareAtPricePaisa ?? null,
        },
        update: { pricePaisa: input.pricePaisa, compareAtPricePaisa: input.compareAtPricePaisa ?? null },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "variant.updated",
        entityType: "Variant",
        entityId: variantId,
        summary: `Updated variant ${updated.sku}`,
        before: { pricePaisa: variant.priceOverridePaisa, costPaisa: variant.costPaisa, name: variant.name },
        after: { pricePaisa: updated.priceOverridePaisa, costPaisa: updated.costPaisa, name: updated.name },
        changedFields: Object.keys(input),
      },
    });

    return updated;
  });
}

/** Bulk edit of the fields that merchandisers change in batches. */
export async function bulkUpdateVariants(
  actor: CatalogActor,
  productId: string,
  rows: Array<{ variantId: string; pricePaisa?: number; compareAtPricePaisa?: number | null; costPaisa?: number | null; status?: "ACTIVE" | "ARCHIVED"; weightGrams?: number | null }>,
): Promise<number> {
  if (rows.length === 0) return 0;

  return withTransaction(async (tx) => {
    const variants = await tx.variant.findMany({
      where: { productId, product: { businessId: actor.businessId } },
      select: { id: true, sku: true },
    });
    const validIds = new Map(variants.map((variant) => [variant.id, variant.sku]));
    const priceList = await loadDefaultPriceList(tx, actor.businessId);
    let updatedCount = 0;

    for (const row of rows) {
      if (!validIds.has(row.variantId)) continue;
      const data: Prisma.VariantUpdateInput = {};
      if (row.pricePaisa !== undefined) {
        if (row.pricePaisa < 0) throw AppError.validation("Prices cannot be negative");
        data.priceOverridePaisa = row.pricePaisa;
      }
      if (row.compareAtPricePaisa !== undefined) data.compareAtPricePaisa = row.compareAtPricePaisa;
      if (row.costPaisa !== undefined) data.costPaisa = row.costPaisa;
      if (row.status !== undefined) data.status = row.status;
      if (row.weightGrams !== undefined) data.weightGrams = row.weightGrams;
      if (Object.keys(data).length === 0) continue;

      await tx.variant.update({ where: { id: row.variantId }, data });
      if (row.pricePaisa !== undefined) {
        await tx.priceListItem.upsert({
          where: { priceListId_variantId_minQuantity: { priceListId: priceList.id, variantId: row.variantId, minQuantity: 1 } },
          create: {
            priceListId: priceList.id,
            variantId: row.variantId,
            productId,
            pricePaisa: row.pricePaisa,
            compareAtPricePaisa: row.compareAtPricePaisa ?? null,
          },
          update: { pricePaisa: row.pricePaisa, compareAtPricePaisa: row.compareAtPricePaisa ?? null },
        });
      }
      updatedCount += 1;
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "variant.bulk_updated",
        entityType: "Product",
        entityId: productId,
        summary: `Bulk updated ${updatedCount} variant(s)`,
        after: { rows: rows.length, updated: updatedCount },
        changedFields: ["variants"],
      },
    });

    return updatedCount;
  });
}

export async function archiveVariant(actor: CatalogActor, variantId: string, reason?: string): Promise<void> {
  await withTransaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: { id: variantId, product: { businessId: actor.businessId } },
      select: { id: true, sku: true, productId: true },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    const balance = await tx.inventoryBalance.findFirst({ where: { variantId }, select: { onHand: true, reserved: true } });
    if (balance && (balance.onHand > 0 || balance.reserved > 0)) {
      throw AppError.conflict("Variants with stock on hand or reservations cannot be archived. Adjust the stock first.");
    }

    // Historical references make deletion impossible; archive instead and keep the ledger intact.
    await tx.variant.update({ where: { id: variantId }, data: { status: "ARCHIVED" } });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "variant.archived",
        entityType: "Variant",
        entityId: variantId,
        summary: `Archived variant ${variant.sku}`,
        reason: reason ?? null,
        changedFields: ["status"],
      },
    });
  });
}

// ---------------------------------------------------------------- categories

export async function createCategory(actor: CatalogActor, input: CategoryInput) {
  return withTransaction(async (tx) => {
    const slug = await uniqueSlug(tx, actor.businessId, input.slug ?? slugify(input.name), "category");
    if (input.parentId) {
      const parent = await tx.category.findFirst({ where: { id: input.parentId, businessId: actor.businessId }, select: { id: true, path: true } });
      if (!parent) throw AppError.validation("The selected parent category does not exist");
    }

    const category = await tx.category.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug,
        parentId: input.parentId ?? null,
        description: input.description ?? null,
        position: input.position,
        isActive: input.isActive,
        isFeatured: input.isFeatured,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
      },
      select: { id: true, name: true, slug: true, parentId: true },
    });

    await recalculateCategoryPath(tx, category.id);
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "category.created",
        entityType: "Category",
        entityId: category.id,
        summary: `Created category ${category.name}`,
        changedFields: ["category"],
      },
    });
    return category;
  });
}

export async function updateCategory(actor: CatalogActor, categoryId: string, input: Partial<CategoryInput>) {
  return withTransaction(async (tx) => {
    const category = await tx.category.findFirst({ where: { id: categoryId, businessId: actor.businessId } });
    if (!category) throw AppError.notFound("Category not found");
    if (input.parentId && input.parentId === categoryId) {
      throw AppError.validation("A category cannot be its own parent");
    }
    if (input.parentId) {
      // Prevent cycles: the new parent may not be a descendant.
      const descendants = await tx.category.findMany({
        where: { businessId: actor.businessId, path: { startsWith: `${category.path ?? category.slug}/` } },
        select: { id: true },
      });
      if (descendants.some((descendant) => descendant.id === input.parentId)) {
        throw AppError.validation("A category cannot be moved inside one of its own children");
      }
    }

    await tx.category.update({
      where: { id: categoryId },
      data: {
        name: input.name ?? undefined,
        parentId: input.parentId !== undefined ? input.parentId ?? null : undefined,
        description: input.description !== undefined ? input.description ?? null : undefined,
        position: input.position ?? undefined,
        isActive: input.isActive ?? undefined,
        isFeatured: input.isFeatured ?? undefined,
        seoTitle: input.seoTitle !== undefined ? input.seoTitle ?? null : undefined,
        seoDescription: input.seoDescription !== undefined ? input.seoDescription ?? null : undefined,
      },
    });

    await recalculateCategoryPath(tx, categoryId);
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "category.updated",
        entityType: "Category",
        entityId: categoryId,
        summary: `Updated category ${input.name ?? category.name}`,
        changedFields: Object.keys(input),
      },
    });
    return tx.category.findUniqueOrThrow({ where: { id: categoryId } });
  });
}

export async function deleteCategory(actor: CatalogActor, categoryId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: categoryId, businessId: actor.businessId },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) throw AppError.notFound("Category not found");
    if (category._count.products > 0) {
      throw AppError.conflict("This category is assigned to products. Remove it from those products first.");
    }
    if (category._count.children > 0) {
      throw AppError.conflict("This category has sub-categories. Move or delete them first.");
    }
    await tx.category.delete({ where: { id: categoryId } });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "category.deleted",
        entityType: "Category",
        entityId: categoryId,
        summary: `Deleted category ${category.name}`,
        before: { name: category.name, slug: category.slug },
        changedFields: ["category"],
      },
    });
  });
}

/** Rebuild the materialised path (`parent/child/grandchild` slugs) for a category and its subtree. */
async function recalculateCategoryPath(tx: Prisma.TransactionClient, categoryId: string): Promise<void> {
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    include: { parent: { select: { id: true, path: true, slug: true } } },
  });
  if (!category) return;
  const path = category.parent ? `${category.parent.path ?? category.parent.slug}/${category.slug}` : category.slug;
  await tx.category.update({ where: { id: categoryId }, data: { path } });
  const children = await tx.category.findMany({ where: { parentId: categoryId }, select: { id: true } });
  for (const child of children) {
    await recalculateCategoryPath(tx, child.id);
  }
}

// ---------------------------------------------------------------- attributes

export async function createAttribute(actor: CatalogActor, input: AttributeInput) {
  return withTransaction(async (tx) => {
    const slug = slugify(input.slug ?? input.name);
    const existing = await tx.attribute.findFirst({ where: { businessId: actor.businessId, slug } });
    if (existing) throw AppError.conflict(`An attribute with the slug "${slug}" already exists`);

    const attribute = await tx.attribute.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug,
        type: input.type,
        unit: input.unit ?? null,
        isVariantDefining: input.isVariantDefining,
        values: input.values.length
          ? {
              create: input.values.map((value, index) => ({
                value: value.value,
                slug: slugify(value.value) || `value-${index + 1}`,
                colorHex: value.colorHex ?? null,
                position: index,
              })),
            }
          : undefined,
      },
      select: { id: true, name: true, slug: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "attribute.created",
        entityType: "Attribute",
        entityId: attribute.id,
        summary: `Created attribute ${attribute.name} with ${input.values.length} value(s)`,
        changedFields: ["attribute"],
      },
    });
    return attribute;
  });
}

export async function addAttributeValue(
  actor: CatalogActor,
  attributeId: string,
  input: { value: string; colorHex?: string },
): Promise<void> {
  await withTransaction(async (tx) => {
    const attribute = await tx.attribute.findFirst({ where: { id: attributeId, businessId: actor.businessId } });
    if (!attribute) throw AppError.notFound("Attribute not found");
    const slug = slugify(input.value);
    const clash = await tx.attributeValue.findFirst({ where: { attributeId, slug } });
    if (clash) throw AppError.conflict("That value already exists for this attribute");
    const count = await tx.attributeValue.count({ where: { attributeId } });
    await tx.attributeValue.create({
      data: { attributeId, value: input.value, slug, colorHex: input.colorHex ?? null, position: count },
    });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "attribute.value_added",
        entityType: "Attribute",
        entityId: attributeId,
        summary: `Added value "${input.value}" to ${attribute.name}`,
        changedFields: ["values"],
      },
    });
  });
}

/**
 * Starter attribute presets for a new business (colours and common sizes).
 * Called from the UI so the operator does not start from an empty list.
 */
export async function createStarterAttributes(actor: CatalogActor): Promise<number> {
  const presets: AttributeInput[] = [
    {
      name: "Colour",
      slug: "colour",
      type: "COLOR",
      isVariantDefining: true,
      values: [
        { value: "Black", colorHex: "#111827" },
        { value: "White", colorHex: "#f9fafb" },
        { value: "Red", colorHex: "#dc2626" },
        { value: "Blue", colorHex: "#2563eb" },
        { value: "Green", colorHex: "#16a34a" },
      ],
    },
    {
      name: "Size",
      slug: "size",
      type: "SELECT",
      isVariantDefining: true,
      values: ["XS", "S", "M", "L", "XL", "XXL"].map((value) => ({ value })),
    },
    {
      name: "Material",
      slug: "material",
      type: "TEXT",
      isVariantDefining: false,
      values: [],
    },
  ];

  let created = 0;
  for (const preset of presets) {
    const slug = preset.slug!;
    const exists = await prisma.attribute.findFirst({ where: { businessId: actor.businessId, slug } });
    if (exists) continue;
    await createAttribute(actor, preset);
    created += 1;
  }
  return created;
}
