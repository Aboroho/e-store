import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { parseListQuery } from "@/lib/validation";
import { formatDateTime } from "@/lib/utils";
import { Badge, Card, CardContent, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { SearchForm } from "@/components/ui/interactive";
import { Pagination, SortableHead } from "@/components/ui/pagination";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const SENSITIVE_ACTIONS = ["user.password_reset", "role.updated", "role.deleted", "settings.business_updated"];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "audit.view");
  const params = await searchParams;
  const query = parseListQuery(params, { defaultSortBy: "createdAt", allowedSortBy: ["createdAt"] });

  const actionFilter = typeof params.action === "string" ? params.action : undefined;
  const actorFilter = typeof params.actor === "string" ? params.actor : undefined;

  const where = {
    businessId: session.businessId,
    ...(actionFilter ? { action: { startsWith: actionFilter } } : {}),
    ...(actorFilter ? { actorLabel: { contains: actorFilter, mode: "insensitive" as const } } : {}),
    ...(query.search
      ? {
          OR: [
            { summary: { contains: query.search, mode: "insensitive" as const } },
            { entityType: { contains: query.search, mode: "insensitive" as const } },
            { entityId: { contains: query.search, mode: "insensitive" as const } },
            { action: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [entries, total, distinctActions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: query.sortDir },
      skip: query.skip,
      take: query.take,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { businessId: session.businessId },
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Append-only record of privileged actions: who changed what, when, and from where."
      />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
          <SearchForm defaultValue={query.search} placeholder="Search summary, entity or action" />
          <form className="flex flex-wrap items-center gap-2" action="/admin/audit">
            <label className="text-sm text-slate-600" htmlFor="action">
              Action
            </label>
            <select
              id="action"
              name="action"
              defaultValue={actionFilter ?? ""}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
            >
              <option value="">All</option>
              {distinctActions.map((entry) => (
                <option key={entry.action} value={entry.action}>
                  {entry.action}
                </option>
              ))}
            </select>
            <button type="submit" className="text-sm font-medium text-brand-600 hover:underline">
              Apply
            </button>
          </form>
        </CardContent>

        {entries.length === 0 ? (
          <CardContent>
            <EmptyState title="No audit entries" description="Privileged actions will be recorded here automatically." />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="When"
                  field="createdAt"
                  currentSortBy={query.sortBy}
                  currentSortDir={query.sortDir}
                  basePath="/admin/audit"
                  searchParams={params}
                />
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell className="text-sm">
                    {entry.actorLabel ?? entry.actorType.toLowerCase()}
                    <span className="ml-1 text-xs text-slate-400">{entry.actorType.toLowerCase()}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={SENSITIVE_ACTIONS.includes(entry.action) ? "warning" : "neutral"}>{entry.action}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {entry.entityType}
                    {entry.entityId ? <span className="ml-1 font-mono text-[11px]">{entry.entityId.slice(0, 8)}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-[320px] text-sm text-slate-600">{entry.summary ?? "—"}</TableCell>
                  <TableCell className="text-xs text-slate-400">{entry.ipAddress ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="px-4">
          <Pagination page={query.page} pageSize={query.pageSize} total={total} basePath="/admin/audit" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
