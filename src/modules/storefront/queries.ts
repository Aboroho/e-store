import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { mediaUrlFor } from "@/modules/media/service";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveImage, effectivePricing, effectivePreorder, loadProductVariantRows } from "@/modules/catalog/variant-pricing";

/**
 * Public storefront queries.
 *
 * One business, one catalogue, one inventory — storefronts differ only by domain,
 * theme, navigation, pages and the price list they price from. Nothing here writes;
 * orders always go through the shared order service.
 */

export interface StorefrontContext {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  themeKey: string;
  themeConfig: Record<string, unknown>;
  supportPhone: string | null;
  supportEmail: string | null;
  addressLine: string | null;
  codEnabled: boolean;
  preorderEnabled: boolean;
  freeDeliveryThresholdPaisa: number | null;
  priceListId: string | null;
  locationId: string | null;
  matchedBy: "domain" | "slug" | "default";
}

/**
 * Resolve the storefront for a Host header.
 *
 * A verified custom domain wins; a sub-domain style host is matched against the
 * storefront slug; otherwise the default active storefront serves the request. No
 * hostname is ever hard-coded — this works the same on localhost, on a preview URL
 * and on the production domain.
 */
export const resolveStorefrontByHost = cache(async (host: string): Promise<StorefrontContext | null> => {
  const normalized = host.split(":")[0]!.toLowerCase().trim();
  if (!normalized) return fallbackStorefront();

  const domain = await prisma.storefrontDomain.findFirst({
    where: { host: normalized, status: "VERIFIED", storefront: { status: "ACTIVE" } },
    include: { storefront: true },
  });
  if (domain) return toContext(domain.storefront, "domain");

  const candidateSlugs = [normalized.split(".")[0] ?? "", normalized.replace(/\./g, "-")];
  const bySlug = await prisma.storefront.findFirst({ where: { slug: { in: candidateSlugs }, status: "ACTIVE" } });
  if (bySlug) return toContext(bySlug, "slug");

  return fallbackStorefront();
});

async function fallbackStorefront(): Promise<StorefrontContext | null> {
  const storefront = await prisma.storefront.findFirst({
    where: { status: "ACTIVE" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return storefront ? toContext(storefront, "default") : null;
}

function toContext(storefront: {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  themeKey: string;
  themeConfig: unknown;
  supportPhone: string | null;
  supportEmail: string | null;
  addressLine: string | null;
  codEnabled: boolean;
  preorderEnabled: boolean;
  freeDeliveryThresholdPaisa: number | null;
  defaultPriceListId: string | null;
  defaultLocationId: string | null;
}, matchedBy: StorefrontContext["matchedBy"]): StorefrontContext {
  return {
    id: storefront.id,
    businessId: storefront.businessId,
    name: storefront.name,
    slug: storefront.slug,
    status: storefront.status,
    description: storefront.description,
    themeKey: storefront.themeKey,
    themeConfig: (storefront.themeConfig as Record<string, unknown> | null) ?? {},
    supportPhone: storefront.supportPhone,
    supportEmail: storefront.supportEmail,
    addressLine: storefront.addressLine,
    codEnabled: storefront.codEnabled,
    preorderEnabled: storefront.preorderEnabled,
    freeDeliveryThresholdPaisa: storefront.freeDeliveryThresholdPaisa,
    priceListId: storefront.defaultPriceListId,
    locationId: storefront.defaultLocationId,
    matchedBy,
  };
}

/**
 * Storefront context by id (used by previews and admin screens that already know which
 * storefront they are working with). Falls back to the default storefront.
 */
export async function storefrontContextById(businessId: string, storefrontId: string | null): Promise<StorefrontContext | null> {
  const storefront = storefrontId
    ? await prisma.storefront.findFirst({ where: { id: storefrontId, businessId } })
    : await prisma.storefront.findFirst({ where: { businessId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!storefront) return fallbackStorefront();
  return toContext(storefront, "default");
}

/** Raise a 404-ish error when no storefront is published at all. */
export function requireStorefront(context: StorefrontContext | null): StorefrontContext {
  if (!context) throw AppError.notFound("No storefront is published yet");
  return context;
}

export interface ProductCard {
  id: string;
  /** Cheapest active variant — what an "add to cart" button on a card adds. */
  variantId: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  imageUrl: string | null;
  imageAlt: string | null;
  available: number;
  isPreorderEnabled: boolean;
  isFeatured: boolean;
  ratingAverage: number | null;
  reviewCount: number;
  badge: string | null;
}

export interface CatalogResult {
  rows: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  categories: Array<{ id: string; name: string; slug: string; productCount: number }>;
  priceRange: { minPaisa: number; maxPaisa: number } | null;
}

export interface CatalogQuery {
  search?: string;
  categorySlug?: string;
  minPricePaisa?: number;
  maxPricePaisa?: number;
  inStockOnly?: boolean;
  sort?: "newest" | "price-asc" | "price-desc" | "name" | "featured";
  page?: number;
  pageSize?: number;
}

/** Small helper: the price a storefront shows for a variant. */
async function priceMapFor(storefront: StorefrontContext, variantIds: string[]): Promise<Map<string, { pricePaisa: number; compareAtPricePaisa: number | null }>> {
  if (variantIds.length === 0) return new Map();
  const items = await prisma.priceListItem.findMany({
    where: {
      variantId: { in: variantIds },
      minQuantity: 1,
      ...(storefront.priceListId ? { priceListId: storefront.priceListId } : { priceList: { businessId: storefront.businessId, isDefault: true } }),
    },
    select: { variantId: true, pricePaisa: true, compareAtPricePaisa: true },
  });
  return new Map(items.map((item) => [item.variantId, { pricePaisa: item.pricePaisa, compareAtPricePaisa: item.compareAtPricePaisa }]));
}

async function availabilityMap(variantIds: string[], locationId: string | null): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const balances = await prisma.inventoryBalance.findMany({
    where: { variantId: { in: variantIds }, ...(locationId ? { locationId } : {}) },
    select: { variantId: true, onHand: true, reserved: true, damaged: true, inspection: true },
  });
  const map = new Map<string, number>();
  for (const balance of balances) {
    const available = balance.onHand - balance.reserved - balance.damaged - balance.inspection;
    map.set(balance.variantId, (map.get(balance.variantId) ?? 0) + available);
  }
  return map;
}

/** Rating summary per product, computed from published reviews only. */
async function ratingMap(productIds: string[]): Promise<Map<string, { average: number | null; count: number }>> {
  if (productIds.length === 0) return new Map();
  const grouped = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, status: "APPROVED" },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(
    grouped.map((row) => {
      const average = row._avg?.rating ?? null;
      return [row.productId, { average: average === null ? null : Number(average.toFixed(2)), count: row._count?._all ?? 0 }] as const;
    }),
  );
}

/** Product cards for a set of products (shared by home, listing and related items). */
export async function productCards(storefront: StorefrontContext, productIds: string[]): Promise<Map<string, ProductCard>> {
  if (productIds.length === 0) return new Map();

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, businessId: storefront.businessId, status: "ACTIVE", deletedAt: null },
    include: {
      variants: { where: { status: "ACTIVE" }, orderBy: { position: "asc" }, select: { id: true, priceOverridePaisa: true, compareAtPricePaisa: true } },
      images: { orderBy: { position: "asc" }, take: 1, include: { media: true } },
    },
  });

  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
  const [prices, availability, ratings] = await Promise.all([
    priceMapFor(storefront, variantIds),
    availabilityMap(variantIds, storefront.locationId),
    ratingMap(products.map((product) => product.id)),
  ]);

  const urlCache = new Map<string, string | null>();
  const resolveUrl = async (key: string, visibility: "PUBLIC" | "PRIVATE") => {
    const cached = urlCache.get(key);
    if (cached !== undefined) return cached;
    const url = await mediaUrlFor({
      objectKey: key,
      visibility: visibility as never,
      originalName: key.split("/").pop() ?? "file",
      extension: (key.split(".").pop() ?? "jpg").toLowerCase(),
    });
    if (url) urlCache.set(key, url);
    return url;
  };

  const cards = new Map<string, ProductCard>();
  for (const product of products) {
    let best: { pricePaisa: number; compareAtPricePaisa: number | null; variantId: string } | null = null;
    let available = 0;
    for (const variant of product.variants) {
      const price = prices.get(variant.id) ?? { pricePaisa: variant.priceOverridePaisa ?? 0, compareAtPricePaisa: variant.compareAtPricePaisa };
      if (!best || price.pricePaisa < best.pricePaisa) {
        best = { pricePaisa: price.pricePaisa, compareAtPricePaisa: price.compareAtPricePaisa, variantId: variant.id };
      }
      available += availability.get(variant.id) ?? 0;
    }
    const image = product.images[0];
    const rating = ratings.get(product.id);
    cards.set(product.id, {
      id: product.id,
      variantId: best?.variantId ?? null,
      name: product.name,
      slug: product.slug,
      shortDescription: product.shortDescription,
      pricePaisa: best?.pricePaisa ?? 0,
      compareAtPricePaisa: best?.compareAtPricePaisa ?? null,
      imageUrl: image ? await resolveUrl(image.media.objectKey, image.media.visibility) : null,
      imageAlt: image?.altText ?? image?.media.altText ?? product.name,
      available,
      isPreorderEnabled: product.isPreorderEnabled && storefront.preorderEnabled,
      isFeatured: product.isFeatured,
      ratingAverage: rating?.average ?? null,
      reviewCount: rating?.count ?? 0,
      badge: available <= 0 ? (product.isPreorderEnabled && storefront.preorderEnabled ? "Preorder" : "Sold out") : null,
    });
  }
  return cards;
}

/** Paginated product listing with search, category and price filters. */
export async function storefrontCatalog(storefront: StorefrontContext, query: CatalogQuery = {}): Promise<CatalogResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(48, Math.max(6, query.pageSize ?? 24));

  const priceFilter = await priceFilteredProductIds(storefront, query);
  const where: Prisma.ProductWhereInput = {
    businessId: storefront.businessId,
    status: "ACTIVE",
    deletedAt: null,
    ...(priceFilter ? { id: { in: priceFilter } } : {}),
    ...(query.categorySlug ? { categories: { some: { category: { slug: query.categorySlug, isActive: true } } } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { shortDescription: { contains: query.search, mode: "insensitive" } },
            { brand: { contains: query.search, mode: "insensitive" } },
            { sku: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sort === "price-asc" || query.sort === "price-desc"
      ? [{ name: "asc" }] // cheap, stable seed order; re-sorted below by real price
      : query.sort === "name"
        ? [{ name: "asc" }]
        : query.sort === "newest"
          ? [{ publishedAt: "desc" }, { createdAt: "desc" }]
          : [{ isFeatured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }];

  const [ids, total, categories] = await Promise.all([
    prisma.product.findMany({ where, orderBy, select: { id: true, publishedAt: true, createdAt: true, isFeatured: true } }),
    prisma.product.count({ where }),
    prisma.category.findMany({
      where: { businessId: storefront.businessId, isActive: true, deletedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, _count: { select: { products: true } } },
    }),
  ]);

  const allCards = await productCards(storefront, ids.map((row) => row.id));
  let rows = ids.map((row) => allCards.get(row.id)).filter((card): card is ProductCard => Boolean(card));

  if (query.sort === "price-asc") rows.sort((a, b) => a.pricePaisa - b.pricePaisa);
  if (query.sort === "price-desc") rows.sort((a, b) => b.pricePaisa - a.pricePaisa);
  if (query.sort === "featured") rows.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));
  if (query.inStockOnly) rows = rows.filter((card) => card.available > 0);
  if (query.categorySlug && query.inStockOnly) rows = rows.filter((card) => card.available > 0);

  const paged = query.inStockOnly ? rows.slice((page - 1) * pageSize, page * pageSize) : rows.slice((page - 1) * pageSize, page * pageSize);
  const prices = rows.map((row) => row.pricePaisa);

  return {
    rows: paged,
    total: query.inStockOnly ? rows.length : total,
    page,
    pageSize,
    categories: categories.map((category) => ({ id: category.id, name: category.name, slug: category.slug, productCount: category._count.products })),
    priceRange: prices.length > 0 ? { minPaisa: Math.min(...prices), maxPaisa: Math.max(...prices) } : null,
  };
}

/** Resolve products whose cheapest storefront price falls inside the requested band. */
async function priceFilteredProductIds(storefront: StorefrontContext, query: CatalogQuery): Promise<string[] | null> {
  if (query.minPricePaisa === undefined && query.maxPricePaisa === undefined) return null;

  const items = await prisma.priceListItem.findMany({
    where: {
      minQuantity: 1,
      variant: { product: { businessId: storefront.businessId, status: "ACTIVE", deletedAt: null } },
      ...(storefront.priceListId ? { priceListId: storefront.priceListId } : { priceList: { businessId: storefront.businessId, isDefault: true } }),
    },
    select: { pricePaisa: true, variant: { select: { productId: true } } },
  });

  const cheapest = new Map<string, number>();
  for (const item of items) {
    const current = cheapest.get(item.variant.productId);
    if (current === undefined || item.pricePaisa < current) cheapest.set(item.variant.productId, item.pricePaisa);
  }

  return [...cheapest.entries()]
    .filter(([, price]) => (query.minPricePaisa === undefined || price >= query.minPricePaisa) && (query.maxPricePaisa === undefined || price <= query.maxPricePaisa))
    .map(([productId]) => productId);
}

/**
 * One sellable row of a product.
 *
 * Every money and eligibility field here was resolved on the server from the
 * inheritance model (variant → attribute value → product default); the browser
 * only ever picks which row it wants and how many.
 */
export interface StorefrontVariant {
  id: string;
  /** The product's SKU — variants share it, they do not own one. */
  sku: string;
  name: string;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  isPreorderEnabled: boolean;
  /** Attribute values this row carries, in attribute order. Used to match a selection. */
  attributeValueIds: string[];
  attributes: Array<{ name: string; value: string }>;
  /** Effective image: variant override → attribute-value default → product primary. */
  imageUrl: string | null;
  imageAlt: string;
  imageSource: "variant" | "attribute" | "product" | "none";
}

const IMAGE_SOURCE_BY_LEVEL = { VARIANT: "variant", ATTRIBUTE: "attribute", PRODUCT: "product", NONE: "none" } as const;

/** A selectable option group on the product page. */
export interface StorefrontProductOption {
  id: string;
  name: string;
  values: Array<{
    id: string;
    value: string;
    colorHex: string | null;
    /** True when at least one in-stock (or preorderable) row offers this value. */
    purchasable: boolean;
  }>;
}

export interface StorefrontProductDetail {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  brand: string | null;
  unitLabel: string;
  isPreorderEnabled: boolean;
  preorderNote: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  categories: Array<{ id: string; name: string; slug: string }>;
  images: Array<{ url: string | null; alt: string }>;
  variants: StorefrontVariant[];
  /** Option groups the shopper picks from, built from the sellable rows only. */
  options: StorefrontProductOption[];
  ratingAverage: number | null;
  reviewCount: number;
  related: ProductCard[];
}

export async function storefrontProduct(storefront: StorefrontContext, slug: string): Promise<StorefrontProductDetail | null> {
  const full = await prisma.product.findFirst({
    where: { businessId: storefront.businessId, slug, status: "ACTIVE", deletedAt: null },
    include: {
      categories: { include: { category: true } },
      images: { orderBy: { position: "asc" }, include: { media: true } },
    },
  });
  if (!full) return null;

  /*
   * Variants, prices, images and preorder eligibility all come from the shared
   * inheritance resolver, never from the browser: the shopper's device chooses a
   * combination, the server decides what it costs and whether it can be bought.
   */
  const rows = await loadProductVariantRows(prisma, { productId: full.id });
  const [availability, rating, channelPrices] = await Promise.all([
    availabilityMap(rows.map((row) => row.id), storefront.locationId),
    ratingMap([full.id]),
    priceMapFor(storefront, rows.map((row) => row.id)),
  ]);

  const relatedIds = (
    await prisma.product.findMany({
      where: {
        businessId: storefront.businessId,
        status: "ACTIVE",
        deletedAt: null,
        id: { not: full.id },
        ...(full.categories.length > 0 ? { categories: { some: { categoryId: { in: full.categories.map((entry) => entry.categoryId) } } } } : {}),
      },
      take: 4,
      orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
      select: { id: true },
    })
  ).map((row) => row.id);
  const relatedCards = await productCards(storefront, relatedIds);

  const images = await Promise.all(
    full.images.map(async (image) => ({
      url: await mediaUrlFor({
        objectKey: image.media.objectKey,
        visibility: image.media.visibility,
        originalName: image.media.originalName,
        extension: image.media.extension,
      }),
      alt: image.altText ?? image.media.altText ?? full.name,
    })),
  );

  // One URL per media id, resolved once — a product with 30 variants must not
  // ask the storage layer 30 times for the same image.
  const mediaIds = new Set<string>();
  for (const row of rows) {
    const resolved = effectiveImage(row);
    if (resolved.value) mediaIds.add(resolved.value);
  }
  const urlByMediaId = new Map<string, string | null>();
  await Promise.all(
    [...mediaIds].map(async (mediaId) => {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: mediaId },
        select: { objectKey: true, visibility: true, originalName: true, extension: true, altText: true },
      });
      if (!asset) {
        urlByMediaId.set(mediaId, null);
        return;
      }
      urlByMediaId.set(
        mediaId,
        await mediaUrlFor({
          objectKey: asset.objectKey,
          visibility: asset.visibility,
          originalName: asset.originalName,
          extension: asset.extension,
        }),
      );
    }),
  );

  const storefrontAllowsPreorder = storefront.preorderEnabled && full.isPreorderEnabled;

  const variants: StorefrontVariant[] = rows.map((row) => {
    const pricing = effectivePricing(row);
    const image = effectiveImage(row);
    const channel = channelPrices.get(row.id);
    const available = Math.max(0, availability.get(row.id) ?? 0);
    return {
      id: row.id,
      sku: full.sku ?? "",
      name: row.name,
      // A channel price list still wins where one is configured; otherwise the
      // inherited price is the price.
      pricePaisa: channel?.pricePaisa ?? pricing.value.pricePaisa,
      compareAtPricePaisa: channel?.compareAtPricePaisa ?? pricing.value.compareAtPricePaisa,
      available,
      isPreorderEnabled: effectivePreorder(row, { storefrontEnabled: storefrontAllowsPreorder }),
      attributeValueIds: row.attributeValues.map((link) => link.attributeValue.id),
      attributes: row.attributeValues.map((link) => ({ name: link.attribute.name, value: link.attributeValue.value })),
      imageUrl: image.value ? urlByMediaId.get(image.value) ?? null : null,
      imageAlt: `${full.name} — ${row.name}`,
      imageSource: image.value ? IMAGE_SOURCE_BY_LEVEL[image.level] : "none",
    };
  });

  /* Option groups: every attribute that actually distinguishes a sellable row. */
  const optionMap = new Map<string, StorefrontProductOption>();
  for (const row of rows) {
    for (const link of row.attributeValues) {
      const group = optionMap.get(link.attribute.id) ?? { id: link.attribute.id, name: link.attribute.name, values: [] };
      if (!group.values.some((value) => value.id === link.attributeValue.id)) {
        group.values.push({ id: link.attributeValue.id, value: link.attributeValue.value, colorHex: null, purchasable: false });
      }
      optionMap.set(link.attribute.id, group);
    }
  }
  for (const variant of variants) {
    if (variant.available > 0 || variant.isPreorderEnabled) {
      for (const valueId of variant.attributeValueIds) {
        for (const group of optionMap.values()) {
          const value = group.values.find((entry) => entry.id === valueId);
          if (value) value.purchasable = true;
        }
      }
    }
  }

  return {
    id: full.id,
    name: full.name,
    slug: full.slug,
    shortDescription: full.shortDescription,
    description: full.description,
    brand: full.brand,
    unitLabel: full.unitLabel,
    isPreorderEnabled: storefrontAllowsPreorder,
    preorderNote: full.preorderNote,
    seoTitle: full.seoTitle,
    seoDescription: full.seoDescription,
    categories: full.categories.map((entry) => ({ id: entry.category.id, name: entry.category.name, slug: entry.category.slug })),
    images,
    variants,
    options: [...optionMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ratingAverage: rating.get(full.id)?.average ?? null,
    reviewCount: rating.get(full.id)?.count ?? 0,
    related: [...relatedCards.values()],
  };
}

/** Published reviews of a product, newest first. */
export async function productReviews(productId: string, limit = 20) {
  const reviews = await prisma.review.findMany({
    where: { productId, status: "APPROVED" },
    orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      images: { orderBy: { position: "asc" }, include: { media: true } },
      customer: { select: { name: true } },
    },
  });

  return Promise.all(
    reviews.map(async (review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      verifiedPurchase: review.verifiedPurchase,
      helpfulCount: review.helpfulCount,
      createdAt: review.createdAt,
      authorName: review.customer?.name?.split(" ")[0] ?? "Customer",
      images: await Promise.all(
        review.images.map((image) =>
          mediaUrlFor({
            objectKey: image.media.objectKey,
            visibility: image.media.visibility,
            originalName: image.media.originalName,
            extension: image.media.extension,
          }),
        ),
      ),
    })),
  );
}

export async function reviewSummary(productId: string) {
  const grouped = await prisma.review.groupBy({
    by: ["rating"],
    where: { productId, status: "APPROVED" },
    _count: { _all: true },
  });
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const row of grouped) {
    const count = row._count?._all ?? 0;
    distribution[row.rating] = count;
    total += count;
    sum += row.rating * count;
  }
  return { total, average: total > 0 ? Number((sum / total).toFixed(2)) : null, distribution };
}

/** Home page sections: featured products, new arrivals and category tiles. */
export async function storefrontHome(storefront: StorefrontContext) {
  const [featured, newest, categories, homepage] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: storefront.businessId, status: "ACTIVE", deletedAt: null, isFeatured: true },
      orderBy: { publishedAt: "desc" },
      take: 8,
      select: { id: true },
    }),
    prisma.product.findMany({
      where: { businessId: storefront.businessId, status: "ACTIVE", deletedAt: null },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: { id: true },
    }),
    prisma.category.findMany({
      where: { businessId: storefront.businessId, isActive: true, deletedAt: null, isFeatured: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      take: 6,
      select: { id: true, name: true, slug: true, imageMediaId: true, _count: { select: { products: true } } },
    }),
    prisma.page.findFirst({
      where: { businessId: storefront.businessId, storefrontId: storefront.id, isHomepage: true, status: "PUBLISHED", deletedAt: null },
      select: { id: true, title: true, publishedVersionId: true, currentVersion: true },
    }),
  ]);

  const cards = await productCards(storefront, [...new Set([...featured, ...newest].map((row) => row.id))]);

  const categoryTiles = await Promise.all(
    categories.map(async (category) => {
      const media = category.imageMediaId
        ? await prisma.mediaAsset.findFirst({ where: { id: category.imageMediaId }, select: { objectKey: true, visibility: true, originalName: true, extension: true } })
        : null;
      return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        productCount: category._count.products,
        imageUrl: media
          ? await mediaUrlFor({ objectKey: media.objectKey, visibility: media.visibility, originalName: media.originalName, extension: media.extension })
          : null,
      };
    }),
  );

  return {
    featured: featured.map((row) => cards.get(row.id)).filter((card): card is ProductCard => Boolean(card)),
    newest: newest.map((row) => cards.get(row.id)).filter((card): card is ProductCard => Boolean(card)),
    categories: categoryTiles,
    homepagePageId: homepage?.id ?? null,
    totalProducts: await prisma.product.count({ where: { businessId: storefront.businessId, status: "ACTIVE", deletedAt: null } }),
  };
}

/** Navigation tree for a storefront handle (`main`, `footer`, …). */
export async function storefrontNavigation(storefrontId: string, handle = "main") {
  const menu = await prisma.navigationMenu.findFirst({
    where: { storefrontId, handle, isActive: true },
    include: {
      items: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        include: { page: { select: { slug: true } }, children: { where: { isActive: true }, orderBy: { position: "asc" }, include: { page: { select: { slug: true } } } } },
      },
    },
  });
  if (!menu) return { id: null, name: handle, items: [] as Array<NavItem> };

  const roots = menu.items.filter((item) => item.parentId === null);
  return {
    id: menu.id,
    name: menu.name,
    items: roots.map((item) => ({
      id: item.id,
      label: item.label,
      url: resolveNavUrl(item),
      openInNewTab: item.openInNewTab,
      children: item.children.map((child) => ({ id: child.id, label: child.label, url: resolveNavUrl(child), openInNewTab: child.openInNewTab, children: [] })),
    })),
  };
}

export interface NavItem {
  id: string;
  label: string;
  url: string;
  openInNewTab: boolean;
  children: NavItem[];
}

function resolveNavUrl(item: { type: string; url: string | null; page: { slug: string } | null; categoryId: string | null; productId: string | null }): string {
  if (item.type === "PAGE" && item.page) return `/pages/${item.page.slug}`;
  if (item.type === "CATEGORY" && item.categoryId) return `/products?category=${item.categoryId}`;
  if (item.type === "PRODUCT" && item.productId) return `/products/${item.productId}`;
  return item.url && item.url.startsWith("/") ? item.url : "/";
}

/** A published CMS page and its rendered document. */
export async function publishedPage(storefront: StorefrontContext, slug: string) {
  const page = await prisma.page.findFirst({
    where: { businessId: storefront.businessId, storefrontId: storefront.id, slug, status: "PUBLISHED", deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!page) return null;
  const version = page.publishedVersionId ? await prisma.pageVersion.findFirst({ where: { id: page.publishedVersionId } }) : page.versions[0];
  if (!version) return null;
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    canonicalUrl: page.canonicalUrl,
    robots: page.robots,
    document: version.document as unknown,
  };
}

/** Published pages for the sitemap. */
export async function publishedPageSlugs(storefrontId: string) {
  return prisma.page.findMany({
    where: { storefrontId, status: "PUBLISHED", deletedAt: null },
    select: { slug: true, updatedAt: true, isHomepage: true },
    orderBy: { slug: "asc" },
  });
}

export async function storefrontDomains(storefrontId: string) {
  return prisma.storefrontDomain.findMany({ where: { storefrontId }, orderBy: [{ isPrimary: "desc" }, { host: "asc" }] });
}

export async function storefrontSettingsFor(storefrontId: string) {
  const rows = await prisma.storefrontSetting.findMany({ where: { storefrontId } });
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
}

/** Admin summary of every storefront of a business. */
export interface StorefrontSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDefault: boolean;
  themeKey: string;
  themeConfig: Record<string, unknown>;
  domainCount: number;
  pageCount: number;
  reviewCount: number;
}

export const listStorefrontSummaries = cache(async (businessId: string): Promise<StorefrontSummary[]> => {
  const storefronts = await prisma.storefront.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { domains: true, pages: true, reviews: true } } },
  });

  return storefronts.map((storefront) => ({
    id: storefront.id,
    name: storefront.name,
    slug: storefront.slug,
    status: storefront.status,
    isDefault: storefront.isDefault,
    themeKey: storefront.themeKey,
    themeConfig: (storefront.themeConfig as Record<string, unknown> | null) ?? {},
    domainCount: storefront._count.domains,
    pageCount: storefront._count.pages,
    reviewCount: storefront._count.reviews,
  }));
});

/** Full storefront record for the management screen. */
export async function getStorefront(businessId: string, storefrontId: string) {
  const storefront = await prisma.storefront.findFirst({
    where: { id: storefrontId, businessId },
    include: {
      domains: { orderBy: [{ isPrimary: "desc" }, { host: "asc" }] },
      navigationMenus: { include: { items: { orderBy: { position: "asc" } } } },
    },
  });
  if (!storefront) throw AppError.notFound("Storefront not found");
  return storefront;
}
