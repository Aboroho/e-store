import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { PageForm } from "@/components/forms/page-forms";
import { listPages } from "@/modules/page-builder/service";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Pages" };
export const dynamic = "force-dynamic";

export default async function PagesScreen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  assertPermission(session, "page.manage");

  const params = await searchParams;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  const storefrontId = Array.isArray(params.storefront) ? params.storefront[0] : params.storefront;

  const [pages, storefronts] = await Promise.all([
    listPages(session.businessId, { status: status && status !== "all" ? status : undefined, storefrontId: storefrontId && storefrontId !== "all" ? storefrontId : undefined }),
    prisma.storefront.findMany({ where: { businessId: session.businessId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, slug: true, status: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Pages" description="Storefront pages built with the page builder: sections, widgets, drafts and published versions." />

      {storefronts.length === 0 ? (
        <Alert variant="warning">
          No storefront exists yet. Create one under <Link href="/admin/storefronts" className="underline">Storefronts</Link> before publishing pages.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">All pages</CardTitle>
            <form className="flex gap-2" action="/admin/pages">
              <select name="status" defaultValue={status ?? "all"} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="all">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select name="storefront" defaultValue={storefrontId ?? "all"} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="all">All storefronts</option>
                {storefronts.map((storefront) => (
                  <option key={storefront.id} value={storefront.id}>
                    {storefront.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                Filter
              </button>
            </form>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <EmptyState title="No pages yet" description="Create your first page to use the builder." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Storefront</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((page) => (
                    <TableRow key={page.id}>
                      <TableCell className="font-medium">
                        {page.title}
                        {page.isHomepage ? <Badge variant="brand" className="ml-2">homepage</Badge> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">/{page.slug}</TableCell>
                      <TableCell className="text-slate-500">{page.storefront?.name ?? "All storefronts"}</TableCell>
                      <TableCell>
                        <Badge variant={page.status === "PUBLISHED" ? "success" : page.status === "DRAFT" ? "warning" : "neutral"}>{page.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell>
                        v{page.currentVersion}
                        {page.draftVersionId ? <span className="ml-2 text-xs text-amber-600">draft</span> : null}
                      </TableCell>
                      <TableCell className="text-slate-500">{formatDateTime(page.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/pages/${page.id}/builder`} className="text-sm text-indigo-600 hover:underline">
                          Builder
                        </Link>
                        <span className="mx-2 text-slate-300">|</span>
                        <Link href={`/admin/pages/${page.id}`} className="text-sm text-slate-600 hover:underline">
                          Settings
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">New page</CardTitle>
          </CardHeader>
          <CardContent>
            <PageForm storefronts={storefronts} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
