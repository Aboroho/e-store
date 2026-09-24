-- Manual order creation & order management.
--
-- Adds the order-type classification, the extended user-facing status lifecycle
-- (ON_HOLD / PARTIALLY_DELIVERED / RETURNED), delivery-charge override metadata,
-- order-level discount input, richer status-transition history, per-user order
-- list column preferences and the append-only record written when a cancelled
-- order is permanently deleted.
--
-- The new OrderStatus values are added first and are never referenced inside this
-- transaction: PostgreSQL forbids using an enum value added by ALTER TYPE in the
-- same transaction that added it.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

-- ---------------------------------------------------------------------------
-- New enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE "OrderType" AS ENUM ('ONLINE_DELIVERY', 'IN_STORE', 'PREORDER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OrderDiscountType" AS ENUM ('FLAT', 'PERCENTAGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Order
-- ---------------------------------------------------------------------------
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderType" "OrderType" NOT NULL DEFAULT 'ONLINE_DELIVERY';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "createdByUserRole" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeCalculatedPaisa" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeOverriddenAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeOverriddenByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryFeeOverrideNote" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountType" "OrderDiscountType";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountValue" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "discountAllocation" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "onHoldAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "partiallyDeliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deletedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Order_businessId_orderType_placedAt_idx" ON "Order"("businessId", "orderType", "placedAt");
CREATE INDEX IF NOT EXISTS "Order_businessId_createdByUserId_placedAt_idx" ON "Order"("businessId", "createdByUserId", "placedAt");
CREATE INDEX IF NOT EXISTS "Order_businessId_customerPhoneNormalized_idx" ON "Order"("businessId", "customerPhoneNormalized");

-- ---------------------------------------------------------------------------
-- OrderStatusHistory
-- ---------------------------------------------------------------------------
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "actorRole" TEXT;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "isAdminOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "confirmationAcknowledged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "toGroup" TEXT;
ALTER TABLE "OrderStatusHistory" ADD COLUMN IF NOT EXISTS "courierEventId" TEXT;

-- ---------------------------------------------------------------------------
-- OrderListColumnPreference
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OrderListColumnPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'ADMIN_ORDER_LIST',
    "columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderListColumnPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderListColumnPreference_businessId_userId_scope_key"
  ON "OrderListColumnPreference"("businessId", "userId", "scope");
CREATE INDEX IF NOT EXISTS "OrderListColumnPreference_userId_idx" ON "OrderListColumnPreference"("userId");

DO $$
BEGIN
  ALTER TABLE "OrderListColumnPreference"
    ADD CONSTRAINT "OrderListColumnPreference_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OrderListColumnPreference"
    ADD CONSTRAINT "OrderListColumnPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- OrderDeletionRecord
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OrderDeletionRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhoneNormalized" TEXT,
    "resellerId" TEXT,
    "grandTotalPaisa" INTEGER NOT NULL DEFAULT 0,
    "paidPaisa" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "deletedByUserId" TEXT,
    "deletedByRole" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDeletionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderDeletionRecord_businessId_deletedAt_idx" ON "OrderDeletionRecord"("businessId", "deletedAt");
CREATE INDEX IF NOT EXISTS "OrderDeletionRecord_orderNumber_idx" ON "OrderDeletionRecord"("orderNumber");
CREATE INDEX IF NOT EXISTS "OrderDeletionRecord_customerId_idx" ON "OrderDeletionRecord"("customerId");

DO $$
BEGIN
  ALTER TABLE "OrderDeletionRecord"
    ADD CONSTRAINT "OrderDeletionRecord_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OrderDeletionRecord"
    ADD CONSTRAINT "OrderDeletionRecord_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "OrderDeletionRecord"
    ADD CONSTRAINT "OrderDeletionRecord_deletedByUserId_fkey"
    FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Backfill (existing rows keep their historical meaning)
-- ---------------------------------------------------------------------------
-- Counter sales were already recorded with the IN_STORE channel.
UPDATE "Order" SET "orderType" = 'IN_STORE' WHERE "channel" = 'IN_STORE' AND "orderType" = 'ONLINE_DELIVERY';

-- Orders that promised stock they did not have are preorders.
UPDATE "Order" o
SET "orderType" = 'PREORDER'
WHERE o."channel" <> 'IN_STORE'
  AND o."orderType" = 'ONLINE_DELIVERY'
  AND EXISTS (SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o."id" AND i."isPreorder" = true);

-- Until now the calculated charge and the charged amount were the same number.
UPDATE "Order" SET "deliveryFeeCalculatedPaisa" = "deliveryFeePaisa" WHERE "deliveryFeeCalculatedPaisa" = 0;
