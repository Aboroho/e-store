import Link from "next/link";
import type { Metadata } from "next";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Package,
  RefreshCw,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getDashboardMetrics, type DashboardMetrics } from "@/modules/dashboard/queries";
import { formatPaisa } from "@/lib/money";
import { formatRelative } from "@/lib/utils";
import { logger } from "@/lib/logging";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import type { PermissionSubject } from "@/lib/permissions";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

const ORDER_STATUS_VARIANT: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "brand",
  PROCESSING: "brand",
  READY_TO_SHIP: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const PAYMENT_STATUS_VARIANT: Record<string, BadgeTone> = {
  UNPAID: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

function SalesChart({ series }: { series: Array<{ date: string; revenuePaisa: number }> }) {
  const max = Math.max(1, ...series.map((point) => point.revenuePaisa));
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Revenue over the last 30 days">
      {series.map((point) => {
        const height = Math.round((point.revenuePaisa / max) * 100);
        return (
          <div
            key={point.date}
            className="flex flex-1 flex-col items-center justify-end"
            title={`${point.date}: ${formatPaisa(point.revenuePaisa)}`}
          >
            <div
              className="w-full rounded-t bg-brand-500/80 transition-all hover:bg-brand-600"
              style={{ height: `${Math.max(point.revenuePaisa > 0 ? 4 : 1, height)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

async function loadMetrics(subject: PermissionSubject): Promise<{ metrics: DashboardMetrics | null; error: string | null }> {
  try {
    const metrics = await getDashboardMetrics(subject);
    return { metrics, error: null };
  } catch (error) {
    logger.error("Dashboard metrics failed to load", error, { userId: subject.id, businessId: subject.businessId });
    return {
      metrics: null,
      error: "Dashboard data could not be loaded. The database may be unavailable — check the server logs.",
    };
  }
}

export default async function AdminDashboardPage() {
  const session = await requireSession();
  const { metrics, error } = await loadMetrics(session);

  if (!metrics) {
    return (
      <div className="space-y-4">
        <PageHeader title={`Welcome back, ${session.name.split(" ")[0]}`} />
        <ErrorState title="Dashboard unavailable" description={error ?? "Unexpected error"} />
      </div>
    );
  }

  const canViewOrders = can(session, "order.view");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${session.name.split(" ")[0]}`}
        description="Live operational snapshot built from the platform database. Figures respect your permissions."
        actions={
          <>
            {can(session, "order.create") ? (
              <Link href="/admin/orders/new" className="text-sm font-medium text-brand-600 hover:underline">
                Create order
              </Link>
            ) : null}
            {can(session, "report.view") ? (
              <Link href="/admin/reports" className="text-sm font-medium text-brand-600 hover:underline">
                Open reports
              </Link>
            ) : null}
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewOrders ? (
          <>
            <StatCard
              label="Revenue today"
              value={formatPaisa(metrics.revenueTodayPaisa)}
              hint={`${metrics.ordersToday} order${metrics.ordersToday === 1 ? "" : "s"} placed today`}
              icon={<ShoppingCart className="h-5 w-5" />}
              href="/admin/orders"
            />
            <StatCard
              label="Revenue · last 30 days"
              value={formatPaisa(metrics.revenue30dPaisa)}
              hint={`${metrics.orders30d} orders excluding cancelled`}
              tone="violet"
              icon={<Banknote className="h-5 w-5" />}
              href="/admin/reports"
            />
            <StatCard
              label="Awaiting confirmation"
              value={metrics.ordersPending}
              hint="Orders in PENDING or CONFIRMED"
              tone="warning"
              icon={<AlertTriangle className="h-5 w-5" />}
              href="/admin/orders?status=PENDING"
            />
            <StatCard
              label="Pending shipments"
              value={metrics.pendingShipments}
              hint="Not yet delivered or returned"
              tone="brand"
              icon={<Truck className="h-5 w-5" />}
              href="/admin/couriers"
            />
          </>
        ) : null}

        {can(session, "inventory.view") ? (
          <>
            <StatCard
              label="Low stock variants"
              value={metrics.lowStockCount}
              hint="Available quantity at or below threshold"
              tone="danger"
              icon={<Boxes className="h-5 w-5" />}
              href="/admin/inventory?filter=low"
            />
            <StatCard
              label="Active products"
              value={metrics.activeProducts}
              tone="slate"
              icon={<Package className="h-5 w-5" />}
              href="/admin/catalog/products"
            />
          </>
        ) : null}

        {can(session, "courier.reconcile") ? (
          <StatCard
            label="COD awaiting settlement"
            value={formatPaisa(metrics.outstandingCodPaisa)}
            hint="Collected by couriers, not yet reconciled"
            tone="warning"
            icon={<Banknote className="h-5 w-5" />}
            href="/admin/settlements"
          />
        ) : null}

        {can(session, "reseller.payout") ? (
          <StatCard
            label="Eligible reseller payouts"
            value={formatPaisa(metrics.pendingPayoutPaisa)}
            hint="Eligible once the COD settlement is reconciled"
            tone="success"
            icon={<Banknote className="h-5 w-5" />}
            href="/admin/resellers/payouts"
          />
        ) : null}

        {can(session, "exchange.view") ? (
          <StatCard
            label="Open exchanges"
            value={metrics.openExchanges}
            hint="Requests not completed or cancelled"
            tone="violet"
            icon={<RefreshCw className="h-5 w-5" />}
            href="/admin/exchanges"
          />
        ) : null}

        {can(session, "customer.view") ? (
          <StatCard
            label="New customers · 30 days"
            value={metrics.customers30d}
            tone="slate"
            icon={<Users className="h-5 w-5" />}
            href="/admin/customers"
          />
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue · last 30 days</CardTitle>
            <p className="text-xs text-slate-500">Excludes cancelled orders · order value in BDT</p>
          </CardHeader>
          <CardContent>
            {canViewOrders ? (
              <>
                <SalesChart series={metrics.salesSeries} />
                <div className="mt-3 flex justify-between text-xs text-slate-400">
                  <span>{metrics.salesSeries[0]?.date}</span>
                  <span>{metrics.salesSeries[metrics.salesSeries.length - 1]?.date}</span>
                </div>
              </>
            ) : (
              <EmptyState title="Order permissions required" description="You do not have permission to view sales data." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products · 30 days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.topProducts.length === 0 ? (
              <p className="text-sm text-slate-500">No sales recorded in the last 30 days yet.</p>
            ) : (
              metrics.topProducts.map((product) => (
                <div key={product.productName} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-700">{product.productName}</span>
                  <span className="whitespace-nowrap text-slate-500">
                    {product.quantity} pcs · {formatPaisa(product.revenuePaisa)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <Link href="/admin/orders" className="text-sm font-medium text-brand-600 hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="px-0 py-0">
            {metrics.recentOrders.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No orders yet"
                  description="Orders created from the storefront, admin panel, resellers or in-store sales will appear here."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Placed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.recentOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/admin/orders/${order.id}`} className="font-medium text-brand-600 hover:underline">
                          {order.orderNumber}
                        </Link>
                        <span className="ml-2 text-xs text-slate-400">{order.channel.toLowerCase()}</span>
                      </TableCell>
                      <TableCell>{order.customerName ?? "Guest"}</TableCell>
                      <TableCell>
                        <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? "neutral"}>
                          {order.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={PAYMENT_STATUS_VARIANT[order.paymentStatus] ?? "neutral"}>
                          {order.paymentStatus.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(order.grandTotalPaisa)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatRelative(order.placedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Low stock</CardTitle>
            <Link href="/admin/inventory?filter=low" className="text-sm font-medium text-brand-600 hover:underline">
              Inventory
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.lowStock.length === 0 ? (
              <p className="text-sm text-slate-500">No variants are at or below the low stock threshold.</p>
            ) : (
              metrics.lowStock.map((variant) => (
                <div key={variant.variantId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">
                    <span className="font-medium text-slate-700">{variant.productName}</span>
                    <span className="ml-1 text-xs text-slate-400">{variant.sku}</span>
                  </span>
                  <Badge variant={variant.available <= 0 ? "danger" : "warning"}>{variant.available} left</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
