import "server-only";
import { prisma } from "@/lib/db/client";
import { availableQuantity } from "@/modules/inventory/service";

/** Read queries for catalog screens. All of them are scoped by businessId. */

export interface ProductListRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  productType: string;
  brand: string | null;
  variantCount: number;
  onHand: number;
  available: number;
  priceFromPaisa: number | null;
  isFeatured: boolean;
  updatedAt: Date;
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
            { variants: { some: { sku: { contains: query.search, mode: "insensitive" as const } } } },
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
          select: {
            id: true,
            status: true,
            priceOverridePaisa: true,
            inventory: { select: { onHand: true, reserved: true, damaged: true, inspection: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const rows: ProductListRow[] = products.map((product) => {
    const activeVariants = product.variants.filter((variant) => variant.status === "ACTIVE");
    const prices = activeVariants
      .map((variant) => variant.priceOverridePaisa)
      .filter((price): price is number => typeof price === "number" && price > 0);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      status: product.status,
      productType: product.productType,
      brand: product.brand,
      variantCount: product.variants.length,
      onHand: product.variants.reduce(
        (total_, variant) => total_ + variant.inventory.reduce((sum, balance) => sum + balance.onHand, 0),
        0,
      ),
      available: product.variants.reduce(
        (total_, variant) =>
          total_ + variant.inventory.reduce((sum, balance) => sum + availableQuantity(balance), 0),
        0,
      ),
      priceFromPaisa: prices.length > 0 ? Math.min(...prices) : null,
      isFeatured: product.isFeatured,
      updatedAt: product.updatedAt,
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
    where: { businessId },
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
      sku: true,
      name: true,
      priceOverridePaisa: true,
      product: { select: { id: true, name: true } },
      priceItems: { where: { priceListId }, select: { pricePaisa: true, compareAtPricePaisa: true } },
    },
  });

  return { priceList, variants };
}
