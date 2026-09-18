import type { NextRequest } from "next/server";
import { apiError, apiSuccess, readJsonBody, requestIdFrom } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { parseInput, parseListQuery } from "@/lib/validation";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import { createOrder } from "@/modules/orders/service";
import { listOrders } from "@/modules/orders/queries";

/**
 * Orders API (v1).
 *
 * Staff-facing for now: the request must carry an authenticated staff session
 * with `order.view` / `order.create`. API keys arrive in step 5 and will reuse
 * the same service calls, so the permission checks here stay in one place.
 */

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const session = await getSession();
    if (!session) throw AppError.unauthenticated();
    if (!can(session, "order.view")) throw AppError.forbidden();

    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params, { defaultSortBy: "placedAt", defaultSortDir: "desc", allowedSortBy: ["placedAt", "grandTotalPaisa", "orderNumber"] });
    const result = await listOrders(session.businessId, {
      search: query.search,
      status: params.get("status") ?? undefined,
      paymentStatus: params.get("paymentStatus") ?? undefined,
      channel: params.get("channel") ?? undefined,
      customerId: params.get("customerId") ?? undefined,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

    return apiSuccess(
      result.rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        channel: order.channel,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        customerName: order.customerName,
        customerPhone: order.customerPhoneNormalized,
        grandTotalPaisa: order.grandTotalPaisa,
        duePaisa: order.duePaisa,
        placedAt: order.placedAt.toISOString(),
        itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
        hasPreorder: order.items.some((item) => item.isPreorder),
      })),
      { meta: { page: result.page, pageSize: result.pageSize, total: result.total, requestId } },
    );
  } catch (error) {
    logger.error("api.orders.list_failed", error);
    return apiError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const session = await getSession();
    if (!session) throw AppError.unauthenticated();
    if (!can(session, "order.create")) throw AppError.forbidden();

    const body = await readJsonBody<Record<string, unknown>>(request);
    const input = parseInput(createOrderInputSchema, body, "Create order");

    const result = await createOrder(
      { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" },
      input,
    );

    return apiSuccess(
      {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        grandTotalPaisa: result.order.grandTotalPaisa,
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201, meta: { requestId } },
    );
  } catch (error) {
    logger.error("api.orders.create_failed", error);
    return apiError(error, requestId);
  }
}
