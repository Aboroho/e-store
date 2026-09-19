import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getShipmentDetail } from "@/modules/orders/queries";
import { CourierChargeForm, ShipmentActions } from "@/components/forms/order-forms";
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
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Shipment" };
export const dynamic = "force-dynamic";

const MANUAL_STATUSES = [
  { value: "CREATED", label: "Created" },
  { value: "PICKED_UP", label: "Picked up" },
  { value: "IN_TRANSIT", label: "In transit" },
  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "PARTIALLY_DELIVERED", label: "Partially delivered" },
  { value: "RETURNED", label: "Returned" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const { id } = await params;

  const shipment = await getShipmentDetail(session.businessId, id);
  if (!shipment) notFound();

  const canManage = can(session, "courier.manage");

  return (
    <div className="space-y-6">
      <Link href="/admin/shipments" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> All shipments
      </Link>

      <PageHeader
        title={shipment.internalCode}
        description={`${shipment.courier?.name ?? shipment.providerCode}${shipment.trackingCode ? ` · tracking ${shipment.trackingCode}` : ""}${
          shipment.order ? ` · order ${shipment.order.orderNumber}` : ""
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge variant={shipment.status === "DELIVERED" ? "success" : shipment.status === "RETURNED" ? "danger" : "info"}>
              {shipment.status.replace(/_/g, " ").toLowerCase()}
            </Badge>
            <Badge variant={shipment.type === "SALE" ? "neutral" : "violet"}>{shipment.type.replace(/_/g, " ").toLowerCase()}</Badge>
            {shipment.courier?.isEnabled === false ? <Badge variant="warning">courier disabled</Badge> : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Parcel</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Recipient</div>
                <div className="text-slate-900">{shipment.recipientName}</div>
                <div className="text-xs text-slate-500">{shipment.recipientPhone}</div>
                <div className="mt-1 text-xs text-slate-600">{shipment.recipientAddress}</div>
                {shipment.recipientArea ? <div className="text-xs text-slate-500">{shipment.recipientArea}</div> : null}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Declared weight</span>
                  <span className="tabular-nums">{shipment.declaredWeightGrams} g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Items</span>
                  <span className="tabular-nums">{shipment.itemQuantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivery fee charged</span>
                  <span className="tabular-nums">{formatPaisa(shipment.deliveryFeePaisa)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Expected COD</span>
                  <span className="tabular-nums">{formatPaisa(shipment.expectedCollectionPaisa)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-500">Collected</span>
                  <span className="tabular-nums">{formatPaisa(shipment.collectedPaisa)}</span>
                </div>
              </div>
              {shipment.itemDescription ? <p className="text-xs text-slate-500 sm:col-span-2">{shipment.itemDescription}</p> : null}
              {shipment.failureReason ? (
                <p className="rounded bg-rose-50 p-2 text-xs text-rose-700 sm:col-span-2">Provider error: {shipment.failureReason}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardContent>
              {shipment.statusHistory.length === 0 ? (
                <EmptyState title="No status events yet" description="Provider webhooks and manual updates appear here." />
              ) : (
                <ol className="space-y-3">
                  {shipment.statusHistory.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 text-sm">
                      <Badge variant="neutral">{entry.toStatus.replace(/_/g, " ").toLowerCase()}</Badge>
                      <div>
                        <div className="text-slate-700">{entry.note ?? entry.providerStatus ?? "Status updated"}</div>
                        <div className="text-xs text-slate-500">
                          {formatDateTime(entry.recordedAt)} · {entry.source.toLowerCase()}
                          {entry.actorName ? ` · ${entry.actorName}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Courier charges</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">COD charge</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shipment.charges.length === 0 ? (
                    <TableEmpty colSpan={4} message="No courier charges recorded yet" />
                  ) : (
                    shipment.charges.map((charge) => (
                      <TableRow key={charge.id}>
                        <TableCell className="text-xs">{charge.type.replace(/_/g, " ").toLowerCase()}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaisa(charge.amountPaisa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaisa(charge.codChargePaisa)}</TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDateTime(charge.createdAt)}
                          {charge.recordedByName ? ` · ${charge.recordedByName}` : ""}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-500">Consignment</span>
                <span className="tabular-nums">{shipment.providerConsignmentId ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Provider status</span>
                <span>{shipment.providerStatusRaw ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Attempts</span>
                <span className="tabular-nums">{shipment.attemptCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Requested</span>
                <span>{shipment.requestedAt ? formatDateTime(shipment.requestedAt) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Delivered</span>
                <span>{shipment.deliveredAt ? formatDateTime(shipment.deliveredAt) : "—"}</span>
              </div>
              {shipment.outbox.length > 0 ? (
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Outbox</div>
                  {shipment.outbox.map((event) => (
                    <div key={event.id} className="flex justify-between">
                      <span>{event.status.toLowerCase()}</span>
                      <span>{event.attempts} attempt(s)</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {shipment.settlementEntries.length > 0 ? (
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Settlement</div>
                  {shipment.settlementEntries.map((entry) => (
                    <div key={entry.id} className="flex justify-between">
                      <span>{entry.settlement?.reference}</span>
                      <span>{entry.status.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Move the parcel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ShipmentActions shipmentId={shipment.id} statuses={MANUAL_STATUSES} canRequeue={shipment.status !== "DELIVERED" && shipment.status !== "CANCELLED"} />
                <div className="border-t border-slate-100 pt-4">
                  <CourierChargeForm shipmentId={shipment.id} />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
