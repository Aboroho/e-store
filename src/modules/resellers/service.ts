import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { formatPaisa } from "@/lib/money";
import { normalizeBdPhone } from "@/lib/utils";
import { randomUUID } from "node:crypto";
import { createOrder, type OrderActor } from "@/modules/orders/service";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import type { ResellerInput, ResellerOrderInput, ResellerPriceInput } from "./schemas";

/**
 * Reseller accounts, pricing and orders.
 *
 * The reseller is a customer of the business with its own price list; the money it
 * takes from *its* customer is recorded on the order and drives the earnings
 * calculation (see `./earnings.ts`), never the catalogue price at the time of
 * payout.
 */

export interface ResellerActor {
  businessId: string;
  userId?: string | null;
  actorLabel?: string | null;
  actorType?: "USER" | "SYSTEM" | "API_KEY" | "CUSTOMER";
  ipAddress?: string | null;
}

type Tx = Prisma.TransactionClient;

export async function createReseller(actor: ResellerActor, input: ResellerInput) {
  return withTransaction(async (tx) => {
    const code = (input.code?.trim() || (await nextResellerCode(tx, actor.businessId))).toUpperCase();
    const phoneNormalized = input.phone ? normalizeBdPhone(input.phone) : null;

    const existing = await tx.reseller.findFirst({ where: { businessId: actor.businessId, code } });
    if (existing) throw AppError.conflict(`Reseller code ${code} is already used`);

    const reseller = await tx.reseller.create({
      data: {
        businessId: actor.businessId,
        code,
        name: input.name,
        businessName: input.businessName ?? null,
        phone: input.phone ?? null,
        phoneNormalized,
        email: input.email || null,
        status: input.status,
        commissionType: input.commissionType,
        commissionValue: input.commissionValue,
        packagingIncluded: input.packagingIncluded,
        packagingCostPaisa: input.packagingCostPaisa,
        deliveryChargePaisa: input.deliveryChargePaisa,
        codChargePaisa: input.codChargePaisa,
        defaultDistrictCode: input.defaultDistrictCode ?? null,
        address: input.address ?? null,
        nidNumber: input.nidNumber ?? null,
        payoutMethod: input.payoutMethod,
        payoutAccountNumber: input.payoutAccountNumber ?? null,
        payoutAccountName: input.payoutAccountName ?? null,
        minimumPayoutPaisa: input.minimumPayoutPaisa,
        creditLimitPaisa: input.creditLimitPaisa,
        note: input.note ?? null,
        createdByUserId: actor.userId ?? null,
      },
    });

    // Every reseller gets its own price list, which is what makes reseller pricing
    // auditable: prices are rows, not a percentage applied at checkout.
    const priceList = await tx.priceList.create({
      data: {
        businessId: actor.businessId,
        resellerId: reseller.id,
        name: `${reseller.name} price list`,
        slug: `reseller-${code.toLowerCase()}-${reseller.id.slice(0, 8)}`,
        channel: "RESELLER",
        status: "ACTIVE",
        priority: 10,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        actorLabel: actor.actorLabel ?? null,
        action: "reseller.created",
        entityType: "Reseller",
        entityId: reseller.id,
        summary: `Reseller ${reseller.code} (${reseller.name}) created`,
        after: { code, status: input.status, commissionType: input.commissionType },
        changedFields: ["reseller"],
        ipAddress: actor.ipAddress ?? null,
      },
      tx,
    );

    return { reseller, priceListId: priceList.id };
  });
}

async function nextResellerCode(tx: Tx, businessId: string) {
  const count = await tx.reseller.count({ where: { businessId } });
  let attempt = count + 1;
  // Codes must be free even after deletions, so walk forward until one is.
  for (;;) {
    const candidate = `RS-${String(attempt).padStart(4, "0")}`;
    const taken = await tx.reseller.findFirst({ where: { businessId, code: candidate }, select: { id: true } });
    if (!taken) return candidate;
    attempt += 1;
  }
}

export async function updateReseller(actor: ResellerActor, input: ResellerInput & { resellerId: string }) {
  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");

    const updated = await tx.reseller.update({
      where: { id: reseller.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.businessName !== undefined ? { businessName: input.businessName || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null, phoneNormalized: input.phone ? normalizeBdPhone(input.phone) : null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.commissionType !== undefined ? { commissionType: input.commissionType } : {}),
        ...(input.commissionValue !== undefined ? { commissionValue: input.commissionValue } : {}),
        ...(input.packagingIncluded !== undefined ? { packagingIncluded: input.packagingIncluded } : {}),
        ...(input.packagingCostPaisa !== undefined ? { packagingCostPaisa: input.packagingCostPaisa } : {}),
        ...(input.deliveryChargePaisa !== undefined ? { deliveryChargePaisa: input.deliveryChargePaisa } : {}),
        ...(input.codChargePaisa !== undefined ? { codChargePaisa: input.codChargePaisa } : {}),
        ...(input.defaultDistrictCode !== undefined ? { defaultDistrictCode: input.defaultDistrictCode || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.nidNumber !== undefined ? { nidNumber: input.nidNumber || null } : {}),
        ...(input.payoutMethod !== undefined ? { payoutMethod: input.payoutMethod } : {}),
        ...(input.payoutAccountNumber !== undefined ? { payoutAccountNumber: input.payoutAccountNumber || null } : {}),
        ...(input.payoutAccountName !== undefined ? { payoutAccountName: input.payoutAccountName || null } : {}),
        ...(input.minimumPayoutPaisa !== undefined ? { minimumPayoutPaisa: input.minimumPayoutPaisa } : {}),
        ...(input.creditLimitPaisa !== undefined ? { creditLimitPaisa: input.creditLimitPaisa } : {}),
        ...(input.note !== undefined ? { note: input.note || null } : {}),
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.updated",
        entityType: "Reseller",
        entityId: reseller.id,
        summary: `Reseller ${reseller.code} updated`,
        before: { status: reseller.status, commissionType: reseller.commissionType, packagingCostPaisa: reseller.packagingCostPaisa },
        after: { status: updated.status, commissionType: updated.commissionType, packagingCostPaisa: updated.packagingCostPaisa },
        changedFields: ["reseller"],
      },
      tx,
    );

    return updated;
  });
}

export async function setResellerStatus(
  actor: ResellerActor,
  input: { resellerId: string; status: "ACTIVE" | "INACTIVE" | "SUSPENDED"; reason?: string | null },
) {
  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");
    if (reseller.status === input.status) return reseller;

    // Suspension stops new orders and price snapshots; it never rewrites history.
    const updated = await tx.reseller.update({
      where: { id: reseller.id },
      data: {
        status: input.status,
        suspendedAt: input.status === "SUSPENDED" ? new Date() : reseller.suspendedAt,
        ...(input.status === "ACTIVE" ? { suspendedAt: null } : {}),
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.status_changed",
        entityType: "Reseller",
        entityId: reseller.id,
        summary: `Reseller ${reseller.code} set to ${input.status.toLowerCase()}`,
        before: { status: reseller.status },
        after: { status: input.status },
        reason: input.reason ?? null,
        changedFields: ["status"],
      },
      tx,
    );

    return updated;
  });
}

// ------------------------------------------------------------------ pricing

async function resellerPriceList(tx: Tx, businessId: string, resellerId: string) {
  const list = await tx.priceList.findFirst({ where: { businessId, resellerId } });
  if (list) return list;
  const reseller = await tx.reseller.findFirstOrThrow({ where: { id: resellerId, businessId } });
  return tx.priceList.create({
    data: {
      businessId,
      resellerId,
      name: `${reseller.name} price list`,
      slug: `reseller-${reseller.code.toLowerCase()}-${reseller.id.slice(0, 8)}`,
      channel: "RESELLER",
      status: "ACTIVE",
      priority: 10,
    },
  });
}

export async function setResellerPrice(actor: ResellerActor, input: ResellerPriceInput) {
  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");

    const variant = await tx.variant.findFirst({ where: { id: input.variantId, product: { businessId: actor.businessId } } });
    if (!variant) throw AppError.notFound("Variant not found");

    const list = await resellerPriceList(tx, actor.businessId, reseller.id);

    const item = await tx.priceListItem.upsert({
      where: { priceListId_variantId_minQuantity: { priceListId: list.id, variantId: variant.id, minQuantity: input.minQuantity } },
      create: { priceListId: list.id, variantId: variant.id, pricePaisa: input.pricePaisa, minQuantity: input.minQuantity, productId: variant.productId },
      update: { pricePaisa: input.pricePaisa },
    });
    const existing = item.pricePaisa === input.pricePaisa ? item : null;

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.price_set",
        entityType: "PriceListItem",
        entityId: item.id,
        summary: `Reseller ${reseller.code}: ${variant.name} priced at ${formatPaisa(input.pricePaisa)}`,
        before: existing ? { pricePaisa: existing.pricePaisa } : null,
        after: { pricePaisa: input.pricePaisa, variantId: variant.id },
        changedFields: ["price"],
      },
      tx,
    );

    return item;
  });
}

export async function removeResellerPrice(actor: ResellerActor, input: { resellerId: string; itemId: string }) {
  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");

    const item = await tx.priceListItem.findFirst({
      where: { id: input.itemId, priceList: { resellerId: reseller.id } },
      include: { priceList: true },
    });
    if (!item) throw AppError.notFound("Reseller price not found");

    await tx.priceListItem.delete({ where: { id: item.id } });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.price_removed",
        entityType: "Reseller",
        entityId: reseller.id,
        summary: `Reseller ${reseller.code}: price override removed (falls back to the default list)`,
        before: { variantId: item.variantId, pricePaisa: item.pricePaisa },
        changedFields: ["price"],
      },
      tx,
    );

    return { removed: true as const };
  });
}

/**
 * Price a reseller list from the default list with a markup.
 *
 * `onlyMissing` keeps hand-negotiated prices untouched, which is the safe default
 * for a bulk action.
 */
export async function applyResellerMarkup(
  actor: ResellerActor,
  input: { resellerId: string; markupBps: number; onlyMissing: boolean },
) {
  return withTransaction(async (tx) => {
    const reseller = await tx.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
    if (!reseller) throw AppError.notFound("Reseller not found");

    const list = await resellerPriceList(tx, actor.businessId, reseller.id);
    const baseList = await tx.priceList.findFirst({
      where: { businessId: actor.businessId, isDefault: true, status: "ACTIVE" },
      include: { items: true },
    });
    if (!baseList) throw AppError.validation("Set a default price list before applying a markup");

    const existingItems = await tx.priceListItem.findMany({
      where: { priceListId: list.id },
      select: { id: true, variantId: true, minQuantity: true },
    });
    const existingKeys = new Set(existingItems.map((item) => `${item.variantId}:${item.minQuantity}`));

    let created = 0;
    let updated = 0;

    for (const base of baseList.items) {
      if (!base.variantId) continue;
      const key = `${base.variantId}:${base.minQuantity}`;
      const priced = Math.max(0, Math.round((base.pricePaisa * (10_000 + input.markupBps)) / 10_000));
      const existing = existingItems.find((item) => item.variantId === base.variantId && item.minQuantity === base.minQuantity);

      if (existing) {
        if (input.onlyMissing) continue;
        await tx.priceListItem.update({ where: { id: existing.id }, data: { pricePaisa: priced } });
        updated += 1;
        continue;
      }
      if (existingKeys.has(key)) continue;

      await tx.priceListItem.create({
        data: { priceListId: list.id, variantId: base.variantId, pricePaisa: priced, minQuantity: base.minQuantity },
      });
      created += 1;
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.markup_applied",
        entityType: "PriceList",
        entityId: list.id,
        summary: `Applied ${(input.markupBps / 100).toFixed(2)}% markup to ${reseller.code} (${created} created, ${updated} updated)`,
        after: { markupBps: input.markupBps, created, updated, onlyMissing: input.onlyMissing },
        changedFields: ["price"],
      },
      tx,
    );

    return { created, updated, priceListId: list.id };
  });
}

// --------------------------------------------------------------------- orders

/**
 * Create an order on behalf of a reseller.
 *
 * The order goes through the same `createOrder` service as every other channel,
 * which is what keeps stock, pricing and payment rules identical. What is specific
 * to a reseller channel is decided here and recorded on the order: the collection
 * amount taken from their customer, their packaging/delivery/COD rules, and the
 * cost the business charges them.
 */
export async function createResellerOrder(actor: ResellerActor, input: ResellerOrderInput) {
  const reseller = await prisma.reseller.findFirst({ where: { id: input.resellerId, businessId: actor.businessId } });
  if (!reseller) throw AppError.notFound("Reseller not found");
  if (reseller.status !== "ACTIVE") {
    throw AppError.invalidState(`Reseller ${reseller.code} is ${reseller.status.toLowerCase()} and cannot place orders`);
  }

  const priceList = await resellerPriceList(prisma, actor.businessId, reseller.id);

  const orderActor: OrderActor = {
    businessId: actor.businessId,
    userId: actor.userId ?? null,
    actorType: actor.actorType === "SYSTEM" ? "SYSTEM" : "USER",
    actorLabel: actor.actorLabel ?? "reseller-order",
    ipAddress: actor.ipAddress ?? null,
  };

  // The order itself goes through the one `createOrder` service, so stock, pricing
  // and payment rules are identical to every other channel.
  const orderInput = createOrderInputSchema.parse({
    channel: "RESELLER",
    resellerId: reseller.id,
    priceListId: priceList.id,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || undefined,
    shippingDistrictCode: input.shippingDistrictCode,
    shippingAddressLine: input.shippingAddressLine,
    shippingArea: input.shippingArea,
    deliveryNotes: input.deliveryNotes,
    customerNote: input.internalNote,
    paymentMethod: "COD",
    deliveryFeePaisa: reseller.deliveryChargePaisa > 0 ? reseller.deliveryChargePaisa : undefined,
    codSurchargePaisa: reseller.codChargePaisa > 0 ? reseller.codChargePaisa : undefined,
    items: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, discountPaisa: item.discountPaisa })),
    idempotencyKey: input.idempotencyKey ?? `reseller:${reseller.id}:${randomUUID()}`,
  });

  const created = await createOrder(orderActor, orderInput);

  if (created.reused) {
    const existing = await prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    return {
      ...created,
      collectionPaisa: existing.resellerCollectionPaisa ?? 0,
      costPaisa: existing.resellerCostPaisa,
      earningPaisa: existing.resellerEarningPaisa,
    };
  }

  const result = await withTransaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: created.order.id }, include: { items: true } });

    // Packaging: when the negotiated reseller price already includes packaging the
    // business charges nothing extra; otherwise the reseller pays it per unit.
    const packagingPaisa = reseller.packagingIncluded
      ? 0
      : reseller.packagingCostPaisa * order.items.reduce((total, item) => total + item.quantity, 0);

    const collectionPaisa = input.collectionPaisa ?? order.grandTotalPaisa + packagingPaisa;
    const costPaisa = order.grandTotalPaisa + packagingPaisa;
    const earningPaisa = collectionPaisa - costPaisa;

    await tx.order.update({
      where: { id: order.id },
      data: { resellerCollectionPaisa: collectionPaisa, resellerCostPaisa: costPaisa, resellerEarningPaisa: earningPaisa },
    });

    await tx.resellerCollectionChange.create({
      data: {
        orderId: order.id,
        resellerId: reseller.id,
        previousPaisa: null,
        newPaisa: collectionPaisa,
        reason: "Initial collection amount recorded with the order",
        changedByUserId: actor.userId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.order_created",
        entityType: "Order",
        entityId: order.id,
        summary: `Reseller ${reseller.code} order ${order.orderNumber}: collecting ${formatPaisa(collectionPaisa)}, cost ${formatPaisa(costPaisa)}`,
        after: { collectionPaisa, costPaisa, earningPaisa, packagingPaisa, resellerId: reseller.id },
        changedFields: ["order"],
      },
      tx,
    );

    return { collectionPaisa, costPaisa, earningPaisa, orderNumber: order.orderNumber };
  });

  return { ...created, ...result };
}

/**
 * Record a change to what the reseller collects from their customer.
 *
 * The platform never caps this amount; it records who changed it, when and why,
 * and recalculates the earnings snapshot that the ledger will later use.
 */
export async function recordCollectionChange(
  actor: ResellerActor,
  input: { orderId: string; amountPaisa: number; reason?: string | null },
) {
  return withTransaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, businessId: actor.businessId },
      include: { items: true, reseller: true },
    });
    if (!order) throw AppError.notFound("Order not found");
    if (!order.resellerId || !order.reseller) throw AppError.validation("This order does not belong to a reseller");
    if (order.status === "CANCELLED") throw AppError.invalidState("A cancelled order has no collection to change");

    const packagingPaisa = order.reseller.packagingIncluded
      ? 0
      : order.reseller.packagingCostPaisa * order.items.reduce((total, item) => total + item.quantity, 0);
    const costPaisa = order.grandTotalPaisa + packagingPaisa;

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        resellerCollectionPaisa: input.amountPaisa,
        resellerCostPaisa: costPaisa,
        resellerEarningPaisa: input.amountPaisa - costPaisa,
      },
    });

    await tx.resellerCollectionChange.create({
      data: {
        orderId: order.id,
        resellerId: order.resellerId,
        previousPaisa: order.resellerCollectionPaisa,
        newPaisa: input.amountPaisa,
        reason: input.reason ?? null,
        changedByUserId: actor.userId ?? null,
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "reseller.collection_changed",
        entityType: "Order",
        entityId: order.id,
        summary: `Collection for ${order.orderNumber} changed from ${formatPaisa(order.resellerCollectionPaisa ?? 0)} to ${formatPaisa(input.amountPaisa)}`,
        before: { collectionPaisa: order.resellerCollectionPaisa },
        after: { collectionPaisa: input.amountPaisa, earningPaisa: updated.resellerEarningPaisa },
        reason: input.reason ?? null,
        changedFields: ["resellerCollectionPaisa"],
      },
      tx,
    );

    return updated;
  });
}

export async function listResellerPriceList(businessId: string, resellerId: string) {
  const list = await prisma.priceList.findFirst({
    where: { businessId, resellerId },
    include: {
      items: {
        orderBy: { updatedAt: "desc" },
        take: 500,
        include: { variant: { select: { id: true, name: true, sku: true, priceOverridePaisa: true, product: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (!list) return { priceListId: null, items: [] as Array<never> };
  return { priceListId: list.id, items: list.items };
}

/**
 * Variants a reseller price can point at, with the price that would apply today
 * (negotiated price if one exists, otherwise the default list price).
 */
export async function listVariantsForPricing(businessId: string, resellerId?: string, limit = 500) {
  const priceList = resellerId ? await prisma.priceList.findFirst({ where: { businessId, resellerId }, select: { id: true } }) : null;

  const variants = await prisma.variant.findMany({
    where: { product: { businessId, deletedAt: null, status: "ACTIVE" }, deletedAt: null },
    orderBy: { sku: "asc" },
    take: limit,
    select: {
      id: true,
      sku: true,
      name: true,
      priceOverridePaisa: true,
      product: { select: { name: true } },
    },
  });

  const items = priceList
    ? await prisma.priceListItem.findMany({
        where: { priceListId: priceList.id, variantId: { in: variants.map((variant) => variant.id) } },
        select: { variantId: true, pricePaisa: true, minQuantity: true },
      })
    : [];
  const negotiated = new Map(items.filter((item) => item.minQuantity <= 1).map((item) => [item.variantId, item.pricePaisa]));

  return variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    productName: variant.product.name,
    // What the reseller would pay today: negotiated price, then the variant override,
    // then the catalogue price written down on the variant during setup.
    pricePaisa: negotiated.get(variant.id) ?? variant.priceOverridePaisa ?? 0,
  }));
}
