"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  receivePurchaseOrder,
  recordSupplierPayment,
  submitPurchaseOrder,
  updateSupplier,
} from "@/modules/purchasing/service";
import { goodsReceiptInputSchema, purchaseOrderInputSchema, supplierInputSchema, supplierPaymentInputSchema } from "@/modules/catalog/schemas";
import type { ActionState } from "@/modules/auth/action-state";
import { logger } from "@/lib/logging";

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { userId: session.id, businessId: session.businessId, actorLabel: session.email };
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
  logger.error("Purchasing action failed", error);
  return { status: "error", message: fallback };
}

export async function createPurchaseOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("purchase.create");
  } catch (error) {
    return toState(error, "You are not allowed to create purchase orders");
  }

  const raw = formDataToObject(formData);
  const variantIds = formData.getAll("itemVariantId").map(String);
  const items = variantIds.map((variantId, index) => ({
    variantId,
    orderedQuantity: Number(formData.getAll("itemQuantity")[index] ?? 0),
    unitCostPaisa: Math.round(Number(formData.getAll("itemUnitCost")[index] ?? 0) * 100),
    note: String(formData.getAll("itemNote")[index] ?? "").trim() || undefined,
  }));

  const parsed = parseInput(
    purchaseOrderInputSchema,
    {
      ...raw,
      expectedAt: raw.expectedAt || undefined,
      extraCostPaisa: Math.round(Number(raw.extraCostPaisa ?? 0) * 100),
      items,
    },
    "Create purchase order",
  );

  let purchaseOrderId: string;
  try {
    const po = await createPurchaseOrder(context, parsed);
    purchaseOrderId = po.id;
  } catch (error) {
    return toState(error, "Unable to create the purchase order");
  }

  revalidatePath("/admin/purchasing");
  redirect(`/admin/purchasing/${purchaseOrderId}`);
}

export async function submitPurchaseOrderAction(purchaseOrderId: string): Promise<void> {
  const context = await actor("purchase.update");
  await submitPurchaseOrder(context, purchaseOrderId);
  revalidatePath("/admin/purchasing");
  revalidatePath(`/admin/purchasing/${purchaseOrderId}`);
}

export async function cancelPurchaseOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor("purchase.update");
    const raw = formDataToObject(formData);
    const purchaseOrderId = String(raw.purchaseOrderId ?? "");
    await cancelPurchaseOrder(context, purchaseOrderId, String(raw.reason ?? ""));
    revalidatePath("/admin/purchasing");
    revalidatePath(`/admin/purchasing/${purchaseOrderId}`);
    return { status: "success", message: "Purchase order cancelled." };
  } catch (error) {
    return toState(error, "Unable to cancel the purchase order");
  }
}

export async function receivePurchaseOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("purchase.receive");
  } catch (error) {
    return toState(error, "You are not allowed to receive stock");
  }

  const raw = formDataToObject(formData);
  const purchaseOrderItemIds = formData.getAll("receiptItemId").map(String);
  const items = purchaseOrderItemIds
    .map((purchaseOrderItemId, index) => ({
      purchaseOrderItemId,
      quantity: Number(formData.getAll("receiptQuantity")[index] ?? 0),
      unitCostPaisa: Math.round(Number(formData.getAll("receiptUnitCost")[index] ?? 0) * 100),
    }))
    .filter((item) => item.quantity > 0);

  const expenses = formData
    .getAll("expenseLabel")
    .map((label, index) => ({
      label: String(label).trim(),
      amountPaisa: Math.round(Number(formData.getAll("expenseAmount")[index] ?? 0) * 100),
      allocationMethod: (String(formData.getAll("expenseMethod")[index] ?? "VALUE") as "QUANTITY" | "VALUE" | "NONE"),
    }))
    .filter((expense) => expense.label.length > 0 && expense.amountPaisa > 0);

  const parsed = parseInput(
    goodsReceiptInputSchema,
    {
      purchaseOrderId: String(raw.purchaseOrderId ?? ""),
      locationId: raw.locationId || undefined,
      note: raw.note || undefined,
      externalReference: raw.externalReference || undefined,
      idempotencyKey: raw.idempotencyKey || undefined,
      items,
      expenses,
    },
    "Record goods receipt",
  );

  try {
    const result = await receivePurchaseOrder(context, { ...parsed, items });
    revalidatePath("/admin/purchasing");
    revalidatePath(`/admin/purchasing/${parsed.purchaseOrderId}`);
    revalidatePath("/admin/inventory");
    return {
      status: "success",
      message: result.reused
        ? `Receipt ${result.code} was already processed; no stock was booked twice.`
        : `Receipt ${result.code} posted: ${result.receivedQuantity} unit(s), landed cost BDT ${(result.totalCostPaisa / 100).toFixed(2)}. Purchase order is ${result.status.replace(/_/g, " ").toLowerCase()}.`,
      data: { receiptId: result.receiptId, code: result.code },
    };
  } catch (error) {
    return toState(error, "Unable to record the receipt");
  }
}

export async function createSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor("supplier.manage");
    const parsed = parseInput(supplierInputSchema, { ...formDataToObject(formData), isActive: formData.get("isActive") === "on" });
    await createSupplier(context, parsed);
    revalidatePath("/admin/purchasing/suppliers");
    return { status: "success", message: "Supplier created." };
  } catch (error) {
    return toState(error, "Unable to create the supplier");
  }
}

export async function updateSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor("supplier.manage");
    const raw = formDataToObject(formData);
    const supplierId = String(raw.supplierId ?? "");
    const parsed = parseInput(supplierInputSchema.partial(), { ...raw, isActive: raw.isActive === "on" });
    await updateSupplier(context, supplierId, parsed);
    revalidatePath("/admin/purchasing/suppliers");
    return { status: "success", message: "Supplier saved." };
  } catch (error) {
    return toState(error, "Unable to save the supplier");
  }
}

export async function recordSupplierPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor("purchase.payment");
    const raw = formDataToObject(formData);
    const parsed = parseInput(
      supplierPaymentInputSchema,
      {
        ...raw,
        purchaseOrderId: raw.purchaseOrderId || undefined,
        amountPaisa: Math.round(Number(raw.amountPaisa ?? 0) * 100),
        paidAt: raw.paidAt || undefined,
      },
      "Supplier payment",
    );

    await recordSupplierPayment(context, parsed);
    revalidatePath("/admin/purchasing");
    if (parsed.purchaseOrderId) revalidatePath(`/admin/purchasing/${parsed.purchaseOrderId}`);
    return { status: "success", message: "Payment recorded." };
  } catch (error) {
    return toState(error, "Unable to record the payment");
  }
}
