import { z } from "zod";
import { zId, zMoneyPaisa, zOptionalSlug, zOptionalText } from "@/lib/validation";

/** Validation schemas for catalog, pricing and inventory screens. */

export const variantInputSchema = z.object({
  id: zId.optional(),
  name: z.string().trim().min(1, "Give the variant a name").max(160),
  sku: z
    .string()
    .trim()
    .min(2, "SKU is required")
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, "SKUs may contain letters, numbers, dot, dash, underscore and slash"),
  barcode: z.string().trim().max(64).optional(),
  pricePaisa: zMoneyPaisa,
  compareAtPricePaisa: zMoneyPaisa.optional(),
  costPaisa: zMoneyPaisa.optional(),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  isPreorderEnabled: z.boolean().default(false),
  attributeValueIds: z.array(zId).default([]),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name").max(200),
  slug: zOptionalSlug,
  productType: z.enum(["SIMPLE", "VARIABLE"]),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  shortDescription: zOptionalText(500),
  description: z.string().trim().max(20_000).optional(),
  brand: zOptionalText(120),
  sku: zOptionalText(64),
  barcode: zOptionalText(64),
  unitLabel: z.string().trim().min(1).max(24).default("piece"),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  requiresShipping: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isPreorderEnabled: z.boolean().default(false),
  preorderNote: zOptionalText(300),
  preorderExpectedAt: z.coerce.date().optional(),
  taxRateBps: z.coerce.number().int().min(0).max(5_000).default(0),
  packagingCostPaisa: zMoneyPaisa.default(0),
  seoTitle: zOptionalText(200),
  seoDescription: zOptionalText(400),
  seoKeywords: zOptionalText(400),
  categoryIds: z.array(zId).default([]),
  primaryCategoryId: zId.optional(),
  attributeIds: z.array(zId).default([]),
  mediaIds: z.array(zId).default([]),
  variants: z.array(variantInputSchema).min(1, "A product needs at least one variant"),
});

export const updateProductSchema = productInputSchema.omit({ variants: true }).partial().extend({
  attributeIds: z.array(zId).optional(),
  categoryIds: z.array(zId).optional(),
  mediaIds: z.array(zId).optional(),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the category name").max(120),
  slug: zOptionalSlug,
  parentId: zId.optional(),
  description: zOptionalText(500),
  position: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  seoTitle: zOptionalText(200),
  seoDescription: zOptionalText(400),
});

export const attributeInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the attribute name").max(80),
  slug: zOptionalSlug,
  type: z.enum(["TEXT", "SELECT", "COLOR", "NUMBER"]).default("SELECT"),
  unit: zOptionalText(24),
  isVariantDefining: z.boolean().default(true),
  values: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(80),
        colorHex: z
          .string()
          .trim()
          .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value such as #ff0000")
          .optional(),
      }),
    )
    .default([]),
});

export const priceListInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: zOptionalSlug,
  channel: z.enum(["DEFAULT", "STOREFRONT", "RESELLER", "WHOLESALE", "CUSTOM"]).default("DEFAULT"),
  currency: z.string().trim().length(3).default("BDT"),
  storefrontId: zId.optional(),
  isDefault: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  description: zOptionalText(300),
});

export const priceListItemInputSchema = z.object({
  priceListId: zId,
  variantId: zId,
  pricePaisa: zMoneyPaisa,
  compareAtPricePaisa: zMoneyPaisa.optional(),
  /** Quantity tier: 1 is the base price, higher numbers are bulk prices. */
  minQuantity: z.coerce.number().int().min(1).default(1),
});

export const purchaseOrderInputSchema = z.object({
  supplierId: zId,
  expectedAt: z.coerce.date().optional(),
  note: zOptionalText(500),
  internalNote: zOptionalText(500),
  extraCostPaisa: zMoneyPaisa.default(0),
  items: z
    .array(
      z.object({
        variantId: zId,
        orderedQuantity: z.coerce.number().int().positive().max(1_000_000),
        unitCostPaisa: zMoneyPaisa,
        note: zOptionalText(200),
      }),
    )
    .min(1, "Add at least one item"),
});

export const goodsReceiptInputSchema = z.object({
  purchaseOrderId: zId,
  locationId: zId.optional(),
  note: zOptionalText(500),
  externalReference: zOptionalText(120),
  /** Optional carrier/consignment reference used to make a repeated submit idempotent. */
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  expenses: z
    .array(
      z.object({
        label: z.string().trim().min(2).max(120),
        amountPaisa: zMoneyPaisa,
        allocationMethod: z.enum(["QUANTITY", "VALUE", "NONE"]).default("VALUE"),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: zId,
        quantity: z.coerce.number().int().positive().max(1_000_000),
        unitCostPaisa: zMoneyPaisa,
      }),
    )
    .min(1, "Enter the received quantity for at least one line"),
});

export const supplierInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(160),
  contactName: zOptionalText(120),
  phone: zOptionalText(24),
  email: zOptionalText(200),
  address: zOptionalText(300),
  note: zOptionalText(500),
  paymentTerms: zOptionalText(120),
  isActive: z.boolean().default(true),
});

export const supplierPaymentInputSchema = z.object({
  supplierId: zId,
  purchaseOrderId: zId.optional(),
  amountPaisa: zMoneyPaisa.refine((value) => value > 0, "Enter an amount greater than zero"),
  method: z.enum(["CASH", "BANK_TRANSFER", "BKASH", "CHEQUE", "OTHER"]).default("CASH"),
  reference: zOptionalText(120),
  note: zOptionalText(300),
  paidAt: z.coerce.date().optional(),
});

export const stockAdjustmentInputSchema = z.object({
  variantId: zId,
  locationId: zId.optional(),
  direction: z.enum(["INCREASE", "DECREASE"]),
  condition: z.enum(["SELLABLE", "DAMAGED", "INSPECTION"]).default("SELLABLE"),
  quantity: z.coerce.number().int().positive("Enter a quantity greater than zero").max(1_000_000),
  reasonCode: z.string().trim().min(1, "Select a reason"),
  note: zOptionalText(500),
  reference: zOptionalText(120),
});

export const preorderAllocationInputSchema = z.object({
  variantId: zId,
  locationId: zId.optional(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  note: zOptionalText(300),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type AttributeInput = z.infer<typeof attributeInputSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptInputSchema>;
export type SupplierInput = z.infer<typeof supplierInputSchema>;
export type StockAdjustmentFormInput = z.infer<typeof stockAdjustmentInputSchema>;
