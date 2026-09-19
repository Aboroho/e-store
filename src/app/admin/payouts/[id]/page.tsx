import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getPayoutDetail } from "@/modules/resellers/queries";
import { PayoutDecisionForm } from "@/components/forms/reseller-forms";
import {
  Alert,
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

export const metadata: Metadata = { title: "Payout" };
export const dynamic = "force-dynamic";

export default async function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "reseller.view");
  const { id } = await params;

  const detail = await getPayoutDetail(session.businessId, id);
  if (!detail) notFound();
  const { payout } = detail;

  const coveredPaisa = payout.entries.reduce(
    (total, entry) => total + (entry.ledgerEntry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={payout.payoutNumber}
        description={`${payout.reseller.name} · ${payout.reseller.code}`}
        actions={
          <Link href={`/admin/resellers/${payout.reseller.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
            Open reseller
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Amount" value={formatPaisa(payout.amountPaisa)} tone="brand" />
        <StatCard label="Entries covered" value={String(payout.entries.length)} hint={`${formatPaisa(coveredPaisa)} of signed amounts`} />
        <StatCard label="Status" value={payout.status.replace(/_/g, " ").toLowerCase()} tone={payout.status === "PAID" ? "success" : payout.status === "FAILED" ? "danger" : "warning"} />
        <StatCard label="Method" value={payout.method.replace(/_/g, " ").toLowerCase()} hint={payout.accountNumber ?? "no account recorded"} />
      </div>

      {payout.amountPaisa > coveredPaisa ? (
        <Alert variant="danger">
          The payout amount exceeds the entries it covers — this should be impossible and means data was modified outside the service layer. Investigate before
          paying.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>A payout is a two-person step when approvals are separated: request, approve, pay.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Reference / note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Requested</TableCell>
                <TableCell className="text-sm">{detail.requestedByName ?? "system"}</TableCell>
                <TableCell className="text-xs text-slate-500">{formatDateTime(payout.createdAt)}</TableCell>
                <TableCell className="text-sm">{payout.note ?? "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Approved</TableCell>
                <TableCell className="text-sm">{detail.approvedByName ?? "—"}</TableCell>
                <TableCell className="text-xs text-slate-500">{payout.approvedAt ? formatDateTime(payout.approvedAt) : "—"}</TableCell>
                <TableCell className="text-sm">{payout.approvedAt ? "approved" : "—"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Paid</TableCell>
                <TableCell className="text-sm">{detail.paidByName ?? "—"}</TableCell>
                <TableCell className="text-xs text-slate-500">{payout.paidAt ? formatDateTime(payout.paidAt) : "—"}</TableCell>
                <TableCell className="text-sm">{payout.transactionReference ?? "—"}</TableCell>
              </TableRow>
              {payout.failureReason ? (
                <TableRow>
                  <TableCell>Failure</TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell className="text-xs text-slate-500">—</TableCell>
                  <TableCell className="text-sm text-rose-700">{payout.failureReason}</TableCell>
                </TableRow>
              ) : null}
              {payout.cancelReason ? (
                <TableRow>
                  <TableCell>Cancellation</TableCell>
                  <TableCell className="text-sm">—</TableCell>
                  <TableCell className="text-xs text-slate-500">—</TableCell>
                  <TableCell className="text-sm text-rose-700">{payout.cancelReason}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger entries in this payout</CardTitle>
          <CardDescription>One entry can never appear in two payouts.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payout.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="text-sm">{entry.ledgerEntry.description}</div>
                    <div className="text-xs text-slate-500">
                      {entry.ledgerEntry.type.replace(/_/g, " ").toLowerCase()} · {formatDateTime(entry.ledgerEntry.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.ledgerEntry.order ? (
                      <Link href={`/admin/orders/${entry.ledgerEntry.order.id}`} className="text-indigo-600 hover:underline">
                        {entry.ledgerEntry.order.orderNumber}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${entry.ledgerEntry.direction === "DEBIT" ? "text-rose-700" : ""}`}>
                    {entry.ledgerEntry.direction === "DEBIT" ? "−" : "+"}
                    {formatPaisa(entry.amountPaisa)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {payout.transactions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payout.transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-mono text-xs">{transaction.providerReference ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={transaction.status === "PAID" ? "success" : transaction.status === "FAILED" ? "danger" : "warning"}>
                        {transaction.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(payout.amountPaisa)}</TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(transaction.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {can(session, "reseller.payout") ? (
        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
            <CardDescription>Approving is reversible by cancelling; marking paid is not.</CardDescription>
          </CardHeader>
          <CardContent>
            <PayoutDecisionForm payoutId={payout.id} status={payout.status} />
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">You have read-only access to payouts.</Alert>
      )}
    </div>
  );
}
