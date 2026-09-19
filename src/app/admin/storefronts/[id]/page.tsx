import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, buttonVariants } from "@/components/ui/primitives";
import { DomainForm, NavigationForm, StorefrontForm } from "@/components/forms/page-forms";
import { getStorefront } from "@/modules/storefront/queries";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Storefront" };
export const dynamic = "force-dynamic";

export default async function StorefrontDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "storefront.manage");
  const { id } = await params;

  let storefront;
  try {
    storefront = await getStorefront(session.businessId, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const pages = await prisma.page.findMany({
    where: { storefrontId: storefront.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, title: true, slug: true, status: true, isHomepage: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={storefront.name}
        description={`/${storefront.slug} · ${storefront.domains.length} domain${storefront.domains.length === 1 ? "" : "s"} · theme "${storefront.themeKey}"`}
        actions={
          <Link href="/admin/pages" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Pages
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storefront settings</CardTitle>
          </CardHeader>
          <CardContent>
            <StorefrontForm
              storefront={{
                id: storefront.id,
                name: storefront.name,
                slug: storefront.slug,
                description: storefront.description,
                themeKey: storefront.themeKey,
                themeConfig: (storefront.themeConfig as Record<string, unknown> | null) ?? {},
                supportPhone: storefront.supportPhone,
                supportEmail: storefront.supportEmail,
                addressLine: storefront.addressLine,
                codEnabled: storefront.codEnabled,
                preorderEnabled: storefront.preorderEnabled,
                freeDeliveryThresholdPaisa: storefront.freeDeliveryThresholdPaisa,
                defaultPriceListId: storefront.defaultPriceListId,
                defaultLocationId: storefront.defaultLocationId,
              }}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Domains</CardTitle>
            </CardHeader>
            <CardContent>
              <DomainForm
                storefrontId={storefront.id}
                domains={storefront.domains.map((domain) => ({ id: domain.id, host: domain.host, status: domain.status, isPrimary: domain.isPrimary }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Catalogue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>Prices come from this storefront&apos;s price list, falling back to the default list and then the variant override.</p>
              <p>Inventory is shared with every other storefront — stock is reserved from the same location.</p>
              <div className="flex gap-2 pt-1">
                <Link href="/admin/catalog/price-lists" className="text-indigo-600 hover:underline">
                  Price lists
                </Link>
                <Link href="/admin/inventory" className="text-indigo-600 hover:underline">
                  Inventory
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Navigation menus</CardTitle>
          </CardHeader>
          <CardContent>
            <NavigationForm
              storefrontId={storefront.id}
              menus={storefront.navigationMenus.map((menu) => ({
                id: menu.id,
                handle: menu.handle,
                name: menu.name,
                items: menu.items.map((item) => ({ id: item.id, label: item.label, type: item.type, url: item.url })),
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pages</CardTitle>
          </CardHeader>
          <CardContent>
            {pages.length === 0 ? (
              <p className="text-sm text-slate-500">No pages yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((page) => (
                    <TableRow key={page.id}>
                      <TableCell>
                        {page.title}
                        {page.isHomepage ? <Badge variant="brand" className="ml-2">homepage</Badge> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={page.status === "PUBLISHED" ? "success" : "warning"}>{page.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/admin/pages/${page.id}/builder`} className="text-sm text-indigo-600 hover:underline">
                          Builder
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
