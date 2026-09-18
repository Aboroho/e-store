import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { availableQuantity } from "@/modules/inventory/service";
import { createOrder, type OrderActor } from "@/modules/orders/service";
import type { CreateOrderInput } from "@/modules/orders/schemas";

/**
 * Storefront checkout.
 *
 * The catalog a shopper sees is built here: prices come from the storefront's
 * price list (or the variant override), availability is the sellable quantity of
 * the default location, and nothing the browser sends is trusted — the order
 * service re-resolves every price and quantity inside its own transaction.
 */

export interface CheckoutStorefront {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  supportPhone: string | null;
  supportEmail: string | null;
  freeDeliveryThresholdPaisa: number | null;
  codEnabled: boolean;
  preorderEnabled: boolean;
  priceListId: string | null;
  locationId: string | null;
}

/** The default (or explicitly requested) active storefront for checkout. */
export const resolveStorefront = cache(async (slug?: string): Promise<CheckoutStorefront> => {
  const storefront = await prisma.storefront.findFirst({
    where: { status: "ACTIVE", ...(slug ? { slug } : {}) },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      businessId: true,
      name: true,
      slug: true,
      supportPhone: true,
      supportEmail: true,
      freeDeliveryThresholdPaisa: true,
      codEnabled: true,
      preorderEnabled: true,
      defaultPriceListId: true,
      defaultLocationId: true,
    },
  });
  if (!storefront) throw AppError.notFound("No active storefront is configured");

  return {
    id: storefront.id,
    businessId: storefront.businessId,
    name: storefront.name,
    slug: storefront.slug,
    supportPhone: storefront.supportPhone,
    supportEmail: storefront.supportEmail,
    freeDeliveryThresholdPaisa: storefront.freeDeliveryThresholdPaisa,
    codEnabled: storefront.codEnabled,
    preorderEnabled: storefront.preorderEnabled,
    priceListId: storefront.defaultPriceListId,
    locationId: storefront.defaultLocationId,
  };
});

export interface CheckoutVariant {
  variantId: string;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  isPreorderEnabled: boolean;
  attributes: Array<{ name: string; value: string }>;
}

/** Purchasable variants of a storefront, with resolved prices and availability. */
export async function checkoutCatalog(storefront: CheckoutStorefront, limit = 60): Promise<CheckoutVariant[]> {
  const products = await prisma.product.findMany({
    where: { businessId: storefront.businessId, deletedAt: null, status: "ACTIVE" },
    orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      isPreorderEnabled: true,
      variants: {
        where: { status: "ACTIVE" },
        orderBy: { position: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          priceOverridePaisa: true,
          compareAtPricePaisa: true,
          attributeValues: { select: { attribute: { select: { name: true } }, attributeValue: { select: { value: true } } } },
        },
      },
    },
  });

  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
  if (variantIds.length === 0) return [];

  const [priceItems, balances] = await Promise.all([
    storefront.priceListId
      ? prisma.priceListItem.findMany({
          where: { priceListId: storefront.priceListId, variantId: { in: variantIds }, minQuantity: 1 },
          select: { variantId: true, pricePaisa: true, compareAtPricePaisa: true },
        })
      : Promise.resolve([]),
    prisma.inventoryBalance.findMany({
      where: { variantId: { in: variantIds }, ...(storefront.locationId ? { locationId: storefront.locationId } : {}) },
      select: { variantId: true, onHand: true, reserved: true, damaged: true, inspection: true },
    }),
  ]);

  const priceByVariant = new Map(priceItems.map((item) => [item.variantId, item]));
  const availableByVariant = new Map<string, number>();
  for (const balance of balances) {
    availableByVariant.set(balance.variantId, (availableByVariant.get(balance.variantId) ?? 0) + availableQuantity(balance));
  }

  return products.flatMap((product) =>
    product.variants.map((variant) => {
      const priceItem = priceByVariant.get(variant.id);
      const pricePaisa = priceItem?.pricePaisa ?? variant.priceOverridePaisa ?? 0;
      return {
        variantId: variant.id,
        sku: variant.sku,
        variantName: variant.name,
        productId: product.id,
        productName: product.name,
        pricePaisa,
        compareAtPricePaisa: priceItem?.compareAtPricePaisa ?? variant.compareAtPricePaisa ?? null,
        available: availableByVariant.get(variant.id) ?? 0,
        isPreorderEnabled: product.isPreorderEnabled,
        attributes: variant.attributeValues.map((value) => ({ name: value.attribute.name, value: value.attributeValue.value })),
      };
    }),
  );
}

export interface CheckoutInput {
  storefrontSlug?: string;
  storefrontId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  districtCode: string;
  addressLine: string;
  area?: string;
  note?: string;
  items: Array<{ variantId: string; quantity: number }>;
  idempotencyKey: string;
}

/**
 * Place a storefront order. The caller (a public server action) passes only what
 * the shopper typed: variants and quantities, never prices.
 */
export async function placeStorefrontOrder(input: CheckoutInput, meta: { actorLabel?: string | null; ipAddress?: string | null } = {}) {
  const storefront = await resolveStorefront(input.storefrontSlug);
  if (input.storefrontId && input.storefrontId !== storefront.id) {
    throw AppError.validation("That storefront is not available for checkout");
  }

  const actor: OrderActor = {
    businessId: storefront.businessId,
    actorType: "CUSTOMER",
    actorLabel: meta.actorLabel ?? "storefront-checkout",
    ipAddress: meta.ipAddress ?? null,
  };

  const orderInput: CreateOrderInput = {
    channel: "STOREFRONT",
    storefrontId: storefront.id,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    shippingDistrictCode: input.districtCode,
    shippingAddressLine: input.addressLine,
    shippingArea: input.area,
    customerNote: input.note,
    paymentMethod: storefront.codEnabled ? "COD" : "MANUAL",
    markDelivered: false,
    items: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, discountPaisa: 0 })),
    deliveryFeePaisa: undefined,
    discountTotalPaisa: 0,
    discountReason: undefined,
    extraCharges: [],
    codSurchargePaisa: undefined,
    internalNote: undefined,
    sourceReference: `storefront:${storefront.slug}`,
    idempotencyKey: input.idempotencyKey,
    customer: {
      name: input.customerName,
      phone: input.customerPhone,
      email: input.customerEmail || undefined,
      districtCode: input.districtCode,
      addressLine: input.addressLine,
      area: input.area,
    },
  };

  const result = await createOrder(actor, orderInput);
  return { ...result, storefront };
}
