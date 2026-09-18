import type { Metadata } from "next";
import Link from "next/link";
import { Plus, RotateCcw } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { exchangeStats, listExchanges } from "@/modules/orders/queries";
import {
  Badge,
  Card,
  CardContent,
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
  buttonVariants,
} from "@/components/ui/primitives";
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Exchanges" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  REQUESTED: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  IN_TRANSIT: "violet",
  RECEIVED: "violet",
  INSPECTED: "brand",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export default async function ExchangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "exchange.view");
  const params = await searchParams;
  const filterValue = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [stats, result] = await Promise.all([
    exchangeStats(session.businessId),
    listExchanges(session.businessId, {
      search: typeof params.q === "string" ? params.q : undefined,
      status: filterValue("status"),
      page: Number.parseInt(String(filterValue("page") ?? "1"), 10) || 1,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exchanges"
        description="Exchanges run against delivered orders: returned items go to inspection, replacements come out of inventory, and the difference is collected or refunded."
        actions={
          can(session, "exchange.create") ? (
            <Link href="/admin/exchanges/new" className={buttonVariants({ variant: "default" })}>
              <Plus className="mr-2 h-4 w-4" /> New exchange
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting review" value={String(stats.requested)} icon={<RotateCcw className="h-4 w-4" />} tone={stats.requested > 0 ? "warning" : "slate"} />
        <StatCard label="In progress" value={String(stats.inTransit)} tone="brand" />
        <StatCard label="Completed" value={String(stats.completed)} tone="success" />
        <StatCard label="To collect" value={formatPaisa(stats.payablePaisa)} tone={stats.payablePaisa > 0 ? "violet" : "slate"} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All exchanges</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Exchange, order, reason or phone" defaultValue={typeof params.q === "string" ? params.q : ""} />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "REQUESTED", label: "Requested" },
                { value: "APPROVED", label: "Approved" },
                { value: "RECEIVED", label: "Received" },
                { value: "INSPECTED", label: "Inspected" },
                { value: "COMPLETED", label: "Completed" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.rows.length === 0 ? (
            <EmptyState title="No exchanges yet" description="Start one from a delivered order or with the button above." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exchange</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((exchange) => (
                    <TableRow key={exchange.id}>
                      <TableCell>
                        <Link href={`/admin/exchanges/${exchange.id}`} className="font-medium text-indigo-600 hover:underline">
                          {exchange.exchangeNumber}
                        </Link>
                        <div className="text-xs text-slate-500">{exchange.reasonCode.replace(/_/g, " ").toLowerCase()}</div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/orders/${exchange.order.id}`} className="text-sm text-indigo-600 hover:underline">
                          {exchange.order.orderNumber}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {exchange.order.customerName ?? exchange.order.customerPhone ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {exchange.items.reduce((total, item) => total + (item.direction === "RETURN" ? item.quantity : 0), 0)} returned ·{" "}
                        {exchange.items.reduce((total, item) => total + (item.direction === "REPLACEMENT" ? item.quantity : 0), 0)} out
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONES[exchange.status] ?? "neutral"}>{exchange.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {exchange.differencePaisa > 0 ? `collect ${formatPaisa(exchange.differencePaisa)}` : exchange.differencePaisa < 0 ? `refund ${formatPaisa(-exchange.differencePaisa)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(exchange.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/exchanges" searchParams={params} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
