import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCodes, type ErrorCode, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logging";

/**
 * Consistent JSON response envelope for the public API (`/api/v1`) and the
 * internal endpoints used by the admin UI.
 *
 * Success:  { data, meta? }
 * Failure:  { error: { code, message, details?, hint?, requestId } }
 */

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export function apiSuccess<T>(data: T, init?: { status?: number; meta?: ApiMeta; headers?: HeadersInit }): NextResponse {
  const body: Record<string, unknown> = { data };
  if (init?.meta) body.meta = init.meta;
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function apiError(error: unknown, requestId?: string): NextResponse {
  const { status, body } = toErrorResponse(error);
  const payload = {
    error: { ...body.error, requestId: requestId ?? randomUUID() },
  };
  if (status >= 500) {
    logger.error("API request failed", error, { requestId, code: payload.error.code });
  }
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiNotFound(message = "Resource not found"): NextResponse {
  return apiError(new AppError({ code: ErrorCodes.NOT_FOUND, message }));
}

/** Extract a bearer token / API key from the request headers. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

export function requestIdFrom(request: Request): string {
  return request.headers.get("x-request-id") ?? randomUUID();
}

/** Read and JSON-parse a request body with a size guard. */
export async function readJsonBody<T = unknown>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new AppError({ code: ErrorCodes.UNPROCESSABLE, message: "Request body is too large" });
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw AppError.validation("Request body must be valid JSON");
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown; hint?: string; requestId?: string };
}
