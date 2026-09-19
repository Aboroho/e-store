import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { listShipments, shipmentStats } from "@/modules/orders/queries";
import { listCourierProviders } from "@/modules/couriers/service";
import {
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

export const metadata: Metadata = { title: "Shipments" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  DRAFT: "neutral",
  PENDING: "warning",
  CREATED: "info",
  PICKED_UP: "info",
  IN_TRANSIT: "violet",
  OUT_FOR_DELIVERY: "brand",
  DELIVERED: "success",
  PARTIALLY_DELIVERED: "warning",
  RETURNED: "danger",
  CANCELLED: "neutral",
  EXCEPTION: "danger",
  FAILED: "danger",
};

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const params = await searchParams;
  const filterValue = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [stats, result, providers] = await Promise.all([
    shipmentStats(session.businessId),
    listShipments(session.businessId, {
      search: typeof params.q === "string" ? params.q : undefined,
      status: filterValue("status"),
      providerCode: filterValue("providerCode"),
      page: Number.parseInt(String(filterValue("page") ?? "1"), 10) || 1,
    }),
    listCourierProviders(session.businessId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shipments"
        description="Every parcel with its provider tracking code, courier charge and cash-on-delivery amount. Provider calls run through the outbox worker, never inside a request."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In flight" value={String(stats.inFlight)} icon={<Truck className="h-4 w-4" />} />
        <StatCard label="Delivered" value={String(stats.delivered)} tone="success" />
        <StatCard label="Returned" value={String(stats.returned)} tone={stats.returned > 0 ? "warning" : "slate"} />
        <StatCard label="Failed / exception" value={String(stats.exceptions)} tone={stats.exceptions > 0 ? "danger" : "slate"} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All shipments</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Internal code, tracking, phone or order" defaultValue={typeof params.q === "string" ? params.q : ""} />
            <FilterSelect
              name="status"
              value={filterValue("status") ?? "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "PENDING", label: "Pending" },
                { value: "CREATED", label: "Created" },
                { value: "IN_TRANSIT", label: "In transit" },
                { value: "DELIVERED", label: "Delivered" },
                { value: "RETURNED", label: "Returned" },
                { value: "FAILED", label: "Failed" },
              ]}
            />
            <FilterSelect
              name="providerCode"
              value={filterValue("providerCode") ?? "ALL"}
              options={[{ value: "ALL", label: "All couriers" }, ...providers.map((provider) => ({ value: provider.code, label: provider.name }))]}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.rows.length === 0 ? (
            <EmptyState title="No shipments yet" description="Dispatch an order to create its first shipment." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shipment</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Courier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">COD</TableHead>
                    <TableHead>Last update</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((shipment) => (
                    <TableRow key={shipment.id}>
                      <TableCell>
                        <Link href={`/admin/shipments/${shipment.id}`} className="font-medium text-indigo-600 hover:underline">
                          {shipment.internalCode}
                        </Link>
                        <div className="text-xs text-slate-500">{shipment.trackingCode ?? "no tracking code yet"}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {shipment.order ? (
                          <Link href={`/admin/orders/${shipment.order.id}`} className="text-indigo-600 hover:underline">
                            {shipment.order.orderNumber}
                          </Link>
                        ) : (
                          <span className="text-slate-500">exchange</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-slate-900">{shipment.recipientName}</div>
                        <div className="text-xs text-slate-500">{shipment.recipientPhone}</div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{shipment.courier?.name ?? shipment.providerCode}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONES[shipment.status] ?? "neutral"}>{shipment.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(shipment.codAmountPaisa)}</TableCell>
                      <TableCell className="text-xs text-slate-500">{shipment.lastStatusAt ? formatDateTime(shipment.lastStatusAt) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/shipments" searchParams={params} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
