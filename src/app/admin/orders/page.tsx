import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { listOrders, orderStats } from "@/modules/orders/queries";
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
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
import { FilterSelect, SearchForm } from "@/components/ui/interactive";
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type BadgeVariant = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";

const STATUS_TONES: Record<string, BadgeVariant> = {
  PENDING: "warning",
  CONFIRMED: "brand",
  PROCESSING: "brand",
  READY_TO_SHIP: "violet",
  SHIPPED: "violet",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const PAYMENT_TONES: Record<string, BadgeVariant> = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  PARTIALLY_REFUNDED: "warning",
  REFUNDED: "neutral",
  UNPAID: "neutral",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "order.view");
  const params = await searchParams;

  const query = parseListQuery(params, {
    defaultSortBy: "placedAt",
    defaultSortDir: "desc",
    allowedSortBy: ["placedAt", "grandTotalPaisa", "orderNumber", "duePaisa"],
  });
  const filterValue = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [stats, result] = await Promise.all([
    orderStats(session.businessId),
    listOrders(session.businessId, {
      search: query.search,
      status: filterValue("status"),
      paymentStatus: filterValue("paymentStatus"),
      channel: filterValue("channel"),
      storefrontId: filterValue("storefrontId"),
      customerId: filterValue("customerId"),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every channel — storefront, in-store, admin and reseller — lands here with the same lifecycle, stock reservation and payment rules."
        actions={
          <Link href="/admin/orders/new" className={buttonVariants({ variant: "default" })}>
            <Plus className="mr-2 h-4 w-4" /> New order
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open orders" value={String(stats.open)} hint={`${stats.awaitingDispatch} awaiting dispatch`} tone="brand" />
        <StatCard label="Placed today" value={String(stats.today)} tone="violet" />
        <StatCard label="Outstanding due" value={formatPaisa(stats.unpaidDuePaisa)} tone={stats.unpaidDuePaisa > 0 ? "warning" : "success"} />
        <StatCard label="Preorder orders" value={String(stats.preorderOrders)} hint={`${stats.refundQueue} refund(s) queued`} tone={stats.refundQueue > 0 ? "warning" : "slate"} />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <SearchForm placeholder="Order number, name, phone or reference" defaultValue={query.search ?? ""} />
            <FilterSelect
              name="status"
              value={typeof params.status === "string" ? params.status : "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                ...["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"].map((status) => ({
                  value: status,
                  label: status.replace(/_/g, " ").toLowerCase(),
                })),
              ]}
            />
            <FilterSelect
              name="paymentStatus"
              value={typeof params.paymentStatus === "string" ? params.paymentStatus : "ALL"}
              options={[
                { value: "ALL", label: "Any payment" },
                ...["UNPAID", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"].map((status) => ({
                  value: status,
                  label: status.replace(/_/g, " ").toLowerCase(),
                })),
              ]}
            />
            <FilterSelect
              name="channel"
              value={typeof params.channel === "string" ? params.channel : "ALL"}
              options={[
                { value: "ALL", label: "All channels" },
                { value: "STOREFRONT", label: "Storefront" },
                { value: "ADMIN", label: "Admin" },
                { value: "IN_STORE", label: "In-store" },
                { value: "RESELLER", label: "Reseller" },
                { value: "API", label: "API" },
              ]}
            />
          </div>

          {result.rows.length === 0 ? (
            <EmptyState
              title="No orders match these filters"
              description="Create an order from the admin screen, or place one through a storefront to see the lifecycle in action."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead>Placed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((order) => {
                    const units = order.items.reduce((total, item) => total + item.quantity, 0);
                    const hasPreorder = order.items.some((item) => item.isPreorder);
                    const shipment = order.shipments[0];
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/admin/orders/${order.id}`} className="font-medium text-indigo-600 hover:underline">
                            {order.orderNumber}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {units} unit(s){hasPreorder ? " · preorder" : ""}
                            {shipment?.trackingCode ? ` · ${shipment.trackingCode}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-slate-900">{order.customerName ?? "—"}</div>
                          <div className="text-xs text-slate-500">{order.customerPhoneNormalized ?? ""}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">{order.channel.replace(/_/g, " ").toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_TONES[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={PAYMENT_TONES[order.paymentStatus] ?? "neutral"}>{order.paymentStatus.replace(/_/g, " ").toLowerCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaisa(order.grandTotalPaisa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{order.duePaisa > 0 ? formatPaisa(order.duePaisa) : "—"}</TableCell>
                        <TableCell className="text-xs text-slate-500">{formatDateTime(order.placedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/orders" searchParams={params} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
