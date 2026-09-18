import type { NextRequest } from "next/server";
import { apiError, apiSuccess, readJsonBody, requestIdFrom } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { prisma } from "@/lib/db/client";
import { setCustomerSessionCookie } from "@/lib/auth/customer-session";
import { parseInput } from "@/lib/validation";
import { verificationConfirmSchema, verificationRequestSchema } from "@/modules/customers/schemas";
import { confirmVerificationCode, listCustomerOrders, requestVerificationCode } from "@/modules/customers/service";

/**
 * Customer identity API (v1).
 *
 * `POST` requests a one-time code; the response never contains the code, because
 * knowing a phone number must not be enough to reach someone's orders. `PUT`
 * consumes the code and opens a customer session.
 */

async function defaultBusinessId(): Promise<string> {
  const business = await prisma.business.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!business) throw AppError.internal("No business is configured");
  return business.id;
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const input = parseInput(verificationRequestSchema, body, "Request verification code");
    const businessId = await defaultBusinessId();

    const result = await requestVerificationCode({
      businessId,
      phone: input.phone,
      purpose: input.purpose,
      staffAssisted: false,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    return apiSuccess(
      { verificationId: result.id, expiresAt: result.expiresAt.toISOString(), channel: result.channel, delivered: result.delivered, message: result.message },
      { meta: { requestId } },
    );
  } catch (error) {
    if (!(error instanceof AppError)) logger.error("api.customers.verification_request_failed", error);
    return apiError(error, requestId);
  }
}

export async function PUT(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const input = parseInput(verificationConfirmSchema, body, "Confirm verification code");
    const businessId = await defaultBusinessId();

    const verified = await confirmVerificationCode({
      businessId,
      phone: input.phone,
      code: input.code,
      purpose: input.purpose,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    });

    await setCustomerSessionCookie(verified.sessionToken, verified.expiresAt);
    const orders = await listCustomerOrders(verified.customerId);

    return apiSuccess(
      { customerId: verified.customerId, claimedOrders: verified.claimedOrders, orders },
      { meta: { requestId } },
    );
  } catch (error) {
    if (!(error instanceof AppError)) logger.error("api.customers.verification_confirm_failed", error);
    return apiError(error, requestId);
  }
}
