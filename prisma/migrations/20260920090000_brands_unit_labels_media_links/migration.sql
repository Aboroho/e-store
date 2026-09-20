-- ============================================================================
-- Product creation flow: brands, unit labels and shared media references
-- ============================================================================
--
-- Adds the data model the new Create/Edit Product flow needs, without touching
-- any existing column or row:
--
--   * "Brand"      — a real brand record (name, slug, description, logo media,
--                    SEO fields). `Product.brand` keeps the display name so the
--                    storefront and its search do not change behaviour.
--   * "UnitLabel"  — the pickable unit-label vocabulary ("piece", "pair", …).
--                    `Product.unitLabel` stays a text column: historic values
--                    keep rendering and nothing has to be rewritten.
--   * media links  — every place a feature points at a shared asset now has a
--                    real foreign key with ON DELETE SET NULL: a media asset is
--                    never deleted while content references it (the media
--                    manager refuses first) and a deleted asset clears the
--                    reference instead of leaving a dangling id.
--   * "Product"."seoImageMediaId" — the social/search sharing image.
--
-- `preorderExpectedAt` is deliberately left in place (deprecated, unused by the
-- UI): dropping it would discard historical values and is not needed to stop
-- writing it. See docs/PRODUCT_CREATION.md.

-- ---------------------------------------------------------------- brands -----
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoMediaId" TEXT,
    "websiteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Brand_businessId_slug_key" ON "Brand"("businessId", "slug");
CREATE INDEX "Brand_businessId_isActive_name_idx" ON "Brand"("businessId", "isActive", "name");
CREATE INDEX "Brand_businessId_deletedAt_idx" ON "Brand"("businessId", "deletedAt");

ALTER TABLE "Brand" ADD CONSTRAINT "Brand_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_logoMediaId_fkey"
  FOREIGN KEY ("logoMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------- unit labels -----
CREATE TABLE "UnitLabel" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnitLabel_businessId_slug_key" ON "UnitLabel"("businessId", "slug");
CREATE INDEX "UnitLabel_businessId_position_idx" ON "UnitLabel"("businessId", "position");

ALTER TABLE "UnitLabel" ADD CONSTRAINT "UnitLabel_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the shared vocabulary for every existing business. `ON CONFLICT DO
-- NOTHING` keeps this idempotent and never overwrites a label the business has
-- already renamed or re-ordered.
INSERT INTO "UnitLabel" ("id", "businessId", "name", "slug", "position", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  b."id",
  seed."name",
  seed."slug",
  seed."position",
  seed."isDefault",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Business" b
CROSS JOIN (VALUES
  ('piece', 'piece', 0, true),
  ('pair', 'pair', 1, false),
  ('set', 'set', 2, false),
  ('box', 'box', 3, false),
  ('pack', 'pack', 4, false),
  ('dozen', 'dozen', 5, false),
  ('meter', 'meter', 6, false),
  ('kilogram', 'kilogram', 7, false),
  ('litre', 'litre', 8, false)
) AS seed("name", "slug", "position", "isDefault")
ON CONFLICT ("businessId", "slug") DO NOTHING;

-- Adopt the brand text already stored on products so the picker is not empty on
-- an existing catalogue. The display column is left untouched.
INSERT INTO "Brand" ("id", "businessId", "name", "slug", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."businessId",
  min(p."brand") AS name,
  lower(regexp_replace(regexp_replace(min(p."brand"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE p."brand" IS NOT NULL
  AND btrim(p."brand") <> ''
  AND lower(regexp_replace(regexp_replace(btrim(p."brand"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) <> ''
GROUP BY p."businessId", lower(regexp_replace(regexp_replace(btrim(p."brand"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
ON CONFLICT ("businessId", "slug") DO NOTHING;

-- ------------------------------------------------- product media + brand -----
ALTER TABLE "Product"
  ADD COLUMN "brandId" TEXT,
  ADD COLUMN "seoImageMediaId" TEXT;

CREATE INDEX "Product_businessId_brandId_idx" ON "Product"("businessId", "brandId");
CREATE INDEX "Product_businessId_sku_idx" ON "Product"("businessId", "sku");

ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_seoImageMediaId_fkey"
  FOREIGN KEY ("seoImageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link the products that already carried a brand name to the brand row created
-- above (matched case-insensitively on the slug of the stored name).
UPDATE "Product" p
SET "brandId" = b."id"
FROM "Brand" b
WHERE p."brandId" IS NULL
  AND p."brand" IS NOT NULL
  AND b."businessId" = p."businessId"
  AND b."slug" = lower(regexp_replace(regexp_replace(btrim(p."brand"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'));

-- ------------------------------------- shared media references (restrict) ----
-- Attribute-value default images and category images already had a `mediaId`
-- column; the foreign keys make the reference real, so deleting an asset clears
-- the reference instead of leaving a broken one. Nothing cascades: an asset is
-- never removed as a side effect of editing a product, variant, brand or
-- category.
ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Category" ADD CONSTRAINT "Category_imageMediaId_fkey"
  FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
