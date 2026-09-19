import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { generateNumericCode, hashToken, sha256 } from "@/lib/crypto";
import { normalizeBdPhone } from "@/lib/utils";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createCustomerSession, revokeCustomerSession } from "@/lib/auth/customer-session";
import type { CustomerAddressInput, CustomerIdentityInput } from "@/modules/customers/schemas";

/**
 * Customer identity.
 *
 * One customer per business per normalised phone number, shared by every
 * storefront: `phoneNormalized` is the identity key, which is why guest orders
 * can be claimed later without duplicating people who type their number
 * differently.
 *
 * Knowing a phone number is never enough to get access. Logging in requires a
 * one-time code delivered out of band (SMS gateway when configured, otherwise
 * staff-assisted verification on the customer screen); the public flow never
 * receives the code.
 */

export interface CustomerActor {
  businessId: string;
  userId?: string | null;
  actorLabel?: string | null;
  actorType?: "USER" | "CUSTOMER" | "SYSTEM" | "API_KEY";
}

type Tx = Prisma.TransactionClient;

const CODE_TTL_MINUTES = 10;

export function normalizePhone(phone: string): string {
  const normalized = normalizeBdPhone(phone);
  if (!normalized) throw AppError.validation("Enter a valid Bangladeshi mobile number (for example 01712345678)");
  return normalized;
}

/**
 * Find or create the customer for a phone number. Used by checkout, admin order
 * creation and the API so every channel lands on the same identity.
 */
export async function findOrCreateCustomer(
  tx: Tx,
  input: CustomerIdentityInput & { businessId: string; createdByUserId?: string | null },
) {
  const phoneNormalized = normalizePhone(input.phone);
  const name = input.name.trim();
  const email = input.email?.trim() ? input.email.trim().toLowerCase() : null;

  const existing = await tx.customer.findUnique({
    where: { businessId_phoneNormalized: { businessId: input.businessId, phoneNormalized } },
  });

  if (existing) {
    return tx.customer.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        phone: input.phone.trim(),
        email: email ?? existing.email,
        emailNormalized: email ?? existing.emailNormalized,
        districtCode: input.districtCode ?? existing.districtCode,
        addressLine: input.addressLine ?? existing.addressLine,
        area: input.area ?? existing.area,
      },
    });
  }

  return tx.customer.create({
    data: {
      businessId: input.businessId,
      name,
      phone: input.phone.trim(),
      phoneNormalized,
      email,
      emailNormalized: email,
      districtCode: input.districtCode ?? null,
      addressLine: input.addressLine ?? null,
      area: input.area ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

/** Recompute the lifetime aggregates kept on the customer row. */
export async function recalculateCustomerStats(tx: Tx, customerId: string) {
  const orders = await tx.order.findMany({
    where: { customerId, status: { not: "CANCELLED" } },
    select: { grandTotalPaisa: true, paidPaisa: true, placedAt: true },
  });
  const totalSpentPaisa = orders.reduce((total, order) => total + order.paidPaisa, 0);
  const timestamps = orders.map((order) => order.placedAt.getTime()).sort((a, b) => a - b);

  return tx.customer.update({
    where: { id: customerId },
    data: {
      totalOrders: orders.length,
      totalSpentPaisa,
      lifetimeValuePaisa: totalSpentPaisa,
      firstOrderAt: timestamps.length > 0 ? new Date(timestamps[0]!) : null,
      lastOrderAt: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]!) : null,
    },
  });
}

// ------------------------------------------------------------------ verification

export type VerificationPurposeValue = "LOGIN" | "ACCOUNT_CLAIM" | "PHONE_VERIFY" | "ORDER_LOOKUP";

export interface VerificationRequestResult {
  id: string;
  expiresAt: Date;
  delivered: boolean;
  channel: "SMS";
  /** Only set for staff-assisted delivery: authorized staff read the code on screen. */
  codeForStaff: string | null;
  message: string;
}

/**
 * Create a one-time code.
 *
 * `staffAssisted` is what makes this safe: the plaintext code is returned only to
 * an authenticated staff request (which is audited), while the public checkout /
 * account flow receives `delivered: false` and must rely on the configured SMS
 * gateway. The database only ever stores the hash.
 */
export async function requestVerificationCode(
  input: {
    businessId: string;
    phone: string;
    purpose: VerificationPurposeValue;
    staffAssisted: boolean;
    actorUserId?: string | null;
    ipAddress?: string | null;
  },
): Promise<VerificationRequestResult> {
  const rate = await consumeRateLimit({
    scope: "customer-verify-request",
    key: `${input.businessId}:${sha256(normalizePhone(input.phone)).slice(0, 24)}`,
    limit: input.staffAssisted ? 20 : 5,
    windowSeconds: 15 * 60,
  });
  if (!rate.allowed) {
    throw AppError.rateLimited(`Too many verification requests. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minute(s).`);
  }

  const phoneNormalized = normalizePhone(input.phone);
  const customer = await prisma.customer.findUnique({
    where: { businessId_phoneNormalized: { businessId: input.businessId, phoneNormalized } },
    select: { id: true, status: true },
  });
  if (customer?.status === "BLOCKED") throw AppError.forbidden("This customer account is blocked");

  // Invalidate older unused codes for the same destination and purpose.
  await prisma.verificationCode.updateMany({
    where: { businessId: input.businessId, destination: phoneNormalized, purpose: input.purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  const record = await prisma.verificationCode.create({
    data: {
      businessId: input.businessId,
      customerId: customer?.id ?? null,
      channel: "SMS",
      destination: phoneNormalized,
      purpose: input.purpose,
      codeHash: hashToken(`${phoneNormalized}:${code}`),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
    },
  });

  // SMS gateway delivery is not configured in this deployment: the code is only
  // handed to an authenticated staff screen (audited below) or, once an SMS
  // integration exists, sent by the gateway and never returned here.
  const delivered = false;
  logger.info("customer.verification_requested", {
    verificationId: record.id,
    purpose: input.purpose,
    staffAssisted: input.staffAssisted,
    delivered,
  });

  await recordAudit({
    businessId: input.businessId,
    actorType: input.staffAssisted ? "USER" : "CUSTOMER",
    actorUserId: input.actorUserId ?? null,
    action: "customer.verification_requested",
    entityType: "VerificationCode",
    entityId: record.id,
    summary: `Verification code issued for ${phoneNormalized} (${input.purpose.toLowerCase()})`,
    after: { purpose: input.purpose, staffAssisted: input.staffAssisted, delivered },
  });

  return {
    id: record.id,
    expiresAt,
    delivered,
    channel: "SMS",
    codeForStaff: input.staffAssisted ? code : null,
    message: input.staffAssisted
      ? "Give this code to the customer over a channel you trust. It expires in 10 minutes."
      : "If the number belongs to an account, a code has been requested. Contact support if you do not receive it, or ask staff to verify you.",
  };
}

export interface VerifiedCustomer {
  customerId: string;
  sessionToken: string;
  expiresAt: Date;
  claimedOrders: number;
}

/**
 * Consume a code and open a customer session. This is the only path that grants
 * customer access.
 */
export async function confirmVerificationCode(input: {
  businessId: string;
  phone: string;
  code: string;
  purpose: VerificationPurposeValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<VerifiedCustomer> {
  const phoneNormalized = normalizePhone(input.phone);
  const attemptKey = `${input.businessId}:${sha256(phoneNormalized).slice(0, 24)}`;
  const rate = await consumeRateLimit({ scope: "customer-verify-confirm", key: attemptKey, limit: 10, windowSeconds: 15 * 60 });
  if (!rate.allowed) throw AppError.rateLimited("Too many attempts. Request a new code in a few minutes.");

  const record = await prisma.verificationCode.findFirst({
    where: { businessId: input.businessId, destination: phoneNormalized, purpose: input.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw AppError.validation("Request a verification code first");
  if (record.expiresAt.getTime() <= Date.now()) throw AppError.validation("This code has expired. Request a new one.");
  if (record.attempts >= record.maxAttempts) throw AppError.rateLimited("This code has too many failed attempts. Request a new one.");

  const expected = record.codeHash;
  const provided = hashToken(`${phoneNormalized}:${input.code}`);
  if (expected !== provided) {
    await prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw AppError.validation("That code is not correct");
  }

  const { customer, claimedOrders } = await withTransaction(async (tx) => {
    await tx.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

    const existing = await tx.customer.findFirst({
      where: { businessId: input.businessId, phoneNormalized, deletedAt: null },
    });

    const target =
      existing ??
      (await tx.customer.create({
        data: {
          businessId: input.businessId,
          name: "Customer",
          phone: input.phone.trim(),
          phoneNormalized,
          hasAccount: false,
        },
      }));

    // Guest orders placed with this phone number belong to this person.
    const claim = await tx.order.updateMany({
      where: { businessId: input.businessId, customerPhoneNormalized: phoneNormalized, customerId: null },
      data: { customerId: target.id },
    });

    const updated = await tx.customer.update({
      where: { id: target.id },
      data: {
        phoneVerifiedAt: new Date(),
        hasAccount: true,
        lastLoginAt: new Date(),
        phone: input.phone.trim(),
      },
    });

    await tx.verificationCode.update({ where: { id: record.id }, data: { customerId: target.id } });

    return { customer: updated, claimedOrders: claim.count };
  });

  const session = await createCustomerSession({
    customerId: customer.id,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  await recordAudit({
    businessId: input.businessId,
    actorType: "CUSTOMER",
    actorCustomerId: customer.id,
    action: "customer.login",
    entityType: "Customer",
    entityId: customer.id,
    summary: `Customer ${customer.phoneNormalized} verified a code and signed in`,
    after: { purpose: input.purpose, claimedOrders },
  });

  return { customerId: customer.id, sessionToken: session.token, expiresAt: session.expiresAt, claimedOrders };
}

export async function signOutCustomer(sessionId: string) {
  await revokeCustomerSession(sessionId);
}

// ------------------------------------------------------------------- management

export async function updateCustomer(
  actor: CustomerActor,
  input: { customerId: string; name?: string; email?: string | null; districtCode?: string | null; addressLine?: string | null; area?: string | null; notes?: string | null; tags?: string[] },
) {
  return withTransaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, businessId: actor.businessId } });
    if (!customer) throw AppError.notFound("Customer not found");

    const updated = await tx.customer.update({
      where: { id: customer.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined
          ? { email: input.email, emailNormalized: input.email ? input.email.toLowerCase() : null }
          : {}),
        ...(input.districtCode !== undefined ? { districtCode: input.districtCode } : {}),
        ...(input.addressLine !== undefined ? { addressLine: input.addressLine } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
    });

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "customer.updated",
        entityType: "Customer",
        entityId: customer.id,
        summary: `Updated customer ${customer.phoneNormalized}`,
        before: { name: customer.name, email: customer.email, districtCode: customer.districtCode },
        after: { name: updated.name, email: updated.email, districtCode: updated.districtCode },
      },
      tx,
    );

    return updated;
  });
}

export async function setCustomerStatus(actor: CustomerActor, input: { customerId: string; status: "ACTIVE" | "BLOCKED"; reason?: string | null }) {
  return withTransaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, businessId: actor.businessId } });
    if (!customer) throw AppError.notFound("Customer not found");

    const updated = await tx.customer.update({ where: { id: customer.id }, data: { status: input.status } });
    if (input.status === "BLOCKED") {
      await tx.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }

    await recordAudit(
      {
        businessId: actor.businessId,
        actorType: actor.actorType ?? "USER",
        actorUserId: actor.userId ?? null,
        action: "customer.status_changed",
        entityType: "Customer",
        entityId: customer.id,
        summary: `${customer.phoneNormalized} → ${input.status.toLowerCase()}`,
        reason: input.reason ?? null,
      },
      tx,
    );

    return updated;
  });
}

export async function saveCustomerAddress(actor: CustomerActor, input: CustomerAddressInput) {
  return withTransaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, businessId: actor.businessId } });
    if (!customer) throw AppError.notFound("Customer not found");

    const phoneNormalized = normalizePhone(input.phone);
    if (input.isDefault) {
      await tx.customerAddress.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } });
    }

    return tx.customerAddress.create({
      data: {
        customerId: customer.id,
        label: input.label ?? null,
        recipientName: input.recipientName,
        phone: input.phone,
        phoneNormalized,
        districtCode: input.districtCode ?? null,
        addressLine: input.addressLine,
        area: input.area ?? null,
        postcode: input.postcode ?? null,
        isDefault: input.isDefault,
      },
    });
  });
}

export async function addCustomerNote(actor: CustomerActor, input: { customerId: string; body: string; isPinned?: boolean }) {
  return withTransaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, businessId: actor.businessId } });
    if (!customer) throw AppError.notFound("Customer not found");
    return tx.customerNote.create({
      data: { customerId: customer.id, body: input.body, isPinned: input.isPinned ?? false, createdByUserId: actor.userId ?? null },
    });
  });
}

/** Customer-facing order list (only the authenticated customer's own orders). */
export async function listCustomerOrders(customerId: string) {
  return prisma.order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      grandTotalPaisa: true,
      duePaisa: true,
      placedAt: true,
      deliveredAt: true,
      items: { select: { productName: true, variantName: true, quantity: true, lineTotalPaisa: true, isPreorder: true } },
    },
  });
}

export async function getCustomerOrThrow(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    include: {
      addresses: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
      customerNotes: { orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }], take: 20 },
      sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" } },
    },
  });
  if (!customer) throw AppError.notFound("Customer not found");
  return customer;
}

/** Admin customer detail: identity, addresses, notes and recent orders. */
export async function getCustomerDetail(businessId: string, customerId: string) {
  const customer = await getCustomerOrThrow(businessId, customerId);
  const [orders, exchanges, verification] = await Promise.all([
    prisma.order.findMany({
      where: { customerId },
      orderBy: { placedAt: "desc" },
      take: 25,
      select: { id: true, orderNumber: true, status: true, paymentStatus: true, grandTotalPaisa: true, placedAt: true },
    }),
    prisma.exchangeRequest.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, exchangeNumber: true, status: true, differencePaisa: true, createdAt: true },
    }),
    prisma.verificationCode.findFirst({
      where: { customerId, consumedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, purpose: true },
    }),
  ]);

  return { customer, orders, exchanges, lastVerificationAt: verification?.createdAt ?? null };
}

/** Order tracking lookup for a verified customer or staff member. */
export async function getCustomerOrder(businessId: string, customerId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId, customerId },
    include: {
      items: true,
      shipments: { select: { id: true, status: true, trackingCode: true, providerCode: true, lastStatusAt: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: { select: { id: true, method: true, status: true, paidPaisa: true, createdAt: true } },
      exchanges: { select: { id: true, exchangeNumber: true, status: true, differencePaisa: true } },
    },
  });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}
