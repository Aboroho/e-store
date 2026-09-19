import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { parseListQuery } from "@/lib/validation";
import { listResellers, resellerStats } from "@/modules/resellers/queries";
import { ResellerForm } from "@/components/forms/reseller-forms";
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

export const metadata: Metadata = { title: "Resellers" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "success" | "neutral" | "danger"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "danger",
};

export default async function ResellersPage({
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

  const query = parseListQuery(params, { defaultSortBy: "createdAt", allowedSortBy: ["name", "code", "createdAt", "status"] });
  const [result, stats] = await Promise.all([
    listResellers(session.businessId, {
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      search: filterValue("search"),
      status: filterValue("status"),
    }),
    resellerStats(session.businessId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resellers"
        description="Resellers buy at negotiated prices, collect cash from their own customers, and earn the margin. Earnings become payable only after the courier settlement carrying that cash has been reconciled."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active resellers" value={String(stats.active)} tone="success" />
        <StatCard
          label="Awaiting settlement"
          value={formatPaisa(stats.awaitingSettlementPaisa)}
          tone="warning"
          hint="Not payable yet"
        />
        <StatCard
          label="Payable now"
          value={formatPaisa(stats.eligiblePaisa)}
          hint={stats.allocatedPaisa > 0 ? `${formatPaisa(stats.allocatedPaisa)} already claimed by pending payouts` : undefined}
          tone="brand"
        />
        <StatCard label="Paid out (all time)" value={formatPaisa(stats.paidPaisa)} hint={`${stats.payoutsQueued} payout(s) awaiting approval`} />
      </div>

      {can(session, "reseller.manage") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a reseller</CardTitle>
            <CardDescription>A dedicated price list is created automatically for each reseller.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResellerForm />
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">You have read-only access to resellers.</Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All resellers</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Name, code or phone" />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
                { value: "SUSPENDED", label: "Suspended" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <EmptyState title="No resellers yet" description="Add the first reseller to start selling on wholesale terms." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reseller</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Awaiting settlement</TableHead>
                  <TableHead className="text-right">Payable now</TableHead>
                  <TableHead className="text-right">Paid out</TableHead>
                  <TableHead>Price list</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((reseller) => (
                    <TableRow key={reseller.id}>
                      <TableCell>
                        <Link href={`/admin/resellers/${reseller.id}`} className="font-medium text-indigo-600 hover:underline">
                          {reseller.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {reseller.code}
                          {reseller.phone ? ` · ${reseller.phone}` : ""}
                          {reseller.businessName ? ` · ${reseller.businessName}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONES[reseller.status] ?? "neutral"}>{reseller.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{reseller._count.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaisa(reseller.balance.pendingPaisa)}
                        {reseller.balance.pendingPaisa > 0 ? <div className="text-xs text-slate-500">waiting for reconciliation</div> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaisa(reseller.balance.eligiblePaisa)}
                        {reseller.balance.allocatedPaisa > 0 ? (
                          <div className="text-xs text-sky-700">{formatPaisa(reseller.balance.allocatedPaisa)} in a pending payout</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(reseller.balance.paidPaisa)}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {reseller.priceList ? `${reseller.priceList._count.items} negotiated price(s)` : "Default list"}
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/resellers" searchParams={params} />
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Reseller margin is never counted as platform revenue. Payouts move that margin out; the profit report keeps revenue, inventory cost, packaging, courier
        and COD charges as separate lines.
      </p>
    </div>
  );
}
