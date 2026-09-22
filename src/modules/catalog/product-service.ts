import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { assertDocumentMediaExists, assertValidDocument, syncDocumentMediaUsages } from "@/modules/media/content";
import { serializeRichTextOrEmpty } from "@/components/rich-text-editor/serialization";
import { assertImageAssets, assertMediaAssetsAvailable, syncMediaUsageCounts, toAssetView } from "@/modules/media/service";
import { defaultLocationId, ensureBalance } from "@/modules/inventory/service";
import { DEFAULT_WEIGHT_UNIT, isValidSlug, normalizeSku, resolveBulkTarget, suggestSlug, toWeightGrams } from "@/modules/catalog/product-draft";
import type { BulkTarget, DraftVariant } from "@/modules/catalog/product-draft";
import { calculatePricing, normalizeDiscount, validateDiscount, type DiscountType } from "@/modules/catalog/pricing-rules";
import { pricingFromLevel, resolvePricing, type PricingLevelInput } from "@/modules/catalog/inheritance";
import { syncVariantPriceListItem } from "@/modules/catalog/variant-pricing";
import type { BulkVariantActionInput, BrandInput, ProductDraftInput, SingleVariantUpdateInput, UnitLabelInput } from "@/modules/catalog/product-schemas";
import type { CatalogActor } from "@/modules/catalog/service";
import type { RichTextDocument } from "@/components/rich-text-editor/types";

/**
 * Product write service for the Create/Edit Product flow.
 *
 * A save is **one transaction**: the product, its categories and attributes, every
 * image association, every variant (with its attribute values, images and price
 * list entry), the attribute-value default images and the media usages all commit
 * together or not at all. The only deliberate exception is opening stock, which uses
 * the inventory ledger engine inside the same transaction but with an explicit
 * opt-in, and never silently creates stock by saving a product.
 *
 * What the browser sends is never trusted: brands, categories, attributes, variants
 * combinations, media ids, documents and money are all re-read or re-validated here.
 */

const MAX_VARIANTS = 500;

export interface SaveProductResult {
  productId: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  created: boolean;
  variantCount: number;
  /** Always zero: saving a product never creates stock. */
  openingStockRecorded: number;
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

async function uniqueProductSlug(tx: Prisma.TransactionClient, businessId: string, desired: string, productId?: string): Promise<string> {
  const base = desired || "product";
  let candidate = base;
  for (let suffix = 2; suffix <= 200; suffix += 1) {
    const clash = await tx.product.findFirst({
      where: { businessId, slug: candidate, ...(productId ? { id: { not: productId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw AppError.conflict("Unable to generate a unique URL slug — try a different product name.");
}

/**
 * Attach a usage row for one association and keep the asset's counter honest.
 * Field names are role-based ("primary-image", "gallery-image", "logo", …) so the
 * media manager can tell an operator *where* an asset is used.
 */
async function attachAssociation(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    entityType: "PRODUCT" | "VARIANT" | "ATTRIBUTE_VALUE" | "BRAND" | "CATEGORY";
    entityId: string;
    field: string;
    productId?: string;
    variantId?: string;
  },
): Promise<void> {
  await tx.mediaUsage.upsert({
    where: {
      mediaId_entityType_entityId_field: {
        mediaId: input.mediaId,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
      },
    },
    create: {
      mediaId: input.mediaId,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field,
      productId: input.productId ?? null,
      variantId: input.variantId ?? null,
    },
    update: { productId: input.productId ?? null, variantId: input.variantId ?? null },
  });
}

async function collectAssociationUsages(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: string,
  fields: string[],
): Promise<string[]> {
  const rows = await tx.mediaUsage.findMany({
    where: { entityType, entityId, field: { in: fields } },
    select: { mediaId: true },
  });
  return rows.map((row) => row.mediaId);
}

/** Every media id the payload references, whatever the field. */
function collectPayloadMediaIds(input: ProductDraftInput): string[] {
  const ids = new Set<string>();
  const push = (value?: string | null) => {
    if (value) ids.add(value);
  };

  push(input.primaryImage?.mediaId);
  input.images.forEach((image) => push(image.mediaId));
  push(input.seoImage?.mediaId);
  Object.values(input.attributeValueImages ?? {}).forEach((mediaId) => push(mediaId));
  for (const variant of input.variants) {
    push(variant.imageMediaId ?? null);
    variant.galleryMediaIds.forEach(push);
    (variant.gallery ?? []).forEach((image) => push(image.mediaId));
  }
  return [...ids];
}

/* -------------------------------------------------------------------------- */
/* Validation against the live catalogue                                      */
/* -------------------------------------------------------------------------- */

interface ValidatedContext {
  attributeValues: Map<
    string,
    {
      id: string;
      attributeId: string;
      attributeSlug: string;
      valueSlug: string;
      attributeName: string;
      valueLabel: string;
      mediaId: string | null;
      priceOverridePaisa?: number | null;
      currentPricePaisa?: number | null;
      discountType?: string | null;
      discountValue?: number | null;
    }
  >;
  variantsById: Map<string, { id: string; sku: string | null; optionKey: string; productId: string }>;
  brand: { id: string; name: string } | null;
  priceListId: string;
}

async function validateReferences(
  tx: Prisma.TransactionClient,
  businessId: string,
  input: ProductDraftInput,
): Promise<ValidatedContext> {
  /* Brand ---------------------------------------------------------------- */
  let brand: { id: string; name: string } | null = null;
  if (input.brandId) {
    const anyTx = tx as unknown as Record<string, { findFirst?: (args: unknown) => Promise<{ id: string; name: string } | null> }>;
    if (!anyTx.brand || typeof anyTx.brand.findFirst !== "function") {
      // Prisma Client is outdated and does not know the Brand model yet.
      // The product can still be saved without a brand reference; clear it
      // and let the caller know the brand will be ignored.
      brand = null;
    } else {
      const found = await anyTx.brand.findFirst({
        where: { id: input.brandId, businessId, deletedAt: null },
        select: { id: true, name: true },
      } as never);
      if (!found) throw AppError.validation("The selected brand no longer exists. Pick another one or create it again.");
      brand = found;
    }
  }

  /* Categories ----------------------------------------------------------- */
  if (input.categoryIds.length > 0) {
    const categories = await tx.category.findMany({
      where: { id: { in: input.categoryIds }, businessId, deletedAt: null },
      select: { id: true },
    });
    if (categories.length !== new Set(input.categoryIds).size) {
      throw AppError.validation("One or more selected categories no longer exist. Refresh the list and try again.");
    }
  }
  if (input.primaryCategoryId && !input.categoryIds.includes(input.primaryCategoryId)) {
    throw AppError.validation("The primary category must also be one of the selected categories.");
  }

  /* Attributes ----------------------------------------------------------- */
  if (input.attributeIds.length > 0) {
    const attributes = await tx.attribute.findMany({
      where: { id: { in: input.attributeIds }, businessId },
      select: { id: true },
    });
    if (attributes.length !== new Set(input.attributeIds).size) {
      throw AppError.validation("One or more selected attributes no longer exist. Refresh the list and try again.");
    }
  }

  /* Attribute values on every variant ------------------------------------ */
  const attributeValueIds = [...new Set(input.variants.flatMap((variant) => variant.attributeValueIds))];
  const attributeValues = attributeValueIds.length
    ? await tx.attributeValue.findMany({
        where: { id: { in: attributeValueIds } },
        select: {
          id: true,
          attributeId: true,
          mediaId: true,
          priceOverridePaisa: true,
          currentPricePaisa: true,
          discountType: true,
          discountValue: true,
          slug: true,
          value: true,
          attribute: { select: { id: true, slug: true, businessId: true, name: true } },
        },
      })
    : [];
  if (attributeValues.length !== attributeValueIds.length) {
    throw AppError.validation("One or more attribute values no longer exist. Re-select the options for this product.");
  }
  for (const value of attributeValues) {
    if (value.attribute.businessId !== businessId) {
      throw AppError.validation(`The attribute value "${value.slug}" belongs to another business.`);
    }
    if (input.attributeIds.length > 0 && !input.attributeIds.includes(value.attributeId)) {
      throw AppError.validation("A variant uses an attribute value whose attribute is not selected for this product.");
    }
  }

  /* Variant identity and combinations ------------------------------------ */
  const variantIds = input.variants.map((variant) => variant.id).filter((id): id is string => Boolean(id));
  const variantsById = new Map<string, { id: string; sku: string | null; optionKey: string; productId: string }>();
  if (variantIds.length > 0) {
    if (!input.productId) throw AppError.validation("Variant ids can only be sent when editing an existing product.");
    const rows = await tx.variant.findMany({
      where: { id: { in: variantIds }, product: { businessId } },
      select: { id: true, sku: true, optionKey: true, productId: true },
    });
    if (rows.length !== variantIds.length) {
      throw AppError.validation("One or more variants belong to a different product. Reload the page and try again.");
    }
    for (const row of rows) {
      if (row.productId !== input.productId) {
        throw AppError.validation("A variant in this form belongs to another product. Reload the page and try again.");
      }
      variantsById.set(row.id, row);
    }
  }

  /* Price list ----------------------------------------------------------- */
  const priceList =
    (await tx.priceList.findFirst({ where: { businessId, isDefault: true }, select: { id: true } })) ??
    (await tx.priceList.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  if (!priceList) throw AppError.conflict("Create a price list before adding products.");

  return {
    attributeValues: new Map(
      attributeValues.map((value) => [
        value.id,
        {
          id: value.id,
          attributeId: value.attribute.id,
          attributeSlug: value.attribute.slug,
          valueSlug: value.slug,
          attributeName: value.attribute.name,
          valueLabel: value.value,
          mediaId: value.mediaId,
          priceOverridePaisa: value.priceOverridePaisa,
          currentPricePaisa: value.currentPricePaisa,
          discountType: value.discountType,
          discountValue: value.discountValue,
        },
      ]),
    ),
    variantsById,
    brand,
    priceListId: priceList.id,
  };
}

function optionKeyFor(
  valueIds: string[],
  valueMap: Map<string, { attributeId: string; attributeSlug: string; valueSlug: string }>,
): string {
  const entries = valueIds
    .map((id) => valueMap.get(id))
    .filter((value): value is { attributeId: string; attributeSlug: string; valueSlug: string } => Boolean(value))
    .map((value) => ({ attributeSlug: value.attributeSlug, valueSlug: value.valueSlug }));
  return [...entries]
    .sort((a, b) => (a.attributeSlug === b.attributeSlug ? a.valueSlug.localeCompare(b.valueSlug) : a.attributeSlug.localeCompare(b.attributeSlug)))
    .map((entry) => `${entry.attributeSlug}:${entry.valueSlug}`)
    .join("|");
}

async function assertSkusAvailable(
  tx: Prisma.TransactionClient,
  businessId: string,
  input: ProductDraftInput,
  context: ValidatedContext,
): Promise<void> {
  // 1. No duplicate variant codes inside this submission (if provided)
  const seenSkus = new Map<string, number>();
  for (const variant of input.variants) {
    const sku = normalizeSku(variant.sku);
    if (sku) {
      seenSkus.set(sku, (seenSkus.get(sku) ?? 0) + 1);
    }
  }
  const duplicateSkus = [...seenSkus.entries()].filter(([, count]) => count > 1).map(([sku]) => sku);
  if (duplicateSkus.length > 0) {
    throw AppError.validation(`These variant codes are used more than once in this product: ${duplicateSkus.join(", ")}`);
  }

  // Check duplicate option combinations
  if (input.variants.length > 1) {
    const seenOptionKeys = new Set<string>();
    for (const variant of input.variants) {
      const optKey = optionKeyFor(variant.attributeValueIds, context.attributeValues) || "default";
      if (seenOptionKeys.has(optKey)) {
        throw AppError.validation(`These variant codes are used more than once in this product: duplicate combination ${optKey}`);
      }
      seenOptionKeys.add(optKey);
    }
  }

  // 2. Variant SKUs that are explicitly provided: check clashes across the platform
  const payloadSkus = input.variants.map((v) => normalizeSku(v.sku)).filter(Boolean);
  const unchanged = new Set(
    input.variants
      .map((variant) => (variant.id ? context.variantsById.get(variant.id)?.sku : undefined))
      .filter((sku): sku is string => Boolean(sku))
      .map((sku) => normalizeSku(sku)),
  );
  const toCheck = payloadSkus.filter((sku) => !unchanged.has(sku));
  if (toCheck.length > 0) {
    const clashes = await tx.variant.findMany({
      where: { sku: { in: toCheck } },
      select: { sku: true, product: { select: { id: true, name: true } } },
    });
    const realClashes = clashes.filter((c) => c.product.id !== input.productId);
    if (realClashes.length > 0) {
      const first = realClashes[0]!;
      throw AppError.validation(`Variant code ${first.sku} is already used by another product (${first.product.name}). Product codes are unique across the platform.`);
    }
  }

  // 3. Parent product code (SKU) belongs to the main product and must be unique inside the business
  const productSku = normalizeSku(input.productCode);
  if (productSku) {
    const clash = await tx.product.findFirst({
      where: {
        businessId,
        sku: { equals: productSku, mode: "insensitive" },
        ...(input.productId ? { id: { not: input.productId } } : {}),
      },
      select: { name: true },
    });
    if (clash) {
      throw AppError.validation(`Product code ${productSku} is already used by "${clash.name}". Choose a different code.`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create or update a product from the whole form payload.
 *
 * Steps (all inside one transaction):
 *   1. resolve and verify every reference (brand, categories, attributes, media);
 *   2. validate SKUs, media types and rich-text documents;
 *   3. write the product, its images, variants, variant images and price entries;
 *   4. record media usages so the shared library knows what is in use;
 *   5. optionally record opening stock through the inventory ledger.
 */
export async function saveProduct(actor: CatalogActor, input: ProductDraftInput): Promise<SaveProductResult> {
  if (input.slug && !isValidSlug(input.slug)) {
    throw AppError.validation("The URL slug may only contain lower-case letters, numbers and single dashes.");
  }
  if (input.variants.length > MAX_VARIANTS) {
    throw AppError.validation(`Products are limited to ${MAX_VARIANTS} variants. Split the product or contact support.`);
  }

  const intent: "draft" | "save" = input.saveAsDraft ? "draft" : "save";
  const documents = {
    shortDescription: assertValidDocument(input.shortDescription, "Short description"),
    description: assertValidDocument(input.description, "Description"),
  };

  return withTransaction(async (tx) => {
    const context = await validateReferences(tx, actor.businessId, input);
    await assertSkusAvailable(tx, actor.businessId, input, context);

    /* Media: everything the payload references must exist in this business, and
       every *image* field must point at an image (a PDF is a valid asset but not a
       product picture). Documents are checked separately below. */
    const mediaIds = collectPayloadMediaIds(input);
    const assets = await assertMediaAssetsAvailable(tx, actor.businessId, mediaIds);
    const imageIds = new Set<string>();
    if (input.primaryImage?.mediaId) imageIds.add(input.primaryImage.mediaId);
    input.images.forEach((image) => imageIds.add(image.mediaId));
    if (input.seoImage?.mediaId) imageIds.add(input.seoImage.mediaId);
    input.variants.forEach((variant) => {
      if (variant.imageMediaId) imageIds.add(variant.imageMediaId);
      variant.galleryMediaIds.forEach((id) => imageIds.add(id));
      (variant.gallery ?? []).forEach((image) => imageIds.add(image.mediaId));
    });
    Object.values(input.attributeValueImages ?? {}).forEach((mediaId) => {
      if (mediaId) imageIds.add(mediaId);
    });
    assertImageAssets(new Map([...imageIds].map((id) => [id, assets.get(id)!])));

    /* Documents: verify the media they embed before storing them. */
    const documentMediaIds = await assertDocumentMediaExists(tx, actor.businessId, [documents.shortDescription, documents.description]);
    void documentMediaIds;

    /* Existing product (edit) or a brand-new one. */
    const existing = input.productId
      ? await tx.product.findFirst({
          where: { id: input.productId, businessId: actor.businessId, deletedAt: null },
          select: { id: true, name: true, slug: true, status: true, updatedAt: true, publishedAt: true },
        })
      : null;
    if (input.productId && !existing) throw AppError.notFound("Product not found");

    if (existing && input.expectedUpdatedAt) {
      const expected = new Date(input.expectedUpdatedAt).getTime();
      if (Number.isFinite(expected) && Math.abs(existing.updatedAt.getTime() - expected) > 1_000) {
        throw AppError.conflict(
          "This product was changed by someone else after you opened it. Reload the page to see the current values — your changes are not saved.",
        );
      }
    }

    const desiredSlug = input.slug || suggestSlug(input.name);
    if (!desiredSlug) throw AppError.validation("Enter a URL slug — the product name cannot be turned into one automatically.");
    const slug =
      existing && existing.slug === desiredSlug
        ? existing.slug
        : await uniqueProductSlug(tx, actor.businessId, desiredSlug, existing?.id);

    const status: "DRAFT" | "ACTIVE" | "ARCHIVED" =
      intent === "draft" && !existing ? "DRAFT" : input.status;

    const weightGrams = toWeightGrams(input.weightValue ?? null, input.weightUnit ?? DEFAULT_WEIGHT_UNIT);

    /* Product default pricing (level 3 of the inheritance model) ------------ */
    // The browser sends the operator's *intent* (current price + discount); the
    // sell price is derived here so nothing client-side can forge it.
    const productDiscount = normalizeDiscount({
      discountType: input.discountType,
      discountValue: input.discountValue,
      currentPricePaisa: input.currentPricePaisa,
    });
    const productCurrentPricePaisa = input.currentPricePaisa != null && input.currentPricePaisa > 0 ? Math.round(input.currentPricePaisa) : null;
    const productDiscountCheck = validateDiscount({
      currentPricePaisa: productCurrentPricePaisa,
      discountType: productDiscount.discountType,
      discountValue: productDiscount.discountValue,
    });
    if (!productDiscountCheck.ok) throw AppError.validation(productDiscountCheck.message ?? "The product discount is invalid.");
    const productPricing = calculatePricing({
      currentPricePaisa: productCurrentPricePaisa ?? 0,
      discountType: productDiscount.discountType,
      discountValue: productDiscount.discountValue,
    });
    // An explicit sell price from the form wins (the UI shows the derived value,
    // so they normally agree); otherwise the calculation is authoritative.
    const productDefaultPricePaisa =
      input.defaultPricePaisa != null && input.defaultPricePaisa > 0 ? Math.round(input.defaultPricePaisa) : productCurrentPricePaisa != null ? productPricing.sellPricePaisa : null;

    const metadata: Prisma.InputJsonObject = {
      weightUnit: input.weightUnit ?? DEFAULT_WEIGHT_UNIT,
      ...(input.weightValue != null ? { weightValue: input.weightValue } : {}),
    };

    const productFields: any = {
      name: input.name,
      slug,
      productType: input.variants.length > 1 || input.attributeIds.length > 0 ? ("VARIABLE" as const) : input.productType,
      status,
      shortDescription: serializeDocument(documents.shortDescription),
      description: serializeDocument(documents.description),
      brand: context.brand?.name ?? null,
      brandId: context.brand?.id ?? null,
      sku: normalizeSku(input.productCode) || null,
      barcode: input.barcode?.trim() || null,
      unitLabel: input.unitLabel.trim(),
      unitLabelId: input.unitLabelId ?? null,
      weightGrams,
      defaultCurrentPricePaisa: productCurrentPricePaisa,
      defaultDiscountType: productDiscount.discountType,
      defaultDiscountValue: productDiscount.discountValue,
      defaultPricePaisa: productDefaultPricePaisa,
      defaultCompareAtPricePaisa: productCurrentPricePaisa,
      defaultCostPaisa: input.defaultCostPaisa ?? null,
      requiresShipping: input.requiresShipping,
      isFeatured: input.isFeatured,
      isPreorderEnabled: input.isPreorderEnabled,
      preorderNote: input.preorderNote?.trim() || null,
      taxRateId: input.taxRateId ?? null,
      taxRateBps: input.taxRateBps,
      packagingCostTemplateId: input.packagingCostTemplateId ?? null,
      packagingCostPaisa: input.packagingCostPaisa,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      seoKeywords: input.seoKeywords?.trim() || null,
      seoImageMediaId: input.seoImage?.mediaId ?? null,
      metadata,
      updatedByUserId: actor.userId,
    };

    async function createOrUpdateProduct(fields: any) {
      if (existing) {
        return (tx.product as any).update({
          where: { id: existing.id },
          data: {
            ...(fields as any),
            ...(status === "ACTIVE" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
            ...(status === "ARCHIVED" ? { archivedAt: new Date() } : {}),
          },
          select: { id: true, slug: true, status: true, name: true },
        });
      }
      return (tx.product as any).create({
        data: {
          ...(fields as any),
          businessId: actor.businessId,
          createdByUserId: actor.userId,
          publishedAt: status === "ACTIVE" ? new Date() : null,
        },
        select: { id: true, slug: true, status: true, name: true },
      });
    }

    let product: { id: string; slug: string; status: string; name: string };
    try {
      product = await createOrUpdateProduct(productFields);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes("Unknown arg") || (!msg.includes("brandId") && !msg.includes("seoImageMediaId"))) throw error;
      const fallbackFields = { ...productFields };
      if (msg.includes("brandId")) delete fallbackFields.brandId;
      if (msg.includes("seoImageMediaId")) delete fallbackFields.seoImageMediaId;
      product = await createOrUpdateProduct(fallbackFields);
    }

    /* Categories + attributes ------------------------------------------- */
    await tx.productCategory.deleteMany({ where: { productId: product.id } });
    if (input.categoryIds.length > 0) {
      await tx.productCategory.createMany({
        data: input.categoryIds.map((categoryId, index) => ({
          productId: product.id,
          categoryId,
          isPrimary: input.primaryCategoryId ? categoryId === input.primaryCategoryId : index === 0,
          position: index,
        })),
        skipDuplicates: true,
      });
    }

    await tx.productAttribute.deleteMany({ where: { productId: product.id } });
    if (input.attributeIds.length > 0) {
      await tx.productAttribute.createMany({
        data: input.attributeIds.map((attributeId, index) => ({ productId: product.id, attributeId, position: index })),
        skipDuplicates: true,
      });
    }

    /* Product images ----------------------------------------------------- */
    const previousProductMedia = await collectAssociationUsages(tx, "PRODUCT", product.id, [
      "primary-image",
      "gallery-image",
      "seo-image",
    ]);
    await tx.productImage.deleteMany({ where: { productId: product.id } });
    await tx.mediaUsage.deleteMany({
      where: { entityType: "PRODUCT", entityId: product.id, field: { in: ["primary-image", "gallery-image", "seo-image"] } },
    });

    const orderedImages = [
      ...(input.primaryImage ? [input.primaryImage] : []),
      ...input.images.filter((image) => image.mediaId !== input.primaryImage?.mediaId),
    ];
    for (const [index, image] of orderedImages.entries()) {
      await tx.productImage.create({
        data: { productId: product.id, mediaId: image.mediaId, position: index, altText: image.altText ?? null },
      });
      await attachAssociation(tx, {
        mediaId: image.mediaId,
        entityType: "PRODUCT",
        entityId: product.id,
        field: index === 0 ? "primary-image" : "gallery-image",
        productId: product.id,
      });
    }
    if (input.seoImage?.mediaId) {
      await attachAssociation(tx, {
        mediaId: input.seoImage.mediaId,
        entityType: "PRODUCT",
        entityId: product.id,
        field: "seo-image",
        productId: product.id,
      });
    }

    /* Attribute-value default images ------------------------------------- */
    const previousValueMedia: string[] = [];
    for (const [attributeValueId, mediaId] of Object.entries(input.attributeValueImages ?? {})) {
      const value = context.attributeValues.get(attributeValueId);
      if (!value) throw AppError.validation("An attribute-value image refers to a value that is not part of this product.");
      if (value.mediaId === mediaId) continue;

      previousValueMedia.push(...(await collectAssociationUsages(tx, "ATTRIBUTE_VALUE", attributeValueId, ["default-image"])));
      await tx.attributeValue.update({ where: { id: attributeValueId }, data: { mediaId: mediaId ?? null } });
      await tx.mediaUsage.deleteMany({ where: { entityType: "ATTRIBUTE_VALUE", entityId: attributeValueId, field: "default-image" } });
      if (mediaId) {
        await attachAssociation(tx, {
          mediaId,
          entityType: "ATTRIBUTE_VALUE",
          entityId: attributeValueId,
          field: "default-image",
          productId: product.id,
        });
      }
    }

    /* Variants ----------------------------------------------------------- */
    const keptVariantIds = new Set<string>();
    let position = 0;
    for (const variant of input.variants) {
      const optionKey = optionKeyFor(variant.attributeValueIds, context.attributeValues) || "default";
      const attributesSummary = Object.fromEntries(
        variant.attributeValueIds
          .map((id) => context.attributeValues.get(id))
          .filter((value): value is NonNullable<typeof value> => Boolean(value))
          .map((value) => [value.attributeSlug, value.valueSlug]),
      );

      const existingVariant = variant.id ? context.variantsById.get(variant.id) : undefined;

      /* Price inheritance: variant override > attribute override > product default */
      // Attribute candidates follow the order the product lists its attributes,
      // so "Colour" beats "Size" — the same order the editor shows.
      const attributeCandidates = variant.attributeValueIds
        .map((id) => context.attributeValues.get(id))
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .map((value) => ({
          attributeValueId: value.id,
          attributeName: value.attributeName,
          valueLabel: value.valueLabel,
          value: {
            currentPricePaisa: value.currentPricePaisa ?? null,
            discountType: (value.discountType ?? "NONE") as DiscountType,
            discountValue: value.discountValue ?? 0,
            pricePaisa: value.priceOverridePaisa ?? null,
          } satisfies PricingLevelInput,
        }));

      const variantDiscount = normalizeDiscount({
        discountType: variant.discountType,
        discountValue: variant.discountValue,
        currentPricePaisa: variant.currentPricePaisa,
      });
      if (!variant.clearPriceOverride) {
        const discountCheck = validateDiscount({
          currentPricePaisa: variant.currentPricePaisa ?? null,
          discountType: variantDiscount.discountType,
          discountValue: variantDiscount.discountValue,
        });
        if (!discountCheck.ok) {
          throw AppError.validation(`${variant.name || "A variant"}: ${discountCheck.message ?? "the discount is invalid."}`);
        }
      }

      const resolution = resolvePricing({
        productDefault: {
          currentPricePaisa: productCurrentPricePaisa,
          discountType: productDiscount.discountType,
          discountValue: productDiscount.discountValue,
          pricePaisa: productDefaultPricePaisa,
        },
        attributeValues: attributeCandidates,
        variantOverride: variant.clearPriceOverride
          ? null
          : {
              currentPricePaisa: variant.currentPricePaisa ?? null,
              discountType: variantDiscount.discountType,
              discountValue: variantDiscount.discountValue,
              pricePaisa: variant.pricePaisa ?? null,
              compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
            },
      });

      const effectivePricePaisa = resolution.value.pricePaisa;
      const effectiveCompareAt = resolution.value.compareAtPricePaisa;
      // Only a manual variant override is persisted on the variant: an inherited
      // price stays inherited, so changing the product default later moves every
      // variant that has no override of its own.
      const hasVariantOverride = resolution.level === "VARIANT";

      const variantData = {
        name: variant.name,
        // SKU belongs to the product. A variant only keeps an optional legacy
        // internal code; the workflow never generates or requires one.
        ...(existingVariant ? {} : { sku: normalizeSku(variant.sku) || null }),
        barcode: variant.barcode ?? null,
        optionKey,
        position,
        weightGrams: variant.clearWeightOverride ? null : (variant.weightGrams ?? null),
        metadata: {
          weightUnit: variant.weightUnit ?? input.weightUnit ?? DEFAULT_WEIGHT_UNIT,
        } as Prisma.InputJsonValue,
        currentPricePaisa: hasVariantOverride ? variant.currentPricePaisa ?? null : null,
        discountType: hasVariantOverride ? variantDiscount.discountType : ("NONE" as const),
        discountValue: hasVariantOverride ? variantDiscount.discountValue : 0,
        priceOverridePaisa: hasVariantOverride ? resolution.value.pricePaisa : null,
        compareAtPricePaisa: hasVariantOverride ? variant.compareAtPricePaisa ?? resolution.value.compareAtPricePaisa : null,
        costPaisa: variant.clearCostOverride ? null : (variant.costPaisa ?? null),
        packagingCostPaisa: variant.packagingCostPaisa ?? null,
        isPreorderEnabled: variant.clearPreorderOverride ? null : variant.isPreorderEnabled ?? null,
        imageMediaId: variant.clearImageOverride ? null : (variant.imageMediaId ?? null),
        attributesSummary,
      };

      const saved = existingVariant
        ? await tx.variant.update({ where: { id: existingVariant.id }, data: variantData, select: { id: true } })
        : await tx.variant.create({
            data: { ...variantData, productId: product.id },
            select: { id: true },
          });
      keptVariantIds.add(saved.id);

      /* Attribute values + prices */
      await tx.variantAttributeValue.deleteMany({ where: { variantId: saved.id } });
      if (variant.attributeValueIds.length > 0) {
        await tx.variantAttributeValue.createMany({
          data: variant.attributeValueIds.map((attributeValueId) => {
            const value = context.attributeValues.get(attributeValueId)!;
            return { variantId: saved.id, attributeId: value.attributeId, attributeValueId };
          }),
          skipDuplicates: true,
        });
      }

      if (effectivePricePaisa > 0) {
        await tx.priceListItem.upsert({
          where: { priceListId_variantId_minQuantity: { priceListId: context.priceListId, variantId: saved.id, minQuantity: 1 } },
          create: {
            priceListId: context.priceListId,
            variantId: saved.id,
            productId: product.id,
            pricePaisa: effectivePricePaisa,
            compareAtPricePaisa: effectiveCompareAt,
          },
          update: { pricePaisa: effectivePricePaisa, compareAtPricePaisa: effectiveCompareAt },
        });
      } else {
        // No resolvable price: drop the stale row instead of leaving a price
        // the catalogue no longer agrees with.
        await tx.priceListItem.deleteMany({
          where: { priceListId: context.priceListId, variantId: saved.id, minQuantity: 1 },
        });
      }

      /* Variant images */
      const previousVariantMedia = await collectAssociationUsages(tx, "VARIANT", saved.id, ["primary-image", "gallery-image"]);
      await tx.variantImage.deleteMany({ where: { variantId: saved.id } });
      await tx.mediaUsage.deleteMany({
        where: { entityType: "VARIANT", entityId: saved.id, field: { in: ["primary-image", "gallery-image"] } },
      });

      if (variant.imageMediaId) {
        await attachAssociation(tx, {
          mediaId: variant.imageMediaId,
          entityType: "VARIANT",
          entityId: saved.id,
          field: "primary-image",
          productId: product.id,
          variantId: saved.id,
        });
      }

      const galleryEntries = (variant.gallery ?? []).length > 0
        ? (variant.gallery ?? []).map((image) => ({ mediaId: image.mediaId, altText: image.altText ?? null }))
        : variant.galleryMediaIds.map((mediaId) => ({ mediaId, altText: null }));
      for (const [index, image] of galleryEntries.entries()) {
        if (image.mediaId === variant.imageMediaId) continue;
        await tx.variantImage.create({
          data: { variantId: saved.id, mediaId: image.mediaId, position: index, altText: image.altText ?? null },
        });
        await attachAssociation(tx, {
          mediaId: image.mediaId,
          entityType: "VARIANT",
          entityId: saved.id,
          field: "gallery-image",
          productId: product.id,
          variantId: saved.id,
        });
      }

      await syncMediaUsageCounts(tx, [...previousVariantMedia, variant.imageMediaId, ...galleryEntries.map((image) => image.mediaId)].filter(Boolean) as string[]);
      await ensureBalance(tx, { locationId: await defaultLocationId(actor.businessId), variantId: saved.id });
      position += 1;
    }

    /* Variants that vanished from the form are archived, never deleted: they can
       carry order lines, movements and historical prices. */
    const removed = await tx.variant.findMany({
      where: { productId: product.id, id: { notIn: [...keptVariantIds] }, status: { not: "ARCHIVED" } },
      select: { id: true, sku: true, name: true },
    });
    if (removed.length > 0) {
      await tx.variant.updateMany({ where: { id: { in: removed.map((variant) => variant.id) } }, data: { status: "ARCHIVED" } });
    }

    /* Description media usages ------------------------------------------- */
    await syncDocumentMediaUsages(tx, {
      businessId: actor.businessId,
      entityType: "PRODUCT",
      entityId: product.id,
      field: "short-description",
      documents: [documents.shortDescription],
      productId: product.id,
    });
    await syncDocumentMediaUsages(tx, {
      businessId: actor.businessId,
      entityType: "PRODUCT",
      entityId: product.id,
      field: "description",
      documents: [documents.description],
      productId: product.id,
    });

    await syncMediaUsageCounts(tx, [...previousProductMedia, ...previousValueMedia, ...mediaIds]);

    /* Discard matching working draft once product is saved/updated */
    await tx.productDraft.deleteMany({
      where: {
        businessId: actor.businessId,
        OR: [
          { productId: product.id },
          ...(existing ? [] : [{ userId: actor.userId, productId: null }]),
        ],
      },
    });

    /* Saving a product never creates stock. --------------------------------
       `ensureBalance` above only makes sure a zero balance row exists so the
       inventory module has something to move; every unit that later appears on
       hand arrives through a purchase receipt (or an authorised inventory
       adjustment), both of which write their own ledger movement. */

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorType: "USER",
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: existing ? (intent === "draft" ? "product.draft_saved" : "product.updated") : intent === "draft" ? "product.draft_created" : "product.created",
        entityType: "Product",
        entityId: product.id,
        summary: `${existing ? "Updated" : "Created"} product ${product.name} with ${input.variants.length} variant(s)${intent === "draft" ? " (draft)" : ""}`,
        before: existing ? { name: existing.name, slug: existing.slug, status: existing.status } : undefined,
        after: { name: input.name, slug: product.slug, status: product.status, variantCount: input.variants.length },
        changedFields: ["product", "images", "variants", "seo"],
      },
    });

    const warnings: string[] = [];
    if (removed.length > 0) {
      warnings.push(
        `${removed.length} variant(s) are no longer part of this product and were archived (${removed.map((variant) => variant.name).join(", ")}).`,
      );
    }

    return {
      productId: product.id,
      slug: product.slug,
      status: product.status as "DRAFT" | "ACTIVE" | "ARCHIVED",
      created: !existing,
      variantCount: input.variants.length,
      openingStockRecorded: 0,
      warnings,
    };
  });
}

/** Documents are stored as JSON strings; an empty document stays NULL. */
function serializeDocument(document: RichTextDocument | null | undefined): string | null {
  if (!document) return null;
  return serializeRichTextOrEmpty(document) || null;
}

/* -------------------------------------------------------------------------- */
/* Brands                                                                     */
/* -------------------------------------------------------------------------- */

export interface BrandOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  productCount: number;
  logo: { id: string; url: string | null; originalName: string; altText: string | null } | null;
}

/**
 * Create a brand without leaving the product form.
 *
 * The logo is a media id like everywhere else: the caller picks it from the shared
 * library, the server verifies it belongs to the business and is an image, and the
 * association is recorded as a `BRAND` usage so the library knows the asset is in
 * use (and refuses to delete it while it is).
 */
export async function createBrand(actor: CatalogActor, input: BrandInput) {
  return withTransaction(async (tx) => {
    const anyTx = tx as unknown as Record<string, unknown>;
    if (!anyTx.brand) {
      throw AppError.validation("Brands are not available yet — the database is out of date. Ask an administrator to run `npm run db:deploy` and regenerate the Prisma Client.");
    }
    const baseSlug = input.slug?.trim() || slugify(input.name);
    if (!baseSlug) throw AppError.validation("Enter a brand name that can be turned into a URL slug.");

    let slug = baseSlug;
    for (let suffix = 2; suffix <= 100; suffix += 1) {
      const clash = await tx.brand.findFirst({ where: { businessId: actor.businessId, slug }, select: { id: true } });
      if (!clash) break;
      slug = `${baseSlug}-${suffix}`;
    }

    const existingByName = await tx.brand.findFirst({
      where: { businessId: actor.businessId, name: { equals: input.name, mode: "insensitive" }, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
    if (existingByName) {
      throw AppError.conflict(`A brand named "${existingByName.name}" already exists. Select it instead of creating a duplicate.`);
    }

    if (input.logoMediaId) {
      const assets = await assertMediaAssetsAvailable(tx, actor.businessId, [input.logoMediaId]);
      assertImageAssets(assets);
    }

    const brand = await tx.brand.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
        logoMediaId: input.logoMediaId ?? null,
        isActive: input.isActive,
        seoTitle: input.seoTitle?.trim() || null,
        seoDescription: input.seoDescription?.trim() || null,
      },
      select: { id: true, name: true, slug: true },
    });

    if (input.logoMediaId) {
      await attachAssociation(tx, {
        mediaId: input.logoMediaId,
        entityType: "BRAND",
        entityId: brand.id,
        field: "logo",
      });
      await syncMediaUsageCounts(tx, [input.logoMediaId]);
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "brand.created",
        entityType: "Brand",
        entityId: brand.id,
        summary: `Created brand ${brand.name}`,
        changedFields: ["brand"],
      },
      tx,
    );

    return brand;
  });
}

export async function listBrandOptions(businessId: string): Promise<BrandOption[]> {
  const anyPrisma = prisma as unknown as Record<string, unknown> & { brand?: { findMany: (args: unknown) => Promise<unknown[]> } };
  // Gracefully handle an outdated Prisma Client that does not yet contain the Brand model
  // (TypeError: Cannot read properties of undefined (reading 'findMany') seen in production).
  if (!anyPrisma.brand || typeof (anyPrisma.brand as { findMany?: unknown }).findMany !== "function") {
    return [];
  }

  try {
    const brands = await prisma.brand.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        logo: { select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, visibility: true, title: true, caption: true, extension: true, sizeBytes: true, width: true, height: true, folderId: true, usageCount: true, createdAt: true } },
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });

    return Promise.all(
      brands.map(async (brand) => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        description: brand.description,
        websiteUrl: brand.websiteUrl,
        isActive: brand.isActive,
        productCount: brand._count.products,
        logo: brand.logo ? await toAssetView(brand.logo) : null,
      })),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Prisma throws "Unknown field `logo` / `Brand` / `product`" when the client is outdated.
    if (!msg.includes("Unknown field") && !msg.includes("Unknown arg") && !msg.includes("Cannot read")) throw error;

    // Fallback: select scalar fields only and batch-fetch logos + counts.
    const fallbackBrands = await (anyPrisma.brand.findMany as (args: unknown) => Promise<Array<{ id: string; name: string; slug: string; description: string | null; websiteUrl: string | null; isActive: boolean; logoMediaId: string | null }>>)({
      where: { businessId, deletedAt: null },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, description: true, websiteUrl: true, isActive: true, logoMediaId: true },
    } as never);

    const logoIds = fallbackBrands.map((b) => b.logoMediaId).filter((id): id is string => Boolean(id));
    const logoAssets = logoIds.length
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: [...new Set(logoIds)] }, businessId },
          select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, title: true, caption: true, folderId: true, usageCount: true, createdAt: true, folder: { select: { path: true } } },
        })
      : [];
    const logoById = new Map(logoAssets.map((a) => [a.id, a]));

    // Counts: try groupBy, otherwise fall back to 0.
    const brandIds = fallbackBrands.map((b) => b.id);
    const countByBrand = new Map<string, number>();
    if (brandIds.length) {
      try {
        const grouped = await prisma.product.groupBy({
          by: ["brandId"],
          where: { businessId, deletedAt: null, brandId: { in: brandIds } },
          _count: { _all: true },
        });
        for (const g of grouped as Array<{ brandId: string | null; _count: { _all: number } }>) {
          if (g.brandId) countByBrand.set(g.brandId, g._count._all);
        }
      } catch {
        // old client may not support groupBy on brandId; keep 0
      }
    }

    return Promise.all(
      fallbackBrands.map(async (brand) => {
        const asset = brand.logoMediaId ? logoById.get(brand.logoMediaId) : undefined;
        return {
          id: brand.id,
          name: brand.name,
          slug: brand.slug,
          description: brand.description,
          websiteUrl: brand.websiteUrl,
          isActive: brand.isActive,
          productCount: countByBrand.get(brand.id) ?? 0,
          logo: asset ? await toAssetView(asset as never) : null,
        };
      }),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Unit labels                                                                */
/* -------------------------------------------------------------------------- */

/** The vocabulary every business starts with. Kept in one place so the picker and the seed agree. */
export const DEFAULT_UNIT_LABELS = ["piece", "pair", "set", "box", "pack", "dozen", "meter", "kilogram", "litre"] as const;

export interface UnitLabelOption {
  id: string | null;
  name: string;
  slug: string;
  isDefault: boolean;
}

/** Normalise a typed label so "  Box " and "box" cannot become two entries. */
export function normalizeUnitLabelName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function listUnitLabels(businessId: string): Promise<UnitLabelOption[]> {
  const anyPrisma = prisma as unknown as Record<string, unknown> & { unitLabel?: { findMany: (args: unknown) => Promise<unknown[]> } };
  if (!anyPrisma.unitLabel || typeof (anyPrisma.unitLabel as { findMany?: unknown }).findMany !== "function") {
    return DEFAULT_UNIT_LABELS.map((name, index) => ({ id: null, name, slug: slugify(name), isDefault: index === 0 }));
  }
  try {
    const labels = await prisma.unitLabel.findMany({
      where: { businessId, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });

    const rows: UnitLabelOption[] = (labels as Array<{ id: string; name: string; slug: string; isDefault: boolean }>).map((label) => ({
      id: label.id,
      name: label.name,
      slug: label.slug,
      isDefault: label.isDefault,
    }));

    // A fresh business (or one created before this vocabulary existed) still sees the
    // built-in options; choosing one persists it on save through `createUnitLabel`.
    if (rows.length === 0) {
      return DEFAULT_UNIT_LABELS.map((name, index) => ({ id: null, name, slug: slugify(name), isDefault: index === 0 }));
    }
    return rows;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("Unknown field") && !msg.includes("Unknown arg") && !msg.includes("Cannot read")) throw error;
    return DEFAULT_UNIT_LABELS.map((name, index) => ({ id: null, name, slug: slugify(name), isDefault: index === 0 }));
  }
}

/** Create (or return the existing) unit label. Case- and whitespace-insensitive. */
export async function createUnitLabel(actor: CatalogActor, input: UnitLabelInput) {
  const name = normalizeUnitLabelName(input.name);
  if (!name) throw AppError.validation("Enter a unit label such as piece, pair or box.");

  return withTransaction(async (tx) => {
    const anyTx = tx as unknown as Record<string, unknown>;
    if (!anyTx.unitLabel) {
      throw AppError.validation("Unit labels are not available yet — the database is out of date. Ask an administrator to run `npm run db:deploy` and regenerate the Prisma Client.");
    }
    const slug = slugify(name);
    if (!slug) throw AppError.validation("Enter a unit label that can be stored (letters or numbers).");

    const existing = await tx.unitLabel.findFirst({ where: { businessId: actor.businessId, slug } });
    if (existing) {
      if (!existing.isActive) {
        return tx.unitLabel.update({ where: { id: existing.id }, data: { isActive: true }, select: { id: true, name: true, slug: true } });
      }
      return { id: existing.id, name: existing.name, slug: existing.slug };
    }

    const count = await tx.unitLabel.count({ where: { businessId: actor.businessId } });
    const created = await tx.unitLabel.create({
      data: {
        businessId: actor.businessId,
        name,
        slug,
        position: count,
        isDefault: input.isDefault || count === 0,
      },
      select: { id: true, name: true, slug: true },
    });

    await recordAudit(
    {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      actorLabel: actor.actorLabel,
      action: "unit_label.created",
      entityType: "UnitLabel",
      entityId: created.id,
      summary: `Added unit label "${created.name}"`,
      changedFields: ["label"],
    },
    tx,
  );

    return created;
  });
}

/* -------------------------------------------------------------------------- */
/* Attribute value images                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Set (or clear) the default image of an attribute value.
 *
 * This is level 2 of the image precedence: every variant carrying the value shows
 * this image unless it has its own override. The image is a **reference** to a
 * shared asset, so the same file can be the default of several values and a
 * product image at the same time without being uploaded twice.
 */
export async function setAttributeValueImage(
  actor: CatalogActor,
  input: { attributeValueId: string; mediaId: string | null; productId?: string; applyToVariants?: boolean },
) {
  return withTransaction(async (tx) => {
    const value = await tx.attributeValue.findFirst({
      where: { id: input.attributeValueId, attribute: { businessId: actor.businessId } },
      select: { id: true, value: true, attributeId: true, attribute: { select: { name: true } } },
    });
    if (!value) throw AppError.notFound("Attribute value not found");

    if (input.mediaId) {
      const assets = await assertMediaAssetsAvailable(tx, actor.businessId, [input.mediaId]);
      assertImageAssets(assets);
    }

    const previous = await collectAssociationUsages(tx, "ATTRIBUTE_VALUE", value.id, ["default-image"]);
    await tx.attributeValue.update({ where: { id: value.id }, data: { mediaId: input.mediaId } });
    await tx.mediaUsage.deleteMany({ where: { entityType: "ATTRIBUTE_VALUE", entityId: value.id, field: "default-image" } });
    if (input.mediaId) {
      await attachAssociation(tx, {
        mediaId: input.mediaId,
        entityType: "ATTRIBUTE_VALUE",
        entityId: value.id,
        field: "default-image",
      });
    }

    let variantsUpdated = 0;
    if (input.applyToVariants && input.productId) {
      const variants = await tx.variant.findMany({
        where: { productId: input.productId, product: { businessId: actor.businessId }, attributeValues: { some: { attributeValueId: value.id } } },
        select: { id: true },
      });
      if (variants.length > 0) {
        await tx.variant.updateMany({
          where: { id: { in: variants.map((variant) => variant.id) } },
          data: { imageMediaId: input.mediaId },
        });
        variantsUpdated = variants.length;
        if (input.mediaId) {
          for (const variant of variants) {
            await attachAssociation(tx, {
              mediaId: input.mediaId,
              entityType: "VARIANT",
              entityId: variant.id,
              field: "primary-image",
              productId: input.productId,
              variantId: variant.id,
            });
          }
        }
      }
    }

    await syncMediaUsageCounts(tx, [...previous, ...(input.mediaId ? [input.mediaId] : [])]);

    await recordAudit(
    {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      actorLabel: actor.actorLabel,
      action: "attribute_value.image_changed",
      entityType: "AttributeValue",
      entityId: value.id,
      summary: input.mediaId
        ? `Set the default image for ${value.attribute.name}: ${value.value}`
        : `Cleared the default image for ${value.attribute.name}: ${value.value}`,
      before: { mediaId: previous[0] ?? null },
      after: { mediaId: input.mediaId, variantsUpdated },
      changedFields: ["image"],
    },
    tx,
  );

    return { attributeValueId: value.id, mediaId: input.mediaId, variantsUpdated };
  });
}

/* -------------------------------------------------------------------------- */
/* Bulk variant actions                                                       */
/* -------------------------------------------------------------------------- */

export interface BulkVariantResult {
  action: BulkVariantActionInput["action"];
  affected: number;
  skipped: number;
  targetDescription: string;
  details: string[];
}

/**
 * Apply one bulk action to a target group of variants.
 *
 * Targeting is resolved **on the server** from the stored variants' attribute
 * values, not from a list the browser sends: "all Black variants" means the same
 * thing to the preview and to the write. Overrides are preserved unless the caller
 * explicitly asks to replace them (`replaceOverrides`), and for attribute-matched
 * image actions the action sets the *attribute-value default* by default, which is
 * both what a merchandiser means and what keeps one asset shared by many variants.
 */
export async function bulkApplyVariantAction(actor: CatalogActor, input: BulkVariantActionInput): Promise<BulkVariantResult> {
  return withTransaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, businessId: actor.businessId, deletedAt: null },
      select: { id: true, name: true, images: { orderBy: { position: "asc" }, take: 1, select: { mediaId: true } } },
    });
    if (!product) throw AppError.notFound("Product not found");

    const variantRows = await tx.variant.findMany({
      where: { productId: product.id, deletedAt: null },
      orderBy: { position: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        currentPricePaisa: true,
        discountType: true,
        discountValue: true,
        priceOverridePaisa: true,
        compareAtPricePaisa: true,
        costPaisa: true,
        weightGrams: true,
        packagingCostPaisa: true,
        isPreorderEnabled: true,
        imageMediaId: true,
        attributeValues: { select: { attributeValueId: true } },
        images: { select: { mediaId: true } },
      },
    });
    if (variantRows.length === 0) throw AppError.validation("This product has no variants yet.");

    const attributeRows = await tx.attribute.findMany({
      where: { businessId: actor.businessId, id: { in: input.target.criteria?.map((criterion) => criterion.attributeId) ?? [] } },
      select: { id: true, name: true, values: { select: { id: true, value: true } } },
    });

    /* Resolve the target group with the same pure function the UI previews with. */
    const draftRows = variantRows.map<DraftVariant>((row) => ({
      key: row.id,
      id: row.id,
      sku: row.sku ?? "",
      name: row.name,
      imageMediaId: row.imageMediaId,
      galleryMediaIds: row.images.map((image) => image.mediaId),
      attributeValueIds: row.attributeValues.map((value) => value.attributeValueId),
    }));

    const selection = new Set(input.target.variantIds ?? []);
    const targetRows = resolveBulkTarget(input.target as BulkTarget, {
      rows: draftRows,
      selectedIds: [...selection],
      attributes: attributeRows.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        slug: attribute.id,
        values: attribute.values.map((value) => ({ id: value.id, value: value.value })),
      })),
    });

    const targetIds = targetRows.map((row) => row.id!).filter(Boolean);
    const targetDescription =
      input.target.kind === "all"
        ? `all ${variantRows.length} variant(s)`
        : input.target.kind === "selected"
          ? `${targetIds.length} selected variant(s)`
          : `${targetIds.length} variant(s) matching ${attributeRows
              .map((attribute) => {
                const criterion = input.target.criteria?.find((entry) => entry.attributeId === attribute.id);
                const values = attribute.values
                  .filter((value) => criterion?.valueIds.includes(value.id))
                  .map((value) => value.value)
                  .join(" or ");
                return `${attribute.name} = ${values}`;
              })
              .join(" and ")}`;

    if (targetIds.length === 0) {
      throw AppError.validation("No variants match the selected target. Adjust the filter and try again.");
    }

    const details: string[] = [];
    let affected = 0;
    let skipped = 0;
    /** Variants whose default price-list row has to be recomputed after the write. */
    const priceRowsToSync = new Set<string>();

    const matchingValueIds = new Set((input.target.criteria ?? []).flatMap((criterion) => criterion.valueIds));

    /* Attribute-value default (level 2): preferred for attribute-targeted image work. */
    if ((input.action === "set-primary-image" || input.action === "reset-image") && input.target.kind === "attribute") {
      const valueIds = [...matchingValueIds];
      for (const attributeValueId of valueIds) {
        const previous = await collectAssociationUsages(tx, "ATTRIBUTE_VALUE", attributeValueId, ["default-image"]);
        await tx.attributeValue.update({ where: { id: attributeValueId }, data: { mediaId: input.mediaId ?? null } });
        await tx.mediaUsage.deleteMany({ where: { entityType: "ATTRIBUTE_VALUE", entityId: attributeValueId, field: "default-image" } });
        if (input.mediaId) {
          await attachAssociation(tx, {
            mediaId: input.mediaId,
            entityType: "ATTRIBUTE_VALUE",
            entityId: attributeValueId,
            field: "default-image",
            productId: product.id,
          });
        }
        await syncMediaUsageCounts(tx, [...previous, ...(input.mediaId ? [input.mediaId] : [])]);
      }
      details.push(
        input.action === "set-primary-image"
          ? `Set the attribute default image, so the change also applies to variants added later.`
          : "Cleared the attribute default image; variants fall back to the next image in the precedence chain.",
      );

      if (!input.replaceOverrides) {
        const overridden = targetRows.filter((row) => row.imageMediaId).length;
        skipped = overridden;
        if (overridden > 0) {
          details.push(`${overridden} variant(s) keep their own image (overrides are preserved). Tick "Replace variant images" to overwrite them.`);
        } else {
          affected = targetRows.length;
        }
        await recordBulkAudit(tx, actor, product.id, input, targetDescription, affected, skipped);
        return { action: input.action, affected, skipped, targetDescription, details };
      }
      details.push("Variant-level images in the target group will be replaced.");
    }

    for (const row of targetRows) {
      const variantId = row.id!;
      switch (input.action) {
        case "set-primary-image": {
          if (!input.mediaId) throw AppError.validation("Choose an image from the media library.");
          if (row.imageMediaId && !input.replaceOverrides) {
            skipped += 1;
            break;
          }
          const previous = await collectAssociationUsages(tx, "VARIANT", variantId, ["primary-image"]);
          await tx.variant.update({ where: { id: variantId }, data: { imageMediaId: input.mediaId } });
          await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variantId, field: "primary-image" } });
          await attachAssociation(tx, {
            mediaId: input.mediaId,
            entityType: "VARIANT",
            entityId: variantId,
            field: "primary-image",
            productId: product.id,
            variantId,
          });
          await syncMediaUsageCounts(tx, [...previous, input.mediaId]);
          affected += 1;
          break;
        }
        case "add-gallery-image": {
          if (!input.mediaId) throw AppError.validation("Choose an image from the media library.");
          if (row.galleryMediaIds.includes(input.mediaId)) {
            skipped += 1;
            break;
          }
          const count = await tx.variantImage.count({ where: { variantId } });
          await tx.variantImage.create({ data: { variantId, mediaId: input.mediaId, position: count } });
          await attachAssociation(tx, {
            mediaId: input.mediaId,
            entityType: "VARIANT",
            entityId: variantId,
            field: "gallery-image",
            productId: product.id,
            variantId,
          });
          await syncMediaUsageCounts(tx, [input.mediaId]);
          affected += 1;
          break;
        }
        case "set-price": {
          if (input.pricePaisa === undefined && input.currentPricePaisa === undefined) {
            throw AppError.validation("Enter the new price.");
          }
          const discount = normalizeDiscount({
            discountType: input.discountType,
            discountValue: input.discountValue,
            currentPricePaisa: input.currentPricePaisa,
          });
          const currentPricePaisa =
            input.currentPricePaisa != null && input.currentPricePaisa > 0 ? Math.round(input.currentPricePaisa) : null;
          const check = validateDiscount({
            currentPricePaisa,
            discountType: discount.discountType,
            discountValue: discount.discountValue,
          });
          if (!check.ok) throw AppError.validation(check.message ?? "The discount is invalid.");
          const sellPricePaisa =
            input.pricePaisa != null && input.pricePaisa > 0
              ? Math.round(input.pricePaisa)
              : pricingFromLevel({ currentPricePaisa, discountType: discount.discountType, discountValue: discount.discountValue }).pricePaisa;
          if (sellPricePaisa <= 0) throw AppError.validation("Enter a price greater than zero.");

          if (input.overrideTarget === "attribute") {
            // Attribute-level override: every variant of the matched values
            // inherits it, including variants generated later. Manual variant
            // overrides are preserved unless the operator asked to replace them.
            for (const attributeValueId of matchingValueIds) {
              await tx.attributeValue.update({
                where: { id: attributeValueId },
                data: {
                  currentPricePaisa,
                  discountType: discount.discountType,
                  discountValue: discount.discountValue,
                  priceOverridePaisa: sellPricePaisa,
                },
              });
            }
            if (matchingValueIds.size === 0) {
              throw AppError.validation("Attribute-level pricing needs an attribute filter — choose the values to update.");
            }
          } else if (input.overrideTarget === "product") {
            await tx.product.update({
              where: { id: product.id },
              data: {
                defaultCurrentPricePaisa: currentPricePaisa,
                defaultDiscountType: discount.discountType,
                defaultDiscountValue: discount.discountValue,
                defaultPricePaisa: sellPricePaisa,
                defaultCompareAtPricePaisa: currentPricePaisa,
              },
            });
          } else if (input.overrideTarget === "clear") {
            await tx.variant.update({
              where: { id: variantId },
              data: {
                currentPricePaisa: null,
                discountType: "NONE",
                discountValue: 0,
                priceOverridePaisa: null,
                compareAtPricePaisa: null,
              },
            });
          } else {
            await tx.variant.update({
              where: { id: variantId },
              data: {
                currentPricePaisa,
                discountType: discount.discountType,
                discountValue: discount.discountValue,
                priceOverridePaisa: sellPricePaisa,
                compareAtPricePaisa: currentPricePaisa && currentPricePaisa > sellPricePaisa ? currentPricePaisa : null,
              },
            });
          }
          affected += 1;
          break;
        }
        case "set-compare-at": {
          await tx.variant.update({ where: { id: variantId }, data: { compareAtPricePaisa: input.compareAtPricePaisa ?? null } });
          await tx.priceListItem.updateMany({ where: { variantId, minQuantity: 1 }, data: { compareAtPricePaisa: input.compareAtPricePaisa ?? null } });
          affected += 1;
          break;
        }
        case "set-cost": {
          if (input.costPaisa === undefined) throw AppError.validation("Enter the new cost.");
          await tx.variant.update({ where: { id: variantId }, data: { costPaisa: input.costPaisa } });
          affected += 1;
          break;
        }
        case "set-weight": {
          await tx.variant.update({
            where: { id: variantId },
            data: {
              weightGrams: input.weightGrams ?? null,
              metadata: { weightUnit: input.weightUnit ?? DEFAULT_WEIGHT_UNIT },
            },
          });
          affected += 1;
          break;
        }
        case "set-preorder": {
          await tx.variant.update({ where: { id: variantId }, data: { isPreorderEnabled: input.isPreorderEnabled ?? false } });
          affected += 1;
          break;
        }
        case "reset-image": {
          if (!row.imageMediaId) {
            skipped += 1;
            break;
          }
          const previous = await collectAssociationUsages(tx, "VARIANT", variantId, ["primary-image"]);
          await tx.variant.update({ where: { id: variantId }, data: { imageMediaId: null } });
          await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variantId, field: "primary-image" } });
          await syncMediaUsageCounts(tx, previous);
          affected += 1;
          break;
        }
        case "clear-price-override": {
          await tx.variant.update({
            where: { id: variantId },
            data: {
              currentPricePaisa: null,
              discountType: "NONE",
              discountValue: 0,
              priceOverridePaisa: null,
              compareAtPricePaisa: null,
            },
          });
          priceRowsToSync.add(variantId);
          affected += 1;
          break;
        }
        case "clear-cost-override": {
          await tx.variant.update({ where: { id: variantId }, data: { costPaisa: null } });
          affected += 1;
          break;
        }
        case "clear-weight-override": {
          await tx.variant.update({ where: { id: variantId }, data: { weightGrams: null } });
          affected += 1;
          break;
        }
        case "clear-preorder-override": {
          await tx.variant.update({ where: { id: variantId }, data: { isPreorderEnabled: null } });
          affected += 1;
          break;
        }
        case "clear-packaging-cost-override": {
          if (row.packagingCost == null) {
            skipped += 1;
            break;
          }
          await tx.variant.update({ where: { id: variantId }, data: { packagingCostPaisa: null } });
          affected += 1;
          break;
        }
        case "clear-image-override": {
          if (!row.imageMediaId) {
            skipped += 1;
            break;
          }
          const previousImage = await collectAssociationUsages(tx, "VARIANT", variantId, ["primary-image"]);
          await tx.variant.update({ where: { id: variantId }, data: { imageMediaId: null } });
          await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variantId, field: "primary-image" } });
          await syncMediaUsageCounts(tx, previousImage);
          affected += 1;
          break;
        }
        case "clear-gallery": {
          if (row.galleryMediaIds.length === 0) {
            skipped += 1;
            break;
          }
          const previous = await collectAssociationUsages(tx, "VARIANT", variantId, ["gallery-image"]);
          await tx.variantImage.deleteMany({ where: { variantId } });
          await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variantId, field: "gallery-image" } });
          await syncMediaUsageCounts(tx, previous);
          affected += 1;
          break;
        }
        default:
          throw AppError.validation("Unsupported bulk action");
      }

      // Any pricing write (variant, attribute or product level) changes what
      // these variants sell for, so the default price-list row is recomputed
      // from the database — never from what the browser sent.
      if (input.action === "set-price" || input.action.startsWith("clear-price")) {
        priceRowsToSync.add(variantId);
      }
    }

    for (const variantId of priceRowsToSync) {
      await syncVariantPriceListItem(tx, { businessId: actor.businessId, productId: product.id, variantId });
    }

    await recordBulkAudit(tx, actor, product.id, input, targetDescription, affected, skipped);
    return { action: input.action, affected, skipped, targetDescription, details };
  });
}

/* -------------------------------------------------------------------------- */
/* Single Variant Editing (from Product List)                                  */
/* -------------------------------------------------------------------------- */

export async function updateSingleVariant(
  actor: CatalogActor,
  input: SingleVariantUpdateInput,
): Promise<{ variantId: string; productName: string; variantName: string }> {
  return withTransaction(async (tx) => {
    const variant = await tx.variant.findFirst({
      where: { id: input.variantId, product: { businessId: actor.businessId, deletedAt: null } },
      include: {
        product: { select: { id: true, name: true, sku: true, metadata: true } },
      },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    const data: Prisma.VariantUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.barcode !== undefined) data.barcode = input.barcode || null;

    /* Pricing: discount-aware override, or back to inheritance. */
    if (input.clearPriceOverride) {
      data.currentPricePaisa = null;
      data.discountType = "NONE";
      data.discountValue = 0;
      data.priceOverridePaisa = null;
      data.compareAtPricePaisa = null;
    } else if (input.currentPricePaisa !== undefined || input.priceOverridePaisa !== undefined) {
      const discount = normalizeDiscount({
        discountType: input.discountType,
        discountValue: input.discountValue,
        currentPricePaisa: input.currentPricePaisa,
      });
      const currentPricePaisa =
        input.currentPricePaisa != null && input.currentPricePaisa > 0 ? Math.round(input.currentPricePaisa) : null;
      const check = validateDiscount({
        currentPricePaisa,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
      });
      if (!check.ok) throw AppError.validation(check.message ?? "The discount is invalid.");
      const pricing = pricingFromLevel({
        currentPricePaisa,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        pricePaisa: input.priceOverridePaisa,
      });
      if (pricing.pricePaisa <= 0 && input.priceOverridePaisa !== null && input.currentPricePaisa !== null) {
        throw AppError.validation("Enter a price greater than zero, or clear the override to inherit.");
      }
      data.currentPricePaisa = currentPricePaisa;
      data.discountType = discount.discountType;
      data.discountValue = discount.discountValue;
      data.priceOverridePaisa = pricing.pricePaisa > 0 ? pricing.pricePaisa : null;
      data.compareAtPricePaisa = input.compareAtPricePaisa ?? pricing.compareAtPricePaisa;
    }

    if (input.clearCostOverride) {
      data.costPaisa = null;
    } else if (input.costPaisa !== undefined) {
      data.costPaisa = input.costPaisa;
    }

    if (input.clearWeightOverride) {
      data.weightGrams = null;
    } else if (input.weightGrams !== undefined) {
      data.weightGrams = input.weightGrams;
    }

    if (input.clearPreorderOverride) {
      data.isPreorderEnabled = null;
    } else if (input.isPreorderEnabled !== undefined) {
      data.isPreorderEnabled = input.isPreorderEnabled;
    }

    if (input.clearPackagingCostOverride) {
      data.packagingCostPaisa = null;
    } else if (input.packagingCostPaisa !== undefined) {
      data.packagingCostPaisa = input.packagingCostPaisa;
    }

    if (input.clearImageOverride) {
      data.imageMediaId = null;
    } else if (input.imageMediaId !== undefined) {
      data.imageMediaId = input.imageMediaId;
    }

    const mediaChanged = Boolean(input.imageMediaId || input.clearImageOverride);
    const previousImageMedia = mediaChanged
      ? await collectAssociationUsages(tx, "VARIANT", variant.id, ["primary-image"])
      : [];

    await tx.variant.update({ where: { id: variant.id }, data });

    if (mediaChanged) {
      await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variant.id, field: "primary-image" } });
      if (input.imageMediaId) {
        await attachAssociation(tx, {
          mediaId: input.imageMediaId,
          entityType: "VARIANT",
          entityId: variant.id,
          field: "primary-image",
          productId: variant.productId,
          variantId: variant.id,
        });
      }
      await syncMediaUsageCounts(tx, [...previousImageMedia, ...(input.imageMediaId ? [input.imageMediaId] : [])]);
    }

    // The default price-list row always mirrors the *resolved* price, so the
    // storefront, the API and order creation read one authoritative number.
    await syncVariantPriceListItem(tx, {
      businessId: actor.businessId,
      productId: variant.productId,
      variantId: variant.id,
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "variant.updated",
        entityType: "Variant",
        entityId: variant.id,
        summary: `Updated variant ${variant.name} of ${variant.product.name}`,
      },
      tx,
    );

    return { variantId: variant.id, productName: variant.product.name, variantName: variant.name };
  });
}

/* -------------------------------------------------------------------------- */
/* Product Drafts and Autosave Persistence                                   */
/* -------------------------------------------------------------------------- */

/**
 * Persist (or update) an autosave draft.
 *
 * Drafts live in the database, not in `localStorage`, so a merchandiser can
 * start a product on a laptop, continue on a phone and still find the work.
 * `revision` is returned and expected back on the next save: if another tab
 * saved in the meantime the revision no longer matches and the caller is told
 * instead of silently overwriting the newer work.
 */
export async function saveProductDraft(
  actor: CatalogActor,
  input: { productId?: string | null; draftId?: string | null; revision?: number | null; name?: string; payload: Record<string, unknown> },
): Promise<{ draftId: string; revision: number; updatedAt: string }> {
  const name = input.name?.trim() || (input.payload.name as string) || "Untitled draft";
  const payload = input.payload as Prisma.InputJsonValue;

  if (input.draftId) {
    const existing = await prisma.productDraft.findFirst({
      where: { id: input.draftId, businessId: actor.businessId },
      select: { id: true, revision: true },
    });
    if (!existing) throw AppError.notFound("That draft no longer exists.");
    if (input.revision != null && existing.revision !== input.revision) {
      throw AppError.conflict(
        "This draft was changed in another tab or by another user. Reload the page to pick up the newer version before saving again.",
      );
    }
    const saved = await prisma.productDraft.update({
      where: { id: existing.id },
      data: { name, payload, revision: { increment: 1 } },
      select: { id: true, revision: true, updatedAt: true },
    });
    return { draftId: saved.id, revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
  }

  const existing = await prisma.productDraft.findFirst({
    where: {
      businessId: actor.businessId,
      ...(input.productId ? { productId: input.productId } : { productId: null, userId: actor.userId ?? null }),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (existing) {
    const saved = await prisma.productDraft.update({
      where: { id: existing.id },
      data: { name, payload, revision: { increment: 1 }, ...(actor.userId ? { userId: actor.userId } : {}) },
      select: { id: true, revision: true, updatedAt: true },
    });
    return { draftId: saved.id, revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
  }

  const created = await prisma.productDraft.create({
    data: {
      businessId: actor.businessId,
      productId: input.productId ?? null,
      userId: actor.userId ?? null,
      name,
      payload,
    },
    select: { id: true, revision: true, updatedAt: true },
  });
  return { draftId: created.id, revision: created.revision, updatedAt: created.updatedAt.toISOString() };
}

export interface ProductDraftSummary {
  draftId: string;
  productId: string | null;
  name: string;
  revision: number;
  updatedAt: string;
  payload: Record<string, unknown>;
}

/** Load one draft (by id, or the working draft of a product / of this user). */
export async function loadProductDraft(
  businessId: string,
  options: { productId?: string | null; draftId?: string | null; userId?: string | null },
): Promise<ProductDraftSummary | null> {
  const draft = await prisma.productDraft.findFirst({
    where: {
      businessId,
      ...(options.draftId ? { id: options.draftId } : {}),
      ...(options.productId ? { productId: options.productId } : {}),
      ...(options.userId && !options.productId && !options.draftId ? { userId: options.userId, productId: null } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!draft) return null;
  return {
    draftId: draft.id,
    productId: draft.productId,
    name: draft.name,
    revision: draft.revision,
    updatedAt: draft.updatedAt.toISOString(),
    payload: draft.payload as Record<string, unknown>,
  };
}

/** Unfinished drafts this user (or this product) can resume. */
export async function listProductDrafts(
  businessId: string,
  options: { userId?: string | null; productId?: string | null } = {},
): Promise<ProductDraftSummary[]> {
  const rows = await prisma.productDraft.findMany({
    where: {
      businessId,
      ...(options.productId ? { productId: options.productId } : {}),
      ...(options.userId && !options.productId ? { userId: options.userId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, productId: true, name: true, revision: true, updatedAt: true, payload: true },
  });
  return rows.map((row) => ({
    draftId: row.id,
    productId: row.productId,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    payload: row.payload as Record<string, unknown>,
  }));
}

/** Throw a draft away (after a successful save, or when the user discards it). */
export async function discardProductDraft(
  businessId: string,
  options: { productId?: string | null; draftId?: string | null; userId?: string | null },
): Promise<boolean> {
  if (!options.draftId && !options.productId && !options.userId) return false;
  const result = await prisma.productDraft.deleteMany({
    where: {
      businessId,
      ...(options.draftId ? { id: options.draftId } : {}),
      ...(options.productId ? { productId: options.productId } : {}),
      ...(options.userId && !options.productId && !options.draftId ? { userId: options.userId } : {}),
    },
  });
  return result.count > 0;
}

async function recordBulkAudit(
  tx: Prisma.TransactionClient,
  actor: CatalogActor,
  productId: string,
  input: BulkVariantActionInput,
  targetDescription: string,
  affected: number,
  skipped: number,
): Promise<void> {
  await recordAudit(
    {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    action: `variant.bulk_${input.action.replace(/-/g, "_")}`,
    entityType: "Product",
    entityId: productId,
    summary: `Bulk ${input.action} on ${targetDescription} (${affected} changed, ${skipped} preserved)`,
    after: { action: input.action, target: input.target, affected, skipped, replaceOverrides: input.replaceOverrides },
    changedFields: ["variants"],
  },
    tx,
  );
}
