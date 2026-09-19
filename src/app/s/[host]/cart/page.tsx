import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveStorefrontByHost } from "@/modules/storefront/queries";
import { CartView } from "@/components/storefront/cart";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const storefront = await resolveStorefrontByHost(decodeURIComponent(host));
  if (!storefront) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Your cart</h1>
      <CartView />
      <p className="text-xs text-slate-500">
        Stock is only reserved when you place the order. <Link href="/products" className="hover:underline">Continue shopping</Link>
      </p>
    </div>
  );
}
