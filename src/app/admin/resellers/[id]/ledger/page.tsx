import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getResellerDetail } from "@/modules/resellers/queries";
import { listResellerLedger } from "@/modules/resellers/earnings";
import { RefreshEligibilityForm, ResellerBalanceSummary } from "@/components/forms/reseller-forms";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { FilterSelect } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Reseller ledger" };
export const dynamic = "force-dynamic";

const LEDGER_TYPES = [
  "EARNING",
  "PACKAGING_CHARGE",
  "COURIER_CHARGE",
  "COD_CHARGE",
  "ADJUSTMENT",
  "PAYOUT",
  "REVERSAL",
  "VOID",
];

export default async function ResellerLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "reseller.ledger_view");
  const [{ id }, search] = await Promise.all([params, searchParams]);

  const detail = await getResellerDetail(session.businessId, id);
  if (!detail) notFound();

  const filterValue = (key: string) => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const ledger = await listResellerLedger(session.businessId, id, {
    page: Number(filterValue("page") ?? 1) || 1,
    pageSize: 50,
    status: filterValue("status"),
    type: filterValue("type"),
  });

  const sums = (
    status: string,
    direction: string,
  ): number =>
    ledger.aggregated
      .filter((row) => row.status === status && row.direction === direction)
      .reduce((total, row) => total + (row._sum.amountPaisa ?? 0), 0);

  const visiblePending = sums("PENDING", "CREDIT") - sums("PENDING", "DEBIT");
  const visibleEligible = sums("ELIGIBLE", "CREDIT") - sums("ELIGIBLE", "DEBIT");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Ledger · ${detail.reseller.name}`}
        description="Every entry is append-only and tied to the order or payout that created it."
        actions={
          <Link href={`/admin/resellers/${detail.reseller.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
            ← Back to reseller
          </Link>
        }
      />

      <ResellerBalanceSummary
        pendingPaisa={detail.balance.pendingPaisa}
        eligiblePaisa={detail.balance.eligiblePaisa}
        allocatedPaisa={detail.balance.allocatedPaisa}
        paidPaisa={detail.balance.paidPaisa}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Entries" value={String(ledger.total)} />
        <StatCard label="Awaiting settlement (filtered)" value={formatPaisa(visiblePending)} tone="warning" />
        <StatCard label="Payable (filtered)" value={formatPaisa(visibleEligible)} tone="success" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Entries</CardTitle>
            <CardDescription>Most recent first.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "PENDING", label: "Awaiting settlement" },
                { value: "ELIGIBLE", label: "Payable" },
                { value: "PAID", label: "Paid" },
                { value: "VOID", label: "Void" },
              ]}
            />
            <FilterSelect
              name="type"
              value={filterValue("type") ?? "ALL"}
              options={[{ value: "ALL", label: "All types" }, ...LEDGER_TYPES.map((type) => ({ value: type, label: type.replace(/_/g, " ").toLowerCase() }))]}
            />
            {can(session, "reseller.ledger_view") ? <RefreshEligibilityForm resellerId={detail.reseller.id} /> : null}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Payout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell className="text-xs">{entry.type.replace(/_/g, " ").toLowerCase()}</TableCell>
                  <TableCell className="text-sm">
                    {entry.description}
                    {entry.reversesEntryId ? <span className="ml-2 text-xs text-rose-600">reversal</span> : null}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${entry.direction === "DEBIT" ? "text-rose-700" : ""}`}>
                    {entry.direction === "DEBIT" ? "−" : "+"}
                    {formatPaisa(entry.amountPaisa)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={entry.status === "ELIGIBLE" ? "success" : entry.status === "PAID" ? "neutral" : entry.status === "VOID" ? "danger" : "warning"}
                    >
                      {entry.status.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.order ? (
                      <Link href={`/admin/orders/${entry.order.id}`} className="text-indigo-600 hover:underline">
                        {entry.order.orderNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {entry.payout ? (
                      <Link href={`/admin/payouts/${entry.payout.id}`} className="text-indigo-600 hover:underline">
                        {entry.payout.payoutNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={ledger.page}
            pageSize={ledger.pageSize}
            total={ledger.total}
            basePath={`/admin/resellers/${id}/ledger`}
            searchParams={search}
          />
        </CardContent>
      </Card>
    </div>
  );
}
