import "server-only";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { toAssetView } from "@/modules/media/service";
import { storageIsConfigured, storageDriverName } from "@/modules/media/storage";
import { DEFAULT_UNIT_LABELS, listBrandOptions, listUnitLabels } from "@/modules/catalog/product-service";
import { parseRichText, isRichTextEmpty, richTextToPlainText } from "@/components/rich-text-editor/serialization";
import type { RichTextDocument } from "@/components/rich-text-editor/types";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Read model for the Create/Edit Product screens.
 *
 * Everything the form needs arrives in one round trip: the option lists it renders
 * (brands, categories, attributes with their values and value images, unit labels,
 * price lists), the storage capabilities of the media picker, the product itself
 * when editing, and the storefront URL prefix used by the slug preview.
 */

export interface EditorAttributeValue {
  id: string;
  value: string;
  colorHex: string | null;
  /** Attribute-value default image — the second level of the image precedence. */
  mediaId: string | null;
  image: MediaAssetView | null;
}

export interface EditorAttribute {
  id: string;
  name: string;
  slug: string;
  type: string;
  isVariantDefining: boolean;
  values: EditorAttributeValue[];
}

export interface EditorCategory {
  id: string;
  name: string;
  slug: string;
  path: string | null;
  parentId: string | null;
  productCount: number;
  image: MediaAssetView | null;
}

export interface EditorVariant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  position: number;
  status: string;
  optionKey: string;
  weightGrams: number | null;
  weightUnit: string;
  pricePaisa: number | null;
  compareAtPricePaisa: number | null;
  costPaisa: number | null;
  isPreorderEnabled: boolean | null;
  image: MediaAssetView | null;
  /** Variant-level override (null = inherit). */
  imageMediaId: string | null;
  gallery: Array<MediaAssetView & { altText: string | null }>;
  attributeValueIds: string[];
  onHand: number;
  available: number;
}

/** A media asset plus the product-specific alt text stored on the association. */
export type EditorImage = MediaAssetView & { altText: string | null };

export interface EditorProduct {
  id: string;
  name: string;
  slug: string;
  productCode: string | null;
  barcode: string | null;
  productType: string;
  status: string;
  brandId: string | null;
  brandName: string | null;
  unitLabel: string;
  weightGrams: number | null;
  weightUnit: string;
  requiresShipping: boolean;
  isFeatured: boolean;
  isPreorderEnabled: boolean;
  preorderNote: string | null;
  taxRateBps: number;
  packagingCostPaisa: number;
  defaultPricePaisa: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  seoImage: MediaAssetView | null;
  shortDescription: string | null;
  description: string | null;
  updatedAt: string;
  publishedAt: string | null;
  categoryIds: string[];
  primaryCategoryId: string | null;
  attributeIds: string[];
  images: EditorImage[];
  variants: EditorVariant[];
}

export interface ProductEditorData {
  product: EditorProduct | null;
  brands: Awaited<ReturnType<typeof listBrandOptions>>;
  categories: EditorCategory[];
  attributes: EditorAttribute[];
  unitLabels: Array<{ id: string | null; name: string; slug: string; isDefault: boolean }>;
  priceListName: string;
  /** Null when the business has no price list yet: variants cannot be priced. */
  priceListId: string | null;
  /** Prefix used for the live slug preview, e.g. "https://shop.example.com/products/". */
  productUrlPrefix: string | null;
  media: {
    canManage: boolean;
    canUpload: boolean;
    configured: boolean;
    driver: string;
    maxUploadBytes: number;
    allowedTypes: string[];
  };
  canViewCost: boolean;
}

/** Where the storefront will serve the product, used by the slug preview. */
async function storefrontUrlPrefix(businessId: string): Promise<string | null> {
  const storefront = await prisma.storefront.findFirst({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { slug: true, domains: { where: { status: "VERIFIED" }, select: { host: true, isPrimary: true }, take: 5 } },
  });
  if (!storefront) return null;

  const primary = storefront.domains.find((domain) => domain.isPrimary) ?? storefront.domains[0];
  if (primary) return `https://${primary.host}/products/`;

  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/s/${storefront.slug}/products/`;
}

/**
 * Everything the Create/Edit Product screen needs, in one round trip.
 *
 * `viewer` carries the permission-derived capabilities (cost visibility, media
 * management, uploads) so the form never renders a control the caller may not use.
 */
export async function loadProductEditorData(
  businessId: string,
  viewer: { canViewCost: boolean; canManageMedia: boolean; canUploadMedia: boolean },
  productId?: string,
): Promise<ProductEditorData> {
  const [brands, categories, attributes, unitLabels, priceLists, settings, storefrontPrefix] = await Promise.all([
    listBrandOptions(businessId),
    prisma.category.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ path: "asc" }, { position: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        path: true,
        parentId: true,
        image: { select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, title: true, caption: true, folderId: true, usageCount: true, createdAt: true } },
        _count: { select: { products: true } },
      },
    }),
    prisma.attribute.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        isVariantDefining: true,
        values: {
          orderBy: [{ position: "asc" }, { value: "asc" }],
          select: {
            id: true,
            value: true,
            colorHex: true,
            mediaId: true,
            image: { select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, title: true, caption: true, folderId: true, usageCount: true, createdAt: true } },
          },
        },
      },
    }),
    listUnitLabels(businessId),
    prisma.priceList.findMany({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { priority: "desc" }], select: { id: true, name: true, isDefault: true } }),
    getBusinessSettings(businessId),
    storefrontUrlPrefix(businessId),
  ]);

  const defaultPriceList = priceLists.find((list) => list.isDefault) ?? priceLists[0] ?? null;

  const [categoryRows, attributeRows, brandRows] = await Promise.all([
    Promise.all(
      categories.map(async (category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        parentId: category.parentId,
        productCount: category._count.products,
        image: category.image ? await toAssetView(category.image) : null,
      })),
    ),
    Promise.all(
      attributes.map(async (attribute) => ({
        id: attribute.id,
        name: attribute.name,
        slug: attribute.slug,
        type: attribute.type,
        isVariantDefining: attribute.isVariantDefining,
        values: await Promise.all(
          attribute.values.map(async (value) => ({
            id: value.id,
            value: value.value,
            colorHex: value.colorHex,
            mediaId: value.mediaId,
            image: value.image ? await toAssetView(value.image) : null,
          })),
        ),
      })),
    ),
    brands,
  ]);

  return {
    product: productId ? await loadEditorProduct(businessId, productId) : null,
    brands: brandRows,
    categories: categoryRows,
    attributes: attributeRows,
    unitLabels: unitLabels.length > 0 ? unitLabels : DEFAULT_UNIT_LABELS.map((name, index) => ({ id: null, name, slug: name, isDefault: index === 0 })),
    priceListName: defaultPriceList?.name ?? "the default price list",
    priceListId: defaultPriceList?.id ?? null,
    productUrlPrefix: storefrontPrefix,
    media: {
      canManage: viewer.canManageMedia,
      canUpload: viewer.canUploadMedia,
      configured: storageIsConfigured(),
      driver: storageDriverName(),
      maxUploadBytes: Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024),
      allowedTypes: Array.isArray(settings["media.allowed_types"]) ? (settings["media.allowed_types"] as string[]) : [],
    },
    canViewCost: viewer.canViewCost,
  };
}

/** Fields `toAssetView` needs, plus the folder path used for the picker. */
const MEDIA_ASSET_SELECT = {
  id: true,
  objectKey: true,
  originalName: true,
  altText: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  width: true,
  height: true,
  visibility: true,
  title: true,
  caption: true,
  folderId: true,
  usageCount: true,
  createdAt: true,
  folder: { select: { path: true } },
} as const;

async function loadEditorProduct(businessId: string, productId: string): Promise<EditorProduct | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    include: {
      brandRef: { select: { id: true, name: true } },
      seoImage: { select: MEDIA_ASSET_SELECT },
      categories: { select: { categoryId: true, isPrimary: true } },
      attributes: { orderBy: { position: "asc" }, select: { attributeId: true } },
      images: { orderBy: { position: "asc" }, include: { media: { select: MEDIA_ASSET_SELECT } } },
      variants: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: { position: "asc" },
        include: {
          images: { orderBy: { position: "asc" }, include: { media: { select: MEDIA_ASSET_SELECT } } },
          attributeValues: { select: { attributeValueId: true } },
          inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true } },
        },
      },
      priceItems: { where: { minQuantity: 1 }, select: { pricePaisa: true, compareAtPricePaisa: true, variantId: true } },
    },
  });
  if (!product) return null;

  const metadata = (product.metadata ?? {}) as Record<string, unknown>;
  const priceByVariant = new Map(product.priceItems.map((item) => [item.variantId, item]));

  /* Variant image overrides point at media rows directly (`Variant.imageMediaId` is a
     plain column, not a relation), so the referenced assets are fetched in one query
     instead of one per variant. */
  const overrideIds = [...new Set(product.variants.map((variant) => variant.imageMediaId).filter((id): id is string => Boolean(id)))];
  const overrideAssets = overrideIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: overrideIds }, businessId }, select: MEDIA_ASSET_SELECT })
    : [];
  const overrideById = new Map(overrideAssets.map((asset) => [asset.id, asset]));

  const variants: EditorVariant[] = await Promise.all(
    product.variants.map(async (variant) => {
      const balance = variant.inventory[0];
      const override = variant.imageMediaId ? overrideById.get(variant.imageMediaId) : undefined;
      const variantMetadata = (variant.metadata ?? {}) as Record<string, unknown>;
      const price = priceByVariant.get(variant.id);
      return {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        name: variant.name,
        position: variant.position,
        status: variant.status,
        optionKey: variant.optionKey,
        weightGrams: variant.weightGrams,
        weightUnit: typeof variantMetadata.weightUnit === "string" ? (variantMetadata.weightUnit as string) : "g",
        pricePaisa: variant.priceOverridePaisa ?? price?.pricePaisa ?? null,
        compareAtPricePaisa: variant.compareAtPricePaisa ?? price?.compareAtPricePaisa ?? null,
        costPaisa: variant.costPaisa,
        isPreorderEnabled: variant.isPreorderEnabled,
        imageMediaId: variant.imageMediaId,
        image: override ? await toAssetView(override) : null,
        gallery: await Promise.all(variant.images.map(async (image) => ({ ...(await toAssetView(image.media)), altText: image.altText }))),
        attributeValueIds: variant.attributeValues.map((value) => value.attributeValueId),
        onHand: balance?.onHand ?? 0,
        available: balance ? balance.onHand - balance.reserved - balance.damaged - balance.inspection : 0,
      };
    }),
  );

  const primaryCategory = product.categories.find((entry) => entry.isPrimary);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    productCode: product.sku,
    barcode: product.barcode,
    productType: product.productType,
    status: product.status,
    brandId: product.brandId ?? product.brandRef?.id ?? null,
    brandName: product.brandRef?.name ?? product.brand,
    unitLabel: product.unitLabel,
    weightGrams: product.weightGrams,
    weightUnit: typeof metadata.weightUnit === "string" ? (metadata.weightUnit as string) : "g",
    requiresShipping: product.requiresShipping,
    isFeatured: product.isFeatured,
    isPreorderEnabled: product.isPreorderEnabled,
    preorderNote: product.preorderNote,
    taxRateBps: product.taxRateBps,
    packagingCostPaisa: product.packagingCostPaisa,
    defaultPricePaisa: typeof metadata.defaultPricePaisa === "number" ? metadata.defaultPricePaisa : null,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    seoKeywords: product.seoKeywords,
    seoImage: product.seoImage ? await toAssetView(product.seoImage) : null,
    shortDescription: product.shortDescription,
    description: product.description,
    updatedAt: product.updatedAt.toISOString(),
    publishedAt: product.publishedAt?.toISOString() ?? null,
    categoryIds: product.categories.map((entry) => entry.categoryId),
    primaryCategoryId: primaryCategory?.categoryId ?? null,
    attributeIds: product.attributes.map((entry) => entry.attributeId),
    images: await Promise.all(product.images.map(async (image) => ({ ...(await toAssetView(image.media)), altText: image.altText }))),
    variants,
  };
}

/** Rich-text documents for the editor, upgrading legacy plain-text values. */
export function editorDocuments(product: EditorProduct | null): { short: RichTextDocument; long: RichTextDocument } {
  return {
    short: parseRichText(product?.shortDescription),
    long: parseRichText(product?.description),
  };
}

export { isRichTextEmpty, richTextToPlainText };
