import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import { resolveStorefrontByHost, publishedPageSlugs } from "@/modules/storefront/queries";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Sitemap for the storefront serving this host.
 *
 * The base URL comes from the request (so the same code is correct on a preview URL and
 * on the production domain) and falls back to APP_URL.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "";
  const forwardedProto = headerList.get("x-forwarded-proto") ?? "https";
  const base = host ? `${forwardedProto}://${host}` : env().APP_URL;

  const storefront = await resolveStorefrontByHost(host);
  if (!storefront) {
    return [{ url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 }];
  }

  const [products, categories, pages] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: storefront.businessId, status: "ACTIVE", deletedAt: null },
      select: { slug: true, updatedAt: true },
      take: 5000,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.category.findMany({
      where: { businessId: storefront.businessId, isActive: true, deletedAt: null },
      select: { slug: true, updatedAt: true },
    }),
    publishedPageSlugs(storefront.id),
  ]);

  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/products`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    ...categories.map((category) => ({
      url: `${base}/products?category=${category.slug}`,
      lastModified: category.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${base}/products/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...pages
      .filter((page) => !page.isHomepage)
      .map((page) => ({
        url: `${base}/pages/${page.slug}`,
        lastModified: page.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
  ];
}
