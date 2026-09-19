import type { NextRequest } from "next/server";
import { apiError, apiSuccess, readJsonBody, requestIdFrom } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { assertScope, logApiRequest, mayViewCustomerDetails, resolveApiPrincipal } from "@/lib/api/auth";
import { parseInput, parseListQuery } from "@/lib/validation";
import { createOrderInputSchema } from "@/modules/orders/schemas";
import { createOrder } from "@/modules/orders/service";
import { listOrders } from "@/modules/orders/queries";

/**
 * Orders API (v1).
 *
 * Accepts either a staff session (permission checked) or an API key with the
 * `orders:read` / `orders:write` scope. Customer contact details are only included when
 * the caller may see them (`customers:read` on an API key, or a staff session).
 */

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  const started = Date.now();
  let principal: Awaited<ReturnType<typeof resolveApiPrincipal>> | null = null;
  try {
    principal = await resolveApiPrincipal(request, "order.view");
    if (principal.kind === "api_key") assertScope(principal, "orders:read");

    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params, { defaultSortBy: "placedAt", defaultSortDir: "desc", allowedSortBy: ["placedAt", "grandTotalPaisa", "orderNumber"] });
    const result = await listOrders(principal.businessId, {
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

    const showCustomer = mayViewCustomerDetails(principal);
    const response = apiSuccess(
      result.rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        channel: order.channel,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        customerName: order.customerName,
        customerPhone: showCustomer ? order.customerPhoneNormalized : maskPhone(order.customerPhoneNormalized),
        grandTotalPaisa: order.grandTotalPaisa,
        duePaisa: order.duePaisa,
        placedAt: order.placedAt.toISOString(),
        itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
        hasPreorder: order.items.some((item) => item.isPreorder),
      })),
      { meta: { page: result.page, pageSize: result.pageSize, total: result.total, requestId } },
    );

    await logApiRequest({
      apiKeyId: principal.apiKeyId,
      method: "GET",
      path: request.nextUrl.pathname,
      statusCode: 200,
      durationMs: Date.now() - started,
      requestId,
      scope: "orders:read",
    });
    return response;
  } catch (error) {
    logger.error("api.orders.list_failed", error);
    await logApiRequest({
      apiKeyId: principal?.apiKeyId,
      method: "GET",
      path: request.nextUrl.pathname,
      statusCode: error instanceof AppError ? Number(error.status ?? 500) : 500,
      durationMs: Date.now() - started,
      requestId,
    });
    return apiError(error, requestId);
  }
}

/** Never expose a full phone number to a scoped key that did not ask for it. */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null;
  return `${phone.slice(0, 5)}****${phone.slice(-2)}`;
}

export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request);
  const started = Date.now();
  let principal: Awaited<ReturnType<typeof resolveApiPrincipal>> | null = null;
  try {
    principal = await resolveApiPrincipal(request, "order.create");
    if (principal.kind === "api_key") assertScope(principal, "orders:write");

    const body = await readJsonBody<Record<string, unknown>>(request);
    const input = parseInput(createOrderInputSchema, body, "Create order");

    const result = await createOrder(
      { businessId: principal.businessId, actorLabel: principal.label, actorType: principal.kind === "api_key" ? "API_KEY" : "USER" },
      input,
    );

    const response = apiSuccess(
      {
        id: result.order.id,
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        grandTotalPaisa: result.order.grandTotalPaisa,
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201, meta: { requestId } },
    );

    await logApiRequest({
      apiKeyId: principal.apiKeyId,
      method: "POST",
      path: request.nextUrl.pathname,
      statusCode: result.reused ? 200 : 201,
      durationMs: Date.now() - started,
      requestId,
      scope: "orders:write",
    });
    return response;
  } catch (error) {
    logger.error("api.orders.create_failed", error);
    await logApiRequest({
      apiKeyId: principal?.apiKeyId,
      method: "POST",
      path: request.nextUrl.pathname,
      statusCode: error instanceof AppError ? Number(error.status ?? 500) : 500,
      durationMs: Date.now() - started,
      requestId,
    });
    return apiError(error, requestId);
  }
}
