import { z } from "zod";

/** Order inputs. Every amount is an integer number of paisa. */

export const orderItemInputSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  /** Staff/reseller price override; storefront orders always use the resolved price. */
  unitPricePaisa: z.number().int().min(0).optional(),
  discountPaisa: z.number().int().min(0).default(0),
  packagingCostPaisa: z.number().int().min(0).optional(),
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
  deliveryFeePaisa: z.number().int().min(0).max(1_000_000).optional(),
  deliveryZoneId: z.string().uuid().optional(),
  discountTotalPaisa: z.number().int().min(0).max(10_000_000).default(0),
  discountReason: z.string().trim().max(200).optional(),
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
