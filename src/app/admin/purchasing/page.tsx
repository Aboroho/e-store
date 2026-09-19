import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { listPurchaseOrders, listSuppliers, supplierSummaries } from "@/modules/purchasing/queries";
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

export const metadata: Metadata = { title: "Purchases" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "info" | "warning" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "danger",
};

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "purchase.view");
  const params = await searchParams;
  const query = parseListQuery(params);
  const status = typeof params.status === "string" ? params.status : undefined;
  const supplierId = typeof params.supplierId === "string" && params.supplierId ? params.supplierId : undefined;

  const [{ orders, total }, suppliers, summaries] = await Promise.all([
    listPurchaseOrders(session.businessId, { search: query.search, status, supplierId, skip: query.skip, take: query.take, sortDir: query.sortDir }),
    listSuppliers(session.businessId),
    supplierSummaries(session.businessId),
  ]);

  const openOrders = orders.filter((order) => order.status === "ORDERED" || order.status === "DRAFT").length;
  const outstanding = summaries.reduce((sum, supplier) => sum + Math.max(supplier.outstandingPaisa, 0), 0);
  const incomingValue = orders
    .filter((order) => order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED")
    .reduce(
      (sum, order) =>
        sum +
        order.items.reduce((lineSum, item) => lineSum + (item.orderedQuantity - item.receivedQuantity) * 100, 0),
      0,
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchases"
        description="Supplier orders, goods receipts and payable balances. Receiving updates stock and the weighted average cost in one transaction."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/purchasing/suppliers" className={buttonVariants({ variant: "secondary" })}>
              Suppliers
            </Link>
            {can(session, "purchase.create") ? (
              <Link href="/admin/purchasing/new" className={buttonVariants({ variant: "default" })}>
                <Plus className="mr-1 h-4 w-4" /> New purchase order
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open purchase orders" value={openOrders} hint="On this page" tone={openOrders > 0 ? "warning" : "success"} />
        <StatCard label="Unpaid supplier balance" value={formatPaisa(outstanding)} hint="Across active suppliers" />
        <StatCard label="Units still incoming" value={orders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + (item.orderedQuantity - item.receivedQuantity), 0), 0)} hint={`Indicative value ${formatPaisa(incomingValue)}`} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 border-b border-slate-100">
          <SearchForm defaultValue={query.search} placeholder="Search code, supplier or note" />
          <FilterSelect
            name="status"
            label="Status"
            value={status ?? "ALL"}
            options={[
              { value: "ALL", label: "All statuses" },
              { value: "DRAFT", label: "Draft" },
              { value: "ORDERED", label: "Ordered" },
              { value: "PARTIALLY_RECEIVED", label: "Partially received" },
              { value: "RECEIVED", label: "Received" },
              { value: "CANCELLED", label: "Cancelled" },
            ]}
          />
          <FilterSelect
            name="supplierId"
            label="Supplier"
            value={supplierId ?? ""}
            options={[{ value: "", label: "All suppliers" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
          />
        </CardContent>

        {orders.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No purchase orders"
              description="Create a purchase order to track what you ordered, receive it in parts and keep supplier balances accurate."
              action={
                can(session, "purchase.create") ? (
                  <Link href="/admin/purchasing/new" className={buttonVariants({ variant: "default" })}>
                    New purchase order
                  </Link>
                ) : null
              }
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-center">Receipts</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const outstandingPaisa = order.totalPaisa - order.paidPaisa;
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/admin/purchasing/${order.id}`} className="font-mono text-sm font-medium text-brand-600 hover:underline">
                        {order.code}
                      </Link>
                      <p className="text-xs text-slate-500">{formatDate(order.createdAt)}</p>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{order.supplier.name}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{order.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{order.expectedAt ? formatDate(order.expectedAt) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaisa(order.totalPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{formatPaisa(order.paidPaisa)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={outstandingPaisa > 0 ? "font-medium text-amber-700" : undefined}>{formatPaisa(outstandingPaisa)}</span>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{order._count.receipts}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/admin/purchasing/${order.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/purchasing" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
