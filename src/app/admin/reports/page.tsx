import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { REPORT_DEFINITIONS, reportHighlights } from "@/modules/reports/queries";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await requireSession();
  assertPermission(session, "report.view");
  const highlights = await reportHighlights(session.businessId);
  const canSeeCost = can(session, "report.view_cost");

  const groups = [...new Set(REPORT_DEFINITIONS.map((definition) => definition.group))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Calculated from the database on every run — no cached snapshots, no spreadsheet exports to keep in sync. Every report can be downloaded as PDF or XLSX."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue this month" value={formatPaisa(highlights.monthRevenuePaisa)} hint={`${highlights.monthOrders} order(s)`} tone="brand" />
        <StatCard
          label="Gross profit this month"
          value={canSeeCost ? formatPaisa(highlights.monthRevenuePaisa - highlights.monthCostPaisa) : "Restricted"}
          hint={canSeeCost ? "Revenue less recorded inventory cost" : "Needs the cost permission"}
          tone="success"
        />
        <StatCard label="Units on hand" value={String(highlights.onHandUnits)} />
        <StatCard
          label="Reseller money pending settlement"
          value={formatPaisa(highlights.resellerAwaitingSettlementPaisa)}
          hint={`${highlights.outstandingPreorders} outstanding preorder(s)`}
          tone="warning"
        />
      </div>

      {!canSeeCost ? (
        <Card>
          <CardContent className="pt-6 text-sm text-slate-600">
            Your role does not include the cost permission, so cost and profit lines are hidden from the reports and from exports. Ask an owner for{" "}
            <code className="rounded bg-slate-100 px-1">report.view_cost</code> if you need them.
          </CardContent>
        </Card>
      ) : null}

      {groups.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group}</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {REPORT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => {
              const restricted = definition.sensitive && !canSeeCost;
              return (
                <Card key={definition.key}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{definition.title}</CardTitle>
                      {definition.sensitive ? <Badge variant={restricted ? "warning" : "info"}>{restricted ? "cost hidden" : "cost data"}</Badge> : null}
                    </div>
                    <CardDescription>{definition.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Link href={`/admin/reports/${definition.key}`} className="text-sm font-medium text-indigo-600 hover:underline">
                      Open report →
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-slate-500">
        Revenue is not profit. Reports separate order revenue, inventory cost, packaging and fulfilment, courier charges, COD charges, refunds and reseller
        payouts so no figure is ever presented as earnings when it is not.
      </p>
    </div>
  );
}
