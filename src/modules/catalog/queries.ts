import "server-only";
import { prisma } from "@/lib/db/client";
import { availableQuantity } from "@/modules/inventory/service";
import { toAssetView } from "@/modules/media/service";

/** Read queries for catalog screens. All of them are scoped by businessId. */

const MEDIA_THUMB_SELECT = {
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

export interface CatalogImageThumb {
  url: string | null;
  alt: string;
}

async function catalogThumbs(businessId: string, mediaIds: Array<string | null | undefined>): Promise<Map<string, CatalogImageThumb>> {
  const ids = [...new Set(mediaIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids }, businessId, deletedAt: null },
    select: MEDIA_THUMB_SELECT,
  });
  const thumbs = new Map<string, CatalogImageThumb>();
  await Promise.all(
    assets.map(async (asset) => {
      const view = await toAssetView(asset);
      thumbs.set(asset.id, { url: view.url, alt: view.altText ?? view.originalName });
    }),
  );
  return thumbs;
}

export interface ProductListVariantRow {
  id: string;
  name: string;
  sku: string | null;
  optionKey: string;
  status: string;
  pricePaisa: number;
  priceOverridePaisa: number | null;
  compareAtPricePaisa: number | null;
  currentPricePaisa: number | null;
  discountType: "PERCENTAGE" | "FLAT" | "NONE";
  discountValue: number;
  costPaisa: number | null;
  packagingCostPaisa: number | null;
  weightGrams: number | null;
  imageMediaId: string | null;
  onHand: number;
  available: number;
  attributesSummary: Record<string, string> | null;
  image: CatalogImageThumb | null;
}

export interface ProductListRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: string;
  productType: string;
  brand: string | null;
  unitLabel: string;
  defaultPricePaisa: number | null;
  defaultCurrentPricePaisa: number | null;
  defaultDiscountType: "PERCENTAGE" | "FLAT" | "NONE";
  defaultDiscountValue: number;
  weightGrams: number | null;
  variantCount: number;
  onHand: number;
  available: number;
  priceFromPaisa: number | null;
  isFeatured: boolean;
  isPreorderEnabled: boolean;
  updatedAt: Date;
  image: CatalogImageThumb | null;
  /** True for an unsaved ProductDraft that has not become a product yet. */
  isWorkingDraft: boolean;
  /** True when this existing product has an in-progress edit draft. */
  hasUnsavedDraft: boolean;
  variants: ProductListVariantRow[];
}

export async function listProducts(
  businessId: string,
  query: { search?: string; status?: string; categoryId?: string; sortBy?: string; sortDir: "asc" | "desc"; skip: number; take: number },
): Promise<{ rows: ProductListRow[]; total: number }> {
  const where = {
    businessId,
    deletedAt: null,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "DRAFT" } : {}),
    ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { brand: { contains: query.search, mode: "insensitive" as const } },
            { sku: { contains: query.search, mode: "insensitive" as const } },
            { variants: { some: { name: { contains: query.search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const orderBy =
    query.sortBy === "name"
      ? { name: query.sortDir }
      : query.sortBy === "updatedAt"
        ? { updatedAt: query.sortDir }
        : { createdAt: query.sortDir };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.take,
      include: {
        variants: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            status: true,
            optionKey: true,
            imageMediaId: true,
            priceOverridePaisa: true,
            currentPricePaisa: true,
            discountType: true,
            discountValue: true,
            compareAtPricePaisa: true,
            costPaisa: true,
            packagingCostPaisa: true,
            weightGrams: true,
            attributesSummary: true,
            priceItems: {
              where: { minQuantity: 1 },
              take: 1,
              select: { pricePaisa: true, compareAtPricePaisa: true },
            },
            inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const draftRows = await prisma.productDraft.findMany({
    where: { businessId, productId: { in: products.map((product) => product.id) } },
    select: { productId: true },
  }).catch(() => [] as Array<{ productId: string | null }>);
  const draftProductIds = new Set(draftRows.map((row) => row.productId).filter((id): id is string => Boolean(id)));

  const thumbs = await catalogThumbs(businessId, [
    ...products.map((product) => product.primaryImageMediaId),
    ...products.flatMap((product) => product.variants.map((variant) => variant.imageMediaId)),
  ]);

  const rows: ProductListRow[] = products.map((product) => {
    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    const defaultPricePaisa =
      product.defaultPricePaisa ?? (typeof metadata.defaultPricePaisa === "number" ? (metadata.defaultPricePaisa as number) : null);
    const productImage = product.primaryImageMediaId ? (thumbs.get(product.primaryImageMediaId) ?? null) : null;

    const variantRows: ProductListVariantRow[] = product.variants.map((variant) => {
      const onHand = variant.inventory.reduce((sum, balance) => sum + balance.onHand, 0);
      const available = variant.inventory.reduce((sum, balance) => sum + availableQuantity(balance), 0);
      const effectivePrice = variant.priceItems[0]?.pricePaisa ?? variant.priceOverridePaisa ?? defaultPricePaisa ?? 0;
      return {
        id: variant.id,
        name: variant.name,
        sku: product.sku,
        optionKey: variant.optionKey,
        status: variant.status,
        pricePaisa: effectivePrice,
        priceOverridePaisa: variant.priceOverridePaisa,
        compareAtPricePaisa: variant.priceItems[0]?.compareAtPricePaisa ?? variant.compareAtPricePaisa,
        currentPricePaisa: variant.currentPricePaisa,
        discountType: (variant.discountType ?? "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
        discountValue: variant.discountValue ?? 0,
        costPaisa: variant.costPaisa,
        packagingCostPaisa: variant.packagingCostPaisa ?? product.packagingCostPaisa,
        weightGrams: variant.weightGrams,
        imageMediaId: variant.imageMediaId,
        onHand,
        available,
        attributesSummary: (variant.attributesSummary as Record<string, string>) || null,
        image: (variant.imageMediaId ? thumbs.get(variant.imageMediaId) : null) ?? productImage,
      };
    });

    const activeVariants = variantRows.filter((variant) => variant.status === "ACTIVE");
    const prices = activeVariants
      .map((variant) => variant.pricePaisa)
      .filter((price): price is number => typeof price === "number" && price > 0);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      status: product.status,
      productType: product.productType,
      brand: product.brand,
      unitLabel: product.unitLabel,
      defaultPricePaisa,
      defaultCurrentPricePaisa: product.defaultCurrentPricePaisa ?? null,
      defaultDiscountType: (product.defaultDiscountType ?? "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
      defaultDiscountValue: product.defaultDiscountValue ?? 0,
      weightGrams: product.weightGrams,
      variantCount: product.variants.length,
      onHand: variantRows.reduce((total_, variant) => total_ + variant.onHand, 0),
      available: variantRows.reduce((total_, variant) => total_ + variant.available, 0),
      priceFromPaisa: prices.length > 0 ? Math.min(...prices) : defaultPricePaisa,
      isFeatured: product.isFeatured,
      isPreorderEnabled: product.isPreorderEnabled,
      updatedAt: product.updatedAt,
      image: productImage,
      isWorkingDraft: false,
      // An existing product with an in-progress ProductDraft shows the "unsaved
      // changes" hint in the list.
      hasUnsavedDraft: draftProductIds.has(product.id),
      variants: variantRows,
    };
  });

  return { rows, total };
}

function draftMediaId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.mediaId === "string") return record.mediaId;
  const asset = record.asset;
  if (asset && typeof asset === "object" && typeof (asset as { id?: unknown }).id === "string") {
    return (asset as { id: string }).id;
  }
  if (typeof record.id === "string") return record.id;
  return null;
}

/** Unsaved create-product drafts for the signed-in user, shown in the product list. */
export async function listWorkingDrafts(businessId: string, userId: string): Promise<ProductListRow[]> {
  const drafts = await prisma.productDraft.findMany({
    where: { businessId, userId, productId: null },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, payload: true, updatedAt: true },
  });
  if (drafts.length === 0) return [];

  const thumbs = await catalogThumbs(
    businessId,
    drafts.flatMap((draft) => {
      const payload = (draft.payload ?? {}) as Record<string, unknown>;
      const variants = Array.isArray(payload.variants) ? payload.variants : [];
      return [
        draftMediaId(payload.primaryImage),
        ...variants.map((variant) => (variant && typeof variant === "object" ? (variant as { imageMediaId?: string | null }).imageMediaId : null)),
      ];
    }),
  );

  return drafts.map((draft) => {
    const payload = (draft.payload ?? {}) as Record<string, unknown>;
    const sku = typeof payload.productCode === "string" ? payload.productCode.trim() || null : null;
    const slug = typeof payload.slug === "string" ? payload.slug : "";
    const productImageId = draftMediaId(payload.primaryImage);
    const productImage = productImageId ? (thumbs.get(productImageId) ?? null) : null;
    const rawVariants = Array.isArray(payload.variants) ? payload.variants : [];
    const variants: ProductListVariantRow[] = rawVariants.map((entry, index) => {
      const variant = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      const imageId = typeof variant.imageMediaId === "string" ? variant.imageMediaId : null;
      return {
        id: typeof variant.id === "string" ? variant.id : `draft-${draft.id}-${index}`,
        name: typeof variant.name === "string" && variant.name.trim() ? variant.name : `Variant ${index + 1}`,
        sku,
        optionKey: typeof variant.key === "string" ? variant.key : `draft-${index}`,
        status: "DRAFT",
        pricePaisa: 0,
        priceOverridePaisa: null,
        compareAtPricePaisa: null,
        currentPricePaisa: null,
        discountType: "NONE",
        discountValue: 0,
        costPaisa: null,
        packagingCostPaisa: null,
        weightGrams: null,
        imageMediaId: imageId,
        onHand: 0,
        available: 0,
        attributesSummary: null,
        image: (imageId ? thumbs.get(imageId) : null) ?? productImage,
      };
    });

    return {
      id: draft.id,
      name: draft.name || (typeof payload.name === "string" && payload.name.trim() ? payload.name : "Untitled draft"),
      slug,
      sku,
      status: "DRAFT",
      productType: payload.productType === "VARIABLE" ? "VARIABLE" : "SIMPLE",
      brand: null,
      unitLabel: typeof payload.unitLabel === "string" ? payload.unitLabel : "piece",
      defaultPricePaisa: null,
      defaultCurrentPricePaisa: null,
      defaultDiscountType: "NONE",
      defaultDiscountValue: 0,
      weightGrams: null,
      variantCount: variants.length,
      onHand: 0,
      available: 0,
      priceFromPaisa: null,
      isFeatured: payload.isFeatured === true,
      isPreorderEnabled: payload.isPreorderEnabled === true,
      updatedAt: draft.updatedAt,
      image: productImage,
      isWorkingDraft: true,
      hasUnsavedDraft: false,
      variants,
    };
  });
}

export async function getProductForEdit(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    include: {
      categories: { select: { categoryId: true, isPrimary: true } },
      attributes: { select: { attributeId: true } },
      variants: {
        orderBy: { position: "asc" },
        include: {
          attributeValues: { select: { attributeValueId: true, attributeId: true } },
          inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true, averageCostPaisa: true } },
        },
      },
      priceItems: { select: { priceListId: true, variantId: true, pricePaisa: true, compareAtPricePaisa: true } },
      images: {
        orderBy: { position: "asc" },
        include: {
          media: { select: { id: true, objectKey: true, originalName: true, title: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, usageCount: true, folderId: true, createdAt: true, caption: true } },
        },
      },
    },
  });
  return product;
}

export interface ProductViewVariant {
  id: string;
  name: string;
  barcode: string | null;
  status: string;
  optionKey: string;
  attributesSummary: Record<string, string> | null;
  pricePaisa: number | null;
  priceOverridePaisa: number | null;
  currentPricePaisa: number | null;
  discountType: "PERCENTAGE" | "FLAT" | "NONE";
  discountValue: number;
  /** Variant-level preorder override; `null` inherits the product setting. */
  isPreorderEnabled: boolean | null;
  weightGrams: number | null;
  imageMediaId: string | null;
  image: CatalogImageThumb | null;
}

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: string;
  productType: string;
  brand: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
  isPreorderEnabled: boolean;
  defaultCurrentPricePaisa: number | null;
  defaultDiscountType: "PERCENTAGE" | "FLAT" | "NONE";
  defaultDiscountValue: number;
  weightGrams: number | null;
  image: CatalogImageThumb | null;
  variants: ProductViewVariant[];
}

export async function getProductView(businessId: string, productId: string): Promise<ProductView | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      status: true,
      productType: true,
      brand: true,
      deletedAt: true,
      updatedAt: true,
      isPreorderEnabled: true,
      primaryImageMediaId: true,
      defaultPricePaisa: true,
      defaultCurrentPricePaisa: true,
      defaultDiscountType: true,
      defaultDiscountValue: true,
      weightGrams: true,
      variants: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          barcode: true,
          status: true,
          optionKey: true,
          attributesSummary: true,
          imageMediaId: true,
          isPreorderEnabled: true,
          priceOverridePaisa: true,
          currentPricePaisa: true,
          discountType: true,
          discountValue: true,
          weightGrams: true,
          priceItems: {
            where: { minQuantity: 1 },
            take: 1,
            select: { pricePaisa: true },
          },
        },
      },
    },
  });
  if (!product) return null;

  const thumbs = await catalogThumbs(businessId, [
    product.primaryImageMediaId,
    ...product.variants.map((variant) => variant.imageMediaId),
  ]);
  const productImage = product.primaryImageMediaId ? (thumbs.get(product.primaryImageMediaId) ?? null) : null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    status: product.status,
    productType: product.productType,
    brand: product.brand,
    deletedAt: product.deletedAt,
    updatedAt: product.updatedAt,
    isPreorderEnabled: product.isPreorderEnabled,
    defaultCurrentPricePaisa: product.defaultCurrentPricePaisa ?? null,
    defaultDiscountType: (product.defaultDiscountType ?? "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
    defaultDiscountValue: product.defaultDiscountValue ?? 0,
    weightGrams: product.weightGrams,
    image: productImage,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      barcode: variant.barcode,
      status: variant.status,
      optionKey: variant.optionKey,
      attributesSummary: (variant.attributesSummary as Record<string, string>) || null,
      pricePaisa: variant.priceItems[0]?.pricePaisa ?? variant.priceOverridePaisa ?? product.defaultPricePaisa,
      priceOverridePaisa: variant.priceOverridePaisa,
      currentPricePaisa: variant.currentPricePaisa,
      discountType: (variant.discountType ?? "NONE") as "PERCENTAGE" | "FLAT" | "NONE",
      discountValue: variant.discountValue ?? 0,
      isPreorderEnabled: variant.isPreorderEnabled,
      weightGrams: variant.weightGrams,
      imageMediaId: variant.imageMediaId,
      image: (variant.imageMediaId ? thumbs.get(variant.imageMediaId) : null) ?? productImage,
    })),
  };
}

export async function listCategoryOptions(businessId: string) {
  return prisma.category.findMany({
    where: { businessId, deletedAt: null },
    orderBy: [{ path: "asc" }, { position: "asc" }],
    select: { id: true, name: true, slug: true, path: true, parentId: true, isActive: true, position: true, isFeatured: true, _count: { select: { products: true } } },
  });
}

export async function listAttributes(businessId: string) {
  return prisma.attribute.findMany({
    where: { businessId, deletedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: {
      values: { orderBy: [{ position: "asc" }, { value: "asc" }], select: { id: true, value: true, slug: true, colorHex: true } },
      _count: { select: { productLinks: true } },
    },
  });
}

export async function listPriceLists(businessId: string) {
  const lists = await prisma.priceList.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { priority: "desc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  const storefrontIds = [...new Set(lists.map((list) => list.storefrontId).filter((id): id is string => Boolean(id)))];
  const storefronts =
    storefrontIds.length > 0
      ? await prisma.storefront.findMany({ where: { id: { in: storefrontIds } }, select: { id: true, name: true } })
      : [];
  const names = new Map(storefronts.map((storefront) => [storefront.id, storefront.name]));

  return lists.map((list) => ({
    ...list,
    storefrontName: list.storefrontId ? (names.get(list.storefrontId) ?? null) : null,
  }));
}

export async function getPriceListWithItems(businessId: string, priceListId: string) {
  const priceList = await prisma.priceList.findFirst({ where: { id: priceListId, businessId } });
  if (!priceList) return null;

  const variants = await prisma.variant.findMany({
    where: { product: { businessId, deletedAt: null } },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      priceOverridePaisa: true,
      product: { select: { id: true, name: true, sku: true } },
      priceItems: { where: { priceListId }, select: { pricePaisa: true, compareAtPricePaisa: true } },
    },
  });

  return { priceList, variants };
}
