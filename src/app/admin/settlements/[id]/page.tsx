import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getSettlementDetail } from "@/modules/settlements/service";
import { SettlementEntryResolveForm, SettlementReconcileForm } from "@/components/forms/settlement-forms";
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Settlement" };
export const dynamic = "force-dynamic";

const ENTRY_TONES: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  MATCHED: "success",
  UNMATCHED: "warning",
  DISPUTED: "danger",
  IGNORED: "neutral",
};

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const { id } = await params;

  const detail = await getSettlementDetail(session.businessId, id).catch(() => null);
  if (!detail) notFound();

  const { settlement, provider, summary } = detail;
  const canReconcile = can(session, "courier.reconcile");
  const openRows = settlement.entries.filter((entry) => entry.status === "UNMATCHED" || entry.status === "DISPUTED");

  return (
    <div className="space-y-6">
      <Link href="/admin/settlements" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> All settlements
      </Link>

      <PageHeader
        title={settlement.reference}
        description={`${provider?.name ?? settlement.providerCode}${settlement.settlementDate ? ` · ${formatDateTime(settlement.settlementDate)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={settlement.status === "RECONCILED" ? "success" : settlement.status === "DISPUTED" ? "danger" : "warning"}>
              {settlement.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
            <Badge variant="neutral">{settlement.entries.length} row(s)</Badge>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Gross collected</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular-nums">{formatPaisa(settlement.grossCollectedPaisa)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Courier fees</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular-nums">
            {formatPaisa(settlement.courierFeePaisa + settlement.codChargePaisa + settlement.otherDeductionPaisa)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Net received</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular-nums">{formatPaisa(settlement.netReceivedPaisa)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wide text-slate-500">Unmatched value</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular-nums">
            {formatPaisa(settlement.entries.filter((entry) => entry.status === "UNMATCHED").reduce((total, entry) => total + entry.netPaisa, 0))}
          </CardContent>
        </Card>
      </div>

      {openRows.length > 0 ? (
        <Alert variant="warning">
          {openRows.length} row(s) still need a decision. Rows with a tracking code that matches a shipment are matched automatically — the rest
          must be linked to a shipment or explicitly ignored before reconciling.
        </Alert>
      ) : null}

      {canReconcile ? (
        <Card>
          <CardHeader>
            <CardTitle>Reconcile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-500">
              {summary.byStatus.MATCHED ?? 0} matched · {summary.byStatus.UNMATCHED ?? 0} unmatched · {summary.byStatus.IGNORED ?? 0} ignored ·
              discrepancies {formatPaisa(summary.discrepancyPaisa)}
            </p>
            <SettlementReconcileForm settlementId={settlement.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Statement rows</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Shipment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                {canReconcile ? <TableHead>Resolve</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlement.entries.length === 0 ? (
                <TableEmpty colSpan={canReconcile ? 8 : 7} message="This statement has no rows" />
              ) : (
                settlement.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="text-xs text-slate-700">{entry.trackingCode ?? entry.reference ?? "—"}</div>
                      {entry.order ? (
                        <Link href={`/admin/orders/${entry.order.id}`} className="text-xs text-indigo-600 hover:underline">
                          {entry.order.orderNumber}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.shipment ? (
                        <Link href={`/admin/shipments/${entry.shipment.id}`} className="text-indigo-600 hover:underline">
                          {entry.shipment.internalCode}
                        </Link>
                      ) : (
                        <span className="text-slate-400">no match</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ENTRY_TONES[entry.status] ?? "neutral"}>{entry.status.toLowerCase()}</Badge>
                      {entry.discrepancyReason ? <div className="mt-1 text-[11px] text-slate-500">{entry.discrepancyReason}</div> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(entry.grossPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPaisa(entry.courierFeePaisa + entry.codChargePaisa + entry.otherDeductionPaisa)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(entry.netPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{entry.discrepancyPaisa !== 0 ? formatPaisa(entry.discrepancyPaisa) : "—"}</TableCell>
                    {canReconcile ? (
                      <TableCell>
                        {entry.status === "UNMATCHED" || entry.status === "DISPUTED" ? (
                          <SettlementEntryResolveForm entryId={entry.id} settlementId={settlement.id} />
                        ) : (
                          <span className="text-xs text-slate-400">settled</span>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
