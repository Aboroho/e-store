import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { loadProductEditorData } from "@/modules/catalog/product-queries";
import { ProductEditorForm } from "@/components/forms/product-editor/product-editor-form";
import { Alert, PageHeader, buttonVariants } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "product.update");
  const { id } = await params;

  const data = await loadProductEditorData(
    session.businessId,
    {
      canViewCost: can(session, "product.view_cost"),
      canManageMedia: can(session, "media.manage"),
      canUploadMedia: can(session, "media.manage"),
      userId: session.id,
    },
    id,
  );
  if (!data.product) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${data.product.name}`}
        description={`${data.product.variants.length} variant(s) · /${data.product.slug} · saved in one transaction with its variants, prices and images.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/admin/catalog/products/${data.product.id}`} className={buttonVariants({ variant: "secondary" })}>
              View product
            </Link>
            <Link href="/admin/catalog/products" className={buttonVariants({ variant: "ghost" })}>
              All products
            </Link>
          </div>
        }
      />

      {!data.priceListId ? (
        <Alert variant="warning" title="No price list">
          Create a price list before pricing this product — saving will fail without one.
        </Alert>
      ) : null}

      <ProductEditorForm data={data} />
    </div>
  );
}
