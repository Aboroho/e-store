import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listCategoryOptions } from "@/modules/catalog/queries";
import { deleteCategoryAction } from "@/modules/catalog/actions";
import { CategoryForm } from "@/components/forms/catalog-forms";
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
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Categories" };
export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const categories = await listCategoryOptions(session.businessId);
  const canManage = can(session, "category.manage");

  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Hierarchical navigation for the storefronts and the product filters." />

      {canManage ? <CategoryForm categories={categories.map((category) => ({ id: category.id, name: category.name, path: category.path }))} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-center">Products</TableHead>
                <TableHead className="text-center">Position</TableHead>
                <TableHead>State</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium text-slate-800">{category.path ?? category.name}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{category.slug}</TableCell>
                  <TableCell className="text-center tabular-nums">{category._count.products}</TableCell>
                  <TableCell className="text-center tabular-nums">{category.position}</TableCell>
                  <TableCell>
                    {category.isActive ? <Badge variant="success">active</Badge> : <Badge variant="neutral">hidden</Badge>}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <form action={deleteCategoryAction.bind(null, category.id)}>
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          pendingLabel="…"
                          confirm={`Delete ${category.name}? Products keep existing but lose this category.`}
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No categories yet — create one above.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canManage
        ? categories.slice(0, 12).map((category) => (
            <details key={category.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Edit {category.path ?? category.name}</summary>
              <div className="mt-4">
                <CategoryForm
                  categories={categories.map((entry) => ({ id: entry.id, name: entry.name, path: entry.path }))}
                  category={{
                    imageMediaId: category.imageMediaId,
                    id: category.id,
                    name: category.name,
                    slug: category.slug,
                    parentId: category.parentId,
                    description: null,
                    position: category.position,
                    isActive: category.isActive,
                    isFeatured: category.isFeatured,
                  }}
                />
              </div>
            </details>
          ))
        : null}
    </div>
  );
}
