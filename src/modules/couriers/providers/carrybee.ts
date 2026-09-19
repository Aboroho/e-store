import "server-only";
import type {
  CourierAdapter,
  CourierCancelContext,
  CourierCancelResult,
  CourierCreateContext,
  CourierCreateResult,
  CourierTrackingContext,
  CourierTrackingResult,
  ParsedWebhook,
} from "@/modules/couriers/providers/types";
import { CourierRequestError, asNumber, asRecord, asString, courierRequest, requireCredentials } from "@/modules/couriers/providers/types";
import {
  CARRYBEE_BASE_URL,
  CARRYBEE_SANDBOX_BASE_URL,
  buildCarryBeeOrderBody,
  mapCarryBeeStatus,
} from "@/modules/couriers/providers/carrybee-outgoing-data";

/**
 * CarryBee adapter.
 *
 * CarryBee authenticates with the api-key / secret-key header pair; merchants
 * whose account also requires a bearer token can store it as the optional
 * `auth_token` credential and it is sent as `X-Auth-Token`.
 */

function baseUrl(sandbox: boolean): string {
  return sandbox ? CARRYBEE_SANDBOX_BASE_URL : CARRYBEE_BASE_URL;
}

function authHeaders(credentials: Record<string, string | undefined>): Record<string, string> {
  requireCredentials("CARRYBEE", credentials, ["api_key", "secret_key"]);
  const headers: Record<string, string> = {
    "api-key": credentials.api_key!,
    "secret-key": credentials.secret_key!,
    "content-type": "application/json",
  };
  if (credentials.auth_token) headers["x-auth-token"] = credentials.auth_token;
  return headers;
}

export const carrybeeAdapter: CourierAdapter = {
  code: "CARRYBEE",
  label: "CarryBee",
  credentialKeys: ["api_key", "secret_key", "auth_token", "webhook_secret"],
  webhookSignatureHeader: "x-cb-signature",

  async testConnection(context: { credentials: Record<string, string | undefined>; sandbox: boolean }) {
    try {
      await courierRequest({
        providerCode: "CARRYBEE",
        method: "GET",
        url: `${baseUrl(context.sandbox)}/api/v2/orders/0`,
        headers: authHeaders(context.credentials),
      });
      return { ok: true, detail: "CarryBee accepted the API key" };
    } catch (error) {
      if (error instanceof CourierRequestError && (error.status === 401 || error.status === 403)) {
        return { ok: false, detail: "CarryBee rejected the API key or secret key" };
      }
      if (error instanceof CourierRequestError) {
        return { ok: true, detail: `Credentials accepted (provider answered ${error.status} for the probe lookup)` };
      }
      return { ok: false, detail: error instanceof Error ? error.message : "Could not reach CarryBee" };
    }
  },

  async createShipment(context: CourierCreateContext): Promise<CourierCreateResult> {
    const body = buildCarryBeeOrderBody(context.shipment);
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "CARRYBEE",
      method: "POST",
      url: `${baseUrl(context.sandbox)}/api/v2/orders`,
      headers: authHeaders(context.credentials),
      body,
    });

    const data = asRecord(response.data ?? response);
    const consignmentId = asString(data.consignment_id) ?? asString(data.order_id) ?? asString(data.id);
    if (!consignmentId) throw new CourierRequestError("CARRYBEE", 0, "CarryBee did not return a consignment id");

    const rawStatus = asString(data.status) ?? "pending";
    return {
      providerConsignmentId: consignmentId,
      trackingCode: asString(data.tracking_code) ?? asString(data.consignment_id) ?? consignmentId,
      providerStatusRaw: rawStatus,
      status: mapCarryBeeStatus(rawStatus).status,
      raw: response,
    };
  },

  async fetchTracking(context: CourierTrackingContext): Promise<CourierTrackingResult> {
    const identifier = context.trackingCode ?? context.providerConsignmentId;
    if (!identifier) throw new CourierRequestError("CARRYBEE", 0, "This shipment has no CarryBee tracking code yet");

    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "CARRYBEE",
      method: "GET",
      url: `${baseUrl(context.sandbox)}/api/v2/orders/${encodeURIComponent(identifier)}`,
      headers: authHeaders(context.credentials),
    });

    const data = asRecord(response.data ?? response);
    const rawStatus = asString(data.status);
    return { status: mapCarryBeeStatus(rawStatus).status, providerStatusRaw: rawStatus, detail: rawStatus, raw: response };
  },

  async cancelShipment(context: CourierCancelContext): Promise<CourierCancelResult> {
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "CARRYBEE",
      method: "POST",
      url: `${baseUrl(context.sandbox)}/api/v2/orders/${encodeURIComponent(context.providerConsignmentId)}/cancel`,
      headers: authHeaders(context.credentials),
    });
    const data = asRecord(response.data ?? response);
    const rawStatus = asString(data.status);
    return { cancelled: mapCarryBeeStatus(rawStatus).status === "CANCELLED", providerStatusRaw: rawStatus, detail: asString(response.message), raw: response };
  },

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const data = asRecord(payload.data ?? payload);
    const rawStatus = asString(data.status) ?? asString(payload.status);
    const cod = asNumber(data.collectable_amount) ?? asNumber(data.cod_amount);
    return {
      providerEventId: asString(payload.event_id) ?? asString(data.consignment_id),
      trackingCode: asString(data.tracking_code) ?? asString(data.consignment_id),
      providerConsignmentId: asString(data.consignment_id) ?? asString(data.order_id),
      status: mapCarryBeeStatus(rawStatus).status,
      providerStatusRaw: rawStatus,
      collectedPaisa: cod != null ? Math.round(cod * 100) : null,
      courierChargePaisa: asNumber(data.delivery_charge) != null ? Math.round(asNumber(data.delivery_charge)! * 100) : null,
      detail: rawStatus,
    };
  },
};
