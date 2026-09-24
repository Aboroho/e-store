import { describe, expect, it } from "vitest";
import {
  applyLocalBulkAction,
  buildCombinations,
  combinationKey,
  describeBulkTarget,
  duplicateSkus,
  fromWeightGrams,
  imageActionImpact,
  isValidSku,
  isValidSlug,
  normalizeSku,
  nextAvailableSlug,
  planMatrix,
  resolveBulkTarget,
  resolveVariantImage,
  shouldAutosaveDraft,
  suggestSlug,
  toWeightGrams,
  variantLabel,
  type DraftAttribute,
  type DraftVariant,
} from "@/modules/catalog/product-draft";

/**
 * Pure helpers behind the product editor. The same functions run in the browser
 * (live previews and counts) and on the server (re-validation before writes), so
 * they are the single definition of slug, weight, matrix and bulk behaviour.
 */

const color: DraftAttribute = {
  id: "attr-color",
  name: "Color",
  slug: "color",
  isVariantDefining: true,
  values: [
    { id: "v-black", value: "Black", mediaId: "media-black" },
    { id: "v-white", value: "White", mediaId: null },
  ],
};

const size: DraftAttribute = {
  id: "attr-size",
  name: "Size",
  slug: "size",
  isVariantDefining: true,
  values: [
    { id: "v-s", value: "S" },
    { id: "v-m", value: "M" },
  ],
};

function variant(partial: Partial<DraftVariant>): DraftVariant {
  return {
    key: partial.key ?? "row-1",
    name: "",
    imageMediaId: null,
    galleryMediaIds: [],
    attributeValueIds: [],
    ...partial,
  };
}

describe("slug helpers", () => {
  it("normalises case, accents and punctuation", () => {
    expect(suggestSlug("Café Ménage — Arrow T-Shirt!")).toBe("cafe-menage-arrow-t-shirt");
    expect(suggestSlug("  My   First   Product  ")).toBe("my-first-product");
    expect(suggestSlug("H&M's \"Classic\" Tee")).toBe("h-ms-classic-tee");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(suggestSlug(" টি-শার্ট ")).toBe("");
    expect(suggestSlug("!!!")).toBe("");
  });

  it("caps the length on a word boundary instead of cutting a word in half", () => {
    const slug = suggestSlug("one two three four five six", 12);
    expect(slug).toBe("one-two");
    expect(isValidSlug(slug)).toBe(true);
  });

  it("validates slug syntax", () => {
    expect(isValidSlug("black-shoes-2")).toBe(true);
    expect(isValidSlug("Black-Shoes")).toBe(false);
    expect(isValidSlug("double--dash")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  it("suggests the next free URL without mutating the desired slug", () => {
    expect(nextAvailableSlug("scarf", [])).toBe("scarf");
    expect(nextAvailableSlug("scarf", ["scarf", "scarf-2"])).toBe("scarf-3");
    expect(nextAvailableSlug("", [])).toBe("item");
  });
});

describe("weight conversion", () => {
  it("converts kilograms and pounds to whole grams", () => {
    expect(toWeightGrams("1.5", "kg")).toBe(1500);
    expect(toWeightGrams(1, "lb")).toBe(454);
    expect(toWeightGrams("250", "g")).toBe(250);
  });

  it("never misinterprets units or invalid numbers", () => {
    // A blank field stays blank — never zero.
    expect(toWeightGrams("", "kg")).toBeNull();
    expect(toWeightGrams(null, "g")).toBeNull();
    // NaN / Infinity / negative are rejected, not coerced.
    expect(toWeightGrams("abc", "g")).toBeNull();
    expect(toWeightGrams(Number.POSITIVE_INFINITY, "g")).toBeNull();
    expect(toWeightGrams(-5, "kg")).toBeNull();
  });

  it("round-trips display values", () => {
    expect(fromWeightGrams(1500, "kg")).toBe("1.5");
    expect(fromWeightGrams(500, "g")).toBe("500");
    expect(fromWeightGrams(null, "kg")).toBe("");
  });
});

describe("draft autosave gating", () => {
  it("never autosaves Add New Product — create is always a fresh session", () => {
    expect(
      shouldAutosaveDraft({
        dirty: true,
        name: "Shoes",
        productCode: "SHOE-1",
        productId: null,
        fingerprint: "a",
        lastSavedFingerprint: null,
      }),
    ).toBe(false);
  });

  it("saves a dirty edit of an existing product", () => {
    expect(
      shouldAutosaveDraft({
        dirty: true,
        name: "Shoes",
        productCode: "SHOE-1",
        productId: "prod-1",
        fingerprint: "a",
        lastSavedFingerprint: null,
      }),
    ).toBe(true);
  });

  it("skips a request when nothing changed since the last save", () => {
    expect(
      shouldAutosaveDraft({
        dirty: true,
        name: "Shoes",
        productCode: "SHOE-1",
        productId: "prod-1",
        fingerprint: "same",
        lastSavedFingerprint: "same",
      }),
    ).toBe(false);
  });

  it("does not save when the form is clean", () => {
    expect(
      shouldAutosaveDraft({
        dirty: false,
        name: "Shoes",
        productCode: "SHOE-1",
        productId: "prod-1",
        fingerprint: "a",
        lastSavedFingerprint: null,
      }),
    ).toBe(false);
  });
});

describe("sku helpers", () => {
  it("normalises for comparison and validates the allowed pattern", () => {
    expect(normalizeSku(" tee-1 ")).toBe("TEE-1");
    expect(isValidSku("TEE.1/X_2")).toBe(true);
    expect(isValidSku("A")).toBe(false);
    expect(isValidSku("bad sku!")).toBe(false);
  });

  it("detects duplicates case-insensitively", () => {
    expect(duplicateSkus(["tee-1", "TEE-1", "tee-2"])).toEqual(["TEE-1"]);
    expect(duplicateSkus(["a-1", "b-2"])).toEqual([]);
  });
});

describe("variant matrix", () => {
  it("builds the cartesian product of selected values only", () => {
    expect(buildCombinations([color, size], [])).toEqual([]);
    expect(buildCombinations([color, size], ["v-black", "v-white", "v-s"])).toEqual([
      ["v-black", "v-s"],
      ["v-white", "v-s"],
    ]);
  });

  it("labels rows from their attribute values in matrix order", () => {
    expect(variantLabel([color, size], ["v-black", "v-s"])).toBe("Black / S");
    // The label follows the order the combination was built in, not the attribute list.
    expect(variantLabel([color, size], ["v-s", "v-black"])).toBe("S / Black");
  });

  it("recombines without destroying manually entered data", () => {
    const existing = [
      variant({ key: "v1", id: "id-1", name: "Black / S", currentPrice: "900", attributeValueIds: ["v-black", "v-s"], touched: true }),
      variant({ key: "v2", id: "id-2", name: "Legacy row", currentPrice: "850", attributeValueIds: ["v-m"] }),
    ];
    const plan = planMatrix([color, size], ["v-black", "v-white", "v-s"], existing, { keepOrphans: true });

    // Existing combination survives with its typed price untouched.
    expect(plan.kept).toHaveLength(1);
    expect(plan.kept[0]!.name).toBe("Black / S");
    expect(plan.kept[0]!.currentPrice).toBe("900");

    // The new combination gets a fresh row.
    expect(plan.added).toHaveLength(1);
    expect(plan.added[0]!.name).toBe("White / S");

    // The deselected combination is an orphan, not silently deleted.
    expect(plan.orphans.map((row) => row.name)).toEqual(["Legacy row"]);
    expect(plan.rows).toHaveLength(3);

    // With keepOrphans off the caller explicitly drops them.
    const hard = planMatrix([color, size], ["v-black", "v-white", "v-s"], existing, { keepOrphans: false });
    expect(hard.rows.filter((row) => row.name === "Legacy row")).toHaveLength(0);
  });

  it("never plans two rows for the same combination", () => {
    const duplicates = [
      variant({ key: "a", attributeValueIds: ["v-black"] }),
      variant({ key: "b", attributeValueIds: ["v-black"] }),
    ];
    const plan = planMatrix([color], ["v-black"], duplicates, { keepOrphans: true });
    // One combination → one row regardless of how confusing the current rows are:
    // the matrix emits a single row for the shared combination and adds nothing.
    expect(plan.combinations).toBe(1);
    expect(plan.added).toHaveLength(0);
    expect(plan.rows.filter((row) => combinationKey(row.attributeValueIds) === "v-black")).toHaveLength(1);
    expect(plan.rows).toHaveLength(1);
  });

});

describe("image inheritance", () => {
  const attributes = [color, size];

  it("uses the variant override above every default", () => {
    const resolved = resolveVariantImage({
      imageMediaId: "media-override",
      attributeValueIds: ["v-black"],
      productImageMediaId: "media-product",
      attributes,
    });
    expect(resolved.kind).toBe("variant");
    expect(resolved.label).toBe("Custom variant image");
    expect(resolved.mediaId).toBe("media-override");
  });

  it("falls back to the attribute-value default with a human label", () => {
    const resolved = resolveVariantImage({
      imageMediaId: null,
      attributeValueIds: ["v-black", "v-s"],
      productImageMediaId: "media-product",
      attributes,
    });
    expect(resolved.kind).toBe("attribute");
    expect(resolved.label).toBe("Inherited from Color: Black");
    expect(resolved.mediaId).toBe("media-black");
  });

  it("falls back to the product image, then to none", () => {
    expect(
      resolveVariantImage({ imageMediaId: null, attributeValueIds: ["v-white"], productImageMediaId: "media-product", attributes })
        .label,
    ).toBe("Inherited from product primary image");
    expect(
      resolveVariantImage({ imageMediaId: null, attributeValueIds: ["v-white"], productImageMediaId: null, attributes }),
    ).toMatchObject({ kind: "none", mediaId: null });
  });
});

describe("bulk targeting", () => {
  const rows = [
    variant({ key: "black-s", id: "id-black-s", attributeValueIds: ["v-black", "v-s"] }),
    variant({ key: "black-m", id: "id-black-m", attributeValueIds: ["v-black", "v-m"] }),
    variant({ key: "white-s", id: "id-white-s", attributeValueIds: ["v-white", "v-s"] }),
  ];
  const context = { rows, selectedIds: ["id-black-s"], attributes: [color, size] };

  it("resolves all, selected and attribute-matched targets", () => {
    expect(resolveBulkTarget({ kind: "all" }, context)).toHaveLength(3);
    expect(resolveBulkTarget({ kind: "selected", variantIds: ["id-black-s"] }, context).map((row) => row.key)).toEqual(["black-s"]);
    const blackOnly = resolveBulkTarget(
      { kind: "attribute", criteria: [{ attributeId: "attr-color", valueIds: ["v-black"] }] },
      context,
    ).map((row) => row.key);
    // The required behaviour: Black variants only, White untouched.
    expect(blackOnly.sort()).toEqual(["black-m", "black-s"]);
  });

  it("matches every criterion (Color = Black AND Size = S)", () => {
    const both = resolveBulkTarget(
      {
        kind: "attribute",
        criteria: [
          { attributeId: "attr-color", valueIds: ["v-black"] },
          { attributeId: "attr-size", valueIds: ["v-s"] },
        ],
      },
      context,
    ).map((row) => row.key);
    expect(both).toEqual(["black-s"]);
  });

  it("resolves selection by the stable variant id, not an index", () => {
    const byDbId = resolveBulkTarget(
      { kind: "selected" },
      { rows, selectedIds: ["id-white-s"], attributes: [color, size] },
    ).map((row) => row.key);
    expect(byDbId).toEqual(["white-s"]);
  });

  it("describes targets the way the confirmation dialog shows them", () => {
    expect(
      describeBulkTarget(
        { kind: "attribute", criteria: [{ attributeId: "attr-color", valueIds: ["v-black"] }] },
        { attributes: [color, size], selectedCount: 1, totalCount: 3 },
      ),
    ).toBe("Variants where Color = Black");
    expect(describeBulkTarget({ kind: "all" }, { attributes: [], selectedCount: 0, totalCount: 3 })).toBe("All 3 variant(s)");
    expect(describeBulkTarget({ kind: "selected" }, { attributes: [], selectedCount: 2, totalCount: 3 })).toBe(
      "2 selected variant(s)",
    );
  });
});

describe("local bulk apply", () => {
  const rows = [
    variant({ key: "black-s", attributeValueIds: ["v-black", "v-s"] }),
    variant({ key: "black-m", attributeValueIds: ["v-black", "v-m"] }),
    variant({ key: "white-s", attributeValueIds: ["v-white", "v-s"] }),
  ];

  it("applies a local bulk price to selected rows without touching the others", () => {
    const next = applyLocalBulkAction(rows, [rows[0]!, rows[1]!], {
      action: "set-price",
      currentPrice: "19.99",
      discountType: "NONE",
    });
    expect(next[0]!.currentPrice).toBe("19.99");
    expect(next[1]!.currentPrice).toBe("19.99");
    expect(next[2]!.currentPrice).toBeUndefined();
  });

  it("preserves a variant image override unless replaceOverrides is on", () => {
    const withOverride = [
      variant({ key: "black-s", imageMediaId: "keep-me", attributeValueIds: ["v-black", "v-s"] }),
      variant({ key: "black-m", imageMediaId: null, attributeValueIds: ["v-black", "v-m"] }),
    ];
    const kept = applyLocalBulkAction(withOverride, withOverride, {
      action: "set-primary-image",
      mediaId: "new-image",
      replaceOverrides: false,
    });
    expect(kept[0]!.imageMediaId).toBe("keep-me");
    expect(kept[1]!.imageMediaId).toBe("new-image");
  });
});

describe("bulk image impact preview", () => {
  const attributes = [color, size];

  it("counts inherited, overridden and unchanged rows like the dialog does", () => {
    const target = [
      variant({ key: "plain", attributeValueIds: ["v-white"] }), // would inherit
      variant({ key: "custom", imageMediaId: "media-other", attributeValueIds: ["v-black"] }), // has override
      variant({ key: "same", attributeValueIds: ["v-black"] }), // already shows media-black via the value
    ];
    const impact = imageActionImpact(target, { mediaId: "media-black", productImageMediaId: null, attributes }, { replaceOverrides: false });
    expect(impact).toEqual({ inherited: 1, overridden: 1, unchanged: 1 });
  });

  it("counts overrides as replaced when the user explicitly chose to replace them", () => {
    const target = [variant({ key: "custom", imageMediaId: "media-other", attributeValueIds: ["v-black"] })];
    expect(imageActionImpact(target, { mediaId: "media-black", productImageMediaId: null, attributes }, { replaceOverrides: true })).toEqual(
      { inherited: 1, overridden: 0, unchanged: 0 },
    );
  });
});
