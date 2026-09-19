import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";
import {
  listMarketingEvents,
  listMarketingIntegrations,
  queueMarketingEvent,
  saveMarketingIntegration,
  setMarketingEnabled,
  storefrontMarketingPixels,
} from "@/modules/marketing/service";
import { deliverDueMarketingEvents } from "@/modules/marketing/delivery";
import { MARKETING_PROVIDERS, browserConfigFor, providerSupportsBrowserPixel, providerSupportsServerDelivery } from "@/modules/marketing/providers";
import { createTestBusiness, databaseReachable, destroyTestBusiness, type TestContext } from "./fixtures";

/**
 * Marketing integrations.
 *
 * The rules under test: a credential never reaches the browser, a visitor who has not
 * consented is not measured, a conversion cannot be counted twice, and a failing provider
 * is retried rather than silently dropping the event.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("marketing integrations (database)", () => {
  let context: TestContext;
  let storefrontId: string;
  const actor = () => ({ businessId: context.businessId, userId: context.userId, actorLabel: "tester@example.test" });

  beforeAll(async () => {
    context = await createTestBusiness("marketing");
    const storefront = await prisma.storefront.create({
      data: { businessId: context.businessId, name: "Marketing shop", slug: `mkt-${randomUUID().slice(0, 6)}`, code: `MK-${randomUUID().slice(0, 6)}`, status: "ACTIVE", isDefault: true },
    });
    storefrontId = storefront.id;
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  it("keeps server credentials encrypted and public ids in plain configuration", async () => {
    const integration = await saveMarketingIntegration(actor(), {
      provider: "CUSTOM",
      name: "Warehouse stream",
      storefrontId,
      isEnabled: true,
      consentRequired: false,
      publicConfig: { endpointUrl: "https://events.example.test/collect" },
      secrets: { sharedSecret: "super-secret-token" },
    });

    const row = await prisma.marketingIntegration.findUniqueOrThrow({ where: { id: integration.id } });
    expect(JSON.stringify(row.config)).toContain("events.example.test");
    expect(JSON.stringify(row.config)).not.toContain("super-secret-token");
    expect(row.integrationId).not.toBeNull();

    const secret = await prisma.integrationSecret.findFirstOrThrow({ where: { integrationId: row.integrationId! } });
    expect(secret.ciphertext).not.toContain("super-secret-token");
    expect(decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag })).toBe("super-secret-token");

    // The admin view reports that a secret exists, never its value.
    const view = (await listMarketingIntegrations(context.businessId)).find((entry) => entry.id === integration.id);
    expect(view?.secretKeys).toContain("sharedSecret");
    expect(JSON.stringify(view)).not.toContain("super-secret-token");
  });

  it("hands the storefront only enabled browser pixels with public ids", async () => {
    await saveMarketingIntegration(actor(), {
      provider: "META_PIXEL",
      name: "Meta pixel",
      storefrontId,
      isEnabled: true,
      consentRequired: true,
      publicConfig: { pixelId: "1234567890" },
      secrets: {},
    });
    await saveMarketingIntegration(actor(), {
      provider: "TIKTOK_PIXEL",
      name: "TikTok pixel (off)",
      storefrontId,
      isEnabled: false,
      consentRequired: true,
      publicConfig: { pixelId: "ABCDEF12345" },
      secrets: {},
    });

    const pixels = await storefrontMarketingPixels(context.businessId, storefrontId);
    expect(pixels).toHaveLength(1);
    expect(pixels[0]?.provider).toBe("META_PIXEL");
    expect(pixels[0]?.config.pixelId).toBe("1234567890");
    expect(pixels[0]?.consentRequired).toBe(true);

    // A server-only integration never shows up as a pixel.
    expect(pixels.some((pixel) => pixel.provider === "CUSTOM")).toBe(false);
    // And a malformed public id is dropped rather than rendered into a script tag.
    expect(browserConfigFor("META_PIXEL", { pixelId: "<script>" })).toBeNull();
    expect(providerSupportsBrowserPixel("CUSTOM")).toBe(false);
    expect(providerSupportsServerDelivery("META_PIXEL")).toBe(false);
  });

  it("queues a consented conversion, refuses one without consent and dedupes a replay", async () => {
    // A consent-required server integration: this is the one the assertions track.
    const gated = await saveMarketingIntegration(actor(), {
      provider: "META_CONVERSIONS",
      name: "Meta CAPI (consent required)",
      storefrontId,
      isEnabled: true,
      consentRequired: true,
      publicConfig: { pixelId: "9876543210123" },
      secrets: { accessToken: "EAAG-test-token" },
    });

    const dedupeKey = `order:${randomUUID()}:purchase`;

    const withoutConsent = await queueMarketingEvent(
      { businessId: context.businessId },
      { eventName: "Purchase", dedupeKey, storefrontId, consentGranted: false, valuePaisa: 120_000 },
    );
    // The consent-required integration records the attempt but sends nothing; the
    // endpoint that does not require consent still receives it (queued > 0).
    expect(withoutConsent.skipped).toBe(1);
    const skipped = await prisma.marketingEvent.findFirstOrThrow({ where: { dedupeKey, marketingIntegrationId: gated.id } });
    expect(skipped.status).toBe("SKIPPED_NO_CONSENT");

    const first = await queueMarketingEvent(
      { businessId: context.businessId },
      { eventName: "Purchase", dedupeKey, storefrontId, consentGranted: true, valuePaisa: 120_000 },
    );
    expect(first.queued).toBe(1);

    // The same conversion cannot be counted twice: the provider row is keyed on the
    // dedupe key, so a replay inserts nothing.
    const replay = await queueMarketingEvent(
      { businessId: context.businessId },
      { eventName: "Purchase", dedupeKey, storefrontId, consentGranted: true, valuePaisa: 120_000 },
    );
    expect(replay.queued).toBe(0);

    // The skipped row is promoted once consent arrives, so the conversion is delivered
    // exactly once rather than being blocked by its own dedupe key.
    expect(await prisma.marketingEvent.count({ where: { dedupeKey, marketingIntegrationId: gated.id } })).toBe(1);
    expect(await prisma.marketingEvent.count({ where: { dedupeKey, marketingIntegrationId: gated.id, status: "PENDING" } })).toBe(1);

    const events = await listMarketingEvents(context.businessId, { limit: 50 });
    expect(events.some((event) => event.dedupeKey === dedupeKey)).toBe(true);

    // Leave only the custom endpoint enabled for the delivery tests below.
    await setMarketingEnabled(actor(), gated.id, false);
    await prisma.marketingEvent.updateMany({ where: { dedupeKey, status: "PENDING" }, data: { status: "DISCARDED" } });
  });

  it("delivers a server conversion without raw personal data and marks it sent", async () => {
    const dedupeKey = `order:${randomUUID()}:purchase`;
    await queueMarketingEvent(
      { businessId: context.businessId },
      { eventName: "Purchase", dedupeKey, storefrontId, consentGranted: true, valuePaisa: 250_000 },
    );

    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
        return new Response(null, { status: 204 });
      }),
    );

    let result;
    try {
      result = await deliverDueMarketingEvents(20);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(result.sent).toBeGreaterThanOrEqual(1);
    const call = calls.find((entry) => entry.body.includes(dedupeKey));
    expect(call).toBeDefined();
    expect(call!.url).toBe("https://events.example.test/collect");
    expect(call!.headers.authorization).toBe("Bearer super-secret-token");

    const event = await prisma.marketingEvent.findFirstOrThrow({ where: { dedupeKey } });
    expect(event.status).toBe("SENT");
    expect(event.attempts).toBe(1);
    // The payload carries the dedupe key and the amount, and no contact details.
    expect(call!.body).toContain(dedupeKey);
    expect(call!.body).not.toMatch(/017\d{9}|@example\.(com|test)/);
  });

  it("retries a failing provider with backoff and discards events once it is switched off", async () => {
    // Isolate this test from anything still queued above.
    await prisma.marketingIntegration.updateMany({ where: { businessId: context.businessId }, data: { isEnabled: false } });
    await prisma.marketingEvent.updateMany({ where: { businessId: context.businessId, status: { in: ["PENDING", "FAILED"] } }, data: { status: "DISCARDED" } });

    const retrying = await saveMarketingIntegration(actor(), {
      provider: "CUSTOM",
      name: "Flaky endpoint",
      storefrontId,
      isEnabled: true,
      consentRequired: false,
      publicConfig: { endpointUrl: "https://events.example.test/flaky" },
      secrets: { sharedSecret: "flaky-token" },
    });

    const dedupeKey = `order:${randomUUID()}:purchase`;
    await queueMarketingEvent(
      { businessId: context.businessId },
      { eventName: "Purchase", dedupeKey, storefrontId, consentGranted: true, valuePaisa: 90_000 },
    );

    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream exploded", { status: 503 })));
    let result;
    try {
      result = await deliverDueMarketingEvents(20);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.failed).toBeGreaterThanOrEqual(1);

    // FAILED is a retry state, not a dead end: it is picked up again after the backoff.
    const afterRetry = await prisma.marketingEvent.findFirstOrThrow({ where: { dedupeKey } });
    expect(afterRetry.status).toBe("FAILED");
    expect(afterRetry.attempts).toBe(1);
    expect(afterRetry.lastError).toContain("503");
    expect(afterRetry.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    await prisma.marketingEvent.updateMany({ where: { dedupeKey }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    try {
      await deliverDueMarketingEvents(20);
    } finally {
      vi.unstubAllGlobals();
    }
    expect((await prisma.marketingEvent.findFirstOrThrow({ where: { dedupeKey } })).status).toBe("SENT");

    // Once the integration is disabled, a still-pending event is discarded, not retried
    // forever and never delivered.
    const orphanKey = `order:${randomUUID()}:purchase`;
    await queueMarketingEvent({ businessId: context.businessId }, { eventName: "Purchase", dedupeKey: orphanKey, storefrontId, consentGranted: true, valuePaisa: 10_000 });
    await setMarketingEnabled(actor(), retrying.id, false);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await deliverDueMarketingEvents(20);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await prisma.marketingEvent.findFirstOrThrow({ where: { dedupeKey: orphanKey } })).status).toBe("DISCARDED");
  });

  it("refuses an unknown provider and requires the declared fields", async () => {
    expect(MARKETING_PROVIDERS.length).toBeGreaterThanOrEqual(4);
    await expect(
      saveMarketingIntegration(actor(), { provider: "NOT_A_PROVIDER", name: "Nope", publicConfig: {}, secrets: {} }),
    ).rejects.toThrow();
    await expect(
      saveMarketingIntegration(actor(), { provider: "META_CONVERSIONS", name: "Meta CAPI", storefrontId, isEnabled: true, publicConfig: {}, secrets: {} }),
    ).rejects.toThrow(/pixelId|accessToken|required/i);
  });
});
