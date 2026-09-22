import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { calculatePricing, normalizeDiscount, type DiscountType } from "@/modules/catalog/pricing-rules";
import { resolveImage, resolvePricing, type ResolvedImage, type ResolvedPricing } from "@/modules/catalog/inheritance";

/**
 * Server-side effective-value resolution for one variant.
 *
 * The editor, the product list, the bulk actions, the storefront, the cart and
 * the order service all call these functions, so the price a merchandiser sees,
 * the price the API returns and the price an order is charged with are the same
 * number — resolved here from the database, never from the browser.
 */

export interface VariantPricingRow {
  id: string;
  productId: string;
  currentPricePaisa: number | null;
  discountType: DiscountType;
  discountValue: number;
  priceOverridePaisa: number | null;
  compareAtPricePaisa: number | null;
  attributeValues: Array<{
    attributeValue: {
      id: string;
      value: string;
      mediaId: string | null;
      currentPricePaisa: number | null;
      discountType: DiscountType;
      discountValue: number;
      priceOverridePaisa: number | null;
    };
    attribute: { id: string; name: string; position: number };
  }>;
  product: {
    id: string;
    defaultCurrentPricePaisa: number | null;
    defaultDiscountType: DiscountType;
    defaultDiscountValue: number;
    defaultPricePaisa: number | null;
    defaultCompareAtPricePaisa: number | null;
    defaultCostPaisa: number | null;
    isPreorderEnabled: boolean;
    weightGrams: number | null;
    packagingCostPaisa: number;
    images: Array<{ mediaId: string }>;
  };
  imageMediaId: string | null;
  isPreorderEnabled: boolean | null;
  weightGrams: number | null;
  packagingCostPaisa: number | null;
  costPaisa: number | null;
  optionKey: string;
  name: string;
  sku: string | null;
}

const VARIANT_PRICING_SELECT = {
  id: true,
  productId: true,
  currentPricePaisa: true,
  discountType: true,
  discountValue: true,
  priceOverridePaisa: true,
  compareAtPricePaisa: true,
  imageMediaId: true,
  isPreorderEnabled: true,
  weightGrams: true,
  packagingCostPaisa: true,
  costPaisa: true,
  optionKey: true,
  name: true,
  sku: true,
  attributeValues: {
    orderBy: { attribute: { position: "asc" } },
    select: {
      attribute: { select: { id: true, name: true, position: true } },
      attributeValue: {
        select: {
          id: true,
          value: true,
          mediaId: true,
          currentPricePaisa: true,
          discountType: true,
          discountValue: true,
          priceOverridePaisa: true,
        },
      },
    },
  },
  product: {
    select: {
      id: true,
      defaultCurrentPricePaisa: true,
      defaultDiscountType: true,
      defaultDiscountValue: true,
      defaultPricePaisa: true,
      defaultCompareAtPricePaisa: true,
      defaultCostPaisa: true,
      isPreorderEnabled: true,
      weightGrams: true,
      packagingCostPaisa: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { mediaId: true } },
    },
  },
} satisfies Prisma.VariantSelect;

/** Load one variant with everything the inheritance model needs. */
/** Load every variant of a product with everything the inheritance model needs. */
export async function loadProductVariantRows(
  client: Prisma.TransactionClient | typeof prisma,
  input: { productId: string; activeOnly?: boolean },
): Promise<VariantPricingRow[]> {
  const rows = await client.variant.findMany({
    where: {
      productId: input.productId,
      deletedAt: null,
      ...(input.activeOnly === false ? {} : { status: "ACTIVE" as const }),
    },
    orderBy: { position: "asc" },
    select: VARIANT_PRICING_SELECT,
  });
  return rows as unknown as VariantPricingRow[];
}

export async function loadVariantPricingRow(
  client: Prisma.TransactionClient | typeof prisma,
  variantId: string,
): Promise<VariantPricingRow> {
  const row = await client.variant.findUnique({ where: { id: variantId }, select: VARIANT_PRICING_SELECT });
  if (!row) throw AppError.notFound("Variant not found");
  return row as unknown as VariantPricingRow;
}

/** Resolve the effective price of a variant straight from the database. */
export function effectivePricing(row: VariantPricingRow): ResolvedPricing {
  return resolvePricing({
    productDefault: {
      currentPricePaisa: row.product.defaultCurrentPricePaisa,
      discountType: row.product.defaultDiscountType,
      discountValue: row.product.defaultDiscountValue,
      pricePaisa: row.product.defaultPricePaisa,
      compareAtPricePaisa: row.product.defaultCompareAtPricePaisa,
    },
    attributeValues: row.attributeValues.map((link) => ({
      attributeValueId: link.attributeValue.id,
      attributeName: link.attribute.name,
      valueLabel: link.attributeValue.value,
      value: {
        currentPricePaisa: link.attributeValue.currentPricePaisa,
        discountType: link.attributeValue.discountType,
        discountValue: link.attributeValue.discountValue,
        pricePaisa: link.attributeValue.priceOverridePaisa,
      },
    })),
    variantOverride: {
      currentPricePaisa: row.currentPricePaisa,
      discountType: row.discountType,
      discountValue: row.discountValue,
      pricePaisa: row.priceOverridePaisa,
      compareAtPricePaisa: row.compareAtPricePaisa,
    },
  });
}

/** Resolve the effective image of a variant straight from the database. */
export function effectiveImage(row: VariantPricingRow): ResolvedImage {
  return resolveImage({
    variantImageMediaId: row.imageMediaId,
    attributeValues: row.attributeValues.map((link) => ({
      attributeValueId: link.attributeValue.id,
      attributeName: link.attribute.name,
      valueLabel: link.attributeValue.value,
      value: link.attributeValue.mediaId,
    })),
    productImageMediaId: row.product.images[0]?.mediaId ?? null,
  });
}

/** Effective preorder eligibility: variant override wins over the product default. */
export function effectivePreorder(row: VariantPricingRow, options: { storefrontEnabled?: boolean } = {}): boolean {
  const value = row.isPreorderEnabled ?? row.product.isPreorderEnabled;
  return Boolean(value) && options.storefrontEnabled !== false;
}

/** Effective weight in grams: variant override wins over the product default. */
export function effectiveWeight(row: VariantPricingRow): number | null {
  return row.weightGrams ?? row.product.weightGrams ?? null;
}

/** Effective packaging cost: variant override wins over the product default. */
export function effectivePackagingCost(row: VariantPricingRow): number {
  return row.packagingCostPaisa ?? row.product.packagingCostPaisa ?? 0;
}

/**
 * Recompute and persist the variant's row in the business default price list.
 *
 * The default price list is the channel-agnostic price the storefront and the
 * manual order screen fall back to; channel-specific lists (reseller,
 * storefront) keep their own rows and are never overwritten here.
 */
export async function syncVariantPriceListItem(
  client: Prisma.TransactionClient,
  input: { businessId: string; productId: string; variantId: string },
): Promise<{ pricePaisa: number; compareAtPricePaisa: number | null; source: string }> {
  const [priceList, row] = await Promise.all([
    client.priceList.findFirst({ where: { businessId: input.businessId, isDefault: true }, select: { id: true } }),
    loadVariantPricingRow(client, input.variantId),
  ]);
  if (!priceList) return { pricePaisa: 0, compareAtPricePaisa: null, source: "NONE" };

  const resolved = effectivePricing(row);
  if (resolved.value.pricePaisa <= 0) {
    await client.priceListItem.deleteMany({ where: { priceListId: priceList.id, variantId: input.variantId, minQuantity: 1 } });
    return { pricePaisa: 0, compareAtPricePaisa: null, source: "NONE" };
  }

  await client.priceListItem.upsert({
    where: { priceListId_variantId_minQuantity: { priceListId: priceList.id, variantId: input.variantId, minQuantity: 1 } },
    create: {
      priceListId: priceList.id,
      variantId: input.variantId,
      productId: input.productId,
      pricePaisa: resolved.value.pricePaisa,
      compareAtPricePaisa: resolved.value.compareAtPricePaisa,
    },
    update: { pricePaisa: resolved.value.pricePaisa, compareAtPricePaisa: resolved.value.compareAtPricePaisa },
  });
  return { pricePaisa: resolved.value.pricePaisa, compareAtPricePaisa: resolved.value.compareAtPricePaisa, source: resolved.level };
}

/**
 * Resolve a variant by its attribute selection.
 *
 * Used by the storefront and the manual order screen: the caller picks values
 * ("Colour = Black", "Size = XL") and the server returns the one variant that
 * carries exactly that combination — never a guess, never a partial match.
 */
export async function resolveVariantByAttributes(
  client: Prisma.TransactionClient | typeof prisma,
  input: { productId: string; attributeValueIds: string[] },
): Promise<VariantPricingRow | null> {
  const wanted = [...new Set(input.attributeValueIds.filter(Boolean))].sort();
  if (wanted.length === 0) return null;

  const candidates = await client.variant.findMany({
    where: {
      productId: input.productId,
      status: "ACTIVE",
      deletedAt: null,
      attributeValues: { some: { attributeValueId: { in: wanted } } },
    },
    select: { id: true, attributeValues: { select: { attributeValueId: true } } },
  });

  const exact = candidates.find((candidate) => {
    const owned = candidate.attributeValues.map((link) => link.attributeValueId).sort();
    return owned.length === wanted.length && owned.every((id, index) => id === wanted[index]);
  });
  if (!exact) return null;
  return loadVariantPricingRow(client, exact.id);
}

/** Recalculate a discount triple into a sell price (integer paisa). */
export function sellPriceFrom(input: {
  currentPricePaisa?: number | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
}): number {
  const discount = normalizeDiscount(input);
  const current = Math.max(0, Math.round(Number(input.currentPricePaisa ?? 0) || 0));
  return calculatePricing({ currentPricePaisa: current, discountType: discount.discountType, discountValue: discount.discountValue })
    .sellPricePaisa;
}
