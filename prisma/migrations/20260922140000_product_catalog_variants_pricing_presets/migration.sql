-- Alter Customer tags default
ALTER TABLE "Customer" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::text[];

-- Make Variant sku nullable and replace unique with index
DROP INDEX IF EXISTS "Variant_sku_key";
ALTER TABLE "Variant" ALTER COLUMN "sku" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "Variant_productId_sku_idx" ON "Variant"("productId", "sku");

-- Attribute-level pricing override
ALTER TABLE "AttributeValue" ADD COLUMN IF NOT EXISTS "priceOverridePaisa" INTEGER;

-- TaxRate presets
CREATE TABLE IF NOT EXISTS "TaxRate" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "businessId" VARCHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rateBps" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "TaxRate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxRate_businessId_name_key" ON "TaxRate"("businessId", "name");
CREATE INDEX IF NOT EXISTS "TaxRate_businessId_isActive_idx" ON "TaxRate"("businessId", "isActive");

-- PackagingCostTemplate presets
CREATE TABLE IF NOT EXISTS "PackagingCostTemplate" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "businessId" VARCHAR(36) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "costPaisa" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "PackagingCostTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PackagingCostTemplate_businessId_name_key" ON "PackagingCostTemplate"("businessId", "name");
CREATE INDEX IF NOT EXISTS "PackagingCostTemplate_businessId_isActive_idx" ON "PackagingCostTemplate"("businessId", "isActive");

-- Product references to presets
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "taxRateId" VARCHAR(36);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "packagingCostTemplateId" VARCHAR(36);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Product_taxRateId_fkey'
    ) THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Product_packagingCostTemplateId_fkey'
    ) THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_packagingCostTemplateId_fkey" FOREIGN KEY ("packagingCostTemplateId") REFERENCES "PackagingCostTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Product drafts for reliable autosave persistence
CREATE TABLE IF NOT EXISTS "ProductDraft" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "businessId" VARCHAR(36) NOT NULL,
    "productId" VARCHAR(36),
    "userId" VARCHAR(36),
    "name" VARCHAR(200) NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ProductDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductDraft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductDraft_businessId_productId_idx" ON "ProductDraft"("businessId", "productId");
CREATE INDEX IF NOT EXISTS "ProductDraft_businessId_userId_idx" ON "ProductDraft"("businessId", "userId");
