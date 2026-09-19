import { z } from "zod";

/**
 * Reseller schemas.
 *
 * Money is integer paisa. The reseller's own collection amount (what they take
 * from *their* customer) is recorded but never capped by the platform — it is
 * one of the audited values that produce their earnings.
 */

export const resellerStatusSchema = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]);
export const resellerCommissionTypeSchema = z.enum([
  "MARGIN_BASED",
  "PERCENT_OF_MARGIN",
  "FIXED_PER_ORDER",
  "FIXED_PER_ITEM",
  "NONE",
]);
export const payoutMethodSchema = z.enum(["BKASH", "BANK_TRANSFER", "CASH", "OTHER"]);

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const resellerInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the reseller name").max(120),
  code: optionalText(40),
  businessName: optionalText(160),
  phone: optionalText(30),
  email: z.string().trim().email("Enter a valid email").max(160).optional().or(z.literal("")),
  status: resellerStatusSchema.default("ACTIVE"),
  commissionType: resellerCommissionTypeSchema.default("MARGIN_BASED"),
  commissionValue: z.coerce.number().int().min(0).default(0),
  packagingIncluded: z.coerce.boolean().default(true),
  packagingCostPaisa: z.coerce.number().int().min(0).default(0),
  deliveryChargePaisa: z.coerce.number().int().min(0).default(0),
  codChargePaisa: z.coerce.number().int().min(0).default(0),
  defaultDistrictCode: optionalText(4),
  address: optionalText(300),
  nidNumber: optionalText(40),
  payoutMethod: payoutMethodSchema.default("BKASH"),
  payoutAccountNumber: optionalText(60),
  payoutAccountName: optionalText(120),
  minimumPayoutPaisa: z.coerce.number().int().min(0).default(0),
  creditLimitPaisa: z.coerce.number().int().min(0).default(0),
  note: optionalText(500),
});
export type ResellerInput = z.infer<typeof resellerInputSchema>;

export const resellerUpdateSchema = resellerInputSchema.partial().extend({
  resellerId: z.string().uuid(),
});

export const resellerPriceInputSchema = z.object({
  resellerId: z.string().uuid(),
  variantId: z.string().uuid(),
  pricePaisa: z.coerce.number().int().min(0, "Enter the reseller price"),
  minQuantity: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ResellerPriceInput = z.infer<typeof resellerPriceInputSchema>;

export const resellerPriceBulkSchema = z.object({
  resellerId: z.string().uuid(),
  /** Percentage applied to the default price list, in basis points (e.g. 12000 = +20%). */
  markupBps: z.coerce.number().int().min(-9_000).max(100_000),
  onlyMissing: z.coerce.boolean().default(true),
});
export type ResellerPriceBulkInput = z.infer<typeof resellerPriceBulkSchema>;

export const resellerCollectionInputSchema = z.object({
  orderId: z.string().uuid(),
  amountPaisa: z.coerce.number().int().min(0),
  reason: optionalText(300),
});
export type ResellerCollectionInput = z.infer<typeof resellerCollectionInputSchema>;

export const resellerOrderItemSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(10_000),
  discountPaisa: z.coerce.number().int().min(0).default(0),
});

export const resellerOrderInputSchema = z.object({
  resellerId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(160),
  customerPhone: z.string().trim().min(6).max(20),
  customerEmail: z.string().trim().email().max(160).optional().or(z.literal("")),
  shippingDistrictCode: z.string().trim().min(2).max(4),
  shippingAddressLine: z.string().trim().min(5).max(300),
  shippingArea: optionalText(160),
  deliveryNotes: optionalText(300),
  /** What the reseller collects from their own customer. */
  collectionPaisa: z.coerce.number().int().min(0).optional(),
  items: z.array(resellerOrderItemSchema).min(1, "Add at least one item"),
  internalNote: optionalText(500),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});
export type ResellerOrderInput = z.infer<typeof resellerOrderInputSchema>;

export const resellerLedgerAdjustmentSchema = z.object({
  resellerId: z.string().uuid(),
  amountPaisa: z.coerce.number().int(), // signed: negative debits the reseller
  description: z.string().trim().min(3).max(200),
  reason: optionalText(300),
  orderId: z.string().uuid().optional(),
});
export type ResellerLedgerAdjustmentInput = z.infer<typeof resellerLedgerAdjustmentSchema>;

export const resellerPayoutInputSchema = z.object({
  resellerId: z.string().uuid(),
  /** Explicit ledger entries; when omitted every eligible unpaid entry is included. */
  ledgerEntryIds: z.array(z.string().uuid()).optional(),
  amountPaisa: z.coerce.number().int().min(0).optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  method: payoutMethodSchema.default("BKASH"),
  accountNumber: optionalText(60),
  accountName: optionalText(120),
  note: optionalText(500),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});
export type ResellerPayoutInput = z.infer<typeof resellerPayoutInputSchema>;

export const payoutDecisionSchema = z.object({
  payoutId: z.string().uuid(),
  note: optionalText(300),
});

export const payoutPaidSchema = z.object({
  payoutId: z.string().uuid(),
  transactionReference: z.string().trim().min(3).max(120),
  paidAt: z.coerce.date().optional(),
  note: optionalText(300),
});

export const payoutCancelSchema = z.object({
  payoutId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export const payoutFailSchema = z.object({
  payoutId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});
