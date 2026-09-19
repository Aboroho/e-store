import { NextResponse, type NextRequest } from "next/server";
import { Readable } from "node:stream";
import { apiError, bearerToken } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/auth/session";
import { authenticateApiRequest, hasScope, logApiRequest, type ApiPrincipal } from "@/lib/api/auth";
import { exportContentType, exportFileName, isExportFormat, reportToPdf, reportToXlsx } from "@/modules/reports/export";
import { reportDefinition, resolveRange, runReport, type ReportColumn } from "@/modules/reports/queries";

/**
 * Report export endpoint.
 *
 * Two callers are accepted:
 *
 *  - a signed-in staff user with `report.view` **and** `report.export` — cost columns are
 *    stripped unless they also hold `report.view_cost`, exactly as on screen;
 *  - an API key with the `reports:read` scope. Keys never receive cost or profit columns,
 *    because there is no scope that grants them.
 *
 * The response is always an attachment, so a download starts without a second click. The
 * format is produced by one replaceable engine (`@/modules/reports/export`).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const presentedKey = bearerToken(request) ?? request.headers.get("x-api-key");

  let businessId: string;
  let principalLabel: string;
  let principalUserId: string | null;
  let apiKeyId: string | undefined;
  let canViewCost: boolean;

  if (presentedKey) {
    let principal: ApiPrincipal;
    try {
      principal = await authenticateApiRequest(request);
    } catch (error) {
      return apiError(error);
    }
    if (!hasScope(principal, "reports:read")) return apiError(AppError.forbidden('This API key does not have the "reports:read" scope'));
    businessId = principal.businessId;
    principalLabel = principal.label;
    principalUserId = null;
    apiKeyId = principal.apiKeyId;
    canViewCost = false;
  } else {
    const session = await getSession();
    if (!session) {
      const target = new URL("/admin/login", request.nextUrl.origin);
      target.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
      return NextResponse.redirect(target);
    }
    if (!can(session, "report.view") || !can(session, "report.export")) {
      return apiError(AppError.forbidden("Missing report export permission"));
    }
    businessId = session.businessId;
    principalLabel = session.email;
    principalUserId = session.id;
    canViewCost = can(session, "report.view_cost");
  }

  const definition = reportDefinition(key);
  if (!definition) return apiError(AppError.notFound(`Unknown report: ${key}`));

  const format = request.nextUrl.searchParams.get("format") ?? "pdf";
  if (!isExportFormat(format)) return apiError(AppError.validation("format must be pdf or xlsx"));

  const range = resolveRange({
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });

  try {
    const report = await runReport(key, businessId, range);

    // Same masking rule as the screen: no cost/profit columns without the permission.
    if (definition.sensitive && !canViewCost) {
      const sensitive = /cost|profit|margin|value/i;
      const strip = (columns: ReportColumn[]) => columns.filter((column) => !sensitive.test(column.key));
      report.columns = strip(report.columns);
      report.sections = (report.sections ?? []).map((section) => ({ ...section, columns: strip(section.columns) }));
      report.totals = undefined;
    }

    await recordAudit({
      businessId,
      actorType: apiKeyId ? "API_KEY" : "USER",
      actorUserId: principalUserId,
      actorLabel: principalLabel,
      action: "report.export",
      entityType: "Report",
      entityId: key,
      summary: `Exported ${definition.title} as ${format.toUpperCase()} (${report.rows.length} rows, ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)})`,
    });

    await logApiRequest({
      apiKeyId,
      method: "GET",
      path: request.nextUrl.pathname,
      statusCode: 200,
      durationMs: 0,
      scope: apiKeyId ? "reports:read" : undefined,
    });

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
