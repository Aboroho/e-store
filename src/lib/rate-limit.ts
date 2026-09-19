import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

/**
 * Database backed fixed-window rate limiting.
 *
 * A database counter is chosen deliberately: the platform runs on a single VPS
 * with one PostgreSQL instance, so this is accurate, durable and requires no
 * additional infrastructure (Redis etc.).
 */

export interface RateLimitOptions {
  /** Logical bucket, e.g. `login`, `verify-sms`, `api-key`. */
  scope: string;
  /** Identity within the scope (ip, email, phone, api key id...). */
  key: string;
  /** Maximum number of events allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = windowStartFor(now, options.windowSeconds);
  const resetAt = new Date(windowStart.getTime() + options.windowSeconds * 1000);

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { scope_key_windowStart: { scope: options.scope, key: options.key, windowStart } },
    create: { scope: options.scope, key: options.key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  const remaining = Math.max(0, options.limit - bucket.count);
  const allowed = bucket.count <= options.limit;
  return {
    allowed,
    remaining,
    limit: options.limit,
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Consume a rate limit and throw a 429 when the bucket is exhausted. */
export async function enforceRateLimit(options: RateLimitOptions, message?: string): Promise<void> {
  const result = await consumeRateLimit(options);
  if (!result.allowed) {
    throw AppError.rateLimited(message ?? "Too many requests. Please try again later.", {
      retryAfterSeconds: result.retryAfterSeconds,
      resetAt: result.resetAt.toISOString(),
    });
  }
}

/** Remove expired buckets (called by the background worker). */
export async function cleanupRateLimitBuckets(olderThanMinutes = 60): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return result.count;
}

export const RateLimits = {
  login: { limit: 8, windowSeconds: 300 },
  passwordReset: { limit: 5, windowSeconds: 900 },
  verificationCodeRequest: { limit: 5, windowSeconds: 900 },
  verificationCodeVerify: { limit: 10, windowSeconds: 900 },
  accountClaim: { limit: 6, windowSeconds: 900 },
  checkout: { limit: 20, windowSeconds: 600 },
  reviewSubmit: { limit: 10, windowSeconds: 3600 },
  apiKeyDefault: { limit: 120, windowSeconds: 60 },
  webhook: { limit: 300, windowSeconds: 60 },
} as const;
