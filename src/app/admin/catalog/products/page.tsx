import type { Metadata } from "next";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import { listCategoryOptions, listProducts } from "@/modules/catalog/queries";
import { PageHeader, Badge, Card, CardContent, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, buttonVariants } from "@/components/ui/primitives";
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination, SortableHead } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  ARCHIVED: "neutral",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "product.view");
  const params = await searchParams;

  const query = parseListQuery(params, {
    defaultSortBy: "updatedAt",
    allowedSortBy: ["name", "updatedAt", "createdAt"],
  });
  const status = typeof params.status === "string" ? params.status : undefined;
  const categoryId = typeof params.categoryId === "string" ? params.categoryId : undefined;

  const [{ rows, total }, categories] = await Promise.all([
    listProducts(session.businessId, {
      search: query.search,
      status,
      categoryId,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      skip: query.skip,
      take: query.take,
    }),
    listCategoryOptions(session.businessId),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Catalog with variants, pricing and live stock. Archived products keep their history."
        actions={
          can(session, "product.create") ? (
            <Link href="/admin/catalog/products/new" className={buttonVariants({ variant: "default" })}>
              <Plus className="mr-1 h-4 w-4" /> New product
            </Link>
          ) : null
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 border-b border-slate-100">
          <SearchForm defaultValue={query.search} placeholder="Search name, brand or SKU" />
          <FilterSelect
            name="status"
            label="Status"
            value={status ?? "ALL"}
            options={[
              { value: "ALL", label: "All statuses" },
              { value: "ACTIVE", label: "Active" },
              { value: "DRAFT", label: "Draft" },
              { value: "ARCHIVED", label: "Archived" },
            ]}
          />
          <FilterSelect
            name="categoryId"
            label="Category"
            value={categoryId ?? ""}
            options={[{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.path ?? category.name }))]}
          />
        </CardContent>

        {rows.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No products yet"
              description="Create your first product — you can add variants, prices and stock right away."
              action={
                can(session, "product.create") ? (
                  <Link href="/admin/catalog/products/new" className={buttonVariants({ variant: "default" })}>
                    <Package className="mr-1 h-4 w-4" /> New product
                  </Link>
                ) : null
              }
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Product" field="name" currentSortBy={query.sortBy} currentSortDir={query.sortDir} basePath="/admin/catalog/products" searchParams={params} />
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Variants</TableHead>
                <TableHead className="text-right">From</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/catalog/products/${product.id}`} className="font-medium text-brand-600 hover:underline">
                        {product.name}
                      </Link>
                      {product.isFeatured ? <Badge variant="violet">featured</Badge> : null}
                    </div>
                    <p className="text-xs text-slate-500">
                      {product.brand ? `${product.brand} · ` : ""}
                      {product.slug}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[product.status] ?? "neutral"}>{product.status.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{product.variantCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {product.priceFromPaisa != null ? formatPaisa(product.priceFromPaisa) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{product.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={product.available <= 0 ? "font-medium text-red-600" : undefined}>{product.available}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/catalog/products/${product.id}`} className={cn("text-sm font-medium text-brand-600 hover:underline")}>
                      {can(session, "product.update") ? "Edit" : "View"}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/catalog/products" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
