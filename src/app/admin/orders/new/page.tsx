import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { getBusinessSettings } from "@/lib/settings";
import { getCheckoutFields } from "@/modules/orders/checkout-fields";
import { manualOrderContext, resolveSalesContext } from "@/modules/orders/manual";
import { ManualOrderForm, type CheckoutFieldView } from "@/components/orders/manual-order-form";
import { PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Create order" };
export const dynamic = "force-dynamic";

/**
 * Manual order creation.
 *
 * The page only gathers what the form needs to *display* — districts, storefronts,
 * the checkout field configuration and the creator's sales context. Every price,
 * total and the initial status are resolved by the server when the form previews
 * and submits.
 */
export default async function NewOrderPage() {
  const session = await requireSession();
  assertPermission(session, "order.create");

  const context = await manualOrderContext(session);
  const sales = await resolveSalesContext(context);

  const [districts, storefronts, checkoutFields, settings] = await Promise.all([
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    prisma.storefront.findMany({
      where: { businessId: session.businessId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getCheckoutFields(session.businessId),
    getBusinessSettings(session.businessId),
  ]);

  const fields: CheckoutFieldView[] = checkoutFields.map((field) => ({
    key: field.key,
    label: field.customLabel ?? field.label,
    helpText: field.customHelpText ?? field.helpText,
    isEnabled: field.isEnabled,
    isRequired: field.isRequired,
    appliesTo: [...field.appliesTo],
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Order list
        </Link>
      </div>

      <PageHeader
        title="Create order"
        description="Prices, delivery charges, stock and the starting status are resolved on the server — the form only sends what the operator chose."
      />

      <ManualOrderForm
        mode="create"
        districts={districts}
        storefronts={storefronts}
        checkoutFields={fields}
        priceListName={sales.priceListName}
        mayViewCosts={sales.mayViewCosts}
        maxDiscountPercent={Number(settings["order.max_discount_percent"] ?? 100)}
        defaultStorefrontId={storefronts[0]?.id ?? null}
        allowInStore={sales.channel !== "RESELLER"}
      />
    </div>
  );
}
