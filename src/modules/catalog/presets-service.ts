import "server-only";
import { prisma, withTransaction } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/utils";
import type { BrandInput, LabelInput, PackagingCostTemplateInput, TaxRateInput, UnitLabelInput } from "@/modules/catalog/product-schemas";
import type { CatalogActor } from "@/modules/catalog/service";

/* -------------------------------------------------------------------------- */
/* Tax Rates                                                                  */
/* -------------------------------------------------------------------------- */

export async function listTaxRates(businessId: string) {
  return prisma.taxRate.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { rateBps: "asc" }, { name: "asc" }],
  });
}

export async function createTaxRate(actor: CatalogActor, input: TaxRateInput) {
  return withTransaction(async (tx) => {
    const existing = await tx.taxRate.findFirst({
      where: { businessId: actor.businessId, name: { equals: input.name.trim(), mode: "insensitive" } },
    });
    if (existing) throw AppError.conflict(`A tax rate named "${input.name.trim()}" already exists`);

    if (input.isDefault) {
      await tx.taxRate.updateMany({
        where: { businessId: actor.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.taxRate.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        rateBps: input.rateBps,
        isDefault: input.isDefault,
        isActive: input.isActive ?? true,
      },
    });
  });
}

export async function updateTaxRate(actor: CatalogActor, id: string, input: Partial<TaxRateInput>) {
  return withTransaction(async (tx) => {
    const current = await tx.taxRate.findFirst({
      where: { id, businessId: actor.businessId },
    });
    if (!current) throw AppError.notFound("Tax rate not found");

    if (input.name && input.name.trim().toLowerCase() !== current.name.toLowerCase()) {
      const clash = await tx.taxRate.findFirst({
        where: { businessId: actor.businessId, name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: id } },
      });
      if (clash) throw AppError.conflict(`A tax rate named "${input.name.trim()}" already exists`);
    }

    if (input.isDefault) {
      await tx.taxRate.updateMany({
        where: { businessId: actor.businessId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.taxRate.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        rateBps: input.rateBps !== undefined ? input.rateBps : undefined,
        isDefault: input.isDefault !== undefined ? input.isDefault : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });
  });
}

export async function deleteTaxRate(actor: CatalogActor, id: string) {
  const current = await prisma.taxRate.findFirst({
    where: { id, businessId: actor.businessId },
  });
  if (!current) throw AppError.notFound("Tax rate not found");

  // Detach from products without breaking historical data
  await prisma.product.updateMany({
    where: { taxRateId: id },
    data: { taxRateId: null },
  });

  return prisma.taxRate.delete({ where: { id } });
}

/* -------------------------------------------------------------------------- */
/* Packaging Cost Templates                                                   */
/* -------------------------------------------------------------------------- */

export async function listPackagingCostTemplates(businessId: string) {
  return prisma.packagingCostTemplate.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { costPaisa: "asc" }, { name: "asc" }],
  });
}

export async function createPackagingCostTemplate(actor: CatalogActor, input: PackagingCostTemplateInput) {
  return withTransaction(async (tx) => {
    const existing = await tx.packagingCostTemplate.findFirst({
      where: { businessId: actor.businessId, name: { equals: input.name.trim(), mode: "insensitive" } },
    });
    if (existing) throw AppError.conflict(`A packaging template named "${input.name.trim()}" already exists`);

    if (input.isDefault) {
      await tx.packagingCostTemplate.updateMany({
        where: { businessId: actor.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.packagingCostTemplate.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        costPaisa: input.costPaisa,
        isDefault: input.isDefault,
        isActive: input.isActive ?? true,
      },
    });
  });
}

export async function updatePackagingCostTemplate(actor: CatalogActor, id: string, input: Partial<PackagingCostTemplateInput>) {
  return withTransaction(async (tx) => {
    const current = await tx.packagingCostTemplate.findFirst({
      where: { id, businessId: actor.businessId },
    });
    if (!current) throw AppError.notFound("Packaging cost template not found");

    if (input.name && input.name.trim().toLowerCase() !== current.name.toLowerCase()) {
      const clash = await tx.packagingCostTemplate.findFirst({
        where: { businessId: actor.businessId, name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: id } },
      });
      if (clash) throw AppError.conflict(`A packaging template named "${input.name.trim()}" already exists`);
    }

    if (input.isDefault) {
      await tx.packagingCostTemplate.updateMany({
        where: { businessId: actor.businessId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.packagingCostTemplate.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        costPaisa: input.costPaisa !== undefined ? input.costPaisa : undefined,
        isDefault: input.isDefault !== undefined ? input.isDefault : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });
  });
}

export async function deletePackagingCostTemplate(actor: CatalogActor, id: string) {
  const current = await prisma.packagingCostTemplate.findFirst({
    where: { id, businessId: actor.businessId },
  });
  if (!current) throw AppError.notFound("Packaging cost template not found");

  await prisma.product.updateMany({
    where: { packagingCostTemplateId: id },
    data: { packagingCostTemplateId: null },
  });

  return prisma.packagingCostTemplate.delete({ where: { id } });
}

/* -------------------------------------------------------------------------- */
/* Unit Labels                                                                */
/* -------------------------------------------------------------------------- */

export async function listUnitLabels(businessId: string) {
  return prisma.unitLabel.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }, { name: "asc" }],
  });
}

export async function createUnitLabelPreset(actor: CatalogActor, input: UnitLabelInput) {
  return withTransaction(async (tx) => {
    const slug = slugify(input.name);
    const existing = await tx.unitLabel.findFirst({
      where: { businessId: actor.businessId, slug },
    });
    if (existing) return existing;

    if (input.isDefault) {
      await tx.unitLabel.updateMany({
        where: { businessId: actor.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.unitLabel.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        slug,
        isDefault: input.isDefault,
      },
    });
  });
}

export async function updateUnitLabelPreset(actor: CatalogActor, id: string, input: Partial<UnitLabelInput> & { isActive?: boolean }) {
  return withTransaction(async (tx) => {
    const current = await tx.unitLabel.findFirst({
      where: { id, businessId: actor.businessId },
    });
    if (!current) throw AppError.notFound("Unit label not found");

    if (input.isDefault) {
      await tx.unitLabel.updateMany({
        where: { businessId: actor.businessId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.unitLabel.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        isDefault: input.isDefault !== undefined ? input.isDefault : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });
  });
}

export async function deleteUnitLabelPreset(actor: CatalogActor, id: string) {
  const current = await prisma.unitLabel.findFirst({
    where: { id, businessId: actor.businessId },
  });
  if (!current) throw AppError.notFound("Unit label not found");

  return prisma.unitLabel.delete({ where: { id } });
}

/* -------------------------------------------------------------------------- */
/* Brands                                                                     */
/* -------------------------------------------------------------------------- */

export async function listBrandsWithCounts(businessId: string) {
  const brands = await prisma.brand.findMany({
    where: { businessId, deletedAt: null },
    include: {
      _count: { select: { products: true } },
      logo: { select: { id: true, objectKey: true, visibility: true, originalName: true, extension: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    websiteUrl: b.websiteUrl,
    isActive: b.isActive,
    productCount: b._count.products,
    logoMediaId: b.logoMediaId,
    logo: b.logo,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
}

export { listBrandsWithCounts as listBrands };

export async function createBrandPreset(actor: CatalogActor, input: BrandInput) {
  return withTransaction(async (tx) => {
    const slug = slugify(input.slug ?? input.name);
    const clash = await tx.brand.findFirst({
      where: { businessId: actor.businessId, slug },
    });
    if (clash) throw AppError.conflict(`A brand with the handle "${slug}" already exists`);

    return tx.brand.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        slug,
        description: input.description ?? null,
        websiteUrl: input.websiteUrl || null,
        logoMediaId: input.logoMediaId ?? null,
        isActive: input.isActive ?? true,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
      },
    });
  });
}

export async function updateBrandPreset(actor: CatalogActor, id: string, input: Partial<BrandInput>) {
  return withTransaction(async (tx) => {
    const current = await tx.brand.findFirst({
      where: { id, businessId: actor.businessId },
    });
    if (!current) throw AppError.notFound("Brand not found");

    const slug = input.slug ? slugify(input.slug) : undefined;
    if (slug && slug !== current.slug) {
      const clash = await tx.brand.findFirst({
        where: { businessId: actor.businessId, slug, id: { not: id } },
      });
      if (clash) throw AppError.conflict(`A brand with the handle "${slug}" already exists`);
    }

    return tx.brand.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        slug,
        description: input.description !== undefined ? input.description : undefined,
        websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl || null : undefined,
        logoMediaId: input.logoMediaId !== undefined ? input.logoMediaId : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
        seoTitle: input.seoTitle !== undefined ? input.seoTitle : undefined,
        seoDescription: input.seoDescription !== undefined ? input.seoDescription : undefined,
      },
    });
  });
}

export async function deleteBrandPreset(actor: CatalogActor, id: string) {
  const current = await prisma.brand.findFirst({
    where: { id, businessId: actor.businessId, deletedAt: null },
  });
  if (!current) throw AppError.notFound("Brand not found");

  return prisma.brand.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

export async function listLabelsWithCounts(businessId: string) {
  const labels = await prisma.label.findMany({
    where: { businessId, deletedAt: null },
    include: {
      _count: { select: { products: true } },
      image: { select: { id: true, objectKey: true, visibility: true, originalName: true, extension: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    slug: label.slug,
    description: label.description,
    colorHex: label.colorHex,
    isActive: label.isActive,
    productCount: label._count.products,
    imageMediaId: label.imageMediaId,
    image: label.image,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  }));
}

export { listLabelsWithCounts as listLabels };

export async function createLabelPreset(actor: CatalogActor, input: LabelInput) {
  return withTransaction(async (tx) => {
    const slug = slugify(input.slug ?? input.name);
    const clash = await tx.label.findFirst({
      where: { businessId: actor.businessId, slug, deletedAt: null },
    });
    if (clash) throw AppError.conflict(`A label with the handle "${slug}" already exists`);

    return tx.label.create({
      data: {
        businessId: actor.businessId,
        name: input.name.trim(),
        slug,
        description: input.description ?? null,
        colorHex: input.colorHex || null,
        imageMediaId: input.imageMediaId ?? null,
        isActive: input.isActive ?? true,
      },
    });
  });
}

export async function updateLabelPreset(actor: CatalogActor, id: string, input: Partial<LabelInput>) {
  return withTransaction(async (tx) => {
    const current = await tx.label.findFirst({
      where: { id, businessId: actor.businessId, deletedAt: null },
    });
    if (!current) throw AppError.notFound("Label not found");

    const slug = input.slug ? slugify(input.slug) : undefined;
    if (slug && slug !== current.slug) {
      const clash = await tx.label.findFirst({
        where: { businessId: actor.businessId, slug, id: { not: id }, deletedAt: null },
      });
      if (clash) throw AppError.conflict(`A label with the handle "${slug}" already exists`);
    }

    return tx.label.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        slug,
        description: input.description !== undefined ? input.description : undefined,
        colorHex: input.colorHex !== undefined ? input.colorHex || null : undefined,
        imageMediaId: input.imageMediaId !== undefined ? input.imageMediaId : undefined,
        isActive: input.isActive !== undefined ? input.isActive : undefined,
      },
    });
  });
}

export async function deleteLabelPreset(actor: CatalogActor, id: string) {
  const current = await prisma.label.findFirst({
    where: { id, businessId: actor.businessId, deletedAt: null },
  });
  if (!current) throw AppError.notFound("Label not found");

  return prisma.label.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
}
