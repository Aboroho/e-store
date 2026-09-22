import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getProductForEdit } from "@/modules/catalog/queries";
import { archiveProductAction, restoreProductAction } from "@/modules/catalog/actions";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "product.view");
  const { id } = await params;

  const product = await getProductForEdit(session.businessId, id);
  if (!product) notFound();
  const canUpdate = can(session, "product.update");
  const canArchive = can(session, "product.archive");
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

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={product.status === "ACTIVE" ? "success" : product.status === "DRAFT" ? "warning" : "neutral"}>
          {product.status.toLowerCase()}
        </Badge>
        {product.sku ? <span className="font-mono text-xs text-slate-600">SKU {product.sku}</span> : null}
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

      <Card>
        <CardHeader>
          <CardTitle>Variants</CardTitle>
          <p className="text-xs text-slate-500">
            This page is view-only. Stock lives in Inventory, not on the product record.
          </p>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((variant) => (
                <TableRow key={variant.id}>
                  <TableCell>
                    <span className="font-medium text-slate-900">{variant.name}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {variant.priceOverridePaisa != null ? formatPaisa(variant.priceOverridePaisa) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {variant.costPaisa != null ? formatPaisa(variant.costPaisa) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
