import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy (the file was called `middleware.ts` before Next.js 16).
 *
 * Two jobs, both cheap:
 *
 *  1. a "is there a session cookie at all?" redirect so unauthenticated visitors do
 *     not reach the admin shell — every page, action and API route still re-checks the
 *     session and permission on the server, so this is a convenience, never the
 *     authorisation boundary;
 *  2. storefront host routing: public paths are rewritten onto the internal
 *     `/s/[host]/…` tree, where the storefront is resolved from the Host header. That
 *     is how one deployment serves several storefronts on different domains without
 *     hard-coding any hostname (the mapping is data: StorefrontDomain rows).
 *
 * Security headers are applied in `next.config.ts`.
 */

const SESSION_COOKIE = "estore_session";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

/** Paths handled by the storefront host rewrite (everything else passes through). */
const STOREFRONT_PATHS = ["/products", "/pages", "/cart", "/search"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/admin") && !isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const target = `${pathname}${search}`;
    if (target && target !== "/admin") {
      url.searchParams.set("next", target);
    }
    return NextResponse.redirect(url);
  }

  const isStorefrontPath = pathname === "/" || STOREFRONT_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isStorefrontPath) {
    const host = (request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
    if (host) {
      const url = request.nextUrl.clone();
      url.pathname = `/s/${host}${pathname === "/" ? "" : pathname}`;
      url.search = search;
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/login", "/", "/products/:path*", "/pages/:path*", "/cart", "/search/:path*"],
};
