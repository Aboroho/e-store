-- Brand registry: canonical brands with shared-media logos.
--
-- Products keep a free-text `brand` name; the canonical `Brand` row holds the
-- logo as a media reference (`logoMediaId` + a MediaUsage with entityType
-- BRAND). Product displays resolve the logo by exact brand-name match, so
-- reusing one logo across every product of that brand never duplicates bytes.

CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "logoMediaId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Brand_businessId_slug_key" ON "Brand"("businessId", "slug");
CREATE INDEX "Brand_businessId_isActive_position_idx" ON "Brand"("businessId", "isActive", "position");

ALTER TABLE "Brand" ADD CONSTRAINT "Brand_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
