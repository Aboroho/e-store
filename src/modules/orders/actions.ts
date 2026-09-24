"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import type { ActionState } from "@/modules/auth/action-state";
import { recordPaymentSchema, refundSchema } from "@/modules/orders/schemas";
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

export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("payment.record");
  } catch (error) {
    return toState(error, "You are not allowed to record payments");
  }

  try {
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

  try {
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
