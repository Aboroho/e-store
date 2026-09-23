import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { getProductView } from "@/modules/catalog/queries";
import { archiveProductAction, restoreProductAction } from "@/modules/catalog/actions";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  buttonVariants,
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { ProductVariantsPanel } from "./product-variants-panel";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "product.view");
  const { id } = await params;

  const product = await getProductView(session.businessId, id);
  if (!product) notFound();
  const canUpdate = can(session, "product.update");
  const canArchive = can(session, "product.delete");
  const archiveProduct = archiveProductAction.bind(null, product.id);
  const restoreProduct = restoreProductAction.bind(null, product.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={product.name}
        description={`${product.productType.toLowerCase()} product · ${product.variants.length} variant(s) · /${product.slug}`}
        actions={
          <div className="flex items-center gap-2">
            {canUpdate ? (
              <Link href={`/admin/catalog/products/${product.id}/edit`} className={buttonVariants({})}>
                Edit product
              </Link>
            ) : null}
            <Link href="/admin/catalog/products" className={buttonVariants({ variant: "secondary" })}>
              Back to products
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {product.image?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- media is served from storage/CDN hosts
            <img src={product.image.url} alt={product.image.alt || product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <ImageIcon className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant={product.status === "ACTIVE" ? "success" : product.status === "DRAFT" ? "warning" : "neutral"}>
            {product.status.toLowerCase()}
          </Badge>
          {product.sku ? <span className="font-mono text-xs text-slate-600">SKU {product.sku}</span> : null}
          {product.brand ? <span className="text-slate-600">{product.brand}</span> : null}
          <span className="text-slate-500">Updated {formatDateTime(product.updatedAt)}</span>
          {canArchive ? (
            product.deletedAt ? (
              <form action={restoreProduct}>
                <SubmitButton variant="outline" size="sm" pendingLabel="Restoring…">
                  Restore product
                </SubmitButton>
              </form>
            ) : (
              <form action={archiveProduct}>
                <SubmitButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Archiving…"
                  confirmTitle="Archive this product?"
                  confirm="It will no longer be sellable. Restore it from the bin if you change your mind."
                >
                  Archive product
                </SubmitButton>
              </form>
            )
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variants</CardTitle>
          <p className="text-xs text-slate-500">
            This page is view-only except for deleting variants. Stock lives in Inventory, not on the product record.
          </p>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <ProductVariantsPanel
            productId={product.id}
            productName={product.name}
            productPreorder={product.isPreorderEnabled}
            variants={product.variants}
            canEdit={canUpdate}
          />
        </CardContent>
      </Card>

      {canUpdate ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit this product</CardTitle>
            <p className="text-xs text-slate-500">
              The editor changes the product, its variants, prices, images, categories, attributes and SEO in one place.
            </p>
          </CardHeader>
          <CardContent>
            <Link href={`/admin/catalog/products/${product.id}/edit`} className={buttonVariants({})}>
              Open the product editor
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
