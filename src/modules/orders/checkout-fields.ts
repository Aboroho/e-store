import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import type { OrderTypeValue } from "@/modules/orders/status";

/**
 * Checkout field configuration.
 *
 * One configurable definition per *customer-facing* field: phone, full name,
 * district, address, area and email. Internal courier instructions and internal
 * order notes are deliberately not configurable here — they are staff fields and
 * live on the order (`deliveryNotes` / `internalNote`).
 *
 * The same configuration drives:
 *   - the manual order creation screen (which fields are asked for, and which of
 *     them must be filled for the selected order type);
 *   - the storefront checkout form labels/required marks.
 *
 * Defaults match the behaviour the platform already had, so turning the editor on
 * never silently relaxes the public checkout.
 */

export const CHECKOUT_FIELD_KEYS = ["phone", "full_name", "district", "address", "area", "email"] as const;
export type CheckoutFieldKey = (typeof CHECKOUT_FIELD_KEYS)[number];

export interface CheckoutFieldDefinition {
  key: CheckoutFieldKey;
  label: string;
  helpText: string;
  defaultEnabled: boolean;
  /** Required for delivery-type orders unless the configuration says otherwise. */
  defaultRequiredForDelivery: boolean;
  /** Order types the field applies to. In-store orders never require anything. */
  appliesTo: OrderTypeValue[];
}

export const CHECKOUT_FIELD_DEFINITIONS: CheckoutFieldDefinition[] = [
  {
    key: "phone",
    label: "Phone number",
    helpText: "Bangladesh mobile number. Used for the saved-address lookup and for courier contact.",
    defaultEnabled: true,
    defaultRequiredForDelivery: true,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER", "IN_STORE"],
  },
  {
    key: "full_name",
    label: "Full name",
    helpText: "Recipient name printed on the courier label.",
    defaultEnabled: true,
    defaultRequiredForDelivery: true,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER", "IN_STORE"],
  },
  {
    key: "district",
    label: "District",
    helpText: "Drives the delivery zone, the delivery charge and the courier coverage check.",
    defaultEnabled: true,
    defaultRequiredForDelivery: true,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER"],
  },
  {
    key: "address",
    label: "Full address",
    helpText: "House, road, village or building — the customer-facing delivery address.",
    defaultEnabled: true,
    defaultRequiredForDelivery: true,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER"],
  },
  {
    key: "area",
    label: "Area / thana",
    helpText: "Optional locality that helps the rider find the address.",
    defaultEnabled: true,
    defaultRequiredForDelivery: false,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER", "IN_STORE"],
  },
  {
    key: "email",
    label: "Email",
    helpText: "Only used when the business collects it; never required for an in-store sale.",
    defaultEnabled: true,
    defaultRequiredForDelivery: false,
    appliesTo: ["ONLINE_DELIVERY", "PREORDER", "IN_STORE"],
  },
];

export interface ResolvedCheckoutField extends CheckoutFieldDefinition {
  id: string | null;
  isEnabled: boolean;
  isRequired: boolean;
  position: number;
  /** Label override stored by the administrator, when there is one. */
  customLabel: string | null;
  customHelpText: string | null;
  storefrontId: string | null;
}

/**
 * Merge the stored configuration over the code defaults. Missing rows fall back
 * to the documented defaults, so a fresh installation behaves like the platform
 * always did.
 */
export async function getCheckoutFields(businessId: string, storefrontId?: string | null): Promise<ResolvedCheckoutField[]> {
  const rows = await prisma.checkoutFieldConfig.findMany({
    where: { businessId, ...(storefrontId ? { OR: [{ storefrontId }, { storefrontId: null }] } : { storefrontId: null }) },
    orderBy: [{ storefrontId: "desc" }, { position: "asc" }],
  });

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    // A storefront-specific row wins over the business-wide row.
    const existing = byKey.get(row.fieldKey);
    if (!existing || (row.storefrontId && !existing.storefrontId)) byKey.set(row.fieldKey, row);
  }

  return CHECKOUT_FIELD_DEFINITIONS.map((definition, index) => {
    const row = byKey.get(definition.key);
    return {
      ...definition,
      id: row?.id ?? null,
      isEnabled: row?.isEnabled ?? definition.defaultEnabled,
      isRequired: row?.isRequired ?? definition.defaultRequiredForDelivery,
      position: row?.position ?? index,
      customLabel: row && row.label !== definition.label ? row.label : null,
      customHelpText: row?.helpText ?? null,
      storefrontId: row?.storefrontId ?? null,
    };
  }).sort((a, b) => a.position - b.position);
}

/** Which configured fields must be filled for a given order type. */
export function requiredFieldsFor(fields: ResolvedCheckoutField[], orderType: OrderTypeValue): CheckoutFieldKey[] {
  // In-store sales never force customer details: the counter sale is complete
  // without them (docs/BUSINESS_RULES.md → "In-store orders").
  if (orderType === "IN_STORE") return [];
  return fields
    .filter((field) => field.isEnabled && field.isRequired && field.appliesTo.includes(orderType))
    .map((field) => field.key);
}

export interface CheckoutFieldSaveInput {
  fieldKey: CheckoutFieldKey;
  label?: string;
  isEnabled: boolean;
  isRequired: boolean;
  position?: number;
  helpText?: string | null;
  storefrontId?: string | null;
}

export async function saveCheckoutField(
  actor: { businessId: string; userId: string | null; permissions: ReadonlySet<string>; isOwner?: boolean },
  input: CheckoutFieldSaveInput,
): Promise<ResolvedCheckoutField[]> {
  const definition = CHECKOUT_FIELD_DEFINITIONS.find((entry) => entry.key === input.fieldKey);
  if (!definition) throw AppError.validation(`Unknown checkout field: ${input.fieldKey}`);
  if (!(actor.isOwner || actor.permissions.has("checkout_fields.manage") || actor.permissions.has("*"))) {
    throw AppError.forbidden("You are not allowed to change the checkout fields");
  }

  const isRequired = input.isEnabled && input.isRequired;
  const label = input.label?.trim() || definition.label;
  const helpText = input.helpText?.trim() || null;
  const position = input.position ?? CHECKOUT_FIELD_DEFINITIONS.indexOf(definition);
  const storefrontId = input.storefrontId ?? null;

  // `storefrontId` is nullable, and PostgreSQL treats NULLs as distinct in a
  // unique index, so the row is matched explicitly instead of relying on upsert.
  const existing = await prisma.checkoutFieldConfig.findFirst({
    where: { businessId: actor.businessId, storefrontId, fieldKey: input.fieldKey },
    select: { id: true },
  });
  if (existing) {
    await prisma.checkoutFieldConfig.update({
      where: { id: existing.id },
      data: { label, isEnabled: input.isEnabled, isRequired, position, helpText },
    });
  } else {
    await prisma.checkoutFieldConfig.create({
      data: {
        businessId: actor.businessId,
        storefrontId,
        fieldKey: input.fieldKey,
        label,
        isEnabled: input.isEnabled,
        isRequired,
        position,
        helpText,
      },
    });
  }

  await recordAudit({
    businessId: actor.businessId,
    actorType: "USER",
    actorUserId: actor.userId,
    action: "checkout_field.updated",
    entityType: "CheckoutFieldConfig",
    entityId: input.fieldKey,
    summary: `Checkout field ${input.fieldKey}: ${isRequired ? "required" : input.isEnabled ? "optional" : "disabled"}`,
    after: { fieldKey: input.fieldKey, isEnabled: input.isEnabled, isRequired, storefrontId: input.storefrontId ?? null },
    changedFields: ["isEnabled", "isRequired", "label"],
  });

  return getCheckoutFields(actor.businessId, input.storefrontId ?? null);
}
