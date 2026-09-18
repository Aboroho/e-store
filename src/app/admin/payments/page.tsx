import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { listPayments, paymentStats, pendingRefunds } from "@/modules/payments/queries";
import { SettleRefundForm } from "@/components/forms/order-forms";
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
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  PENDING: "warning",
  PROCESSING: "info",
  PAID: "success",
  PARTIALLY_REFUNDED: "violet",
  REFUNDED: "neutral",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "payment.view");
  const params = await searchParams;
  const filterValue = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [stats, result, refunds] = await Promise.all([
    paymentStats(session.businessId),
    listPayments(session.businessId, {
      search: typeof params.q === "string" ? params.q : undefined,
      method: filterValue("method"),
      status: filterValue("status"),
      page: Number.parseInt(String(filterValue("page") ?? "1"), 10) || 1,
    }),
    pendingRefunds(session.businessId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Cash on delivery, bKash, SSLCommerz and manually recorded payments. Gateway callbacks are verified server-side before an order is marked paid."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Collected today" value={formatPaisa(stats.todayPaisa)} hint={`${stats.todayCount} payment(s)`} tone="success" />
        <StatCard label="Outstanding across paid rows" value={formatPaisa(result.outstandingPaisa)} tone={result.outstandingPaisa > 0 ? "warning" : "slate"} />
        <StatCard label="Refunded (filtered)" value={formatPaisa(result.refundedPaisa)} tone="violet" />
        <StatCard label="Refunds queued" value={String(stats.pendingRefundCount)} hint={formatPaisa(stats.pendingRefundPaisa)} tone={stats.pendingRefundCount > 0 ? "danger" : "slate"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.byMethod.map((row) => (
          <StatCard key={row.method} label={row.method.replace(/_/g, " ").toLowerCase()} value={formatPaisa(row.paidPaisa)} tone="brand" />
        ))}
      </div>

      {refunds.length > 0 && can(session, "payment.refund") ? (
        <Card>
          <CardHeader>
            <CardTitle>Refunds waiting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {refunds.map((refund) => (
              <div key={refund.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    {refund.order ? (
                      <Link href={`/admin/orders/${refund.order.id}`} className="text-indigo-600 hover:underline">
                        {refund.order.orderNumber}
                      </Link>
                    ) : (
                      <span className="text-slate-500">exchange refund</span>
                    )}
                    <span className="ml-2 text-xs text-slate-500">{refund.reason ?? "no reason recorded"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={refund.status === "FAILED" ? "danger" : "warning"}>{refund.status.toLowerCase()}</Badge>
                    <span className="tabular-nums">{formatPaisa(refund.amountPaisa)}</span>
                  </div>
                </div>
                <SettleRefundForm refundId={refund.id} orderId={refund.order?.id ?? ""} providerReference={refund.providerReference} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {result.outstandingPaisa > 0 ? (
        <Alert variant="info">Partial payments are allowed: an order shows PAID only when the recorded amount covers the total.</Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Payment history</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Order, phone, reference" defaultValue={typeof params.q === "string" ? params.q : ""} />
            <FilterSelect
              name="method"
              value={filterValue("method") ?? "ALL"}
              options={[
                { value: "ALL", label: "All methods" },
                { value: "COD", label: "Cash on delivery" },
                { value: "BKASH", label: "bKash" },
                { value: "SSLCOMMERZ", label: "SSLCommerz" },
                { value: "CASH", label: "Cash" },
                { value: "BANK_TRANSFER", label: "Bank transfer" },
                { value: "MANUAL", label: "Manual" },
              ]}
            />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "PENDING", label: "Pending" },
                { value: "PAID", label: "Paid" },
                { value: "PARTIALLY_REFUNDED", label: "Partially refunded" },
                { value: "REFUNDED", label: "Refunded" },
                { value: "FAILED", label: "Failed" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.rows.length === 0 ? (
            <EmptyState title="No payments recorded" description="Record a payment from an order, or collect cash on delivery through a courier settlement." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Refunded</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {payment.order ? (
                          <>
                            <Link href={`/admin/orders/${payment.order.id}`} className="font-medium text-indigo-600 hover:underline">
                              {payment.order.orderNumber}
                            </Link>
                            <div className="text-xs text-slate-500">{payment.order.customerName ?? payment.order.customerPhoneNormalized}</div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{payment.method.replace(/_/g, " ").toLowerCase()}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONES[payment.status] ?? "neutral"}>{payment.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(payment.amountPaisa)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(payment.paidPaisa)}</TableCell>
                      <TableCell className="text-right tabular-nums">{payment.refundedPaisa > 0 ? formatPaisa(payment.refundedPaisa) : "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {payment.providerReference ?? payment.providerPaymentId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDateTime(payment.createdAt)}
                        {payment.recordedByName ? ` · ${payment.recordedByName}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {result.rows.some((row) => row.refunds.length > 0) ? (
                <div className="rounded border border-slate-200 p-3 text-xs text-slate-600">
                  {result.rows.flatMap((row) =>
                    row.refunds.map((refund) => (
                      <div key={refund.id} className="flex justify-between">
                        <span>
                          {row.order?.orderNumber ?? "—"} · {refund.status.toLowerCase()}
                        </span>
                        <span className="tabular-nums">{formatPaisa(refund.amountPaisa)}</span>
                      </div>
                    )),
                  )}
                </div>
              ) : null}
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/payments" searchParams={params} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
