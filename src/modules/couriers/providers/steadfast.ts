import "server-only";
import type {
  CourierAdapter,
  CourierCreateContext,
  CourierCreateResult,
  CourierTrackingContext,
  CourierTrackingResult,
  ParsedWebhook,
} from "@/modules/couriers/providers/types";
import { CourierRequestError, asNumber, asRecord, asString, courierRequest, requireCredentials } from "@/modules/couriers/providers/types";
import { STEADFAST_BASE_URL, buildSteadfastOrderBody, mapSteadfastStatus } from "@/modules/couriers/providers/steadfast-outgoing-data";

/**
 * Steadfast Courier adapter.
 *
 * Auth uses the Api-Key / Secret-Key header pair. Steadfast sends form encoded
 * bodies; we send JSON because their v1 API accepts both and JSON keeps the
 * adapter uniform with the others.
 */

function authHeaders(credentials: Record<string, string | undefined>): Record<string, string> {
  requireCredentials("STEADFAST", credentials, ["api_key", "secret_key"]);
  return {
    "api-key": credentials.api_key!,
    "secret-key": credentials.secret_key!,
    "content-type": "application/json",
  };
}

export const steadfastAdapter: CourierAdapter = {
  code: "STEADFAST",
  label: "Steadfast Courier",
  credentialKeys: ["api_key", "secret_key", "webhook_secret"],
  webhookSignatureHeader: "authorization",

  async testConnection(context: { credentials: Record<string, string | undefined>; sandbox: boolean }) {
    try {
      // A lookup for an unknown consignment has no side effects: a 401/403 means the
      // keys are wrong, anything else means Steadfast accepted the credentials.
      await courierRequest({
        providerCode: "STEADFAST",
        method: "GET",
        url: `${STEADFAST_BASE_URL}/status_by_cid/0`,
        headers: authHeaders(context.credentials),
      });
      return { ok: true, detail: "Steadfast accepted the API key" };
    } catch (error) {
      if (error instanceof CourierRequestError && (error.status === 401 || error.status === 403)) {
        return { ok: false, detail: "Steadfast rejected the API key or secret key" };
      }
      if (error instanceof CourierRequestError) {
        return { ok: true, detail: `Credentials accepted (provider answered ${error.status} for the probe lookup)` };
      }
      return { ok: false, detail: error instanceof Error ? error.message : "Could not reach Steadfast" };
    }
  },

  async createShipment(context: CourierCreateContext): Promise<CourierCreateResult> {
    const body = buildSteadfastOrderBody(context.shipment);
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "STEADFAST",
      method: "POST",
      url: `${STEADFAST_BASE_URL}/create_order`,
      headers: authHeaders(context.credentials),
      body,
    });

    if (asNumber(response.status) !== 200 && asString(response.status) !== "200") {
      throw new CourierRequestError("STEADFAST", asNumber(response.status) ?? 0, asString(response.message) ?? JSON.stringify(response));
    }

    const consignment = asRecord(response.consignment);
    const consignmentId = asString(consignment.consignment_id);
    if (!consignmentId) throw new CourierRequestError("STEADFAST", 0, "Steadfast did not return a consignment id");

    return {
      providerConsignmentId: consignmentId,
      trackingCode: asString(consignment.tracking_code),
      providerStatusRaw: asString(consignment.status) ?? "in_review",
      status: mapSteadfastStatus(asString(consignment.status) ?? "in_review").status,
      raw: response,
    };
  },

  async fetchTracking(context: CourierTrackingContext): Promise<CourierTrackingResult> {
    const identifier = context.trackingCode ?? context.providerConsignmentId;
    if (!identifier) throw new CourierRequestError("STEADFAST", 0, "This shipment has no Steadfast tracking code yet");

    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "STEADFAST",
      method: "GET",
      url: `${STEADFAST_BASE_URL}/status_by_cid/${encodeURIComponent(identifier)}`,
      headers: authHeaders(context.credentials),
    });

    const data = asRecord(response.data ?? response.consignment);
    const rawStatus = asString(data.status) ?? asString(data.delivery_status);
    return {
      status: mapSteadfastStatus(rawStatus).status,
      providerStatusRaw: rawStatus,
      detail: rawStatus,
      raw: response,
    };
  },

  async cancelShipment(context): Promise<{ cancelled: boolean; providerStatusRaw: string | null; detail?: string | null; raw: Record<string, unknown> }> {
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "STEADFAST",
      method: "POST",
      url: `${STEADFAST_BASE_URL}/cancel_order/${encodeURIComponent(context.providerConsignmentId)}`,
      headers: authHeaders(context.credentials),
    });
    return {
      cancelled: asNumber(response.status) === 200 || asString(response.status) === "200",
      providerStatusRaw: asString(response.status),
      detail: asString(response.message),
      raw: response,
    };
  },

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const rawStatus = asString(payload.status) ?? asString(payload.delivery_status) ?? asString(payload.notification_type);
    const cod = asNumber(payload.cod_amount);
    return {
      providerEventId: asString(payload.event_id) ?? asString(payload.consignment_id),
      trackingCode: asString(payload.tracking_code),
      providerConsignmentId: asString(payload.consignment_id),
      status: mapSteadfastStatus(rawStatus).status,
      providerStatusRaw: rawStatus,
      collectedPaisa: cod != null ? Math.round(cod * 100) : null,
      courierChargePaisa: asNumber(payload.delivery_charge) != null ? Math.round(asNumber(payload.delivery_charge)! * 100) : null,
      detail: rawStatus,
    };
  },
};
