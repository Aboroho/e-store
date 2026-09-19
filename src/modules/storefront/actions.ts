"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/actions";

/**
 * Storefront administration actions.
 *
 * Storefronts share the catalogue, customers and inventory of the business — only the
 * presentation (theme, domains, navigation, pages) and the price list differ. No
 * storefront ever gets its own stock.
 */

async function actor() {
  const session = await requireSession();
  assertPermission(session, "storefront.manage");
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries((error.details as Array<{ path?: (string | number)[]; message?: string }>).map((issue) => [(issue.path ?? []).join(".") || "_", [issue.message ?? "Invalid value"]]))
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Storefront action failed", error);
  return { status: "error", message: fallback };
}

const storefrontInput = z.object({
  storefrontId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower case letters, numbers and dashes"),
  description: z.string().trim().max(500).optional(),
  supportPhone: z.string().trim().max(30).optional(),
  supportEmail: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
  addressLine: z.string().trim().max(240).optional(),
  themeKey: z.string().trim().max(40).default("default"),
  primaryColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  accentColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  codEnabled: z.coerce.boolean().default(true),
  preorderEnabled: z.coerce.boolean().default(true),
});

export async function updateStorefrontAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const value = (key: string) => {
      const entry = raw[key];
      return Array.isArray(entry) ? entry[0] : entry;
    };
    const input = storefrontInput.parse({
      storefrontId: value("storefrontId"),
      name: value("name"),
      slug: value("slug"),
      description: value("description") || undefined,
      supportPhone: value("supportPhone") || undefined,
      supportEmail: value("supportEmail") || "",
      addressLine: value("addressLine") || undefined,
      themeKey: value("themeKey") || "default",
      primaryColor: value("primaryColor") || "",
      accentColor: value("accentColor") || "",
      codEnabled: value("codEnabled") === "true",
      preorderEnabled: value("preorderEnabled") === "true",
    });

    const current = await prisma.storefront.findFirst({ where: { id: input.storefrontId, businessId: context.businessId } });
    if (!current) throw AppError.notFound("Storefront not found");

    if (input.slug !== current.slug) {
      const clash = await prisma.storefront.findFirst({ where: { slug: input.slug, id: { not: current.id } } });
      if (clash) throw AppError.conflict("That slug is already used by another storefront");
    }

    const themeConfig = {
      ...((current.themeConfig as Record<string, unknown> | null) ?? {}),
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    };

    await prisma.storefront.update({
      where: { id: current.id },
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        supportPhone: input.supportPhone ?? null,
        supportEmail: input.supportEmail || null,
        addressLine: input.addressLine ?? null,
        themeKey: input.themeKey,
        themeConfig: themeConfig as never,
        codEnabled: input.codEnabled,
        preorderEnabled: input.preorderEnabled,
      },
    });

    await recordAudit({
      businessId: context.businessId,
      actorUserId: context.userId,
      actorLabel: context.actorLabel,
      entityType: "Storefront",
      entityId: current.id,
      action: "storefront.updated",
      summary: `Updated storefront ${input.name}`,
    });

    revalidatePath("/admin/storefronts");
    revalidatePath(`/admin/storefronts/${current.id}`);
    revalidatePath("/", "layout");
    return { status: "success", message: "Storefront saved" };
  } catch (error) {
    return toState(error, "Unable to save the storefront");
  }
}

export async function addDomainAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const storefrontId = String(raw.storefrontId ?? "");
    const host = String(raw.host ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw AppError.validation("Enter a hostname such as shop.example.com");
    const existing = await prisma.storefrontDomain.findFirst({ where: { host } });
    if (existing) throw AppError.conflict("That domain is already registered");

    const storefront = await prisma.storefront.findFirst({ where: { id: storefrontId, businessId: context.businessId } });
    if (!storefront) throw AppError.notFound("Storefront not found");

    const count = await prisma.storefrontDomain.count({ where: { storefrontId } });
    await prisma.storefrontDomain.create({
      data: { storefrontId, host, isPrimary: count === 0, status: "PENDING", verificationToken: Math.random().toString(36).slice(2, 12) },
    });

    await recordAudit({
      businessId: context.businessId,
      actorUserId: context.userId,
      actorLabel: context.actorLabel,
      entityType: "Storefront",
      entityId: storefrontId,
      action: "storefront.domain_added",
      summary: `Added domain ${host}`,
    });

    revalidatePath(`/admin/storefronts/${storefrontId}`);
    return { status: "success", message: `${host} added — point its DNS at this server and mark it verified once live` };
  } catch (error) {
    return toState(error, "Unable to add the domain");
  }
}

export async function verifyDomainAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const domainId = String(raw.domainId ?? "");
    const domain = await prisma.storefrontDomain.findFirst({ where: { id: domainId, storefront: { businessId: context.businessId } } });
    if (!domain) throw AppError.notFound("Domain not found");

    const updated = await prisma.storefrontDomain.update({
      where: { id: domain.id },
      data: { status: "VERIFIED", verifiedAt: new Date(), lastCheckedAt: new Date() },
    });

    await recordAudit({
      businessId: context.businessId,
      actorUserId: context.userId,
      actorLabel: context.actorLabel,
      entityType: "Storefront",
      entityId: updated.storefrontId,
      action: "storefront.domain_verified",
      summary: `Marked ${updated.host} as active`,
    });

    revalidatePath(`/admin/storefronts/${updated.storefrontId}`);
    return { status: "success", message: `${updated.host} is now serving the storefront` };
  } catch (error) {
    return toState(error, "Unable to verify the domain");
  }
}

export async function createMenuAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const storefrontId = String(raw.storefrontId ?? "");
    const handle = String(raw.handle ?? "").trim().toLowerCase();
    const name = String(raw.name ?? "").trim() || handle;

    if (!/^[a-z0-9-]{1,40}$/.test(handle)) throw AppError.validation("Menu handle must be lower case letters, numbers or dashes");
    const storefront = await prisma.storefront.findFirst({ where: { id: storefrontId, businessId: context.businessId } });
    if (!storefront) throw AppError.notFound("Storefront not found");

    const existing = await prisma.navigationMenu.findFirst({ where: { storefrontId, handle } });
    if (existing) throw AppError.conflict("That menu handle already exists");

    await prisma.navigationMenu.create({ data: { storefrontId, handle, name } });
    revalidatePath(`/admin/storefronts/${storefrontId}`);
    revalidatePath("/", "layout");
    return { status: "success", message: `Menu "${name}" created` };
  } catch (error) {
    return toState(error, "Unable to create the menu");
  }
}

const navItemSchema = z
  .object({
    menuId: z.string().uuid(),
    label: z.string().trim().min(1).max(60),
    type: z.enum(["URL", "PAGE", "CATEGORY", "PRODUCT"]).default("URL"),
    url: z
      .string()
      .trim()
      .max(400)
      .refine((value) => value === "" || value.startsWith("/") || /^https?:\/\//.test(value), { message: "Links must start with / or http(s)://" }),
    openInNewTab: z.coerce.boolean().default(false),
  })
  .refine((value) => value.type !== "URL" || value.url.length > 0, { message: "Enter a URL", path: ["url"] });

export async function addNavigationItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const value = (key: string) => {
      const entry = raw[key];
      return Array.isArray(entry) ? entry[0] : entry;
    };
    const input = navItemSchema.parse({
      menuId: value("menuId"),
      label: value("label"),
      type: value("type") ?? "URL",
      url: value("url") ?? "",
      openInNewTab: value("openInNewTab") === "true",
    });

    const menu = await prisma.navigationMenu.findFirst({ where: { id: input.menuId, storefront: { businessId: context.businessId } } });
    if (!menu) throw AppError.notFound("Menu not found");

    const position = await prisma.navigationMenuItem.count({ where: { menuId: menu.id } });
    await prisma.navigationMenuItem.create({
      data: {
        menuId: menu.id,
        label: input.label,
        type: input.type,
        url: input.type === "URL" ? input.url : null,
        position,
        openInNewTab: input.openInNewTab,
      },
    });

    revalidatePath(`/admin/storefronts/${menu.storefrontId}`);
    revalidatePath("/", "layout");
    return { status: "success", message: `"${input.label}" added` };
  } catch (error) {
    return toState(error, "Unable to add the navigation item");
  }
}
