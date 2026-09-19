import { describe, expect, it } from "vitest";
import { attributeValuesFromForm } from "@/modules/catalog/attribute-form-values";

/**
 * The "New attribute" form submits one `valueTexts` input per row plus an
 * optional `valueColors` hex input per row. These tests pin the zipping and
 * blank-row behaviour so the dynamic editor can grow to any number of rows.
 */
describe("attributeValuesFromForm", () => {
  it("zips the parallel text and colour arrays by row index", () => {
    expect(
      attributeValuesFromForm({
        texts: ["Red", "Blue", "Green"],
        colors: ["#dc2626", "#2563eb", "#16a34a"],
      }),
    ).toEqual([
      { value: "Red", colorHex: "#dc2626" },
      { value: "Blue", colorHex: "#2563eb" },
      { value: "Green", colorHex: "#16a34a" },
    ]);
  });

  it("supports as many rows as the operator adds", () => {
    const texts = Array.from({ length: 50 }, (_, index) => `Value ${index + 1}`);
    const values = attributeValuesFromForm({ texts, colors: [] });
    expect(values).toHaveLength(50);
    expect(values[0]).toEqual({ value: "Value 1", colorHex: undefined });
    expect(values[49]).toEqual({ value: "Value 50", colorHex: undefined });
  });

  it("drops blank rows and trims surrounding whitespace", () => {
    expect(
      attributeValuesFromForm({
        texts: ["  S  ", "", "   ", "M"],
        colors: ["", "#000000", "#ffffff", ""],
      }),
    ).toEqual([{ value: "S", colorHex: undefined }, { value: "M", colorHex: undefined }]);
  });

  it("treats a missing or empty colour as no colour", () => {
    expect(attributeValuesFromForm({ texts: ["Plain"], colors: [] })).toEqual([{ value: "Plain", colorHex: undefined }]);
    expect(attributeValuesFromForm({ texts: ["Plain"], colors: ["  "] })).toEqual([{ value: "Plain", colorHex: undefined }]);
  });

  it("returns no values for an empty form", () => {
    expect(attributeValuesFromForm({ texts: [], colors: [] })).toEqual([]);
  });
});
