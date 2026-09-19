import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * robots.txt.
 *
 * Management, API and account routes are never indexed. The sitemap URL is absolute and
 * derived from the request host so the same code works on any domain.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const base = host ? `${proto}://${host}` : env().APP_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/account", "/checkout", "/cart", "/order"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
