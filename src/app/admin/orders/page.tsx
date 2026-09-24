import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { manualOrderContext } from "@/modules/orders/manual";
import {
  orderCreatorOptions,
  orderCreatorRoleOptions,
  orderListSummary,
  searchOrders,
  type OrderListFilters,
} from "@/modules/orders/lookup";
import { resolveOrderColumns } from "@/modules/orders/columns";
import { courierProviders } from "@/modules/orders/queries";
import { OrderList } from "@/components/orders/order-list";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

/** Parse a `YYYY-MM-DD` filter into a Date at the start (or end) of that day. */
function dayBoundary(value: string | undefined, end: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "order.view");
  const params = await searchParams;

  const value = (key: string): string | undefined => {
    const entry = params[key];
    return Array.isArray(entry) ? entry[0] : entry;
  };

  const context = await manualOrderContext(session);
  const page = Math.max(1, Number.parseInt(value("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(value("pageSize") ?? "25", 10) || 25));

  const filters: OrderListFilters = {
    search: value("q"),
    status: value("status"),
    orderType: value("orderType"),
    paymentStatus: value("paymentStatus"),
    channel: value("channel"),
    districtCode: value("districtCode"),
    createdByUserRole: value("createdByUserRole"),
    creator: value("createdByUserId") === "mine" ? "mine" : undefined,
    createdByUserId: value("createdByUserId") === "mine" ? undefined : value("createdByUserId"),
    resellerId: value("resellerId"),
    from: dayBoundary(value("from"), false),
    to: dayBoundary(value("to"), true),
    page,
    pageSize,
    sortBy: value("sortBy"),
    sortDir: value("sortDir") === "asc" ? "asc" : "desc",
  };

  const [result, summary, columnConfig, creators, creatorRoles, districts, providers] = await Promise.all([
    searchOrders(context, filters),
    orderListSummary(context, { ...filters, page: undefined, pageSize: undefined }),
    resolveOrderColumns(context),
    orderCreatorOptions(context),
    orderCreatorRoleOptions(context),
    prisma.district.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    courierProviders(session.businessId, true),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description={
          can(session, "order.view_all")
            ? "Every order in the business, scoped by the filters below. Status changes, dispatch and deletion are re-checked on the server for each order."
            : "Orders you created. Status changes and edits are limited to what your role may do, and the server re-checks every request."
        }
      />

      {/* `useSearchParams` in the list needs a suspense boundary. */}
      <Suspense fallback={<p className="text-sm text-slate-500">Loading orders…</p>}>
      <OrderList
        orders={result.orders}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        columns={columnConfig.definitions}
        availableColumns={columnConfig.available}
        columnSource={columnConfig.source}
        mayManageColumns={columnConfig.mayManage}
        mayViewCosts={can(session, "order.view_cost")}
        mayBulkStatus={can(session, "order.update")}
        mayDispatch={can(session, "order.dispatch")}
        providers={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
        districts={districts}
        creators={creators}
        creatorRoles={creatorRoles}
        summary={summary}
      />
      </Suspense>
    </div>
  );
}
