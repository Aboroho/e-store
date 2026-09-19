import { RichText } from "@/components/editor/rich-text";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { mediaUrlFor } from "@/modules/media/service";
import { productCards, productReviews, storefrontCatalog, type StorefrontContext } from "@/modules/storefront/queries";
import { blockDefinition } from "@/modules/page-builder/blocks";
import { safePageDocument, type PageBlock, type PageDocument, type PageSection } from "@/modules/page-builder/schema";

/**
 * Trusted page renderer.
 *
 * Every block is looked up in the registry, its props are re-validated, and only the
 * matching server component below is rendered. Unknown or malformed blocks are skipped
 * rather than executed — database content can never introduce markup or script.
 */

const SPACING_CLASS: Record<string, string> = {
  none: "py-0",
  xs: "py-2",
  sm: "py-4",
  md: "py-8",
  lg: "py-12",
  xl: "py-16",
};

const GAP_CLASS: Record<string, string> = { none: "gap-0", sm: "gap-3", md: "gap-6", lg: "gap-10" };
const PAD_X_CLASS: Record<string, string> = { none: "px-0", xs: "px-2", sm: "px-4", md: "px-6", lg: "px-8", xl: "px-12" };
const CONTAINER_CLASS: Record<string, string> = { full: "w-full", boxed: "mx-auto w-full max-w-6xl", narrow: "mx-auto w-full max-w-3xl" };
const ALIGN_CLASS: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };
const GAP_SIZE: Record<string, string> = { none: "0", sm: "0.75rem", md: "1.5rem", lg: "2.5rem" };

/**
 * Literal (so Tailwind can see them) responsive column templates. A section is always one
 * column on a phone unless the author explicitly turned stacking off, and widens as the
 * viewport grows — never `repeat(n, …)` on a phone, which would squeeze the copy.
 */
const COLUMN_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};
const COLUMN_CLASS_NO_STACK: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};
const STACK_CLASS: Record<number, string> = { 1: "space-y-0", 2: "space-y-6", 3: "space-y-6", 4: "space-y-6" };

function taka(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function mediaUrl(mediaId: string | null, businessId: string): Promise<{ url: string | null; alt: string }> {
  if (!mediaId) return { url: null, alt: "" };
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: mediaId, businessId, deletedAt: null, uploadStatus: "READY", visibility: "PUBLIC" },
    select: { objectKey: true, visibility: true, originalName: true, extension: true, altText: true },
  });
  if (!asset) return { url: null, alt: "" };
  return {
    url: await mediaUrlFor({ objectKey: asset.objectKey, visibility: asset.visibility, originalName: asset.originalName, extension: asset.extension }),
    alt: asset.altText ?? "",
  };
}

export async function PageRenderer({ document, storefront }: { document: unknown; storefront: StorefrontContext }) {
  const parsed: PageDocument = safePageDocument(document);
  if (parsed.sections.length === 0) return null;

  return (
    <div style={themeStyle(parsed)}>
      {parsed.sections.map((section) => (
        <SectionView key={section.id} section={section} storefront={storefront} />
      ))}
    </div>
  );
}

function themeStyle(document: PageDocument): React.CSSProperties {
  return {
    ...(document.theme.backgroundColor ? { backgroundColor: document.theme.backgroundColor } : {}),
    ...(document.theme.textColor ? { color: document.theme.textColor } : {}),
    ...(document.theme.fontFamily === "serif" ? { fontFamily: "Georgia, 'Times New Roman', serif" } : {}),
    ...(document.theme.fontFamily === "mono" ? { fontFamily: "ui-monospace, SFMono-Regular, monospace" } : {}),
  };
}

async function SectionView({ section, storefront }: { section: PageSection; storefront: StorefrontContext }) {
  const background = await mediaUrl(section.background.mediaId, storefront.businessId);
  const columns = Math.min(4, Math.max(1, section.layout.columns));

  const style: React.CSSProperties = {
    ...(section.background.color ? { backgroundColor: section.background.color } : {}),
    ...(background.url ? { backgroundImage: `url(${background.url})`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
  };

  return (
    <section
      className={`${SPACING_CLASS[section.padding.top] ?? "py-8"} ${SPACING_CLASS[section.padding.bottom] ?? "py-8"} ${
        section.responsive.hideOnMobile ? "hidden md:block" : ""
      } ${section.responsive.hideOnTablet ? "md:hidden lg:block" : ""} ${section.responsive.hideOnDesktop ? "lg:hidden" : ""}`}
      style={style}
      data-section-id={section.id}
    >
      {background.url && section.background.overlay > 0 ? (
        <div className="relative">
          <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: `rgba(15,23,42,${section.background.overlay / 100})` }} aria-hidden />
          <div className={CONTAINER_CLASS[section.container] ?? CONTAINER_CLASS.boxed}>
            <SectionBody section={section} columns={columns} storefront={storefront} />
          </div>
        </div>
      ) : (
        <div className={`${CONTAINER_CLASS[section.container] ?? CONTAINER_CLASS.boxed} ${PAD_X_CLASS[section.padding.horizontal] ?? "px-6"}`}>
          <SectionBody section={section} columns={columns} storefront={storefront} />
        </div>
      )}
    </section>
  );
}

async function SectionBody({ section, columns, storefront }: { section: PageSection; columns: number; storefront: StorefrontContext }) {
  const buckets: PageBlock[][] = Array.from({ length: columns }, () => []);
  for (const block of section.blocks) {
    const index = Math.min(columns - 1, Math.max(0, block.column ?? 0));
    buckets[index]!.push(block);
  }

  const columnClass = section.responsive.stackOnMobile ? COLUMN_CLASS[columns] : COLUMN_CLASS_NO_STACK[columns];

  return (
    <div
      className={`grid ${columnClass ?? COLUMN_CLASS[1]} ${GAP_CLASS[section.layout.gap] ?? "gap-6"} ${
        ALIGN_CLASS[section.align] ?? "text-left"
      }`}
      style={{ gap: GAP_SIZE[section.layout.gap] ?? "1.5rem" }}
    >
      {buckets.map((blocks, index) => (
        // Blocks inside one column stack vertically; the columns themselves are the grid.
        <div key={`column-${index}`} className={`min-w-0 ${STACK_CLASS[columns] ?? "space-y-6"}`}>
          {blocks.map((block) => (
            <BlockView key={block.id} block={block} storefront={storefront} />
          ))}
        </div>
      ))}
    </div>
  );
}

async function BlockView({ block, storefront }: { block: PageBlock; storefront: StorefrontContext }) {
  const definition = blockDefinition(block.type);
  if (!definition) return null;

  const parsed = definition.propsSchema.safeParse(block.props);
  if (!parsed.success) return null;
  const props = parsed.data as Record<string, unknown>;

  const visibility = `${block.responsive.hideOnMobile ? "hidden md:block" : ""} ${block.responsive.hideOnTablet ? "md:hidden lg:block" : ""} ${
    block.responsive.hideOnDesktop ? "lg:hidden" : ""
  }`;

  return <div className={visibility}>{await renderBlock(block.type, props, storefront)}</div>;
}

async function renderBlock(type: string, props: Record<string, unknown>, storefront: StorefrontContext) {
  switch (type) {
    case "heading": {
      const level = String(props.level ?? "h2");
      const sizeClass = { sm: "text-xl", md: "text-3xl", lg: "text-4xl", xl: "text-5xl" }[String(props.size ?? "md")] ?? "text-3xl";
      const Tag = (["h1", "h2", "h3", "h4"].includes(level) ? level : "h2") as "h1" | "h2" | "h3" | "h4";
      return (
        <Tag className={`font-semibold tracking-tight ${sizeClass} ${ALIGN_CLASS[String(props.align ?? "left")]}`} style={props.color ? { color: String(props.color) } : undefined}>
          {String(props.text ?? "")}
        </Tag>
      );
    }

    case "text": {
      const sizeClass = { sm: "text-sm", md: "text-base", lg: "text-lg" }[String(props.size ?? "md")] ?? "text-base";
      return (
        <div className={`space-y-3 ${sizeClass} ${ALIGN_CLASS[String(props.align ?? "left")]}`} style={props.color ? { color: String(props.color) } : undefined}>
          <RichText value={String(props.text ?? "")} />
        </div>
      );
    }

    case "image": {
      const media = await mediaUrl(props.mediaId as string | null, storefront.businessId);
      if (!media.url) return <Placeholder label="Image not selected" />;
      const widthClass = { full: "w-full", half: "w-full sm:w-1/2", third: "w-full sm:w-1/3", auto: "w-auto" }[String(props.width ?? "full")] ?? "w-full";
      const rounded = { none: "rounded-none", md: "rounded-md", lg: "rounded-xl", full: "rounded-full" }[String(props.rounded ?? "md")] ?? "rounded-md";
      const image = (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt={String(props.alt ?? media.alt)} className={`${widthClass} ${rounded} object-cover`} loading="lazy" />
      );
      const href = String(props.href ?? "");
      return href ? (
        <Link href={href} className="inline-block">
          {image}
        </Link>
      ) : (
        image
      );
    }

    case "banner": {
      const media = await mediaUrl(props.mediaId as string | null, storefront.businessId);
      const height = { sm: "min-h-40", md: "min-h-64", lg: "min-h-96" }[String(props.height ?? "md")] ?? "min-h-64";
      const overlay = Number(props.overlay ?? 35);
      return (
        <div
          className={`relative flex ${height} w-full items-center overflow-hidden rounded-xl bg-slate-900`}
          style={media.url ? { backgroundImage: `url(${media.url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          <div className="absolute inset-0" style={{ backgroundColor: `rgba(15,23,42,${overlay / 100})` }} aria-hidden />
          <div className={`relative z-10 w-full p-8 ${ALIGN_CLASS[String(props.textAlign ?? "left")]}`} style={{ color: props.textColor ? String(props.textColor) : "#ffffff" }}>
            <h2 className="text-3xl font-semibold">{String(props.heading ?? "")}</h2>
            {props.subheading ? <p className="mt-2 max-w-2xl text-sm opacity-90">{String(props.subheading)}</p> : null}
            {props.ctaLabel ? (
              <Link
                href={String(props.ctaHref ?? "/products")}
                className="mt-4 inline-flex rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
              >
                {String(props.ctaLabel)}
              </Link>
            ) : null}
          </div>
        </div>
      );
    }

    case "button": {
      const style = {
        primary: "bg-indigo-600 text-white hover:bg-indigo-700",
        secondary: "bg-slate-900 text-white hover:bg-slate-800",
        outline: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
        ghost: "text-indigo-600 hover:text-indigo-700",
      }[String(props.style ?? "primary")] ?? "bg-indigo-600 text-white";
      const size = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" }[String(props.size ?? "md")] ?? "px-4 py-2 text-sm";
      const href = String(props.href ?? "#");
      const external = /^https?:\/\//.test(href);
      return (
        <div className={ALIGN_CLASS[String(props.align ?? "left")]}>
          <Link
            href={href}
            target={props.openInNewTab || external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className={`inline-flex items-center rounded-md font-medium ${style} ${size}`}
          >
            {String(props.label ?? "Button")}
          </Link>
        </div>
      );
    }

    case "productGrid": {
      const source = String(props.source ?? "featured");
      const limit = Number(props.limit ?? 4);
      const cards = await gridProducts(storefront, source, String(props.search ?? ""), limit, props.categoryId as string | null);
      if (cards.length === 0) return <Placeholder label="No products to show yet" />;
      const columns = Number(props.columns ?? 4);
      return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, columns))}, minmax(0, 1fr))` }}>
          {cards.map((card) => (
            <Link key={card.id} href={`/products/${card.slug}`} className="group block overflow-hidden rounded-lg border bg-white">
              <div className="aspect-square bg-slate-100">
                {card.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.imageUrl} alt={card.imageAlt ?? card.name} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                ) : null}
              </div>
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-sm font-medium">{card.name}</p>
                {props.showPrice !== false ? <p className="text-sm font-semibold text-indigo-600">{taka(card.pricePaisa)}</p> : null}
                {props.showRating !== false && card.ratingAverage ? (
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

    case "featuredProduct": {
      const productId = props.productId as string | null;
      if (!productId) return <Placeholder label="Pick a product for this block" />;
      const cards = await productCards(storefront, [productId]);
      const card = cards.get(productId);
      if (!card) return <Placeholder label="That product is no longer available" />;
      const layout = String(props.layout ?? "image-left");
      return (
        <div className={`grid items-center gap-6 ${layout === "stacked" ? "grid-cols-1" : "sm:grid-cols-2"}`}>
          <div className={layout === "image-right" ? "sm:order-2" : ""}>
            <div className="aspect-square overflow-hidden rounded-xl bg-slate-100">
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.imageUrl} alt={card.imageAlt ?? card.name} className="h-full w-full object-cover" />
              ) : null}
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-semibold">{card.name}</h3>
            {card.shortDescription ? <p className="text-sm text-slate-600">{card.shortDescription}</p> : null}
            {props.showPrice !== false ? (
              <p className="text-xl font-semibold text-indigo-600">
                {taka(card.pricePaisa)}
                {card.compareAtPricePaisa && card.compareAtPricePaisa > card.pricePaisa ? (
                  <span className="ml-2 text-sm text-slate-400 line-through">{taka(card.compareAtPricePaisa)}</span>
                ) : null}
              </p>
            ) : null}
            <Link href={`/products/${card.slug}`} className="inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              {String(props.ctaLabel ?? "View product")}
            </Link>
          </div>
        </div>
      );
    }

    case "categories": {
      const categories = await prisma.category.findMany({
        where: { businessId: storefront.businessId, isActive: true, deletedAt: null },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        take: Number(props.limit ?? 6),
        include: { _count: { select: { products: true } } },
      });
      if (categories.length === 0) return <Placeholder label="No categories yet" />;
      return (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, Number(props.columns ?? 3)))}, minmax(0, 1fr))` }}>
          {categories.map((category) => (
            <Link key={category.id} href={`/products?category=${category.slug}`} className="rounded-lg border bg-white p-4 hover:border-indigo-300">
              <p className="font-medium">{category.name}</p>
              {props.showCount !== false ? <p className="text-xs text-slate-500">{category._count.products} products</p> : null}
            </Link>
          ))}
        </div>
      );
    }

    case "reviews": {
      const productId = props.productId as string | null;
      const reviews = productId
        ? await productReviews(productId, Number(props.limit ?? 3))
        : await recentReviews(storefront.businessId, Number(props.minRating ?? 4), Number(props.limit ?? 3));
      if (reviews.length === 0) return <Placeholder label="No reviews to show yet" />;
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          {reviews.map((review) => (
            <blockquote key={review.id} className="rounded-lg border bg-white p-4">
              <p className="text-amber-500" aria-label={`${review.rating} out of 5`}>
                {"★".repeat(review.rating)}
                <span className="text-slate-300">{"★".repeat(5 - review.rating)}</span>
              </p>
              {review.title ? <p className="mt-1 font-medium">{review.title}</p> : null}
              <p className="mt-1 line-clamp-4 text-sm text-slate-600">{review.body}</p>
              <footer className="mt-2 text-xs text-slate-500">
                {review.authorName}
                {review.verifiedPurchase ? " · verified purchase" : ""}
              </footer>
            </blockquote>
          ))}
        </div>
      );
    }

    case "contact": {
      return (
        <div className="rounded-lg border bg-white p-6">
          <h3 className="text-lg font-semibold">{String(props.heading ?? "Contact us")}</h3>
          <dl className="mt-3 space-y-1 text-sm text-slate-600">
            {props.phone ? (
              <div>
                <dt className="inline font-medium">Phone: </dt>
                <dd className="inline">
                  <a href={`tel:${String(props.phone)}`} className="text-indigo-600">
                    {String(props.phone)}
                  </a>
                </dd>
              </div>
            ) : null}
            {props.email ? (
              <div>
                <dt className="inline font-medium">Email: </dt>
                <dd className="inline">
                  <a href={`mailto:${String(props.email)}`} className="text-indigo-600">
                    {String(props.email)}
                  </a>
                </dd>
              </div>
            ) : null}
            {props.address ? (
              <div>
                <dt className="inline font-medium">Address: </dt>
                <dd className="inline">{String(props.address)}</dd>
              </div>
            ) : null}
            {props.showHours && props.hours ? (
              <div>
                <dt className="inline font-medium">Hours: </dt>
                <dd className="inline">{String(props.hours)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      );
    }

    case "embed": {
      if (props.videoMediaId) {
        const video = await mediaUrl(String(props.videoMediaId), storefront.businessId);
        return video.url ? <video controls src={video.url} aria-label={String(props.title ?? "Video")} className="w-full rounded-lg" /> : <Placeholder label="Video unavailable" />;
      }
      // Only the provider and a validated id are stored; the URL is rebuilt here.
      const provider = String(props.provider ?? "youtube");
      const videoId = String(props.videoId ?? "");
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return <Placeholder label="Invalid video id" />;
      const src = provider === "vimeo" ? `https://player.vimeo.com/video/${videoId}` : `https://www.youtube.com/embed/${videoId}`;
      const ratio = { "16:9": "56.25%", "4:3": "75%", "1:1": "100%" }[String(props.aspect ?? "16:9")] ?? "56.25%";
      return (
        <div className="relative w-full overflow-hidden rounded-lg" style={{ paddingTop: ratio }}>
          <iframe
            src={src}
            title={String(props.title ?? "Video")}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 h-full w-full"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        </div>
      );
    }

    case "spacer":
      return <div className={SPACING_CLASS[String(props.height ?? "md")] ?? "py-8"} aria-hidden />;

    case "divider": {
      const width = { full: "w-full", half: "w-1/2", content: "w-24" }[String(props.width ?? "full")] ?? "w-full";
      return <hr className={`border-t ${width}`} style={{ borderStyle: String(props.style ?? "solid"), borderColor: props.color ? String(props.color) : undefined }} />;
    }

    default:
      return null;
  }
}

function Placeholder({ label }: { label: string }) {
  return <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{label}</p>;
}

async function gridProducts(storefront: StorefrontContext, source: string, search: string, limit: number, categoryId: string | null) {
  if (source === "search" && search) {
    const result = await storefrontCatalog(storefront, { search, pageSize: Math.max(1, Math.min(12, limit)) });
    return result.rows;
  }
  if (source === "category" && categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, businessId: storefront.businessId }, select: { slug: true } });
    if (category) {
      const result = await storefrontCatalog(storefront, { categorySlug: category.slug, pageSize: Math.max(1, Math.min(12, limit)) });
      return result.rows;
    }
  }
  const ids = await prisma.product.findMany({
    where: {
      businessId: storefront.businessId,
      status: "ACTIVE",
      deletedAt: null,
      ...(source === "featured" ? { isFeatured: true } : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.min(12, limit)),
    select: { id: true },
  });
  if (ids.length === 0 && source === "featured") {
    const fallback = await storefrontCatalog(storefront, { pageSize: Math.max(1, Math.min(12, limit)), sort: "newest" });
    return fallback.rows;
  }
  const cards = await productCards(storefront, ids.map((row) => row.id));
  return [...cards.values()];
}

async function recentReviews(businessId: string, minRating: number, limit: number) {
  const reviews = await prisma.review.findMany({
    where: { businessId, status: "APPROVED", rating: { gte: minRating } },
    orderBy: [{ createdAt: "desc" }],
    take: Math.max(1, Math.min(9, limit)),
    include: { customer: { select: { name: true } }, product: { select: { name: true } } },
  });
  return reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    verifiedPurchase: review.verifiedPurchase,
    authorName: review.customer?.name?.split(" ")[0] ?? "Customer",
    productName: review.product.name,
  }));
}
