import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { PageRenderer } from "@/components/page-builder/block-renderer";
import { resolveStorefrontByHost, storefrontBranding, storefrontHome } from "@/modules/storefront/queries";
import { safePageDocument } from "@/modules/page-builder/schema";

export const dynamic = "force-dynamic";

/**
 * Storefront home.
 *
 * When the storefront has a published homepage built with the page builder, that layout
 * is rendered. Otherwise a sensible default home (categories, featured products, new
 * arrivals) is shown so a fresh storefront is never blank.
 */

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) return {};
  return {
    title: `${storefront.name} — online shop`,
    description: storefront.description ?? `Shop the ${storefront.name} catalogue with cash on delivery across Bangladesh.`,
    alternates: { canonical: "/" },
    openGraph: { title: storefront.name, description: storefront.description ?? undefined, type: "website" },
  };
}

export default async function StorefrontHomePage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  const [home, branding] = await Promise.all([storefrontHome(storefront), storefrontBranding(storefront)]);

  if (home.homepagePageId) {
    const page = await prisma.page.findFirst({
      where: { id: home.homepagePageId },
      select: { publishedVersionId: true, versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const version = page?.publishedVersionId
      ? await prisma.pageVersion.findFirst({ where: { id: page.publishedVersionId } })
      : page?.versions[0];
    if (version) {
      return <PageRenderer document={safePageDocument(version.document)} storefront={storefront} />;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-10">
      <section
        className="relative overflow-hidden rounded-2xl bg-slate-900 px-8 py-14 text-white"
        style={branding.bannerUrl ? { backgroundImage: `url(${branding.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {branding.bannerUrl ? <div className="pointer-events-none absolute inset-0 bg-slate-900/55" aria-hidden /> : null}
        <div className="relative">
          <h1 className="text-3xl font-semibold sm:text-4xl">{storefront.name}</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-300">
            {storefront.description ?? `Browse ${home.totalProducts} products with cash on delivery across Bangladesh.`}
          </p>
          <Link href="/products" className="mt-6 inline-flex rounded-md bg-white px-5 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-100">
            Shop all products
          </Link>
        </div>
      </section>

      {home.categories.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold">Shop by category</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {home.categories.map((category) => (
              <Link key={category.id} href={`/products?category=${category.slug}`} className="rounded-lg border bg-white p-4 hover:border-indigo-300">
                <p className="font-medium">{category.name}</p>
                <p className="text-xs text-slate-500">{category.productCount} products</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {home.featured.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold">Featured</h2>
          <ProductGrid cards={home.featured} />
        </section>
      ) : null}

      {home.newest.length > 0 ? (
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">New arrivals</h2>
            <Link href="/products?sort=newest" className="text-sm text-indigo-600 hover:underline">
              See all
            </Link>
          </div>
          <ProductGrid cards={home.newest} />
        </section>
      ) : null}

      {home.totalProducts === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">
          No products are published yet. Publish products in the admin to fill this storefront.
        </p>
      ) : null}
    </div>
  );
}

function ProductGrid({ cards }: { cards: Array<{ id: string; name: string; slug: string; pricePaisa: number; compareAtPricePaisa: number | null; imageUrl: string | null; imageAlt: string | null; badge: string | null; ratingAverage: number | null; reviewCount: number }> }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => (
        <Link key={card.id} href={`/products/${card.slug}`} className="group overflow-hidden rounded-lg border bg-white">
          <div className="relative aspect-square bg-slate-100">
            {card.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.imageUrl} alt={card.imageAlt ?? card.name} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
            ) : null}
            {card.badge ? <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] text-white">{card.badge}</span> : null}
          </div>
          <div className="space-y-1 p-3">
            <p className="line-clamp-2 text-sm font-medium">{card.name}</p>
            <p className="text-sm font-semibold text-indigo-600">
              ৳{(card.pricePaisa / 100).toFixed(2)}
              {card.compareAtPricePaisa && card.compareAtPricePaisa > card.pricePaisa ? (
                <span className="ml-2 text-xs font-normal text-slate-400 line-through">৳{(card.compareAtPricePaisa / 100).toFixed(2)}</span>
              ) : null}
            </p>
            {card.ratingAverage ? (
              <p className="text-xs text-slate-500">
                ★ {card.ratingAverage} ({card.reviewCount})
              </p>
            ) : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
