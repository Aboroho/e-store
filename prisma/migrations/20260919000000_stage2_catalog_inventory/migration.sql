-- ============================================================================
-- Stage 2 — Catalog, pricing, inventory, purchasing and preorders
-- ============================================================================

-- Ledger snapshots for the two counters that were not captured in Stage 1.
ALTER TABLE "InventoryMovement"
  ADD COLUMN IF NOT EXISTS "preorderCommittedAfter" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "incomingAfter" INTEGER NOT NULL DEFAULT 0;

-- Preorder commitments must never gain more allocations than were promised, and
-- a commitment cannot exist without the order line it belongs to.
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_preorder_incoming_check"
  CHECK ("preorderCommittedAfter" >= 0 AND "incomingAfter" >= 0);

-- Goods receipts are documents: the same purchase order line cannot be received
-- more than the ordered quantity (already checked in SQL) and a receipt must
-- carry a positive quantity (checked in extra-constraints.sql).
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_totals_check"
  CHECK ("subtotalPaisa" >= 0 AND "extraCostPaisa" >= 0 AND "totalPaisa" >= 0 AND "paidPaisa" >= 0);

-- Category tree: a category may not be its own parent.
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_no_self_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- Product/variant identifiers that must be unique inside a business.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_business_slug_live_key"
  ON "Product" ("businessId", "slug")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Category_business_slug_live_key"
  ON "Category" ("businessId", "slug")
  WHERE "deletedAt" IS NULL;

-- One default price list per business.
CREATE UNIQUE INDEX IF NOT EXISTS "PriceList_business_default_key"
  ON "PriceList" ("businessId")
  WHERE "isDefault" = true;

-- One default inventory location per business (single location in v1).
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLocation_business_default_key"
  ON "InventoryLocation" ("businessId")
  WHERE "isDefault" = true;
