import Link from "next/link";
import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { SearchForm } from "@/components/ui/interactive";
import { Pagination, SortableHead } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  INVITED: "warning",
  SUSPENDED: "danger",
  DISABLED: "neutral",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "user.manage");
  const params = await searchParams;
  const query = parseListQuery(params, {
    defaultSortBy: "createdAt",
    allowedSortBy: ["createdAt", "name", "lastLoginAt"],
  });

  const statusFilter = typeof params.status === "string" ? params.status : undefined;
  const where = {
    businessId: session.businessId,
    deletedAt: null,
    ...(statusFilter && statusFilter !== "ALL" ? { status: statusFilter as "ACTIVE" } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy =
    query.sortBy === "name"
      ? { name: query.sortDir }
      : query.sortBy === "lastLoginAt"
        ? { lastLoginAt: query.sortDir }
        : { createdAt: query.sortDir };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.take,
      include: { roles: { include: { role: { select: { id: true, name: true, slug: true } } } } },
    }),
    prisma.user.count({ where }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Staff accounts that can access the management platform. Permissions come from assigned roles."
        actions={
          <Link
            href="/admin/users/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <UserPlus className="h-4 w-4" /> New user
          </Link>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
          <SearchForm defaultValue={query.search} placeholder="Search name or email" />
          <form className="flex items-center gap-2" action="/admin/users">
            <input type="hidden" name="q" value={query.search ?? ""} />
            <label className="text-sm text-slate-600" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={statusFilter ?? "ALL"}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DISABLED">Disabled</option>
            </select>
            <button type="submit" className="text-sm font-medium text-brand-600 hover:underline">
              Apply
            </button>
          </form>
        </CardContent>

        {users.length === 0 ? (
          <CardContent>
            <EmptyState
              title="No users found"
              description="Create the first staff account to give your team access to the platform."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="User" field="name" currentSortBy={query.sortBy} currentSortDir={query.sortDir} basePath="/admin/users" searchParams={params} />
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <SortableHead label="Last sign-in" field="lastLoginAt" currentSortBy={query.sortBy} currentSortDir={query.sortDir} basePath="/admin/users" searchParams={params} />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar name={user.name} />
                      <div>
                        <p className="font-medium text-slate-900">
                          {user.name}
                          {user.isOwner ? <Badge variant="brand" className="ml-2">Owner</Badge> : null}
                        </p>
                        <p className="text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((entry) => (
                        <Badge key={entry.role.id} variant="neutral">
                          {entry.role.name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[user.status] ?? "neutral"}>{user.status.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{formatDateTime(user.lastLoginAt)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/users/${user.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                      Manage
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 ? <TableEmpty colSpan={5} message="No users match the current filters" /> : null}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/users" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
