-- Catalogue UX: labels, independent primary image, Attribute bin support,
-- and complete removal of Variant.sku (SKU belongs only to the product).

-- ---------------------------------------------------------------------------
-- Label + ProductLabel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Label" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "colorHex" TEXT,
    "imageMediaId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Label_businessId_slug_key" ON "Label"("businessId", "slug");
CREATE INDEX IF NOT EXISTS "Label_businessId_isActive_name_idx" ON "Label"("businessId", "isActive", "name");
CREATE INDEX IF NOT EXISTS "Label_businessId_deletedAt_idx" ON "Label"("businessId", "deletedAt");

CREATE TABLE IF NOT EXISTS "ProductLabel" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "position" INT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductLabel_productId_labelId_key" ON "ProductLabel"("productId", "labelId");
CREATE INDEX IF NOT EXISTS "ProductLabel_labelId_idx" ON "ProductLabel"("labelId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Label_businessId_fkey') THEN
        ALTER TABLE "Label" ADD CONSTRAINT "Label_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Label_imageMediaId_fkey') THEN
        ALTER TABLE "Label" ADD CONSTRAINT "Label_imageMediaId_fkey"
            FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductLabel_productId_fkey') THEN
        ALTER TABLE "ProductLabel" ADD CONSTRAINT "ProductLabel_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductLabel_labelId_fkey') THEN
        ALTER TABLE "ProductLabel" ADD CONSTRAINT "ProductLabel_labelId_fkey"
            FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Product: independent primary image
-- ---------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "primaryImageMediaId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_primaryImageMediaId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_primaryImageMediaId_fkey"
            FOREIGN KEY ("primaryImageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill primary image from the first ProductImage (position 0) so existing
-- products keep a thumbnail without promoting gallery items going forward.
UPDATE "Product" p
SET "primaryImageMediaId" = i."mediaId"
FROM (
    SELECT DISTINCT ON ("productId") "productId", "mediaId"
    FROM "ProductImage"
    ORDER BY "productId", "position" ASC, "createdAt" ASC
) i
WHERE p."id" = i."productId"
  AND p."primaryImageMediaId" IS NULL;

-- ---------------------------------------------------------------------------
-- Attribute: soft-delete for the bin
-- ---------------------------------------------------------------------------
ALTER TABLE "Attribute" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Attribute_businessId_deletedAt_idx" ON "Attribute"("businessId", "deletedAt");

-- ---------------------------------------------------------------------------
-- Variant: drop SKU entirely. SKU lives only on Product.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Variant_productId_sku_idx";
DROP INDEX IF EXISTS "Variant_sku_key";
ALTER TABLE "Variant" DROP COLUMN IF EXISTS "sku";
