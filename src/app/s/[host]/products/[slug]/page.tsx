import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveStorefrontByHost, storefrontProduct, productReviews, reviewSummary } from "@/modules/storefront/queries";
import { VariantPicker } from "@/components/storefront/variant-picker";
import { ReviewForm } from "@/components/storefront/review-form";
import { RichTextContent, parseRichText } from "@/components/rich-text-editor";
import { reviewImageLimits } from "@/modules/reviews/service";

export const dynamic = "force-dynamic";

function taka(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function generateMetadata({ params }: { params: Promise<{ host: string; slug: string }> }): Promise<Metadata> {
  const { host, slug } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) return {};
  const product = await storefrontProduct(storefront, slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.seoTitle ?? `${product.name} — ${storefront.name}`,
    description: product.seoDescription ?? product.shortDescription ?? undefined,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.seoTitle ?? product.name,
      description: product.seoDescription ?? product.shortDescription ?? undefined,
      images: product.images[0]?.url ? [product.images[0].url] : undefined,
      type: "website",
    },
  };
}

export default async function ProductDetailPage({ params }: { params: Promise<{ host: string; slug: string }> }) {
  const { host, slug } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  const product = await storefrontProduct(storefront, slug);
  if (!product) notFound();

  const [reviews, summary, reviewLimits] = await Promise.all([
    productReviews(product.id, 12),
    reviewSummary(product.id),
    // The limit shown here is the same server-side setting the review action enforces.
    reviewImageLimits(storefront.businessId),
  ]);
  const canReview = storefront.status === "ACTIVE" && storefront.businessId ? true : false;

  // Structured data helps search engines show price and availability.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.seoDescription ?? product.shortDescription ?? undefined,
    image: product.images.map((image) => image.url).filter(Boolean),
    brand: product.brand ?? undefined,
    offers: product.variants
      .filter((variant) => variant.available > 0 || variant.isPreorderEnabled)
      .map((variant) => ({
        "@type": "Offer",
        price: (variant.pricePaisa / 100).toFixed(2),
        priceCurrency: "BDT",
        availability: variant.available > 0 ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
      })),
    ...(summary.average
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: summary.average, reviewCount: summary.total } }
      : {}),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <nav className="text-xs text-slate-500">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        {" / "}
        <Link href="/products" className="hover:underline">
          Products
        </Link>
        {product.categories[0] ? (
          <>
            {" / "}
            <Link href={`/products?category=${product.categories[0].slug}`} className="hover:underline">
              {product.categories[0].name}
            </Link>
          </>
        ) : null}
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        <VariantPicker
          productName={product.name}
          productSlug={product.slug}
          sku={product.variants[0]?.sku ?? ""}
          options={product.options}
          variants={product.variants}
          gallery={product.images}
          preorderNote={product.preorderNote}
          unitLabel={product.unitLabel}
        />

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            {product.brand ? <p className="text-sm text-slate-500">{product.brand}</p> : null}
            {summary.average ? (
              <a href="#reviews" className="mt-1 inline-flex items-center gap-1 text-sm text-amber-600 hover:underline">
                ★ {summary.average} · {summary.total} review{summary.total === 1 ? "" : "s"}
              </a>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No reviews yet</p>
            )}
          </div>

          {product.shortDescription ? <p className="text-sm text-slate-600">{product.shortDescription}</p> : null}

          <div className="rounded-lg border p-4 text-xs text-slate-500">
            <p>
              Cash on delivery {storefront.codEnabled ? "is available" : "is not available"} for this storefront. Prices are recalculated on
              the server when you order.
            </p>
            {product.variants.length > 1 ? (
              <ul className="mt-3 space-y-1">
                {product.variants.slice(0, 12).map((variant) => (
                  <li key={variant.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {variant.attributes.length > 0
                        ? variant.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(" · ")
                        : variant.name}
                    </span>
                    <span className={variant.available > 0 ? "text-emerald-600" : variant.isPreorderEnabled ? "text-amber-600" : "text-rose-600"}>
                      {taka(variant.pricePaisa)}
                      {variant.available > 0 ? ` · ${variant.available} in stock` : variant.isPreorderEnabled ? " · preorder" : " · out of stock"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {product.description ? (
            <details open className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Description</summary>
              <RichTextContent value={parseRichText(product.description)} className="mt-2 text-slate-600" />
            </details>
          ) : null}
        </div>
      </div>

      <section id="reviews" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Customer reviews</h2>
          {summary.average ? <p className="text-sm text-slate-600">Average {summary.average} out of 5 from {summary.total} reviews</p> : null}
        </div>

        {summary.total > 0 ? (
          <ul className="space-y-2 text-sm">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary.distribution[star] ?? 0;
              const percent = summary.total > 0 ? Math.round((count / summary.total) * 100) : 0;
              return (
                <li key={star} className="flex items-center gap-2">
                  <span className="w-10 text-xs text-slate-500">{star} ★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="w-14 text-right text-xs text-slate-500">
                    {count} ({percent}%)
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        {reviews.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
            No published reviews yet. Purchased this? You can be the first to review it.
          </p>
        ) : (
          <ul className="space-y-4">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-500" aria-label={`${review.rating} out of 5`}>
                    {"★".repeat(review.rating)}
                    <span className="text-slate-300">{"★".repeat(5 - review.rating)}</span>
                  </span>
                  {review.title ? <span className="text-sm font-medium">{review.title}</span> : null}
                  {review.verifiedPurchase ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">verified purchase</span> : null}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{review.body}</p>
                {review.images.length > 0 ? (
                  <div className="mt-2 flex gap-2">
                    {review.images.map((url, index) =>
                      url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={index} src={url} alt="" className="h-16 w-16 rounded object-cover" loading="lazy" />
                      ) : null,
                    )}
                  </div>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  {review.authorName} · {new Date(review.createdAt).toLocaleDateString("en-GB")}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canReview ? (
          <ReviewForm
            productId={product.id}
            productName={product.name}
            maxImages={reviewLimits.maxImages}
          />
        ) : null}
      </section>

      {product.related.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold">You may also like</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {product.related.map((card) => (
              <Link key={card.id} href={`/products/${card.slug}`} className="overflow-hidden rounded-lg border bg-white">
                <div className="aspect-square bg-slate-100">
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.imageUrl} alt={card.imageAlt ?? card.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium">{card.name}</p>
                  <p className="text-sm font-semibold text-indigo-600">{taka(card.pricePaisa)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
