import "server-only";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { storageIsConfigured, storageDriverName } from "@/modules/media/storage";
import { listMedia, toAssetView } from "@/modules/media/service";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * Media read queries used by pickers and admin screens. Storefront-specific queries live
 * in `modules/storefront/queries.ts`.
 */

export interface MediaPickerOptions {
  search?: string;
  mimeGroup?: "image" | "document" | "all";
  folderId?: string | null;
  limit?: number;
  excludeIds?: string[];
}

/** Small, picker-shaped media query used by form components. */
export async function mediaForPicker(businessId: string, options: MediaPickerOptions = {}): Promise<MediaAssetView[]> {
  const result = await listMedia(businessId, {
    search: options.search,
    mimeGroup: options.mimeGroup ?? "image",
    folderId: options.folderId ?? undefined,
    pageSize: Math.min(60, options.limit ?? 24),
    page: 1,
    sort: "newest",
  });
  const excluded = new Set(options.excludeIds ?? []);
  return result.rows.filter((asset) => !excluded.has(asset.id));
}

export async function pickerContext(businessId: string) {
  const [settings, driver] = await Promise.all([getBusinessSettings(businessId), Promise.resolve(storageDriverName())]);
  return {
    configured: storageIsConfigured(),
    driver,
    maxUploadBytes: Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024),
  };
}

/**
 * Where an asset is referenced, with a human label for each usage.
 *
 * Every entity type that can reference media resolves to a readable name here, so
 * the media manager can explain why a file cannot be deleted ("Used by product
 * Classic Black Leather Shoes") and offer detaching instead.
 */
export async function mediaUsageDetail(businessId: string, assetId: string) {
  const usages = await prisma.mediaUsage.findMany({ where: { mediaId: assetId, media: { businessId } } });
  if (usages.length === 0) return [];

  const idsFor = (entityType: string) =>
    usages.filter((usage) => usage.entityType === entityType).map((usage) => usage.entityId);

  const [products, pages, reviews, brands, categoryRows, attributeValues] = await Promise.all([
    idsFor("PRODUCT").length > 0
      ? prisma.product.findMany({ where: { id: { in: idsFor("PRODUCT") } }, select: { id: true, name: true } })
      : [],
    idsFor("PAGE").length > 0 ? prisma.page.findMany({ where: { id: { in: idsFor("PAGE") } }, select: { id: true, title: true } }) : [],
    idsFor("REVIEW").length > 0
      ? prisma.review.findMany({ where: { id: { in: idsFor("REVIEW") } }, select: { id: true, title: true, product: { select: { name: true } } } })
      : [],
    idsFor("BRAND").length > 0 ? prisma.brand.findMany({ where: { id: { in: idsFor("BRAND") } }, select: { id: true, name: true } }) : [],
    idsFor("CATEGORY").length > 0 ? prisma.category.findMany({ where: { id: { in: idsFor("CATEGORY") } }, select: { id: true, name: true } }) : [],
    idsFor("ATTRIBUTE_VALUE").length > 0
      ? prisma.attributeValue.findMany({
          where: { id: { in: idsFor("ATTRIBUTE_VALUE") } },
          select: { id: true, value: true, attribute: { select: { name: true } } },
        })
      : [],
  ]);

  const labelFor = (usage: { entityType: string; entityId: string }): string => {
    switch (usage.entityType) {
      case "PRODUCT":
        return products.find((product) => product.id === usage.entityId)?.name ?? "Product";
      case "VARIANT":
        return "Product variant";
      case "ATTRIBUTE_VALUE": {
        const value = attributeValues.find((entry) => entry.id === usage.entityId);
        return value ? `${value.attribute.name}: ${value.value}` : "Attribute value";
      }
      case "BRAND":
        return brands.find((brand) => brand.id === usage.entityId)?.name ?? "Brand";
      case "CATEGORY":
        return categoryRows.find((category) => category.id === usage.entityId)?.name ?? "Category";
      case "PAGE":
        return pages.find((page) => page.id === usage.entityId)?.title ?? "Page";
      case "REVIEW":
        return `${reviews.find((review) => review.id === usage.entityId)?.product.name ?? "Product"} review`;
      default:
        return `${usage.entityType.charAt(0)}${usage.entityType.slice(1).toLowerCase()}`;
    }
  };

  return usages.map((usage) => ({ ...usage, label: labelFor(usage) }));
}

export { toAssetView };
