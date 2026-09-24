import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { formatPaisa } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import { userDisplayNames } from "@/modules/users/queries";
import { ORDER_TYPE_LABELS, type OrderTypeValue } from "@/modules/orders/status";
import {
  Badge,
  Card,
  CardContent,
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
import { Pagination } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Deleted orders" };
export const dynamic = "force-dynamic";

/**
 * Deletion log.
 *
 * Deleting a cancelled order is permanent — there is no bin and nothing here can
 * be restored. What survives is this log: a snapshot of the order as it was, who
 * deleted it, when and why. The customer record and the inventory ledger are
 * untouched by a deletion, so stock history and customer history stay complete.
 */
export default async function DeletedOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "order.delete");
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const pageSize = 20;
  const search = typeof params.q === "string" ? params.q.trim() : "";

  const where = {
    businessId: session.businessId,
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" as const } },
            { customerName: { contains: search, mode: "insensitive" as const } },
            { customerPhoneNormalized: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.orderDeletionRecord.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { id: true, name: true } }, deletedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.orderDeletionRecord.count({ where }),
  ]);

  const names = await userDisplayNames(records.map((record) => record.deletedByUserId));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Order list
        </Link>
      </div>

      <PageHeader
        title="Deleted orders"
        description="Permanent deletions of cancelled orders. Each row keeps the snapshot written before the order was removed; customers, stock movements and the audit trail were never deleted."
      />

      <Card>
        <CardContent className="space-y-3 py-4">
          <form className="flex flex-wrap items-center gap-2" action="/admin/orders/deleted">
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Order number, customer or phone…"
              className="h-9 w-full min-w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:w-72"
            />
            <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Search
            </button>
          </form>

          {records.length === 0 ? (
            <EmptyState
              title="Nothing has been deleted"
              description="Only cancelled orders can be deleted, and only by a user with the delete permission. When one is removed, its snapshot appears here."
              icon={<Trash2 className="h-8 w-8 text-slate-300" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Deleted by</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Snapshot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <span className="font-medium text-slate-900">{record.orderNumber}</span>
                      <span className="block text-[11px] text-slate-400">{record.channel.replace(/_/g, " ").toLowerCase()}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="neutral">
                        {ORDER_TYPE_LABELS[record.orderType as OrderTypeValue] ?? record.orderType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-700">{record.customerName ?? "Guest"}</span>
                      <span className="block text-[11px] text-slate-400">{record.customerPhoneNormalized ?? "—"}</span>
                      {record.customer ? (
                        <Link href={`/admin/customers/${record.customer.id}`} className="text-[11px] text-brand-700 hover:underline">
                          Customer record kept
                        </Link>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPaisa(record.grandTotalPaisa)}
                      {record.paidPaisa > 0 ? (
                        <span className="block text-[11px] text-slate-400">paid {formatPaisa(record.paidPaisa)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-700">
                        {record.deletedBy?.name ?? names.get(record.deletedByUserId ?? "") ?? "Unknown user"}
                      </span>
                      {record.deletedByRole ? <span className="block text-[11px] text-slate-400">{record.deletedByRole}</span> : null}
                      {record.reason ? <span className="block text-[11px] text-slate-500">{record.reason}</span> : null}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{formatDateTime(record.deletedAt)}</TableCell>
                    <TableCell>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-brand-700 hover:underline">View snapshot</summary>
                        <pre className="mt-2 max-h-64 w-[24rem] overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                          {JSON.stringify(record.snapshot, null, 2)}
                        </pre>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/orders/deleted"
        searchParams={params}
      />
    </div>
  );
}
