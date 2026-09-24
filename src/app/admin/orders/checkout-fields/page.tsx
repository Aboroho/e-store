import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { getCheckoutFields } from "@/modules/orders/checkout-fields";
import { CheckoutFieldsEditor } from "@/components/orders/checkout-fields-editor";
import { PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Checkout fields" };
export const dynamic = "force-dynamic";

/**
 * Orders → Checkout fields.
 *
 * Configures which customer-facing fields are asked for, and which of them are
 * required, for the manual order screen and the public checkout. The defaults
 * match the behaviour the platform always had, so opening this page never
 * silently relaxes the checkout.
 */
export default async function CheckoutFieldsPage() {
  const session = await requireSession();
  assertPermission(session, "order.view");

  const [fields, storefronts] = await Promise.all([
    getCheckoutFields(session.businessId),
    prisma.storefront.findMany({
      where: { businessId: session.businessId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Order list
        </Link>
      </div>

      <PageHeader
        title="Checkout fields"
        description="Phone, name, district, address, area and email — enable them, make them required, rename them and choose the order they are asked in. In-store sales never require customer details."
      />

      <CheckoutFieldsEditor fields={fields} storefronts={storefronts} mayManage={can(session, "checkout_fields.manage")} />
    </div>
  );
}
