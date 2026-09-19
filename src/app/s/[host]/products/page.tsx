import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveStorefrontByHost, storefrontCatalog } from "@/modules/storefront/queries";
import { AddToCartButton } from "@/components/storefront/cart";

export const dynamic = "force-dynamic";

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name", label: "Name" },
];

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }): Promise<Metadata> {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) return {};
  return {
    title: `Products — ${storefront.name}`,
    description: `Browse the ${storefront.name} catalogue.`,
    alternates: { canonical: "/products" },
  };
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  const query = await searchParams;
  const read = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const search = read("q") ?? "";
  const categorySlug = read("category");
  const sort = (read("sort") ?? "featured") as "featured" | "newest" | "price-asc" | "price-desc" | "name";
  const page = Math.max(1, Number(read("page") ?? 1) || 1);
  const inStockOnly = read("stock") === "in";

  const result = await storefrontCatalog(storefront, {
    search: search || undefined,
    categorySlug: categorySlug || undefined,
    sort,
    page,
    pageSize: 24,
    inStockOnly: inStockOnly || undefined,
  });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      q: search || null,
      category: categorySlug ?? null,
      sort: sort === "featured" ? null : sort,
      stock: inStockOnly ? "in" : null,
      ...overrides,
    };
    for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
    const queryString = params.toString();
    return `/products${queryString ? `?${queryString}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{categorySlug ? result.categories.find((category) => category.slug === categorySlug)?.name ?? "Products" : "All products"}</h1>
          <p className="text-sm text-slate-500">{result.total} product{result.total === 1 ? "" : "s"}</p>
        </div>
        <form action="/products" className="flex flex-wrap items-center gap-2">
          <input type="search" name="q" defaultValue={search} placeholder="Search products" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
          {categorySlug ? <input type="hidden" name="category" value={categorySlug} /> : null}
          <select name="sort" defaultValue={sort} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="stock" value="in" defaultChecked={inStockOnly} className="h-4 w-4 rounded border-slate-300" />
            In stock only
          </label>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
            Apply
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={link({ category: null, page: null })} className={!categorySlug ? "font-medium text-indigo-600" : "text-slate-600 hover:underline"}>
          All
        </Link>
        {result.categories.map((category) => (
          <Link
            key={category.id}
            href={link({ category: category.slug, page: null })}
            className={categorySlug === category.slug ? "font-medium text-indigo-600" : "text-slate-600 hover:underline"}
          >
            {category.name} ({category.productCount})
          </Link>
        ))}
      </div>

      {result.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">
          Nothing matches that search. Try a different term or clear the filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {result.rows.map((card) => (
            <div key={card.id} className="overflow-hidden rounded-lg border bg-white">
              <Link href={`/products/${card.slug}`} className="block">
                <div className="relative aspect-square bg-slate-100">
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.imageUrl} alt={card.imageAlt ?? card.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                  {card.badge ? <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] text-white">{card.badge}</span> : null}
                </div>
                <div className="space-y-1 p-3 pb-0">
                  <p className="line-clamp-2 text-sm font-medium">{card.name}</p>
                  <p className="text-sm font-semibold text-indigo-600">
                    ৳{(card.pricePaisa / 100).toFixed(2)}
                    {card.compareAtPricePaisa && card.compareAtPricePaisa > card.pricePaisa ? (
                      <span className="ml-2 text-xs font-normal text-slate-400 line-through">৳{(card.compareAtPricePaisa / 100).toFixed(2)}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {card.available > 0 ? `${card.available} in stock` : card.isPreorderEnabled ? "Available on preorder" : "Out of stock"}
                  </p>
                </div>
              </Link>
              <div className="p-3 pt-2">
                <AddToCartButton
                  line={{ variantId: card.variantId ?? "", quantity: 1, name: card.name, pricePaisa: card.pricePaisa, slug: card.slug }}
                  disabled={!card.variantId || (card.available <= 0 && !card.isPreorderEnabled)}
                  label="Add to cart"
                  className="[&>button]:w-full [&>button]:justify-center"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={link({ page: String(page - 1) })} className="rounded-md border px-3 py-1 hover:bg-slate-50">
              Previous
            </Link>
          ) : null}
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={link({ page: String(page + 1) })} className="rounded-md border px-3 py-1 hover:bg-slate-50">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
