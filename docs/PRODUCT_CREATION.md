# Product Creation — Create/Edit Product flow

How the product editor works: the screens, the one shared Media Manager, variant
generation and bulk actions, product-level SKU, and the backend contract every
payload goes through. UI work lives on top of the architecture in
`docs/ARCHITECTURE.md`; money, audit and permission rules follow `docs/BUSINESS_RULES.md`.

Routes:

- `/admin/catalog/products/new` — create (requires the `product.create` permission).
- `/admin/catalog/products/[id]/edit` — edit the whole product (requires `product.update`).
- `/admin/catalog/products/[id]` — view-only summary with a link into the editor.
  There is no intermediate variant page. Edit from the product list opens the editor
  directly.

Navigation: the **Product** sidebar group contains Products, Labels, and Bin.
Brands, categories, attributes, tax rates, packaging costs, and unit labels stay
under Catalog. Inventory stays under Stock.

## 1. Shape of the flow

```
Admin page (RSC)
  └── loadProductEditorData(businessId, viewer, productId?)     ← read model, one query set
        └── ProductEditorForm (client shell)
              └── saveProductAction(payload)                    ← JSON server action
                    └── productDraftSchema.parse                ← zod: lengths, types, limits
                          └── saveProduct(actor, input)         ← ONE Prisma transaction
```

- One submit saves everything (information, organisation, images, attributes,
  variants, pricing, description, SEO). A partially created product is impossible.
- The client computes previews (slug suggestion, variant matrix, bulk impact counts)
  with the **same pure functions** the server re-validates with
  (`src/modules/catalog/product-draft.ts`). There is one definition of each rule.
- Rich-text descriptions travel as structured documents and are validated a second
  time server-side (`src/lib/rich-text-document.ts` + `src/modules/media/content.ts`).
- Autosave is real: a 2.5s debounce writes a `ProductDraft` row server-side.
  Duplicate drafts are not created. Leaving the editor with unsaved work uses an
  in-app dialog, never `alert()` / `confirm()`.

The editor (`src/components/forms/product-editor/`) uses named section chips in
this order:

1. Product information (name, product type, SKU/product code, barcode).
2. Organisation (brand, categories, labels with inline create, unit, weight).
3. Images (one primary image, separate additional images).
4. Attributes & variations (variable products only).
5. Description (its own section).
6. SEO (last).

Pricing (current price, % or flat discount, server-calculated sell price) renders
after Information and is not a section chip. SIMPLE products collapse attributes
and variations to a single variant.

## 2. Basic information

- **Name** is required (2–200 characters).
- **Product type**: SIMPLE (one variant, no option matrix) or VARIABLE (combinations
  generated from selected attribute values). Switching to SIMPLE keeps one variant
  and clears attribute value ids.
- **Slug** suggestions use `suggestSlug()`: NFKD normalised, combining marks stripped,
  punctuation/whitespace collapsed to single dashes, length capped on a word boundary.
  Manual edits are never overwritten; `Regenerate slug` re-derives from the name on
  demand. The field debounce-checks availability against the backend
  (`checkProductSlugAction`); the server re-suffixes itself at save time inside
  the transaction (`uniqueProductSlug`), so two concurrent creators can never collide.
- **Product Code (SKU)** belongs to the **product**. There is no variant SKU, no
  Variant SKU field, and no compatibility aliases (`variant_sku`, `variantSku`).
  Variants are identified by `id` + deterministic `optionKey`. Order lines may
  snapshot the product SKU. Codes are unique per business, normalised
  (trim + uppercase) before comparison.

## 3. Organisation: brand, labels, unit, weight, categories

- **Brand**: searchable select plus `+ Create brand` (name, slug, logo via the
  shared Media Manager). Auto slug with `-2…` suffixing; case-insensitive
  duplicate-name conflict; logo must be an image asset.
- **Labels**: first-class, like brand and category. Selected or created inline from
  the editor (`createLabel`). The Product sidebar also has a Labels page.
- **Unit Label**: searchable list plus ad-hoc values. `createUnitLabel` normalises
  case/whitespace so `Bundle` and `  bundle  ` resolve to the same row.
- **Weight** converts through `toWeightGrams(value, unit)`: blanks stay blank, and
  NaN/Infinity/negative inputs are rejected rather than coerced.
- **Categories**: hierarchical multi-select plus `+ Create category`. The primary
  category must be one of the selected ones; references are re-validated server-side.

## 4. One Media Manager, everywhere

The editor never uploads anything itself. Every image field (product primary/gallery,
variant images, attribute-value defaults, brand logo, category image, SEO/social image,
images inside the rich-text description) is a stable `mediaId` resolved through the
platform Media Manager (`src/modules/media/` + `src/components/media/`):

- pickers are `MediaField` / `MediaGalleryField` / `MediaPicker`;
- the editor only ever stores ids, never object keys or signed URLs;
- `saveProduct` verifies every referenced id exists in this business and that every
  *image* field actually holds an image;
- every association is written to `MediaUsage` and `syncMediaUsageCounts` keeps the
  counters honest;
- removing an image in the editor deletes the **usage row only** — the shared asset is
  never deleted.

**Primary image** is stored on `Product.primaryImageMediaId` and is independent of
`ProductImage`. Additional images never include the primary. There is no “make
primary” control inside additional images. Do not assign images while selecting
attribute values.

## 5. Attributes, variants and the matrix

- SIMPLE products skip this section. VARIABLE products attach attributes (≤ 30)
  with multi-value selection; new attributes and new values are created from inside
  the section without leaving the form.
- Image assignment is **not** part of attribute-value selection. Attribute default
  images (level 2 of inheritance) can be set later from the variant table or bulk
  actions.
- The variant matrix is planned, not blind-regenerated (`planMatrix`): existing
  combinations keep their row and every value typed into it; new combinations become
  rows; deselected combinations become **orphans** listed for explicit removal.
  Duplicate combinations are impossible by construction and by the
  `(productId, optionKey)` unique index.
- Each variant carries name, barcode, optional price/cost/weight/preorder overrides,
  image override and gallery. Variants never carry a SKU. Costs are only rendered
  when the viewer has `product.view_cost`.
- Clearing an override restores inheritance. The UI never treats the word
  “inherited” as an input value.

## 6. Image inheritance — three levels, one winner

`resolveVariantImage` is the single rule used by the editor, the bulk preview and
anywhere else a variant image is picked:

```
variant override (Variant.imageMediaId)
  → attribute-value default (AttributeValue.mediaId)   “Inherited from Color: Black”
    → product primary image (Product.primaryImageMediaId)   “Inherited from product”
      → none                                            “No image”
```

The variant table shows which level each row is using, and `Reset` clears the override
back to inheritance. The same asset can back any number of variants at any level;
usage rows, not copies, are what multiply.

## 7. Bulk variant actions

`bulkVariantActionAction` → `bulkApplyVariantAction`. Targeting and fields change
with the chosen action.

- **Targeting**: selected variants, or attribute-matched (“Color = Black”, several
  criteria ANDed). `resolveBulkTarget` is the same function the preview uses.
- **Image actions on attribute targets prefer the default**: `set-primary-image`
  targeted at “Color = Black” sets `AttributeValue.mediaId` so Black variants —
  including future ones — inherit it. Variants with their own override are
  **preserved** unless the operator explicitly ticks *Replace variant images*.
- Money actions rewrite the override plus the default price-list row in integer
  paisa. Empty target groups are validation errors, never silent no-ops.
- Restore-inheritance actions (`clear-price-override`, `clear-image-override`, …)
  clear the variant field so the next level applies.

## 8. Pricing

- Product-level **current price**, **discount** (percentage or flat amount), and a
  **sell price calculated on the server** in integer paisa. The browser’s displayed
  sell price is a preview; `saveProduct` recalculates.
- Inheritance: variant override > attribute-level override > product default.
- All money is integer paisa end to end (`zMoneyPaisa`). Variant `costPaisa` is
  confidential unless the viewer holds `product.view_cost`.

## 9. Inventory is a separate module

- **Saving a product creates no stock.** Balances are ensured as zero rows.
  Inbound stock arrives through purchase receiving or an authorised inventory
  adjustment. The product list does not show on-hand or available quantities.
- There is no opening-stock toggle on create or edit.
- Preorder is enable/disable per product and per variant plus a note. The
  preorder expected-date column is deprecated and is not part of this flow.

## 10. Description and SEO

- **Description** is its own section (short + long rich text).
- **SEO** is last: title, description, keywords, social image. Character limits
  are enforced server-side. Manual edits are never overwritten by name/slug defaults.

## 11. Drafts, bin, concurrency, permissions

- Autosave persists a `ProductDraft` with a revision. A conflict (another tab)
  is reported instead of silently overwriting.
- Discarding an unpublished DRAFT bins the product. The Bin page supports restore
  and permanent delete through in-app dialogs.
- **Optimistic locking**: edit payloads carry `expectedUpdatedAt`. A concurrent
  change is a conflict telling the user to reload.
- Permissions: `product.create` on new, `product.update` on edit and save,
  `product.view_cost` for cost fields, `media.manage` for picker/upload.
- Failure preserves data: validation errors keep the form state; only success
  navigates away.

## 12. Tests

- `tests/lib/product-draft.test.ts` — slug/weight/SKU rules, matrix planning,
  three-level image resolution, bulk targeting and impact counts.
- `tests/lib/product-schemas.test.ts` — the payload contract: name/slug/code limits,
  integer-paisa money, weight bounds, 1–500 variants, image/category/attribute caps,
  SEO limits, bulk action schemas.
- `tests/integration/product-editor.test.ts` — against the real database: one-transaction
  creation with zero stock, slug suffixing, product-code uniqueness (no variant SKU),
  forged references, media verification, rich-text documents, media ids surviving
  save+reload, variant archival, optimistic locking, brand/unit-label dedupe,
  Black-only bulk image with override preservation, targeted price/weight updates.

Run them with `npx vitest run` (integration tests need the development database).
Current status is in `docs/TESTING.md`.
