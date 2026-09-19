import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@/components/page-builder/block-renderer";
import { publishedPage, resolveStorefrontByHost } from "@/modules/storefront/queries";

export const dynamic = "force-dynamic";

/** A CMS page built in the page builder. Only the published version is served. */
export async function generateMetadata({ params }: { params: Promise<{ host: string; slug: string }> }): Promise<Metadata> {
  const { host, slug } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) return {};
  const page = await publishedPage(storefront, slug);
  if (!page) return { title: "Page not found" };
  return {
    title: page.seoTitle ?? `${page.title} — ${storefront.name}`,
    description: page.seoDescription ?? undefined,
    alternates: page.canonicalUrl ? { canonical: page.canonicalUrl } : { canonical: `/pages/${page.slug}` },
    robots: page.robots ?? undefined,
    openGraph: { title: page.seoTitle ?? page.title, description: page.seoDescription ?? undefined, type: "website" },
  };
}

export default async function CmsPage({ params }: { params: Promise<{ host: string; slug: string }> }) {
  const { host, slug } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  const page = await publishedPage(storefront, slug);
  if (!page) notFound();

  return (
    <article className="pb-10">
      {page.seoTitle && page.seoTitle !== page.title ? <span className="sr-only">{page.title}</span> : null}
      <PageRenderer document={page.document} storefront={storefront} />
    </article>
  );
}
