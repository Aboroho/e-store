import "server-only";
import { prisma } from "@/lib/db/client";
import { availableQuantity } from "@/modules/inventory/service";

/** Read queries for catalog screens. All of them are scoped by businessId. */

export interface ProductListVariantRow {
  id: string;
  name: string;
  sku: string | null;
  optionKey: string;
  status: string;
  pricePaisa: number;
  priceOverridePaisa: number | null;
  compareAtPricePaisa: number | null;
  costPaisa: number | null;
  packagingCostPaisa: number | null;
  isPreorderEnabled: boolean | null;
  weightGrams: number | null;
  onHand: number;
  available: number;
  attributesSummary: Record<string, string> | null;
}

export interface ProductListRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: string;
  productType: string;
  brand: string | null;
  unitLabel: string;
  defaultPricePaisa: number | null;
  variantCount: number;
  onHand: number;
  available: number;
  priceFromPaisa: number | null;
  isFeatured: boolean;
  isPreorderEnabled: boolean;
  updatedAt: Date;
  variants: ProductListVariantRow[];
}

export async function listProducts(
  businessId: string,
  query: { search?: string; status?: string; categoryId?: string; sortBy?: string; sortDir: "asc" | "desc"; skip: number; take: number },
): Promise<{ rows: ProductListRow[]; total: number }> {
  const where = {
    businessId,
    deletedAt: null,
    ...(query.status && query.status !== "ALL" ? { status: query.status as "DRAFT" } : {}),
    ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { brand: { contains: query.search, mode: "insensitive" as const } },
            { sku: { contains: query.search, mode: "insensitive" as const } },
            { variants: { some: { name: { contains: query.search, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };

  const orderBy =
    query.sortBy === "name"
      ? { name: query.sortDir }
      : query.sortBy === "updatedAt"
        ? { updatedAt: query.sortDir }
        : { createdAt: query.sortDir };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.take,
      include: {
        variants: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            name: true,
            status: true,
            optionKey: true,
            priceOverridePaisa: true,
            compareAtPricePaisa: true,
            costPaisa: true,
            packagingCostPaisa: true,
            isPreorderEnabled: true,
            weightGrams: true,
            attributesSummary: true,
            priceItems: {
              where: { minQuantity: 1 },
              take: 1,
              select: { pricePaisa: true, compareAtPricePaisa: true },
            },
            inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const rows: ProductListRow[] = products.map((product) => {
    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    const defaultPricePaisa = typeof metadata.defaultPricePaisa === "number" ? (metadata.defaultPricePaisa as number) : null;

    const variantRows: ProductListVariantRow[] = product.variants.map((variant) => {
      const onHand = variant.inventory.reduce((sum, balance) => sum + balance.onHand, 0);
      const available = variant.inventory.reduce((sum, balance) => sum + availableQuantity(balance), 0);
      const effectivePrice = variant.priceItems[0]?.pricePaisa ?? variant.priceOverridePaisa ?? defaultPricePaisa ?? 0;
      return {
        id: variant.id,
        name: variant.name,
        sku: product.sku,
        optionKey: variant.optionKey,
        status: variant.status,
        pricePaisa: effectivePrice,
        priceOverridePaisa: variant.priceOverridePaisa,
        compareAtPricePaisa: variant.priceItems[0]?.compareAtPricePaisa ?? variant.compareAtPricePaisa,
        costPaisa: variant.costPaisa,
        packagingCostPaisa: variant.packagingCostPaisa ?? product.packagingCostPaisa,
        isPreorderEnabled: variant.isPreorderEnabled,
        weightGrams: variant.weightGrams,
        onHand,
        available,
        attributesSummary: (variant.attributesSummary as Record<string, string>) || null,
      };
    });

    const activeVariants = variantRows.filter((variant) => variant.status === "ACTIVE");
    const prices = activeVariants
      .map((variant) => variant.pricePaisa)
      .filter((price): price is number => typeof price === "number" && price > 0);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      status: product.status,
      productType: product.productType,
      brand: product.brand,
      unitLabel: product.unitLabel,
      defaultPricePaisa,
      variantCount: product.variants.length,
      onHand: variantRows.reduce((total_, variant) => total_ + variant.onHand, 0),
      available: variantRows.reduce((total_, variant) => total_ + variant.available, 0),
      priceFromPaisa: prices.length > 0 ? Math.min(...prices) : defaultPricePaisa,
      isFeatured: product.isFeatured,
      isPreorderEnabled: product.isPreorderEnabled,
      updatedAt: product.updatedAt,
      variants: variantRows,
    };
  });

  return { rows, total };
}

export async function getProductForEdit(businessId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    include: {
      categories: { select: { categoryId: true, isPrimary: true } },
      attributes: { select: { attributeId: true } },
      variants: {
        orderBy: { position: "asc" },
        include: {
          attributeValues: { select: { attributeValueId: true, attributeId: true } },
          inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true, averageCostPaisa: true } },
        },
      },
      priceItems: { select: { priceListId: true, variantId: true, pricePaisa: true, compareAtPricePaisa: true } },
      images: {
        orderBy: { position: "asc" },
        include: {
          media: { select: { id: true, objectKey: true, originalName: true, title: true, altText: true, mimeType: true, extension: true, sizeBytes: true, width: true, height: true, visibility: true, usageCount: true, folderId: true, createdAt: true, caption: true } },
        },
      },
    },
  });
  return product;
}

export async function listCategoryOptions(businessId: string) {
  return prisma.category.findMany({
    where: { businessId, deletedAt: null },
    orderBy: [{ path: "asc" }, { position: "asc" }],
    select: { id: true, name: true, slug: true, path: true, parentId: true, isActive: true, position: true, isFeatured: true, _count: { select: { products: true } } },
  });
}

export async function listAttributes(businessId: string) {
  return prisma.attribute.findMany({
    where: { businessId, deletedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    include: {
      values: { orderBy: [{ position: "asc" }, { value: "asc" }], select: { id: true, value: true, slug: true, colorHex: true } },
      _count: { select: { productLinks: true } },
    },
  });
}

export async function listPriceLists(businessId: string) {
  const lists = await prisma.priceList.findMany({
    where: { businessId },
    orderBy: [{ isDefault: "desc" }, { priority: "desc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  const storefrontIds = [...new Set(lists.map((list) => list.storefrontId).filter((id): id is string => Boolean(id)))];
  const storefronts =
    storefrontIds.length > 0
      ? await prisma.storefront.findMany({ where: { id: { in: storefrontIds } }, select: { id: true, name: true } })
      : [];
  const names = new Map(storefronts.map((storefront) => [storefront.id, storefront.name]));

  return lists.map((list) => ({
    ...list,
    storefrontName: list.storefrontId ? (names.get(list.storefrontId) ?? null) : null,
  }));
}

export async function getPriceListWithItems(businessId: string, priceListId: string) {
  const priceList = await prisma.priceList.findFirst({ where: { id: priceListId, businessId } });
  if (!priceList) return null;

  const variants = await prisma.variant.findMany({
    where: { product: { businessId, deletedAt: null } },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      priceOverridePaisa: true,
      product: { select: { id: true, name: true, sku: true } },
      priceItems: { where: { priceListId }, select: { pricePaisa: true, compareAtPricePaisa: true } },
    },
  });

  return { priceList, variants };
}
