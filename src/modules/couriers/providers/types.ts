import "server-only";
import type { CourierProviderCode, ShipmentStatus } from "@/generated/prisma/client";

/**
 * Courier adapter contract.
 *
 * Every provider gets its own file; providers never leak into the order module.
 * Adapters receive plain data plus decrypted credentials and perform one HTTP
 * call. They must not touch the database — the courier service records results
 * inside its own transactions, so a provider outage can never leave a half
 * written order behind.
 */

export interface CourierCredentials {
  [key: string]: string | undefined;
}

/** Provider-agnostic shipment payload, built from the Shipment row. */
export interface OutgoingShipmentData {
  internalCode: string;
  merchantOrderId: string | null;
  recipientName: string;
  recipientPhone: string;
  recipientPhoneNormalized: string | null;
  recipientDistrictCode: string | null;
  recipientAddress: string;
  recipientArea: string | null;
  recipientNote: string | null;
  itemDescription: string | null;
  itemQuantity: number;
  declaredWeightGrams: number;
  codAmountPaisa: number;
  deliveryType: string | null;
  /** Provider-specific identifiers resolved from the provider `config` JSON. */
  providerConfig: Record<string, unknown>;
}

export interface CourierCreateContext {
  credentials: CourierCredentials;
  /** Sandbox when the provider row is in test mode. */
  sandbox: boolean;
  shipment: OutgoingShipmentData;
}

export interface CourierCreateResult {
  providerConsignmentId: string;
  trackingCode: string | null;
  providerStatusRaw: string | null;
  status: ShipmentStatus;
  raw: Record<string, unknown>;
}

export interface CourierTrackingContext {
  credentials: CourierCredentials;
  sandbox: boolean;
  trackingCode: string | null;
  providerConsignmentId: string | null;
}

export interface CourierTrackingResult {
  status: ShipmentStatus;
  providerStatusRaw: string | null;
  detail?: string | null;
  raw: Record<string, unknown>;
}

export interface CourierCancelContext {
  credentials: CourierCredentials;
  sandbox: boolean;
  providerConsignmentId: string;
  trackingCode: string | null;
}

export interface CourierCancelResult {
  cancelled: boolean;
  providerStatusRaw: string | null;
  detail?: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedWebhook {
  providerEventId: string | null;
  trackingCode: string | null;
  providerConsignmentId: string | null;
  status: ShipmentStatus;
  providerStatusRaw: string | null;
  /** Courier-reported COD amount in paisa, when the payload carries one. */
  collectedPaisa: number | null;
  courierChargePaisa: number | null;
  /** Raw provider status text, kept for support. */
  detail: string | null;
}

export interface CourierAdapter {
  code: CourierProviderCode;
  label: string;
  /** Credential keys the adapter needs, used to validate provider setup. */
  credentialKeys: string[];
  /** Header carrying the webhook HMAC signature (verified against `webhook_secret`). */
  webhookSignatureHeader: string;
  /** Header carrying the provider's event id, when it sends one. */
  webhookEventIdHeader?: string;
  /**
   * Optional credential check used by the settings screen. Providers without a
   * harmless auth probe leave this unset and the screen says so instead of
   * pretending the credentials were verified.
   */
  testConnection?(context: { credentials: CourierCredentials; sandbox: boolean }): Promise<{ ok: boolean; detail: string }>;
  createShipment(context: CourierCreateContext): Promise<CourierCreateResult>;
  fetchTracking(context: CourierTrackingContext): Promise<CourierTrackingResult>;
  cancelShipment?(context: CourierCancelContext): Promise<CourierCancelResult>;
  parseWebhook(payload: Record<string, unknown>): ParsedWebhook;
}

/** Provider HTTP failure carrying the provider's own message for logs and retries. */
export class CourierRequestError extends Error {
  readonly status: number;
  readonly providerCode: string;
  readonly body: string;

  constructor(providerCode: string, status: number, body: string) {
    super(`${providerCode} request failed (${status}): ${body.slice(0, 300)}`);
    this.name = "CourierRequestError";
    this.providerCode = providerCode;
    this.status = status;
    this.body = body.slice(0, 2000);
  }
}

export interface CourierHttpOptions {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  providerCode: string;
  timeoutMs?: number;
}

/** JSON HTTP helper with a hard timeout. Secrets are never logged by callers. */
export async function courierRequest<T = Record<string, unknown>>(options: CourierHttpOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) throw new CourierRequestError(options.providerCode, response.status, text);
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CourierRequestError(options.providerCode, response.status, `Unexpected non-JSON response: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof CourierRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CourierRequestError(options.providerCode, 0, "The provider did not respond within the timeout");
    }
    throw new CourierRequestError(options.providerCode, 0, error instanceof Error ? error.message : "Unknown network error");
  } finally {
    clearTimeout(timeout);
  }
}

export function requireCredentials(code: string, credentials: CourierCredentials, keys: string[]): void {
  const missing = keys.filter((key) => !credentials[key]);
  if (missing.length > 0) {
    throw new CourierRequestError(code, 0, `Missing credentials: ${missing.join(", ")}. Add them on the courier provider screen.`);
  }
}

/** Paisa → the taka number providers expect. */
export function paisasToTaka(paisa: number): number {
  return Math.max(0, Math.round(paisa)) / 100;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}
