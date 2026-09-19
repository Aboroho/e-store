import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listPriceLists } from "@/modules/catalog/queries";
import { formatDateTime } from "@/lib/utils";
import { Badge, Card, CardContent, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Price lists" };
export const dynamic = "force-dynamic";

export default async function PriceListsPage() {
  const session = await requireSession();
  assertPermission(session, "pricing.manage");

  const priceLists = await listPriceLists(session.businessId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price lists"
        description="Prices live in lists so a storefront, a reseller tier or a wholesale channel can each have their own price. The default list is the fallback."
      />

      <Card>
        <CardContent className="px-0 py-0">
          {priceLists.length === 0 ? (
            <EmptyState title="No price lists" description="Run the seed or create a list through the database migration tooling." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>List</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Storefront</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-center">Priority</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priceLists.map((list) => (
                  <TableRow key={list.id}>
                    <TableCell>
                      <Link href={`/admin/catalog/price-lists/${list.id}`} className="font-medium text-brand-600 hover:underline">
                        {list.name}
                      </Link>
                      {list.isDefault ? (
                        <span className="ml-2">
                          <Badge variant="success">default</Badge>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">{list.channel.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{list.storefrontName ?? "All storefronts"}</TableCell>
                    <TableCell className="text-center tabular-nums">{list._count.items}</TableCell>
                    <TableCell className="text-center tabular-nums">{list.priority}</TableCell>
                    <TableCell className="text-sm text-slate-500">{formatDateTime(list.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
