import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getOrderDetail, courierProviders } from "@/modules/orders/queries";
import { getOrderScreen } from "@/modules/orders/lookup";
import { manualOrderContext } from "@/modules/orders/manual";
import { ORDER_TYPE_LABELS, STATUS_TONES, type InternalOrderStatus, type OrderTypeValue } from "@/modules/orders/status";
import { OrderStatusControls } from "@/components/orders/order-status-controls";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";
import {
  CourierChargeForm,
  RecordPaymentForm,
  RefundPaymentForm,
  ShipmentActions,
  SettleRefundForm,
} from "@/components/forms/order-forms";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const SHIPMENT_MANUAL_STATUSES = [
  { value: "CREATED", label: "Created" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "PARTIALLY_DELIVERED", label: "Partially delivered" },
  { value: "RETURNED", label: "Returned" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "order.view");
  const { id } = await params;

  // The scoped read runs first: an order the actor may not see is a 404, not a
  // permission message that leaks its existence.
  const context = await manualOrderContext(session);
  const screen = await getOrderScreen(context, id).catch(() => null);
  if (!screen) notFound();

  const detail = await getOrderDetail(session.businessId, id).catch(() => null);
  if (!detail) notFound();

  const { order, shipments } = detail;
  const providers = await courierProviders(session.businessId, true);
  const preorderItems = order.items.flatMap((item) => (item.preorder ? [item.preorder] : []));
  const openPreorderUnits = preorderItems
    .filter((preorder) => ["OPEN", "PARTIALLY_ALLOCATED"].includes(preorder.status))
    .reduce((total, preorder) => total + (preorder.quantity - preorder.allocatedQuantity), 0);
  const paymentAttempts = order.payments.flatMap((payment) => payment.attempts);
  const refundablePayments = order.payments
    .map((payment) => ({
      id: payment.id,
      label: `${payment.method.replace(/_/g, " ").toLowerCase()} · ${formatPaisa(payment.paidPaisa)} · ${payment.status.replace(/_/g, " ").toLowerCase()}`,
      refundablePaisa: Math.max(payment.paidPaisa - payment.refundedPaisa, 0),
    }))
    .filter((payment) => payment.refundablePaisa > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> All orders
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/orders/new?reorder=${order.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Create another
          </Link>
          <Link href={`/admin/exchanges/new?orderId=${order.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Start exchange
          </Link>
        </div>
      </div>

      <PageHeader
        title={order.orderNumber}
        description={`${order.channel.replace(/_/g, " ").toLowerCase()} · placed ${formatDateTime(order.placedAt)}${order.customerPhoneNormalized ? ` · ${order.customerPhoneNormalized}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={STATUS_TONES[order.status as InternalOrderStatus] ?? "neutral"}>{screen.statusLabel}</Badge>
            <Badge variant="neutral">{ORDER_TYPE_LABELS[order.orderType as OrderTypeValue] ?? order.orderType}</Badge>
            <Badge variant={order.paymentStatus === "PAID" ? "success" : order.duePaisa > 0 ? "warning" : "neutral"}>
              {order.paymentStatus.replace(/_/g, " ").toLowerCase()}
            </Badge>
            <Badge variant="neutral">{order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</Badge>
            {order.createdByUserRole ? <Badge variant="info">Created by {order.createdByUserRole}</Badge> : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items (snapshots)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                    <TableHead>Stock state</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{item.productName}</div>
                        <div className="text-xs text-slate-500">
                          {item.variantName} · {item.sku}
                          {item.pricingSource ? ` · ${item.pricingSource.toLowerCase()}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(item.unitPricePaisa)}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.discountPaisa > 0 ? formatPaisa(item.discountPaisa) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(item.lineTotalPaisa)}</TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {item.reservedQuantity > 0 ? `${item.reservedQuantity} reserved ` : ""}
                        {item.preorderQuantity > 0 ? `· ${item.preorderQuantity} preorder ` : ""}
                        {item.dispatchedQuantity > 0 ? `· ${item.dispatchedQuantity} dispatched ` : ""}
                        {item.returnedQuantity > 0 ? `· ${item.returnedQuantity} returned` : ""}
                        {item.status.replace(/_/g, " ").toLowerCase()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <dl className="mt-6 grid gap-2 sm:grid-cols-2">
                {[
                  ["Items subtotal", order.itemsSubtotalPaisa],
                  ["Discount", -order.discountTotalPaisa],
                  ["Delivery fee", order.deliveryFeePaisa],
                  ["Delivery calculated", order.deliveryFeeCalculatedPaisa],
                  ["Extra charges", order.extraChargePaisa],
                  ["Packaging", order.packagingCostPaisa],
                  ["COD surcharge", order.codSurchargePaisa],
                  ["Grand total", order.grandTotalPaisa],
                  ["Paid", order.paidPaisa],
                  ["Refunded", order.refundedPaisa],
                  ["Due", order.duePaisa],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex items-center justify-between border-b border-slate-100 pb-1 text-sm">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="tabular-nums text-slate-900">{formatPaisa(Number(value))}</dd>
                  </div>
                ))}
              </dl>
              {can(session, "order.view_cost") ? (
                <p className="mt-3 text-xs text-slate-500">
                  Inventory cost snapshot: {formatPaisa(order.inventoryCostPaisa)} · COD to collect: {formatPaisa(order.codCollectPaisa)}
                </p>
              ) : null}
              {order.deliveryFeeOverriddenAt ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  The delivery charge was overridden to {formatPaisa(order.deliveryFeePaisa)} (calculated{" "}
                  {formatPaisa(order.deliveryFeeCalculatedPaisa)}) on {formatDateTime(order.deliveryFeeOverriddenAt)}
                  {order.deliveryFeeOverrideNote ? ` — ${order.deliveryFeeOverrideNote}` : ""}.
                </p>
              ) : null}
              {order.discountType && order.discountValue ? (
                <p className="mt-2 text-xs text-slate-500">
                  Order discount: {order.discountType === "PERCENTAGE" ? `${order.discountValue / 100}%` : formatPaisa(order.discountValue)}
                  {" "}applied — {formatPaisa(order.discountTotalPaisa)} in total across the lines.
                </p>
              ) : null}
              {order.adjustments.length > 0 ? (
                <ul className="mt-4 space-y-1 text-xs text-slate-600">
                  {order.adjustments.map((adjustment) => (
                    <li key={adjustment.id}>
                      {adjustment.label}: <span className="tabular-nums">{formatPaisa(adjustment.amountPaisa)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shipments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {shipments.length === 0 ? (
                <EmptyState title="No shipments yet" description="Dispatching an order creates the shipment and queues the courier call." />
              ) : (
                shipments.map((shipment) => (
                  <div key={shipment.id} className="space-y-3 rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-slate-900">
                          {shipment.internalCode} · {shipment.providerCode}
                        </div>
                        <div className="text-xs text-slate-500">
                          {shipment.trackingCode ? `Tracking ${shipment.trackingCode} · ` : ""}
                          {shipment.status.replace(/_/g, " ").toLowerCase()}
                          {shipment.providerStatusRaw ? ` (provider: ${shipment.providerStatusRaw})` : ""}
                        </div>
                      </div>
                      <Link href={`/admin/shipments/${shipment.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        Open
                      </Link>
                    </div>
                    <p className="text-xs text-slate-600">
                      COD {formatPaisa(shipment.codAmountPaisa)} · courier charge {formatPaisa(shipment.courierChargePaisa)} · collected{" "}
                      {formatPaisa(shipment.collectedPaisa)}
                    </p>
                    <ol className="space-y-1 text-xs text-slate-600">
                      {shipment.statusHistory.map((entry) => (
                        <li key={entry.id}>
                          {formatDateTime(entry.recordedAt)} — {entry.toStatus.replace(/_/g, " ").toLowerCase()}
                          {entry.note ? ` · ${entry.note}` : ""}
                        </li>
                      ))}
                    </ol>
                    {can(session, "order.deliver") ? (
                      <ShipmentActions
                        shipmentId={shipment.id}
                        statuses={SHIPMENT_MANUAL_STATUSES}
                        canRequeue={!shipment.providerConsignmentId}
                      />
                    ) : null}
                    {can(session, "courier.manage") ? <CourierChargeForm shipmentId={shipment.id} /> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {order.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</span>
                    <Badge variant="neutral">{entry.field.toLowerCase()}</Badge>
                    <span className="text-slate-700">
                      {entry.fromStatus ? `${entry.fromStatus.replace(/_/g, " ").toLowerCase()} → ` : ""}
                      {entry.toStatus.replace(/_/g, " ").toLowerCase()}
                    </span>
                    {entry.note ? <span className="text-xs text-slate-500">{entry.note}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium text-slate-900">{order.customerName ?? "Guest"}</div>
              <div className="text-slate-600">{order.customerPhone ?? "No phone"}</div>
              {order.customerEmail ? <div className="text-slate-600">{order.customerEmail}</div> : null}
              <div className="text-xs text-slate-500">
                {[order.shippingAddressLine, order.shippingArea].filter(Boolean).join(", ") || "No delivery address"}
              </div>
              {order.customer ? (
                <Link href={`/admin/customers/${order.customer.id}`} className="text-xs text-indigo-600 hover:underline">
                  {order.customer.totalOrders} order(s) · {formatPaisa(order.customer.totalSpentPaisa)} lifetime
                </Link>
              ) : null}
              {openPreorderUnits > 0 ? (
                <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                  {openPreorderUnits} preorder unit(s) still committed — stock must arrive (or the line be cancelled) before dispatch
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status and fulfilment</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderStatusControls
                orderId={order.id}
                orderNumber={order.orderNumber}
                currentStatus={order.status}
                statusLabel={screen.statusLabel}
                courierStatus={screen.courierStatus}
                statusGroup={screen.statusGroup}
                transitions={screen.transitions.map((transition) => ({
                  status: transition.target,
                  label: transition.label,
                  allowed: transition.allowed,
                  requiresConfirmation: transition.requiresConfirmation,
                  requiresReason: transition.requiresReason,
                  deniedReason: transition.deniedReason ?? null,
                  warning: transition.warning ?? null,
                  effect: transition.effect,
                }))}
                dispatch={screen.dispatch}
                providers={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
                mayDispatch={screen.mayDispatch}
                deletable={screen.deletable}
                deletionBlockers={screen.deletionBlockers}
                mayDelete={screen.mayDelete}
                partialDeliveryLines={order.items.map((item) => ({
                  id: item.id,
                  productName: item.productName,
                  variantName: item.variantName,
                  quantity: item.quantity,
                  dispatchedQuantity: item.dispatchedQuantity,
                  returnedQuantity: item.returnedQuantity,
                  cancelledQuantity: item.cancelledQuantity,
                  exchangedQuantity: item.exchangedQuantity,
                }))}
                mayRecordPartialDelivery={
                  can(session, "order.status.post_courier") || can(session, "order.status.override")
                }
                mayEdit={screen.edit.allowed || screen.edit.requiresConfirmation}
              />
              {screen.edit.deniedReason && !screen.edit.allowed && !screen.edit.requiresConfirmation ? (
                <p className="mt-3 text-xs text-slate-500">{screen.edit.deniedReason}</p>
              ) : null}
            </CardContent>
          </Card>

          {screen.earnings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Reseller earnings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-slate-600">
                {screen.earnings.map((earning) => (
                  <p key={earning.id}>
                    {earning.eligibilityStatus.replace(/_/g, " ").toLowerCase()} · collected {formatPaisa(earning.collectedPaisa)} ·
                    cost {formatPaisa(earning.resellerCostPaisa)} · earning {formatPaisa(earning.earningsPaisa)} · settled{" "}
                    {formatPaisa(earning.settledPaisa)}
                  </p>
                ))}
                <p className="text-slate-500">
                  Earnings stay pending until the courier COD settlement is reconciled; a returned order voids them.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-xs text-slate-500">
                        No payments recorded
                      </TableCell>
                    </TableRow>
                  ) : (
                    order.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-xs">{payment.method.replace(/_/g, " ").toLowerCase()}</TableCell>
                        <TableCell className="text-xs">{payment.status.replace(/_/g, " ").toLowerCase()}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{formatPaisa(payment.paidPaisa - payment.refundedPaisa)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {paymentAttempts.length > 0 ? (
                <div className="space-y-1 text-xs text-slate-500">
                  {paymentAttempts.slice(0, 5).map((attempt) => (
                    <div key={attempt.id}>
                      {attempt.method} · {attempt.clientReference} · {attempt.status.replace(/_/g, " ").toLowerCase()}
                    </div>
                  ))}
                </div>
              ) : null}

              {can(session, "payment.record") && order.status !== "CANCELLED" ? <RecordPaymentForm orderId={order.id} duePaisa={order.duePaisa} /> : null}

              {order.refunds.length > 0 ? (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <p className="text-xs font-medium text-slate-600">Refunds</p>
                  {order.refunds.map((refund) => (
                    <div key={refund.id} className="space-y-1 text-xs text-slate-600">
                      <div>
                        {formatPaisa(refund.amountPaisa)} · {refund.method.toLowerCase()} · {refund.status.toLowerCase()} · {refund.reason}
                      </div>
                      {refund.status !== "COMPLETED" && can(session, "payment.refund") ? (
                        <SettleRefundForm refundId={refund.id} orderId={order.id} providerReference={refund.providerReference} />
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {can(session, "payment.refund") && refundablePayments.length > 0 ? (
                <div className="border-t border-slate-200 pt-3">
                  <RefundPaymentForm orderId={order.id} payments={refundablePayments} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exchanges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {order.exchanges.length === 0 ? (
                <p className="text-xs text-slate-500">No exchanges for this order.</p>
              ) : (
                order.exchanges.map((exchange) => (
                  <Link key={exchange.id} href={`/admin/exchanges/${exchange.id}`} className="block text-xs text-indigo-600 hover:underline">
                    {exchange.exchangeNumber} · {exchange.status.replace(/_/g, " ").toLowerCase()} · {formatPaisa(exchange.differencePaisa)}
                  </Link>
                ))
              )}
              <p className="text-xs text-slate-500">
                {order.deliveredAt ? `Delivered ${formatDateTime(order.deliveredAt)} — the exchange window is configurable in settings.` : "Delivered orders can be exchanged within the configured window."}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
