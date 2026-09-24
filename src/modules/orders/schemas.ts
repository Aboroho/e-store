import { z } from "zod";

/** Order inputs. Every amount is an integer number of paisa. */

export const orderItemInputSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  discountPaisa: z.number().int().min(0).default(0),
  packagingCostPaisa: z.number().int().min(0).optional(),
  /**
   * Accept an uncovered quantity as a preorder line even when the product does
   * not advertise preorders. Only manual order creation may set this, and the
   * server still records a real preorder commitment — stock is never faked.
   */
  allowPreorder: z.boolean().optional(),
  note: z.string().trim().max(200).optional(),
});

export const extraChargeInputSchema = z.object({
  label: z.string().trim().min(2).max(80),
  amountPaisa: z.number().int().min(1).max(10_000_000),
  note: z.string().trim().max(200).optional(),
});

export const customerInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(24),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  districtCode: z.string().trim().length(2).optional(),
  addressLine: z.string().trim().max(300).optional(),
  area: z.string().trim().max(120).optional(),
});

export const createOrderInputSchema = z.object({
  channel: z.enum(["STOREFRONT", "ADMIN", "IN_STORE", "RESELLER", "API"]).default("ADMIN"),
  /**
   * What kind of sale this is. The channel keeps recording *who* created the
   * order; the type drives the required fields, the delivery charge and the
   * initial status. There is deliberately no `status` field: the server decides
   * the initial status from the order type (docs/BUSINESS_RULES.md).
   */
  orderType: z.enum(["ONLINE_DELIVERY", "IN_STORE", "PREORDER"]).default("ONLINE_DELIVERY"),
  /** Flat customer fields (staff screens) and/or a nested `customer` object (API). */
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(24).optional(),
  customerEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  shippingDistrictCode: z.string().trim().length(2).optional(),
  shippingAddressLine: z.string().trim().max(300).optional(),
  shippingArea: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(["COD", "BKASH", "SSLCOMMERZ", "CASH", "BANK_TRANSFER", "MANUAL"]).default("COD"),
  markDelivered: z.boolean().default(false),
  expectedDeliveryAt: z.coerce.date().optional(),
  deliveryNotes: z.string().trim().max(300).optional(),
  discountLabel: z.string().trim().max(200).optional(),
  storefrontId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customer: customerInputSchema.optional(),
  resellerId: z.string().uuid().optional(),
  priceListId: z.string().uuid().optional(),
  items: z.array(orderItemInputSchema).min(1, "Add at least one item").max(100),
  /**
   * Delivery charge. When omitted the delivery-zone rules decide; when present it
   * is an authorised manual override and the calculated value is kept alongside it.
   */
  deliveryFeePaisa: z.number().int().min(0).max(1_000_000).optional(),
  /** Why the calculated delivery charge was overridden (stored for audit). */
  deliveryFeeNote: z.string().trim().max(200).optional(),
  deliveryZoneId: z.string().uuid().optional(),
  discountTotalPaisa: z.number().int().min(0).max(10_000_000).default(0),
  discountReason: z.string().trim().max(200).optional(),
  /** How the order-level discount was entered; the server always recomputes it. */
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  /** Paisa for FLAT, basis points for PERCENTAGE (250 = 2.50%). */
  discountValue: z.number().int().min(0).max(10_000_000).optional(),
  extraCharges: z.array(extraChargeInputSchema).max(20).default([]),
  codSurchargePaisa: z.number().int().min(0).max(1_000_000).optional(),
  customerNote: z.string().trim().max(1000).optional(),
  internalNote: z.string().trim().max(1000).optional(),
  sourceReference: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
  /** Whether the shopper agreed to marketing measurement at checkout. */
  marketingConsent: z.boolean().default(false),
});

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;

export const orderTransitionSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED"]),
  note: z.string().trim().max(300).optional(),
});

export const cancelOrderInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
  reasonCode: z.string().trim().max(60).optional(),
  restock: z.boolean().default(false),
});

export const recordPaymentInputSchema = z.object({
  orderId: z.string().uuid(),
  amountPaisa: z.number().int().min(1).max(100_000_000),
  method: z.enum(["COD", "BKASH", "SSLCOMMERZ", "CASH", "BANK_TRANSFER", "MANUAL"]),
  providerReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const refundInputSchema = z.object({
  orderId: z.string().uuid(),
  exchangeRequestId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  amountPaisa: z.number().int().min(1).max(100_000_000),
  method: z.enum(["PROVIDER", "BKASH", "SSLCOMMERZ", "CASH", "BANK_TRANSFER", "MANUAL"]).default("MANUAL"),
  reason: z.string().trim().min(3).max(300),
  note: z.string().trim().max(300).optional(),
  restock: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export const paymentAttemptInputSchema = z.object({
  orderId: z.string().uuid(),
  amountPaisa: z.number().int().min(1),
  method: z.enum(["BKASH", "SSLCOMMERZ"]),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentInputSchema>;
export type RefundInput = z.infer<typeof refundInputSchema>;

export const orderTransitionInputSchema = orderTransitionSchema;
export const cancelOrderSchema = cancelOrderInputSchema;
export const recordPaymentSchema = recordPaymentInputSchema;
export const refundSchema = refundInputSchema;

// ---------------------------------------------------------------------------
// Manual order creation and order management (admin & reseller screens)
//
// These schemas describe what a *person* may submit. Prices, totals, stock,
// ownership and the initial status are never part of the payload: the server
// resolves them (docs/BUSINESS_RULES.md → "Manual order totals").
// ---------------------------------------------------------------------------

export const MANUAL_ORDER_STATUSES = [
  "PROCESSING",
  "CONFIRMED",
  "ON_HOLD",
  "CANCELLED",
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
] as const;

export const manualOrderItemSchema = z.object({
  /** Client row key, echoed back so the UI can match preview lines. */
  key: z.string().trim().min(1).max(40),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  itemDiscountPaisa: z.number().int().min(0).max(10_000_000).default(0),
  /** Accept the uncovered quantity as a preorder commitment. */
  allowPreorder: z.boolean().default(false),
  note: z.string().trim().max(200).optional(),
});

export const manualOrderCustomerSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(24).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  districtCode: z.string().trim().regex(/^\d{2}$/, "Choose a district").optional().or(z.literal("")),
  addressLine: z.string().trim().max(300).optional(),
  area: z.string().trim().max(120).optional(),
});

export const manualOrderInputSchema = z.object({
  orderType: z.enum(["ONLINE_DELIVERY", "IN_STORE", "PREORDER"]).default("ONLINE_DELIVERY"),
  items: z.array(manualOrderItemSchema).min(1, "Add at least one item").max(100),
  customer: manualOrderCustomerSchema.default({}),
  /** Delivery instructions for the courier rider (never shown as the address). */
  courierNote: z.string().trim().max(300).optional(),
  /** Note written by/for the customer. */
  customerNote: z.string().trim().max(1000).optional(),
  /** Internal note, visible to staff only. */
  orderNote: z.string().trim().max(1000).optional(),
  paymentMethod: z.enum(["COD", "BKASH", "SSLCOMMERZ", "CASH", "BANK_TRANSFER", "MANUAL"]).default("COD"),
  /** `null` keeps the calculated charge; a number is an authorised override. */
  deliveryFeeManualPaisa: z.number().int().min(0).max(1_000_000).nullable().optional(),
  deliveryFeeNote: z.string().trim().max(200).optional(),
  orderDiscountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  /** Paisa for FLAT, basis points for PERCENTAGE (250 = 2.50%). */
  orderDiscountValue: z.number().int().min(0).max(10_000_000).optional(),
  extraCharges: z.array(extraChargeInputSchema).max(20).default([]),
  storefrontId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  expectedDeliveryAt: z.coerce.date().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export type ManualOrderInput = z.input<typeof manualOrderInputSchema>;
export type ManualOrderItemInput = z.input<typeof manualOrderItemSchema>;

export const manualOrderUpdateSchema = manualOrderInputSchema
  .omit({ idempotencyKey: true, orderType: true })
  .partial()
  .extend({
    orderId: z.string().uuid(),
    /** Required for post-courier edits: the operator confirmed the warning. */
    confirmPostCourierEdit: z.boolean().default(false),
    reason: z.string().trim().max(300).optional(),
  });

export type ManualOrderUpdateInput = z.input<typeof manualOrderUpdateSchema>;
export type BulkOrderStatusInput = z.input<typeof bulkOrderStatusSchema>;
export type PartialDeliveryInput = z.input<typeof partialDeliverySchema>;
export type PartialDeliveryItemInput = z.input<typeof partialDeliveryItemSchema>;
export type DeleteOrderInput = z.input<typeof deleteOrderSchema>;

export const orderStatusChangeSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(MANUAL_ORDER_STATUSES),
  reason: z.string().trim().max(300).optional(),
  /** The operator explicitly confirmed the warning this transition requires. */
  confirmed: z.boolean().default(false),
});

export type OrderStatusChangeInput = z.input<typeof orderStatusChangeSchema>;

export type BulkCourierDispatchInput = z.input<typeof bulkCourierDispatchSchema>;

export const bulkOrderStatusSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(MANUAL_ORDER_STATUSES),
  reason: z.string().trim().max(300).optional(),
  confirmed: z.boolean().default(false),
});

export const bulkCourierDispatchSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  courierProviderId: z.string().uuid().optional(),
});

export const partialDeliveryItemSchema = z.object({
  orderItemId: z.string().uuid(),
  deliveredQuantity: z.number().int().min(0).max(1000).default(0),
  returnedQuantity: z.number().int().min(0).max(1000).default(0),
});

export const partialDeliverySchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(partialDeliveryItemSchema).min(1, "Record at least one line"),
  note: z.string().trim().max(300).optional(),
  confirmed: z.boolean().default(false),
});

export const deleteOrderSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().max(300).optional(),
  /** The operator confirmed the permanent-deletion dialog. */
  confirmed: z.boolean().default(false),
});

export const savedAddressLookupSchema = z.object({
  phone: z.string().trim().min(6).max(24),
});

export const orderColumnPreferenceSchema = z.object({
  columns: z.array(z.string().trim().min(1).max(40)).max(40),
});

export const orderProductSearchSchema = z.object({
  query: z.string().trim().max(120).optional(),
  take: z.number().int().min(1).max(25).default(8),
});

export const checkoutFieldConfigSchema = z.object({
  id: z.string().uuid().optional(),
  fieldKey: z.string().trim().min(2).max(40),
  label: z.string().trim().min(2).max(80),
  isEnabled: z.boolean().default(true),
  isRequired: z.boolean().default(false),
  position: z.number().int().min(0).max(100).default(0),
  helpText: z.string().trim().max(200).optional(),
  storefrontId: z.string().uuid().nullable().optional(),
});
