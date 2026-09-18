import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";

/**
 * Typed access to business and storefront configuration.
 *
 * Settings are stored as key/value rows with JSON values so that new options can
 * be added without a migration, while the defaults and validation live here in
 * code (single source of truth, documented in docs/BUSINESS_RULES.md).
 */

export type SettingValueTypeName = "STRING" | "NUMBER" | "BOOLEAN" | "JSON";

export interface SettingDefinitionInput<T> {
  key: string;
  label: string;
  description: string;
  group: string;
  defaultValue: T;
  /** Overrides the value type inferred from the default value. */
  valueType?: SettingValueTypeName;
}

export interface SettingDefinition<T> extends SettingDefinitionInput<T> {
  valueType: SettingValueTypeName;
}

function inferValueType(value: unknown): SettingValueTypeName {
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "string") return "STRING";
  if (Array.isArray(value)) return "JSON";
  return "JSON";
}

function define<T>(definition: SettingDefinitionInput<T>): SettingDefinition<T> {
  return { ...definition, valueType: definition.valueType ?? inferValueType(definition.defaultValue) };
}

export const BUSINESS_SETTINGS = {
  orderPrefix: define({ key: "order.prefix", label: "Order number prefix", description: "Prefix used for generated order numbers.", group: "Orders", defaultValue: "ORD" }),
  orderRequireConfirmation: define({ key: "order.require_confirmation", label: "Require order confirmation", description: "New storefront orders start as PENDING and require staff confirmation.", group: "Orders", defaultValue: true }),
  orderAllowCustomerCancel: define({ key: "order.allow_customer_cancel", label: "Customers may cancel orders", description: "Customers can cancel eligible orders before dispatch.", group: "Orders", defaultValue: true }),
  orderAutoReserveStock: define({ key: "order.auto_reserve_stock", label: "Reserve stock on order", description: "Reserve physical stock automatically when an order is created.", group: "Orders", defaultValue: true }),
  orderPreorderEnabled: define({ key: "order.preorder_enabled", label: "Allow preorders", description: "Allow orders beyond available stock when a product allows preorder.", group: "Orders", defaultValue: true }),
  orderCodSurchargePaisa: define({ key: "order.cod_surcharge_paisa", label: "COD surcharge (paisa)", description: "Extra charge added to cash on delivery orders.", group: "Orders", defaultValue: 0 }),
  orderPackagingCostPaisa: define({ key: "order.packaging_cost_paisa", label: "Default packaging cost (paisa)", description: "Packaging cost applied per item when a product does not define its own.", group: "Orders", defaultValue: 0 }),
  exchangeWindowDays: define({ key: "exchange.window_days", label: "Exchange window (days)", description: "Number of calendar days after delivery during which an exchange can be requested.", group: "Exchanges", defaultValue: 7 }),
  exchangeDefaultDeliveryChargePaisa: define({ key: "exchange.default_delivery_charge_paisa", label: "Exchange delivery charge (paisa)", description: "Delivery charge applied to exchanges when the reason does not override it.", group: "Exchanges", defaultValue: 0 }),
  exchangeRestockRequiresInspection: define({ key: "exchange.restock_requires_inspection", label: "Inspection required before restock", description: "Returned items must be inspected before they can return to sellable stock.", group: "Exchanges", defaultValue: true }),
  inventoryLowStockThreshold: define({ key: "inventory.low_stock_threshold", label: "Low stock threshold", description: "Variants at or below this available quantity appear in low stock reports.", group: "Inventory", defaultValue: 5 }),
  inventoryValuationMethod: define({ key: "inventory.valuation_method", label: "Inventory valuation method", description: "Costing method used for inventory valuation.", group: "Inventory", defaultValue: "WEIGHTED_AVERAGE" }),
  resellerEarningsRequireSettlement: define({ key: "reseller.earnings_require_settlement", label: "Earnings require COD settlement", description: "Reseller earnings only become payable after the courier COD settlement is reconciled. Disabling this violates the documented policy.", group: "Resellers", defaultValue: true }),
  resellerDefaultCommissionType: define({ key: "reseller.default_commission_type", label: "Default commission type", description: "Commission model applied when a reseller does not define one.", group: "Resellers", defaultValue: "MARGIN_BASED" }),
  resellerPayoutMinimumPaisa: define({ key: "reseller.payout_minimum_paisa", label: "Minimum payout (paisa)", description: "Smallest payout that may be created for a reseller.", group: "Resellers", defaultValue: 0 }),
  reviewAutoApprove: define({ key: "review.auto_approve", label: "Auto approve reviews", description: "Publish verified purchase reviews without moderation.", group: "Reviews", defaultValue: false }),
  reviewMaxImages: define({ key: "review.max_images", label: "Maximum review images", description: "Maximum number of images per review.", group: "Reviews", defaultValue: 3 }),
  reviewMaxImageBytes: define({ key: "review.max_image_bytes", label: "Review image limit (bytes)", description: "Combined size limit for review images.", group: "Reviews", defaultValue: 50 * 1024 * 1024 }),
  notificationEmailEnabled: define({ key: "notification.email_enabled", label: "Email notifications", description: "Send email notifications for important events (requires SMTP configuration).", group: "Notifications", defaultValue: false }),
  financeCurrency: define({ key: "finance.currency", label: "Currency", description: "Business currency (ISO 4217).", group: "Finance", defaultValue: "BDT" }),
  financeCodChargeBps: define({ key: "finance.cod_charge_bps", label: "COD charge (bps)", description: "Default courier COD charge in basis points of the collected amount.", group: "Finance", defaultValue: 100 }),
} as const;

export const STOREFRONT_SETTINGS = {
  checkoutRequireEmail: define({ key: "checkout.require_email", label: "Require email", description: "Require an email address at checkout.", group: "Checkout", defaultValue: false }),
  checkoutRequireDistrict: define({ key: "checkout.require_district", label: "Require district", description: "Require a district at checkout.", group: "Checkout", defaultValue: true }),
  checkoutRequireAddress: define({ key: "checkout.require_address", label: "Require full address", description: "Require a full delivery address at checkout.", group: "Checkout", defaultValue: true }),
  checkoutShowPreorderBadge: define({ key: "checkout.show_preorder_badge", label: "Show preorder badge", description: "Display a preorder badge for items that are not in stock.", group: "Checkout", defaultValue: true }),
  storefrontAnnouncement: define({ key: "storefront.announcement", label: "Announcement bar", description: "Optional announcement shown at the top of the storefront.", group: "Appearance", defaultValue: "" }),
  storefrontPrimaryColor: define({ key: "storefront.primary_color", label: "Primary colour", description: "Storefront theme primary colour.", group: "Appearance", defaultValue: "#4f46e5" }),
} as const;

export type BusinessSettingKey = keyof typeof BUSINESS_SETTINGS;
export type StorefrontSettingKey = keyof typeof STOREFRONT_SETTINGS;

function defaultMap(definitions: Record<string, SettingDefinition<unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.values(definitions).map((definition) => [definition.key, definition.defaultValue]));
}

export async function getBusinessSettings(businessId: string): Promise<Record<string, unknown>> {
  const rows = await prisma.businessSetting.findMany({ where: { businessId }, select: { key: true, value: true } });
  const result = defaultMap(BUSINESS_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>);
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function getBusinessSetting<T = unknown>(businessId: string, key: string): Promise<T> {
  const definitions = BUSINESS_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>;
  const definition = Object.values(definitions).find((entry) => entry.key === key);
  const row = await prisma.businessSetting.findUnique({ where: { businessId_key: { businessId, key } } });
  return (row?.value ?? definition?.defaultValue) as T;
}

export async function setBusinessSetting(
  client: Prisma.TransactionClient | typeof prisma,
  input: { businessId: string; key: string; value: Prisma.InputJsonValue; updatedByUserId?: string | null },
): Promise<void> {
  await client.businessSetting.upsert({
    where: { businessId_key: { businessId: input.businessId, key: input.key } },
    create: {
      businessId: input.businessId,
      key: input.key,
      value: input.value,
      updatedByUserId: input.updatedByUserId ?? null,
    },
    update: { value: input.value, updatedByUserId: input.updatedByUserId ?? null },
  });
}

export async function getStorefrontSettings(storefrontId: string): Promise<Record<string, unknown>> {
  const rows = await prisma.storefrontSetting.findMany({ where: { storefrontId }, select: { key: true, value: true } });
  const result = defaultMap(STOREFRONT_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>);
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function setStorefrontSetting(
  client: Prisma.TransactionClient | typeof prisma,
  input: { storefrontId: string; key: string; value: Prisma.InputJsonValue; updatedByUserId?: string | null },
): Promise<void> {
  await client.storefrontSetting.upsert({
    where: { storefrontId_key: { storefrontId: input.storefrontId, key: input.key } },
    create: {
      storefrontId: input.storefrontId,
      key: input.key,
      value: input.value,
      updatedByUserId: input.updatedByUserId ?? null,
    },
    update: { value: input.value, updatedByUserId: input.updatedByUserId ?? null },
  });
}

export function settingDefinitionsForGroup(group: string): SettingDefinition<unknown>[] {
  const all = [
    ...Object.values(BUSINESS_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>),
    ...Object.values(STOREFRONT_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>),
  ];
  return all.filter((definition) => definition.group === group);
}

export function allSettingGroups(): string[] {
  const groups = new Set<string>();
  for (const definition of Object.values(BUSINESS_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>)) {
    groups.add(definition.group);
  }
  for (const definition of Object.values(STOREFRONT_SETTINGS as unknown as Record<string, SettingDefinition<unknown>>)) {
    groups.add(definition.group);
  }
  return [...groups].sort();
}
