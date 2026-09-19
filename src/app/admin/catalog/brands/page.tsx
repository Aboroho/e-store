import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listBrands } from "@/modules/catalog/brands";
import { deleteBrandAction } from "@/modules/catalog/brand-actions";
import { BrandForm } from "@/components/forms/catalog-forms";
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

export const metadata: Metadata = { title: "Brands" };
export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const brands = await listBrands(session.businessId);
  const canManage = can(session, "category.manage");

  return (
    <div className="space-y-6">
      <PageHeader title="Brands" description="Canonical brands with shared logos. Product brand names resolve their logo by exact match." />

      {canManage ? <BrandForm /> : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {brands.length} brand{brands.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Logo</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>State</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell>
                    {brand.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brand.logoUrl} alt={brand.logoAlt ?? brand.name} className="h-10 w-10 rounded border object-contain" />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-slate-800">{brand.name}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{brand.slug}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-slate-500">{brand.website ?? "—"}</TableCell>
                  <TableCell>{brand.isActive ? <Badge variant="success">active</Badge> : <Badge variant="neutral">hidden</Badge>}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <form action={deleteBrandAction.bind(null, brand.id)}>
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          pendingLabel="…"
                          confirm={`Delete ${brand.name}? Products keep their brand name; only the canonical logo is removed.`}
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {brands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    No brands yet — create one above.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canManage
        ? brands.slice(0, 12).map((brand) => (
            <details key={brand.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Edit {brand.name}</summary>
              <div className="mt-4">
                <BrandForm
                  brand={{
                    id: brand.id,
                    name: brand.name,
                    slug: brand.slug,
                    description: brand.description,
                    website: brand.website,
                    logoMediaId: brand.logoMediaId,
                    position: brand.position,
                    isActive: brand.isActive,
                  }}
                />
              </div>
            </details>
          ))
        : null}
    </div>
  );
}
