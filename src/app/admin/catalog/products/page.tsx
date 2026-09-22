import type { Metadata } from "next";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { listCategoryOptions, listProducts } from "@/modules/catalog/queries";
import { PageHeader, Card, CardContent, EmptyState, buttonVariants } from "@/components/ui/primitives";
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";
import { ProductListTable } from "./product-list-table";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

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
        description="Catalogue of products and variants. Stock lives in Inventory — this list does not show on-hand quantities."
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
              description="Create your first product. Stock is received later through purchasing, not here."
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
          <ProductListTable
            products={rows}
            canEdit={can(session, "product.update")}
            canDelete={can(session, "product.delete") || can(session, "product.update")}
          />
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/catalog/products" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
