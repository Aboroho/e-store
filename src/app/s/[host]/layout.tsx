import { notFound } from "next/navigation";
import { CartProviderBoundary } from "@/components/storefront/cart";
import { StorefrontChrome } from "@/components/storefront/chrome";
import { resolveStorefrontByHost } from "@/modules/storefront/queries";
import { storefrontMarketingPixels } from "@/modules/marketing/service";
import { MarketingPixels } from "@/components/marketing/marketing-pixels";

export const dynamic = "force-dynamic";

/**
 * Storefront layout.
 *
 * Resolves the storefront from the request Host header (custom domain, slug or the
 * default storefront) and wraps every page in its theme, navigation and cart.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ host: string }>;
}) {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  // Only public pixel ids are handed to the browser; server credentials stay here.
  const pixels = await storefrontMarketingPixels(storefront.businessId, storefront.id);

  return (
    <CartProviderBoundary>
      <div className="min-h-screen bg-white text-slate-900">
        <StorefrontChrome storefront={storefront}>{children}</StorefrontChrome>
        <MarketingPixels pixels={pixels} />
      </div>
    </CartProviderBoundary>
  );
}
