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
import {
  buildSteadfastOrderBody,
  mapSteadfastStatus,
  steadfastBaseUrl,
  steadfastNotificationKind,
  validateSteadfastOrderBody,
} from "@/modules/couriers/providers/steadfast-outgoing-data";
import { safeEqual } from "@/lib/crypto";

/**
 * Steadfast Courier adapter.
 *
 * Auth uses the `Api-Key` / `Secret-Key` header pair over the v1 REST API
 * (`create_order`, `status_by_cid`, `status_by_trackingcode`, `status_by_invoice`,
 * `get_balance`). We send JSON, which the v1 API accepts alongside form encoding
 * and keeps this adapter uniform with the others.
 *
 * Inbound webhooks are authenticated with a bearer token that the merchant
 * configures in the Steadfast portal, so `verifyWebhook` compares the
 * `Authorization` header against the stored `webhook_secret` instead of checking
 * an HMAC over the body.
 */

function authHeaders(credentials: Record<string, string | undefined>): Record<string, string> {
  requireCredentials("STEADFAST", credentials, ["api_key", "secret_key"]);
  return {
    "api-key": credentials.api_key!,
    "secret-key": credentials.secret_key!,
    "content-type": "application/json",
  };
}

/** `delivery_status` arrives both at the top level and nested under `data`. */
function rawStatusFrom(response: Record<string, unknown>): string | null {
  const data = asRecord(response.data ?? response.consignment);
  return (
    asString(response.delivery_status) ??
    asString(response.status_name) ??
    asString(data.delivery_status) ??
    asString(data.status_name) ??
    // `status` is also Steadfast's HTTP-ish code (200), so only accept it when it
    // is not a number.
    (asNumber(response.status) == null ? asString(response.status) : null) ??
    (asNumber(data.status) == null ? asString(data.status) : null)
  );
}

function trackingResult(response: Record<string, unknown>, fallbackDetail: string): CourierTrackingResult {
  const rawStatus = rawStatusFrom(response);
  const mapping = mapSteadfastStatus(rawStatus);
  const detail = mapping.needsReview
    ? `${rawStatus ?? fallbackDetail} — Steadfast is waiting for an approval; review before this is treated as final`
    : rawStatus ?? fallbackDetail;
  return { status: mapping.status, providerStatusRaw: rawStatus ?? fallbackDetail, detail, raw: response };
}

export const steadfastAdapter: CourierAdapter = {
  code: "STEADFAST",
  label: "Steadfast Courier",
  credentialKeys: ["api_key", "secret_key", "webhook_secret"],
  webhookSignatureHeader: "authorization",

  /**
   * Steadfast authenticates its webhooks with a bearer token, not a body
   * signature: the merchant picks the token in the portal and sends it as
   * `Authorization: Bearer <token>`. The comparison is constant time.
   */
  verifyWebhook({ headers, secret }) {
    if (!secret) return false;
    const authorization = headers.authorization ?? headers.Authorization ?? "";
    const token = authorization.replace(/^bearer\s+/i, "").trim();
    return token.length > 0 && safeEqual(token, secret);
  },

  async testConnection(context: { credentials: Record<string, string | undefined>; sandbox: boolean }) {
    const base = steadfastBaseUrl();
    try {
      // `get_balance` is a read-only, side-effect-free call that also proves the
      // account is live, and its answer is useful on the settings screen.
      const response = await courierRequest<Record<string, unknown>>({
        providerCode: "STEADFAST",
        method: "GET",
        url: `${base}/get_balance`,
        headers: authHeaders(context.credentials),
      });
      const balance = asNumber(response.current_balance) ?? asNumber(asRecord(response.data).current_balance);
      return {
        ok: true,
        detail: balance != null ? `Steadfast accepted the API key (COD balance ৳${balance.toFixed(2)})` : "Steadfast accepted the API key",
      };
    } catch (error) {
      if (error instanceof CourierRequestError && (error.status === 401 || error.status === 403)) {
        return { ok: false, detail: "Steadfast rejected the API key or secret key" };
      }
      if (error instanceof CourierRequestError && error.status === 404) {
        // Older deployments answer 404 on `get_balance`; a lookup of an unknown
        // consignment still proves whether the credentials are accepted.
        try {
          await courierRequest({
            providerCode: "STEADFAST",
            method: "GET",
            url: `${base}/status_by_cid/0`,
            headers: authHeaders(context.credentials),
          });
          return { ok: true, detail: "Steadfast accepted the API key" };
        } catch (probeError) {
          if (probeError instanceof CourierRequestError && (probeError.status === 401 || probeError.status === 403)) {
            return { ok: false, detail: "Steadfast rejected the API key or secret key" };
          }
          return { ok: true, detail: "Credentials accepted (Steadfast answered the probe lookup)" };
        }
      }
      if (error instanceof CourierRequestError) {
        return { ok: true, detail: `Credentials accepted (provider answered ${error.status} for the balance lookup)` };
      }
      return { ok: false, detail: error instanceof Error ? error.message : "Could not reach Steadfast" };
    }
  },

  async createShipment(context: CourierCreateContext): Promise<CourierCreateResult> {
    const body = buildSteadfastOrderBody(context.shipment);
    // Refuse before the call: an invalid phone or address would be rejected by
    // Steadfast anyway, and the operator needs to know which order field to fix.
    validateSteadfastOrderBody(body);

    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "STEADFAST",
      method: "POST",
      url: `${steadfastBaseUrl()}/create_order`,
      headers: authHeaders(context.credentials),
      body,
    });

    if (asNumber(response.status) !== 200 && asString(response.status) !== "200") {
      throw new CourierRequestError(
        "STEADFAST",
        asNumber(response.status) ?? 0,
        asString(response.message) ?? JSON.stringify(response),
      );
    }

    const consignment = asRecord(response.consignment);
    const consignmentId = asString(consignment.consignment_id) ?? asString(response.consignment_id);
    if (!consignmentId) throw new CourierRequestError("STEADFAST", 0, "Steadfast did not return a consignment id");

    const rawStatus = asString(consignment.status) ?? "in_review";
    return {
      providerConsignmentId: consignmentId,
      trackingCode: asString(consignment.tracking_code),
      providerStatusRaw: rawStatus,
      status: mapSteadfastStatus(rawStatus).status,
      raw: response,
    };
  },

  async fetchTracking(context: CourierTrackingContext): Promise<CourierTrackingResult> {
    const base = steadfastBaseUrl();
    const headers = authHeaders(context.credentials);

    // Steadfast exposes three lookups; try them in the order that is most likely
    // to be authoritative for this shipment.
    const attempts: Array<{ url: string; label: string }> = [];
    if (context.providerConsignmentId) {
      attempts.push({ url: `${base}/status_by_cid/${encodeURIComponent(context.providerConsignmentId)}`, label: "consignment id" });
    }
    if (context.trackingCode && context.trackingCode !== context.providerConsignmentId) {
      attempts.push({ url: `${base}/status_by_trackingcode/${encodeURIComponent(context.trackingCode)}`, label: "tracking code" });
    }
    if (attempts.length === 0) {
      throw new CourierRequestError("STEADFAST", 0, "This shipment has no Steadfast consignment id or tracking code yet");
    }

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        const response = await courierRequest<Record<string, unknown>>({
          providerCode: "STEADFAST",
          method: "GET",
          url: attempt.url,
          headers,
        });
        if (rawStatusFrom(response)) return trackingResult(response, attempt.label);
        lastError = new CourierRequestError("STEADFAST", 0, `Steadfast returned no delivery status for this ${attempt.label}`);
      } catch (error) {
        lastError = error;
        if (error instanceof CourierRequestError && (error.status === 401 || error.status === 403)) throw error;
      }
    }

    throw lastError instanceof CourierRequestError
      ? lastError
      : new CourierRequestError("STEADFAST", 0, "Steadfast did not return a status for this shipment");
  },

  async cancelShipment(context): Promise<{ cancelled: boolean; providerStatusRaw: string | null; detail?: string | null; raw: Record<string, unknown> }> {
    const response = await courierRequest<Record<string, unknown>>({
      providerCode: "STEADFAST",
      method: "POST",
      url: `${steadfastBaseUrl()}/cancel_order/${encodeURIComponent(context.providerConsignmentId)}`,
      headers: authHeaders(context.credentials),
    });
    const cancelled = asNumber(response.status) === 200 || asString(response.status) === "200";
    return {
      cancelled,
      providerStatusRaw: asString(response.delivery_status) ?? asString(response.status),
      detail: asString(response.message) ?? (cancelled ? null : "Steadfast did not cancel this consignment"),
      raw: response,
    };
  },

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const kind = steadfastNotificationKind(payload);
    const rawStatus = asString(payload.delivery_status) ?? asString(payload.status_name) ?? asString(payload.status);
    const cod = asNumber(payload.cod_amount);
    const deliveryCharge = asNumber(payload.delivery_charge);
    const consignmentId = asString(payload.consignment_id);
    const mapping = mapSteadfastStatus(rawStatus);

    const base: ParsedWebhook = {
      // `updated_at` keeps two webhooks about different statuses of the same
      // consignment distinct; without it the second one would look like a replay.
      providerEventId:
        asString(payload.event_id) ??
        (consignmentId ? `${consignmentId}:${rawStatus ?? kind}:${asString(payload.updated_at) ?? ""}` : null),
      trackingCode: asString(payload.tracking_code),
      providerConsignmentId: consignmentId,
      status: mapping.status,
      providerStatusRaw: rawStatus,
      collectedPaisa: cod != null ? Math.round(cod * 100) : null,
      courierChargePaisa: deliveryCharge != null ? Math.round(deliveryCharge * 100) : null,
      detail: mapping.needsReview
        ? `${rawStatus ?? kind} — awaiting Steadfast approval`
        : asString(payload.tracking_message) ?? rawStatus ?? kind,
    };

    // Only delivery-status notifications may move a shipment. Anything else is
    // stored and ignored rather than guessed at.
    if (kind === "other") {
      return { ...base, ignore: `Steadfast sent a "${asString(payload.notification_type)}" notification, not a delivery status` };
    }
    if (!rawStatus) {
      return { ...base, ignore: "The Steadfast webhook did not carry a delivery status" };
    }
    return base;
  },
};
