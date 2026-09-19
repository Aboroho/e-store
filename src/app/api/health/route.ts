import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { env, storageDriver, storageEnabled } from "@/lib/env";
import { logger } from "@/lib/logging";

/**
 * Health check for the reverse proxy, the uptime monitor and the deploy script.
 *
 * Deliberately public but talkative-free: no version of a dependency, no configuration
 * values, no counts that would leak business volume. It answers two questions — can the
 * app reach its database, and is object storage usable — plus how far behind the worker
 * is, which is the failure that otherwise goes unnoticed until a customer complains.
 *
 * 200 when everything is fine, 503 when the database is unreachable (the proxy should
 * take the instance out of rotation, it will not heal itself).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
}

export async function GET() {
  const checks: Check[] = [];
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "database", status: "ok", detail: `${Date.now() - started}ms` });
  } catch (error) {
    logger.error("health.database_failed", error);
    checks.push({ name: "database", status: "fail", detail: "unreachable" });
  }

  if (!storageEnabled()) {
    checks.push({ name: "storage", status: storageDriver() === "disabled" ? "warn" : "fail", detail: storageDriver() });
  } else {
    checks.push({ name: "storage", status: "ok", detail: storageDriver() });
  }

  try {
    const staleCutoff = new Date(Date.now() - 30 * 60_000);
    const [pending, oldest] = await Promise.all([
      prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.outboxEvent.findFirst({
        where: { status: "PENDING", createdAt: { lt: staleCutoff } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    if (oldest) {
      checks.push({ name: "worker", status: "warn", detail: `${pending} event(s) older than 30 minutes` });
    } else {
      checks.push({ name: "worker", status: "ok", detail: `${pending} queued` });
    }
  } catch {
    checks.push({ name: "worker", status: "warn", detail: "queue not readable" });
  }

  const failed = checks.some((check) => check.status === "fail");
  const body = {
    status: failed ? "unhealthy" : "healthy",
    service: env().APP_NAME,
    time: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, { status: failed ? 503 : 200, headers: { "cache-control": "no-store" } });
}
