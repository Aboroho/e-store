import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logging";
import type { CatalogActor } from "@/modules/catalog/service";

/**
 * Pricing service.
 *
 * Prices live in `PriceListItem` rows so that a storefront, a reseller or a
 * future wholesale channel can each have their own price for the same variant.
 * Every price change writes a new row (or updates the existing one) and an audit
 * entry; order lines snapshot the price they were sold at, so historical
 * profitability is never recomputed from current prices.
 */

export interface ResolvedPrice {
  variantId: string;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  priceListId: string | null;
  source: "PRICE_LIST_ITEM" | "VARIANT_OVERRIDE" | "NONE";
}

/** Resolve the price of a variant for a given price list, falling back to the variant override. */
export async function resolveVariantPrice(
  variantId: string,
  options: { priceListId?: string | null; quantity?: number } = {},
): Promise<ResolvedPrice> {
  const quantity = options.quantity ?? 1;

  if (options.priceListId) {
    const candidates = await prisma.priceListItem.findMany({
      where: {
        priceListId: options.priceListId,
        variantId,
        minQuantity: { lte: quantity },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }] },
          { OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
        ],
      },
      orderBy: { minQuantity: "desc" },
      take: 1,
    });
    const item = candidates[0];
    if (item) {
      return {
        variantId,
        pricePaisa: item.pricePaisa,
        compareAtPricePaisa: item.compareAtPricePaisa ?? null,
        priceListId: item.priceListId,
        source: "PRICE_LIST_ITEM",
      };
    }
  }

  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: { priceOverridePaisa: true, compareAtPricePaisa: true },
  });
  if (!variant) throw AppError.notFound("Variant not found");

  if (variant.priceOverridePaisa != null) {
    return {
      variantId,
      pricePaisa: variant.priceOverridePaisa,
      compareAtPricePaisa: variant.compareAtPricePaisa ?? null,
      priceListId: null,
      source: "VARIANT_OVERRIDE",
    };
  }

  return { variantId, pricePaisa: 0, compareAtPricePaisa: null, priceListId: null, source: "NONE" };
}

/** Strict variant used by checkout/order creation: a missing price is an error, not a zero. */
export async function requireVariantPrice(
  variantId: string,
  options: { priceListId?: string | null; quantity?: number } = {},
): Promise<ResolvedPrice> {
  const price = await resolveVariantPrice(variantId, options);
  if (price.source === "NONE" || price.pricePaisa <= 0) {
    throw AppError.validation("This variant has no price configured for the selected price list");
  }
  return price;
}

export async function createPriceList(
  actor: CatalogActor,
  input: {
    name: string;
    slug?: string;
    channel: "DEFAULT" | "STOREFRONT" | "RESELLER" | "WHOLESALE" | "CUSTOM";
    currency: string;
    storefrontId?: string;
    isDefault: boolean;
    priority: number;
    description?: string;
  },
) {
  return withTransaction(async (tx) => {
    const slug = slugify(input.slug ?? input.name);
    const clash = await tx.priceList.findFirst({ where: { businessId: actor.businessId, slug } });
    if (clash) throw AppError.conflict(`A price list with the slug "${slug}" already exists`);

    if (input.storefrontId) {
      const storefront = await tx.storefront.findFirst({
        where: { id: input.storefrontId, businessId: actor.businessId },
        select: { id: true },
      });
      if (!storefront) throw AppError.validation("The selected storefront does not exist");
    }

    if (input.isDefault) {
      await tx.priceList.updateMany({ where: { businessId: actor.businessId, isDefault: true }, data: { isDefault: false } });
    }

    const priceList = await tx.priceList.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug,
        channel: input.channel,
        currency: input.currency,
        storefrontId: input.storefrontId ?? null,
        isDefault: input.isDefault,
        priority: input.priority,
        description: input.description ?? null,
        createdByUserId: actor.userId,
      },
      select: { id: true, name: true, slug: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "price_list.created",
        entityType: "PriceList",
        entityId: priceList.id,
        summary: `Created price list ${priceList.name} (${input.channel})`,
        changedFields: ["priceList"],
      },
    });

    return priceList;
  });
}

/** Set (or replace) the price of one variant in a price list. */
export async function setPriceListItem(
  actor: CatalogActor,
  input: {
    priceListId: string;
    variantId: string;
    pricePaisa: number;
    compareAtPricePaisa?: number | null;
    /** Quantity tier. 1 is the base price, higher values are bulk tiers. */
    minQuantity?: number;
  },
): Promise<void> {
  const minQuantity = input.minQuantity ?? 1;
  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    throw AppError.validation("The minimum quantity of a price tier must be a whole number of at least 1");
  }
  if (input.pricePaisa < 0) throw AppError.validation("Price cannot be negative");
  if (input.compareAtPricePaisa != null && input.compareAtPricePaisa < input.pricePaisa) {
    throw AppError.validation("The compare-at price should not be lower than the selling price");
  }

  await withTransaction(async (tx) => {
    const priceList = await tx.priceList.findFirst({
      where: { id: input.priceListId, businessId: actor.businessId },
      select: { id: true, name: true },
    });
    if (!priceList) throw AppError.notFound("Price list not found");

    const variant = await tx.variant.findFirst({
      where: { id: input.variantId, product: { businessId: actor.businessId } },
      select: { id: true, sku: true, productId: true, priceOverridePaisa: true },
    });
    if (!variant) throw AppError.notFound("Variant not found");

    await tx.priceListItem.upsert({
      where: {
        priceListId_variantId_minQuantity: { priceListId: input.priceListId, variantId: input.variantId, minQuantity },
      },
      create: {
        priceListId: input.priceListId,
        variantId: input.variantId,
        productId: variant.productId,
        pricePaisa: input.pricePaisa,
        compareAtPricePaisa: input.compareAtPricePaisa ?? null,
        minQuantity,
      },
      update: { pricePaisa: input.pricePaisa, compareAtPricePaisa: input.compareAtPricePaisa ?? null },
    });

    // The variant override mirrors the *base* price of the default price list so
    // that storefront and admin screens agree without a second lookup. Bulk tiers
    // must never overwrite the base price a single-unit sale uses.
    if (minQuantity === 1 && priceList.id === (await defaultPriceListId(tx, actor.businessId))) {
      await tx.variant.update({
        where: { id: input.variantId },
        data: { priceOverridePaisa: input.pricePaisa, compareAtPricePaisa: input.compareAtPricePaisa ?? null },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "price_list.item_set",
        entityType: "PriceList",
        entityId: input.priceListId,
        summary: `Set price of ${variant.sku} to ${input.pricePaisa} paisa${minQuantity > 1 ? ` from ${minQuantity} units` : ""} in ${priceList.name}`,
        before: { pricePaisa: variant.priceOverridePaisa },
        after: { pricePaisa: input.pricePaisa, compareAtPricePaisa: input.compareAtPricePaisa ?? null },
        changedFields: ["pricePaisa"],
      },
    });
  });
}

/** Bulk price update used by the price list editor. */
export async function setPriceListItems(
  actor: CatalogActor,
  priceListId: string,
  rows: Array<{ variantId: string; pricePaisa: number; compareAtPricePaisa?: number | null; minQuantity?: number }>,
): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    await setPriceListItem(actor, { priceListId, ...row });
    updated += 1;
  }
  return updated;
}

async function defaultPriceListId(tx: Prisma.TransactionClient, businessId: string): Promise<string | null> {
  const list = await tx.priceList.findFirst({
    where: { businessId, isDefault: true },
    select: { id: true },
  });
  return list?.id ?? null;
}

/**
 * Snapshot helper for stage 3+: order lines keep the price and cost they were
 * sold at, so reports never have to recompute history from current prices.
 */
export function snapshotLinePricing(input: { pricePaisa: number; costPaisa: number | null; quantity: number; discountPaisa?: number }) {
  const discountPaisa = input.discountPaisa ?? 0;
  const lineTotalPaisa = input.pricePaisa * input.quantity - discountPaisa;
  const unitCostPaisa = input.costPaisa ?? 0;
  return {
    unitPricePaisa: input.pricePaisa,
    unitCostPaisa,
    quantity: input.quantity,
    discountPaisa,
    lineTotalPaisa,
    lineCostPaisa: unitCostPaisa * input.quantity,
  };
}

logger.debug("pricing service loaded");
