/**
 * URL helpers shared by the editor (link dialog, pasted links) and the read-only
 * renderer. Both sides apply the same allow-list so a stored document can never
 * smuggle a `javascript:` or `data:` URL into the page.
 */

const LINK_PROTOCOLS = /^(https?:|mailto:|tel:)/i;
const MEDIA_PROTOCOLS = /^(https?:|blob:)/i;
const LOOKS_LIKE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i;

/** Returns a safe link target or null. Relative paths and anchors are allowed. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  return LINK_PROTOCOLS.test(href) ? href : null;
}

/** Returns a safe image/file source or null. */
export function safeSrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const src = value.trim();
  if (!src) return null;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  return MEDIA_PROTOCOLS.test(src) ? src : null;
}

/**
 * Normalises what a person typed into a link field: trims, prefixes `https://` for bare
 * domains and rejects anything outside the allow-list.
 */
export function normalizeLinkInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = safeHref(trimmed);
  if (direct) return direct;
  if (/^www\./i.test(trimmed) || LOOKS_LIKE_DOMAIN.test(trimmed)) return `https://${trimmed}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return null;
}

export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href);
}
