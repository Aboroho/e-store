-- Product / variant inheritance, pricing defaults and persistent drafts.
--
-- 1. SKU ownership moves to the product: `Variant.sku` becomes an optional legacy
--    internal code that the product-management workflow never asks for.
-- 2. Pricing defaults live in real columns (not JSON metadata) so the editor, the
--    storefront, the API and order creation all read the same values.
-- 3. Attribute values and variants carry the same discount-aware pricing
--    override triple, which is what makes
--    "variant override > attribute override > product default" resolvable.
-- 4. Order lines snapshot the product SKU plus a stable variant identity.

-- ---------------------------------------------------------------------------
-- Discount type enum (shared by product default, attribute value and variant)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscountType') THEN
        CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT', 'NONE');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Product: unit label reference + pricing defaults
-- ---------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitLabelId" VARCHAR(36);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultCurrentPricePaisa" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultDiscountType" "DiscountType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultDiscountValue" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultPricePaisa" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultCompareAtPricePaisa" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultCostPaisa" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Product_unitLabelId_fkey'
    ) THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_unitLabelId_fkey"
            FOREIGN KEY ("unitLabelId") REFERENCES "UnitLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Product_businessId_unitLabelId_idx" ON "Product"("businessId", "unitLabelId");

-- ---------------------------------------------------------------------------
-- AttributeValue: attribute-level pricing override (level 2)
-- ---------------------------------------------------------------------------
ALTER TABLE "AttributeValue" ADD COLUMN IF NOT EXISTS "currentPricePaisa" INTEGER;
ALTER TABLE "AttributeValue" ADD COLUMN IF NOT EXISTS "discountType" "DiscountType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "AttributeValue" ADD COLUMN IF NOT EXISTS "discountValue" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Variant: variant-level pricing override (level 1)
-- ---------------------------------------------------------------------------
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "currentPricePaisa" INTEGER;
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "discountType" "DiscountType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Variant" ADD COLUMN IF NOT EXISTS "discountValue" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- ProductDraft: optimistic revision counter for concurrent autosaves
-- ---------------------------------------------------------------------------
ALTER TABLE "ProductDraft" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

-- One working draft per (business, user, product). `productId IS NULL` is the
-- "new product" draft, so COALESCE gives it a single slot per user too.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductDraft_businessId_userId_productId_key"
    ON "ProductDraft" ("businessId", COALESCE("userId", ''), COALESCE("productId", ''));

-- ---------------------------------------------------------------------------
-- OrderItem: product SKU + stable variant identity snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "optionKey" VARCHAR(255);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "variantCode" VARCHAR(64);

-- ---------------------------------------------------------------------------
-- Backfill: move existing JSON-metadata pricing onto the new columns so the
-- product editor opens with the same numbers it saved before this migration.
-- ---------------------------------------------------------------------------
UPDATE "Product"
SET "defaultPricePaisa" = CAST(metadata ->> 'defaultPricePaisa' AS INTEGER),
    "defaultCurrentPricePaisa" = CAST(metadata ->> 'currentPricePaisa' AS INTEGER),
    "defaultDiscountType" = CASE
        WHEN metadata ->> 'discountType' IN ('PERCENTAGE', 'FLAT') THEN CAST(metadata ->> 'discountType' AS "DiscountType")
        ELSE 'NONE'::"DiscountType"
    END,
    "defaultDiscountValue" = COALESCE(CAST(metadata ->> 'discountValue' AS INTEGER), 0)
WHERE metadata IS NOT NULL
  AND metadata ? 'defaultPricePaisa'
  AND "defaultPricePaisa" IS NULL;

UPDATE "Variant"
SET "currentPricePaisa" = CAST(metadata ->> 'currentPricePaisa' AS INTEGER),
    "discountType" = CASE
        WHEN metadata ->> 'discountType' IN ('PERCENTAGE', 'FLAT') THEN CAST(metadata ->> 'discountType' AS "DiscountType")
        ELSE 'NONE'::"DiscountType"
    END,
    "discountValue" = COALESCE(CAST(metadata ->> 'discountValue' AS INTEGER), 0)
WHERE metadata IS NOT NULL
  AND metadata ? 'currentPricePaisa'
  AND "currentPricePaisa" IS NULL;

-- Products created before this migration carried a generated variant code
-- ("SKU-1", "PRODUCTCODE-2", …). SKU now belongs to the product, so the
-- generated codes are cleared; the variant keeps its id and option key, which
-- is what inventory, purchasing and orders actually reference.
UPDATE "Variant" v
SET "sku" = NULL
FROM "Product" p
WHERE p."id" = v."productId"
  AND v."sku" IS NOT NULL
  AND (
      v."sku" ~ ('^' || COALESCE(p."sku", 'SKU') || '-[0-9]+$')
      OR v."sku" ~ '^SKU-[0-9]+$'
  );
