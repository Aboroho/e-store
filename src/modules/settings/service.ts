import "server-only";
import { replaceMediaReferences } from "@/modules/media/references";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import {
  BUSINESS_SETTINGS,
  STOREFRONT_SETTINGS,
  getBusinessSettings,
  getStorefrontSettings,
  type SettingDefinition,
} from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Settings service.
 *
 * Definitions live in `src/lib/settings.ts` (typed defaults in code); overrides
 * are stored per business / per storefront. Unknown keys are rejected so that a
 * typo can never silently create a setting nobody reads.
 */

export interface SettingGroup {
  group: string;
  items: Array<SettingDefinition<unknown> & { value: unknown }>;
}

function toGroups(
  definitions: SettingDefinition<unknown>[],
  values: Record<string, unknown>,
): SettingGroup[] {
  const groups = new Map<string, SettingGroup>();
  for (const definition of definitions) {
    const entry = groups.get(definition.group) ?? { group: definition.group, items: [] };
    entry.items.push({ ...definition, value: values[definition.key] ?? definition.defaultValue });
    groups.set(definition.group, entry);
  }
  return [...groups.values()];
}

export async function businessSettingGroups(businessId: string): Promise<SettingGroup[]> {
  const stored = await getBusinessSettings(businessId);
  return toGroups(Object.values(BUSINESS_SETTINGS), stored);
}

export async function storefrontSettingGroups(storefrontId: string): Promise<SettingGroup[]> {
  const stored = await getStorefrontSettings(storefrontId);
  return toGroups(Object.values(STOREFRONT_SETTINGS), stored);
}

function findBusinessDefinition(key: string): SettingDefinition<unknown> | undefined {
  return Object.values(BUSINESS_SETTINGS).find((definition) => definition.key === key);
}

function findStorefrontDefinition(key: string): SettingDefinition<unknown> | undefined {
  return Object.values(STOREFRONT_SETTINGS).find((definition) => definition.key === key);
}

function coerce(definition: SettingDefinition<unknown>, raw: string): unknown {
  const defaultValue = definition.defaultValue;
  if (typeof defaultValue === "boolean") {
    return raw === "true" || raw === "on" || raw === "1";
  }
  if (typeof defaultValue === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw AppError.validation(`"${definition.label}" must be a number`);
    }
    if (definition.key.includes("paisa") || definition.key.includes("bytes")) {
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw AppError.validation(`"${definition.label}" must be a whole number of paisa/bytes`);
      }
    }
    if (definition.key === "exchange.window_days" && (parsed < 0 || parsed > 365)) {
      throw AppError.validation("Exchange window must be between 0 and 365 days");
    }
    if (definition.key === "review.max_images" && (parsed < 0 || parsed > 10)) {
      throw AppError.validation("Review images must be between 0 and 10");
    }
    if (definition.key === "finance.cod_charge_bps" && (parsed < 0 || parsed > 10_000)) {
      throw AppError.validation("COD charge must be between 0 and 10000 basis points");
    }
    if (definition.key === "inventory.low_stock_threshold" && parsed < 0) {
      throw AppError.validation("Low stock threshold cannot be negative");
    }
    return parsed;
  }
  // String settings
  const value = raw;
  if (definition.key === "finance.currency" && !/^[A-Z]{3}$/.test(value)) {
    throw AppError.validation("Currency must be a three letter ISO 4217 code, for example BDT");
  }
  if (definition.key === "storefront.primary_color" && value && !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw AppError.validation("Primary colour must be a hex value such as #4f46e5");
  }
  if (definition.key === "order.prefix" && value && !/^[A-Za-z0-9-]{1,8}$/.test(value)) {
    throw AppError.validation("Order prefix must be 1-8 letters, numbers or dashes");
  }
  if (definition.key === "inventory.valuation_method" && !["WEIGHTED_AVERAGE", "FIFO"].includes(value)) {
    throw AppError.validation("Valuation method must be WEIGHTED_AVERAGE or FIFO");
  }
  if (definition.key === "reseller.default_commission_type" && !["MARGIN_BASED", "COMMISSION_BASED"].includes(value)) {
    throw AppError.validation("Commission type must be MARGIN_BASED or COMMISSION_BASED");
  }
  return value;
}

export async function updateBusinessSettings(
  actor: { userId: string; businessId: string; actorLabel: string },
  values: Record<string, string>,
): Promise<string[]> {
  const updates: Array<{ key: string; value: unknown; definition: SettingDefinition<unknown> }> = [];

  for (const [key, raw] of Object.entries(values)) {
    const definition = findBusinessDefinition(key);
    if (!definition) throw AppError.validation(`Unknown setting "${key}"`);
    updates.push({ key, value: coerce(definition, raw), definition });
  }
  if (updates.length === 0) return [];

  const before = await getBusinessSettings(actor.businessId);

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const jsonValue = update.value as Prisma.InputJsonValue;
      await tx.businessSetting.upsert({
        where: { businessId_key: { businessId: actor.businessId, key: update.key } },
        create: {
          businessId: actor.businessId,
          key: update.key,
          value: jsonValue,
          valueType: update.definition.valueType,
          description: update.definition.description,
          updatedByUserId: actor.userId,
        },
        update: { value: jsonValue, valueType: update.definition.valueType, updatedByUserId: actor.userId },
      });
    }
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorType: "USER",
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "settings.business_updated",
        entityType: "BusinessSetting",
        entityId: actor.businessId,
        summary: `Updated ${updates.length} business setting(s)`,
        before: Object.fromEntries(
          updates.map((update) => [update.key, before[update.key] ?? update.definition.defaultValue]),
        ) as Prisma.InputJsonValue,
        after: Object.fromEntries(updates.map((update) => [update.key, update.value])) as Prisma.InputJsonValue,
        changedFields: updates.map((update) => update.key),
      },
    });
  });

  return updates.map((update) => update.key);
}

export async function updateStorefrontSettings(
  actor: { userId: string; businessId: string; actorLabel: string },
  storefrontId: string,
  values: Record<string, string>,
): Promise<string[]> {
  const storefront = await prisma.storefront.findFirst({
    where: { id: storefrontId, businessId: actor.businessId },
    select: { id: true, name: true },
  });
  if (!storefront) throw AppError.notFound("Storefront not found");

  const updates: Array<{ key: string; value: unknown; definition: SettingDefinition<unknown> }> = [];
  for (const [key, raw] of Object.entries(values)) {
    const definition = findStorefrontDefinition(key);
    if (!definition) throw AppError.validation(`Unknown storefront setting "${key}"`);
    updates.push({ key, value: coerce(definition, raw), definition });
  }
  if (updates.length === 0) return [];

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      const jsonValue = update.value as Prisma.InputJsonValue;
      await tx.storefrontSetting.upsert({
        where: { storefrontId_key: { storefrontId, key: update.key } },
        create: {
          storefrontId,
          key: update.key,
          value: jsonValue,
          valueType: update.definition.valueType,
          updatedByUserId: actor.userId,
        },
        update: { value: jsonValue, valueType: update.definition.valueType, updatedByUserId: actor.userId },
      });
    }
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "settings.storefront_updated",
        entityType: "Storefront",
        entityId: storefrontId,
        summary: `Updated ${updates.length} storefront setting(s) for ${storefront.name}`,
        after: Object.fromEntries(updates.map((update) => [update.key, update.value])) as Prisma.InputJsonValue,
        changedFields: updates.map((update) => update.key),
      },
    });
  });

  return updates.map((update) => update.key);
}

export async function updateBusinessProfile(
  actor: { userId: string; businessId: string; actorLabel: string },
  input: { logoMediaId?: string | null; name: string; legalName?: string; phone?: string; email?: string; address?: string; currency?: string },
) {
  const before = await prisma.business.findUnique({
    where: { id: actor.businessId },
    select: { name: true, legalName: true, phone: true, email: true, address: true, currency: true },
  });
  if (!before) throw AppError.notFound("Business not found");

  const updated = await prisma.$transaction(async (tx) => {
    if (input.logoMediaId !== undefined) await replaceMediaReferences(tx, actor.businessId, "BUSINESS", actor.businessId, "logo", input.logoMediaId ? [input.logoMediaId] : [], { imagesOnly: true, publicOnly: true });
    const result = await tx.business.update({
      where: { id: actor.businessId },
      data: {
        name: input.name,
        logoMediaId: input.logoMediaId,
        legalName: input.legalName || null,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
        ...(input.currency ? { currency: input.currency } : {}),
      },
      select: { id: true, name: true },
    });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "settings.business_profile_updated",
        entityType: "Business",
        entityId: actor.businessId,
        summary: "Updated business profile",
        before,
        after: { ...input },
        changedFields: ["businessProfile"],
      },
    });
    return result;
  });

  return updated;
}
