import "server-only";
import type {
  CourierAdapter,
  CourierCreateContext,
  CourierCreateResult,
  CourierTrackingContext,
  CourierTrackingResult,
  ParsedWebhook,
} from "@/modules/couriers/providers/types";
import {
  CourierRequestError,
  asNumber,
  asRecord,
  asString,
  courierRequest,
  requireCredentials,
} from "@/modules/couriers/providers/types";
import {
  PATHAO_BASE_URL,
  PATHAO_SANDBOX_BASE_URL,
  buildPathaoOrderBody,
  mapPathaoStatus,
} from "@/modules/couriers/providers/pathao-outgoing-data";

/**
 * Pathao Courier (Aladdin) adapter.
 *
 * Auth is a bearer token obtained from the credentials; the token is fetched per
 * dispatch because Pathao tokens expire and caching them would need shared state
 * across the worker and the web app.
 */

interface PathaoTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

function baseUrl(sandbox: boolean): string {
  return sandbox ? PATHAO_SANDBOX_BASE_URL : PATHAO_BASE_URL;
}

async function fetchToken(context: { credentials: Record<string, string | undefined>; sandbox: boolean }): Promise<string> {
  requireCredentials("PATHAO", context.credentials, ["client_id", "client_secret", "username", "password"]);
  const response = await courierRequest<PathaoTokenResponse>({
    providerCode: "PATHAO",
    method: "POST",
    url: `${baseUrl(context.sandbox)}/aladdin/api/v1/issue-token`,
    body: {
      client_id: context.credentials.client_id,
      client_secret: context.credentials.client_secret,
      username: context.credentials.username,
      password: context.credentials.password,
      grant_type: "password",
    },
  });
  const token = asString(response.access_token);
  if (!token) throw new CourierRequestError("PATHAO", 0, "Pathao did not return an access token");
  return token;
}

export const pathaoAdapter: CourierAdapter = {
  code: "PATHAO",
  label: "Pathao Courier",
  credentialKeys: ["client_id", "client_secret", "username", "password", "webhook_secret"],
  webhookSignatureHeader: "x-pathao-signature",

  async testConnection(context: { credentials: Record<string, string | undefined>; sandbox: boolean }) {
    try {
      await fetchToken(context);
      return { ok: true, detail: "Access token issued by Pathao" };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Pathao rejected the credentials" };
    }
  },

  async createShipment(context: CourierCreateContext): Promise<CourierCreateResult> {
    const token = await fetchToken(context);
    const body = buildPathaoOrderBody(context.shipment);
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "PATHAO",
      method: "POST",
      url: `${baseUrl(context.sandbox)}/aladdin/api/v1/orders`,
      headers: { authorization: `Bearer ${token}` },
      body,
    });

    const data = asRecord(response.data);
    const consignmentId = asString(data.consignment_id);
    if (!consignmentId) throw new CourierRequestError("PATHAO", 0, "Pathao did not return a consignment id");

    return {
      providerConsignmentId: consignmentId,
      trackingCode: asString(data.consignment_id),
      providerStatusRaw: asString(data.order_status) ?? "Pending",
      status: mapPathaoStatus(asString(data.order_status) ?? "Pending").status,
      raw: response,
    };
  },

  async fetchTracking(context: CourierTrackingContext): Promise<CourierTrackingResult> {
    requireCredentials("PATHAO", context.credentials, ["client_id", "client_secret", "username", "password"]);
    if (!context.providerConsignmentId) throw new CourierRequestError("PATHAO", 0, "This shipment has no Pathao consignment id yet");
    const token = await fetchToken(context);
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "PATHAO",
      method: "GET",
      url: `${baseUrl(context.sandbox)}/aladdin/api/v1/orders/${encodeURIComponent(context.providerConsignmentId)}/info`,
      headers: { authorization: `Bearer ${token}` },
    });
    const data = asRecord(response.data);
    const rawStatus = asString(data.order_status);
    const mapped = mapPathaoStatus(rawStatus);
    return {
      status: mapped.status,
      providerStatusRaw: rawStatus,
      detail: asString(data.order_status) ?? null,
      raw: response,
    };
  },

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const data = asRecord(payload.data ?? payload);
    const rawStatus = asString(data.order_status) ?? asString(data.status);
    return {
      providerEventId: asString(data.event_id) ?? asString(payload.event_id) ?? asString(data.consignment_id),
      trackingCode: asString(data.consignment_id),
      providerConsignmentId: asString(data.consignment_id),
      status: mapPathaoStatus(rawStatus).status,
      providerStatusRaw: rawStatus,
      collectedPaisa: asNumber(data.amount_to_collect) != null ? Math.round(asNumber(data.amount_to_collect)! * 100) : null,
      courierChargePaisa: asNumber(data.delivery_fee) != null ? Math.round(asNumber(data.delivery_fee)! * 100) : null,
      detail: asString(data.order_status) ?? null,
    };
  },
};
