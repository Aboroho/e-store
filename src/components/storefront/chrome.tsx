import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { storefrontNavigation, storefrontSettingsFor, type StorefrontContext } from "@/modules/storefront/queries";
import { CartLink } from "@/components/storefront/cart";

/**
 * Storefront chrome: announcement bar, header with the storefront's own navigation
 * menu, and footer. Rendered by both the public storefront and the admin preview, so
 * "preview" is always the same code path as production.
 */

export async function StorefrontChrome({
  storefront,
  children,
  preview = false,
}: {
  storefront: StorefrontContext;
  children: React.ReactNode;
  preview?: boolean;
}) {
  const [navigation, settings, publishedPages] = await Promise.all([
    storefrontNavigation(storefront.id, "main"),
    storefrontSettingsFor(storefront.id),
    prisma.page.findMany({
      where: { storefrontId: storefront.id, status: "PUBLISHED", deletedAt: null, isHomepage: false },
      orderBy: { title: "asc" },
      take: 6,
      select: { slug: true, title: true },
    }),
  ]);

  const business = await prisma.business.findUnique({ where: { id: storefront.businessId }, select: { logoMediaId: true } });
  const theme = storefront.themeConfig as { primaryColor?: string; accentColor?: string };
  const primaryColor = typeof theme.primaryColor === "string" ? theme.primaryColor : "#4f46e5";
  const accentColor = typeof theme.accentColor === "string" ? theme.accentColor : "#0f172a";
  const announcement = typeof settings["storefront.announcement"] === "string" ? (settings["storefront.announcement"] as string) : "";

  const menuItems = navigation.items.length > 0 ? navigation.items : defaultMenu(publishedPages);

  return (
    <div style={{ ["--storefront-primary" as string]: primaryColor, ["--storefront-accent" as string]: accentColor }}>
      {preview ? (
        <div className="bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-900">Preview — this is not the live site</div>
      ) : null}
      {announcement ? <div className="bg-slate-900 px-4 py-2 text-center text-xs text-white">{announcement}</div> : null}

      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-semibold" style={{ color: accentColor }}>
            {business?.logoMediaId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/media/${business.logoMediaId}`} alt={storefront.name} className="inline-block max-h-12 max-w-40 object-contain" />
            ) : storefront.name}
          </Link>
          <nav aria-label="Main" className="order-3 w-full sm:order-2 sm:w-auto">
            <ul className="flex flex-wrap items-center gap-4 text-sm">
              {menuItems.map((item) => (
                <li key={item.id} className="relative">
                  <Link
                    href={item.url}
                    target={item.openInNewTab ? "_blank" : undefined}
                    rel={item.openInNewTab ? "noopener noreferrer" : undefined}
                    className="hover:underline"
                  >
                    {item.label}
                  </Link>
                  {item.children.length > 0 ? (
                    <ul className="mt-1 hidden gap-2 text-xs text-slate-500 sm:flex">
                      {item.children.map((child) => (
                        <li key={child.id}>
                          <Link href={child.url} className="hover:underline">
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <div className="order-2 flex items-center gap-4 sm:order-3">
            <Link href="/account" className="text-sm hover:underline">
              Account
            </Link>
            <CartLink />
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-12 border-t bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-medium" style={{ color: accentColor }}>
              {storefront.name}
            </p>
            {storefront.description ? <p className="mt-1 text-slate-600">{storefront.description}</p> : null}
          </div>
          <div>
            <p className="font-medium text-slate-900">Shop</p>
            <ul className="mt-1 space-y-1 text-slate-600">
              <li>
                <Link href="/products" className="hover:underline">
                  All products
                </Link>
              </li>
              {publishedPages.slice(0, 4).map((page) => (
                <li key={page.slug}>
                  <Link href={`/pages/${page.slug}`} className="hover:underline">
                    {page.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-slate-900">Contact</p>
            <ul className="mt-1 space-y-1 text-slate-600">
              {storefront.supportPhone ? (
                <li>
                  <a href={`tel:${storefront.supportPhone}`} className="hover:underline">
                    {storefront.supportPhone}
                  </a>
                </li>
              ) : null}
              {storefront.supportEmail ? (
                <li>
                  <a href={`mailto:${storefront.supportEmail}`} className="hover:underline">
                    {storefront.supportEmail}
                  </a>
                </li>
              ) : null}
              {storefront.addressLine ? <li>{storefront.addressLine}</li> : null}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

function defaultMenu(pages: Array<{ slug: string; title: string }>) {
  return [
    { id: "default-home", label: "Home", url: "/", openInNewTab: false, children: [] },
    { id: "default-products", label: "Products", url: "/products", openInNewTab: false, children: [] },
    ...pages.map((page) => ({ id: `page-${page.slug}`, label: page.title, url: `/pages/${page.slug}`, openInNewTab: false, children: [] })),
  ];
}
