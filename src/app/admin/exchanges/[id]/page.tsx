import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getExchangeDetail } from "@/modules/orders/queries";
import {
  ExchangeApproveForm,
  ExchangeCancelForm,
  ExchangeCollectionForm,
  ExchangeCompleteForm,
  ExchangeInspectForm,
  ExchangeReceiveForm,
  ExchangeRejectForm,
} from "@/components/forms/exchange-forms";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Exchange" };
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

export default async function ExchangeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "exchange.view");
  const { id } = await params;

  const exchange = await getExchangeDetail(session.businessId, id);
  if (!exchange) notFound();

  const returnItems = exchange.items.filter((item) => item.direction === "RETURN");
  const replacementItems = exchange.items.filter((item) => item.direction === "REPLACEMENT");
  const canApprove = can(session, "exchange.approve") && exchange.status === "REQUESTED";
  const canInspect = can(session, "exchange.inspect") && ["APPROVED", "IN_TRANSIT", "RECEIVED"].includes(exchange.status);
  const canComplete = can(session, "exchange.approve") && ["RECEIVED", "INSPECTED"].includes(exchange.status);

  return (
    <div className="space-y-6">
      <Link href="/admin/exchanges" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> All exchanges
      </Link>

      <PageHeader
        title={exchange.exchangeNumber}
        description={`Order ${exchange.order.orderNumber} · ${exchange.reason?.label ?? exchange.reasonCode.replace(/_/g, " ").toLowerCase()}${
          exchange.order.deliveredAt ? ` · delivered ${formatDateTime(exchange.order.deliveredAt)}` : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={STATUS_TONES[exchange.status] ?? "neutral"}>{exchange.status.replace(/_/g, " ").toLowerCase()}</Badge>
            <Badge variant={exchange.isPartial ? "warning" : "neutral"}>{exchange.isPartial ? "partial" : "full"}</Badge>
            <Badge variant={exchange.channel === "CUSTOMER" ? "info" : "neutral"}>{exchange.channel.toLowerCase()}</Badge>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Returned items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Inspection</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returnItems.length === 0 ? (
                    <TableEmpty colSpan={4} message="No returned items on this exchange" />
                  ) : (
                    returnItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="text-sm text-slate-900">{item.productName}</div>
                          <div className="text-xs text-slate-500">
                            {item.sku} · {item.variantName}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaisa(item.lineTotalPaisa)}</TableCell>
                        <TableCell>
                          <Badge variant={item.inspectionOutcome === "PENDING" ? "warning" : item.inspectionOutcome === "SELLABLE" ? "success" : "danger"}>
                            {item.inspectionOutcome.toLowerCase()}
                          </Badge>
                          {item.inspectionNote ? <div className="mt-1 text-[11px] text-slate-500">{item.inspectionNote}</div> : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Replacement items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {replacementItems.length === 0 ? (
                    <TableEmpty colSpan={4} message="No replacement items — this is a return for credit" />
                  ) : (
                    replacementItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="text-sm text-slate-900">
                            {item.variant ? `${item.variant.product.name} · ${item.variant.name}` : item.productName}
                          </div>
                          <div className="text-xs text-slate-500">{item.sku}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaisa(item.lineTotalPaisa)}</TableCell>
                        <TableCell className="text-xs text-slate-500">{(item.replacementStatus ?? "pending").toLowerCase()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {exchange.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 text-sm">
                    <Badge variant="neutral">{entry.toStatus.toLowerCase()}</Badge>
                    <div>
                      <div className="text-slate-700">{entry.note ?? "Status updated"}</div>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(entry.createdAt)}
                        {entry.actorName ? ` · ${entry.actorName}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Money</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Returned credit</span>
                <span className="tabular-nums">{formatPaisa(exchange.returnValuePaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Replacement value</span>
                <span className="tabular-nums">{formatPaisa(exchange.replacementValuePaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Delivery charge</span>
                <span className="tabular-nums">{formatPaisa(exchange.deliveryChargePaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Additional charge</span>
                <span className="tabular-nums">{formatPaisa(exchange.additionalChargePaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Discount</span>
                <span className="tabular-nums">−{formatPaisa(exchange.discountPaisa)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-medium">
                <span>{exchange.differencePaisa >= 0 ? "Customer pays" : "We refund"}</span>
                <span className="tabular-nums">{formatPaisa(Math.abs(exchange.differencePaisa))}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Collection</span>
                <span>{exchange.collectionStatus.toLowerCase()}</span>
              </div>
              {exchange.refunds.length > 0 ? (
                <div className="space-y-1 border-t border-slate-100 pt-2 text-xs">
                  <div className="uppercase tracking-wide text-slate-400">Refunds</div>
                  {exchange.refunds.map((refund) => (
                    <div key={refund.id} className="flex justify-between">
                      <span>{refund.method.toLowerCase()}</span>
                      <span className="tabular-nums">
                        {formatPaisa(refund.amountPaisa)} · {refund.status.toLowerCase()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="border-t border-slate-100 pt-2 text-xs text-slate-500">
                Order{" "}
                <Link href={`/admin/orders/${exchange.order.id}`} className="text-indigo-600 hover:underline">
                  {exchange.order.orderNumber}
                </Link>
                {exchange.customer ? ` · ${exchange.customer.name} ${exchange.customer.phone ?? ""}` : ""}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {canApprove ? (
                <>
                  <ExchangeApproveForm exchangeId={exchange.id} requiresApproval={exchange.reason?.requiresApproval ?? true} />
                  <Separator />
                  <ExchangeRejectForm exchangeId={exchange.id} />
                </>
              ) : null}

              {can(session, "exchange.inspect") && ["APPROVED", "IN_TRANSIT"].includes(exchange.status) ? (
                <>
                  <Separator />
                  <ExchangeReceiveForm exchangeId={exchange.id} />
                </>
              ) : null}

              {canInspect && returnItems.length > 0 ? (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-medium text-slate-900">Inspection</h4>
                    <ExchangeInspectForm
                      exchangeId={exchange.id}
                      items={returnItems.map((item) => ({
                        id: item.id,
                        sku: item.sku,
                        productName: item.productName,
                        quantity: item.quantity,
                        inspectionOutcome: item.inspectionOutcome,
                      }))}
                    />
                  </div>
                </>
              ) : null}

              {canComplete ? (
                <>
                  <Separator />
                  <ExchangeCompleteForm exchangeId={exchange.id} canComplete />
                  <Separator />
                  <ExchangeCollectionForm exchangeId={exchange.id} differencePaisa={exchange.differencePaisa} />
                </>
              ) : null}

              {can(session, "exchange.approve") && !["COMPLETED", "CANCELLED", "REJECTED"].includes(exchange.status) ? (
                <>
                  <Separator />
                  <ExchangeCancelForm exchangeId={exchange.id} />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
