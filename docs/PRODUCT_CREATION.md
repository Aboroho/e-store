# Product Creation — Create/Edit Product flow

How the product editor works: the screens, the one shared Media Manager, variant
generation and bulk actions, the three-level image inheritance, and the backend
contract every payload goes through. UI work lives on top of the architecture in
`docs/ARCHITECTURE.md`; money, audit and permission rules follow `docs/BUSINESS_RULES.md`.

Routes:

- `/admin/catalog/products/new` — create (requires the `product.create` permission).
- `/admin/catalog/products/[id]/edit` — edit the whole product (requires `product.update`).
- `/admin/catalog/products/[id]` — read-only summary (stock by variant, archive/restore)
  with a link into the editor.

## 1. Shape of the flow

```
Admin page (RSC)
  └── loadProductEditorData(businessId, viewer, productId?)     ← read model, one query set
        └── ProductEditorForm (client shell, 9 collapsible sections)
              └── saveProductAction(payload)                    ← JSON server action
                    └── productDraftSchema.parse                ← zod: lengths, types, limits
                          └── saveProduct(actor, input)         ← ONE Prisma transaction
```

- One submit saves everything (basic info, organisation, descriptions, images,
  attributes, variants, pricing, SEO). A partially created product is impossible.
- The client computes previews (slug suggestion, variant matrix, bulk impact counts)
  with the **same pure functions** the server re-validates with
  (`src/modules/catalog/product-draft.ts`). There is one definition of each rule.
- Rich-text descriptions travel as structured documents and are validated a second
  time server-side (`src/lib/rich-text-document.ts` + `src/modules/media/content.ts`).

The editor shell (`src/components/forms/product-editor/`) renders nine independently
collapsible sections, in order: Basic Information · Product Organization · Product
Description · Product Images · Product Attributes & Variations · Variant Bulk Actions ·
Pricing & Product Data · Inventory & Preorder · SEO. Expand/collapse-all, completion
chips per section, `beforeunload` + explicit discard dialog for unsaved changes, double
-submit protection, and success navigating to the real product page.

## 2. Basic information

- **Name** is required (2–200 characters).
- **Slug** suggestions use `suggestSlug()`: NFKD normalised, combining marks stripped,
  punctuation/whitespace collapsed to single dashes, length capped on a word boundary.
  Manual edits are never overwritten; `Regenerate slug` re-derives from the name on
  demand. The field debounce-checks availability against the backend
  (`checkProductSlugAction` returns `{ slug, available, suggestion, preview }`); the
  suggestion is only a suggestion — the server re-suffixes itself at save time inside
  the transaction (`uniqueProductSlug`), so two concurrent creators can never collide.
  The live URL preview uses the verified primary storefront domain when one exists,
  otherwise the `/s/{slug}/products/` fallback.
- **Product Code (SKU)** is required and unique per business
  (`assertSkusAvailable`): it must not equal another product's code or any variant
  code. Variant SKUs are globally unique across the platform (orders reference them),
  checked only for the codes that actually changed. Codes are normalised
  (trim + uppercase) before comparison.

## 3. Organisation: brand, unit, weight, categories

- **Brand**: searchable select fed by `listBrandOptions` (product counts + logo thumbs).
  `+ Create brand` opens a dialog (name, slug, logo via the shared Media Manager,
  description) backed by `createBrand`: auto slug with `-2…` suffixing, case-insensitive
  duplicate-name conflict, logo must be an image asset. On success the dialog auto-selects
  the brand and the picker refreshes in the background; the form state is untouched.
- **Unit Label**: searchable list (`listUnitLabels`, seeded defaults) plus ad-hoc values.
  `createUnitLabel` normalises case/whitespace so `Bundle` and `  bundle  ` resolve to the
  same row. Unit labels are **sale/count units** (piece, pair, dozen) and are separate
  from the shipping **weight unit** (g/kg/lb) — the tooltip on the field says so.
- **Weight** converts through `toWeightGrams(value, unit)`: blanks stay blank, and
  NaN/Infinity/negative inputs are rejected rather than coerced, so a pound is never
  silently stored as grams.
- **Categories**: hierarchical multi-select with removal and an empty state, plus
  `+ Create category` (name, slug, parent, description, image via the Media Manager).
  The primary category must be one of the selected ones; references are re-validated
  server-side.

## 4. One Media Manager, everywhere

The editor never uploads anything itself. Every image field (product primary/gallery,
variant images, attribute-value defaults, brand logo, category image, SEO/social image,
images inside the rich-text description) is a stable `mediaId` resolved through the
platform Media Manager (`src/modules/media/` + `src/components/media/`):

- pickers are `MediaField` / `MediaGalleryField` / `MediaPicker` with `uploadEnabled` and
  `canManage` fed from the viewer's `media.manage` permission — no product-specific
  uploader exists;
- storage keys stay `businesses/{businessId}/{yyyy}/{mm}/{uuid}-{slug}.{ext}` with
  checksum dedupe; the editor only ever stores ids, never object keys or signed URLs;
- `saveProduct` verifies every referenced id exists in this business and that every
  *image* field actually holds an image (`assertMediaAssetsAvailable`,
  `assertImageAssets`), and validates media embedded in description documents the same way;
- every association is written to `MediaUsage` (`PRODUCT primary-image|gallery-image|
  seo-image|description`, `VARIANT primary-image|gallery-image`, `ATTRIBUTE_VALUE
  default-image`, `BRAND logo`, `CATEGORY image`) and `syncMediaUsageCounts` keeps the
  counters honest, so the library blocks deletion of anything in use;
- removing an image in the editor deletes the **usage row only** — the shared asset is
  never deleted, and an asset reused by five products is stored once.

## 5. Attributes, variants and the matrix

- Attributes attach to the product (≤ 30) with multi-value selection; new attributes
  and new values (e.g. *Navy Blue*) are created from inside the section with duplicate
  validation, without leaving the form or losing state.
- The variant matrix is planned, not blind-regenerated (`planMatrix`): existing
  combinations keep their row and every value typed into it; new combinations become
  rows; deselected combinations become **orphans** listed for explicit removal rather
  than disappearing. Duplicate combinations are impossible by construction and by the
  `(productId, optionKey)` unique index.
- Each variant carries sku (required, unique), price, compare-at, cost, weight
  (+ its own unit), preorder flag, image override, gallery (≤ 12) and barcode. Costs are
  only rendered when the viewer has `product.view_cost`.

## 6. Image inheritance — three levels, one winner

`resolveVariantImage` is the single rule used by the editor, the bulk preview and
anywhere else a variant image is picked:

```
variant override (Variant.imageMediaId)
  → attribute-value default (AttributeValue.mediaId)   “Inherited from Color: Black”
    → product primary image (ProductImage position 0)   “Inherited from product”
      → none                                            “No image”
```

The variant table shows which level each row is using, and `Reset` clears the override
back to inheritance. `Variant.imageMediaId` is a plain column (not a relation) — the
read model resolves the referenced assets in one batched query — and the service
verifies the asset on every write. The same asset can back any number of variants at
any level; usage rows, not copies, are what multiply.

## 7. Bulk variant actions

`bulkVariantActionAction` → `bulkApplyVariantAction`. An action definition bundles the
target field, input, targeting mode, inheritance behaviour and confirmation level
(`src/components/forms/product-editor/bulk-actions.tsx`,
`BULK_VARIANT_ACTIONS`), so new actions extend one table.

- **Targeting**: all variants, the current selection, or attribute-matched
  (“Color = Black”, several criteria ANDed). `resolveBulkTarget` resolves the target —
  the pure function the preview uses is the function the service applies.
- **Image actions on attribute targets prefer the default**: `set-primary-image`
  targeted at “Color = Black” sets `AttributeValue.mediaId` so Black variants — including
  future ones — inherit it. Variants with their own override are **preserved** (counted
  as skipped, not touched) unless the operator explicitly ticks *Replace variant images*,
  and only then do variant rows change. White variants are untouched because the target
  group is computed from the criteria, not from names.
- Money actions rewrite the override plus the default price-list row (`minQuantity 1`)
  in integer paisa; weight normalises to grams with the typed unit preserved in variant
  metadata; preorder toggles the flag. Every run records a `variant.bulk_*` audit row
  with the target description and affected/skipped counts.
- Empty target groups are validation errors (`No variants match…`), never silent no-ops.

## 8. Pricing & product data

- All money is **integer paisa** end to end: `zMoneyPaisa` rejects fractional and
  negative values, the UI converts BDT ↔ paisa at the edges, and the product-level
  `defaultPricePaisa` (in product metadata) is offered to unpriced variants with an
  explicit *Apply to N unpriced variants* action — never auto-applied.
- `pricePaisa` is required per variant because the default price list
  (`priceListId` in the read model) always gets a row for `minQuantity 1`; creating a
  product with no price list in the business is a conflict, and the create page shows a
  warning in that state.
- Variant `costPaisa` is confidential: hidden unless the viewer holds
  `product.view_cost`.

## 9. Inventory & preorder

- **Saving a product creates no stock.** Balances are ensured as zero rows; the only
  way inventory moves is the explicit *Record opening stock* toggle, which posts an
  `OPENING` movement through the shared ledger (`applyStockMovement`) with the
  idempotency key `opening-stock:{productId}:{variantId}` — resubmits and double
  clicks replay the key and the balance does not move twice. Keys match by variant id or
  SKU (compared case-insensitively).
- Preorder is enable/disable per product and per variant plus a note; commitment goes
  through the ledger's preorder channels exactly like the rest of the platform.
- **The preorder *expected date* is not part of this flow**: the creation/edit UI and
  the `productDraftSchema` contract carry no expected-date field (a client that still
  sends it has it stripped), and no new logic reads `preorderExpectedAt`. The column
  remains in the database (`@deprecated`) for historical rows only — no destructive
  removal was performed.

## 10. SEO

Last section of the form. Title and description honour 200/400/400-character server
limits with live character guidance; defaults derive from name/slug **without
overwriting manual edits**; the social/search image is a Media Manager selection;
server-side validation is authoritative. The editor makes no ranking promises — it
stores metadata for the storefront templates to render.

## 11. Concurrency, failure modes, permissions

- **Optimistic locking**: edit payloads carry `expectedUpdatedAt` (the row's timestamp
  the form was rendered with). If the product changed by more than a second of clock
  skew in the meantime, the save is a conflict telling the user to reload — nothing is
  overwritten silently.
- **Permissions**: `product.create` on the new route, `product.update` on the edit route
  and on `saveProductAction`, `product.view_cost` for cost fields, `media.manage` for
  picker/upload capabilities (`page.manage` can browse). All checks use the shared
  `assertPermission`/`can` helpers; media routes keep their own capability checks.
- **Failure preserves data**: validation and backend errors render inline with the form
  state intact; only a success navigates away.
- Every write is one transaction; multi-record creations (brand + logo, product +
  variants + prices + usages + ledger) either all land or none do.

## 12. Tests

- `tests/lib/product-draft.test.ts` — slug/weight/SKU rules, matrix planning (data
  preserved, duplicates impossible), three-level image resolution, bulk targeting and
  impact counts.
- `tests/lib/product-schemas.test.ts` — the payload contract: name/slug/code limits,
  integer-paisa money, weight bounds, 1–500 variants, image/category/attribute caps, SEO
  limits, on-the-go creation schemas, bulk action schemas, and the explicit absence of a
  preorder expected-date field.
- `tests/integration/product-editor.test.ts` — against the real database: one-transaction
  creation with zero stock, slug suffixing, code uniqueness (payload, cross-product,
  parent-vs-variant), forged references and cross-business values, media verification
  (missing asset, PDF-as-image), rich-text documents with real media usages, media ids
  surviving save+reload, unlink-keeps-asset, variant archival, optimistic locking,
  idempotent opening stock, brand/unit-label dedupe, Black-only bulk image with override
  preservation and explicit replacement, targeted price/weight updates, and the editor
  read model's capability flags.

Run them with `npx vitest run` (integration tests need the development database;
`scripts/dev-db.sh` starts it). Current status is in `docs/TESTING.md`; the five suites
that already failed before this work do so on the pre-existing
`prisma.customer.create()` fixture issue, unrelated to the product editor.
