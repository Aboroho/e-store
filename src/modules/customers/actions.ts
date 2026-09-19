"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/lib/audit";
import { setIntegrationSecret } from "@/modules/integrations/secrets";
import type { ActionState } from "@/modules/auth/actions";
import {
  customerAddressSchema,
  customerNoteSchema,
  customerStatusSchema,
  customerIdentitySchema,
} from "@/modules/customers/schemas";
import {
  addCustomerNote,
  confirmVerificationCode,
  findOrCreateCustomer,
  requestVerificationCode,
  saveCustomerAddress,
  setCustomerStatus,
  signOutCustomer,
  updateCustomer,
} from "@/modules/customers/service";
import { setCustomerSessionCookie, clearCustomerSessionCookie } from "@/lib/auth/customer-session";
import { cancelOrder } from "@/modules/orders/service";

/**
 * Customer actions.
 *
 * Two audiences share this file: staff (create/update/verify customers from the
 * admin screens) and the customer themselves (the public checkout/account flow).
 * Every staff action is permission checked; the public ones only ever create or
 * verify an identity.
 */

async function staffActor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" as const };
}

async function publicBusinessId(): Promise<string> {
  const business = await prisma.business.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!business) throw AppError.internal("No business is configured");
  return business.id;
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Customer action failed", error);
  return { status: "error", message: fallback };
}

// ------------------------------------------------------------------ staff flow

export async function createCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.update");
  } catch (error) {
    return toState(error, "You are not allowed to manage customers");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    customerIdentitySchema,
    {
      name: String(raw.name ?? ""),
      phone: String(raw.phone ?? ""),
      email: String(raw.email ?? "").trim() || undefined,
      districtCode: String(raw.districtCode ?? "").trim() || undefined,
      addressLine: String(raw.addressLine ?? "").trim() || undefined,
      area: String(raw.area ?? "").trim() || undefined,
      note: String(raw.note ?? "").trim() || undefined,
    },
    "Create customer",
  );

  try {
    const customer = await prisma.$transaction((tx) =>
      findOrCreateCustomer(tx, { ...parsed, businessId: context.businessId, createdByUserId: context.userId }),
    );
    await recordAudit({
      businessId: context.businessId,
      actorType: "USER",
      actorUserId: context.userId,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer.id,
      summary: `Customer ${customer.phoneNormalized} saved`,
    });
    revalidatePath("/admin/customers");
    return { status: "success", message: `${customer.name} saved` };
  } catch (error) {
    return toState(error, "Unable to save the customer");
  }
}

export async function updateCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.update");
  } catch (error) {
    return toState(error, "You are not allowed to update customers");
  }

  const raw = formDataToObject(formData);
  try {
    await updateCustomer(context, {
      customerId: String(raw.customerId ?? ""),
      name: String(raw.name ?? "").trim() || undefined,
      email: raw.email !== undefined ? String(raw.email).trim() || null : undefined,
      districtCode: raw.districtCode !== undefined ? String(raw.districtCode).trim() || null : undefined,
      addressLine: raw.addressLine !== undefined ? String(raw.addressLine).trim() || null : undefined,
      area: raw.area !== undefined ? String(raw.area).trim() || null : undefined,
      notes: raw.notes !== undefined ? String(raw.notes).trim() || null : undefined,
      tags: raw.tags ? String(raw.tags).split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
    });
  } catch (error) {
    return toState(error, "Unable to update the customer");
  }

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${raw.customerId}`);
  return { status: "success", message: "Customer updated" };
}

export async function customerStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.update");
  } catch (error) {
    return toState(error, "You are not allowed to update customers");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    customerStatusSchema,
    { customerId: String(raw.customerId ?? ""), status: raw.status, reason: String(raw.reason ?? "").trim() || undefined },
    "Update customer status",
  );

  try {
    await setCustomerStatus(context, parsed);
  } catch (error) {
    return toState(error, "Unable to update the customer status");
  }

  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${parsed.customerId}`);
  return { status: "success", message: parsed.status === "BLOCKED" ? "Customer blocked and sessions revoked" : "Customer reactivated" };
}

export async function addCustomerNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.update");
  } catch (error) {
    return toState(error, "You are not allowed to annotate customers");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    customerNoteSchema,
    {
      customerId: String(raw.customerId ?? ""),
      body: String(raw.body ?? ""),
      isPinned: raw.isPinned === "on" || raw.isPinned === "true",
    },
    "Add customer note",
  );

  try {
    await addCustomerNote(context, parsed);
  } catch (error) {
    return toState(error, "Unable to add the note");
  }

  revalidatePath(`/admin/customers/${parsed.customerId}`);
  return { status: "success", message: "Note added" };
}

export async function saveCustomerAddressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.update");
  } catch (error) {
    return toState(error, "You are not allowed to update customers");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    customerAddressSchema,
    {
      customerId: String(raw.customerId ?? ""),
      label: String(raw.label ?? "").trim() || undefined,
      recipientName: String(raw.recipientName ?? ""),
      phone: String(raw.phone ?? ""),
      districtCode: String(raw.districtCode ?? "").trim() || undefined,
      addressLine: String(raw.addressLine ?? ""),
      area: String(raw.area ?? "").trim() || undefined,
      postcode: String(raw.postcode ?? "").trim() || undefined,
      isDefault: raw.isDefault === "on" || raw.isDefault === "true",
    },
    "Save address",
  );

  try {
    await saveCustomerAddress(context, parsed);
  } catch (error) {
    return toState(error, "Unable to save the address");
  }

  revalidatePath(`/admin/customers/${parsed.customerId}`);
  return { status: "success", message: "Address saved" };
}

/**
 * Staff-assisted verification: the code is shown once to the signed-in staff
 * member (never to the public flow) so they can read it to the customer over a
 * channel they trust. The action itself is audited.
 */
export async function issueCustomerVerificationCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("customer.view");
  } catch (error) {
    return toState(error, "You are not allowed to verify customers");
  }

  const raw = formDataToObject(formData);
  try {
    const result = await requestVerificationCode({
      businessId: context.businessId,
      phone: String(raw.phone ?? ""),
      purpose: "PHONE_VERIFY",
      staffAssisted: true,
      actorUserId: context.userId,
    });

    revalidatePath(`/admin/customers/${raw.customerId ?? ""}`);
    return {
      status: "success",
      message: `Code ${result.codeForStaff} — valid for 10 minutes. Read it to the customer; it will not be shown again.`,
    };
  } catch (error) {
    return toState(error, "Unable to issue a verification code");
  }
}

export async function saveSmsGatewayCredentialAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof staffActor>>;
  try {
    context = await staffActor("integration.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage integrations");
  }

  const raw = formDataToObject(formData);
  const key = String(raw.key ?? "").trim();
  const value = String(raw.value ?? "").trim();
  if (!key || !value) return { status: "error", message: "Enter both the credential name and its value" };

  try {
    const integration = await prisma.integration.findFirst({ where: { businessId: context.businessId, kind: "OTHER", provider: "sms" } });
    const row =
      integration ??
      (await prisma.integration.create({
        data: {
          businessId: context.businessId,
          kind: "OTHER",
          provider: "sms",
          name: "SMS gateway",
          scopeKey: "",
          isEnabled: true,
          createdByUserId: context.userId,
        },
      }));

    await setIntegrationSecret({ integrationId: row.id, key, plaintext: value, updatedByUserId: context.userId });
  } catch (error) {
    return toState(error, "Unable to save the SMS credential");
  }

  revalidatePath("/admin/settings");
  return { status: "success", message: "SMS credential saved" };
}

// --------------------------------------------------------------- public flow

export async function requestCustomerCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formDataToObject(formData);
  try {
    const businessId = await publicBusinessId();
    const result = await requestVerificationCode({
      businessId,
      phone: String(raw.phone ?? ""),
      purpose: "LOGIN",
      staffAssisted: false,
    });
    return { status: "success", message: result.message };
  } catch (error) {
    return toState(error, "Unable to request a code");
  }
}

export async function confirmCustomerCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formDataToObject(formData);
  try {
    const businessId = await publicBusinessId();
    const verified = await confirmVerificationCode({
      businessId,
      phone: String(raw.phone ?? ""),
      code: String(raw.code ?? ""),
      purpose: "LOGIN",
    });
    await setCustomerSessionCookie(verified.sessionToken, verified.expiresAt);
  } catch (error) {
    return toState(error, "Unable to sign you in");
  }

  revalidatePath("/account");
  return { status: "success", message: "Signed in" };
}

/**
 * Customer cancels an order from their account. Only their own order, only
 * before it ships, and reservations are released through the order service.
 */
export async function cancelCustomerOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { getCustomerSession } = await import("@/lib/auth/customer-session");
  const session = await getCustomerSession();
  if (!session) return { status: "error", message: "Please sign in again" };

  const raw = formDataToObject(formData);
  const orderId = String(raw.orderId ?? "");
  const reason = String(raw.reason ?? "").trim() || "Cancelled by the customer from their account";

  try {
    const order = await prisma.order.findFirst({ where: { id: orderId, businessId: session.businessId, customerId: session.id } });
    if (!order) throw AppError.notFound("Order not found");

    await cancelOrder(
      { businessId: session.businessId, customerId: session.id, actorType: "CUSTOMER", actorLabel: session.phoneNormalized },
      { orderId, reason, restock: false },
    );
  } catch (error) {
    return toState(error, "We could not cancel this order");
  }

  revalidatePath("/account");
  revalidatePath(`/account/orders/${orderId}`);
  return { status: "success", message: "Order cancelled" };
}

export async function customerSignOutAction(): Promise<void> {
  const { getCustomerSession } = await import("@/lib/auth/customer-session");
  const session = await getCustomerSession();
  if (session) await signOutCustomer(session.sessionId);
  await clearCustomerSessionCookie();
  revalidatePath("/account");
}
