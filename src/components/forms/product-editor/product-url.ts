/**
 * Storefront URL preview for the slug field.
 *
 * The editor never claims a product is published: this is only where the storefront
 * *would* serve it once it is active and the storefront is live.
 */
export function slugPreview(prefix: string | null, slug: string): string {
  const trimmed = slug.trim();
  if (!prefix) return `/${trimmed || "…"}`;
  return `${prefix}${trimmed || "…"}`;
}
