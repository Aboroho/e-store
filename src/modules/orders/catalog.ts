import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { mediaUrlFor } from "@/modules/media/service";
import {
  effectiveImage,
  effectivePreorder,
  effectivePricing,
  loadProductVariantRows,
  resolveVariantByAttributes,
} from "@/modules/catalog/variant-pricing";

/**
 * Server-side variant resolution for order taking.
 *
 * The storefront and the manual order screen use the same helpers: the operator
 * picks a product and its attribute values, and the server decides which variant
 * that is, what it costs, how much is available and whether the shortfall may be
 * preordered. Nothing about price, stock or preorder eligibility is accepted from
 * the browser — the client only reports the selection.
 */

export interface OrderCatalogVariant {
  id: string;
  name: string;
  /** Attribute values this row carries; the selection is matched against it. */
  attributeValueIds: string[];
  attributes: Array<{ name: string; value: string }>;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  isPreorderEnabled: boolean;
  imageUrl: string | null;
  imageSource: "variant" | "attribute" | "product" | "none";
}

export interface OrderCatalogOption {
  id: string;
  name: string;
  values: Array<{ id: string; value: string; colorHex: string | null }>;
}

export interface OrderCatalogProduct {
  id: string;
  name: string;
  sku: string;
  unitLabel: string;
  options: OrderCatalogOption[];
  variants: OrderCatalogVariant[];
}

const IMAGE_SOURCE_BY_LEVEL = { VARIANT: "variant", ATTRIBUTE: "attribute", PRODUCT: "product", NONE: "none" } as const;

async function urlForMediaIds(mediaIds: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(mediaIds.filter(Boolean))];
  const map = new Map<string, string | null>();
  if (unique.length === 0) return map;
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: unique } },
    select: { id: true, objectKey: true, visibility: true, originalName: true, extension: true },
  });
  await Promise.all(
    assets.map(async (asset) => {
      map.set(
        asset.id,
        await mediaUrlFor({
          objectKey: asset.objectKey,
          visibility: asset.visibility,
          originalName: asset.originalName,
          extension: asset.extension,
        }),
      );
    }),
  );
  return map;
}

async function availabilityByIds(variantIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (variantIds.length === 0) return map;
  const balances = await prisma.inventoryBalance.findMany({
    where: { variantId: { in: variantIds } },
    select: { variantId: true, onHand: true, reserved: true, damaged: true, inspection: true },
  });
  for (const balance of balances) {
    const available = Math.max(0, balance.onHand - balance.reserved - balance.damaged - balance.inspection);
    map.set(balance.variantId, (map.get(balance.variantId) ?? 0) + available);
  }
  return map;
}

/**
 * Products a staff member can sell, with every variant resolved on the server.
 *
 * Archived and deleted products are excluded: an order line must always point at
 * a row the catalogue still offers.
 */
export async function loadOrderCatalog(
  businessId: string,
  options: { take?: number; priceListId?: string | null } = {},
): Promise<OrderCatalogProduct[]> {
  const products = await prisma.product.findMany({
    where: { businessId, status: "ACTIVE", deletedAt: null },
    orderBy: { name: "asc" },
    take: options.take ?? 200,
    select: { id: true, name: true, sku: true, unitLabel: true },
  });

  const rowsByProduct = await Promise.all(
    products.map(async (product) => ({ product, rows: await loadProductVariantRows(prisma, { productId: product.id }) })),
  );

  const allVariantIds = rowsByProduct.flatMap((entry) => entry.rows.map((row) => row.id));
  const [availability, channels] = await Promise.all([
    availabilityByIds(allVariantIds),
    prisma.priceListItem.findMany({
      where: {
        minQuantity: 1,
        variantId: { in: allVariantIds },
        priceList: options.priceListId ? { businessId, id: options.priceListId } : { businessId, isDefault: true },
      },
      select: { variantId: true, pricePaisa: true, compareAtPricePaisa: true },
    }),
  ]);
  const channelPrice = new Map(channels.map((item) => [item.variantId, item]));

  const mediaIds: string[] = [];
  for (const entry of rowsByProduct) {
    for (const row of entry.rows) {
      const image = effectiveImage(row);
      if (image.value) mediaIds.push(image.value);
    }
  }
  const urls = await urlForMediaIds(mediaIds);

  return rowsByProduct.map(({ product, rows }) => {
    const optionMap = new Map<string, OrderCatalogOption>();
    const variants: OrderCatalogVariant[] = rows.map((row) => {
      const pricing = effectivePricing(row);
      const image = effectiveImage(row);
      const channel = channelPrice.get(row.id);
      for (const link of row.attributeValues) {
        const group = optionMap.get(link.attribute.id) ?? { id: link.attribute.id, name: link.attribute.name, values: [] };
        if (!group.values.some((value) => value.id === link.attributeValue.id)) {
          group.values.push({ id: link.attributeValue.id, value: link.attributeValue.value, colorHex: null });
        }
        optionMap.set(link.attribute.id, group);
      }
      return {
        id: row.id,
        name: row.name,
        attributeValueIds: row.attributeValues.map((link) => link.attributeValue.id),
        attributes: row.attributeValues.map((link) => ({ name: link.attribute.name, value: link.attributeValue.value })),
        pricePaisa: channel?.pricePaisa ?? pricing.value.pricePaisa,
        compareAtPricePaisa: channel?.compareAtPricePaisa ?? pricing.value.compareAtPricePaisa,
        available: availability.get(row.id) ?? 0,
        isPreorderEnabled: effectivePreorder(row),
        imageUrl: image.value ? urls.get(image.value) ?? null : null,
        imageSource: image.value ? IMAGE_SOURCE_BY_LEVEL[image.level] : "none",
      };
    });

    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? "",
      unitLabel: product.unitLabel,
      options: [...optionMap.values()],
      variants,
    };
  });
}

/**
 * Resolve one selection into a variant, with everything the order line needs.
 *
 * `reserveUnits` is what physical stock covers and `preorderUnits` the shortfall
 * that becomes a preorder commitment — the same split the order service applies,
 * so what the operator sees before submitting is what the order will do.
 */
export async function resolveVariantForOrder(
  businessId: string,
  input: { productId: string; attributeValueIds: string[]; quantity?: number; priceListId?: string | null },
): Promise<{
  variantId: string;
  name: string;
  optionKey: string | null;
  sku: string;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  quantity: number;
  reserveUnits: number;
  preorderUnits: number;
  isPreorderAllowed: boolean;
  imageUrl: string | null;
  attributes: Array<{ name: string; value: string }>;
}> {
  const owned = await prisma.product.findFirst({
    where: { id: input.productId, businessId, deletedAt: null },
    select: { id: true, sku: true, isPreorderEnabled: true },
  });
  if (!owned) throw AppError.notFound("Product not found");

  const row = await resolveVariantByAttributes(prisma, { productId: input.productId, attributeValueIds: input.attributeValueIds });
  if (!row || row.productId !== input.productId) throw AppError.validation("That combination is not available for this product");

  const [availability, priceItem] = await Promise.all([
    availabilityByIds([row.id]),
    prisma.priceListItem.findFirst({
      where: {
        variantId: row.id,
        minQuantity: { lte: Math.max(1, Math.floor(Number(input.quantity) || 1)) },
        priceList: input.priceListId ? { businessId, id: input.priceListId } : { businessId, isDefault: true },
      },
      orderBy: { minQuantity: "desc" },
      select: { pricePaisa: true, compareAtPricePaisa: true },
    }),
  ]);
  const pricing = effectivePricing(row);
  const image = effectiveImage(row);
  const urls = image.value ? await urlForMediaIds([image.value]) : new Map<string, string | null>();

  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const available = Math.max(0, availability.get(row.id) ?? 0);
  const reserveUnits = Math.min(available, quantity);
  const preorderUnits = Math.max(0, quantity - available);
  const isPreorderAllowed = effectivePreorder(row);

  return {
    variantId: row.id,
    name: row.name,
    optionKey: row.optionKey ?? null,
    sku: owned.sku ?? "",
    pricePaisa: priceItem?.pricePaisa ?? pricing.value.pricePaisa,
    compareAtPricePaisa: priceItem?.compareAtPricePaisa ?? pricing.value.compareAtPricePaisa,
    available,
    quantity,
    reserveUnits,
    preorderUnits,
    isPreorderAllowed,
    imageUrl: image.value ? urls.get(image.value) ?? null : null,
    attributes: row.attributeValues.map((link) => ({ name: link.attribute.name, value: link.attributeValue.value })),
  };
}


// --------------------------------------------------------------------- search

export interface OrderCatalogSearchProduct extends OrderCatalogProduct {
  productType: "SIMPLE" | "VARIABLE";
  brand: string | null;
  barcode: string | null;
  unitLabel: string;
  totalAvailable: number;
  cheapestPricePaisa: number | null;
}

/**
 * Server-backed product search for the manual order screen.
 *
 * Only the matched page of products is loaded (never the whole catalogue), and
 * every price, image and availability figure is resolved here — the browser sends
 * a search string and nothing else. `priceListId` carries the creator's sales
 * context, so a reseller sees their own negotiated prices.
 */
export async function searchOrderCatalog(
  businessId: string,
  options: { query?: string; take?: number; priceListId?: string | null } = {},
): Promise<OrderCatalogSearchProduct[]> {
  const take = Math.min(25, Math.max(1, options.take ?? 8));
  const term = (options.query ?? "").trim();

  const products = await prisma.product.findMany({
    where: {
      businessId,
      deletedAt: null,
      status: "ACTIVE",
      ...(term.length >= 1
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { sku: { contains: term, mode: "insensitive" } },
              { brand: { contains: term, mode: "insensitive" } },
              { barcode: { contains: term, mode: "insensitive" } },
              { variants: { some: { deletedAt: null, optionKey: { contains: term, mode: "insensitive" } } } },
              { variants: { some: { deletedAt: null, barcode: { contains: term, mode: "insensitive" } } } },
              { variants: { some: { deletedAt: null, name: { contains: term, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
    take,
    select: { id: true, name: true, sku: true, unitLabel: true, productType: true, brand: true, barcode: true },
  });
  if (products.length === 0) return [];

  const rowsByProduct = await Promise.all(
    products.map(async (product) => ({ product, rows: await loadProductVariantRows(prisma, { productId: product.id }) })),
  );

  const allVariantIds = rowsByProduct.flatMap((entry) => entry.rows.map((row) => row.id));
  const [availability, channelPrices] = await Promise.all([
    availabilityByIds(allVariantIds),
    options.priceListId
      ? prisma.priceListItem.findMany({
          where: { minQuantity: 1, variantId: { in: allVariantIds }, priceList: { businessId, id: options.priceListId } },
          orderBy: { minQuantity: "asc" },
          select: { variantId: true, pricePaisa: true, compareAtPricePaisa: true },
        })
      : Promise.resolve([] as Array<{ variantId: string; pricePaisa: number; compareAtPricePaisa: number | null }>),
  ]);
  const channelPrice = new Map(channelPrices.map((item) => [item.variantId, item]));

  const mediaIds: string[] = [];
  for (const entry of rowsByProduct) {
    for (const row of entry.rows) {
      const image = effectiveImage(row);
      if (image.value) mediaIds.push(image.value);
    }
  }
  const urls = await urlForMediaIds(mediaIds);

  return rowsByProduct.map(({ product, rows }) => {
    const optionMap = new Map<string, OrderCatalogOption>();
    const variants: OrderCatalogVariant[] = rows.map((row) => {
      const pricing = effectivePricing(row);
      const image = effectiveImage(row);
      const channel = channelPrice.get(row.id);
      for (const link of row.attributeValues) {
        const group = optionMap.get(link.attribute.id) ?? { id: link.attribute.id, name: link.attribute.name, values: [] };
        if (!group.values.some((value) => value.id === link.attributeValue.id)) {
          group.values.push({ id: link.attributeValue.id, value: link.attributeValue.value, colorHex: null });
        }
        optionMap.set(link.attribute.id, group);
      }
      return {
        id: row.id,
        name: row.name,
        attributeValueIds: row.attributeValues.map((link) => link.attributeValue.id),
        attributes: row.attributeValues.map((link) => ({ name: link.attribute.name, value: link.attributeValue.value })),
        pricePaisa: channel?.pricePaisa ?? pricing.value.pricePaisa,
        compareAtPricePaisa: channel?.compareAtPricePaisa ?? pricing.value.compareAtPricePaisa,
        available: availability.get(row.id) ?? 0,
        isPreorderEnabled: effectivePreorder(row),
        imageUrl: image.value ? (urls.get(image.value) ?? null) : null,
        imageSource: image.value ? IMAGE_SOURCE_BY_LEVEL[image.level] : "none",
      };
    });

    const prices = variants.map((variant) => variant.pricePaisa).filter((price) => price > 0);
    return {
      id: product.id,
      name: product.name,
      sku: product.sku ?? "",
      unitLabel: product.unitLabel,
      productType: product.productType,
      brand: product.brand,
      barcode: product.barcode,
      options: [...optionMap.values()],
      variants,
      totalAvailable: variants.reduce((total, variant) => total + Math.max(0, variant.available), 0),
      cheapestPricePaisa: prices.length > 0 ? Math.min(...prices) : null,
    };
  });
}
