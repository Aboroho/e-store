"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import { parseAmountToPaisa } from "@/lib/money";
import type { ActionState } from "@/modules/auth/actions";
import {
  applyResellerMarkup,
  createReseller,
  createResellerOrder,
  recordCollectionChange,
  setResellerStatus,
  updateReseller,
  removeResellerPrice,
  setResellerPrice,
} from "./service";
import { refreshResellerEligibility, recordLedgerAdjustment } from "./earnings";
import { approvePayout, cancelPayout, createPayout, failPayout, markPayoutPaid } from "./payouts";
import {
  payoutCancelSchema,
  payoutFailSchema,
  payoutPaidSchema,
  resellerCollectionInputSchema,
  resellerInputSchema,
  resellerLedgerAdjustmentSchema,
  resellerOrderInputSchema,
  resellerPayoutInputSchema,
  resellerPriceBulkSchema,
  resellerPriceInputSchema,
  resellerStatusSchema,
} from "./schemas";

/**
 * Reseller actions.
 *
 * Every action asserts its permission server-side and converts `AppError` into
 * field-level feedback, so the UI never decides what is allowed.
 */

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" as const };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? "_", [issue.message ?? "Invalid value"]]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Reseller action failed", error);
  return { status: "error", message: fallback };
}

function revalidateReseller(resellerId?: string) {
  revalidatePath("/admin/resellers");
  if (resellerId) {
    revalidatePath(`/admin/resellers/${resellerId}`);
    revalidatePath(`/admin/resellers/${resellerId}/pricing`);
  }
  revalidatePath("/admin/payouts");
}

function readReseller(raw: Record<string, string | string[]>) {
  const value = (key: string) => {
    const raw_value = raw[key];
    return Array.isArray(raw_value) ? raw_value[0] : raw_value;
  };
  return resellerInputSchema.parse({
    name: String(value("name") ?? ""),
    code: String(value("code") ?? "").trim() || undefined,
    businessName: String(value("businessName") ?? "").trim() || undefined,
    phone: String(value("phone") ?? "").trim() || undefined,
    email: String(value("email") ?? "").trim() || undefined,
    status: value("status") ?? "ACTIVE",
    commissionType: value("commissionType") ?? "MARGIN_BASED",
    commissionValue: Number(value("commissionValue") ?? 0),
    packagingIncluded: value("packagingIncluded") !== "false",
    packagingCostPaisa: parseAmountToPaisa(value("packagingCost") ?? "0"),
    deliveryChargePaisa: parseAmountToPaisa(value("deliveryCharge") ?? "0"),
    codChargePaisa: parseAmountToPaisa(value("codCharge") ?? "0"),
    defaultDistrictCode: String(value("defaultDistrictCode") ?? "").trim() || undefined,
    address: String(value("address") ?? "").trim() || undefined,
    nidNumber: String(value("nidNumber") ?? "").trim() || undefined,
    payoutMethod: value("payoutMethod") ?? "BKASH",
    payoutAccountNumber: String(value("payoutAccountNumber") ?? "").trim() || undefined,
    payoutAccountName: String(value("payoutAccountName") ?? "").trim() || undefined,
    minimumPayoutPaisa: parseAmountToPaisa(value("minimumPayout") ?? "0"),
    creditLimitPaisa: parseAmountToPaisa(value("creditLimit") ?? "0"),
    note: String(value("note") ?? "").trim() || undefined,
  });
}

export async function createResellerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage resellers");
  }

  try {
    const input = readReseller(formDataToObject(formData));
    const { reseller } = await createReseller(context, input);
    revalidateReseller(reseller.id);
    return { status: "success", message: `Reseller ${reseller.code} created`, data: { resellerId: reseller.id } };
  } catch (error) {
    return toState(error, "Unable to create the reseller");
  }
}

export async function updateResellerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage resellers");
  }

  const raw = formDataToObject(formData);
  const resellerId = String(raw.resellerId ?? "");

  try {
    const input = readReseller(raw);
    const reseller = await updateReseller(context, { ...input, resellerId });
    revalidateReseller(reseller.id);
    return { status: "success", message: `Reseller ${reseller.code} updated` };
  } catch (error) {
    return toState(error, "Unable to update the reseller");
  }
}

export async function setResellerStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage resellers");
  }

  const raw = formDataToObject(formData);
  try {
    const status = resellerStatusSchema.parse(String(raw.status ?? ""));
    const reseller = await setResellerStatus(context, {
      resellerId: String(raw.resellerId ?? ""),
      status,
      reason: String(raw.reason ?? "").trim() || null,
    });
    revalidateReseller(reseller.id);
    return { status: "success", message: `Reseller ${reseller.code} is now ${status.toLowerCase()}` };
  } catch (error) {
    return toState(error, "Unable to change the reseller status");
  }
}

/** Set one negotiated price for a reseller. */
export async function setResellerPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage reseller pricing");
  }

  const raw = formDataToObject(formData);
  try {
    const input = resellerPriceInputSchema.parse({
      resellerId: String(raw.resellerId ?? ""),
      variantId: String(raw.variantId ?? ""),
      pricePaisa: parseAmountToPaisa(String(raw.price ?? "0")),
      minQuantity: Number(raw.minQuantity ?? 1),
    });
    await setResellerPrice(context, input);
    revalidateReseller(input.resellerId);
    return { status: "success", message: "Reseller price saved" };
  } catch (error) {
    return toState(error, "Unable to save the reseller price");
  }
}

export async function removeResellerPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage reseller pricing");
  }

  const raw = formDataToObject(formData);
  const resellerId = String(raw.resellerId ?? "");
  try {
    await removeResellerPrice(context, { resellerId, itemId: String(raw.itemId ?? "") });
    revalidateReseller(resellerId);
    return { status: "success", message: "Price override removed — the default list applies again" };
  } catch (error) {
    return toState(error, "Unable to remove the price");
  }
}

export async function applyResellerMarkupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage reseller pricing");
  }

  const raw = formDataToObject(formData);
  try {
    const input = resellerPriceBulkSchema.parse({
      resellerId: String(raw.resellerId ?? ""),
      markupBps: Math.round(Number(raw.markupPercent ?? 0) * 100),
      onlyMissing: raw.onlyMissing !== "false",
    });
    const result = await applyResellerMarkup(context, input);
    revalidateReseller(input.resellerId);
    return { status: "success", message: `Markup applied: ${result.created} price(s) created, ${result.updated} updated` };
  } catch (error) {
    return toState(error, "Unable to apply the markup");
  }
}

export async function createResellerOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.create");
  } catch (error) {
    return toState(error, "You are not allowed to create orders");
  }

  const raw = formDataToObject(formData);
  const variantIds = Array.isArray(raw.itemVariantId) ? raw.itemVariantId : raw.itemVariantId ? [raw.itemVariantId] : [];
  const quantities = Array.isArray(raw.itemQuantity) ? raw.itemQuantity : raw.itemQuantity ? [raw.itemQuantity] : [];

  try {
    const input = resellerOrderInputSchema.parse({
      resellerId: String(raw.resellerId ?? ""),
      customerName: String(raw.customerName ?? "").trim(),
      customerPhone: String(raw.customerPhone ?? "").trim(),
      customerEmail: String(raw.customerEmail ?? "").trim() || undefined,
      shippingDistrictCode: String(raw.shippingDistrictCode ?? "").trim(),
      shippingAddressLine: String(raw.shippingAddressLine ?? "").trim(),
      shippingArea: String(raw.shippingArea ?? "").trim() || undefined,
      deliveryNotes: String(raw.deliveryNotes ?? "").trim() || undefined,
      collectionPaisa: raw.collection ? parseAmountToPaisa(String(raw.collection)) : undefined,
      internalNote: String(raw.internalNote ?? "").trim() || undefined,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
      items: variantIds.map((variantId, index) => ({
        variantId: String(variantId),
        quantity: Number(quantities[index] ?? 1),
        discountPaisa: 0,
      })),
    });

    const result = await createResellerOrder(context, input);
    revalidatePath("/admin/resellers");
    revalidatePath(`/admin/resellers/${input.resellerId}`);
    revalidatePath("/admin/orders");
    return {
      status: "success",
      message: `Order ${result.order.orderNumber} created — collecting ${result.collectionPaisa / 100} BDT, earnings snapshot recorded`,
      data: { orderId: result.order.id },
    };
  } catch (error) {
    return toState(error, "Unable to create the reseller order");
  }
}

export async function recordCollectionChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.manage");
  } catch (error) {
    return toState(error, "You are not allowed to change collection amounts");
  }

  const raw = formDataToObject(formData);
  try {
    const input = resellerCollectionInputSchema.parse({
      orderId: String(raw.orderId ?? ""),
      amountPaisa: parseAmountToPaisa(String(raw.amount ?? "0")),
      reason: String(raw.reason ?? "").trim() || undefined,
    });
    const order = await recordCollectionChange(context, input);
    revalidateReseller(order.resellerId ?? undefined);
    revalidatePath(`/admin/orders/${order.id}`);
    return { status: "success", message: `Collection amount recorded: ${(input.amountPaisa / 100).toFixed(2)} BDT` };
  } catch (error) {
    return toState(error, "Unable to record the collection change");
  }
}

export async function recordResellerAdjustmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to adjust the reseller ledger");
  }

  const raw = formDataToObject(formData);
  try {
    const sign = String(raw.direction ?? "CREDIT") === "DEBIT" ? -1 : 1;
    const input = resellerLedgerAdjustmentSchema.parse({
      resellerId: String(raw.resellerId ?? ""),
      amountPaisa: sign * parseAmountToPaisa(String(raw.amount ?? "0")),
      description: String(raw.description ?? "").trim(),
      reason: String(raw.reason ?? "").trim() || undefined,
    });
    await recordLedgerAdjustment(context, input);
    revalidateReseller(input.resellerId);
    return { status: "success", message: "Ledger adjustment recorded" };
  } catch (error) {
    return toState(error, "Unable to record the adjustment");
  }
}

export async function refreshEligibilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.ledger_view");
  } catch (error) {
    return toState(error, "You are not allowed to refresh reseller eligibility");
  }

  const raw = formDataToObject(formData);
  const resellerId = String(raw.resellerId ?? "") || undefined;
  try {
    const result = await refreshResellerEligibility(context.businessId, { resellerId });
    revalidateReseller(resellerId);
    return {
      status: "success",
      message:
        result.promoted > 0
          ? `${result.promoted} ledger entr${result.promoted === 1 ? "y" : "ies"} became payable`
          : "Nothing changed — no settled/resolved collection is waiting",
    };
  } catch (error) {
    return toState(error, "Unable to refresh eligibility");
  }
}

// ------------------------------------------------------------------ payouts

export async function createPayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to create payouts");
  }

  const raw = formDataToObject(formData);
  const selected = raw.ledgerEntryId ? (Array.isArray(raw.ledgerEntryId) ? raw.ledgerEntryId : [raw.ledgerEntryId]) : undefined;

  try {
    const input = resellerPayoutInputSchema.parse({
      resellerId: String(raw.resellerId ?? ""),
      ledgerEntryIds: selected?.map((id) => String(id)),
      periodStart: String(raw.periodStart ?? "").trim() || undefined,
      periodEnd: String(raw.periodEnd ?? "").trim() || undefined,
      method: raw.method ?? "BKASH",
      accountNumber: String(raw.accountNumber ?? "").trim() || undefined,
      accountName: String(raw.accountName ?? "").trim() || undefined,
      note: String(raw.note ?? "").trim() || undefined,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
    });

    const result = await createPayout(context, input);
    revalidateReseller(input.resellerId);
    revalidatePath(`/admin/payouts/${result.payout.id}`);
    return {
      status: "success",
      message: `Payout ${result.payout.payoutNumber} created for ${(result.payout.amountPaisa / 100).toFixed(2)} BDT`,
      data: { payoutId: result.payout.id },
    };
  } catch (error) {
    return toState(error, "Unable to create the payout");
  }
}

export async function approvePayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to approve payouts");
  }

  const raw = formDataToObject(formData);
  try {
    const payout = await approvePayout(context, { payoutId: String(raw.payoutId ?? ""), note: String(raw.note ?? "").trim() || null });
    revalidateReseller(payout.resellerId);
    revalidatePath(`/admin/payouts/${payout.id}`);
    return { status: "success", message: `Payout ${payout.payoutNumber} approved` };
  } catch (error) {
    return toState(error, "Unable to approve the payout");
  }
}

export async function markPayoutPaidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to pay out");
  }

  const raw = formDataToObject(formData);
  try {
    const input = payoutPaidSchema.parse({
      payoutId: String(raw.payoutId ?? ""),
      transactionReference: String(raw.transactionReference ?? "").trim(),
      paidAt: String(raw.paidAt ?? "").trim() || undefined,
      note: String(raw.note ?? "").trim() || undefined,
    });
    const payout = await markPayoutPaid(context, {
      payoutId: input.payoutId,
      transactionReference: input.transactionReference,
      paidAt: input.paidAt,
      note: input.note ?? null,
    });
    revalidateReseller(payout.resellerId);
    revalidatePath(`/admin/payouts/${payout.id}`);
    return { status: "success", message: `Payout ${payout.payoutNumber} marked as paid` };
  } catch (error) {
    return toState(error, "Unable to mark the payout as paid");
  }
}

export async function cancelPayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to cancel payouts");
  }

  const raw = formDataToObject(formData);
  try {
    const input = payoutCancelSchema.parse({ payoutId: String(raw.payoutId ?? ""), reason: String(raw.reason ?? "").trim() });
    const payout = await cancelPayout(context, input);
    revalidateReseller(payout.resellerId);
    revalidatePath(`/admin/payouts/${payout.id}`);
    return { status: "success", message: `Payout ${payout.payoutNumber} cancelled and its ledger entries released` };
  } catch (error) {
    return toState(error, "Unable to cancel the payout");
  }
}

export async function failPayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("reseller.payout");
  } catch (error) {
    return toState(error, "You are not allowed to manage payouts");
  }

  const raw = formDataToObject(formData);
  try {
    const input = payoutFailSchema.parse({ payoutId: String(raw.payoutId ?? ""), reason: String(raw.reason ?? "").trim() });
    const payout = await failPayout(context, input);
    revalidateReseller(payout.resellerId);
    revalidatePath(`/admin/payouts/${payout.id}`);
    return { status: "success", message: `Payout ${payout.payoutNumber} marked as failed` };
  } catch (error) {
    return toState(error, "Unable to mark the payout as failed");
  }
}
