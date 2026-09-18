import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { AppError, ErrorCodes } from "@/lib/errors";

/**
 * Idempotent execution of retryable operations.
 *
 * A caller supplies a scope and a key (usually an Idempotency-Key header or a
 * provider event id). If the same key is submitted twice the stored response is
 * returned instead of executing the work again, which is what prevents
 * duplicate payments, stock consumption or payouts.
 */

export interface IdempotencyOutcome<T> {
  result: T;
  replayed: boolean;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export async function withIdempotency<T>(
  input: {
    scope: string;
    key: string;
    businessId?: string | null;
    requestHash?: string | null;
    resourceType?: string | null;
    ttlHours?: number;
  },
  run: (tx: Prisma.TransactionClient) => Promise<{ value: T; resourceId?: string; statusCode?: number }>,
): Promise<IdempotencyOutcome<T>> {
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { scope_key: { scope: input.scope, key: input.key } },
  });

  if (existing?.completedAt) {
    if (existing.requestHash && input.requestHash && existing.requestHash !== input.requestHash) {
      throw new AppError({
        code: ErrorCodes.IDEMPOTENCY_CONFLICT,
        message: "This idempotency key was already used with a different request payload",
      });
    }
    return { result: existing.responseBody as T, replayed: true };
  }

  if (existing && !existing.completedAt) {
    throw new AppError({
      code: ErrorCodes.IDEMPOTENCY_CONFLICT,
      message: "A request with this idempotency key is already being processed",
    });
  }

  const record = await prisma.idempotencyRecord.create({
    data: {
      scope: input.scope,
      key: input.key,
      businessId: input.businessId ?? null,
      requestHash: input.requestHash ?? null,
      resourceType: input.resourceType ?? null,
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + (input.ttlHours ?? 72) * 60 * 60 * 1000),
    },
  });

  try {
    const outcome = await prisma.$transaction(async (tx) => run(tx), { timeout: 30_000 });
    await prisma.idempotencyRecord.update({
      where: { id: record.id },
      data: {
        completedAt: new Date(),
        resourceId: outcome.resourceId ?? null,
        statusCode: outcome.statusCode ?? 200,
        responseBody: outcome.value as Prisma.InputJsonValue,
      },
    });
    return { result: outcome.value, replayed: false };
  } catch (error) {
    // Release the lock so a legitimate retry can proceed.
    await prisma.idempotencyRecord
      .delete({ where: { id: record.id } })
      .catch(() => undefined);
    throw error;
  }
}

/** Clear expired idempotency records (background job). */
export async function cleanupIdempotencyRecords(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
