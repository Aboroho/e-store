import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { getBusinessSettings } from "@/lib/settings";
import { holdsPermission } from "@/modules/orders/status";
import { statusActorFrom, type ManualOrderContext } from "@/modules/orders/manual";

/**
 * Order list column configuration.
 *
 * Columns are declared once here with the permission they need, so "what can this
 * user see" and "what does this user get" can never disagree. Precedence is
 * explicit and documented:
 *
 *   1. the user's own saved preference (`OrderListColumnPreference`);
 *   2. the business default chosen by an administrator
 *      (setting `order.list_default_columns`);
 *   3. the built-in default below.
 *
 * Whichever list wins is then filtered down to the columns the user is actually
 * allowed to see, the mandatory columns are re-added and duplicates are removed —
 * a preference can never widen a user's visibility.
 */

export type OrderColumnKey =
  | "order"
  | "customer"
  | "phone"
  | "type"
  | "status"
  | "courier"
  | "items"
  | "district"
  | "channel"
  | "subtotal"
  | "discount"
  | "delivery"
  | "total"
  | "collectible"
  | "paid"
  | "due"
  | "cost"
  | "profit"
  | "creator"
  | "reseller"
  | "created"
  | "actions";

export interface OrderColumnDefinition {
  key: OrderColumnKey;
  label: string;
  /** Help text shown in the column picker. */
  hint?: string;
  /** Always present, cannot be switched off. */
  mandatory?: boolean;
  /** Permission the viewer needs; `order.view_cost` hides money-from-cost columns. */
  requires?: string;
  /** Right-aligned numeric columns. */
  align?: "left" | "right";
  /** Hidden on narrow screens unless explicitly enabled. */
  compact?: boolean;
}

export const ORDER_COLUMNS: OrderColumnDefinition[] = [
  { key: "order", label: "Order", hint: "Order number and the channel it came from", mandatory: true },
  { key: "customer", label: "Customer", hint: "Name on the order" },
  { key: "phone", label: "Phone", hint: "Customer phone, copyable" },
  { key: "type", label: "Type", hint: "Online delivery, in-store or pre-order" },
  { key: "status", label: "Status", hint: "Internal status plus the courier's own status", mandatory: true },
  { key: "courier", label: "Courier", hint: "Courier, consignment and tracking code" },
  { key: "items", label: "Items", hint: "Number of lines and units", align: "right" },
  { key: "district", label: "District", hint: "Shipping district", compact: true },
  { key: "channel", label: "Channel", hint: "Storefront, admin, reseller, in-store or API", compact: true },
  { key: "subtotal", label: "Items total", hint: "Sum of the line totals before discounts", align: "right", compact: true },
  { key: "discount", label: "Discount", hint: "Item and order level discounts applied", align: "right", compact: true },
  { key: "delivery", label: "Delivery", hint: "Delivery charge actually charged", align: "right", compact: true },
  { key: "total", label: "Grand total", hint: "What the order is worth", align: "right" },
  { key: "collectible", label: "Collectible", hint: "Cash the courier or counter must collect", align: "right" },
  { key: "paid", label: "Paid", hint: "Amount already collected", align: "right", compact: true },
  { key: "due", label: "Due", hint: "Outstanding amount", align: "right", compact: true },
  { key: "cost", label: "Cost", hint: "Inventory cost of the order", align: "right", requires: "order.view_cost", compact: true },
  { key: "profit", label: "Profit", hint: "Grand total minus inventory cost", align: "right", requires: "order.view_cost", compact: true },
  { key: "creator", label: "Created by", hint: "Who created the order and with which role", requires: "order.view_all" },
  { key: "reseller", label: "Reseller", hint: "Reseller the order belongs to", requires: "order.view_all", compact: true },
  { key: "created", label: "Created", hint: "When the order was placed" },
  { key: "actions", label: "Actions", hint: "Open, copy, dispatch and status actions", mandatory: true },
];

export const ORDER_COLUMN_KEYS = ORDER_COLUMNS.map((column) => column.key);

export const MANDATORY_ORDER_COLUMNS: OrderColumnKey[] = ORDER_COLUMNS.filter((column) => column.mandatory).map(
  (column) => column.key,
);

/** Fallback used when neither the user nor the business configured anything. */
export const DEFAULT_ORDER_COLUMNS: OrderColumnKey[] = [
  "order",
  "customer",
  "phone",
  "type",
  "status",
  "collectible",
  "created",
  "actions",
];

export const ORDER_COLUMN_SCOPE = "ADMIN_ORDER_LIST";

export function columnDefinition(key: string): OrderColumnDefinition | undefined {
  return ORDER_COLUMNS.find((column) => column.key === key);
}

/** Columns this actor may see at all, given their permissions. */
export function allowedOrderColumns(context: ManualOrderContext): OrderColumnDefinition[] {
  const actor = statusActorFrom(context);
  return ORDER_COLUMNS.filter((column) => !column.requires || holdsPermission(actor, column.requires));
}

function normalize(columns: unknown, allowed: Set<string>): OrderColumnKey[] {
  const list = Array.isArray(columns) ? columns : [];
  const seen = new Set<string>();
  const result: OrderColumnKey[] = [];
  for (const value of list) {
    const key = typeof value === "string" ? value.trim() : "";
    if (!key || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key as OrderColumnKey);
  }
  // Mandatory columns always come first so the row is identifiable and actionable.
  for (const key of MANDATORY_ORDER_COLUMNS) {
    if (!seen.has(key)) {
      result.unshift(key);
      seen.add(key);
    }
  }
  return result;
}

export interface ResolvedOrderColumns {
  columns: OrderColumnKey[];
  definitions: OrderColumnDefinition[];
  /** Which source won: the user's own list, the business default or the fallback. */
  source: "user" | "business" | "default";
  /** Everything the user may pick from in the column editor. */
  available: OrderColumnDefinition[];
  mayManage: boolean;
}

/** Resolve the effective columns for one user on the order list screen. */
export async function resolveOrderColumns(context: ManualOrderContext): Promise<ResolvedOrderColumns> {
  const available = allowedOrderColumns(context);
  const allowed = new Set(available.map((column) => column.key as string));
  const actor = statusActorFrom(context);

  const [preference, settings] = await Promise.all([
    prisma.orderListColumnPreference.findUnique({
      where: {
        businessId_userId_scope: { businessId: context.businessId, userId: context.userId, scope: ORDER_COLUMN_SCOPE },
      },
      select: { columns: true },
    }),
    getBusinessSettings(context.businessId),
  ]);

  let columns = normalize(preference?.columns, allowed);
  let source: ResolvedOrderColumns["source"] = "user";
  if (columns.length === 0) {
    columns = normalize(settings["order.list_default_columns"], allowed);
    source = "business";
  }
  if (columns.length === 0) {
    columns = normalize(DEFAULT_ORDER_COLUMNS, allowed);
    source = "default";
  }

  return {
    columns,
    definitions: columns.map((key) => columnDefinition(key)).filter((entry): entry is OrderColumnDefinition => Boolean(entry)),
    source,
    available,
    mayManage: holdsPermission(actor, "order.columns.manage"),
  };
}

/** Save the signed-in user's own column preference. */
export async function saveOrderColumns(
  context: ManualOrderContext,
  columns: string[],
): Promise<ResolvedOrderColumns> {
  const actor = statusActorFrom(context);
  if (!holdsPermission(actor, "order.columns.manage")) {
    throw AppError.forbidden("You are not allowed to change the order list columns");
  }

  const available = allowedOrderColumns(context);
  const allowed = new Set(available.map((column) => column.key as string));
  const rejected = columns.filter((key) => key && !allowed.has(key));
  if (rejected.length > 0) {
    throw AppError.validation(
      `You cannot show ${rejected.map((key) => columnDefinition(key)?.label ?? key).join(", ")} with your current permissions`,
    );
  }

  const next = normalize(columns, allowed);
  if (next.length === 0) throw AppError.validation("Choose at least one column");

  const existing = await prisma.orderListColumnPreference.findUnique({
    where: {
      businessId_userId_scope: { businessId: context.businessId, userId: context.userId, scope: ORDER_COLUMN_SCOPE },
    },
    select: { id: true, columns: true },
  });

  if (existing) {
    await prisma.orderListColumnPreference.update({ where: { id: existing.id }, data: { columns: next } });
  } else {
    await prisma.orderListColumnPreference.create({
      data: { businessId: context.businessId, userId: context.userId, scope: ORDER_COLUMN_SCOPE, columns: next },
    });
  }

  await recordAudit({
    businessId: context.businessId,
    actorType: "USER",
    actorUserId: context.userId,
    actorLabel: context.actorLabel,
    action: "order.columns.updated",
    entityType: "OrderListColumnPreference",
    summary: `Order list columns updated (${next.length} columns)`,
    before: { columns: existing?.columns ?? [] } as unknown as Prisma.InputJsonValue,
    after: { columns: next } as unknown as Prisma.InputJsonValue,
    ipAddress: context.ipAddress ?? null,
  });

  return resolveOrderColumns(context);
}
