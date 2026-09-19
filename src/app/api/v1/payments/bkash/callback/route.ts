import { type NextRequest } from "next/server";
import { apiError, apiSuccess, readJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logging";
import { handleBkashCallback } from "@/modules/payments/webhooks";

/**
 * bKash return/IPN endpoint.
 *
 * Accepts both GET (the browser redirect carrying `paymentID` + `status`) and
 * POST (the IPN). Either way the payment is re-verified against bKash's API
 * before the order is touched, and the shared payment-event guard makes repeated
 * notifications harmless.
 */

async function handle(request: NextRequest, payload: Record<string, unknown>) {
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await handleBkashCallback({ payload, ipAddress });
    return apiSuccess(result);
  } catch (error) {
    logger.error("payment.bkash_callback_failed", error);
    return apiError(error);
  }
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return handle(request, params);
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown> = {};
  try {
    payload = await readJsonBody<Record<string, unknown>>(request);
  } catch {
    const form = await request.formData().catch(() => null);
    if (form) payload = Object.fromEntries(form.entries());
  }
  return handle(request, payload);
}
