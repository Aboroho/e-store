import "server-only";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { storageIsConfigured, storageDriverName } from "@/modules/media/storage";
import { toAssetView } from "@/modules/media/service";

/**
 * Media read queries used by pickers and admin screens. Storefront-specific queries live
 * in `modules/storefront/queries.ts`.
 */

export async function pickerContext(businessId: string) {
  const [settings, driver] = await Promise.all([getBusinessSettings(businessId), Promise.resolve(storageDriverName())]);
  return {
    configured: storageIsConfigured(),
    driver,
    maxUploadBytes: Number(settings["media.max_upload_bytes"] ?? 15 * 1024 * 1024),
  };
}

/** Where an asset is referenced, with a human label for each usage. */
export async function mediaUsageDetail(businessId: string, assetId: string) {
  const usages = await prisma.mediaUsage.findMany({ where: { mediaId: assetId, media: { businessId } } });
  if (usages.length === 0) return [];

  const productIds = usages.filter((usage) => usage.entityType === "PRODUCT").map((usage) => usage.entityId);
  const pageIds = usages.filter((usage) => usage.entityType === "PAGE").map((usage) => usage.entityId);
  const reviewIds = usages.filter((usage) => usage.entityType === "REVIEW").map((usage) => usage.entityId);

  const [products, pages, reviews] = await Promise.all([
    productIds.length > 0 ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [],
    pageIds.length > 0 ? prisma.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, title: true } }) : [],
    reviewIds.length > 0 ? prisma.review.findMany({ where: { id: { in: reviewIds } }, select: { id: true, title: true, product: { select: { name: true } } } }) : [],
  ]);

  return usages.map((usage) => ({
    ...usage,
    label:
      usage.entityType === "PRODUCT"
        ? products.find((product) => product.id === usage.entityId)?.name ?? "Product"
        : usage.entityType === "PAGE"
          ? pages.find((page) => page.id === usage.entityId)?.title ?? "Page"
          : usage.entityType === "REVIEW"
            ? `${reviews.find((review) => review.id === usage.entityId)?.product.name ?? "Product"} review`
            : usage.entityId.slice(0, 8),
  }));
}

export { toAssetView };
