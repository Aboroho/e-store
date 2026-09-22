/**
 * Shared staff-auth URLs.
 *
 * Kept free of `server-only` so the edge proxy and the Node session helper can
 * build the same login URL (and the login page can read the same query names).
 */

export const STAFF_LOGIN_PATH = "/login";
export const STAFF_HOME_PATH = "/admin";

/** Safe internal path used after sign-in. Rejects protocol-relative and off-site values. */
export function safeRedirectPath(value: unknown, fallback = STAFF_HOME_PATH): string {
  if (typeof value !== "string") return fallback;
  const target = value.trim();
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/login")) return fallback;
  return target;
}

export function staffLoginPath(input: { redirectTo?: string | null; sessionExpired?: boolean } = {}): string {
  const params = new URLSearchParams();
  const redirectTo = safeRedirectPath(input.redirectTo, "");
  if (redirectTo) params.set("redirectTo", redirectTo);
  if (input.sessionExpired) params.set("sessionExpired", "1");
  const query = params.toString();
  return query ? `${STAFF_LOGIN_PATH}?${query}` : STAFF_LOGIN_PATH;
}
