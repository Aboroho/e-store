import "server-only";
import { AppError } from "@/lib/errors";

/**
 * bKash Tokenized Checkout client.
 *
 * Credentials live encrypted on the payment `Integration` row and are only read
 * on the server. This module performs the API calls; the decision of "was this
 * payment really made" is taken from the server-side `execute` response (or a
 * verified IPN webhook), never from the browser redirect.
 */

export interface BkashCredentials {
  app_key?: string;
  app_secret?: string;
  username?: string;
  password?: string;
}

export const BKASH_SANDBOX_BASE = "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
export const BKASH_LIVE_BASE = "https://tokenized.pay.bka.sh/v1.2.0-beta";

function baseUrl(sandbox: boolean): string {
  return sandbox ? BKASH_SANDBOX_BASE : BKASH_LIVE_BASE;
}

function requireCredentials(credentials: BkashCredentials): Required<BkashCredentials> {
  const missing = (["app_key", "app_secret", "username", "password"] as const).filter((key) => !credentials[key]);
  if (missing.length > 0) {
    throw AppError.integration(`bKash is not configured: missing ${missing.join(", ")}. Add the credentials on the integrations screen.`);
  }
  return credentials as Required<BkashCredentials>;
}

async function bkashRequest<T>(url: string, init: { method: "POST" | "GET"; headers: Record<string, string>; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init.method,
    headers: { accept: "application/json", "content-type": "application/json", ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw AppError.integration(`bKash returned a non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    throw AppError.integration(`bKash request failed (${response.status}): ${String(parsed.statusMessage ?? parsed.errorMessage ?? text).slice(0, 200)}`);
  }
  return parsed as T;
}

export async function grantBkashToken(credentials: BkashCredentials, sandbox: boolean) {
  const config = requireCredentials(credentials);
  const response = await bkashRequest<Record<string, unknown>>(`${baseUrl(sandbox)}/tokenized/checkout/token/grant`, {
    method: "POST",
    headers: { username: config.username, password: config.password },
    body: { app_key: config.app_key, app_secret: config.app_secret },
  });
  const token = typeof response.id_token === "string" ? response.id_token : null;
  if (!token) throw AppError.integration("bKash did not return a token");
  return token;
}

export interface BkashCreateResult {
  paymentId: string;
  bkashUrl: string;
  raw: Record<string, unknown>;
}

/** Create a payment and return the hosted-checkout URL. */
export async function createBkashPayment(
  input: {
    credentials: BkashCredentials;
    sandbox: boolean;
    amountPaisa: number;
    merchantInvoiceNumber: string;
    callbackUrl: string;
    payerReference: string;
  },
): Promise<BkashCreateResult> {
  const token = await grantBkashToken(input.credentials, input.sandbox);
  const response = await bkashRequest<Record<string, unknown>>(`${baseUrl(input.sandbox)}/tokenized/checkout/create`, {
    method: "POST",
    headers: { authorization: token, "x-app-key": input.credentials.app_key ?? "" },
    body: {
      mode: "0011",
      payerReference: input.payerReference,
      callbackURL: input.callbackUrl,
      amount: (Math.max(0, input.amountPaisa) / 100).toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: input.merchantInvoiceNumber,
    },
  });

  const paymentId = typeof response.paymentID === "string" ? response.paymentID : null;
  const bkashUrl = typeof response.bkashURL === "string" ? response.bkashURL : null;
  if (!paymentId || !bkashUrl) {
    throw AppError.integration(`bKash could not create the payment: ${String(response.statusMessage ?? "").slice(0, 200)}`);
  }
  return { paymentId, bkashUrl, raw: response };
}

/** Execute (capture) a payment. The response is the authoritative result. */
export async function executeBkashPayment(input: {
  credentials: BkashCredentials;
  sandbox: boolean;
  paymentId: string;
}): Promise<{ succeeded: boolean; transactionId: string | null; amountPaisa: number | null; rawStatus: string | null; raw: Record<string, unknown> }> {
  const token = await grantBkashToken(input.credentials, input.sandbox);
  const response = await bkashRequest<Record<string, unknown>>(`${baseUrl(input.sandbox)}/tokenized/checkout/execute`, {
    method: "POST",
    headers: { authorization: token, "x-app-key": input.credentials.app_key ?? "" },
    body: { paymentID: input.paymentId },
  });

  const transactionStatus = typeof response.transactionStatus === "string" ? response.transactionStatus : null;
  const amount = typeof response.amount === "string" || typeof response.amount === "number" ? Number(response.amount) : null;
  return {
    succeeded: transactionStatus === "Completed",
    transactionId: typeof response.trxID === "string" ? response.trxID : null,
    amountPaisa: amount != null && Number.isFinite(amount) ? Math.round(amount * 100) : null,
    rawStatus: transactionStatus,
    raw: response,
  };
}

/** Query a payment's status (used by the retry/reconciliation job). */
export async function queryBkashPayment(input: { credentials: BkashCredentials; sandbox: boolean; paymentId: string }) {
  const token = await grantBkashToken(input.credentials, input.sandbox);
  return bkashRequest<Record<string, unknown>>(`${baseUrl(input.sandbox)}/tokenized/checkout/payment/status`, {
    method: "POST",
    headers: { authorization: token, "x-app-key": input.credentials.app_key ?? "" },
    body: { paymentID: input.paymentId },
  });
}

export async function refundBkashPayment(input: {
  credentials: BkashCredentials;
  sandbox: boolean;
  paymentId: string;
  trxId: string;
  amountPaisa: number;
  reason: string;
}) {
  const token = await grantBkashToken(input.credentials, input.sandbox);
  return bkashRequest<Record<string, unknown>>(`${baseUrl(input.sandbox)}/tokenized/checkout/payment/refund`, {
    method: "POST",
    headers: { authorization: token, "x-app-key": input.credentials.app_key ?? "" },
    body: {
      paymentID: input.paymentId,
      trxID: input.trxId,
      amount: (Math.max(0, input.amountPaisa) / 100).toFixed(2),
      currency: "BDT",
      reason: input.reason.slice(0, 200),
    },
  });
}

/**
 * Verify an incoming IPN/callback signature.
 *
 * bKash does not sign its callbacks with the merchant secret; the reliable check
 * is to re-query the payment with our own credentials and compare the amount and
 * status. `verifyBkashCallback` does exactly that and is what the webhook route
 * uses before anything is marked paid.
 */
export async function verifyBkashCallback(input: {
  credentials: BkashCredentials;
  sandbox: boolean;
  paymentId: string;
  expectedAmountPaisa: number;
}): Promise<{ succeeded: boolean; transactionId: string | null; amountPaisa: number | null; rawStatus: string | null; raw: Record<string, unknown> }> {
  const response = await queryBkashPayment({ credentials: input.credentials, sandbox: input.sandbox, paymentId: input.paymentId });
  const rawStatus = typeof response.transactionStatus === "string" ? response.transactionStatus : null;
  const amount = typeof response.amount === "number" || typeof response.amount === "string" ? Number(response.amount) : null;
  const amountPaisa = amount != null && Number.isFinite(amount) ? Math.round(amount * 100) : null;

  const succeeded = rawStatus === "Completed" && amountPaisa === input.expectedAmountPaisa;
  return {
    succeeded,
    transactionId: typeof response.trxID === "string" ? response.trxID : null,
    amountPaisa,
    rawStatus,
    raw: response,
  };
}
