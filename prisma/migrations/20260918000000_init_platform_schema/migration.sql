-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'CUSTOMER', 'SYSTEM', 'API_KEY');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'SESSION_REVOKED', 'RATE_LIMITED', 'PERMISSION_DENIED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'WEBHOOK_REJECTED', 'ACCOUNT_CLAIM_REQUESTED', 'ACCOUNT_CLAIM_COMPLETED');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('ACCOUNT_CLAIM', 'LOGIN', 'PHONE_VERIFY', 'EMAIL_VERIFY', 'PASSWORD_RESET', 'ORDER_LOOKUP');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "StorefrontStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('PAYMENT', 'COURIER', 'MARKETING', 'STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "SettingValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'VARIABLE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'SELECT', 'COLOR', 'NUMBER');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriceListChannel" AS ENUM ('DEFAULT', 'STOREFRONT', 'RESELLER', 'WHOLESALE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StockCondition" AS ENUM ('SELLABLE', 'DAMAGED', 'INSPECTION');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('OPENING', 'PURCHASE_RECEIPT', 'PURCHASE_RECEIPT_REVERSAL', 'SALE_DISPATCH', 'SALE_REVERSAL', 'RESERVATION', 'RESERVATION_RELEASE', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'DAMAGE_RECORDED', 'DAMAGE_RELEASED', 'INSPECTION_IN', 'INSPECTION_OUT', 'PREORDER_ALLOCATION', 'EXCHANGE_RETURN_IN', 'EXCHANGE_REPLACEMENT_OUT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PreorderCommitmentStatus" AS ENUM ('OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE', 'BOTH');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseAllocationMethod" AS ENUM ('QUANTITY', 'VALUE', 'NONE');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('STOREFRONT', 'ADMIN', 'IN_STORE', 'RESELLER', 'API');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'RESERVED', 'PREORDER_PENDING', 'ALLOCATED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'EXCHANGED');

-- CreateEnum
CREATE TYPE "OrderAdjustmentType" AS ENUM ('DISCOUNT', 'DELIVERY_FEE', 'EXTRA_CHARGE', 'PACKAGING', 'COD_SURCHARGE', 'ROUNDING', 'RESELLER_COLLECTION');

-- CreateEnum
CREATE TYPE "OrderStatusField" AS ENUM ('ORDER', 'PAYMENT', 'FULFILLMENT', 'COURIER', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "OrderAddressType" AS ENUM ('SHIPPING', 'BILLING');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'BKASH', 'SSLCOMMERZ', 'CASH', 'BANK_TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'REDIRECTED', 'CALLBACK_RECEIVED', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('PROVIDER', 'BKASH', 'SSLCOMMERZ', 'CASH', 'BANK_TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReversalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CourierProviderCode" AS ENUM ('PATHAO', 'STEADFAST', 'CARRYBEE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShipmentType" AS ENUM ('SALE', 'EXCHANGE_OUT', 'EXCHANGE_RETURN', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED', 'CANCELLED', 'EXCEPTION', 'FAILED');

-- CreateEnum
CREATE TYPE "ShipmentSource" AS ENUM ('MANUAL', 'API', 'WEBHOOK', 'SYNC');

-- CreateEnum
CREATE TYPE "CourierChargeType" AS ENUM ('DELIVERY', 'COD', 'RETURN', 'WEIGHT_ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'IMPORTED', 'PARTIALLY_RECONCILED', 'RECONCILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SettlementEntryStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'DISPUTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ExchangeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExchangeDirection" AS ENUM ('RETURN', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "ExchangeChannel" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "InspectionOutcome" AS ENUM ('PENDING', 'SELLABLE', 'DAMAGED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PaymentReconciliationType" AS ENUM ('PAYMENT_PROVIDER', 'COURIER_COD');

-- CreateEnum
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'DISPUTED', 'RESOLVED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ResellerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ResellerCommissionType" AS ENUM ('MARGIN_BASED', 'PERCENT_OF_MARGIN', 'FIXED_PER_ORDER', 'FIXED_PER_ITEM', 'NONE');

-- CreateEnum
CREATE TYPE "ResellerLedgerType" AS ENUM ('EARNING', 'PACKAGING_CHARGE', 'COURIER_CHARGE', 'COD_CHARGE', 'ADJUSTMENT', 'REVERSAL', 'PAYOUT', 'PAYOUT_REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerEntryStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'PENDING', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BKASH', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('HOME', 'CONTENT', 'LANDING', 'POLICY', 'COLLECTION', 'CONTACT');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PageVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NavigationItemType" AS ENUM ('PAGE', 'CATEGORY', 'PRODUCT', 'URL', 'GROUP');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SPAM');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MarketingProvider" AS ENUM ('META_PIXEL', 'META_CONVERSIONS', 'TIKTOK_PIXEL', 'GOOGLE_ANALYTICS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MarketingEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_NO_CONSENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "PluginStatus" AS ENUM ('REGISTERED', 'ENABLED', 'DISABLED', 'INCOMPATIBLE', 'ERROR');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "timezone" TEXT DEFAULT 'Asia/Dhaka' NOT NULL,
    "locale" TEXT DEFAULT 'en' NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "logoMediaId" TEXT,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSetting" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "SettingValueType" DEFAULT 'JSON' NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN DEFAULT false NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" DEFAULT 'ACTIVE' NOT NULL,
    "isOwner" BOOLEAN DEFAULT false NOT NULL,
    "avatarMediaId" TEXT,
    "jobTitle" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER DEFAULT 0 NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN DEFAULT false NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN DEFAULT false NOT NULL,
    "isProtected" BOOLEAN DEFAULT false NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isDangerous" BOOLEAN DEFAULT false NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastUsedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastUsedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "customerId" TEXT,
    "channel" "VerificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "maxAttempts" INTEGER DEFAULT 5 NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "userId" TEXT,
    "customerId" TEXT,
    "type" "SecurityEventType" NOT NULL,
    "success" BOOLEAN DEFAULT true NOT NULL,
    "email" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT DEFAULT '' NOT NULL,
    "prefix" TEXT DEFAULT '' NOT NULL,
    "nextValue" INTEGER DEFAULT 1 NOT NULL,
    "padding" INTEGER DEFAULT 5 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storefront" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT,
    "status" "StorefrontStatus" DEFAULT 'DRAFT' NOT NULL,
    "description" TEXT,
    "defaultCurrency" TEXT DEFAULT 'BDT' NOT NULL,
    "defaultPriceListId" TEXT,
    "defaultLocationId" TEXT,
    "themeKey" TEXT DEFAULT 'default' NOT NULL,
    "themeConfig" JSONB,
    "supportPhone" TEXT,
    "supportEmail" TEXT,
    "addressLine" TEXT,
    "isDefault" BOOLEAN DEFAULT false NOT NULL,
    "codEnabled" BOOLEAN DEFAULT true NOT NULL,
    "preorderEnabled" BOOLEAN DEFAULT true NOT NULL,
    "freeDeliveryThresholdPaisa" INTEGER,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowedPaymentMethods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "allowedCourierProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "Storefront_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontDomain" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "isPrimary" BOOLEAN DEFAULT false NOT NULL,
    "status" "DomainStatus" DEFAULT 'PENDING' NOT NULL,
    "sslEnabled" BOOLEAN DEFAULT false NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verificationToken" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorefrontDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontSetting" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" "SettingValueType" DEFAULT 'JSON' NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorefrontSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "District_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "districtCode" TEXT NOT NULL,
    "feePaisa" INTEGER NOT NULL,
    "freeDeliveryThresholdPaisa" INTEGER,
    "codEnabled" BOOLEAN DEFAULT true NOT NULL,
    "codFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "estimatedDaysMin" INTEGER,
    "estimatedDaysMax" INTEGER,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutFieldConfig" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isEnabled" BOOLEAN DEFAULT true NOT NULL,
    "isRequired" BOOLEAN DEFAULT false NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "helpText" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CheckoutFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeReason" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "deliveryChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "requiresNote" BOOLEAN DEFAULT false NOT NULL,
    "requiresApproval" BOOLEAN DEFAULT true NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageMediaId" TEXT,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "isFeatured" BOOLEAN DEFAULT false NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "path" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "productType" "ProductType" DEFAULT 'SIMPLE' NOT NULL,
    "status" "ProductStatus" DEFAULT 'DRAFT' NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "brand" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "unitLabel" TEXT DEFAULT 'piece' NOT NULL,
    "weightGrams" INTEGER,
    "requiresShipping" BOOLEAN DEFAULT true NOT NULL,
    "isFeatured" BOOLEAN DEFAULT false NOT NULL,
    "isPreorderEnabled" BOOLEAN DEFAULT false NOT NULL,
    "preorderNote" TEXT,
    "preorderExpectedAt" TIMESTAMP(3),
    "taxRateBps" INTEGER DEFAULT 0 NOT NULL,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "attributesSummary" JSONB,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeywords" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN DEFAULT false NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attribute" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "AttributeType" DEFAULT 'SELECT' NOT NULL,
    "unit" TEXT,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "isVariantDefining" BOOLEAN DEFAULT true NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributeValue" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "colorHex" TEXT,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "mediaId" TEXT,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAttribute" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "isRequired" BOOLEAN DEFAULT true NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ProductAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "optionKey" TEXT NOT NULL,
    "status" "VariantStatus" DEFAULT 'ACTIVE' NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "weightGrams" INTEGER,
    "priceOverridePaisa" INTEGER,
    "compareAtPricePaisa" INTEGER,
    "costPaisa" INTEGER,
    "packagingCostPaisa" INTEGER,
    "isPreorderEnabled" BOOLEAN,
    "imageMediaId" TEXT,
    "attributesSummary" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantAttributeValue" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "variantId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "VariantAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "productId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantImage" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "variantId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "altText" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "VariantImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "channel" "PriceListChannel" DEFAULT 'DEFAULT' NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "isDefault" BOOLEAN DEFAULT false NOT NULL,
    "priority" INTEGER DEFAULT 0 NOT NULL,
    "storefrontId" TEXT,
    "resellerId" TEXT,
    "status" "PriceListStatus" DEFAULT 'ACTIVE' NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "priceListId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT,
    "pricePaisa" INTEGER NOT NULL,
    "compareAtPricePaisa" INTEGER,
    "minQuantity" INTEGER DEFAULT 1 NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "note" TEXT,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PurchaseStatus" DEFAULT 'DRAFT' NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "subtotalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "extraCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "totalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "paidPaisa" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "internalNote" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "orderedQuantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "unitCostPaisa" INTEGER NOT NULL,
    "lineTotalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "GoodsReceiptStatus" DEFAULT 'DRAFT' NOT NULL,
    "receivedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "receivedByUserId" TEXT,
    "locationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "totalCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "totalQuantity" INTEGER DEFAULT 0 NOT NULL,
    "externalReference" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostPaisa" INTEGER NOT NULL,
    "allocatedExpensePaisa" INTEGER DEFAULT 0 NOT NULL,
    "lineCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "inventoryMovementId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseExpense" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "goodsReceiptId" TEXT,
    "label" TEXT NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "allocationMethod" "ExpenseAllocationMethod" DEFAULT 'QUANTITY' NOT NULL,
    "allocated" BOOLEAN DEFAULT false NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PurchaseExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "amountPaisa" INTEGER NOT NULL,
    "method" TEXT DEFAULT 'CASH' NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "isDefault" BOOLEAN DEFAULT false NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "onHand" INTEGER DEFAULT 0 NOT NULL,
    "reserved" INTEGER DEFAULT 0 NOT NULL,
    "damaged" INTEGER DEFAULT 0 NOT NULL,
    "inspection" INTEGER DEFAULT 0 NOT NULL,
    "preorderCommitted" INTEGER DEFAULT 0 NOT NULL,
    "incomingQuantity" INTEGER DEFAULT 0 NOT NULL,
    "averageCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "lastMovementAt" TIMESTAMP(3),
    "lastCountedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "condition" "StockCondition" DEFAULT 'SELLABLE' NOT NULL,
    "quantityDelta" INTEGER DEFAULT 0 NOT NULL,
    "reservedDelta" INTEGER DEFAULT 0 NOT NULL,
    "damagedDelta" INTEGER DEFAULT 0 NOT NULL,
    "inspectionDelta" INTEGER DEFAULT 0 NOT NULL,
    "onHandAfter" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "damagedAfter" INTEGER NOT NULL,
    "inspectionAfter" INTEGER NOT NULL,
    "unitCostPaisa" INTEGER,
    "valueDeltaPaisa" INTEGER,
    "averageCostAfterPaisa" INTEGER,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "reference" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorCustomerId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "consumedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "releasedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "status" "ReservationStatus" DEFAULT 'ACTIVE' NOT NULL,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releasedReason" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationAllocation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "reservationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "inventoryMovementId" TEXT,
    "kind" TEXT DEFAULT 'RESERVE' NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderCommitment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "allocatedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "status" "PreorderCommitmentStatus" DEFAULT 'OPEN' NOT NULL,
    "priorityAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreorderCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreorderAllocation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "preorderCommitmentId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "inventoryMovementId" TEXT,
    "reservationId" TEXT,
    "createdByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PreorderAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentReason" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "direction" "AdjustmentDirection" DEFAULT 'BOTH' NOT NULL,
    "requiresNote" BOOLEAN DEFAULT false NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockAdjustmentReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "reasonId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "condition" "StockCondition" DEFAULT 'SELLABLE' NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "actorUserId" TEXT,
    "inventoryMovementId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "emailNormalized" TEXT,
    "districtCode" TEXT,
    "addressLine" TEXT,
    "area" TEXT,
    "status" "CustomerStatus" DEFAULT 'ACTIVE' NOT NULL,
    "passwordHash" TEXT,
    "hasAccount" BOOLEAN DEFAULT false NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "totalOrders" INTEGER DEFAULT 0 NOT NULL,
    "totalSpentPaisa" INTEGER DEFAULT 0 NOT NULL,
    "lifetimeValuePaisa" INTEGER DEFAULT 0 NOT NULL,
    "firstOrderAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "isResellerCustomer" BOOLEAN DEFAULT false NOT NULL,
    "referredByResellerId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "phone" TEXT,
    "districtCode" TEXT,
    "addressLine" TEXT NOT NULL,
    "area" TEXT,
    "postcode" TEXT,
    "isDefault" BOOLEAN DEFAULT false NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "customerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isPinned" BOOLEAN DEFAULT false NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountClaimRequest" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "customerId" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "purpose" "VerificationPurpose" DEFAULT 'ACCOUNT_CLAIM' NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "maxAttempts" INTEGER DEFAULT 5 NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "AccountClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "storefrontId" TEXT,
    "channel" "OrderChannel" DEFAULT 'STOREFRONT' NOT NULL,
    "customerId" TEXT,
    "resellerId" TEXT,
    "status" "OrderStatus" DEFAULT 'PENDING' NOT NULL,
    "paymentStatus" "PaymentStatus" DEFAULT 'UNPAID' NOT NULL,
    "fulfillmentStatus" "FulfillmentStatus" DEFAULT 'UNFULFILLED' NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "itemsSubtotalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "discountTotalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "deliveryFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "extraChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "codSurchargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "inventoryCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "grandTotalPaisa" INTEGER DEFAULT 0 NOT NULL,
    "paidPaisa" INTEGER DEFAULT 0 NOT NULL,
    "refundedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "duePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codCollectPaisa" INTEGER DEFAULT 0 NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerPhoneNormalized" TEXT,
    "customerEmail" TEXT,
    "shippingDistrictCode" TEXT,
    "shippingAddressLine" TEXT,
    "shippingArea" TEXT,
    "deliveryNotes" TEXT,
    "resellerCollectionPaisa" INTEGER,
    "resellerCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "resellerEarningPaisa" INTEGER DEFAULT 0 NOT NULL,
    "deliveryZoneId" TEXT,
    "expectedDeliveryAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "readyToShipAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledByUserId" TEXT,
    "internalNote" TEXT,
    "customerNote" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "idempotencyKey" TEXT,
    "sourceReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "variantAttributes" JSONB,
    "quantity" INTEGER NOT NULL,
    "unitPricePaisa" INTEGER NOT NULL,
    "compareAtPricePaisa" INTEGER,
    "unitCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "unitResellerPricePaisa" INTEGER,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "discountPaisa" INTEGER DEFAULT 0 NOT NULL,
    "lineSubtotalPaisa" INTEGER NOT NULL,
    "lineTotalPaisa" INTEGER NOT NULL,
    "taxPaisa" INTEGER DEFAULT 0 NOT NULL,
    "reservedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "preorderQuantity" INTEGER DEFAULT 0 NOT NULL,
    "allocatedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "dispatchedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "cancelledQuantity" INTEGER DEFAULT 0 NOT NULL,
    "returnedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "exchangedQuantity" INTEGER DEFAULT 0 NOT NULL,
    "status" "OrderItemStatus" DEFAULT 'PENDING' NOT NULL,
    "isPreorder" BOOLEAN DEFAULT false NOT NULL,
    "pricingSource" TEXT,
    "priceListId" TEXT,
    "note" TEXT,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAdjustment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderAdjustmentType" NOT NULL,
    "label" TEXT NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAddress" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderAddressType" DEFAULT 'SHIPPING' NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT,
    "districtCode" TEXT,
    "districtName" TEXT,
    "addressLine" TEXT NOT NULL,
    "area" TEXT,
    "postcode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "OrderAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "orderId" TEXT NOT NULL,
    "field" "OrderStatusField" DEFAULT 'ORDER' NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorType" "ActorType" DEFAULT 'USER' NOT NULL,
    "actorCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentRecordStatus" DEFAULT 'PENDING' NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "paidPaisa" INTEGER DEFAULT 0 NOT NULL,
    "refundedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "integrationId" TEXT,
    "providerName" TEXT,
    "providerReference" TEXT,
    "providerPaymentId" TEXT,
    "collectedByUserId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "recordedByUserId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "paymentId" TEXT,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentAttemptStatus" DEFAULT 'INITIATED' NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "currency" TEXT DEFAULT 'BDT' NOT NULL,
    "providerName" TEXT,
    "providerPaymentId" TEXT,
    "providerTransactionId" TEXT,
    "providerReference" TEXT,
    "clientReference" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "paymentId" TEXT,
    "paymentAttemptId" TEXT,
    "orderId" TEXT,
    "businessId" TEXT,
    "providerName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventId" TEXT,
    "signatureValid" BOOLEAN DEFAULT false NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "WebhookEventStatus" DEFAULT 'RECEIVED' NOT NULL,
    "processingResult" TEXT,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT,
    "exchangeRequestId" TEXT,
    "amountPaisa" INTEGER NOT NULL,
    "direction" TEXT DEFAULT 'COLLECT' NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "exchangeRequestId" TEXT,
    "customerId" TEXT,
    "method" "RefundMethod" DEFAULT 'MANUAL' NOT NULL,
    "status" "RefundStatus" DEFAULT 'REQUESTED' NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "providerName" TEXT,
    "providerReference" TEXT,
    "providerRefundId" TEXT,
    "requestedByUserId" TEXT,
    "processedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundAttempt" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "refundId" TEXT NOT NULL,
    "status" "RefundStatus" DEFAULT 'PROCESSING' NOT NULL,
    "providerName" TEXT,
    "providerReference" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "RefundAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodCollection" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "expectedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "collectedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "courierChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "netPaisa" INTEGER DEFAULT 0 NOT NULL,
    "collectedAt" TIMESTAMP(3),
    "recordedByUserId" TEXT,
    "settlementId" TEXT,
    "status" TEXT DEFAULT 'RECORDED' NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CodCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "PaymentReconciliationType" DEFAULT 'PAYMENT_PROVIDER' NOT NULL,
    "status" "PaymentReconciliationStatus" DEFAULT 'PENDING' NOT NULL,
    "providerName" TEXT,
    "reference" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3),
    "grossPaisa" INTEGER DEFAULT 0 NOT NULL,
    "feePaisa" INTEGER DEFAULT 0 NOT NULL,
    "netPaisa" INTEGER DEFAULT 0 NOT NULL,
    "matchedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "reconciledByUserId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierProvider" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" "CourierProviderCode" NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN DEFAULT false NOT NULL,
    "testMode" BOOLEAN DEFAULT true NOT NULL,
    "integrationId" TEXT,
    "pickupName" TEXT,
    "pickupPhone" TEXT,
    "pickupAddress" TEXT,
    "pickupCity" TEXT,
    "pickupArea" TEXT,
    "defaultWeightGrams" INTEGER DEFAULT 500 NOT NULL,
    "defaultDeliveryType" TEXT,
    "codEnabled" BOOLEAN DEFAULT true NOT NULL,
    "returnFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "priority" INTEGER DEFAULT 0 NOT NULL,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT,
    "exchangeRequestId" TEXT,
    "courierProviderId" TEXT,
    "providerCode" "CourierProviderCode" DEFAULT 'MANUAL' NOT NULL,
    "type" "ShipmentType" DEFAULT 'SALE' NOT NULL,
    "status" "ShipmentStatus" DEFAULT 'DRAFT' NOT NULL,
    "internalCode" TEXT NOT NULL,
    "providerConsignmentId" TEXT,
    "trackingCode" TEXT,
    "merchantOrderId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientPhoneNormalized" TEXT,
    "recipientDistrictCode" TEXT,
    "recipientAddress" TEXT NOT NULL,
    "recipientArea" TEXT,
    "recipientNote" TEXT,
    "itemDescription" TEXT,
    "itemQuantity" INTEGER DEFAULT 0 NOT NULL,
    "declaredWeightGrams" INTEGER DEFAULT 500 NOT NULL,
    "deliveryType" TEXT,
    "codAmountPaisa" INTEGER DEFAULT 0 NOT NULL,
    "courierChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "deliveryFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "expectedCollectionPaisa" INTEGER DEFAULT 0 NOT NULL,
    "collectedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "attemptCount" INTEGER DEFAULT 0 NOT NULL,
    "requestedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastStatusAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "providerStatusRaw" TEXT,
    "deliverableQuantity" INTEGER DEFAULT 0 NOT NULL,
    "partialDelivery" BOOLEAN DEFAULT false NOT NULL,
    "assignedDeliveryAgent" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentStatusHistory" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "fromStatus" "ShipmentStatus",
    "toStatus" "ShipmentStatus" NOT NULL,
    "providerStatus" TEXT,
    "source" "ShipmentSource" DEFAULT 'MANUAL' NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "recordedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ShipmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierCharge" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "type" "CourierChargeType" DEFAULT 'DELIVERY' NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "CourierCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierWebhookEvent" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "courierProviderId" TEXT,
    "providerCode" "CourierProviderCode" NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "trackingCode" TEXT,
    "signatureValid" BOOLEAN DEFAULT false NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "WebhookEventStatus" DEFAULT 'RECEIVED' NOT NULL,
    "processingResult" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER DEFAULT 1 NOT NULL,
    "receivedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "processedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    CONSTRAINT "CourierWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlement" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "courierProviderId" TEXT,
    "providerCode" "CourierProviderCode" NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "SettlementStatus" DEFAULT 'DRAFT' NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "settlementDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "bankReference" TEXT,
    "grossCollectedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "courierFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "otherDeductionPaisa" INTEGER DEFAULT 0 NOT NULL,
    "netReceivedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "reconciledPaisa" INTEGER DEFAULT 0 NOT NULL,
    "unmatchedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "importedByUserId" TEXT,
    "reconciledByUserId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "sourceFileName" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierSettlementEntry" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "settlementId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "reference" TEXT,
    "trackingCode" TEXT,
    "grossPaisa" INTEGER DEFAULT 0 NOT NULL,
    "courierFeePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "otherDeductionPaisa" INTEGER DEFAULT 0 NOT NULL,
    "netPaisa" INTEGER DEFAULT 0 NOT NULL,
    "status" "SettlementEntryStatus" DEFAULT 'UNMATCHED' NOT NULL,
    "matchMethod" TEXT,
    "discrepancyPaisa" INTEGER DEFAULT 0 NOT NULL,
    "discrepancyReason" TEXT,
    "note" TEXT,
    "ledgerProcessedAt" TIMESTAMP(3),
    "matchedAt" TIMESTAMP(3),
    "matchedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierSettlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRequest" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "exchangeNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "resellerId" TEXT,
    "reasonId" TEXT,
    "reasonCode" TEXT NOT NULL,
    "reasonNote" TEXT,
    "status" "ExchangeStatus" DEFAULT 'REQUESTED' NOT NULL,
    "channel" "ExchangeChannel" DEFAULT 'CUSTOMER' NOT NULL,
    "isPartial" BOOLEAN DEFAULT false NOT NULL,
    "returnValuePaisa" INTEGER DEFAULT 0 NOT NULL,
    "replacementValuePaisa" INTEGER DEFAULT 0 NOT NULL,
    "deliveryChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "additionalChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "discountPaisa" INTEGER DEFAULT 0 NOT NULL,
    "differencePaisa" INTEGER DEFAULT 0 NOT NULL,
    "collectionStatus" TEXT DEFAULT 'NONE' NOT NULL,
    "refundId" TEXT,
    "paymentId" TEXT,
    "requestedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectionReason" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedByUserId" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "inspectedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "replacementOrderId" TEXT,
    "replacementShipmentId" TEXT,
    "returnShipmentId" TEXT,
    "expectedDeliveryAt" TIMESTAMP(3),
    "note" TEXT,
    "internalNote" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "exchangeRequestId" TEXT NOT NULL,
    "direction" "ExchangeDirection" NOT NULL,
    "orderItemId" TEXT,
    "variantId" TEXT,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "attributesSnapshot" JSONB,
    "quantity" INTEGER NOT NULL,
    "unitPricePaisa" INTEGER NOT NULL,
    "lineTotalPaisa" INTEGER NOT NULL,
    "unitCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "inspectionOutcome" "InspectionOutcome" DEFAULT 'PENDING' NOT NULL,
    "inspectionNote" TEXT,
    "inspectedByUserId" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "inspectionQuantity" INTEGER,
    "restockMovementId" TEXT,
    "replacementStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeStatusHistory" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "exchangeRequestId" TEXT NOT NULL,
    "fromStatus" "ExchangeStatus",
    "toStatus" "ExchangeStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorCustomerId" TEXT,
    "actorType" "ActorType" DEFAULT 'USER' NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ExchangeStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reseller" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "status" "ResellerStatus" DEFAULT 'ACTIVE' NOT NULL,
    "commissionType" "ResellerCommissionType" DEFAULT 'MARGIN_BASED' NOT NULL,
    "commissionValue" INTEGER DEFAULT 0 NOT NULL,
    "packagingIncluded" BOOLEAN DEFAULT true NOT NULL,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "deliveryChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "defaultDistrictCode" TEXT,
    "address" TEXT,
    "nidNumber" TEXT,
    "payoutMethod" "PayoutMethod" DEFAULT 'BKASH' NOT NULL,
    "payoutAccountNumber" TEXT,
    "payoutAccountName" TEXT,
    "minimumPayoutPaisa" INTEGER DEFAULT 0 NOT NULL,
    "creditLimitPaisa" INTEGER DEFAULT 0 NOT NULL,
    "joinedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reseller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerLedgerEntry" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "type" "ResellerLedgerType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "status" "LedgerEntryStatus" DEFAULT 'PENDING' NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "settlementId" TEXT,
    "settlementEntryId" TEXT,
    "exchangeRequestId" TEXT,
    "payoutId" TEXT,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "eligibleAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "reversesEntryId" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "actorType" "ActorType" DEFAULT 'SYSTEM' NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResellerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerOrderEarning" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "collectedPaisa" INTEGER DEFAULT 0 NOT NULL,
    "resellerPricePaisa" INTEGER DEFAULT 0 NOT NULL,
    "resellerCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "packagingCostPaisa" INTEGER DEFAULT 0 NOT NULL,
    "courierChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "codChargePaisa" INTEGER DEFAULT 0 NOT NULL,
    "earningsPaisa" INTEGER DEFAULT 0 NOT NULL,
    "expectedCodPaisa" INTEGER DEFAULT 0 NOT NULL,
    "settledPaisa" INTEGER DEFAULT 0 NOT NULL,
    "eligibilityStatus" TEXT DEFAULT 'PENDING' NOT NULL,
    "eligibleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResellerOrderEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerCollectionChange" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "orderId" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "previousPaisa" INTEGER,
    "newPaisa" INTEGER NOT NULL,
    "reason" TEXT,
    "changedByUserId" TEXT,
    "changedByResellerId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ResellerCollectionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerPayout" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "payoutNumber" TEXT NOT NULL,
    "status" "PayoutStatus" DEFAULT 'DRAFT' NOT NULL,
    "method" "PayoutMethod" DEFAULT 'BKASH' NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "transactionReference" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "note" TEXT,
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResellerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerPayoutEntry" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "payoutId" TEXT NOT NULL,
    "ledgerEntryId" TEXT NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ResellerPayoutEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerPayoutTransaction" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "payoutId" TEXT NOT NULL,
    "status" "PayoutStatus" DEFAULT 'PENDING' NOT NULL,
    "providerName" TEXT,
    "providerReference" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ResellerPayoutTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "folderId" TEXT,
    "storageProvider" TEXT DEFAULT 'S3' NOT NULL,
    "bucket" TEXT,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "altText" TEXT,
    "title" TEXT,
    "caption" TEXT,
    "visibility" "MediaVisibility" DEFAULT 'PUBLIC' NOT NULL,
    "uploadedByUserId" TEXT,
    "usageCount" INTEGER DEFAULT 0 NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "mediaId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT DEFAULT 'image' NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "PageType" DEFAULT 'CONTENT' NOT NULL,
    "status" "PageStatus" DEFAULT 'DRAFT' NOT NULL,
    "isSystem" BOOLEAN DEFAULT false NOT NULL,
    "isHomepage" BOOLEAN DEFAULT false NOT NULL,
    "publishedVersionId" TEXT,
    "draftVersionId" TEXT,
    "currentVersion" INTEGER DEFAULT 0 NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoKeywords" TEXT,
    "ogMediaId" TEXT,
    "canonicalUrl" TEXT,
    "robots" TEXT,
    "template" TEXT DEFAULT 'default' NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PageVersionStatus" DEFAULT 'DRAFT' NOT NULL,
    "document" JSONB NOT NULL,
    "documentVersion" INTEGER DEFAULT 1 NOT NULL,
    "blocksCount" INTEGER DEFAULT 0 NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavigationMenu" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NavigationMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavigationMenuItem" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "menuId" TEXT NOT NULL,
    "parentId" TEXT,
    "label" TEXT NOT NULL,
    "type" "NavigationItemType" DEFAULT 'URL' NOT NULL,
    "url" TEXT,
    "pageId" TEXT,
    "categoryId" TEXT,
    "productId" TEXT,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "openInNewTab" BOOLEAN DEFAULT false NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NavigationMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" DEFAULT 'PENDING' NOT NULL,
    "verifiedPurchase" BOOLEAN DEFAULT false NOT NULL,
    "isFeatured" BOOLEAN DEFAULT false NOT NULL,
    "helpfulCount" INTEGER DEFAULT 0 NOT NULL,
    "reportedCount" INTEGER DEFAULT 0 NOT NULL,
    "moderatedByUserId" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "moderationNote" TEXT,
    "rejectionReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewImage" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "reviewId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ReviewImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "reviewId" TEXT NOT NULL,
    "customerId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT DEFAULT 'OPEN' NOT NULL,
    "handledByUserId" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "kind" "IntegrationKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeKey" TEXT DEFAULT '' NOT NULL,
    "isEnabled" BOOLEAN DEFAULT false NOT NULL,
    "testMode" BOOLEAN DEFAULT true NOT NULL,
    "config" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "integrationId" TEXT,
    "courierProviderId" TEXT,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "description" TEXT,
    "updatedByUserId" TEXT,
    "lastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastFour" TEXT,
    "status" "ApiKeyStatus" DEFAULT 'ACTIVE' NOT NULL,
    "rateLimitPerMinute" INTEGER DEFAULT 120 NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER DEFAULT 0 NOT NULL,
    "description" TEXT,
    "createdByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "rotatedFromKeyId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowedIpAddresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKeyScope" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ApiKeyScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "apiKeyId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "scope" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingIntegration" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "provider" "MarketingProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN DEFAULT false NOT NULL,
    "consentRequired" BOOLEAN DEFAULT true NOT NULL,
    "pixelId" TEXT,
    "integrationId" TEXT,
    "trackProductView" BOOLEAN DEFAULT true NOT NULL,
    "trackAddToCart" BOOLEAN DEFAULT true NOT NULL,
    "trackInitiateCheckout" BOOLEAN DEFAULT true NOT NULL,
    "trackPurchase" BOOLEAN DEFAULT true NOT NULL,
    "testEventCode" TEXT,
    "config" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "marketingIntegrationId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "eventName" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "customerId" TEXT,
    "orderId" TEXT,
    "sessionId" TEXT,
    "consentGranted" BOOLEAN DEFAULT false NOT NULL,
    "status" "MarketingEventStatus" DEFAULT 'PENDING' NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "payload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "marketingConsent" BOOLEAN DEFAULT false NOT NULL,
    "analyticsConsent" BOOLEAN DEFAULT false NOT NULL,
    "necessaryConsent" BOOLEAN DEFAULT true NOT NULL,
    "policyVersion" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT,
    "status" "PluginStatus" DEFAULT 'REGISTERED' NOT NULL,
    "isTrusted" BOOLEAN DEFAULT false NOT NULL,
    "config" JSONB,
    "configSchema" JSONB,
    "compatibility" JSONB,
    "installedByUserId" TEXT,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "failureCount" INTEGER DEFAULT 0 NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "WebhookDeliveryStatus" DEFAULT 'PENDING' NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "maxAttempts" INTEGER DEFAULT 6 NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "severity" "NotificationSeverity" DEFAULT 'INFO' NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "url" TEXT,
    "data" JSONB,
    "permissionKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "actorType" "ActorType" DEFAULT 'USER' NOT NULL,
    "actorUserId" TEXT,
    "actorCustomerId" TEXT,
    "actorApiKeyId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "changedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "queue" TEXT DEFAULT 'default' NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" DEFAULT 'PENDING' NOT NULL,
    "priority" INTEGER DEFAULT 0 NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "maxAttempts" INTEGER DEFAULT 5 NOT NULL,
    "runAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resultSummary" TEXT,
    "idempotencyKey" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT DEFAULT gen_random_uuid() NOT NULL,
    "businessId" TEXT,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" DEFAULT 'PENDING' NOT NULL,
    "attempts" INTEGER DEFAULT 0 NOT NULL,
    "maxAttempts" INTEGER DEFAULT 8 NOT NULL,
    "availableAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "Business_createdAt_idx" ON "Business"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSetting_businessId_key_key" ON "BusinessSetting"("businessId", "key");

-- CreateIndex
CREATE INDEX "BusinessSetting_businessId_idx" ON "BusinessSetting"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_businessId_status_idx" ON "User"("businessId", "status");

-- CreateIndex
CREATE INDEX "User_businessId_deletedAt_idx" ON "User"("businessId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_businessId_slug_key" ON "Role"("businessId", "slug");

-- CreateIndex
CREATE INDEX "Role_businessId_idx" ON "Role"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_group_idx" ON "Permission"("group");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_tokenHash_key" ON "CustomerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_expiresAt_idx" ON "CustomerSession"("customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationCode_destination_purpose_consumedAt_idx" ON "VerificationCode"("destination", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_scope_key_windowStart_key" ON "RateLimitBucket"("scope", "key", "windowStart");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_businessId_key_scope_key" ON "NumberSequence"("businessId", "key", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Storefront_slug_key" ON "Storefront"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Storefront_code_key" ON "Storefront"("code");

-- CreateIndex
CREATE INDEX "Storefront_businessId_status_idx" ON "Storefront"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontDomain_host_key" ON "StorefrontDomain"("host");

-- CreateIndex
CREATE INDEX "StorefrontDomain_storefrontId_idx" ON "StorefrontDomain"("storefrontId");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontSetting_storefrontId_key_key" ON "StorefrontSetting"("storefrontId", "key");

-- CreateIndex
CREATE INDEX "District_division_idx" ON "District"("division");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_businessId_storefrontId_districtCode_key" ON "DeliveryZone"("businessId", "storefrontId", "districtCode");

-- CreateIndex
CREATE INDEX "DeliveryZone_businessId_isActive_idx" ON "DeliveryZone"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutFieldConfig_businessId_storefrontId_fieldKey_key" ON "CheckoutFieldConfig"("businessId", "storefrontId", "fieldKey");

-- CreateIndex
CREATE INDEX "CheckoutFieldConfig_businessId_idx" ON "CheckoutFieldConfig"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeReason_businessId_code_key" ON "ExchangeReason"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Category_businessId_slug_key" ON "Category"("businessId", "slug");

-- CreateIndex
CREATE INDEX "Category_businessId_isActive_position_idx" ON "Category"("businessId", "isActive", "position");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_slug_key" ON "Product"("businessId", "slug");

-- CreateIndex
CREATE INDEX "Product_businessId_status_createdAt_idx" ON "Product"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Product_businessId_isFeatured_idx" ON "Product"("businessId", "isFeatured");

-- CreateIndex
CREATE INDEX "Product_businessId_deletedAt_idx" ON "Product"("businessId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_productId_categoryId_key" ON "ProductCategory"("productId", "categoryId");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_idx" ON "ProductCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Attribute_businessId_slug_key" ON "Attribute"("businessId", "slug");

-- CreateIndex
CREATE INDEX "Attribute_businessId_position_idx" ON "Attribute"("businessId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeValue_attributeId_slug_key" ON "AttributeValue"("attributeId", "slug");

-- CreateIndex
CREATE INDEX "AttributeValue_attributeId_position_idx" ON "AttributeValue"("attributeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAttribute_productId_attributeId_key" ON "ProductAttribute"("productId", "attributeId");

-- CreateIndex
CREATE INDEX "ProductAttribute_attributeId_idx" ON "ProductAttribute"("attributeId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_sku_key" ON "Variant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_productId_optionKey_key" ON "Variant"("productId", "optionKey");

-- CreateIndex
CREATE INDEX "Variant_productId_status_idx" ON "Variant"("productId", "status");

-- CreateIndex
CREATE INDEX "Variant_status_idx" ON "Variant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttributeValue_variantId_attributeId_key" ON "VariantAttributeValue"("variantId", "attributeId");

-- CreateIndex
CREATE INDEX "VariantAttributeValue_attributeValueId_idx" ON "VariantAttributeValue"("attributeValueId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_mediaId_key" ON "ProductImage"("productId", "mediaId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "VariantImage_variantId_mediaId_key" ON "VariantImage"("variantId", "mediaId");

-- CreateIndex
CREATE INDEX "VariantImage_variantId_position_idx" ON "VariantImage"("variantId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_resellerId_key" ON "PriceList"("resellerId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_businessId_slug_key" ON "PriceList"("businessId", "slug");

-- CreateIndex
CREATE INDEX "PriceList_businessId_channel_status_idx" ON "PriceList"("businessId", "channel", "status");

-- CreateIndex
CREATE INDEX "PriceList_storefrontId_idx" ON "PriceList"("storefrontId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_variantId_minQuantity_key" ON "PriceListItem"("priceListId", "variantId", "minQuantity");

-- CreateIndex
CREATE INDEX "PriceListItem_variantId_idx" ON "PriceListItem"("variantId");

-- CreateIndex
CREATE INDEX "Supplier_businessId_isActive_idx" ON "Supplier"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_businessId_code_key" ON "PurchaseOrder"("businessId", "code");

-- CreateIndex
CREATE INDEX "PurchaseOrder_businessId_status_createdAt_idx" ON "PurchaseOrder"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_variantId_key" ON "PurchaseOrderItem"("purchaseOrderId", "variantId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_variantId_idx" ON "PurchaseOrderItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_idempotencyKey_key" ON "GoodsReceipt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_purchaseOrderId_code_key" ON "GoodsReceipt"("purchaseOrderId", "code");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_status_idx" ON "GoodsReceipt"("purchaseOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptItem_inventoryMovementId_key" ON "GoodsReceiptItem"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_goodsReceiptId_idx" ON "GoodsReceiptItem"("goodsReceiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptItem_variantId_idx" ON "GoodsReceiptItem"("variantId");

-- CreateIndex
CREATE INDEX "PurchaseExpense_purchaseOrderId_idx" ON "PurchaseExpense"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierPayment_businessId_paidAt_idx" ON "SupplierPayment"("businessId", "paidAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_businessId_code_key" ON "InventoryLocation"("businessId", "code");

-- CreateIndex
CREATE INDEX "InventoryLocation_businessId_isActive_idx" ON "InventoryLocation"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_locationId_variantId_key" ON "InventoryBalance"("locationId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryBalance_variantId_idx" ON "InventoryBalance"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_variantId_createdAt_idx" ON "InventoryMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_locationId_variantId_createdAt_idx" ON "InventoryMovement"("locationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_createdAt_idx" ON "InventoryMovement"("type", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_sourceType_sourceId_idx" ON "InventoryMovement"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderItemId_key" ON "StockReservation"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_idempotencyKey_key" ON "StockReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_variantId_status_idx" ON "StockReservation"("variantId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ReservationAllocation_reservationId_idx" ON "ReservationAllocation"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "PreorderCommitment_orderItemId_key" ON "PreorderCommitment"("orderItemId");

-- CreateIndex
CREATE INDEX "PreorderCommitment_variantId_status_priorityAt_idx" ON "PreorderCommitment"("variantId", "status", "priorityAt");

-- CreateIndex
CREATE INDEX "PreorderCommitment_orderId_idx" ON "PreorderCommitment"("orderId");

-- CreateIndex
CREATE INDEX "PreorderAllocation_preorderCommitmentId_idx" ON "PreorderAllocation"("preorderCommitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentReason_businessId_code_key" ON "StockAdjustmentReason"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_inventoryMovementId_key" ON "StockAdjustment"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "StockAdjustment_variantId_createdAt_idx" ON "StockAdjustment"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockAdjustment_businessId_createdAt_idx" ON "StockAdjustment"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_phoneNormalized_key" ON "Customer"("businessId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "Customer_businessId_emailNormalized_idx" ON "Customer"("businessId", "emailNormalized");

-- CreateIndex
CREATE INDEX "Customer_businessId_status_idx" ON "Customer"("businessId", "status");

-- CreateIndex
CREATE INDEX "Customer_businessId_deletedAt_idx" ON "Customer"("businessId", "deletedAt");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "CustomerNote"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountClaimRequest_customerId_createdAt_idx" ON "AccountClaimRequest"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountClaimRequest_expiresAt_idx" ON "AccountClaimRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_businessId_orderNumber_key" ON "Order"("businessId", "orderNumber");

-- CreateIndex
CREATE INDEX "Order_businessId_status_placedAt_idx" ON "Order"("businessId", "status", "placedAt");

-- CreateIndex
CREATE INDEX "Order_businessId_paymentStatus_idx" ON "Order"("businessId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Order_customerId_placedAt_idx" ON "Order"("customerId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_resellerId_placedAt_idx" ON "Order"("resellerId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_storefrontId_placedAt_idx" ON "Order"("storefrontId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_channel_placedAt_idx" ON "Order"("channel", "placedAt");

-- CreateIndex
CREATE INDEX "Order_placedAt_idx" ON "Order"("placedAt");

-- CreateIndex
CREATE INDEX "Order_businessId_deletedAt_idx" ON "Order"("businessId", "deletedAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderAdjustment_orderId_type_idx" ON "OrderAdjustment"("orderId", "type");

-- CreateIndex
CREATE INDEX "OrderAddress_orderId_type_idx" ON "OrderAddress"("orderId", "type");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_field_createdAt_idx" ON "OrderStatusHistory"("field", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_businessId_status_idx" ON "Payment"("businessId", "status");

-- CreateIndex
CREATE INDEX "Payment_providerReference_idx" ON "Payment"("providerReference");

-- CreateIndex
CREATE INDEX "Payment_method_createdAt_idx" ON "Payment"("method", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_clientReference_key" ON "PaymentAttempt"("clientReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_status_idx" ON "PaymentAttempt"("orderId", "status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerReference_idx" ON "PaymentAttempt"("providerReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerPaymentId_idx" ON "PaymentAttempt"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerName_providerEventId_key" ON "PaymentEvent"("providerName", "providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_providerName_createdAt_idx" ON "PaymentEvent"("providerName", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orderId_idx" ON "PaymentAllocation"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_businessId_status_createdAt_idx" ON "Refund"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RefundAttempt_refundId_idx" ON "RefundAttempt"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "CodCollection_shipmentId_key" ON "CodCollection"("shipmentId");

-- CreateIndex
CREATE INDEX "CodCollection_businessId_collectedAt_idx" ON "CodCollection"("businessId", "collectedAt");

-- CreateIndex
CREATE INDEX "CodCollection_orderId_idx" ON "CodCollection"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_businessId_type_reference_key" ON "PaymentReconciliation"("businessId", "type", "reference");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_businessId_status_idx" ON "PaymentReconciliation"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourierProvider_businessId_code_key" ON "CourierProvider"("businessId", "code");

-- CreateIndex
CREATE INDEX "CourierProvider_businessId_isEnabled_idx" ON "CourierProvider"("businessId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_idempotencyKey_key" ON "Shipment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_businessId_internalCode_key" ON "Shipment"("businessId", "internalCode");

-- CreateIndex
CREATE INDEX "Shipment_orderId_idx" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_status_createdAt_idx" ON "Shipment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Shipment_trackingCode_idx" ON "Shipment"("trackingCode");

-- CreateIndex
CREATE INDEX "Shipment_providerConsignmentId_idx" ON "Shipment"("providerConsignmentId");

-- CreateIndex
CREATE INDEX "Shipment_providerCode_lastStatusAt_idx" ON "Shipment"("providerCode", "lastStatusAt");

-- CreateIndex
CREATE INDEX "ShipmentStatusHistory_shipmentId_recordedAt_idx" ON "ShipmentStatusHistory"("shipmentId", "recordedAt");

-- CreateIndex
CREATE INDEX "CourierCharge_shipmentId_type_idx" ON "CourierCharge"("shipmentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CourierWebhookEvent_providerCode_providerEventId_key" ON "CourierWebhookEvent"("providerCode", "providerEventId");

-- CreateIndex
CREATE INDEX "CourierWebhookEvent_status_receivedAt_idx" ON "CourierWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "CourierWebhookEvent_providerCode_receivedAt_idx" ON "CourierWebhookEvent"("providerCode", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlement_idempotencyKey_key" ON "CourierSettlement"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlement_businessId_providerCode_reference_key" ON "CourierSettlement"("businessId", "providerCode", "reference");

-- CreateIndex
CREATE INDEX "CourierSettlement_businessId_status_settlementDate_idx" ON "CourierSettlement"("businessId", "status", "settlementDate");

-- CreateIndex
CREATE INDEX "CourierSettlement_providerCode_settlementDate_idx" ON "CourierSettlement"("providerCode", "settlementDate");

-- CreateIndex
CREATE UNIQUE INDEX "CourierSettlementEntry_settlementId_shipmentId_key" ON "CourierSettlementEntry"("settlementId", "shipmentId");

-- CreateIndex
CREATE INDEX "CourierSettlementEntry_settlementId_status_idx" ON "CourierSettlementEntry"("settlementId", "status");

-- CreateIndex
CREATE INDEX "CourierSettlementEntry_orderId_idx" ON "CourierSettlementEntry"("orderId");

-- CreateIndex
CREATE INDEX "CourierSettlementEntry_trackingCode_idx" ON "CourierSettlementEntry"("trackingCode");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRequest_idempotencyKey_key" ON "ExchangeRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRequest_businessId_exchangeNumber_key" ON "ExchangeRequest"("businessId", "exchangeNumber");

-- CreateIndex
CREATE INDEX "ExchangeRequest_orderId_idx" ON "ExchangeRequest"("orderId");

-- CreateIndex
CREATE INDEX "ExchangeRequest_status_createdAt_idx" ON "ExchangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExchangeRequest_customerId_idx" ON "ExchangeRequest"("customerId");

-- CreateIndex
CREATE INDEX "ExchangeItem_exchangeRequestId_direction_idx" ON "ExchangeItem"("exchangeRequestId", "direction");

-- CreateIndex
CREATE INDEX "ExchangeItem_orderItemId_idx" ON "ExchangeItem"("orderItemId");

-- CreateIndex
CREATE INDEX "ExchangeStatusHistory_exchangeRequestId_createdAt_idx" ON "ExchangeStatusHistory"("exchangeRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_userId_key" ON "Reseller"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_businessId_code_key" ON "Reseller"("businessId", "code");

-- CreateIndex
CREATE INDEX "Reseller_businessId_status_idx" ON "Reseller"("businessId", "status");

-- CreateIndex
CREATE INDEX "Reseller_phoneNormalized_idx" ON "Reseller"("phoneNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerLedgerEntry_reversesEntryId_key" ON "ResellerLedgerEntry"("reversesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerLedgerEntry_idempotencyKey_key" ON "ResellerLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResellerLedgerEntry_resellerId_status_idx" ON "ResellerLedgerEntry"("resellerId", "status");

-- CreateIndex
CREATE INDEX "ResellerLedgerEntry_resellerId_createdAt_idx" ON "ResellerLedgerEntry"("resellerId", "createdAt");

-- CreateIndex
CREATE INDEX "ResellerLedgerEntry_businessId_status_idx" ON "ResellerLedgerEntry"("businessId", "status");

-- CreateIndex
CREATE INDEX "ResellerLedgerEntry_orderId_idx" ON "ResellerLedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "ResellerLedgerEntry_type_createdAt_idx" ON "ResellerLedgerEntry"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerOrderEarning_orderItemId_key" ON "ResellerOrderEarning"("orderItemId");

-- CreateIndex
CREATE INDEX "ResellerOrderEarning_resellerId_eligibilityStatus_idx" ON "ResellerOrderEarning"("resellerId", "eligibilityStatus");

-- CreateIndex
CREATE INDEX "ResellerOrderEarning_orderId_idx" ON "ResellerOrderEarning"("orderId");

-- CreateIndex
CREATE INDEX "ResellerCollectionChange_orderId_createdAt_idx" ON "ResellerCollectionChange"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ResellerCollectionChange_resellerId_createdAt_idx" ON "ResellerCollectionChange"("resellerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerPayout_idempotencyKey_key" ON "ResellerPayout"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerPayout_businessId_payoutNumber_key" ON "ResellerPayout"("businessId", "payoutNumber");

-- CreateIndex
CREATE INDEX "ResellerPayout_resellerId_status_idx" ON "ResellerPayout"("resellerId", "status");

-- CreateIndex
CREATE INDEX "ResellerPayout_businessId_status_createdAt_idx" ON "ResellerPayout"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerPayoutEntry_ledgerEntryId_key" ON "ResellerPayoutEntry"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "ResellerPayoutEntry_payoutId_idx" ON "ResellerPayoutEntry"("payoutId");

-- CreateIndex
CREATE INDEX "ResellerPayoutTransaction_payoutId_idx" ON "ResellerPayoutTransaction"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFolder_businessId_path_key" ON "MediaFolder"("businessId", "path");

-- CreateIndex
CREATE INDEX "MediaFolder_businessId_parentId_idx" ON "MediaFolder"("businessId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "MediaAsset_businessId_createdAt_idx" ON "MediaAsset"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_businessId_folderId_idx" ON "MediaAsset"("businessId", "folderId");

-- CreateIndex
CREATE INDEX "MediaAsset_mimeType_idx" ON "MediaAsset"("mimeType");

-- CreateIndex
CREATE INDEX "MediaAsset_businessId_deletedAt_idx" ON "MediaAsset"("businessId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUsage_mediaId_entityType_entityId_field_key" ON "MediaUsage"("mediaId", "entityType", "entityId", "field");

-- CreateIndex
CREATE INDEX "MediaUsage_entityType_entityId_idx" ON "MediaUsage"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_publishedVersionId_key" ON "Page"("publishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_draftVersionId_key" ON "Page"("draftVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_businessId_storefrontId_slug_key" ON "Page"("businessId", "storefrontId", "slug");

-- CreateIndex
CREATE INDEX "Page_businessId_status_idx" ON "Page"("businessId", "status");

-- CreateIndex
CREATE INDEX "Page_storefrontId_status_idx" ON "Page"("storefrontId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PageVersion_pageId_version_key" ON "PageVersion"("pageId", "version");

-- CreateIndex
CREATE INDEX "PageVersion_pageId_status_idx" ON "PageVersion"("pageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NavigationMenu_storefrontId_handle_key" ON "NavigationMenu"("storefrontId", "handle");

-- CreateIndex
CREATE INDEX "NavigationMenuItem_menuId_position_idx" ON "NavigationMenuItem"("menuId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderItemId_key" ON "Review"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_productId_customerId_key" ON "Review"("productId", "customerId");

-- CreateIndex
CREATE INDEX "Review_productId_status_createdAt_idx" ON "Review"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_customerId_idx" ON "Review"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewImage_reviewId_mediaId_key" ON "ReviewImage"("reviewId", "mediaId");

-- CreateIndex
CREATE INDEX "ReviewImage_reviewId_position_idx" ON "ReviewImage"("reviewId", "position");

-- CreateIndex
CREATE INDEX "ReviewReport_reviewId_idx" ON "ReviewReport"("reviewId");

-- CreateIndex
CREATE INDEX "ReviewReport_status_createdAt_idx" ON "ReviewReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_businessId_kind_provider_scopeKey_key" ON "Integration"("businessId", "kind", "provider", "scopeKey");

-- CreateIndex
CREATE INDEX "Integration_businessId_kind_isEnabled_idx" ON "Integration"("businessId", "kind", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSecret_integrationId_key_key" ON "IntegrationSecret"("integrationId", "key");

-- CreateIndex
CREATE INDEX "IntegrationSecret_courierProviderId_key_idx" ON "IntegrationSecret"("courierProviderId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyPrefix_key" ON "ApiKey"("keyPrefix");

-- CreateIndex
CREATE INDEX "ApiKey_businessId_status_idx" ON "ApiKey"("businessId", "status");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKeyScope_apiKeyId_scope_key" ON "ApiKeyScope"("apiKeyId", "scope");

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiKeyId_createdAt_idx" ON "ApiRequestLog"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingIntegration_businessId_provider_storefrontId_key" ON "MarketingIntegration"("businessId", "provider", "storefrontId");

-- CreateIndex
CREATE INDEX "MarketingIntegration_businessId_isEnabled_idx" ON "MarketingIntegration"("businessId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEvent_marketingIntegrationId_dedupeKey_key" ON "MarketingEvent"("marketingIntegrationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "MarketingEvent_status_nextAttemptAt_idx" ON "MarketingEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_orderId_idx" ON "MarketingEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_storefrontId_sessionId_key" ON "ConsentRecord"("storefrontId", "sessionId");

-- CreateIndex
CREATE INDEX "ConsentRecord_businessId_createdAt_idx" ON "ConsentRecord"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_businessId_key_key" ON "Plugin"("businessId", "key");

-- CreateIndex
CREATE INDEX "Plugin_businessId_status_idx" ON "Plugin"("businessId", "status");

-- CreateIndex
CREATE INDEX "WebhookSubscription_businessId_isActive_idx" ON "WebhookSubscription"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_dedupeKey_key" ON "WebhookDelivery"("subscriptionId", "dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_businessId_createdAt_idx" ON "Notification"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_readAt_createdAt_idx" ON "NotificationRecipient"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_runAt_priority_idx" ON "BackgroundJob"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "BackgroundJob_queue_status_idx" ON "BackgroundJob"("queue", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_createdAt_idx" ON "BackgroundJob"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "OutboxEvent_eventType_status_idx" ON "OutboxEvent"("eventType", "status");

-- AddForeignKey
ALTER TABLE "BusinessSetting" ADD CONSTRAINT "BusinessSetting_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storefront" ADD CONSTRAINT "Storefront_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontDomain" ADD CONSTRAINT "StorefrontDomain_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontSetting" ADD CONSTRAINT "StorefrontSetting_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_districtCode_fkey" FOREIGN KEY ("districtCode") REFERENCES "District"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutFieldConfig" ADD CONSTRAINT "CheckoutFieldConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeReason" ADD CONSTRAINT "ExchangeReason_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attribute" ADD CONSTRAINT "Attribute_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAttribute" ADD CONSTRAINT "ProductAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "AttributeValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantImage" ADD CONSTRAINT "VariantImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantImage" ADD CONSTRAINT "VariantImage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseExpense" ADD CONSTRAINT "PurchaseExpense_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseExpense" ADD CONSTRAINT "PurchaseExpense_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationAllocation" ADD CONSTRAINT "ReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "StockReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationAllocation" ADD CONSTRAINT "ReservationAllocation_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderCommitment" ADD CONSTRAINT "PreorderCommitment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderCommitment" ADD CONSTRAINT "PreorderCommitment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderCommitment" ADD CONSTRAINT "PreorderCommitment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderCommitment" ADD CONSTRAINT "PreorderCommitment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderAllocation" ADD CONSTRAINT "PreorderAllocation_preorderCommitmentId_fkey" FOREIGN KEY ("preorderCommitmentId") REFERENCES "PreorderCommitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreorderAllocation" ADD CONSTRAINT "PreorderAllocation_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentReason" ADD CONSTRAINT "StockAdjustmentReason_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "StockAdjustmentReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_districtCode_fkey" FOREIGN KEY ("districtCode") REFERENCES "District"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountClaimRequest" ADD CONSTRAINT "AccountClaimRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAddress" ADD CONSTRAINT "OrderAddress_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "ExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAttempt" ADD CONSTRAINT "RefundAttempt_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CourierSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReconciliation" ADD CONSTRAINT "PaymentReconciliation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierProvider" ADD CONSTRAINT "CourierProvider_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "ExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_courierProviderId_fkey" FOREIGN KEY ("courierProviderId") REFERENCES "CourierProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentStatusHistory" ADD CONSTRAINT "ShipmentStatusHistory_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierCharge" ADD CONSTRAINT "CourierCharge_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierWebhookEvent" ADD CONSTRAINT "CourierWebhookEvent_courierProviderId_fkey" FOREIGN KEY ("courierProviderId") REFERENCES "CourierProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlement" ADD CONSTRAINT "CourierSettlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlement" ADD CONSTRAINT "CourierSettlement_courierProviderId_fkey" FOREIGN KEY ("courierProviderId") REFERENCES "CourierProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementEntry" ADD CONSTRAINT "CourierSettlementEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CourierSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementEntry" ADD CONSTRAINT "CourierSettlementEntry_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementEntry" ADD CONSTRAINT "CourierSettlementEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierSettlementEntry" ADD CONSTRAINT "CourierSettlementEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "ExchangeReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeItem" ADD CONSTRAINT "ExchangeItem_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "ExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeItem" ADD CONSTRAINT "ExchangeItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeItem" ADD CONSTRAINT "ExchangeItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeStatusHistory" ADD CONSTRAINT "ExchangeStatusHistory_exchangeRequestId_fkey" FOREIGN KEY ("exchangeRequestId") REFERENCES "ExchangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reseller" ADD CONSTRAINT "Reseller_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CourierSettlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_settlementEntryId_fkey" FOREIGN KEY ("settlementEntryId") REFERENCES "CourierSettlementEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ResellerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerLedgerEntry" ADD CONSTRAINT "ResellerLedgerEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "ResellerLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerOrderEarning" ADD CONSTRAINT "ResellerOrderEarning_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerOrderEarning" ADD CONSTRAINT "ResellerOrderEarning_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerOrderEarning" ADD CONSTRAINT "ResellerOrderEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerOrderEarning" ADD CONSTRAINT "ResellerOrderEarning_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerCollectionChange" ADD CONSTRAINT "ResellerCollectionChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerCollectionChange" ADD CONSTRAINT "ResellerCollectionChange_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerPayout" ADD CONSTRAINT "ResellerPayout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerPayout" ADD CONSTRAINT "ResellerPayout_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerPayoutEntry" ADD CONSTRAINT "ResellerPayoutEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ResellerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerPayoutEntry" ADD CONSTRAINT "ResellerPayoutEntry_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ResellerLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerPayoutTransaction" ADD CONSTRAINT "ResellerPayoutTransaction_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ResellerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ogMediaId_fkey" FOREIGN KEY ("ogMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationMenu" ADD CONSTRAINT "NavigationMenu_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationMenuItem" ADD CONSTRAINT "NavigationMenuItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "NavigationMenu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationMenuItem" ADD CONSTRAINT "NavigationMenuItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NavigationMenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationMenuItem" ADD CONSTRAINT "NavigationMenuItem_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSecret" ADD CONSTRAINT "IntegrationSecret_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKeyScope" ADD CONSTRAINT "ApiKeyScope_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingIntegration" ADD CONSTRAINT "MarketingIntegration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingIntegration" ADD CONSTRAINT "MarketingIntegration_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_marketingIntegrationId_fkey" FOREIGN KEY ("marketingIntegrationId") REFERENCES "MarketingIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "Storefront"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plugin" ADD CONSTRAINT "Plugin_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Extra constraints and indexes maintained by the team

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

