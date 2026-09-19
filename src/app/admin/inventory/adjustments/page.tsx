import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { listAdjustmentReasons, listAdjustments, listLocations, searchVariants } from "@/modules/inventory/queries";
import { availableQuantity } from "@/modules/inventory/service";
import { StockAdjustmentForm } from "@/components/forms/catalog-forms";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Stock adjustments" };
export const dynamic = "force-dynamic";

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "inventory.adjust");
  const params = await searchParams;
  const query = parseListQuery(params);

  const [variants, reasons, locations, { adjustments, total }] = await Promise.all([
    searchVariants(session.businessId, undefined, 200),
    listAdjustmentReasons(session.businessId),
    listLocations(session.businessId),
    listAdjustments(session.businessId, { search: query.search, skip: query.skip, take: query.take }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock adjustments"
        description="Correct the ledger with a documented reason. Adjustments never delete movements — they add a new one."
      />

      <StockAdjustmentForm
        variants={variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          label: `${variant.product.name} — ${variant.name}`,
          available: variant.inventory.reduce((sum, balance) => sum + availableQuantity(balance), 0),
        }))}
        reasons={reasons.map((reason) => ({
          code: reason.code,
          label: reason.label,
          direction: reason.direction,
          requiresNote: reason.requiresNote,
        }))}
        locations={locations.map((location) => ({ id: location.id, name: location.name, isDefault: location.isDefault }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Adjustment history</CardTitle>
          <p className="text-xs text-slate-500">
            {total} adjustment(s) recorded.{" "}
            <Link href="/admin/audit" className="text-brand-600 hover:underline">
              Full audit trail
            </Link>
          </p>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {adjustments.length === 0 ? (
            <EmptyState title="No adjustments recorded" description="Use the form above to record the first stock correction." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(adjustment.createdAt)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/inventory/${adjustment.variantId}`} className="font-medium text-brand-600 hover:underline">
                        {adjustment.variant.product.name}
                      </Link>
                      <p className="font-mono text-xs text-slate-500">{adjustment.variant.sku}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={adjustment.direction === "INCREASE" ? "success" : "danger"}>{adjustment.direction.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{adjustment.condition.toLowerCase()}</TableCell>
                    <TableCell className="text-right tabular-nums">{adjustment.quantity}</TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {adjustment.reasonCode}
                      {adjustment.note ? <p className="text-xs text-slate-500">{adjustment.note}</p> : null}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{adjustment.actorName ?? "System"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/inventory/adjustments" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
