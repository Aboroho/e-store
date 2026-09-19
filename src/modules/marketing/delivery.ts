import "server-only";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logging";
import { marketingProvider } from "./providers";
import { integrationCredentials } from "./service";

/**
 * Server-side marketing event delivery.
 *
 * Only providers registered as `server` (or `both`) are delivered here; browser pixels
 * are injected into the storefront instead. A 4xx that is not a rate limit means the
 * configuration is wrong — retrying cannot fix it, so the event is discarded instead of
 * burning the retry budget. Customer identifiers are hashed before they leave the
 * server (see `queueMarketingEvent`), and GA4 only ever receives an opaque client id.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_RESPONSE_BYTES = 2000;

export function marketingBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000);
}

function snippet(value: string): string | null {
  return value.length > MAX_RESPONSE_BYTES ? `${value.slice(0, MAX_RESPONSE_BYTES)}…` : value;
}

interface DeliveryTarget {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** GA4 accepts any client id; Meta needs the event wrapped in a `data` array. */
  responseIsEmpty: boolean;
}

function buildRequest(input: {
  provider: string;
  publicConfig: Record<string, string>;
  credentials: Record<string, string>;
  payload: Record<string, unknown>;
  testEventCode: string | null;
}): DeliveryTarget | null {
  const { provider, publicConfig, credentials, payload } = input;
  const pixelId = publicConfig.pixelId ?? "";

  if (provider === "META_CONVERSIONS") {
    const token = credentials.accessToken;
    if (!pixelId || !token) return null;
    const query = new URLSearchParams({ access_token: token });
    if (input.testEventCode) query.set("test_event_code", input.testEventCode);
    return {
      url: `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events?${query.toString()}`,
      headers: { "content-type": "application/json" },
      body: { data: [payload] },
      responseIsEmpty: false,
    };
  }

  if (provider === "GOOGLE_ANALYTICS") {
    const secret = credentials.apiSecret;
    if (!pixelId || !secret) return null;
    const eventName = String(payload.event_name ?? "event");
    return {
      url: `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(pixelId)}&api_secret=${encodeURIComponent(secret)}`,
      headers: { "content-type": "application/json" },
      body: {
        client_id: payload.user_data && typeof payload.user_data === "object" ? (payload.user_data as Record<string, unknown>).external_id : "server",
        events: [
          {
            name: eventName.toLowerCase(),
            params: {
              event_id: payload.event_id,
              currency: payload.currency,
              value: payload.value,
              order_id: payload.order_id,
            },
          },
        ],
      },
      responseIsEmpty: true,
    };
  }

  if (provider === "CUSTOM") {
    const url = publicConfig.endpointUrl;
    const token = credentials.sharedSecret;
    if (!url || !token) return null;
    return {
      url,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: payload,
      responseIsEmpty: false,
    };
  }

  return null;
}

export interface MarketingDeliveryResult {
  sent: number;
  failed: number;
  discarded: number;
  skipped: number;
}

/** Deliver one batch of due server-side marketing events. */
export async function deliverDueMarketingEvents(batchSize = 10): Promise<MarketingDeliveryResult> {
  const result: MarketingDeliveryResult = { sent: 0, failed: 0, discarded: 0, skipped: 0 };

  // FAILED means "retry later": a retryable provider error keeps the row with a backoff,
  // so both states are claimable. DISCARDED and SENT are terminal.
  const due: { status: { in: ["PENDING", "FAILED"] }; OR: Array<{ nextAttemptAt: null } | { nextAttemptAt: { lte: Date } }> } = {
    status: { in: ["PENDING", "FAILED"] },
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
  };
  const candidates = await prisma.marketingEvent.findMany({
    where: due,
    orderBy: { createdAt: "asc" },
    take: batchSize,
    include: { integration: true },
  });
  if (candidates.length === 0) return result;

  for (const event of candidates) {
    const claimed = await prisma.marketingEvent.updateMany({
      where: { id: event.id, ...due },
      data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
    });
    if (claimed.count === 0) {
      result.skipped += 1;
      continue;
    }

    const integration = event.integration;
    if (!integration.isEnabled) {
      await prisma.marketingEvent.update({ where: { id: event.id }, data: { status: "DISCARDED", lastError: "Integration was disabled" } });
      result.discarded += 1;
      continue;
    }

    const provider = marketingProvider(integration.provider);
    if (!provider) {
      await prisma.marketingEvent.update({ where: { id: event.id }, data: { status: "DISCARDED", lastError: "Provider is not registered" } });
      result.discarded += 1;
      continue;
    }

    const credentials = integration.integrationId ? await integrationCredentials(integration.integrationId) : {};
    const target = buildRequest({
      provider: integration.provider,
      publicConfig: (integration.config as Record<string, string> | null) ?? {},
      credentials,
      payload: event.payload as Record<string, unknown>,
      testEventCode: integration.testEventCode,
    });

    if (!target) {
      await prisma.marketingEvent.update({
        where: { id: event.id },
        data: { status: "DISCARDED", lastError: "Integration is missing a required id or credential" },
      });
      result.discarded += 1;
      continue;
    }

    const attempts = event.attempts + 1;

    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify(target.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = target.responseIsEmpty ? "" : await response.text().catch(() => "");

      if (response.ok) {
        await prisma.marketingEvent.update({
          where: { id: event.id },
          data: { status: "SENT", attempts, sentAt: new Date(), nextAttemptAt: null, responsePayload: (text ? { raw: snippet(text) } : undefined) as never, lastError: null },
        });
        result.sent += 1;
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
      await prisma.marketingEvent.update({
        where: { id: event.id },
        data: {
          status: giveUp ? "DISCARDED" : "FAILED",
          attempts,
          lastError: `HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
          nextAttemptAt: giveUp ? null : new Date(Date.now() + marketingBackoffMs(attempts)),
        },
      });
      if (giveUp) result.discarded += 1;
      else result.failed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Marketing request failed";
      const giveUp = attempts >= MAX_ATTEMPTS;
      await prisma.marketingEvent.update({
        where: { id: event.id },
        data: {
          status: giveUp ? "DISCARDED" : "FAILED",
          attempts,
          lastError: message.slice(0, 500),
          nextAttemptAt: giveUp ? null : new Date(Date.now() + marketingBackoffMs(attempts)),
        },
      });
      if (giveUp) result.discarded += 1;
      else result.failed += 1;
      logger.warn("marketing.delivery_failed", { eventId: event.id, attempts, error: message });
    }
  }

  return result;
}
