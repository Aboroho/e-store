import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requestIdFrom } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { normalizeBdPhone } from "@/lib/utils";
import { prisma } from "@/lib/db/client";
import { findOrderForTracking } from "@/modules/orders/service";

/**
 * Order tracking (v1).
 *
 * Staff with `order.view` can read any order. A guest can read an order only by
 * presenting the order number *and* the phone number used on it — both stored
 * server-side, and the lookup is rate limited so numbers cannot be enumerated.
 * Only a non-sensitive projection is returned either way.
 */

export async function GET(request: NextRequest, context: { params: Promise<{ orderNumber: string }> }) {
  const requestId = requestIdFrom(request);
  try {
    const { orderNumber } = await context.params;
    const session = await getSession();

    if (session && can(session, "order.view")) {
      const order = await prisma.order.findFirst({
        where: { businessId: session.businessId, orderNumber },
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
