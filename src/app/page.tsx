import { redirect } from "next/navigation";

/**
 * The public storefront arrives in Stage 5 (per-domain storefront resolution).
 * Until then the root URL leads to the management area, which itself redirects
 * unauthenticated visitors to the sign-in page.
 */
export default function RootPage() {
  redirect("/admin");
}
