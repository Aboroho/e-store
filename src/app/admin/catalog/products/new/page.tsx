import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { loadProductEditorData } from "@/modules/catalog/product-queries";
import { ProductEditorForm } from "@/components/forms/product-editor/product-editor-form";
import { Alert, PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await requireSession();
  assertPermission(session, "product.create");

  const data = await loadProductEditorData(session.businessId, {
    canViewCost: can(session, "product.view_cost"),
    canManageMedia: can(session, "media.manage"),
    canUploadMedia: can(session, "media.manage"),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="New product"
        description="Fill in the sections below. Nothing is published until you press “Create product”; “Save as draft” keeps the product invisible to shoppers."
        actions={
          <Link href="/admin/catalog/products" className={buttonVariants({ variant: "secondary" })}>
            Back to products
          </Link>
        }
      />

      {!data.priceListId ? (
        <Alert variant="warning" title="No price list">
          Create a price list first — prices live in price lists so storefronts and resellers can differ. The form stays usable, but saving
          a product without a price list will fail.
        </Alert>
      ) : null}

      <Alert variant="info" title="The whole form is saved in one transaction">
        Product, variants, prices, images and category links are written together, so a half-finished product can never be published.
        Purchase cost is {data.canViewCost ? "visible to you" : "hidden because your role cannot view costs"}.
      </Alert>

      <ProductEditorForm data={data} />
    </div>
  );
}
