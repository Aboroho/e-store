import "server-only";
import { prisma } from "@/lib/db/client";
import { displayStatus, ORDER_TYPE_LABELS, type OrderTypeValue } from "@/modules/orders/status";
import { getOrderScreen } from "@/modules/orders/lookup";
import type { ManualOrderContext } from "@/modules/orders/manual";

/**
 * Loads an existing order into the manual order form.
 *
 * Only data the operator may change is exposed, and every price comes from the
 * stored server snapshot — the form has no way to send a unit price back.
 */

export interface ManualOrderDraft {
  orderId: string;
  orderNumber: string;
  orderType: string;
  orderTypeLabel: string;
  status: string;
  statusLabel: string;
  editable: boolean;
  /** True when saving needs the post-courier warning to be acknowledged. */
  requiresConfirmation: boolean;
  editWarning: { title: string; points: string[] } | null;
  editDeniedReason: string | null;
  mayViewCosts: boolean;
  customerId: string | null;
  storefrontId: string | null;
  customer: {
    name: string;
    phone: string;
    email: string;
    districtCode: string;
    addressLine: string;
    area: string;
  };
  items: Array<{
    key: string;
    variantId: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    itemDiscountPaisa: number;
    allowPreorder: boolean;
    note: string;
    unitPricePaisa: number;
    lineTotalPaisa: number;
  }>;
  /** Lines without a catalogue variant cannot be represented in the form. */
  lockedLineCount: number;
  courierNote: string;
  customerNote: string;
  orderNote: string;
  paymentMethod: string;
  deliveryFeeManualPaisa: number | null;
  deliveryFeeNote: string;
  orderDiscountType: "FLAT" | "PERCENTAGE" | null;
  orderDiscountValue: number | null;
  extraCharges: Array<{ label: string; amountPaisa: number; note: string }>;
}

export async function buildManualOrderDraft(context: ManualOrderContext, orderId: string): Promise<ManualOrderDraft> {
  const screen = await getOrderScreen(context, orderId);
  const order = screen.order;

  const items = order.items
    .filter((item) => Boolean(item.variantId))
    .map((item, index) => ({
      key: `line-${index}-${item.id}`,
      variantId: item.variantId as string,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: item.quantity,
      itemDiscountPaisa: item.discountPaisa,
      allowPreorder: item.isPreorder,
      note: item.note ?? "",
      unitPricePaisa: item.unitPricePaisa,
      lineTotalPaisa: item.lineTotalPaisa,
    }));

  const charges = await prisma.orderAdjustment.findMany({
    where: { orderId: order.id, type: "EXTRA_CHARGE" },
    orderBy: { createdAt: "asc" },
    select: { label: true, amountPaisa: true, note: true },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    orderTypeLabel: ORDER_TYPE_LABELS[order.orderType as OrderTypeValue] ?? order.orderType,
    status: order.status,
    statusLabel: displayStatus(order.status, screen.courierStatus),
    editable: screen.edit.allowed || screen.edit.requiresConfirmation,
    requiresConfirmation: screen.edit.requiresConfirmation,
    editWarning: screen.edit.warning ?? null,
    editDeniedReason:
      screen.edit.allowed || screen.edit.requiresConfirmation ? null : screen.edit.deniedReason ?? null,
    mayViewCosts: screen.mayViewCosts,
    customerId: order.customerId,
    storefrontId: order.storefrontId,
    customer: {
      name: order.customerName ?? "",
      phone: order.customerPhone ?? "",
      email: order.customerEmail ?? "",
      districtCode: order.shippingDistrictCode ?? "",
      addressLine: order.shippingAddressLine ?? "",
      area: order.shippingArea ?? "",
    },
    items,
    lockedLineCount: order.items.length - items.length,
    courierNote: order.deliveryNotes ?? "",
    customerNote: order.customerNote ?? "",
    orderNote: order.internalNote ?? "",
    paymentMethod: order.payments[0]?.method ?? "COD",
    deliveryFeeManualPaisa: order.deliveryFeeOverriddenAt ? order.deliveryFeePaisa : null,
    deliveryFeeNote: order.deliveryFeeOverrideNote ?? "",
    orderDiscountType: order.discountType ?? null,
    orderDiscountValue: order.discountValue ?? null,
    extraCharges: charges.map((charge) => ({
      label: charge.label,
      amountPaisa: charge.amountPaisa,
      note: charge.note ?? "",
    })),
  };
}
