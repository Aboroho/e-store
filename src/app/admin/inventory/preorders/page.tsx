import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { listPreorderCommitments, preorderBacklog } from "@/modules/preorders/queries";
import { listLocations } from "@/modules/inventory/queries";
import { cancelPreorderAction } from "@/modules/preorders/actions";
import { PreorderAllocationForm } from "@/components/forms/catalog-forms";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { FilterSelect, SubmitButton } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Preorders" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  OPEN: "warning",
  PARTIALLY_ALLOCATED: "info",
  ALLOCATED: "success",
  FULFILLED: "success",
  CANCELLED: "neutral",
};

export default async function PreordersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "preorder.view");
  const params = await searchParams;
  const query = parseListQuery(params);
  const status = typeof params.status === "string" ? params.status : undefined;

  const [{ commitments, total, summary }, backlog, locations] = await Promise.all([
    listPreorderCommitments(session.businessId, { status, search: query.search, skip: query.skip, take: query.take }),
    preorderBacklog(session.businessId),
    listLocations(session.businessId),
  ]);

  const outstandingUnits = summary.reduce(
    (sum, row) => sum + (row._sum.quantity ?? 0) - (row._sum.allocatedQuantity ?? 0),
    0,
  );
  const openCommitments = summary
    .filter((row) => row.status === "OPEN" || row.status === "PARTIALLY_ALLOCATED")
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preorders"
        description="Customer commitments for stock that has not arrived yet. Allocations always serve the oldest commitment first."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open commitments" value={openCommitments} hint="Awaiting stock" tone={openCommitments > 0 ? "warning" : "success"} />
        <StatCard label="Units still outstanding" value={outstandingUnits} />
        <StatCard label="Variants with backlog" value={backlog.length} />
      </div>

      {can(session, "preorder.allocate") ? (
        <PreorderAllocationForm
          backlog={backlog.map((entry) => ({
            variantId: entry.variantId,
            sku: entry.sku,
            productName: `${entry.productName} — ${entry.variantName}`,
            outstanding: entry.outstanding,
          }))}
          locations={locations.map((location) => ({ id: location.id, name: location.name, isDefault: location.isDefault }))}
        />
      ) : null}

      {backlog.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Backlog by variant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {backlog.slice(0, 10).map((entry) => (
              <div key={entry.variantId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">
                    {entry.productName} — {entry.variantName}
                  </span>
                  <span className="tabular-nums text-slate-600">
                    {entry.outstanding} unit(s) across {entry.commitments} commitment(s)
                  </span>
                </div>
                <Progress value={Math.min(entry.outstanding, 50)} max={50} tone={entry.outstanding > 20 ? "danger" : "warning"} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 border-b border-slate-100">
          <FilterSelect
            name="status"
            label="Status"
            value={status ?? "ALL"}
            options={[
              { value: "ALL", label: "All statuses" },
              { value: "OPEN", label: "Open" },
              { value: "PARTIALLY_ALLOCATED", label: "Partially allocated" },
              { value: "ALLOCATED", label: "Allocated" },
              { value: "FULFILLED", label: "Fulfilled" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
          />
        </CardContent>

        {commitments.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No preorder commitments"
              description="When a customer orders an out-of-stock variant that allows preorders, the commitment appears here with its queue position."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queued</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                {can(session, "preorder.allocate") ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((commitment) => (
                <TableRow key={commitment.id}>
                  <TableCell className="whitespace-nowrap text-sm text-slate-600">{formatDateTime(commitment.priorityAt)}</TableCell>
                  <TableCell>
                    <Link href={`/admin/inventory/${commitment.variantId}`} className="font-medium text-brand-600 hover:underline">
                      {commitment.variant.product.name}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">{commitment.variant.sku}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {commitment.order ? (
                      <>
                        <span className="font-mono text-xs text-slate-700">{commitment.order.orderNumber}</span>
                        <p className="text-xs text-slate-500">{commitment.order.customerName ?? "—"}</p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">No linked order</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{commitment.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{commitment.allocatedQuantity}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[commitment.status] ?? "neutral"}>{commitment.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] text-xs text-slate-500">{commitment.note ?? "—"}</TableCell>
                  {can(session, "preorder.allocate") ? (
                    <TableCell className="text-right">
                      {commitment.status === "FULFILLED" || commitment.status === "CANCELLED" ? (
                        <span className="text-xs text-slate-400">closed</span>
                      ) : (
                        <form action={cancelPreorderAction.bind(null, commitment.id, "Cancelled from the preorder queue")}>
                          <SubmitButton variant="ghost" size="sm" pendingLabel="…" confirm="Cancel this preorder commitment and release its reserved stock?">
                            Cancel
                          </SubmitButton>
                        </form>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/inventory/preorders" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
