import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCustomerSession } from "@/lib/auth/customer-session";
import { getCustomerOrder } from "@/modules/customers/service";
import { CustomerCancelOrderForm } from "@/components/forms/customer-forms";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const CANCELLABLE = ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP"];

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  if (!session) redirect("/account");

  const { id } = await params;
  const order = await getCustomerOrder(session.businessId, session.id, id).catch(() => null);
  if (!order) notFound();

  const canCancel = CANCELLABLE.includes(order.status);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <Link href="/account" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> My orders
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{order.orderNumber}</h1>
          <p className="text-sm text-slate-500">Placed {formatDateTime(order.placedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={order.status === "CANCELLED" ? "neutral" : "info"}>{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
          <Badge variant={order.paymentStatus === "PAID" ? "success" : "warning"}>{order.paymentStatus.replace(/_/g, " ").toLowerCase()}</Badge>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.length === 0 ? (
                <TableEmpty colSpan={3} message="This order has no items" />
              ) : (
                order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="text-sm text-slate-900">
                        {item.productName} · {item.variantName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {item.sku}
                        {item.isPreorder ? " · preorder" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(item.lineTotalPaisa)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.shipments.length === 0 ? (
              <p className="text-xs text-slate-500">Not dispatched yet.</p>
            ) : (
              order.shipments.map((shipment) => (
                <div key={shipment.id} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <span>{shipment.status.replace(/_/g, " ").toLowerCase()}</span>
                  </div>
                  {shipment.trackingCode ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tracking</span>
                      <span className="tabular-nums">{shipment.trackingCode}</span>
                    </div>
                  ) : null}
                  {shipment.lastStatusAt ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Last update</span>
                      <span>{formatDateTime(shipment.lastStatusAt)}</span>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {order.payments.length === 0 ? (
              <p className="text-xs text-slate-500">Nothing recorded yet.</p>
            ) : (
              order.payments.map((payment) => (
                <div key={payment.id} className="flex justify-between">
                  <span className="text-slate-500">{payment.method.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="tabular-nums">
                    {formatPaisa(payment.paidPaisa)} · {payment.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2">
              <span className="text-slate-500">Total</span>
              <span className="tabular-nums">{formatPaisa(order.grandTotalPaisa)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {order.statusHistory.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3">
                <Badge variant="neutral">{entry.toStatus.replace(/_/g, " ").toLowerCase()}</Badge>
                <span className="text-xs text-slate-500">
                  {formatDateTime(entry.createdAt)}
                  {entry.note ? ` · ${entry.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {canCancel ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancel this order</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">
              You can cancel while the parcel has not shipped. Reserved stock is released immediately.
            </p>
            <CustomerCancelOrderForm orderId={order.id} />
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
