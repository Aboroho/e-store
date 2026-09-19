import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { apiError } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/auth/session";
import { exportContentType, exportFileName, isExportFormat, reportToPdf, reportToXlsx } from "@/modules/reports/export";
import { reportDefinition, resolveRange, runReport, type ReportColumn } from "@/modules/reports/queries";

/**
 * Report export endpoint.
 *
 * Authorisation is enforced here — the same `report.view` permission the screen
 * needs, plus `report.export` — and cost columns are stripped for roles without
 * `report.view_cost`, exactly as on screen. The response is always an attachment,
 * so a download starts without a second click.
 *
 * The format is produced by one replaceable engine (`@/modules/reports/export`),
 * so swapping the PDF or spreadsheet library later touches a single module.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (!session) {
    const target = new URL("/admin/login", request.nextUrl.origin);
    target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(target);
  }
  if (!can(session, "report.view") || !can(session, "report.export")) {
    return apiError(AppError.forbidden("Missing report export permission"));
  }

  const { key } = await context.params;
  const definition = reportDefinition(key);
  if (!definition) return apiError(AppError.notFound(`Unknown report: ${key}`));

  const format = request.nextUrl.searchParams.get("format") ?? "pdf";
  if (!isExportFormat(format)) return apiError(AppError.validation("format must be pdf or xlsx"));

  const range = resolveRange({
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });

  try {
    const report = await runReport(key, session.businessId, range);

    // Same masking rule as the screen: no cost/profit columns without the permission.
    if (definition.sensitive && !can(session, "report.view_cost")) {
      const sensitive = /cost|profit|margin|value/i;
      const strip = (columns: ReportColumn[]) => columns.filter((column) => !sensitive.test(column.key));
      report.columns = strip(report.columns);
      report.sections = (report.sections ?? []).map((section) => ({ ...section, columns: strip(section.columns) }));
      report.totals = undefined;
    }

    await recordAudit({
      businessId: session.businessId,
      actorType: "USER",
      actorUserId: session.id,
      actorLabel: session.email,
      action: "report.export",
      entityType: "Report",
      entityId: key,
      summary: `Exported ${definition.title} as ${format.toUpperCase()}`,
      metadata: { format, from: range.from.toISOString(), to: range.to.toISOString(), rows: report.rows.length },
    } as never);

    const fileName = exportFileName(report, format);

    if (format === "xlsx") {
      const buffer = await reportToXlsx(report);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "content-type": exportContentType(format),
          "content-disposition": `attachment; filename="${fileName}"`,
          "content-length": String(buffer.byteLength),
          "cache-control": "no-store",
        },
      });
    }

    const stream = Readable.toWeb(reportToPdf(report) as Readable) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      headers: {
        "content-type": exportContentType(format),
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    logger.error("report.export_failed", error, { key, format });
    return apiError(AppError.internal("The export could not be generated"));
  }
}
