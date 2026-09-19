import type { Metadata } from "next";
import Link from "next/link";
import { checkoutCatalog, resolveStorefront } from "@/modules/orders/checkout";
import { listDistricts } from "@/modules/settings/queries";
import { prisma } from "@/lib/db/client";
import { CheckoutForm } from "@/components/forms/checkout-form";
import { Alert, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const rawItems = Array.isArray(query.items) ? query.items[0] : query.items;
  // The storefront cart hands items over as `variantId:quantity` pairs. They are
  // treated as a wish list only — the order service re-resolves everything.
  const initialCart = (rawItems ?? "")
    .split(",")
    .map((pair) => pair.split(":"))
    .filter(([variantId, quantity]) => Boolean(variantId) && Number(quantity) > 0)
    .map(([variantId, quantity]) => ({ variantId: variantId!, quantity: Math.min(50, Number(quantity)) }));

  let storefront;
  try {
    storefront = await resolveStorefront();
  } catch {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <Alert variant="warning">
          No storefront is published yet. Create one in the admin, then come back to place a test order.
        </Alert>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Sign in to the admin
        </Link>
      </main>
    );
  }

  const [variants, districts, zones] = await Promise.all([
    checkoutCatalog(storefront),
    listDistricts(),
    prisma.deliveryZone.findMany({
      where: { businessId: storefront.businessId, isActive: true, OR: [{ storefrontId: storefront.id }, { storefrontId: null }] },
      orderBy: { districtCode: "asc" },
      select: { districtCode: true, feePaisa: true, freeDeliveryThresholdPaisa: true, estimatedDaysMin: true, estimatedDaysMax: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>
        <p className="text-sm text-slate-500">
          Orders placed here reserve stock immediately. Prices, delivery fees and totals are always recalculated on the server.
        </p>
      </header>

      <CheckoutForm
        storefront={{
          id: storefront.id,
          slug: storefront.slug,
          name: storefront.name,
          codEnabled: storefront.codEnabled,
          freeDeliveryThresholdPaisa: storefront.freeDeliveryThresholdPaisa,
        }}
        variants={variants.map((variant) => ({
          variantId: variant.variantId,
          sku: variant.sku,
          variantName: variant.variantName,
          productName: variant.productName,
          pricePaisa: variant.pricePaisa,
          available: variant.available,
          isPreorderEnabled: variant.isPreorderEnabled,
          attributes: variant.attributes,
        }))}
        districts={districts.map((district) => ({ code: district.code, name: district.name }))}
        zones={zones}
        initialCart={initialCart}
      />
    </main>
  );
}
