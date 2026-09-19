import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zOptionalSlug } from "@/lib/validation";
import { categoryInputSchema, productInputSchema, attributeInputSchema, priceListInputSchema } from "@/modules/catalog/schemas";

/**
 * Regression: the category/product/attribute forms submit an optional slug
 * field. When the operator leaves it blank the browser sends an empty string,
 * which used to fail `zSlug`'s `min(1)` rule and — because the parse happened
 * outside the action's try/catch — crashed the whole admin area into the error
 * boundary. A blank slug must mean "generate it from the name" (undefined).
 */
describe("zOptionalSlug", () => {
  it("passes a valid slug through unchanged", () => {
    expect(zOptionalSlug.parse("winter-sale")).toBe("winter-sale");
    expect(zOptionalSlug.parse("a1-b2")).toBe("a1-b2");
  });

  it("treats an empty string as undefined so the slug can be auto-generated", () => {
    expect(zOptionalSlug.parse("")).toBeUndefined();
  });

  it("treats a missing field as undefined", () => {
    expect(zOptionalSlug.parse(undefined)).toBeUndefined();
  });

  it("still rejects an invalid non-empty slug", () => {
    expect(() => zOptionalSlug.parse("Not A Slug")).toThrow();
    expect(() => zOptionalSlug.parse("UPPER")).toThrow();
    expect(() => zOptionalSlug.parse("trailing-")).toThrow();
  });

  it("keeps the key optional in inferred object types", () => {
    const schema = z.object({ slug: zOptionalSlug });
    // No `slug` key at all must be accepted.
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ slug: "" }).slug).toBeUndefined();
    expect(schema.parse({ slug: "ok" }).slug).toBe("ok");
  });
});

describe("catalog input schemas accept a blank slug", () => {
  it("categoryInputSchema leaves slug undefined when blank", () => {
    const parsed = categoryInputSchema.parse({ name: "Electronics", slug: "", isActive: true, isFeatured: false });
    expect(parsed.slug).toBeUndefined();
  });

  it("productInputSchema leaves slug undefined when blank", () => {
    const parsed = productInputSchema.parse({
      name: "A product",
      slug: "",
      productType: "SIMPLE",
      variants: [{ name: "Default", sku: "SKU-1", pricePaisa: 100, attributeValueIds: [], isPreorderEnabled: false }],
    });
    expect(parsed.slug).toBeUndefined();
  });

  it("attributeInputSchema leaves slug undefined when blank", () => {
    const parsed = attributeInputSchema.parse({ name: "Size", slug: "", values: [] });
    expect(parsed.slug).toBeUndefined();
  });

  it("priceListInputSchema leaves slug undefined when blank", () => {
    const parsed = priceListInputSchema.parse({ name: "Retail", slug: "", channel: "DEFAULT" });
    expect(parsed.slug).toBeUndefined();
  });
});
