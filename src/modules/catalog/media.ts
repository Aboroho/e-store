import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { assertMediaOwned, syncUsageCountsTx, toAssetView, type MediaAssetView } from "@/modules/media/service";

/**
 * Product and variant images as shared-media references.
 *
 * Galleries store ordered `ProductImage` / `VariantImage` join rows plus
 * matching `MediaUsage` rows — the bytes live once in the media library no
 * matter how many products or variants reuse them. Removing an image here
 * removes the association (and its usage row); the underlying asset is never
 * deleted by catalog operations.
 *
 * Conventions:
 *  - the primary image is the gallery row at position 0;
 *  - gallery usage fields are `gallery-{position}` (product) and
 *    `variant-{position}` (variant), so rich-text `description-*` usages on the
 *    same entity are never disturbed by gallery edits.
 */

export interface CatalogMediaActor {
  userId: string;
  businessId: string;
  actorLabel: string;
}

export interface ProductImageView {
  mediaId: string;
  position: number;
  altText: string | null;
  asset: MediaAssetView;
}

async function assertProduct(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, businessId, deletedAt: null }, select: { id: true, name: true } });
  if (!product) throw AppError.notFound("Product not found");
  return product;
}

async function assertVariant(businessId: string, variantId: string) {
  const variant = await prisma.variant.findFirst({
    where: { id: variantId, product: { businessId, deletedAt: null }, deletedAt: null },
    select: { id: true, productId: true, name: true },
  });
  if (!variant) throw AppError.notFound("Variant not found");
  return variant;
}

export async function listProductImages(businessId: string, productId: string): Promise<ProductImageView[]> {
  await assertProduct(businessId, productId);
  const rows = await prisma.productImage.findMany({
    where: { productId, media: { deletedAt: null } },
    orderBy: { position: "asc" },
    include: { media: { include: { folder: { select: { path: true } } } } },
  });
  return Promise.all(
    rows.map(async (row) => ({ mediaId: row.mediaId, position: row.position, altText: row.altText, asset: await toAssetView(row.media) })),
  );
}

/**
 * Replace a product gallery. `mediaIds` arrive in display order; when
 * `primaryMediaId` is given it is moved to the front (position 0).
 */
export async function setProductGallery(
  actor: CatalogMediaActor,
  input: { productId: string; mediaIds: string[]; primaryMediaId?: string | null },
): Promise<ProductImageView[]> {
  if (input.mediaIds.length > 50) throw AppError.validation("A product gallery holds up to 50 images");
  await assertProduct(actor.businessId, input.productId);

  const ordered = [...new Set(input.mediaIds)];
  if (input.primaryMediaId) {
    const index = ordered.indexOf(input.primaryMediaId);
    if (index < 0) throw AppError.validation("The primary image must be part of the gallery");
    ordered.splice(index, 1);
    ordered.unshift(input.primaryMediaId);
  }

  await prisma.$transaction(async (tx) => {
    await assertMediaOwned(tx, actor.businessId, ordered, { imagesOnly: true, label: "gallery images" });

    const previous = await tx.productImage.findMany({ where: { productId: input.productId }, select: { mediaId: true, altText: true } });
    const previousAlt = new Map(previous.map((row) => [row.mediaId, row.altText]));

    await tx.productImage.deleteMany({ where: { productId: input.productId } });
    await tx.mediaUsage.deleteMany({ where: { entityType: "PRODUCT", entityId: input.productId, field: { startsWith: "gallery-" } } });

    for (const [position, mediaId] of ordered.entries()) {
      await tx.productImage.create({ data: { productId: input.productId, mediaId, position, altText: previousAlt.get(mediaId) ?? null } });
      await tx.mediaUsage.create({ data: { mediaId, entityType: "PRODUCT", entityId: input.productId, field: `gallery-${position}`, productId: input.productId } });
    }
    await syncUsageCountsTx(tx, [...previous.map((row) => row.mediaId), ...ordered]);
  });

  return listProductImages(actor.businessId, input.productId);
}

export async function listVariantImages(businessId: string, variantId: string): Promise<ProductImageView[]> {
  await assertVariant(businessId, variantId);
  const rows = await prisma.variantImage.findMany({
    where: { variantId, media: { deletedAt: null } },
    orderBy: { position: "asc" },
    include: { media: { include: { folder: { select: { path: true } } } } },
  });
  return Promise.all(
    rows.map(async (row) => ({ mediaId: row.mediaId, position: row.position, altText: row.altText, asset: await toAssetView(row.media) })),
  );
}

/** Replace a variant's images (position 0 is the variant primary). */
export async function setVariantImages(actor: CatalogMediaActor, input: { variantId: string; mediaIds: string[] }): Promise<ProductImageView[]> {
  if (input.mediaIds.length > 10) throw AppError.validation("A variant holds up to 10 images");
  const variant = await assertVariant(actor.businessId, input.variantId);
  const ordered = [...new Set(input.mediaIds)];

  await prisma.$transaction(async (tx) => {
    await assertMediaOwned(tx, actor.businessId, ordered, { imagesOnly: true, label: "variant images" });

    const previous = await tx.variantImage.findMany({ where: { variantId: variant.id }, select: { mediaId: true, altText: true } });
    const previousAlt = new Map(previous.map((row) => [row.mediaId, row.altText]));

    await tx.variantImage.deleteMany({ where: { variantId: variant.id } });
    await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: variant.id, field: { startsWith: "variant-" } } });

    for (const [position, mediaId] of ordered.entries()) {
      await tx.variantImage.create({ data: { variantId: variant.id, mediaId, position, altText: previousAlt.get(mediaId) ?? null } });
      await tx.mediaUsage.create({
        data: { mediaId, entityType: "VARIANT", entityId: variant.id, field: `variant-${position}`, productId: variant.productId, variantId: variant.id },
      });
    }
    await syncUsageCountsTx(tx, [...previous.map((row) => row.mediaId), ...ordered]);
  });

  return listVariantImages(actor.businessId, variant.id);
}

export interface BulkVariantImagePreview {
  id: string;
  name: string;
  sku: string;
}

/**
 * Apply one shared image as the primary (position 0) of every variant of a
 * product that carries a given attribute value — e.g. "all Black variants".
 * Variants that already show this image are left untouched; previous primaries
 * keep their associations further down the order.
 */
export async function bulkApplyVariantImage(
  actor: CatalogMediaActor,
  input: { productId: string; mediaId: string; attributeValueId: string },
): Promise<{ affected: BulkVariantImagePreview[] }> {
  const product = await assertProduct(actor.businessId, input.productId);

  const attributeValue = await prisma.attributeValue.findFirst({
    where: { id: input.attributeValueId, attribute: { businessId: actor.businessId } },
    select: { id: true, value: true },
  });
  if (!attributeValue) throw AppError.notFound("Attribute value not found");

  const targets = await prisma.variant.findMany({
    where: {
      productId: product.id,
      deletedAt: null,
      attributeValues: { some: { attributeValueId: attributeValue.id } },
    },
    orderBy: { position: "asc" },
    select: { id: true, name: true, sku: true },
  });
  if (targets.length === 0) throw AppError.validation(`No variants of ${product.name} use “${attributeValue.value}”`);

  await prisma.$transaction(async (tx) => {
    await assertMediaOwned(tx, actor.businessId, [input.mediaId], { imagesOnly: true, label: "variant images" });

    for (const target of targets) {
      const current = await tx.variantImage.findMany({ where: { variantId: target.id }, orderBy: { position: "asc" } });
      if (current[0]?.mediaId === input.mediaId) continue; // already the primary

      // Shift the existing order down and insert the shared image at the front.
      await tx.variantImage.deleteMany({ where: { variantId: target.id, mediaId: input.mediaId } });
      const rest = current.filter((row) => row.mediaId !== input.mediaId);
      await tx.variantImage.deleteMany({ where: { variantId: target.id } });
      await tx.mediaUsage.deleteMany({ where: { entityType: "VARIANT", entityId: target.id, field: { startsWith: "variant-" } } });

      const ordered = [input.mediaId, ...rest.map((row) => row.mediaId)];
      const altByMedia = new Map(rest.map((row) => [row.mediaId, row.altText]));
      for (const [position, mediaId] of ordered.entries()) {
        await tx.variantImage.create({ data: { variantId: target.id, mediaId, position, altText: altByMedia.get(mediaId) ?? null } });
        await tx.mediaUsage.create({
          data: { mediaId, entityType: "VARIANT", entityId: target.id, field: `variant-${position}`, productId: product.id, variantId: target.id },
        });
      }
      await syncUsageCountsTx(tx, [input.mediaId, ...rest.map((row) => row.mediaId)]);
    }
  });

  return { affected: targets };
}

/** Variants of a product carrying an attribute value (bulk-apply preview). */
export async function previewBulkVariantImageTargets(
  businessId: string,
  input: { productId: string; attributeValueId: string },
): Promise<BulkVariantImagePreview[]> {
  await assertProduct(businessId, input.productId);
  return prisma.variant.findMany({
    where: { productId: input.productId, deletedAt: null, attributeValues: { some: { attributeValueId: input.attributeValueId } } },
    orderBy: { position: "asc" },
    select: { id: true, name: true, sku: true },
  });
}
