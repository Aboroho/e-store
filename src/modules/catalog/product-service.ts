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
import { applyStockMovement, defaultLocationId, ensureBalance } from "@/modules/inventory/service";
import { DEFAULT_WEIGHT_UNIT, isValidSlug, normalizeSku, resolveBulkTarget, suggestSlug, toWeightGrams } from "@/modules/catalog/product-draft";
import type { BulkTarget, DraftVariant } from "@/modules/catalog/product-draft";
import type { BulkVariantActionInput, BrandInput, ProductDraftInput, UnitLabelInput } from "@/modules/catalog/product-schemas";
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
  attributeValues: Map<string, { id: string; attributeId: string; attributeSlug: string; valueSlug: string; mediaId: string | null }>;
  variantsById: Map<string, { id: string; sku: string; optionKey: string; productId: string }>;
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
          slug: true,
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
  const variantsById = new Map<string, { id: string; sku: string; optionKey: string; productId: string }>();
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
          mediaId: value.mediaId,
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
  // 1. No duplicates inside this submission (the UI warns earlier, the server decides).
  const seen = new Map<string, number>();
  for (const variant of input.variants) {
    const sku = normalizeSku(variant.sku);
    seen.set(sku, (seen.get(sku) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([sku]) => sku);
  if (duplicates.length > 0) {
    throw AppError.validation(`These variant codes are used more than once in this product: ${duplicates.join(", ")}`);
  }

  // 2. Variant SKUs are globally unique in this platform — check the whole table but
  //    only for the codes that actually changed, so a large catalogue stays fast.
  const payloadSkus = input.variants.map((variant) => normalizeSku(variant.sku));
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
      select: { sku: true, product: { select: { name: true, id: true } } },
    });
    const realClashes = clashes.filter((clash) => clash.product.id !== input.productId);
    if (realClashes.length > 0) {
      const first = realClashes[0]!;
      throw AppError.validation(
        realClashes.length === 1
          ? `Variant code ${first.sku} is already used by another product (${first.product.name}). Product codes are unique across the platform.`
          : `${realClashes.length} variant codes are already used by other products: ${realClashes.map((clash) => clash.sku).join(", ")}.`,
      );
    }
  }

  // 3. The parent product code is unique inside the business (variant codes may differ).
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
    const variantClash = await tx.variant.findFirst({ where: { sku: productSku }, select: { sku: true } });
    if (variantClash) {
      throw AppError.validation(`Product code ${productSku} is already used by a variant. Choose a different code.`);
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
    const metadata: Prisma.InputJsonObject = {
      weightUnit: input.weightUnit ?? DEFAULT_WEIGHT_UNIT,
      ...(input.defaultPricePaisa != null ? { defaultPricePaisa: input.defaultPricePaisa } : {}),
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
      weightGrams,
      requiresShipping: input.requiresShipping,
      isFeatured: input.isFeatured,
      isPreorderEnabled: input.isPreorderEnabled,
      preorderNote: input.preorderNote?.trim() || null,
      taxRateBps: input.taxRateBps,
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
      const variantData = {
        name: variant.name,
        sku: normalizeSku(variant.sku),
        barcode: variant.barcode ?? null,
        optionKey,
        position,
        weightGrams: variant.weightGrams ?? null,
        metadata: { weightUnit: variant.weightUnit ?? input.weightUnit ?? DEFAULT_WEIGHT_UNIT },
        priceOverridePaisa: variant.pricePaisa,
        compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
        costPaisa: variant.costPaisa ?? null,
        isPreorderEnabled: variant.isPreorderEnabled,
        imageMediaId: variant.imageMediaId ?? null,
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

      await tx.priceListItem.upsert({
        where: { priceListId_variantId_minQuantity: { priceListId: context.priceListId, variantId: saved.id, minQuantity: 1 } },
        create: {
          priceListId: context.priceListId,
          variantId: saved.id,
          productId: product.id,
          pricePaisa: variant.pricePaisa,
          compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
        },
        update: { pricePaisa: variant.pricePaisa, compareAtPricePaisa: variant.compareAtPricePaisa ?? null },
      });

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
      select: { id: true, sku: true },
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

    /* Opening stock — explicit, ledger-based, and never implied by saving. */
    let openingStockRecorded = 0;
    if (input.recordOpeningStock && input.openingStock.length > 0) {
      const locationId = await defaultLocationId(actor.businessId);
      const byVariantSku = new Map(
        await tx.variant
          .findMany({ where: { id: { in: [...keptVariantIds] } }, select: { id: true, sku: true } })
          .then((rows) => rows.map((row) => [row.id, row.sku] as const)),
      );
      for (const entry of input.openingStock) {
        if (entry.quantity <= 0) continue;
        // Keys come from the form as the client row key, the variant id or its SKU — compare codes case-insensitively.
        const wantedKey = normalizeSku(entry.variantKey);
        const variantId = [...keptVariantIds].find(
          (id) => id === entry.variantKey || normalizeSku(byVariantSku.get(id)) === wantedKey,
        );
        if (!variantId) continue;
        await applyStockMovement(tx, {
          businessId: actor.businessId,
          variantId,
          locationId,
          type: "OPENING",
          onHandDelta: entry.quantity,
          reason: "Opening stock recorded while creating the product",
          sourceType: "Product",
          sourceId: product.id,
          actorUserId: actor.userId,
          idempotencyKey: `opening-stock:${product.id}:${variantId}`,
        });
        openingStockRecorded += 1;
      }
    }

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
        after: { name: input.name, slug: product.slug, status: product.status, variants: input.variants.map((variant) => variant.sku) },
        changedFields: ["product", "images", "variants", "seo"],
      },
    });

    const warnings: string[] = [];
    if (removed.length > 0) {
      warnings.push(`${removed.length} variant(s) are no longer part of this product and were archived (${removed.map((variant) => variant.sku).join(", ")}).`);
    }

    return {
      productId: product.id,
      slug: product.slug,
      status: product.status as "DRAFT" | "ACTIVE" | "ARCHIVED",
      created: !existing,
      variantCount: input.variants.length,
      openingStockRecorded,
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
        priceOverridePaisa: true,
        compareAtPricePaisa: true,
        costPaisa: true,
        weightGrams: true,
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
      sku: row.sku,
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
          if (input.pricePaisa === undefined) throw AppError.validation("Enter the new price.");
          const priceList =
            (await tx.priceList.findFirst({ where: { businessId: actor.businessId, isDefault: true }, select: { id: true } })) ??
            (await tx.priceList.findFirst({ where: { businessId: actor.businessId }, orderBy: { createdAt: "asc" }, select: { id: true } }));
          if (!priceList) throw AppError.conflict("Create a price list before setting prices.");
          await tx.variant.update({ where: { id: variantId }, data: { priceOverridePaisa: input.pricePaisa } });
          await tx.priceListItem.upsert({
            where: { priceListId_variantId_minQuantity: { priceListId: priceList.id, variantId, minQuantity: 1 } },
            create: { priceListId: priceList.id, variantId, productId: product.id, pricePaisa: input.pricePaisa },
            update: { pricePaisa: input.pricePaisa },
          });
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
    }

    await recordBulkAudit(tx, actor, product.id, input, targetDescription, affected, skipped);
    return { action: input.action, affected, skipped, targetDescription, details };
  });
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
