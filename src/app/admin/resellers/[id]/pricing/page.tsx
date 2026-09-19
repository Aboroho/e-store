import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { getResellerDetail } from "@/modules/resellers/queries";
import { listResellerPriceList, listVariantsForPricing } from "@/modules/resellers/service";
import { ResellerPricingPanel } from "@/components/forms/reseller-forms";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reseller pricing" };
export const dynamic = "force-dynamic";

export default async function ResellerPricingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "reseller.view");
  const { id } = await params;

  const detail = await getResellerDetail(session.businessId, id);
  if (!detail) notFound();

  const [priceList, variants] = await Promise.all([listResellerPriceList(session.businessId, id), listVariantsForPricing(session.businessId)]);

  const items = priceList.items.map((item) => ({
    id: item.id,
    sku: item.variant.sku,
    product: item.variant.product.name,
    variant: item.variant.name,
    pricePaisa: item.pricePaisa,
    minQuantity: item.minQuantity,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Pricing · ${detail.reseller.name}`}
        description="Negotiated prices for this reseller. Anything without an override falls back to the default price list, then to the variant price."
      />

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href={`/admin/resellers/${detail.reseller.id}`} className="text-indigo-600 hover:underline">
          ← Back to reseller
        </Link>
        {priceList.priceListId ? (
          <Link href={`/admin/catalog/price-lists/${priceList.priceListId}`} className="text-indigo-600 hover:underline">
            Open the price list
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How a reseller price is chosen</CardTitle>
          <CardDescription>
            A price override here wins. Otherwise the reseller&apos;s price list is consulted for the largest qualifying minimum quantity, and the default list is
            the last resort. The chosen price and its source are snapshotted onto the order line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {priceList.priceListId ? null : <Alert variant="info">This reseller has no price list yet — one is created the first time a price is saved.</Alert>}
        </CardContent>
      </Card>

      <ResellerPricingPanel
        resellerId={detail.reseller.id}
        items={items}
        variants={variants.map((variant) => ({ id: variant.id, label: `${variant.sku} · ${variant.productName} — ${variant.name}` }))}
      />
    </div>
  );
}
