import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { customerStats, listCustomers } from "@/modules/customers/queries";
import { CustomerForm } from "@/components/forms/customer-forms";
import { listDistricts } from "@/modules/settings/queries";
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
import { Pagination, SortableHead } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "customer.view");
  const params = await searchParams;

  const [stats, result, districts] = await Promise.all([
    customerStats(session.businessId),
    listCustomers(session.businessId, params),
    listDistricts(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="One customer identity per phone number across every storefront. Account access always requires a verification code."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={String(stats.total)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="With account" value={String(stats.withAccount)} tone="violet" />
        <StatCard label="Blocked" value={String(stats.blocked)} tone={stats.blocked > 0 ? "danger" : "success"} />
        <StatCard label="Lifetime spend" value={formatPaisa(stats.totalSpentPaisa)} tone="success" />
      </div>

      {can(session, "customer.update") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a customer</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerForm districts={districts.map((district) => ({ code: district.code, name: district.name }))} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>All customers</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <SearchForm placeholder="Name, phone or email" defaultValue={result.search ?? ""} />
            <FilterSelect
              name="status"
              value={typeof params.status === "string" ? params.status : "ALL"}
              options={[
                { value: "ALL", label: "All statuses" },
                { value: "ACTIVE", label: "Active" },
                { value: "BLOCKED", label: "Blocked" },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.rows.length === 0 ? (
            <EmptyState title="No customers yet" description="Customers appear here as soon as an order is placed, in-store or online." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Customer"
                      field="name"
                      currentSortBy={result.sortBy}
                      currentSortDir={result.sortDir}
                      basePath="/admin/customers"
                      searchParams={params}
                    />
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <SortableHead
                      label="Spent"
                      field="totalSpentPaisa"
                      currentSortBy={result.sortBy}
                      currentSortDir={result.sortDir}
                      basePath="/admin/customers"
                      searchParams={params}
                      className="text-right"
                    />
                    <SortableHead
                      label="Last order"
                      field="lastOrderAt"
                      currentSortBy={result.sortBy}
                      currentSortDir={result.sortDir}
                      basePath="/admin/customers"
                      searchParams={params}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Link href={`/admin/customers/${customer.id}`} className="font-medium text-indigo-600 hover:underline">
                          {customer.name}
                        </Link>
                        <div className="text-xs text-slate-500">{customer.email ?? "No email"}</div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{customer.phoneNormalized}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={customer.status === "ACTIVE" ? "success" : "danger"}>{customer.status.toLowerCase()}</Badge>
                          {customer.hasAccount ? <Badge variant="info">account</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{customer.totalOrders}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaisa(customer.totalSpentPaisa)}</TableCell>
                      <TableCell className="text-xs text-slate-500">{customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/customers" searchParams={params} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
