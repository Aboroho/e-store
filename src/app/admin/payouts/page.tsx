import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { parseListQuery } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { listPayouts, payoutStats } from "@/modules/resellers/queries";
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Reseller payouts" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "info" | "brand" | "success" | "danger" | "warning"> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  PROCESSING: "brand",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "reseller.view");
  const params = await searchParams;
  const filterValue = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = parseListQuery(params, { defaultSortBy: "createdAt", allowedSortBy: ["createdAt", "amountPaisa", "status"] });
  const [result, stats] = await Promise.all([
    listPayouts(session.businessId, {
      page: query.page,
      pageSize: query.pageSize,
      search: filterValue("search"),
      status: filterValue("status"),
      resellerId: filterValue("resellerId"),
    }),
    payoutStats(session.businessId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reseller payouts"
        description="A payout moves money the reseller already earned. Amounts are recomputed from the selected ledger entries, so a payout can never exceed the payable balance."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting approval" value={String(stats.awaitingApproval)} tone="warning" />
        <StatCard label="Approved, not paid" value={formatPaisa(stats.approvedPaisa)} tone="brand" />
        <StatCard label="Paid out" value={formatPaisa(stats.paidPaisa)} tone="success" />
        <StatCard label="Cancelled" value={String(stats.cancelled)} hint="Their entries were released back to the payable pool" />
      </div>

      {can(session, "reseller.payout") ? (
        <div className="flex justify-end">
          <Link href="/admin/payouts/new" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            New payout
          </Link>
        </div>
      ) : (
        <Alert variant="info">You have read-only access to payouts.</Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Payouts</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Payout number or reseller" />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "PENDING_APPROVAL", label: "Pending approval" },
                { value: "APPROVED", label: "Approved" },
                { value: "PROCESSING", label: "Processing" },
                { value: "PAID", label: "Paid" },
                { value: "FAILED", label: "Failed" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <EmptyState title="No payouts yet" description="Payouts appear here once a reseller has payable earnings." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payout</TableHead>
                  <TableHead>Reseller</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell>
                      <Link href={`/admin/payouts/${payout.id}`} className="font-medium text-indigo-600 hover:underline">
                        {payout.payoutNumber}
                      </Link>
                      <div className="text-xs text-slate-500">{formatDateTime(payout.createdAt)}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/admin/resellers/${payout.reseller.id}`} className="text-indigo-600 hover:underline">
                        {payout.reseller.name}
                      </Link>
                      <div className="text-xs text-slate-500">{payout.reseller.code}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONES[payout.status] ?? "neutral"}>{payout.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(payout.amountPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{payout._count.entries}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateTime(payout.createdAt)}
                      {payout.requestedByUserId ? "" : " (system)"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{payout.paidAt ? formatDateTime(payout.paidAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/payouts" searchParams={params} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Why a payout cannot be double-paid</CardTitle>
          <CardDescription>
            Each ledger entry can belong to exactly one payout — the database enforces a unique constraint on the ledger entry inside a payout, on top of the
            balance check in the service layer.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Cancelling a payout releases its entries back to the payable pool; paying one moves them to paid. Both paths are audited.
        </CardContent>
      </Card>
    </div>
  );
}
