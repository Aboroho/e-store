import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";

/**
 * SSLCommerz hosted checkout client.
 *
 * Callbacks are only trusted after `validate` + `transaction/query` calls made
 * with our own store credentials, plus the hash check for the store passwd when
 * SSLCommerz sends one.
 */

export interface SslcommerzCredentials {
  store_id?: string;
  store_passwd?: string;
  /** Optional separate secret used for the `verify_sign` hash; defaults to store_passwd. */
  hash_secret?: string;
  sandbox?: string;
}

export const SSLCOMMERZ_SANDBOX_BASE = "https://sandbox.sslcommerz.com";
export const SSLCOMMERZ_LIVE_BASE = "https://securepay.sslcommerz.com";

function baseUrl(sandbox: boolean): string {
  return sandbox ? SSLCOMMERZ_SANDBOX_BASE : SSLCOMMERZ_LIVE_BASE;
}

function requireCredentials(credentials: SslcommerzCredentials): Required<Pick<SslcommerzCredentials, "store_id" | "store_passwd">> {
  if (!credentials.store_id || !credentials.store_passwd) {
    throw AppError.integration("SSLCommerz is not configured: store_id and store_passwd are required");
  }
  return { store_id: credentials.store_id, store_passwd: credentials.store_passwd };
}

async function form<T>(url: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw AppError.integration(`SSLCommerz request failed (${response.status}): ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw AppError.integration("SSLCommerz returned an unexpected response");
  }
}

export interface SslcommerzSessionInput {
  credentials: SslcommerzCredentials;
  sandbox: boolean;
  amountPaisa: number;
  tranId: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: string;
  city: string;
}

export async function createSslcommerzSession(input: SslcommerzSessionInput): Promise<{ sessionKey: string; gatewayUrl: string; raw: Record<string, unknown> }> {
  const config = requireCredentials(input.credentials);
  const response = await form<Record<string, unknown>>(`${baseUrl(input.sandbox)}/gwprocess/v4/api.php`, {
    store_id: config.store_id,
    store_passwd: config.store_passwd,
    total_amount: (Math.max(0, input.amountPaisa) / 100).toFixed(2),
    currency: "BDT",
    tran_id: input.tranId,
    success_url: input.successUrl,
    fail_url: input.failUrl,
    cancel_url: input.cancelUrl,
    ipn_url: input.ipnUrl,
    cus_name: input.customerName,
    cus_phone: input.customerPhone,
    ...(input.customerEmail ? { cus_email: input.customerEmail } : {}),
    cus_add1: input.address,
    cus_city: input.city,
    cus_country: "Bangladesh",
    shipping_method: "Courier",
    product_name: "Order payment",
    product_category: "General",
    product_profile: "general",
  });

  const sessionKey = typeof response.sessionkey === "string" ? response.sessionkey : null;
  const gatewayUrl = typeof response.GatewayPageURL === "string" ? response.GatewayPageURL : null;
  if (!sessionKey || !gatewayUrl) {
    throw AppError.integration(`SSLCommerz could not create a session: ${String(response.failedreason ?? "").slice(0, 200)}`);
  }
  return { sessionKey, gatewayUrl, raw: response };
}

/** Validate a callback's `val_id`; the response is the authoritative result. */
export async function validateSslcommerzPayment(input: { credentials: SslcommerzCredentials; sandbox: boolean; valId: string }) {
  const config = requireCredentials(input.credentials);
  return form<Record<string, unknown>>(
    `${baseUrl(input.sandbox)}/validator/api/validationserverAPI.php?${new URLSearchParams({
      val_id: input.valId,
      store_id: config.store_id,
      store_passwd: config.store_passwd,
      format: "json",
    }).toString()}`,
    {},
  );
}

/** Query the transaction by our own tran_id (used when only IPN fields arrive). */
export async function querySslcommerzTransaction(input: { credentials: SslcommerzCredentials; sandbox: boolean; tranId: string }) {
  const config = requireCredentials(input.credentials);
  return form<Record<string, unknown>>(
    `${baseUrl(input.sandbox)}/validator/api/merchantTransIDvalidationAPI.php?${new URLSearchParams({
      tran_id: input.tranId,
      store_id: config.store_id,
      store_passwd: config.store_passwd,
      format: "json",
    }).toString()}`,
    {},
  );
}

export async function refundSslcommerzPayment(input: {
  credentials: SslcommerzCredentials;
  sandbox: boolean;
  bankTranId: string;
  amountPaisa: number;
  refundRemarks: string;
}) {
  const config = requireCredentials(input.credentials);
  return form<Record<string, unknown>>(`${baseUrl(input.sandbox)}/validator/api/merchantTransIDvalidationAPI.php`, {
    bank_tran_id: input.bankTranId,
    store_id: config.store_id,
    store_passwd: config.store_passwd,
    refund_amount: (Math.max(0, input.amountPaisa) / 100).toFixed(2),
    refund_remarks: input.refundRemarks.slice(0, 200),
    refe_id: `REF-${Date.now()}`,
    format: "json",
  });
}

/**
 * SSLCommerz `verify_sign`: md5 of (store_passwd + sorted key=value pairs + store_passwd)
 * with the hash fields removed. Returns false when the payload has no signature.
 */
export function verifySslcommerzHash(payload: Record<string, unknown>, secret: string): boolean {
  const verifySign = typeof payload.verify_sign === "string" ? payload.verify_sign : null;
  if (!verifySign) return false;

  const entries = Object.entries(payload)
    .filter(([key]) => !["verify_sign", "verify_key", "verify_sign_sha2"].includes(key))
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const payloadString = entries.map(([key, value]) => `${key}=${value}`).join("&");
  const expected = createHash("md5").update(`${secret}${payloadString}${secret}`).digest("hex");
  return expected.toLowerCase() === verifySign.toLowerCase();
}

/** Normalise SSLCommerz's own status strings. */
export function mapSslcommerzStatus(status: string | null | undefined): "VALID" | "VALIDATED" | "PENDING" | "FAILED" | "CANCELLED" | "UNKNOWN" {
  switch ((status ?? "").toUpperCase()) {
    case "VALID":
    case "VALIDATED":
      return "VALIDATED";
    case "PENDING":
    case "PENDING_PAYMENT":
      return "PENDING";
    case "FAILED":
    case "INVALID_TRANSACTION":
      return "FAILED";
    case "CANCELLED":
    case "CANCELED":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}
