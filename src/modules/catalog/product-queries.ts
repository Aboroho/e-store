import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  priceOverridePaisa?: number | null;
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
  priceOverridePaisa: number | null;
  compareAtPricePaisa: number | null;
  costPaisa: number | null;
  packagingCostPaisa: number | null;
  currentPricePaisa: number | null;
  discountType: "PERCENTAGE" | "FLAT" | "NONE";
  discountValue: number;
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
  taxRateId: string | null;
  taxRateBps: number;
  packagingCostTemplateId: string | null;
  packagingCostPaisa: number;
  defaultPricePaisa: number | null;
  currentPricePaisa: number | null;
  discountType: "PERCENTAGE" | "FLAT" | "NONE";
  discountValue: number;
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
  taxRates: Array<{ id: string; name: string; rateBps: number; isDefault: boolean }>;
  packagingTemplates: Array<{ id: string; name: string; costPaisa: number; isDefault: boolean }>;
  draft: { draftId: string; updatedAt: string; payload: Record<string, unknown> } | null;
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
  // Category and Attribute queries are written against scalar fields only
  // (imageMediaId / mediaId) and then batch-fetch the MediaAsset rows.
  // This keeps the code compatible with an outdated Prisma Client that does
  // not yet know the `image` relation (Unknown field `image` errors seen in
  // production) while remaining correct for the current schema.
  const [brands, rawCategories, rawAttributes, unitLabels, priceLists, settings, storefrontPrefix, taxRates, packagingTemplates, draft] = await Promise.all([
    listBrandOptions(businessId).catch(() => [] as Awaited<ReturnType<typeof listBrandOptions>>),
    (prisma.category as unknown as { findMany: typeof prisma.category.findMany }).findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ path: "asc" }, { position: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        path: true,
        parentId: true,
        imageMediaId: true,
        _count: { select: { products: true } },
      },
    } as never) as unknown as Promise<Array<{ id: string; name: string; slug: string; path: string | null; parentId: string | null; imageMediaId: string | null; _count: { products: number } }>>,
    (prisma.attribute as unknown as { findMany: typeof prisma.attribute.findMany }).findMany({
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
            priceOverridePaisa: true,
          },
        },
      },
    } as never) as unknown as Promise<Array<{ id: string; name: string; slug: string; type: string; isVariantDefining: boolean; values: Array<{ id: string; value: string; colorHex: string | null; mediaId: string | null; priceOverridePaisa: number | null }> }>>,
    listUnitLabels(businessId).catch(() => [] as Awaited<ReturnType<typeof listUnitLabels>>),
    prisma.priceList.findMany({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { priority: "desc" }], select: { id: true, name: true, isDefault: true } }),
    getBusinessSettings(businessId),
    storefrontUrlPrefix(businessId),
    prisma.taxRate.findMany({ where: { businessId, isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, rateBps: true, isDefault: true } }).catch(() => []),
    prisma.packagingCostTemplate.findMany({ where: { businessId, isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, costPaisa: true, isDefault: true } }).catch(() => []),
    prisma.productDraft.findFirst({
      where: { businessId, ...(productId ? { productId } : { productId: null }) },
      orderBy: { updatedAt: "desc" },
      select: { id: true, updatedAt: true, payload: true },
    }).catch(() => null),
  ]);

  // Batch-fetch category images
  const categoryMediaIds = rawCategories.map((c) => c.imageMediaId).filter((id): id is string => Boolean(id));
  const categoryMediaAssets = categoryMediaIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: categoryMediaIds }, businessId },
        select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, title: true, caption: true, folderId: true, usageCount: true, createdAt: true, folder: { select: { path: true } } },
      })
    : [];
  const categoryMediaById = new Map(categoryMediaAssets.map((asset) => [asset.id, asset]));

  // Batch-fetch attribute value images
  const attributeMediaIds = rawAttributes.flatMap((attr) => attr.values.map((v) => v.mediaId).filter((id): id is string => Boolean(id)));
  const attributeMediaAssets = attributeMediaIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: [...new Set(attributeMediaIds)] }, businessId },
        select: { id: true, objectKey: true, originalName: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, title: true, caption: true, folderId: true, usageCount: true, createdAt: true, folder: { select: { path: true } } },
      })
    : [];
  const attributeMediaById = new Map(attributeMediaAssets.map((asset) => [asset.id, asset]));

  const defaultPriceList = priceLists.find((list) => list.isDefault) ?? priceLists[0] ?? null;

  const [categoryRows, attributeRows, brandRows] = await Promise.all([
    Promise.all(
      rawCategories.map(async (category) => {
        const asset = category.imageMediaId ? categoryMediaById.get(category.imageMediaId) : undefined;
        return {
          id: category.id,
          name: category.name,
          slug: category.slug,
          path: category.path,
          parentId: category.parentId,
          productCount: category._count.products,
          image: asset ? await toAssetView(asset as never) : null,
        };
      }),
    ),
    Promise.all(
      rawAttributes.map(async (attribute) => ({
        id: attribute.id,
        name: attribute.name,
        slug: attribute.slug,
        type: attribute.type,
        isVariantDefining: attribute.isVariantDefining,
        values: await Promise.all(
          (attribute.values as any[]).map(async (value: any) => {
            const asset = value.mediaId ? attributeMediaById.get(value.mediaId) : undefined;
            return {
              id: value.id,
              value: value.value,
              colorHex: value.colorHex,
              mediaId: value.mediaId,
              image: asset ? await toAssetView(asset as never) : null,
              priceOverridePaisa: value.priceOverridePaisa ?? null,
            };
          }),
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
    taxRates,
    packagingTemplates,
    draft: draft ? { draftId: draft.id, updatedAt: draft.updatedAt.toISOString(), payload: draft.payload as Record<string, unknown> } : null,
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
  // Attempt the full query (includes Brand and SEO image relations added in
  // the 20260920090000 migration). If the Prisma Client is outdated it will
  // throw "Unknown field `brandRef`" / `seoImage`; fall back to scalar-only
  // selects and join manually.
  let product: any = null;
  let brandRef: { id: string; name: string } | null = null;
  let seoImageAsset: (typeof MEDIA_ASSET_SELECT & Record<string, unknown>) | null = null;
  let seoImageMediaIdFallback: string | null = null;
  try {
    product = await prisma.product.findFirst({
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
    }) as any;
    if (!product) return null;
    // pull out the relations we already fetched so later code can treat them uniformly
    brandRef = (product as unknown as { brandRef: typeof brandRef }).brandRef ?? null;
    seoImageAsset = (product as unknown as { seoImage: typeof seoImageAsset }).seoImage ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("Unknown field") && !msg.includes("Unknown arg") && !msg.includes("brandRef") && !msg.includes("seoImage")) throw error;
    // Fallback: query without the new relations, fetch them by id afterwards.
    const fallback = await (prisma.product as unknown as { findFirst: typeof prisma.product.findFirst }).findFirst({
      where: { id: productId, businessId },
      include: {
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
    } as any) as unknown as Record<string, unknown> & { brandId: string | null; brand: string | null; seoImageMediaId: string | null } | null;
    if (!fallback) return null;
    product = fallback as any;
    seoImageMediaIdFallback = (fallback as { seoImageMediaId: string | null }).seoImageMediaId ?? null;
    const brandId = (fallback as { brandId: string | null }).brandId;
    if (brandId) {
      try {
        const anyPrisma = prisma as unknown as Record<string, { findFirst: (args: unknown) => Promise<unknown> }>;
        if (anyPrisma.brand) {
          brandRef = (await (anyPrisma.brand as any).findFirst?.({ where: { id: brandId }, select: { id: true, name: true } } as any)) as any;
        }
      } catch {
        brandRef = null;
      }
      if (!brandRef) {
        // Brand table may be queryable via raw SQL even if client lacks model; ignore.
        brandRef = null;
      }
    }
    if (seoImageMediaIdFallback) {
      try {
        const asset = await prisma.mediaAsset.findFirst({ where: { id: seoImageMediaIdFallback, businessId }, select: MEDIA_ASSET_SELECT });
        seoImageAsset = asset as never;
      } catch {
        seoImageAsset = null;
      }
    }
  }
  if (!product) return null;

  const metadata = ((product as any).metadata ?? {}) as Record<string, unknown>;
  const priceByVariant = new Map((product.priceItems as any[]).map((item: any) => [item.variantId, item]));

  /* Variant image overrides point at media rows directly (`Variant.imageMediaId` is a
     plain column, not a relation), so the referenced assets are fetched in one query
     instead of one per variant. */
  const overrideIds = [...new Set((product.variants as any[]).map((variant: any) => variant.imageMediaId).filter((id: any): id is string => Boolean(id)))];
  const overrideAssets = overrideIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: overrideIds }, businessId }, select: MEDIA_ASSET_SELECT })
    : [];
  const overrideById = new Map(overrideAssets.map((asset) => [asset.id, asset]));

  const variants: EditorVariant[] = await Promise.all(
    (product.variants as any[]).map(async (variant: any) => {
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
        priceOverridePaisa: variant.priceOverridePaisa ?? null,
        compareAtPricePaisa: variant.compareAtPricePaisa ?? price?.compareAtPricePaisa ?? null,
        costPaisa: variant.costPaisa,
        packagingCostPaisa: variant.packagingCostPaisa ?? null,
        currentPricePaisa: typeof variantMetadata.currentPricePaisa === "number" ? (variantMetadata.currentPricePaisa as number) : null,
        discountType: ((variantMetadata.discountType as any) || "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
        discountValue: typeof variantMetadata.discountValue === "number" ? (variantMetadata.discountValue as number) : 0,
        isPreorderEnabled: variant.isPreorderEnabled,
        imageMediaId: variant.imageMediaId,
        image: override ? await toAssetView(override) : null,
        gallery: await Promise.all((variant.images as any[]).map(async (image: any) => ({ ...(await toAssetView(image.media as never)), altText: image.altText }))),
        attributeValueIds: (variant.attributeValues as any[]).map((value: any) => value.attributeValueId),
        onHand: balance?.onHand ?? 0,
        available: balance ? balance.onHand - balance.reserved - balance.damaged - balance.inspection : 0,
      };
    }),
  );

  const primaryCategory = (product as unknown as { categories: Array<{ isPrimary: boolean; categoryId: string }> }).categories.find((entry) => entry.isPrimary);

  // Resolve brand / seo image from the variables populated by either path.
  const rawProduct = product as unknown as Record<string, unknown>;
  const fallbackBrandId = (rawProduct as { brandId?: string | null }).brandId ?? null;
  const fallbackBrandText = (rawProduct as { brand?: string | null }).brand ?? null;
  const fallbackSeo = (rawProduct as { seoImage?: unknown }).seoImage as unknown as null | Parameters<typeof toAssetView>[0];
  const resolvedBrandId = fallbackBrandId ?? brandRef?.id ?? null;
  const resolvedBrandName = brandRef?.name ?? fallbackBrandText;
  const resolvedSeoAsset = seoImageAsset ?? fallbackSeo ?? null;

  return {
    id: (rawProduct as { id: string }).id,
    name: (rawProduct as { name: string }).name,
    slug: (rawProduct as { slug: string }).slug,
    productCode: (rawProduct as { sku: string | null }).sku ?? null,
    barcode: (rawProduct as { barcode: string | null }).barcode ?? null,
    productType: (rawProduct as { productType: string }).productType,
    status: (rawProduct as { status: string }).status,
    brandId: resolvedBrandId,
    brandName: resolvedBrandName as string | null,
    unitLabel: (rawProduct as { unitLabel: string }).unitLabel,
    weightGrams: (rawProduct as { weightGrams: number | null }).weightGrams ?? null,
    weightUnit: typeof metadata.weightUnit === "string" ? (metadata.weightUnit as string) : "g",
    requiresShipping: (rawProduct as { requiresShipping: boolean }).requiresShipping,
    isFeatured: (rawProduct as { isFeatured: boolean }).isFeatured,
    isPreorderEnabled: (rawProduct as { isPreorderEnabled: boolean }).isPreorderEnabled,
    preorderNote: (rawProduct as { preorderNote: string | null }).preorderNote ?? null,
    taxRateId: (rawProduct as { taxRateId?: string | null }).taxRateId ?? null,
    taxRateBps: (rawProduct as { taxRateBps: number }).taxRateBps,
    packagingCostTemplateId: (rawProduct as { packagingCostTemplateId?: string | null }).packagingCostTemplateId ?? null,
    packagingCostPaisa: (rawProduct as { packagingCostPaisa: number }).packagingCostPaisa,
    defaultPricePaisa: typeof metadata.defaultPricePaisa === "number" ? metadata.defaultPricePaisa : null,
    currentPricePaisa: typeof metadata.currentPricePaisa === "number" ? metadata.currentPricePaisa : null,
    discountType: ((metadata.discountType as any) || "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
    discountValue: typeof metadata.discountValue === "number" ? metadata.discountValue : 0,
    seoTitle: (rawProduct as { seoTitle: string | null }).seoTitle ?? null,
    seoDescription: (rawProduct as { seoDescription: string | null }).seoDescription ?? null,
    seoKeywords: (rawProduct as { seoKeywords: string | null }).seoKeywords ?? null,
    seoImage: resolvedSeoAsset ? await toAssetView(resolvedSeoAsset as never) : null,
    shortDescription: (product as any).shortDescription,
    description: (product as any).description,
    updatedAt: (product as any).updatedAt.toISOString(),
    publishedAt: (product as any).publishedAt?.toISOString() ?? null,
    categoryIds: (product as any).categories.map((entry: any) => entry.categoryId),
    primaryCategoryId: primaryCategory?.categoryId ?? null,
    attributeIds: (product as any).attributes.map((entry: any) => entry.attributeId),
    images: await Promise.all((product as any).images.map(async (image: any) => ({ ...(await toAssetView(image.media as never)), altText: image.altText }))),
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
