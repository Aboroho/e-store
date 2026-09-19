import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logging";

/**
 * Audit logging.
 *
 * Financial and inventory changes are always audited. `recordAudit` accepts a
 * transaction client so that audit rows are written in the same transaction as
 * the change they describe.
 */

export type AuditActorType = "USER" | "CUSTOMER" | "SYSTEM" | "API_KEY";

export interface AuditInput {
  businessId?: string | null;
  actorType?: AuditActorType;
  actorUserId?: string | null;
  actorCustomerId?: string | null;
  actorApiKeyId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  changedFields?: string[];
  reason?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(input: AuditInput, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        businessId: input.businessId ?? null,
        actorType: input.actorType ?? "USER",
        actorUserId: input.actorUserId ?? null,
        actorCustomerId: input.actorCustomerId ?? null,
        actorApiKeyId: input.actorApiKeyId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        changedFields: input.changedFields ?? [],
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    // Auditing must never break the business transaction, but the failure has
    // to be visible in logs.
    logger.error("Failed to write audit log", error, { action: input.action, entityType: input.entityType });
  }
}

/** Compute the list of changed field names between two records. */
export function changedFieldNames(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (a instanceof Date && b instanceof Date) {
      if (a.getTime() !== b.getTime()) changed.push(key);
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(key);
  }
  return changed;
}
