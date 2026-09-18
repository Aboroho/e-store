import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { searchVariants } from "@/modules/inventory/queries";
import { courierProviders } from "@/modules/orders/queries";
import { OrderForm } from "@/components/forms/order-forms";
import { buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const session = await requireSession();
  assertPermission(session, "order.create");

  const [variants, districts, storefronts, providers] = await Promise.all([
    searchVariants(session.businessId, undefined, 200),
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    prisma.storefront.findMany({ where: { businessId: session.businessId }, select: { id: true, name: true } }),
    courierProviders(session.businessId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to orders
        </Link>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Create order</h1>
        <p className="text-sm text-slate-600">
          Staff-created orders go through exactly the same pricing, reservation and preorder logic as storefront orders —
          nothing is trusted from the form except the chosen variant, quantity and channel.
        </p>
        <p className="text-xs text-slate-500">{providers.length} courier provider(s) configured for dispatch.</p>
      </div>
      <OrderForm
        variants={variants.map((variant) => {
          const available = variant.inventory.reduce(
            (total, balance) => total + (balance.onHand - balance.reserved - balance.damaged - balance.inspection),
            0,
          );
          return {
            id: variant.id,
            sku: variant.sku,
            label: `${variant.product.name} · ${variant.name} (${variant.sku}) — ${available} available`,
            pricePaisa: variant.priceOverridePaisa ?? null,
          };
        })}
        districts={districts}
        storefronts={storefronts}
      />
    </div>
  );
}
