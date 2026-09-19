"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import type { ActionState } from "@/modules/auth/action-state";
import {
  createExchangeInputSchema,
  exchangeDecisionInputSchema,
  inspectExchangeInputSchema,
} from "@/modules/exchanges/schemas";
import {
  approveExchange,
  cancelExchange,
  completeExchange,
  createExchangeRequest,
  inspectExchange,
  recordExchangeCollection,
} from "@/modules/exchanges/service";
import { moveExchangeStatus } from "@/modules/exchanges/service";

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" as const };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Exchange action failed", error);
  return { status: "error", message: fallback };
}

function toPaisa(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100);
}

export async function createExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.create");
  } catch (error) {
    return toState(error, "You are not allowed to create exchanges");
  }

  let exchangeId: string;
  try {
    const raw = formDataToObject(formData);
    const returnItems = formData.getAll("returnItemId").map(String).filter(Boolean);
    const returnQuantities = formData.getAll("returnQuantity").map((value) => Number(value ?? 0));
    const replacementVariants = formData.getAll("replacementVariantId").map(String).filter(Boolean);
    const replacementQuantities = formData.getAll("replacementQuantity").map((value) => Number(value ?? 0));

    const parsed = parseInput(
      createExchangeInputSchema,
      {
        orderId: String(raw.orderId ?? ""),
        reasonCode: String(raw.reasonCode ?? ""),
        reasonNote: String(raw.reasonNote ?? "").trim() || undefined,
        channel: raw.channel === "CUSTOMER" ? "CUSTOMER" : "STAFF",
        returnItems: returnItems.map((orderItemId, index) => ({ orderItemId, variantId: orderItemId, quantity: returnQuantities[index] ?? 0 })),
        replacementItems: replacementVariants.map((variantId, index) => ({ variantId, quantity: replacementQuantities[index] ?? 0 })),
        deliveryChargePaisa: raw.deliveryChargePaisa ? toPaisa(raw.deliveryChargePaisa) : undefined,
        additionalChargePaisa: raw.additionalChargePaisa ? toPaisa(raw.additionalChargePaisa) : undefined,
        discountPaisa: raw.discountPaisa ? toPaisa(raw.discountPaisa) : undefined,
        internalNote: String(raw.internalNote ?? "").trim() || undefined,
        idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
      },
      "Create exchange",
    );

    // The variant for a returned line is always the variant on the original order
    // item; the service resolves it from the order, so the placeholder id is fine.
    const input = {
      ...parsed,
      returnItems: parsed.returnItems.map((item) => ({ ...item, variantId: item.variantId })),
    };

    const result = await createExchangeRequest(context, input);
    exchangeId = result.exchange.id;
  } catch (error) {
    return toState(error, "Unable to create the exchange");
  }

  revalidatePath("/admin/exchanges");
  redirect(`/admin/exchanges/${exchangeId}?created=1`);
}

export async function approveExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.approve");
  } catch (error) {
    return toState(error, "You are not allowed to approve exchanges");
  }

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(exchangeDecisionInputSchema, { exchangeId: String(raw.exchangeId ?? ""), reason: undefined }, "Approve exchange");
    await approveExchange(context, { exchangeId: parsed.exchangeId, note: String(raw.note ?? "").trim() || null });
    revalidatePath("/admin/exchanges");
    revalidatePath(`/admin/exchanges/${parsed.exchangeId}`);
    return { status: "success", message: "Exchange approved and replacement stock reserved" };
  } catch (error) {
    return toState(error, "Unable to approve the exchange");
  }
}

export async function rejectExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.approve");
  } catch (error) {
    return toState(error, "You are not allowed to reject exchanges");
  }

  const raw = formDataToObject(formData);
  const exchangeId = String(raw.exchangeId ?? "");
  const reason = String(raw.reason ?? "").trim();
  if (reason.length < 3) return { status: "error", message: "Explain why the exchange is rejected" };

  try {
    await moveExchangeStatus(context, { exchangeId, from: ["REQUESTED"], to: "REJECTED", note: reason });
  } catch (error) {
    return toState(error, "Unable to reject the exchange");
  }

  revalidatePath("/admin/exchanges");
  revalidatePath(`/admin/exchanges/${exchangeId}`);
  return { status: "success", message: "Exchange rejected" };
}

export async function receiveExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.inspect");
  } catch (error) {
    return toState(error, "You are not allowed to receive exchanges");
  }

  const raw = formDataToObject(formData);
  const exchangeId = String(raw.exchangeId ?? "");
  try {
    await moveExchangeStatus(context, { exchangeId, from: ["APPROVED", "IN_TRANSIT"], to: "RECEIVED", note: "Returned items received" });
  } catch (error) {
    return toState(error, "Unable to mark the exchange received");
  }

  revalidatePath(`/admin/exchanges/${exchangeId}`);
  return { status: "success", message: "Returned items received — record the inspection next" };
}

export async function inspectExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.inspect");
  } catch (error) {
    return toState(error, "You are not allowed to inspect exchanges");
  }

  try {
    const raw = formDataToObject(formData);
    const itemIds = formData.getAll("inspectItemId").map(String);
    const outcomes = formData.getAll("inspectOutcome").map(String);
    const notes = formData.getAll("inspectNote").map(String);
    const quantities = formData.getAll("inspectQuantity").map((value) => Number(value ?? 0));

    const parsed = parseInput(
      inspectExchangeInputSchema,
      {
        exchangeId: String(raw.exchangeId ?? ""),
        items: itemIds.map((itemId, index) => ({
          itemId,
          outcome: outcomes[index],
          quantity: quantities[index] && quantities[index] > 0 ? quantities[index] : undefined,
          note: notes[index]?.trim() || undefined,
        })),
      },
      "Inspect exchange",
    );

    const result = await inspectExchange(context, parsed);
    revalidatePath(`/admin/exchanges/${parsed.exchangeId}`);
    revalidatePath("/admin/inventory");
    return {
      status: "success",
      message: result.pendingItems > 0
        ? `${result.pendingItems} item(s) still need an inspection decision`
        : `Inspection recorded: ${result.restocked} unit(s) back to sellable stock, ${result.damaged} damaged`,
    };
  } catch (error) {
    return toState(error, "Unable to record the inspection");
  }
}

export async function completeExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.approve");
  } catch (error) {
    return toState(error, "You are not allowed to complete exchanges");
  }

  const raw = formDataToObject(formData);
  const exchangeId = String(raw.exchangeId ?? "");

  try {
    const exchange = await completeExchange(context, { exchangeId, note: String(raw.note ?? "").trim() || null });
    revalidatePath("/admin/exchanges");
    revalidatePath(`/admin/exchanges/${exchangeId}`);
    revalidatePath("/admin/inventory");
    return {
      status: "success",
      message:
        exchange.differencePaisa > 0
          ? `Exchange completed. Collect ${formatPaisa(exchange.differencePaisa)} from the customer.`
          : exchange.differencePaisa < 0
            ? `Exchange completed. Refund ${formatPaisa(Math.abs(exchange.differencePaisa))} to the customer.`
            : "Exchange completed with no money due",
    };
  } catch (error) {
    return toState(error, "Unable to complete the exchange");
  }
}

export async function cancelExchangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("exchange.approve");
  } catch (error) {
    return toState(error, "You are not allowed to cancel exchanges");
  }

  const raw = formDataToObject(formData);
  const exchangeId = String(raw.exchangeId ?? "");
  const reason = String(raw.reason ?? "").trim();
  if (reason.length < 3) return { status: "error", message: "Enter a cancellation reason" };

  try {
    const result = await cancelExchange(context, { exchangeId, reason });
    revalidatePath("/admin/exchanges");
    revalidatePath(`/admin/exchanges/${exchangeId}`);
    return { status: "success", message: `Exchange cancelled (${result.releasedUnits} reserved unit(s) released)` };
  } catch (error) {
    return toState(error, "Unable to cancel the exchange");
  }
}

export async function recordExchangeCollectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("payment.record");
  } catch (error) {
    return toState(error, "You are not allowed to record payments");
  }

  const raw = formDataToObject(formData);
  const exchangeId = String(raw.exchangeId ?? "");
  try {
    await recordExchangeCollection(context, {
      exchangeId,
      method: (raw.method as "CASH") ?? "CASH",
      amountPaisa: raw.amount ? toPaisa(raw.amount) : undefined,
      reference: String(raw.reference ?? "").trim() || null,
    });
  } catch (error) {
    return toState(error, "Unable to record the collection");
  }

  revalidatePath(`/admin/exchanges/${exchangeId}`);
  return { status: "success", message: "Collection recorded" };
}
