import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge proxy (the file was called `middleware.ts` before Next.js 16).
 *
 * Deliberately narrow: this only performs a cheap "is there a session cookie at
 * all?" redirect so unauthenticated visitors do not reach the admin shell.
 * Every page, server action and API route re-checks the session and the
 * required permission on the server — the proxy is a convenience, never the
 * authorisation boundary. Security headers are applied in `next.config.ts`.
 */

const SESSION_COOKIE = "estore_session";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/login"],
};
