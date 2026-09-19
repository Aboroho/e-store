import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { getResellerDetail, resellerEarningsByOrder } from "@/modules/resellers/queries";
import { listResellerLedger } from "@/modules/resellers/earnings";
import { eligiblePayoutEntries } from "@/modules/resellers/payouts";
import { listVariantsForPricing } from "@/modules/resellers/service";
import {
  PayoutForm,
  RefreshEligibilityForm,
  ResellerAdjustmentForm,
  ResellerBalanceSummary,
  ResellerForm,
  ResellerOrderForm,
  ResellerStatusForm,
} from "@/components/forms/reseller-forms";
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

export const metadata: Metadata = { title: "Reseller" };
export const dynamic = "force-dynamic";

const ORDER_TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  PENDING: "warning",
  CONFIRMED: "info",
  PROCESSING: "info",
  READY_TO_SHIP: "brand",
  SHIPPED: "violet",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
  RETURNED: "danger",
};

export default async function ResellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "reseller.view");
  const { id } = await params;

  const detail = await getResellerDetail(session.businessId, id);
  if (!detail) notFound();

  const [ledger, earnings, eligible, variants] = await Promise.all([
    listResellerLedger(session.businessId, id, { page: 1, pageSize: 15 }),
    resellerEarningsByOrder(session.businessId, id, 15),
    eligiblePayoutEntries(session.businessId, id),
    listVariantsForPricing(session.businessId, id),
  ]);

  const reseller = detail.reseller;
  const pendingEarnings = detail.pendingEarnings.reduce((total, group) => total + (group._sum.earningsPaisa ?? 0), 0);
  const eligibleEarnings = detail.pendingEarnings
    .filter((group) => group.eligibilityStatus === "ELIGIBLE")
    .reduce((total, group) => total + (group._sum.earningsPaisa ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${reseller.name} · ${reseller.code}`}
        description={reseller.businessName ?? reseller.address ?? "Reseller account"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/resellers/${reseller.id}/pricing`} className="text-sm font-medium text-indigo-600 hover:underline">
              Manage pricing
            </Link>
            <Link href={`/admin/resellers/${reseller.id}/ledger`} className="text-sm font-medium text-indigo-600 hover:underline">
              Full ledger
            </Link>
            <Link href={`/admin/payouts/new?resellerId=${reseller.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
              Create payout
            </Link>
          </div>
        }
      />

      <ResellerBalanceSummary
        pendingPaisa={detail.balance.pendingPaisa}
        eligiblePaisa={detail.balance.eligiblePaisa}
        allocatedPaisa={detail.balance.allocatedPaisa}
        paidPaisa={detail.balance.paidPaisa}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={String(detail.orderStats.orders)} />
        <StatCard label="Sales value" value={formatPaisa(detail.orderStats.salesPaisa)} tone="brand" />
        <StatCard label="Cash they are holding" value={formatPaisa(detail.orderStats.collectedPaisa)} tone="warning" />
        <StatCard label="Earnings recorded" value={formatPaisa(detail.orderStats.earningPaisa)} hint={`${formatPaisa(pendingEarnings)} pending / ${formatPaisa(eligibleEarnings)} eligible`} tone="success" />
      </div>

      {can(session, "reseller.payout") ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a payout</CardTitle>
            <CardDescription>
              Only ledger entries that are payable can be selected. The amount is recomputed from the selected entries server-side and can never exceed the
              eligible balance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PayoutForm
              resellerId={reseller.id}
              eligiblePaisa={detail.balance.eligiblePaisa}
              minimumPayoutPaisa={reseller.minimumPayoutPaisa}
              entries={eligible.entries.map((entry) => ({
                id: entry.id,
                amountPaisa: entry.direction === "CREDIT" ? entry.amountPaisa : -entry.amountPaisa,
                label: `${entry.createdAt.toISOString().slice(0, 10)} · ${entry.type.replace(/_/g, " ").toLowerCase()}${
                  entry.order ? ` · ${entry.order.orderNumber}` : ""
                } · ${entry.description}`,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Earnings per order</CardTitle>
          <CardDescription>
            Snapshots taken when the order was delivered. Pending rows turn payable when their COD settlement is reconciled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Collected</TableHead>
                <TableHead className="text-right">Cost charged</TableHead>
                <TableHead className="text-right">Packaging</TableHead>
                <TableHead className="text-right">Courier</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {earnings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-slate-500">
                    No delivered orders yet.
                  </TableCell>
                </TableRow>
              ) : (
                earnings.map((earning) => (
                  <TableRow key={earning.id}>
                    <TableCell>
                      <Link href={`/admin/orders/${earning.order.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {earning.order.orderNumber}
                      </Link>
                      <div className="text-xs text-slate-500">{formatDateTime(earning.order.placedAt)}</div>
                    </TableCell>
                    <TableCell className="text-sm">{earning.collectedPaisa === 0 ? "—" : formatPaisa(earning.collectedPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(earning.resellerPricePaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(earning.packagingCostPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(earning.courierChargePaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(earning.codChargePaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatPaisa(earning.earningsPaisa)}</TableCell>
                    <TableCell>
                      <Badge variant={earning.eligibilityStatus === "ELIGIBLE" ? "success" : earning.eligibilityStatus === "VOID" ? "danger" : "warning"}>
                        {earning.eligibilityStatus.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Ledger</CardTitle>
            <CardDescription>Immutable: corrections are new entries, never edits.</CardDescription>
          </div>
          {can(session, "reseller.ledger_view") ? <RefreshEligibilityForm resellerId={reseller.id} /> : null}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    Nothing recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                ledger.rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</TableCell>
                    <TableCell className="text-xs">{entry.type.replace(/_/g, " ").toLowerCase()}</TableCell>
                    <TableCell className="text-sm">
                      {entry.description}
                      {entry.order ? (
                        <Link href={`/admin/orders/${entry.order.id}`} className="ml-2 text-xs text-indigo-600 hover:underline">
                          {entry.order.orderNumber}
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${entry.direction === "DEBIT" ? "text-rose-700" : ""}`}>
                      {entry.direction === "DEBIT" ? "−" : "+"}
                      {formatPaisa(entry.amountPaisa)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.status === "ELIGIBLE" ? "success" : entry.status === "PAID" ? "neutral" : entry.status === "VOID" ? "danger" : "warning"
                        }
                      >
                        {entry.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.payout ? (
                        <Link href={`/admin/payouts/${entry.payout.id}`} className="text-indigo-600 hover:underline">
                          {entry.payout.payoutNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
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
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Collection</TableHead>
                <TableHead className="text-right">Earning</TableHead>
                <TableHead>Shipment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.recentOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No orders yet — use the form below to place one.
                  </TableCell>
                </TableRow>
              ) : (
                detail.recentOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/admin/orders/${order.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                        {order.orderNumber}
                      </Link>
                      <div className="text-xs text-slate-500">{formatDateTime(order.placedAt)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ORDER_TONES[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(order.grandTotalPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{order.resellerCollectionPaisa === null ? "—" : formatPaisa(order.resellerCollectionPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{order.resellerEarningPaisa === null ? "—" : formatPaisa(order.resellerEarningPaisa)}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {order.shipments.length === 0
                        ? "—"
                        : order.shipments
                            .map((shipment) => `${shipment.status.toLowerCase()}${shipment.trackingCode ? ` (${shipment.trackingCode})` : ""}`)
                            .join(", ")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detail.collectionChanges.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Collection amount changes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.collectionChanges.map((change) => (
                  <TableRow key={change.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(change.createdAt)}</TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/admin/orders/${change.order.id}`} className="text-indigo-600 hover:underline">
                        {change.order.orderNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{change.previousPaisa === null ? "—" : formatPaisa(change.previousPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(change.newPaisa)}</TableCell>
                    <TableCell className="text-sm">{change.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {can(session, "order.create") && reseller.status === "ACTIVE" ? (
        <Card>
          <CardHeader>
            <CardTitle>Place a reseller order</CardTitle>
            <CardDescription>
              Prices come from this reseller&apos;s list, the delivery and COD rules of the reseller are applied, and the collection amount is snapshotted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResellerOrderForm
              resellerId={reseller.id}
              variants={variants.map((variant) => ({
                id: variant.id,
                label: `${variant.sku} · ${variant.productName} — ${variant.name}`,
                pricePaisa: variant.pricePaisa,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {can(session, "reseller.manage") ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Edit reseller</CardTitle>
            </CardHeader>
            <CardContent>
              <ResellerForm
                reseller={{
                  id: reseller.id,
                  code: reseller.code,
                  name: reseller.name,
                  businessName: reseller.businessName,
                  phone: reseller.phone,
                  email: reseller.email,
                  status: reseller.status,
                  commissionType: reseller.commissionType,
                  commissionValue: reseller.commissionValue,
                  packagingIncluded: reseller.packagingIncluded,
                  packagingCostPaisa: reseller.packagingCostPaisa,
                  deliveryChargePaisa: reseller.deliveryChargePaisa,
                  codChargePaisa: reseller.codChargePaisa,
                  defaultDistrictCode: reseller.defaultDistrictCode,
                  address: reseller.address,
                  nidNumber: reseller.nidNumber,
                  payoutMethod: reseller.payoutMethod,
                  payoutAccountNumber: reseller.payoutAccountNumber,
                  payoutAccountName: reseller.payoutAccountName,
                  minimumPayoutPaisa: reseller.minimumPayoutPaisa,
                  creditLimitPaisa: reseller.creditLimitPaisa,
                  note: reseller.note,
                }}
              />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Suspending a reseller blocks new orders; existing orders keep their snapshot.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResellerStatusForm resellerId={reseller.id} status={reseller.status} />
              </CardContent>
            </Card>

            {can(session, "reseller.payout") ? (
              <Card>
                <CardHeader>
                  <CardTitle>Ledger adjustment</CardTitle>
                  <CardDescription>Adjustments are payable immediately and are never editable afterwards.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResellerAdjustmentForm resellerId={reseller.id} />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : (
        <Alert variant="info">You have read-only access to this reseller.</Alert>
      )}
    </div>
  );
}
