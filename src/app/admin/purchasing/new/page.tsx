import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listSuppliers } from "@/modules/purchasing/queries";
import { searchVariants } from "@/modules/inventory/queries";
import { PurchaseOrderForm } from "@/components/forms/purchase-forms";
import { Alert, PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New purchase order" };
export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const session = await requireSession();
  assertPermission(session, "purchase.create");

  const [suppliers, variants] = await Promise.all([
    listSuppliers(session.businessId),
    searchVariants(session.businessId, undefined, 300),
  ]);

  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);

  return (
    <div className="space-y-4">
      <PageHeader
        title="New purchase order"
        description="Order stock from a supplier. Nothing changes in inventory until you post a goods receipt."
        actions={
          <Link href="/admin/purchasing" className={buttonVariants({ variant: "secondary" })}>
            Back to purchases
          </Link>
        }
      />

      {activeSuppliers.length === 0 ? (
        <Alert variant="warning" title="No active suppliers">
          Add a supplier first on the{" "}
          <Link href="/admin/purchasing/suppliers" className="underline">
            suppliers page
          </Link>
          .
        </Alert>
      ) : null}

      <PurchaseOrderForm
        suppliers={activeSuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        variants={variants.map((variant) => ({
          id: variant.id,
          sku: variant.product?.sku ?? "",
          label: `${variant.product.name} — ${variant.name}`,
          costPaisa: variant.costPaisa,
        }))}
      />
    </div>
  );
}
