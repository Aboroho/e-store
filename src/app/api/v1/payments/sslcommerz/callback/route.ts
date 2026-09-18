import { type NextRequest } from "next/server";
import { apiError, apiSuccess, readJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logging";
import { handleSslcommerzCallback } from "@/modules/payments/webhooks";

/**
 * SSLCommerz endpoint for success, fail, cancel and IPN notifications.
 *
 * SSLCommerz posts `application/x-www-form-urlencoded` bodies with `val_id` (on
 * success) or only `tran_id` (on failure). The callback handler validates the
 * transaction server-side before any payment is recorded.
 */

async function handle(request: NextRequest, payload: Record<string, unknown>) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await handleSslcommerzCallback({ payload, ipAddress });
    return apiSuccess(result);
  } catch (error) {
    logger.error("payment.sslcommerz_callback_failed", error);
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let payload: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    payload = await readJsonBody<Record<string, unknown>>(request).catch(() => ({}));
  } else {
    const form = await request.formData().catch(() => null);
    if (form) payload = Object.fromEntries(form.entries());
  }

  if (Object.keys(payload).length === 0) {
    payload = Object.fromEntries(request.nextUrl.searchParams.entries());
  }

  return handle(request, payload);
}

export async function GET(request: NextRequest) {
  const payload = Object.fromEntries(request.nextUrl.searchParams.entries());
  return handle(request, payload);
}
