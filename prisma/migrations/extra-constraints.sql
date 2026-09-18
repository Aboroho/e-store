-- ============================================================================
-- Database-level business invariants that the Prisma schema language cannot
-- express. This file is appended to the generated migration SQL by
-- `npm run db:migration:sql` so that every environment enforces the same rules.
--
-- See docs/BUSINESS_RULES.md for the documented meaning of each invariant.
-- ============================================================================

-- Inventory: never negative, never oversold, never damaged/held stock sellable.
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_non_negative_check"
  CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "damaged" >= 0 AND "inspection" >= 0
         AND "preorderCommitted" >= 0 AND "incomingQuantity" >= 0 AND "averageCostPaisa" >= 0);

ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_no_oversell_check"
  CHECK ("reserved" <= "onHand" - "damaged" - "inspection");

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_after_non_negative_check"
  CHECK ("onHandAfter" >= 0 AND "reservedAfter" >= 0 AND "damagedAfter" >= 0 AND "inspectionAfter" >= 0);

ALTER TABLE "StockReservation"
  ADD CONSTRAINT "StockReservation_quantities_check"
  CHECK ("quantity" > 0 AND "consumedQuantity" >= 0 AND "releasedQuantity" >= 0
         AND "consumedQuantity" + "releasedQuantity" <= "quantity");

ALTER TABLE "PreorderCommitment"
  ADD CONSTRAINT "PreorderCommitment_quantities_check"
  CHECK ("quantity" > 0 AND "allocatedQuantity" >= 0 AND "allocatedQuantity" <= "quantity");

ALTER TABLE "PreorderAllocation"
  ADD CONSTRAINT "PreorderAllocation_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "StockAdjustment"
  ADD CONSTRAINT "StockAdjustment_quantity_check" CHECK ("quantity" > 0);

-- Purchasing
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_quantities_check"
  CHECK ("orderedQuantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity"
         AND "unitCostPaisa" >= 0);

ALTER TABLE "GoodsReceiptItem"
  ADD CONSTRAINT "GoodsReceiptItem_quantities_check"
  CHECK ("quantity" > 0 AND "unitCostPaisa" >= 0 AND "allocatedExpensePaisa" >= 0);

ALTER TABLE "PurchaseExpense"
  ADD CONSTRAINT "PurchaseExpense_amount_check" CHECK ("amountPaisa" >= 0);

-- Catalog and pricing
ALTER TABLE "Variant"
  ADD CONSTRAINT "Variant_prices_check"
  CHECK (("priceOverridePaisa" IS NULL OR "priceOverridePaisa" >= 0)
         AND ("compareAtPricePaisa" IS NULL OR "compareAtPricePaisa" >= 0)
         AND ("costPaisa" IS NULL OR "costPaisa" >= 0));

ALTER TABLE "PriceListItem"
  ADD CONSTRAINT "PriceListItem_price_check"
  CHECK ("pricePaisa" >= 0 AND ("compareAtPricePaisa" IS NULL OR "compareAtPricePaisa" >= 0) AND "minQuantity" > 0);

ALTER TABLE "Product" ADD CONSTRAINT "Product_packaging_cost_check" CHECK ("packagingCostPaisa" >= 0);

-- Orders
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_check"
  CHECK ("itemsSubtotalPaisa" >= 0 AND "discountTotalPaisa" >= 0 AND "deliveryFeePaisa" >= 0
         AND "extraChargePaisa" >= 0 AND "packagingCostPaisa" >= 0 AND "codSurchargePaisa" >= 0
         AND "inventoryCostPaisa" >= 0 AND "grandTotalPaisa" >= 0 AND "paidPaisa" >= 0
         AND "refundedPaisa" >= 0 AND "codCollectPaisa" >= 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_amounts_check"
  CHECK ("quantity" > 0 AND "unitPricePaisa" >= 0 AND "unitCostPaisa" >= 0
         AND "discountPaisa" >= 0 AND "lineTotalPaisa" >= 0
         AND "reservedQuantity" >= 0 AND "preorderQuantity" >= 0
         AND "dispatchedQuantity" >= 0 AND "cancelledQuantity" >= 0);

-- Payments and refunds
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amountPaisa" > 0 AND "paidPaisa" >= 0 AND "refundedPaisa" >= 0);
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "CodCollection"
  ADD CONSTRAINT "CodCollection_amount_check"
  CHECK ("expectedPaisa" >= 0 AND "collectedPaisa" >= 0 AND "courierChargePaisa" >= 0 AND "codChargePaisa" >= 0);
ALTER TABLE "PaymentReconciliation"
  ADD CONSTRAINT "PaymentReconciliation_amount_check"
  CHECK ("grossPaisa" >= 0 AND "feePaisa" >= 0 AND "netPaisa" >= 0 AND "matchedPaisa" >= 0);

-- Courier / settlement
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_amounts_check"
  CHECK ("codAmountPaisa" >= 0 AND "courierChargePaisa" >= 0 AND "codChargePaisa" >= 0
         AND "deliveryFeePaisa" >= 0 AND "expectedCollectionPaisa" >= 0 AND "collectedPaisa" >= 0
         AND "declaredWeightGrams" > 0);

ALTER TABLE "CourierCharge" ADD CONSTRAINT "CourierCharge_amount_check" CHECK ("amountPaisa" >= 0 AND "codChargePaisa" >= 0);

ALTER TABLE "CourierSettlement"
  ADD CONSTRAINT "CourierSettlement_amount_check"
  CHECK ("grossCollectedPaisa" >= 0 AND "courierFeePaisa" >= 0 AND "codChargePaisa" >= 0
         AND "otherDeductionPaisa" >= 0 AND "netReceivedPaisa" >= 0 AND "reconciledPaisa" >= 0
         AND "unmatchedPaisa" >= 0);

-- Exchanges
ALTER TABLE "ExchangeItem" ADD CONSTRAINT "ExchangeItem_quantity_check" CHECK ("quantity" > 0 AND "unitPricePaisa" >= 0);
ALTER TABLE "ExchangeRequest"
  ADD CONSTRAINT "ExchangeRequest_amounts_check"
  CHECK ("returnValuePaisa" >= 0 AND "replacementValuePaisa" >= 0 AND "deliveryChargePaisa" >= 0
         AND "additionalChargePaisa" >= 0 AND "discountPaisa" >= 0);

-- Reseller ledger, earnings and payouts
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "ResellerPayout" ADD CONSTRAINT "ResellerPayout_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "ResellerPayoutEntry" ADD CONSTRAINT "ResellerPayoutEntry_amount_check" CHECK ("amountPaisa" > 0);
ALTER TABLE "ResellerOrderEarning"
  ADD CONSTRAINT "ResellerOrderEarning_amounts_check"
  CHECK ("collectedPaisa" >= 0 AND "resellerPricePaisa" >= 0 AND "packagingCostPaisa" >= 0
         AND "courierChargePaisa" >= 0 AND "codChargePaisa" >= 0 AND "expectedCodPaisa" >= 0
         AND "settledPaisa" >= 0);

-- Reviews
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5);
ALTER TABLE "Review" ADD CONSTRAINT "Review_body_check" CHECK (length(btrim("body")) >= 3);

-- Media
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_size_check" CHECK ("sizeBytes" > 0);

-- Marketing / API
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_rate_limit_check" CHECK ("rateLimitPerMinute" >= 1);
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0);
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0);
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

-- Storefront configuration
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_fee_check" CHECK ("feePaisa" >= 0 AND "codFeePaisa" >= 0);
ALTER TABLE "Storefront" ADD CONSTRAINT "Storefront_costs_check" CHECK ("packagingCostPaisa" >= 0);

-- ---------------------------------------------------------------------------
-- Partial unique indexes for nullable scope columns
-- (one business-wide row per key when the storefront scope is NULL)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "Page_business_slug_global_key"
  ON "Page"("businessId", "slug") WHERE "storefrontId" IS NULL;

CREATE UNIQUE INDEX "DeliveryZone_business_district_global_key"
  ON "DeliveryZone"("businessId", "districtCode") WHERE "storefrontId" IS NULL;

CREATE UNIQUE INDEX "CheckoutFieldConfig_business_field_global_key"
  ON "CheckoutFieldConfig"("businessId", "fieldKey") WHERE "storefrontId" IS NULL;

CREATE UNIQUE INDEX "MarketingIntegration_business_provider_global_key"
  ON "MarketingIntegration"("businessId", "provider") WHERE "storefrontId" IS NULL;

CREATE UNIQUE INDEX "ResellerOrderEarning_order_item_key"
  ON "ResellerOrderEarning"("orderItemId") WHERE "orderItemId" IS NOT NULL;

CREATE UNIQUE INDEX "CourierSettlementEntry_unmatched_reference_key"
  ON "CourierSettlementEntry"("settlementId", "reference") WHERE "shipmentId" IS NULL AND "reference" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Operational indexes for frequent report and worker queries
-- ---------------------------------------------------------------------------

CREATE INDEX "Order_business_placedAt_idx" ON "Order"("businessId", "placedAt");
CREATE INDEX "InventoryMovement_business_variant_created_idx" ON "InventoryMovement"("businessId", "variantId", "createdAt");
CREATE INDEX "NotificationRecipient_user_unread_idx" ON "NotificationRecipient"("userId", "readAt") WHERE "readAt" IS NULL;
CREATE INDEX "BackgroundJob_locked_idx" ON "BackgroundJob"("status", "lockedAt");
CREATE INDEX "ResellerLedgerEntry_reseller_status_created_idx" ON "ResellerLedgerEntry"("resellerId", "status", "createdAt");
CREATE INDEX "MediaAsset_objectKey_idx" ON "MediaAsset"("objectKey");
