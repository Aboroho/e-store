"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession, requestMetadata } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { parseInput } from "@/lib/validation";
import {
  bulkCourierDispatchSchema,
  bulkOrderStatusSchema,
  checkoutFieldConfigSchema,
  deleteOrderSchema,
  manualOrderInputSchema,
  manualOrderUpdateSchema,
  orderColumnPreferenceSchema,
  orderStatusChangeSchema,
  partialDeliverySchema,
  type ManualOrderInput,
  type ManualOrderUpdateInput,
} from "@/modules/orders/schemas";
import {
  createManualOrder,
  manualOrderContext,
  previewManualOrder,
  searchProductsForOrder,
  updateManualOrder,
  type ManualOrderContext,
  type ManualOrderPreview,
} from "@/modules/orders/manual";
import {
  bulkChangeOrderStatus,
  changeOrderStatus,
  deleteCancelledOrder,
  processPartialDelivery,
  sendOrdersToCourier,
} from "@/modules/orders/lifecycle";
import { lookupSavedAddresses, getOrderScreen, type SavedAddressLookupResult } from "@/modules/orders/lookup";
import { buildManualOrderDraft, type ManualOrderDraft } from "@/modules/orders/draft";
import type { OrderCatalogSearchProduct } from "@/modules/orders/catalog";
import { resolveOrderColumns, saveOrderColumns, type ResolvedOrderColumns } from "@/modules/orders/columns";
import {
  CHECKOUT_FIELD_DEFINITIONS,
  getCheckoutFields,
  saveCheckoutField,
  type ResolvedCheckoutField,
} from "@/modules/orders/checkout-fields";
import { statusLabel } from "@/modules/orders/status";

/**
 * Server actions behind the manual order screens.
 *
 * Each action rebuilds the actor's context from the *session*, re-checks the
 * permission it needs and delegates to the domain service, which enforces the
 * rules a second time against the current order state. Nothing here trusts the
 * client: prices, totals, stock, ownership and the initial status are all
 * resolved on the server.
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

async function contextFor(permission: string): Promise<ManualOrderContext> {
  const session = await requireSession();
  assertPermission(session, permission);
  const meta = await requestMetadata();
  return manualOrderContext(session, meta);
}

function toFailure<T = Record<string, never>>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [
            issue.path ?? "_",
            [issue.message ?? "Invalid value"],
          ]),
        )
      : undefined;
    return { ok: false, message: error.message, fieldErrors } as ActionResult<T>;
  }
  logger.error("Manual order action failed", error);
  return { ok: false, message: fallback } as ActionResult<T>;
}

function revalidateOrderPaths() {
  revalidatePath("/admin/orders");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/preorders");
  revalidatePath("/admin/resellers");
}

// ------------------------------------------------------------- product search

export async function searchOrderProductsAction(
  query: string,
  take = 8,
): Promise<ActionResult<{ products: OrderCatalogSearchProduct[]; priceListName: string | null; mayViewCosts: boolean }>> {
  try {
    const context = await contextFor("order.view");
    const result = await searchProductsForOrder(context, { query, take });
    return { ok: true, products: result.products, priceListName: result.priceListName, mayViewCosts: result.mayViewCosts };
  } catch (error) {
    return toFailure(error, "Product search failed");
  }
}

// --------------------------------------------------------------- phone lookup

export async function lookupCustomerPhoneAction(phone: string): Promise<ActionResult<{ lookup: SavedAddressLookupResult }>> {
  try {
    const context = await contextFor("order.view");
    const lookup = await lookupSavedAddresses(context, phone);
    return { ok: true, lookup };
  } catch (error) {
    return toFailure(error, "The phone lookup failed");
  }
}

// --------------------------------------------------------------------- preview

export async function previewManualOrderAction(
  input: unknown,
): Promise<ActionResult<{ preview: ManualOrderPreview }>> {
  try {
    const context = await contextFor("order.view");
    const parsed = parseInput(manualOrderInputSchema, input, "Preview order");
    const preview = await previewManualOrder(context, parsed);
    return { ok: true, preview };
  } catch (error) {
    return toFailure(error, "The order preview could not be calculated");
  }
}

// ---------------------------------------------------------------------- create

export async function createManualOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string; orderNumber: string; statusLabel: string; redirect: string }>> {
  try {
    const context = await contextFor("order.create");
    const parsed: ManualOrderInput = parseInput(manualOrderInputSchema, input, "Create order");
    const result = await createManualOrder(context, parsed);
    revalidateOrderPaths();
    revalidatePath(`/admin/orders/${result.orderId}`);
    return {
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      statusLabel: result.statusLabel,
      redirect: `/admin/orders/${result.orderId}?created=1`,
    };
  } catch (error) {
    return toFailure(error, "The order could not be created");
  }
}

// ------------------------------------------------------------------------ edit

export async function loadManualOrderDraftAction(orderId: string): Promise<ActionResult<{ draft: ManualOrderDraft }>> {
  try {
    const context = await contextFor("order.view");
    return { ok: true, draft: await buildManualOrderDraft(context, orderId) };
  } catch (error) {
    return toFailure(error, "This order could not be loaded for editing");
  }
}

export async function updateManualOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderId: string; orderNumber: string; changedFields: string[]; warnings: string[] }>> {
  try {
    const context = await contextFor("order.update");
    const parsed: ManualOrderUpdateInput = parseInput(manualOrderUpdateSchema, input, "Update order");
    const result = await updateManualOrder(context, parsed);
    revalidateOrderPaths();
    revalidatePath(`/admin/orders/${result.orderId}`);
    return {
      ok: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      changedFields: result.changedFields,
      warnings: result.warnings,
    };
  } catch (error) {
    return toFailure(error, "The order could not be updated");
  }
}

// ---------------------------------------------------------------------- status

export async function changeOrderStatusAction(input: unknown): Promise<ActionResult<{ orderNumber: string; to: string }>> {
  try {
    const context = await contextFor("order.update");
    const parsed = parseInput(orderStatusChangeSchema, input, "Change status");
    const result = await changeOrderStatus(context, parsed);
    revalidateOrderPaths();
    revalidatePath(`/admin/orders/${result.orderId}`);
    return { ok: true, orderNumber: result.orderNumber, to: statusLabel(result.to) };
  } catch (error) {
    return toFailure(error, "The status could not be changed");
  }
}

export async function bulkChangeOrderStatusAction(
  input: unknown,
): Promise<ActionResult<{ updated: number; skipped: Array<{ orderNumber: string | null; reason: string }> }>> {
  try {
    const context = await contextFor("order.update");
    const parsed = parseInput(bulkOrderStatusSchema, input, "Bulk status change");
    const result = await bulkChangeOrderStatus(context, parsed);
    revalidateOrderPaths();
    for (const entry of result.updated) revalidatePath(`/admin/orders/${entry.orderId}`);
    return {
      ok: true,
      updated: result.updated.length,
      skipped: result.skipped.map((entry) => ({ orderNumber: entry.orderNumber, reason: entry.reason })),
    };
  } catch (error) {
    return toFailure(error, "The bulk status change failed");
  }
}

export async function sendOrdersToCourierAction(
  input: unknown,
): Promise<
  ActionResult<{
    submitted: number;
    skipped: number;
    failed: number;
    entries: Array<{ orderNumber: string | null; status: string; reason?: string }>;
  }>
> {
  try {
    const context = await contextFor("order.dispatch");
    const parsed = parseInput(bulkCourierDispatchSchema, input, "Send to courier");
    const result = await sendOrdersToCourier(context, parsed);
    revalidateOrderPaths();
    revalidatePath("/admin/shipments");
    for (const entry of result.entries) {
      if (entry.status === "submitted") revalidatePath(`/admin/orders/${entry.orderId}`);
    }
    return {
      ok: true,
      submitted: result.submitted,
      skipped: result.skipped,
      failed: result.failed,
      entries: result.entries.map((entry) => ({ orderNumber: entry.orderNumber, status: entry.status, reason: entry.reason })),
    };
  } catch (error) {
    return toFailure(error, "The courier request failed");
  }
}

export async function partialDeliveryAction(
  input: unknown,
): Promise<ActionResult<{ orderNumber: string; deliveredUnits: number; returnedUnits: number; restockedUnits: number }>> {
  try {
    const context = await contextFor("order.update");
    const parsed = parseInput(partialDeliverySchema, input, "Partial delivery");
    const result = await processPartialDelivery(context, parsed);
    revalidateOrderPaths();
    revalidatePath(`/admin/orders/${result.orderId}`);
    return {
      ok: true,
      orderNumber: result.orderNumber,
      deliveredUnits: result.deliveredUnits,
      returnedUnits: result.returnedUnits,
      restockedUnits: result.restockedUnits,
    };
  } catch (error) {
    return toFailure(error, "The partial delivery could not be recorded");
  }
}

// -------------------------------------------------------------------- deletion

export async function deleteOrderAction(
  input: unknown,
): Promise<ActionResult<{ orderNumber: string; message: string }>> {
  try {
    const context = await contextFor("order.delete");
    const parsed = parseInput(deleteOrderSchema, input, "Delete order");
    const result = await deleteCancelledOrder(context, parsed);
    revalidateOrderPaths();
    revalidatePath("/admin/orders/deleted");
    return { ok: true, orderNumber: result.orderNumber, message: result.message };
  } catch (error) {
    return toFailure(error, "The order could not be deleted");
  }
}

// -------------------------------------------------------------- list columns

export async function loadOrderColumnsAction(): Promise<ActionResult<{ columns: ResolvedOrderColumns }>> {
  try {
    const context = await contextFor("order.view");
    return { ok: true, columns: await resolveOrderColumns(context) };
  } catch (error) {
    return toFailure(error, "The column preferences could not be loaded");
  }
}

export async function saveOrderColumnsAction(input: unknown): Promise<ActionResult<{ columns: ResolvedOrderColumns }>> {
  try {
    const context = await contextFor("order.view");
    const parsed = parseInput(orderColumnPreferenceSchema, input, "Column preference");
    const columns = await saveOrderColumns(context, parsed.columns);
    revalidatePath("/admin/orders");
    return { ok: true, columns };
  } catch (error) {
    return toFailure(error, "The column preference could not be saved");
  }
}

// ------------------------------------------------------------ checkout fields

export async function saveCheckoutFieldAction(
  input: unknown,
): Promise<ActionResult<{ fieldKey: string; fields: ResolvedCheckoutField[]; message: string }>> {
  try {
    const session = await requireSession();
    assertPermission(session, "checkout_fields.manage");
    const meta = await requestMetadata();
    const context = await manualOrderContext(session, meta);
    const parsed = parseInput(checkoutFieldConfigSchema, input, "Checkout field");
    const definition = CHECKOUT_FIELD_DEFINITIONS.find((entry) => entry.key === parsed.fieldKey);
    if (!definition) throw AppError.validation(`Unknown checkout field: ${parsed.fieldKey}`);
    const fields = await saveCheckoutField(context, {
      fieldKey: definition.key,
      label: parsed.label,
      isEnabled: parsed.isEnabled,
      isRequired: parsed.isRequired,
      position: parsed.position,
      helpText: parsed.helpText ?? null,
      storefrontId: parsed.storefrontId ?? null,
    });
    revalidatePath("/admin/orders/checkout-fields");
    revalidatePath("/admin/orders/new");
    revalidatePath("/checkout");
    return { ok: true, fieldKey: definition.key, fields, message: `${definition.label} saved` };
  } catch (error) {
    return toFailure(error, "The checkout field could not be saved");
  }
}

/** Convenience wrapper used by the checkout-field editor screen. */
export async function loadCheckoutFieldsAction(storefrontId?: string | null) {
  const session = await requireSession();
  assertPermission(session, "order.view");
  return getCheckoutFields(session.businessId, storefrontId ?? undefined);
}

/** Order statuses a screen may offer for a given order, already filtered. */
export async function orderStatusOptionsAction(orderId: string) {
  try {
    const context = await contextFor("order.view");
    const screen = await getOrderScreen(context, orderId);
    return {
      ok: true as const,
      transitions: screen.transitions.map((transition) => ({
        status: transition.target,
        label: transition.label,
        allowed: transition.allowed,
        requiresConfirmation: transition.requiresConfirmation,
        requiresReason: transition.requiresReason,
        deniedReason: transition.deniedReason ?? null,
        warning: transition.warning ?? null,
        effect: transition.effect,
      })),
      dispatch: screen.dispatch,
      deletable: screen.deletable,
      deletionBlockers: screen.deletionBlockers,
      statusLabel: screen.statusLabel,
    };
  } catch (error) {
    return toFailure(error, "The available statuses could not be loaded");
  }
}
