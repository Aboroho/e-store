import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requestIdFrom } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { consumeRateLimit } from "@/lib/rate-limit";
import { assertScope, resolveApiPrincipal } from "@/lib/api/auth";
import { normalizeBdPhone } from "@/lib/utils";
import { prisma } from "@/lib/db/client";
import { findOrderForTracking } from "@/modules/orders/service";

/**
 * Order tracking (v1).
 *
 * Staff with `order.view` — or an API key with `orders:read` — can read any order. A
 * guest can read an order only by presenting the order number *and* the phone number
 * used on it — both stored server-side, and the lookup is rate limited so numbers
 * cannot be enumerated. Only a non-sensitive projection is returned either way.
 */

export async function GET(request: NextRequest, context: { params: Promise<{ orderNumber: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const { orderNumber } = await context.params;

    // A presented key must be valid; only "no credentials at all" falls through to
    // guest tracking. Otherwise a mistyped key would silently become an anonymous call.
    const presentedKey = request.headers.get("authorization")?.startsWith("Bearer ") || request.headers.has("x-api-key");
    let principal: Awaited<ReturnType<typeof resolveApiPrincipal>> | null = null;
    try {
      principal = await resolveApiPrincipal(request, "order.view");
    } catch (error) {
      if (presentedKey) throw error;
      principal = null;
    }

    if (principal) {
      if (principal.kind === "api_key") assertScope(principal, "orders:read");
      const order = await prisma.order.findFirst({
        where: { businessId: principal.businessId, orderNumber },
        select: {
          orderNumber: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          grandTotalPaisa: true,
          paidPaisa: true,
          duePaisa: true,
          placedAt: true,
          deliveredAt: true,
          customerName: true,
          items: { select: { productName: true, variantName: true, quantity: true, lineTotalPaisa: true, isPreorder: true } },
          shipments: { select: { status: true, trackingCode: true, providerCode: true } },
        },
      });
      if (!order) throw AppError.notFound("Order not found");
      return apiSuccess(order, { meta: { requestId } });
    }

    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) throw AppError.unauthenticated("Provide the phone number used on the order, or sign in");

    const normalized = normalizeBdPhone(phone);
    if (!normalized) throw AppError.validation("Enter a valid phone number");

    const rate = await consumeRateLimit({ scope: "order-track", key: normalized, limit: 20, windowSeconds: 15 * 60 });
    if (!rate.allowed) throw AppError.rateLimited("Too many lookups. Try again in a few minutes.");

    const order = await findOrderForTracking({ orderNumber, phone: normalized });
    if (!order) throw AppError.notFound("No order matches that number and phone");

    return apiSuccess(order, { meta: { requestId } });
  } catch (error) {
    if (!(error instanceof AppError)) logger.error("api.orders.track_failed", error);
    return apiError(error, requestId);
  }
}
