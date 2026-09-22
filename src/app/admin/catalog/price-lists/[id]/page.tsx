import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { getPriceListWithItems } from "@/modules/catalog/queries";
import { PriceListEditor } from "@/components/forms/catalog-forms";
import { Badge, PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Price list" };
export const dynamic = "force-dynamic";

export default async function PriceListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "pricing.manage");
  const { id } = await params;

  const data = await getPriceListWithItems(session.businessId, id);
  if (!data) notFound();

  const { priceList, variants } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={priceList.name}
        description={`${priceList.channel.toLowerCase()} channel · ${variants.length} variant(s) shown`}
        actions={
          <Link href="/admin/catalog/price-lists" className={buttonVariants({ variant: "secondary" })}>
            Back to price lists
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        {priceList.isDefault ? <Badge variant="success">default list</Badge> : null}
        <span>Currency BDT</span>
        <span>
          Validity: {priceList.validFrom ? priceList.validFrom.toISOString().slice(0, 10) : "always"} →{" "}
          {priceList.validTo ? priceList.validTo.toISOString().slice(0, 10) : "open"}
        </span>
      </div>

      <PriceListEditor
        priceListId={priceList.id}
        variants={variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku ?? "",
          name: variant.name,
          productName: variant.product.name,
          currentPricePaisa: variant.priceItems[0]?.pricePaisa ?? variant.priceOverridePaisa ?? null,
        }))}
      />
    </div>
  );
}
