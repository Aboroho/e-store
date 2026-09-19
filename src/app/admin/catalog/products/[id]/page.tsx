import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getProductForEdit, listAttributes, listCategoryOptions, listPriceLists } from "@/modules/catalog/queries";
import { variantReferenceCounts } from "@/modules/catalog/service";
import { availableQuantity } from "@/modules/inventory/service";
import { archiveProductAction, archiveVariantAction, restoreProductAction } from "@/modules/catalog/actions";
import { BulkVariantEditor, ProductForm } from "@/components/forms/product-form";
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

  const [product, categories, attributes, priceLists] = await Promise.all([
    getProductForEdit(session.businessId, id),
    listCategoryOptions(session.businessId),
    listAttributes(session.businessId),
    listPriceLists(session.businessId),
  ]);
  if (!product) notFound();

  const defaultPriceList = priceLists.find((list) => list.isDefault) ?? priceLists[0];
  const referenceCounts = new Map(
    (await Promise.all(
      product.variants.map(async (variant) => [variant.id, await variantReferenceCounts(variant.id)] as const),
    )).map(([variantId, counts]) => [variantId, counts]),
  );
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
          <Link href="/admin/catalog/products" className={buttonVariants({ variant: "secondary" })}>
            Back to products
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={product.status === "ACTIVE" ? "success" : product.status === "DRAFT" ? "warning" : "neutral"}>
          {product.status.toLowerCase()}
        </Badge>
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
                confirm="Archive this product? It will no longer be sellable."
              >
                Archive product
              </SubmitButton>
            </form>
          )
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock by variant</CardTitle>
          <p className="text-xs text-slate-500">
            Available = on hand − reserved − damaged − inspection. Preorder backlog is tracked separately.
          </p>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.variants.map((variant) => {
                const balance = variant.inventory[0];
                const references = referenceCounts.get(variant.id) ?? { orderItems: 0, purchaseItems: 0, exchangeItems: 0, movements: 0, total: 0 };
                return (
                  <TableRow key={variant.id}>
                    <TableCell>
                      <Link href={`/admin/inventory/${variant.id}`} className="font-medium text-brand-600 hover:underline">
                        {variant.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {variant.attributeValues
                          .map((entry) => `${entry.attributeId.slice(0, 4)}…`)
                          .join(" ") || "default"}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variant.priceOverridePaisa != null ? formatPaisa(variant.priceOverridePaisa) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{variant.costPaisa != null ? formatPaisa(variant.costPaisa) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{balance?.onHand ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{balance?.reserved ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={balance && availableQuantity(balance) <= 0 ? "font-medium text-red-600" : undefined}>
                        {balance ? availableQuantity(balance) : 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {balance ? formatPaisa(balance.averageCostPaisa) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs text-slate-500">
                      {references.total} change(s)
                      {canArchive && variant.status === "ACTIVE" && references.total === 0 ? (
                        <form action={archiveVariantAction.bind(null, variant.id, product.id)} className="mt-1">
                          <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                            Archive
                          </SubmitButton>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canUpdate ? (
        <BulkVariantEditor
          productId={product.id}
          variants={product.variants.map((variant) => ({
            id: variant.id,
            sku: variant.sku,
            name: variant.name,
            pricePaisa: variant.priceOverridePaisa,
            costPaisa: variant.costPaisa,
            compareAtPricePaisa: variant.compareAtPricePaisa,
            status: variant.status,
          }))}
        />
      ) : null}

      {canUpdate ? (
        <ProductForm
          categories={categories.map((category) => ({ id: category.id, name: category.name, path: category.path }))}
          attributes={attributes.map((attribute) => ({
            id: attribute.id,
            name: attribute.name,
            type: attribute.type,
            values: attribute.values.map((value) => ({ id: value.id, value: value.value, colorHex: value.colorHex })),
          }))}
          defaultPriceListName={defaultPriceList?.name ?? "the default price list"}
          product={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            productType: product.productType,
            status: product.status,
            shortDescription: product.shortDescription,
            description: product.description,
            brand: product.brand,
            sku: product.sku,
            barcode: product.barcode,
            unitLabel: product.unitLabel,
            weightGrams: product.weightGrams,
            requiresShipping: product.requiresShipping,
            isFeatured: product.isFeatured,
            isPreorderEnabled: product.isPreorderEnabled,
            preorderNote: product.preorderNote,
            taxRateBps: product.taxRateBps,
            packagingCostPaisa: product.packagingCostPaisa,
            seoTitle: product.seoTitle,
            seoDescription: product.seoDescription,
            categoryIds: product.categories.map((entry) => entry.categoryId),
            primaryCategoryId: product.categories.find((entry) => entry.isPrimary)?.categoryId ?? null,
            attributeIds: product.attributes.map((entry) => entry.attributeId),
            variants: product.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              sku: variant.sku,
              barcode: variant.barcode,
              priceOverridePaisa: variant.priceOverridePaisa,
              compareAtPricePaisa: variant.compareAtPricePaisa,
              costPaisa: variant.costPaisa,
              weightGrams: variant.weightGrams,
              isPreorderEnabled: variant.isPreorderEnabled,
              attributeValueIds: variant.attributeValues.map((entry) => entry.attributeValueId),
            })),
          }}
        />
      ) : null}
    </div>
  );
}
