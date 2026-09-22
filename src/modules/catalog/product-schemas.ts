import { z } from "zod";
import { zId, zMoneyPaisa, zOptionalText } from "@/lib/validation";
import { isValidSku } from "@/modules/catalog/product-draft";

/**
 * Schemas for the Create/Edit Product flow.
 *
 * The payload is the whole form (basic info, organisation, media, attributes,
 * variants, pricing, inventory, SEO) so one submit is one transaction — a partially
 * created product is impossible. Rich-text documents are validated structurally by
 * `validateRichTextDocument` inside the service, because they carry URLs and media
 * references that need a second pass against the media library.
 */

/** A document as it travels over the wire: `{ type: "doc", content: [...] }`. */
export const richTextDocumentSchema = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).max(5_000) })
  .nullable()
  .optional();

export const skuSchema = z
  .string()
  .trim()
  .min(2, "Enter a product code of at least 2 characters")
  .max(64, "Product codes are limited to 64 characters")
  .refine(isValidSku, "Use letters, numbers, dot, dash, underscore and slash only");

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Enter a URL slug")
  .max(80, "Slugs are limited to 80 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, numbers and single dashes (for example classic-black-shoes)");

export const weightUnitSchema = z.enum(["g", "kg", "lb"]);

export const productImageInputSchema = z.object({
  mediaId: z.string().uuid("Choose an image from the media library"),
  /** Association-level alt text; the media asset keeps its own. */
  altText: z.string().trim().max(300).nullable().optional(),
});

export const variantImageInputSchema = z.object({
  mediaId: z.string().uuid(),
  altText: z.string().trim().max(300).nullable().optional(),
});

export const productVariantInputSchema = z.object({
  /** Present when the variant already exists (edit/regeneration keeps its identity). */
  id: zId.optional(),
  name: z.string().trim().min(1, "Give the variant a name").max(160),
  /** Variant SKU is optional in the workflow; SKU belongs to the main product. */
  sku: z.string().trim().max(64).optional(),
  barcode: zOptionalText(64),
  /** Regular / current price in paisa. */
  currentPricePaisa: zMoneyPaisa.optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT", "NONE"]).optional(),
  discountValue: z.coerce.number().min(0).max(1_000_000).optional(),
  /** Sell price in paisa; optional if inherited from product default pricing. */
  pricePaisa: zMoneyPaisa.optional(),
  compareAtPricePaisa: zMoneyPaisa.optional(),
  costPaisa: zMoneyPaisa.optional(),
  /** Weight is normalised to grams; `weightUnit` only preserves the typed unit for display. */
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  weightUnit: weightUnitSchema.optional(),
  isPreorderEnabled: z.boolean().optional(),
  /** Packaging cost in paisa override. */
  packagingCostPaisa: zMoneyPaisa.optional(),
  /** Variant-level image override. `null` = inherit. */
  imageMediaId: z.string().uuid().nullable().optional(),
  galleryMediaIds: z.array(z.string().uuid()).max(12).default([]),
  gallery: z.array(variantImageInputSchema).max(12).optional(),
  attributeValueIds: z.array(zId).default([]),
  /** True when a person edited this row by hand (kept for the "preserve overrides" logic). */
  touched: z.boolean().optional(),
  clearPriceOverride: z.boolean().optional(),
  clearCostOverride: z.boolean().optional(),
  clearWeightOverride: z.boolean().optional(),
  clearPreorderOverride: z.boolean().optional(),
  clearImageOverride: z.boolean().optional(),
  clearPackagingCostOverride: z.boolean().optional(),
});

export const productDraftSchema = z.object({
  /** Set when editing an existing product. */
  productId: zId.optional(),
  name: z.string().trim().min(2, "Enter the product name").max(200, "Product names are limited to 200 characters"),
  slug: slugSchema,
  /** Product SKU. Belongs to the main product. */
  productCode: skuSchema,
  barcode: zOptionalText(64),
  productType: z.enum(["SIMPLE", "VARIABLE"]).default("SIMPLE"),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),

  brandId: zId.nullable().optional(),
  unitLabel: z.string().trim().min(1, "Enter a unit label").max(24, "Unit labels are limited to 24 characters"),
  /** Saved unit label the product points at (the text column stays in sync for the storefront). */
  unitLabelId: zId.nullable().optional(),
  categoryIds: z.array(zId).max(50).default([]),
  primaryCategoryId: zId.nullable().optional(),
  attributeIds: z.array(zId).max(30).default([]),

  shortDescription: richTextDocumentSchema,
  description: richTextDocumentSchema,

  primaryImage: productImageInputSchema.nullable().optional(),
  images: z.array(productImageInputSchema).max(20).default([]),
  seoImage: productImageInputSchema.nullable().optional(),

  /** Attribute-value default images, keyed by attribute value id. */
  attributeValueImages: z.record(z.string(), z.string().uuid().nullable()).default({}),

  weightValue: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  weightUnit: weightUnitSchema.default("g"),

  taxRateId: zId.nullable().optional(),
  taxRateBps: z.coerce.number().int().min(0).max(5_000).default(0),
  packagingCostTemplateId: zId.nullable().optional(),
  packagingCostPaisa: zMoneyPaisa.default(0),

  /** Product-level default pricing configuration. */
  currentPricePaisa: zMoneyPaisa.nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT", "NONE"]).default("NONE"),
  discountValue: z.coerce.number().min(0).max(1_000_000).default(0),
  /** Product-level default price (sell price) offered to variants that have none of their own. */
  defaultPricePaisa: zMoneyPaisa.nullable().optional(),
  /** Product-level default purchase cost (permission-gated in the UI). */
  defaultCostPaisa: zMoneyPaisa.nullable().optional(),

  requiresShipping: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isPreorderEnabled: z.boolean().default(false),
  preorderNote: zOptionalText(300),

  seoTitle: zOptionalText(200),
  seoDescription: zOptionalText(400),
  seoKeywords: zOptionalText(400),

  variants: z.array(productVariantInputSchema).min(1, "A product needs at least one variant").max(500, "Split products with more than 500 variants"),

  /** Draft autosave bookkeeping (see `saveProductDraft`). */
  draftId: zId.optional(),
  draftRevision: z.coerce.number().int().min(0).optional(),

  /** Optimistic concurrency: the `updatedAt` the form was rendered with. */
  expectedUpdatedAt: z.string().trim().optional(),
  /** Set to true when the user pressed "Save as draft" rather than "Create product". */
  saveAsDraft: z.boolean().default(false),
});

export type ProductDraftInput = z.infer<typeof productDraftSchema>;
export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type ProductImageInput = z.infer<typeof productImageInputSchema>;

/* -------------------------------------------------------------------------- */
/* Brands, unit labels and on-the-go creation                                 */
/* -------------------------------------------------------------------------- */

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the brand name").max(120),
  slug: slugSchema.optional(),
  description: zOptionalText(500),
  logoMediaId: z.string().uuid().nullable().optional(),
  websiteUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^https?:\/\/[^\s]+$/i, "Enter a full URL such as https://example.com")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean().default(true),
  seoTitle: zOptionalText(200),
  seoDescription: zOptionalText(400),
});

export const unitLabelInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a unit label").max(24),
  isDefault: z.boolean().default(false),
});

export const attributeValueImageSchema = z.object({
  attributeValueId: z.string().uuid(),
  mediaId: z.string().uuid().nullable(),
  /** Optionally push the image onto every variant of this value (explicit replace). */
  applyToVariants: z.boolean().default(false),
  productId: zId.optional(),
});

export const attributeValueInputSchema = z.object({
  attributeId: z.string().uuid(),
  value: z.string().trim().min(1, "Enter the value").max(80),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value such as #ff0000")
    .optional()
    .or(z.literal("")),
  mediaId: z.string().uuid().nullable().optional(),
});

/* -------------------------------------------------------------------------- */
/* Bulk actions                                                               */
/* -------------------------------------------------------------------------- */

export const bulkTargetSchema = z.object({
  kind: z.enum(["all", "selected", "attribute"]),
  variantIds: z.array(z.string()).max(1_000).optional(),
  criteria: z
    .array(
      z.object({
        attributeId: z.string().uuid(),
        valueIds: z.array(z.string().uuid()).min(1, "Pick at least one value"),
      }),
    )
    .optional(),
});

/**
 * Every bulk action maps to a field the variant model really has, its input
 * component, the target selector it uses and its inheritance behaviour:
 *
 * | action            | field                   | input              | inheritance                         |
 * | ----------------- | ----------------------- | ------------------ | ----------------------------------- |
 * | set-primary-image | `imageMediaId` / value  | media picker       | default sets the attribute default  |
 * | add-gallery-image | `VariantImage[]`        | media picker       | appends, keeps existing gallery     |
 * | set-price         | `priceOverridePaisa`    | money              | overrides the product default       |
 * | set-compare-at    | `compareAtPricePaisa`   | money              | overrides                           |
 * | set-cost          | `costPaisa`             | money              | overrides (permission-gated)        |
 * | set-weight        | `weightGrams`           | number + unit      | overrides the product weight        |
 * | set-preorder      | `isPreorderEnabled`     | boolean            | overrides the product setting       |
 * | set-unit-label    | (product level)         | text/select        | recorded on the product, reported   |
 * | reset-image       | `imageMediaId = null`   | —                  | returns to the inherited image      |
 * | clear-gallery     | `VariantImage[]`        | —                  | removes variant gallery rows only   |
 */
export const BULK_VARIANT_ACTIONS = [
  "set-primary-image",
  "add-gallery-image",
  "set-price",
  "set-compare-at",
  "set-cost",
  "set-weight",
  "set-preorder",
  "reset-image",
  "clear-gallery",
  "clear-price-override",
  "clear-cost-override",
  "clear-weight-override",
  "clear-preorder-override",
  "clear-image-override",
  "clear-packaging-cost-override",
] as const;

export type BulkVariantAction = (typeof BULK_VARIANT_ACTIONS)[number];

export const bulkVariantActionSchema = z.object({
  productId: zId,
  action: z.enum(BULK_VARIANT_ACTIONS),
  target: bulkTargetSchema,
  /** Money in paisa; weight in grams (already normalised by the form). */
  currentPricePaisa: zMoneyPaisa.nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT", "NONE"]).optional(),
  discountValue: z.coerce.number().min(0).max(1_000_000).optional(),
  /** Where the change is written: variant override, attribute default, product default or "clear". */
  overrideTarget: z.enum(["variant", "attribute", "product", "clear"]).default("variant"),
  pricePaisa: zMoneyPaisa.optional(),
  compareAtPricePaisa: zMoneyPaisa.nullable().optional(),
  costPaisa: zMoneyPaisa.nullable().optional(),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  weightUnit: weightUnitSchema.optional(),
  isPreorderEnabled: z.boolean().optional(),
  mediaId: z.string().uuid().optional(),
  /** Replace variant-level overrides instead of preserving them. */
  replaceOverrides: z.boolean().default(false),
  /** For attribute-matched image actions: also set the attribute-value default. */
  setAttributeDefault: z.boolean().default(true),
});

export type BulkVariantActionInput = z.infer<typeof bulkVariantActionSchema>;

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a tax rate name").max(100),
  rateBps: z.coerce.number().int().min(0).max(10_000, "Tax rate cannot exceed 100%"),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type TaxRateInput = z.infer<typeof taxRateInputSchema>;

export const packagingCostTemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a template name").max(100),
  costPaisa: zMoneyPaisa.default(0),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type PackagingCostTemplateInput = z.infer<typeof packagingCostTemplateInputSchema>;

export const singleVariantUpdateSchema = z.object({
  variantId: zId,
  /** Discount-aware override. `currentPricePaisa` + discount are authoritative;
      `priceOverridePaisa` may be sent when the caller already knows the result. */
  currentPricePaisa: zMoneyPaisa.nullable().optional(),
  discountType: z.enum(["PERCENTAGE", "FLAT", "NONE"]).optional(),
  discountValue: z.coerce.number().min(0).max(1_000_000).optional(),
  priceOverridePaisa: zMoneyPaisa.nullable().optional(),
  compareAtPricePaisa: zMoneyPaisa.nullable().optional(),
  costPaisa: zMoneyPaisa.nullable().optional(),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  isPreorderEnabled: z.boolean().nullable().optional(),
  packagingCostPaisa: zMoneyPaisa.nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  clearPriceOverride: z.boolean().optional(),
  clearCostOverride: z.boolean().optional(),
  clearWeightOverride: z.boolean().optional(),
  clearPreorderOverride: z.boolean().optional(),
  clearImageOverride: z.boolean().optional(),
  clearPackagingCostOverride: z.boolean().optional(),
  /** Name and barcode shown for the variant in the catalogue. */
  name: z.string().trim().min(1, "Give the variant a name").max(160).optional(),
  barcode: zOptionalText(64),
});

export type SingleVariantUpdateInput = z.infer<typeof singleVariantUpdateSchema>;

export const slugCheckSchema = z.object({
  slug: z.string().trim().max(120),
  productId: zId.optional(),
});

export const skuCheckSchema = z.object({
  productId: zId.optional(),
  productSku: z.string().trim().max(64).optional(),
  variantSkus: z.array(z.object({ key: z.string().min(1), sku: z.string().trim().max(64) })).max(500).default([]),
});

export type BrandInput = z.infer<typeof brandInputSchema>;
export type UnitLabelInput = z.infer<typeof unitLabelInputSchema>;
export type AttributeValueInput = z.infer<typeof attributeValueInputSchema>;
