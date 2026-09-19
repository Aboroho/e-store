import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import { getMediaAssetsByIds, replaceSingleEntityUsage, syncUsageCountsTx } from "@/modules/media/service";

/**
 * Canonical brands with shared-media logos.
 *
 * Products keep a free-text brand name (flexible at entry time); the Brand
 * registry holds the canonical logo as a media reference (logoMediaId + a
 * BRAND MediaUsage). Displays resolve the logo by exact, case-insensitive
 * brand-name match, so one logo file serves every product of that brand.
 */

export interface BrandActor {
  userId: string;
  businessId: string;
  actorLabel: string;
}

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the brand name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower case letters, numbers and dashes")
    .optional(),
  description: z.string().trim().max(500).optional(),
  website: z.string().trim().max(300).optional(),
  logoMediaId: z.string().uuid().nullable().optional(),
  position: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});

export type BrandInput = z.infer<typeof brandInputSchema>;

export interface BrandView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  logoMediaId: string | null;
  logoUrl: string | null;
  logoAlt: string | null;
  position: number;
  isActive: boolean;
}

export async function listBrands(businessId: string): Promise<BrandView[]> {
  const brands = await prisma.brand.findMany({
    where: { businessId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  const logoIds = [...new Set(brands.map((brand) => brand.logoMediaId).filter((id): id is string => Boolean(id)))];
  const logos = logoIds.length > 0 ? await getMediaAssetsByIds(businessId, logoIds) : [];
  const byId = new Map(logos.map((asset) => [asset.id, asset]));
  return brands.map((brand) => {
    const logo = brand.logoMediaId ? byId.get(brand.logoMediaId) : undefined;
    return {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      description: brand.description,
      website: brand.website,
      logoMediaId: brand.logoMediaId,
      logoUrl: logo?.url ?? null,
      logoAlt: logo ? (logo.altText ?? logo.title ?? logo.originalName) : null,
      position: brand.position,
      isActive: brand.isActive,
    };
  });
}

/** Resolve canonical logos for free-text product brand names (exact match). */
export async function resolveBrandLogos(businessId: string, names: string[]): Promise<Map<string, { url: string | null; alt: string }>> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const result = new Map<string, { url: string | null; alt: string }>();
  if (unique.length === 0) return result;
  const brands = await prisma.brand.findMany({
    where: { businessId, name: { in: unique, mode: "insensitive" }, isActive: true },
    select: { name: true, logoMediaId: true },
  });
  const logoIds = [...new Set(brands.map((brand) => brand.logoMediaId).filter((id): id is string => Boolean(id)))];
  const logos = logoIds.length > 0 ? await getMediaAssetsByIds(businessId, logoIds) : [];
  const byId = new Map(logos.map((asset) => [asset.id, asset]));
  for (const brand of brands) {
    const logo = brand.logoMediaId ? byId.get(brand.logoMediaId) : undefined;
    result.set(brand.name.toLowerCase(), { url: logo?.url ?? null, alt: logo ? (logo.altText ?? brand.name) : brand.name });
  }
  return result;
}

async function uniqueBrandSlug(tx: Parameters<Parameters<typeof withTransaction>[0]>[0], businessId: string, desired: string): Promise<string> {
  let candidate = desired || "brand";
  let suffix = 2;
  for (;;) {
    const existing = await tx.brand.findFirst({ where: { businessId, slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${desired}-${suffix}`;
    suffix += 1;
    if (suffix > 200) throw AppError.conflict("Unable to generate a unique slug");
  }
}

export async function createBrand(actor: BrandActor, input: BrandInput) {
  return withTransaction(async (tx) => {
    const slug = await uniqueBrandSlug(tx, actor.businessId, input.slug ?? slugify(input.name));
    const brand = await tx.brand.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug,
        description: input.description ?? null,
        website: input.website ?? null,
        logoMediaId: input.logoMediaId ?? null,
        position: input.position,
        isActive: input.isActive,
      },
    });
    if (input.logoMediaId) {
      await replaceSingleEntityUsage(tx, actor.businessId, { entityType: "BRAND", entityId: brand.id, field: "logo" }, input.logoMediaId);
    }
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "brand.created",
        entityType: "Brand",
        entityId: brand.id,
        summary: `Created brand ${brand.name}`,
        changedFields: ["brand"],
      },
    });
    return brand;
  });
}

export async function updateBrand(actor: BrandActor, brandId: string, input: Partial<BrandInput>) {
  return withTransaction(async (tx) => {
    const brand = await tx.brand.findFirst({ where: { id: brandId, businessId: actor.businessId } });
    if (!brand) throw AppError.notFound("Brand not found");
    const slug = input.slug && input.slug !== brand.slug ? await uniqueBrandSlug(tx, actor.businessId, input.slug) : undefined;
    const updated = await tx.brand.update({
      where: { id: brandId },
      data: {
        name: input.name ?? undefined,
        slug,
        description: input.description !== undefined ? input.description || null : undefined,
        website: input.website !== undefined ? input.website || null : undefined,
        logoMediaId: input.logoMediaId !== undefined ? input.logoMediaId : undefined,
        position: input.position ?? undefined,
        isActive: input.isActive ?? undefined,
      },
    });
    if (input.logoMediaId !== undefined) {
      await replaceSingleEntityUsage(tx, actor.businessId, { entityType: "BRAND", entityId: brandId, field: "logo" }, input.logoMediaId);
    }
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "brand.updated",
        entityType: "Brand",
        entityId: brandId,
        summary: `Updated brand ${updated.name}`,
        changedFields: Object.keys(input),
      },
    });
    return updated;
  });
}

export async function deleteBrand(actor: BrandActor, brandId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const brand = await tx.brand.findFirst({ where: { id: brandId, businessId: actor.businessId } });
    if (!brand) throw AppError.notFound("Brand not found");
    // Products reference brands by free text, so deleting a brand never touches
    // products — only its logo usage is released. The asset stays in the library.
    const usages = await tx.mediaUsage.findMany({ where: { entityType: "BRAND", entityId: brandId }, select: { mediaId: true } });
    await tx.mediaUsage.deleteMany({ where: { entityType: "BRAND", entityId: brandId } });
    await tx.brand.delete({ where: { id: brandId } });
    await syncUsageCountsTx(tx, usages.map((usage) => usage.mediaId));
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "brand.deleted",
        entityType: "Brand",
        entityId: brandId,
        summary: `Deleted brand ${brand.name}`,
        changedFields: ["brand"],
      },
    });
  });
}
