import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getPurchaseOrder } from "@/modules/purchasing/queries";
import { listLocations } from "@/modules/inventory/queries";
import { submitPurchaseOrderAction } from "@/modules/purchasing/actions";
import { CancelPurchaseOrderForm, GoodsReceiptForm, SupplierPaymentForm } from "@/components/forms/purchase-forms";
import {
  Badge,
  Card,
  CardContent,
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
  buttonVariants,
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "purchase.view");
  const { id } = await params;

  const [order, locations] = await Promise.all([getPurchaseOrder(session.businessId, id), listLocations(session.businessId)]);
  if (!order) notFound();

  const receivedQuantity = order.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  const orderedQuantity = order.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const outstandingPaisa = order.totalPaisa - order.paidPaisa;
  const canReceive = can(session, "purchase.receive") && (order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED");
  const canSubmit = can(session, "purchase.update") && order.status === "DRAFT";
  const canCancel = can(session, "purchase.update") && order.status !== "CANCELLED" && order.status !== "RECEIVED";

  const receiptItems = order.items
    .filter((item) => item.orderedQuantity - item.receivedQuantity > 0)
    .map((item) => ({
      id: item.id,
      sku: item.variant.product?.sku ?? "",
      productName: `${item.variant.product.name} — ${item.variant.name}`,
      outstanding: item.orderedQuantity - item.receivedQuantity,
      unitCostPaisa: item.unitCostPaisa,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.code}
        description={`${order.supplier.name} · created ${formatDate(order.createdAt)}${
          order.expectedAt ? ` · expected ${formatDate(order.expectedAt)}` : ""
        }`}
        actions={
          <Link href="/admin/purchasing" className={buttonVariants({ variant: "secondary" })}>
            Back to purchases
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
        <span className="text-slate-500">
          Received {receivedQuantity} of {orderedQuantity} unit(s)
        </span>
        {canSubmit ? (
          <form action={submitPurchaseOrderAction.bind(null, order.id)}>
            <SubmitButton size="sm" pendingLabel="Submitting…">
              Submit to supplier
            </SubmitButton>
          </form>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Order total" value={formatPaisa(order.totalPaisa)} hint={`Subtotal ${formatPaisa(order.subtotalPaisa)} + costs ${formatPaisa(order.extraCostPaisa)}`} />
        <StatCard label="Paid" value={formatPaisa(order.paidPaisa)} tone="success" />
        <StatCard label="Outstanding" value={formatPaisa(outstandingPaisa)} tone={outstandingPaisa > 0 ? "warning" : "success"} />
        <StatCard label="Receipts posted" value={order.receipts.length} hint={`${order.items.length} line(s)`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order lines</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead className="text-right">Landed cost/unit</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/admin/inventory/${item.variantId}`} className="font-medium text-brand-600 hover:underline">
                      {item.variant.product.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {item.variant.name} · <span className="font-mono">{item.variant.product?.sku}</span>
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.orderedQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={item.receivedQuantity < item.orderedQuantity ? "text-amber-600" : undefined}>{item.receivedQuantity}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPaisa(item.unitCostPaisa)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.receivedQuantity > 0
                      ? formatPaisa(Math.round(item.lineTotalPaisa / item.receivedQuantity))
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPaisa(item.lineTotalPaisa)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canReceive ? (
        <GoodsReceiptForm purchaseOrderId={order.id} locations={locations.map((location) => ({ id: location.id, name: location.name, isDefault: location.isDefault }))} items={receiptItems} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Receipt history</CardTitle>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Landed value</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-mono text-xs">{receipt.code}</TableCell>
                  <TableCell className="text-sm text-slate-600">{formatDateTime(receipt.receivedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{receipt.items.reduce((sum, item) => sum + item.quantity, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPaisa(receipt.items.reduce((sum, item) => sum + item.lineCostPaisa, 0))}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{receipt.receivedByName ?? "System"}</TableCell>
                  <TableCell className="text-xs text-slate-500">{receipt.externalReference ?? "—"}</TableCell>
                </TableRow>
              ))}
              {order.receipts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    Nothing received yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {order.expenses.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Additional costs</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Allocation</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="text-sm text-slate-700">{expense.label}</TableCell>
                    <TableCell className="text-sm text-slate-600">{expense.allocationMethod.toLowerCase()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(expense.amountPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {can(session, "purchase.payment") && order.status !== "CANCELLED" ? (
        <SupplierPaymentForm
          suppliers={[{ id: order.supplier.id, name: order.supplier.name }]}
          purchaseOrders={[
            { id: order.id, code: order.code, supplierId: order.supplierId, outstandingPaisa: Math.max(outstandingPaisa, 0) },
          ]}
          presetSupplierId={order.supplierId}
          presetPurchaseOrderId={order.id}
        />
      ) : null}

      {order.payments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid at</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="text-sm text-slate-600">{formatDate(payment.paidAt)}</TableCell>
                    <TableCell className="text-sm text-slate-600">{payment.method.toLowerCase().replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs text-slate-500">{payment.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(payment.amountPaisa)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {canCancel ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancel order</CardTitle>
            <p className="text-xs text-slate-500">
              Outstanding incoming quantities are released. Receipts already posted are never reversed automatically.
            </p>
          </CardHeader>
          <CardContent>
            <CancelPurchaseOrderForm purchaseOrderId={order.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
