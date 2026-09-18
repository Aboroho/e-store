"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import type { ActionState } from "@/modules/auth/actions";
import {
  cancelOrderSchema,
  createOrderInputSchema,
  orderTransitionSchema,
  recordPaymentSchema,
  refundSchema,
} from "@/modules/orders/schemas";
import { cancelOrder, createOrder, dispatchOrder, markOrderDelivered, transitionOrder } from "@/modules/orders/service";
import { recordPayment, requestRefund, settleRefund } from "@/modules/payments/service";
import { recordCourierCharge, requeueShipmentCreate, refreshShipmentTracking, updateShipmentStatus } from "@/modules/couriers/service";

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return {
    businessId: session.businessId,
    userId: session.id,
    actorLabel: session.email,
    actorType: "USER" as const,
  };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [
            issue.path ?? "_",
            [issue.message ?? "Invalid value"],
          ]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Order action failed", error);
  return { status: "error", message: fallback };
}

function toPaisa(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100);
}

/** Staff-created order (admin, in-store counter or reseller order). */
export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.create");
  } catch (error) {
    return toState(error, "You are not allowed to create orders");
  }

  const raw = formDataToObject(formData);
  const variantIds = formData.getAll("itemVariantId").map(String).filter(Boolean);
  const items = variantIds.map((variantId, index) => ({
    variantId,
    quantity: Number(formData.getAll("itemQuantity")[index] ?? 1),
    unitPricePaisa: formData.getAll("itemUnitPrice")[index] ? toPaisa(formData.getAll("itemUnitPrice")[index]) : undefined,
    discountPaisa: formData.getAll("itemDiscount")[index] ? toPaisa(formData.getAll("itemDiscount")[index]) : 0,
    note: String(formData.getAll("itemNote")[index] ?? "").trim() || undefined,
  }));

  const chargeLabels = formData.getAll("chargeLabel").map(String);
  const extraCharges = chargeLabels
    .map((label, index) => ({
      label: label.trim(),
      amountPaisa: toPaisa(formData.getAll("chargeAmount")[index]),
      note: String(formData.getAll("chargeNote")[index] ?? "").trim() || undefined,
    }))
    .filter((charge) => charge.label.length >= 2 && charge.amountPaisa > 0);

  const parsed = parseInput(
    createOrderInputSchema,
    {
      channel: raw.channel || "ADMIN",
      storefrontId: raw.storefrontId || undefined,
      customerId: raw.customerId || undefined,
      customerName: String(raw.customerName ?? "").trim() || undefined,
      customerPhone: String(raw.customerPhone ?? "").trim() || undefined,
      customerEmail: String(raw.customerEmail ?? "").trim() || undefined,
      shippingDistrictCode: raw.shippingDistrictCode || undefined,
      shippingAddressLine: String(raw.shippingAddressLine ?? "").trim() || undefined,
      shippingArea: String(raw.shippingArea ?? "").trim() || undefined,
      deliveryZoneId: raw.deliveryZoneId || undefined,
      deliveryFeePaisa: raw.deliveryFeePaisa ? toPaisa(raw.deliveryFeePaisa) : undefined,
      discountTotalPaisa: toPaisa(raw.discountTotalPaisa),
      discountLabel: String(raw.discountLabel ?? "").trim() || undefined,
      extraCharges: extraCharges.length > 0 ? extraCharges : undefined,
      codSurchargePaisa: raw.codSurchargePaisa ? toPaisa(raw.codSurchargePaisa) : undefined,
      paymentMethod: raw.paymentMethod || "COD",
      markDelivered: raw.markDelivered === "on" || raw.markDelivered === "true",
      expectedDeliveryAt: raw.expectedDeliveryAt || undefined,
      customerNote: String(raw.customerNote ?? "").trim() || undefined,
      internalNote: String(raw.internalNote ?? "").trim() || undefined,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
      items,
    },
    "Create order",
  );

  let orderId: string;
  try {
    const result = await createOrder(context, parsed);
    orderId = result.order.id;
  } catch (error) {
    return toState(error, "Unable to create the order");
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/preorders");
  redirect(`/admin/orders/${orderId}?created=1`);
}

export async function transitionOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.update");
  } catch (error) {
    return toState(error, "You are not allowed to update orders");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    orderTransitionSchema,
    { orderId: String(raw.orderId ?? ""), status: String(raw.status ?? ""), note: String(raw.note ?? "").trim() || undefined },
    "Update order status",
  );

  try {
    await transitionOrder(context, parsed);
  } catch (error) {
    return toState(error, "Unable to update the order status");
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${parsed.orderId}`);
  return { status: "success", message: `Order moved to ${parsed.status.replace(/_/g, " ").toLowerCase()}` };
}

export async function cancelOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.cancel");
  } catch (error) {
    return toState(error, "You are not allowed to cancel orders");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    cancelOrderSchema,
    { orderId: raw.orderId, reason: raw.reason, restock: raw.restock !== "false" },
    "Cancel order",
  );

  try {
    const result = await cancelOrder(context, parsed);
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${parsed.orderId}`);
    revalidatePath("/admin/inventory");
    return {
      status: "success",
      message: `Order cancelled. Released ${result.releasedUnits} reserved unit(s)${result.restockedUnits > 0 ? ` and restocked ${result.restockedUnits}` : ""}.`,
    };
  } catch (error) {
    return toState(error, "Unable to cancel the order");
  }
}

export async function dispatchOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.dispatch");
  } catch (error) {
    return toState(error, "You are not allowed to dispatch orders");
  }

  const raw = formDataToObject(formData);
  const orderId = String(raw.orderId ?? "");
  if (!orderId) return { status: "error", message: "Missing order" };

  try {
    const result = await dispatchOrder(context, {
      orderId,
      courierProviderId: raw.courierProviderId ? String(raw.courierProviderId) : undefined,
      courierChargePaisa: raw.courierChargePaisa ? toPaisa(raw.courierChargePaisa) : 0,
      declaredWeightGrams: raw.declaredWeightGrams ? Number(raw.declaredWeightGrams) : undefined,
    });
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/shipments");
    return {
      status: "success",
      message: `Dispatched ${result.dispatchedUnits} unit(s) as ${result.shipment.internalCode}. The courier push runs in the background.`,
    };
  } catch (error) {
    return toState(error, "Unable to dispatch the order");
  }
}

export async function markDeliveredAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.deliver");
  } catch (error) {
    return toState(error, "You are not allowed to mark orders delivered");
  }

  const raw = formDataToObject(formData);
  const orderId = String(raw.orderId ?? "");
  try {
    await markOrderDelivered(context, orderId, raw.note ? String(raw.note) : undefined);
  } catch (error) {
    return toState(error, "Unable to mark the order delivered");
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { status: "success", message: "Order marked delivered" };
}

export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("payment.record");
  } catch (error) {
    return toState(error, "You are not allowed to record payments");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    recordPaymentSchema,
    {
      orderId: raw.orderId,
      amountPaisa: toPaisa(raw.amount),
      method: raw.method,
      providerReference: String(raw.providerReference ?? "").trim() || undefined,
      note: String(raw.note ?? "").trim() || undefined,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
    },
    "Record payment",
  );

  try {
    const result = await recordPayment(context, parsed);
    revalidatePath(`/admin/orders/${parsed.orderId}`);
    revalidatePath("/admin/orders");
    return {
      status: "success",
      message: result.reused
        ? "That payment was already recorded"
        : `Payment of ${formatPaisa(parsed.amountPaisa)} recorded (${result.order.paymentStatus.toLowerCase().replace(/_/g, " ")})`,
    };
  } catch (error) {
    return toState(error, "Unable to record the payment");
  }
}

export async function refundPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("payment.refund");
  } catch (error) {
    return toState(error, "You are not allowed to issue refunds");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    refundSchema,
    {
      orderId: raw.orderId,
      paymentId: raw.paymentId || undefined,
      amountPaisa: toPaisa(raw.amount),
      method: raw.method || "MANUAL",
      reason: raw.reason,
      note: String(raw.note ?? "").trim() || undefined,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || undefined,
    },
    "Refund payment",
  );

  try {
    const request = await requestRefund(context, parsed);
    if (parsed.method === "MANUAL" || parsed.method === "CASH") {
      await settleRefund(context, { refundId: request.refund.id, providerReference: "manual" });
    }
    revalidatePath(`/admin/orders/${parsed.orderId}`);
    return {
      status: "success",
      message:
        parsed.method === "BKASH" || parsed.method === "SSLCOMMERZ"
          ? `Refund of ${formatPaisa(parsed.amountPaisa)} queued — process it with the provider and mark it complete`
          : `Refund of ${formatPaisa(parsed.amountPaisa)} recorded`,
    };
  } catch (error) {
    return toState(error, "Unable to record the refund");
  }
}

export async function settleRefundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("payment.refund");
  } catch (error) {
    return toState(error, "You are not allowed to settle refunds");
  }

  const raw = formDataToObject(formData);
  try {
    await settleRefund(context, {
      refundId: String(raw.refundId ?? ""),
      providerReference: raw.providerReference ? String(raw.providerReference) : undefined,
      failed: raw.failed === "on" || raw.failed === "true",
      failureReason: raw.failureReason ? String(raw.failureReason) : undefined,
    });
  } catch (error) {
    return toState(error, "Unable to settle the refund");
  }

  revalidatePath(`/admin/orders/${raw.orderId ?? ""}`);
  return { status: "success", message: "Refund updated" };
}

export async function refreshShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.view");
  } catch (error) {
    return toState(error, "You are not allowed to refresh shipments");
  }

  const raw = formDataToObject(formData);
  try {
    const result = await refreshShipmentTracking(context, String(raw.shipmentId ?? ""));
    revalidatePath("/admin/shipments");
    revalidatePath(`/admin/shipments/${raw.shipmentId}`);
    return { status: "success", message: result.message };
  } catch (error) {
    return toState(error, "Unable to refresh the shipment");
  }
}

export async function requeueShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.dispatch");
  } catch (error) {
    return toState(error, "You are not allowed to push shipments");
  }

  const raw = formDataToObject(formData);
  try {
    await requeueShipmentCreate(context, String(raw.shipmentId ?? ""));
  } catch (error) {
    return toState(error, "Unable to queue the shipment");
  }

  revalidatePath("/admin/shipments");
  revalidatePath(`/admin/shipments/${raw.shipmentId}`);
  return { status: "success", message: "Shipment queued for the courier. The worker will retry it." };
}

export async function updateShipmentStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("order.deliver");
  } catch (error) {
    return toState(error, "You are not allowed to update shipments");
  }

  const raw = formDataToObject(formData);
  const shipmentId = String(raw.shipmentId ?? "");
  const status = String(raw.status ?? "") as "PICKED_UP";
  if (!shipmentId || !status) return { status: "error", message: "Choose a status" };

  try {
    await updateShipmentStatus({
      shipmentId,
      status,
      note: raw.note ? String(raw.note) : "Updated manually",
      source: "MANUAL",
      actorUserId: context.userId,
    });
  } catch (error) {
    return toState(error, "Unable to update the shipment");
  }

  revalidatePath("/admin/shipments");
  revalidatePath(`/admin/shipments/${shipmentId}`);
  return { status: "success", message: `Shipment marked ${status.replace(/_/g, " ").toLowerCase()}` };
}

export async function recordCourierChargeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.manage");
  } catch (error) {
    return toState(error, "You are not allowed to record courier charges");
  }

  const raw = formDataToObject(formData);
  const shipmentId = String(raw.shipmentId ?? "");
  try {
    await recordCourierCharge(context, {
      shipmentId,
      type: (raw.type as "DELIVERY") || "DELIVERY",
      amountPaisa: toPaisa(raw.amount),
      codChargePaisa: raw.codCharge ? toPaisa(raw.codCharge) : 0,
      note: raw.note ? String(raw.note) : undefined,
    });
  } catch (error) {
    return toState(error, "Unable to record the courier charge");
  }

  revalidatePath(`/admin/shipments/${shipmentId}`);
  return { status: "success", message: "Courier charge recorded" };
}
