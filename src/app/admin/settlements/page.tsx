import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { listSettlements } from "@/modules/settlements/service";
import { listCourierProviders } from "@/modules/couriers/service";
import { SettlementImportForm } from "@/components/forms/settlement-forms";
import {
  Alert,
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
} from "@/components/ui/primitives";
import { FilterSelect } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Courier settlements" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  DRAFT: "neutral",
  IMPORTED: "info",
  PARTIALLY_RECONCILED: "warning",
  RECONCILED: "success",
  DISPUTED: "danger",
};

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const params = await searchParams;
  const filterValue = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [result, providers] = await Promise.all([listSettlements(session.businessId, params), listCourierProviders(session.businessId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courier settlements"
        description="Import the courier's statement, match every row to a shipment, and only then does cash-on-delivery money count as collected."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Statements" value={String(result.total)} />
        <StatCard label="Gross collected" value={formatPaisa(result.grossPaisa)} tone="brand" />
        <StatCard label="Net received" value={formatPaisa(result.netPaisa)} hint={`${formatPaisa(result.feesPaisa)} in courier fees`} tone="success" />
      </div>

      {can(session, "courier.reconcile") ? (
        <Card>
          <CardHeader>
            <CardTitle>Import a statement</CardTitle>
          </CardHeader>
          <CardContent>
            <SettlementImportForm providers={providers.map((provider) => ({ code: provider.code, name: provider.name }))} />
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">You have read-only access to settlements.</Alert>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Statements</CardTitle>
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              name="provider"
              value={filterValue("provider") ?? "ALL"}
              options={[{ value: "ALL", label: "All couriers" }, ...providers.map((provider) => ({ value: provider.code, label: provider.name }))]}
            />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "IMPORTED", label: "Imported" },
                { value: "PARTIALLY_RECONCILED", label: "Partially reconciled" },
                { value: "RECONCILED", label: "Reconciled" },
                { value: "DISPUTED", label: "Disputed" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <EmptyState title="No statements imported" description="Export the statement from the courier portal and paste it above." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((settlement) => (
                  <TableRow key={settlement.id}>
                    <TableCell>
                      <Link href={`/admin/settlements/${settlement.id}`} className="font-medium text-indigo-600 hover:underline">
                        {settlement.reference}
                      </Link>
                      {settlement.bankReference ? <div className="text-xs text-slate-500">{settlement.bankReference}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{settlement.providerCode}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {settlement.settlementDate ? formatDateTime(settlement.settlementDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONES[settlement.status] ?? "neutral"}>{settlement.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(settlement.grossCollectedPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPaisa(settlement.courierFeePaisa + settlement.codChargePaisa + settlement.otherDeductionPaisa)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(settlement.netReceivedPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{settlement._count.entries}</TableCell>
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
