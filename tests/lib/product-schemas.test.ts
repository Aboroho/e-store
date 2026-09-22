import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  attributeValueInputSchema,
  brandInputSchema,
  bulkVariantActionSchema,
  productDraftSchema,
  productVariantInputSchema,
  skuCheckSchema,
  slugCheckSchema,
  unitLabelInputSchema,
} from "@/modules/catalog/product-schemas";

/**
 * The payload contract of the Create/Edit Product flow. These limits are the
 * same rules the UI enforces inline; the server is the authority, so every limit
 * is tested here against the schema the service parses with.
 */

const uuid = () => randomUUID();

const validVariant = {
  name: "Default variant",
  pricePaisa: 12_000,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Classic Black Tee",
    slug: "classic-black-tee",
    productCode: "TEE",
    unitLabel: "piece",
    variants: [validVariant],
    ...overrides,
  };
}

describe("product draft: basic information", () => {
  it("accepts a minimal valid draft and applies defaults", () => {
    const parsed = productDraftSchema.parse(payload());
    expect(parsed.status).toBe("DRAFT"); // a new product never auto-publishes
    expect(parsed.saveAsDraft).toBe(false);
    expect(parsed.weightUnit).toBe("g");
    expect(parsed.taxRateBps).toBe(0);
    expect(parsed.images).toEqual([]);
    expect(parsed.attributeValueImages).toEqual({});
  });

  it("requires a name of 2–200 characters", () => {
    expect(productDraftSchema.safeParse(payload({ name: "A" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ name: "  AB  " })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ name: "x".repeat(201) })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ name: "x".repeat(200) })).success).toBe(true);
  });

  it("rejects slugs that are not URL-safe, over the limit or empty", () => {
    expect(productDraftSchema.safeParse(payload({ slug: "My Slug!" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ slug: "double--dash" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ slug: "" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ slug: `${"a".repeat(81)}` })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ slug: "a".repeat(80) })).success).toBe(true);
  });

  it("requires a product code of 2–64 chars with a safe alphabet", () => {
    expect(productDraftSchema.safeParse(payload({ productCode: "T" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ productCode: "BAD CODE!" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ productCode: "X".repeat(65) })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ productCode: "TEE.CORE/A_1" })).success).toBe(true);
  });
});

describe("product draft: organisation", () => {
  it("limits descriptions, categories and attribute selections structurally", () => {
    // 20 gallery images max — more images need to be shared gallery-reuse, not more rows.
    const images = Array.from({ length: 20 }, () => ({ mediaId: uuid() }));
    expect(productDraftSchema.safeParse(payload({ images })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ images: [...images, { mediaId: uuid() }] })).success).toBe(false);

    const categories = Array.from({ length: 50 }, () => uuid());
    expect(productDraftSchema.safeParse(payload({ categoryIds: categories })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ categoryIds: [...categories, uuid()] })).success).toBe(false);

    const attributes = Array.from({ length: 30 }, () => uuid());
    expect(productDraftSchema.safeParse(payload({ attributeIds: attributes })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ attributeIds: [...attributes, uuid()] })).success).toBe(false);
  });

  it("accepts structured rich-text documents (not arbitrary strings) and rejects junk", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Soft cotton" }] }] };
    expect(productDraftSchema.safeParse(payload({ shortDescription: doc, description: doc })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ description: "<b>raw html</b>" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ description: { type: "not-a-doc" } })).success).toBe(false);
  });

  it("keeps unit labels short and non-empty, separate from the weight unit", () => {
    expect(productDraftSchema.safeParse(payload({ unitLabel: "piece" })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ unitLabel: "" })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ unitLabel: "x".repeat(25) })).success).toBe(false);
  });
});

describe("product draft: pricing and weight — money stays integer paisa", () => {
  it("rejects fractional or negative prices and out-of-range weights", () => {
    expect(productVariantInputSchema.safeParse({ ...validVariant, pricePaisa: 10.5 }).success).toBe(false);
    expect(productVariantInputSchema.safeParse({ ...validVariant, pricePaisa: -1 }).success).toBe(false);
    expect(productVariantInputSchema.safeParse({ ...validVariant, costPaisa: 9_000, compareAtPricePaisa: 15_000 }).success).toBe(true);

    expect(productDraftSchema.safeParse(payload({ weightValue: -0.1 })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ weightValue: 0 })).success).toBe(true);
    expect(productDraftSchema.safeParse(payload({ weightValue: 1_000_001 })).success).toBe(false);
    expect(productVariantInputSchema.safeParse({ ...validVariant, weightGrams: 499.5 }).success).toBe(false);
  });

  it("rejects weight units the converter does not understand", () => {
    expect(productDraftSchema.safeParse(payload({ weightUnit: "oz" })).success).toBe(false);
    expect(productVariantInputSchema.safeParse({ ...validVariant, weightUnit: "lb" }).success).toBe(true);
  });

  it("accepts a product-level default price offered to unpriced variants", () => {
    const parsed = productDraftSchema.parse(payload({ defaultPricePaisa: 9_950 }));
    expect(parsed.defaultPricePaisa).toBe(9_950);
    expect(productDraftSchema.safeParse(payload({ defaultPricePaisa: "not-a-number" })).success).toBe(false);
  });
});

describe("product draft: variants and preorder", () => {
  it("requires 1–500 variants", () => {
    expect(productDraftSchema.safeParse(payload({ variants: [] })).success).toBe(false);
    const many = Array.from({ length: 500 }, (_, index) => ({ ...validVariant, name: `Variant ${index}` }));
    expect(productDraftSchema.safeParse(payload({ variants: many })).success).toBe(true);
    expect(
      productDraftSchema.safeParse(payload({ variants: [...many, { ...validVariant, name: "Variant 500" }] })).success,
    ).toBe(false);
  });

  it("has NO preorder expected-date field — the old column never round-trips the form", () => {
    // A client that still sends the legacy field is parsed, but the value is
    // stripped from the contract the service receives.
    const parsed = productDraftSchema.parse(
      payload({ preorderExpectedAt: "2026-11-01", isPreorderEnabled: true, preorderNote: "Ships in November" }),
    );
    expect("preorderExpectedAt" in parsed).toBe(false);
    expect(parsed.isPreorderEnabled).toBe(true);
    expect(parsed.preorderNote).toBe("Ships in November");
    for (const variant of parsed.variants) {
      expect("preorderExpectedAt" in variant).toBe(false);
    }
  });

  it("keeps optimistic-concurrency and draft intents in the payload", () => {
    const parsed = productDraftSchema.parse(
      payload({ productId: uuid(), expectedUpdatedAt: "2026-09-19T08:30:00.000Z", saveAsDraft: true }),
    );
    expect(parsed.saveAsDraft).toBe(true);
    expect(parsed.expectedUpdatedAt).toBe("2026-09-19T08:30:00.000Z");
  });
});

describe("product draft: SEO", () => {
  it("enforces the character guidance as hard server limits", () => {
    expect(productDraftSchema.safeParse(payload({ seoTitle: "x".repeat(201) })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ seoDescription: "x".repeat(401) })).success).toBe(false);
    expect(productDraftSchema.safeParse(payload({ seoKeywords: "x".repeat(401) })).success).toBe(false);
    expect(
      productDraftSchema.safeParse(
        payload({ seoTitle: "Classic Tee", seoDescription: "A classic black tee.", seoImage: { mediaId: uuid() } }),
      ).success,
    ).toBe(true);
  });
});

describe("on-the-go creation schemas", () => {
  it("validates brands: slug optional, website must be a URL, logo is a media id", () => {
    expect(brandInputSchema.safeParse({ name: "Acme" }).success).toBe(true);
    expect(brandInputSchema.safeParse({ name: "Acme", websiteUrl: "ftp://acme" }).success).toBe(false);
    expect(brandInputSchema.safeParse({ name: "Acme", websiteUrl: "https://acme.example" }).success).toBe(true);
    expect(brandInputSchema.safeParse({ name: "Acme", websiteUrl: "" }).success).toBe(true);
    expect(brandInputSchema.safeParse({ name: "Acme", logoMediaId: "not-a-uuid" }).success).toBe(false);
  });

  it("validates unit labels and attribute values", () => {
    expect(unitLabelInputSchema.safeParse({ name: "dozen" }).success).toBe(true);
    expect(unitLabelInputSchema.safeParse({ name: "x".repeat(25) }).success).toBe(false);

    expect(attributeValueInputSchema.safeParse({ attributeId: uuid(), value: "Navy Blue" }).success).toBe(true);
    expect(attributeValueInputSchema.safeParse({ attributeId: uuid(), value: "Navy", colorHex: "#1e3a8a" }).success).toBe(true);
    expect(attributeValueInputSchema.safeParse({ attributeId: uuid(), value: "Navy", colorHex: "blue" }).success).toBe(false);
    expect(attributeValueInputSchema.safeParse({ attributeId: uuid(), value: "" }).success).toBe(false);
  });
});

describe("bulk action schema", () => {
  const productId = uuid();

  it("only accepts defined actions", () => {
    expect(
      bulkVariantActionSchema.safeParse({ productId, action: "set-primary-image", target: { kind: "all" } }).success,
    ).toBe(true);
    expect(bulkVariantActionSchema.safeParse({ productId, action: "delete-variants", target: { kind: "all" } }).success).toBe(
      false,
    );
  });

  it("defaults to preserving variant overrides and setting the attribute default", () => {
    const parsed = bulkVariantActionSchema.parse({
      productId,
      action: "set-primary-image",
      target: { kind: "attribute", criteria: [{ attributeId: uuid(), valueIds: [uuid()] }] },
      mediaId: uuid(),
    });
    expect(parsed.replaceOverrides).toBe(false);
    expect(parsed.setAttributeDefault).toBe(true);
  });

  it("requires at least one value in an attribute criterion", () => {
    expect(
      bulkVariantActionSchema.safeParse({
        productId,
        action: "set-price",
        target: { kind: "attribute", criteria: [{ attributeId: uuid(), valueIds: [] }] },
        pricePaisa: 100,
      }).success,
    ).toBe(false);
  });

  it("rejects fractional bulk prices and weights the variants never carry", () => {
    expect(
      bulkVariantActionSchema.safeParse({ productId, action: "set-price", target: { kind: "all" }, pricePaisa: 99.9 }).success,
    ).toBe(false);
    expect(
      bulkVariantActionSchema.safeParse({ productId, action: "set-weight", target: { kind: "all" }, weightGrams: -1 }).success,
    ).toBe(false);
  });
});

describe("availability check payloads", () => {
  it("bounds slug and sku check requests", () => {
    expect(slugCheckSchema.safeParse({ slug: "scarf" }).success).toBe(true);
    expect(skuCheckSchema.safeParse({ productSku: "TEE" }).success).toBe(true);
    expect(skuCheckSchema.safeParse({ productCode: "TEE" }).success).toBe(true);
    expect(skuCheckSchema.safeParse({ productSku: "X".repeat(65) }).success).toBe(false);
  });
});
