import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { formatPaisa } from "@/lib/money";
import { REPORT_DEFINITIONS, reportDefinition, resolveRange, runReport, type ReportColumn, type ReportResult } from "@/modules/reports/queries";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

function display(value: string | number | null | undefined, column: ReportColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.format === "paisa") return formatPaisa(Number(value));
  if (column.format === "number") return new Intl.NumberFormat("en-BD").format(Number(value));
  if (column.format === "date") return String(value).replace("T", " ").slice(0, 16);
  return String(value);
}

function DataTable({ columns, rows, totals }: { columns: ReportColumn[]; rows: Array<Record<string, string | number | null>>; totals?: Record<string, number> }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.align === "right" ? "text-right" : ""}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-6 text-center text-sm text-slate-500">
                No rows for this range.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => {
                  const value = row[column.key];
                  const negativePaisa = column.format === "paisa" && typeof value === "number" && value < 0;
                  return (
                    <TableCell
                      key={column.key}
                      className={`${column.align === "right" ? "text-right tabular-nums" : ""} ${negativePaisa ? "text-rose-700" : ""}`}
                    >
                      {display(value, column)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
          {totals && Object.keys(totals).length > 0 && rows.length > 0 ? (
            <TableRow className="bg-slate-50 font-semibold">
              {columns.map((column, index) => (
                <TableCell key={column.key} className={column.align === "right" ? "text-right tabular-nums" : ""}>
                  {index === 0 ? "TOTAL" : column.key in totals ? display(totals[column.key], column) : ""}
                </TableCell>
              ))}
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  assertPermission(session, "report.view");
  const [{ key }, search] = await Promise.all([params, searchParams]);

  const definition = reportDefinition(key);
  if (!definition) notFound();

  const filterValue = (name: string) => {
    const value = search[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const range = resolveRange({ from: filterValue("from"), to: filterValue("to") });
  const report: ReportResult = await runReport(key, session.businessId, range);

  const restricted = Boolean(definition.sensitive) && !can(session, "report.view_cost");
  const columns = restricted ? report.columns.filter((column) => !/cost|profit|margin/i.test(column.key)) : report.columns;

  const exportQuery = new URLSearchParams({
    ...(filterValue("from") ? { from: filterValue("from")! } : {}),
    ...(filterValue("to") ? { to: filterValue("to")! } : {}),
    format: "pdf",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/admin/reports" className="font-medium text-indigo-600 hover:underline">
              ← All reports
            </Link>
            {can(session, "report.export") ? (
              <>
                <a
                  href={`/api/v1/reports/${key}/export?${exportQuery.toString()}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
                >
                  Download PDF
                </a>
                <a
                  href={`/api/v1/reports/${key}/export?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "xlsx" }).toString()}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-50"
                >
                  Download XLSX
                </a>
              </>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Range</CardTitle>
          <CardDescription>Reports that are point-in-time (valuation, stock on hand) ignore the range and say so.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">From</span>
              <input
                type="date"
                name="from"
                defaultValue={filterValue("from") ?? range.from.toISOString().slice(0, 10)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">To</span>
              <input
                type="date"
                name="to"
                defaultValue={filterValue("to") ?? range.to.toISOString().slice(0, 10)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Update
            </button>
          </form>
        </CardContent>
      </Card>

      {restricted ? (
        <Alert variant="warning">
          Cost and profit columns are hidden because your role has no cost permission. The export applies the same rule.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{report.title}</CardTitle>
          <CardDescription>
            {Object.entries(report.meta)
              .map(([name, value]) => `${name}: ${value}`)
              .join("  ·  ")}
            {"  ·  "}
            {report.rows.length} row(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} rows={report.rows} totals={report.totals} />
        </CardContent>
      </Card>

      {(report.sections ?? []).map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={section.columns} rows={section.rows} totals={section.totals} />
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-slate-500">
        Generated live from {REPORT_DEFINITIONS.length} defined reports. Amounts are stored as integer paisa and only formatted for display, so totals always add
        up exactly.
      </p>
    </div>
  );
}
