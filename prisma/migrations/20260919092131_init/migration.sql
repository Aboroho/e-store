-- DropIndex
DROP INDEX "BackgroundJob_locked_idx";

-- DropIndex
DROP INDEX "InventoryMovement_business_variant_created_idx";

-- DropIndex
DROP INDEX "MediaAsset_objectKey_idx";

-- DropIndex
DROP INDEX "Order_business_placedAt_idx";

-- DropIndex
DROP INDEX "ResellerLedgerEntry_reseller_status_created_idx";

-- AlterTable
ALTER TABLE "AccountClaimRequest" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "allowedIpAddresses" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ApiKeyScope" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ApiRequestLog" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Attribute" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AttributeValue" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "changedFields" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BackgroundJob" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Business" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BusinessSetting" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CheckoutFieldConfig" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CodCollection" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConsentRecord" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CourierCharge" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CourierProvider" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CourierSettlement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CourierSettlementEntry" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CourierWebhookEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "tags" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerAddress" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerNote" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerSession" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DeliveryZone" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExchangeItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExchangeReason" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExchangeRequest" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExchangeStatusHistory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GoodsReceipt" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GoodsReceiptItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "IdempotencyRecord" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Integration" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "IntegrationSecret" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventoryBalance" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventoryLocation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventoryMovement" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MarketingEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MarketingIntegration" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MediaAsset" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MediaFolder" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MediaUsage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NavigationMenu" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NavigationMenuItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationPreference" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NotificationRecipient" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NumberSequence" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrderAddress" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrderAdjustment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrderItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrderStatusHistory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OutboxEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Page" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PageVersion" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasswordResetToken" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentAllocation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentAttempt" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentReconciliation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Permission" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Plugin" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "capabilities" DROP DEFAULT,
ALTER COLUMN "permissions" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PreorderAllocation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PreorderCommitment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PriceList" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PriceListItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductAttribute" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductCategory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProductImage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseExpense" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RateLimitBucket" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Refund" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefundAttempt" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Reseller" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerCollectionChange" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerLedgerEntry" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerOrderEarning" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerPayout" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerPayoutEntry" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ResellerPayoutTransaction" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReservationAllocation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Review" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReviewImage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReviewReport" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RolePermission" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SecurityEvent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Shipment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ShipmentStatusHistory" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockAdjustment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockAdjustmentReason" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StockReservation" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Storefront" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "allowedPaymentMethods" DROP DEFAULT,
ALTER COLUMN "allowedCourierProviders" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StorefrontDomain" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StorefrontSetting" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SupplierPayment" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserRole" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Variant" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VariantAttributeValue" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VariantImage" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "VerificationCode" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WebhookDelivery" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WebhookSubscription" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "events" DROP DEFAULT;
