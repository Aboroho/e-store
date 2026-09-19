import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { bearerToken } from "@/lib/api/response";
import { hashApiKey, safeEqual } from "@/lib/crypto";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";

/**
 * API authentication.
 *
 * Two callers are accepted by the public API:
 *
 *  - a staff session (the admin UI's own fetch calls), authorised by permission; and
 *  - an API key (`Authorization: Bearer esk_…` or `X-API-Key`), authorised by scope.
 *
 * API keys are stored as SHA-256 hashes; the client sends the plaintext on every request
 * and it is hashed here for the lookup. Keys can expire, be revoked, be restricted to an
 * IP allowlist and carry their own per-minute rate limit. Every authenticated call is
 * written to `ApiRequestLog`, which is what the admin screen shows.
 */

export interface ApiPrincipal {
  kind: "session" | "api_key";
  businessId: string;
  /** Present for API keys. */
  apiKeyId?: string;
  label: string;
  scopes: string[];
}

export function hasScope(principal: ApiPrincipal, scope: string): boolean {
  if (principal.kind === "session") return true; // session callers are checked by permission
  return principal.scopes.includes(scope);
}

export function assertScope(principal: ApiPrincipal, scope: string): void {
  if (!hasScope(principal, scope)) {
    throw AppError.forbidden(`This API key does not have the "${scope}" scope`);
  }
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Authenticate a request. Throws `AppError.unauthenticated()` when nothing usable is
 * presented, so callers can fall back to their own error handling.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiPrincipal> {
  const raw = bearerToken(request) ?? request.headers.get("x-api-key");
  if (!raw) throw AppError.unauthenticated();

  const keyHash = hashApiKey(raw.trim());
  const prefix = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw.slice(0, 12);

  const key = await prisma.apiKey.findFirst({
    where: { keyPrefix: prefix },
    include: { scopes: true },
  });

  // Constant-time comparison on the hash keeps timing from revealing whether the prefix
  // existed. A missing row is reported exactly like a wrong secret.
  if (!key || !safeEqual(key.keyHash, keyHash)) throw AppError.unauthenticated("Invalid API key");
  if (key.status !== "ACTIVE") throw AppError.forbidden(key.status === "REVOKED" ? "This API key has been revoked" : "This API key is not active");
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { status: "EXPIRED" } });
    throw AppError.forbidden("This API key has expired");
  }

  const ip = clientIp(request);
  if (key.allowedIpAddresses.length > 0 && !key.allowedIpAddresses.includes(ip)) {
    await prisma.apiRequestLog.create({
      data: { apiKeyId: key.id, method: request.method, path: new URL(request.url).pathname, statusCode: 403, durationMs: 0, ipAddress: ip, errorCode: "FORBIDDEN" },
    });
    throw AppError.forbidden("This API key is not allowed from this IP address");
  }

  const limit = await consumeRateLimit({
    scope: "api-key",
    key: key.id,
    limit: key.rateLimitPerMinute,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    throw AppError.rateLimited("API key rate limit exceeded", { retryAfterSeconds: limit.retryAfterSeconds });
  }

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), usageCount: { increment: 1 } } });

  return { kind: "api_key", businessId: key.businessId, apiKeyId: key.id, label: `api-key:${key.name}`, scopes: key.scopes.map((scope) => scope.scope) };
}

/** Record the outcome of an API call (called by the wrapper below). */
export async function logApiRequest(input: {
  apiKeyId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ipAddress?: string;
  requestId?: string;
  errorCode?: string;
  scope?: string;
}) {
  try {
    await prisma.apiRequestLog.create({
      data: {
        apiKeyId: input.apiKeyId ?? null,
        method: input.method,
        path: input.path,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null,
        errorCode: input.errorCode ?? null,
        scope: input.scope ?? null,
      },
    });
  } catch {
    // Never let logging break the API response.
  }
}

/**
 * Resolve the caller: an API key when one is presented, otherwise a staff session with
 * the given permission. This is what lets one endpoint serve both the admin UI and
 * integrators without duplicating the business logic.
 */
export async function resolveApiPrincipal(request: Request, sessionPermission: string): Promise<ApiPrincipal> {
  const raw = bearerToken(request) ?? request.headers.get("x-api-key");

  if (raw) return authenticateApiRequest(request);

  const session = await getSession();
  if (session) {
    if (!can(session, sessionPermission)) throw AppError.forbidden();
    return { kind: "session", businessId: session.businessId, label: `user:${session.email}`, scopes: [] };
  }

  throw AppError.unauthenticated();
}

/** True when the caller may see customer contact details. */
export function mayViewCustomerDetails(principal: ApiPrincipal): boolean {
  return principal.kind === "session" || principal.scopes.includes("customers:read");
}
