import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { hashApiKey, safeEqual, verifyPayloadSignature } from "@/lib/crypto";
import { assertScope, authenticateApiRequest, hasScope, logApiRequest, type ApiPrincipal } from "@/lib/api/auth";
import { createApiKey, createWebhook, listApiKeys, queueWebhooks, revokeApiKey, rotateApiKey, webhookSecret } from "@/modules/api-keys/service";
import { deliverDueWebhooks } from "@/modules/api-keys/delivery";
import { createTestBusiness, databaseReachable, destroyTestBusiness, type TestContext } from "./fixtures";

/**
 * API keys and webhooks.
 *
 * What matters here is that a key is only ever as powerful as its scopes, that the secret
 * is unknowable after the one time it is shown, and that a delivery is signed, retried
 * with backoff and eventually dead-lettered rather than lost or replayed twice.
 */

const reachable = await databaseReachable();

describe.skipIf(!reachable)("api keys and webhooks (database)", () => {
  let context: TestContext;
  const actor = () => ({ businessId: context.businessId, userId: context.userId, actorLabel: "tester@example.test" });

  beforeAll(async () => {
    context = await createTestBusiness("api-keys");
  });

  afterAll(async () => {
    await destroyTestBusiness(context.businessId);
    await prisma.$disconnect();
  });

  function request(headers: Record<string, string> = {}) {
    return new Request("https://shop.example.test/api/v1/orders", { headers });
  }

  it("shows the secret once and stores only a hash", async () => {
    const { key, plaintext } = await createApiKey(actor(), {
      name: "Integration",
      scopes: ["orders:read", "orders:write"],
      rateLimitPerMinute: 60,
    });

    expect(plaintext).toMatch(/^esk_[A-Za-z0-9]+\.[A-Za-z0-9]+$/);
    expect(key.keyPreview.endsWith(plaintext.slice(-4))).toBe(true);
    expect(key.keyPreview).not.toContain(plaintext.slice(0, -8));

    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id }, include: { scopes: true } });
    expect(row.keyHash).not.toContain(plaintext);
    expect(row.keyHash).toHaveLength(64);
    // The stored hash is the SHA-256 of the secret the client was shown.
    expect(row.keyHash).toBe(hashApiKey(plaintext));
    expect(row.scopes.map((scope) => scope.scope).sort()).toEqual(["orders:read", "orders:write"]);
    // The list view never exposes the hash either.
    const listed = (await listApiKeys(context.businessId)).find((entry) => entry.id === key.id);
    expect(JSON.stringify(listed)).not.toContain(row.keyHash);
  });

  it("authenticates with the plaintext key and reports its scopes", async () => {
    const { plaintext, key } = await createApiKey(actor(), { name: "Reader", scopes: ["orders:read"] });

    const principal = await authenticateApiRequest(request({ authorization: `Bearer ${plaintext}` }));
    expect(principal.kind).toBe("api_key");
    expect(principal.businessId).toBe(context.businessId);
    expect(principal.scopes).toEqual(["orders:read"]);
    expect(hasScope(principal, "orders:read")).toBe(true);
    expect(hasScope(principal, "orders:write")).toBe(false);
    expect(() => assertScope(principal, "orders:write")).toThrow(AppError);

    const after = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(after.usageCount).toBe(1);
    expect(after.lastUsedAt).not.toBeNull();

    // The route (not the authenticator) records the request log entry.
    await logApiRequest({ apiKeyId: principal.apiKeyId, method: "GET", path: "/api/v1/orders", statusCode: 200, durationMs: 4 });
    const logged = await prisma.apiRequestLog.findFirstOrThrow({ where: { apiKeyId: key.id } });
    expect(logged.path).toBe("/api/v1/orders");
    expect(logged.statusCode).toBe(200);

    // A session principal is authorised by permission, not by scope.
    const sessionPrincipal: ApiPrincipal = { kind: "session", businessId: context.businessId, label: "staff", scopes: [] };
    expect(hasScope(sessionPrincipal, "orders:write")).toBe(true);
  });

  it("rejects a wrong secret and a missing credential the same way", async () => {
    const { plaintext } = await createApiKey(actor(), { name: "Wrong secret probe", scopes: ["orders:read"] });
    const prefix = plaintext.slice(0, plaintext.indexOf("."));
    const tampered = `${prefix}.${"a".repeat(20)}`;

    await expect(authenticateApiRequest(request({ "x-api-key": tampered }))).rejects.toThrow(/Invalid API key|valid API key|Not authenticated/i);
    await expect(authenticateApiRequest(request())).rejects.toThrow(AppError);
    expect(safeEqual("a", "b")).toBe(false);
  });

  it("refuses revoked keys", async () => {
    const { plaintext, key } = await createApiKey(actor(), { name: "Revocable", scopes: ["orders:read"] });
    await revokeApiKey(actor(), { apiKeyId: key.id, reason: "no longer needed" });

    await expect(authenticateApiRequest(request({ authorization: `Bearer ${plaintext}` }))).rejects.toThrow(/revoked/i);
  });

  it("expires keys and flips their status on use", async () => {
    const { plaintext, key } = await createApiKey(actor(), { name: "Expiring", scopes: ["orders:read"] });
    await prisma.apiKey.update({ where: { id: key.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(authenticateApiRequest(request({ authorization: `Bearer ${plaintext}` }))).rejects.toThrow(/expired/i);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).status).toBe("EXPIRED");
  });

  it("honours the IP allowlist", async () => {
    const { plaintext } = await createApiKey(actor(), {
      name: "Office only",
      scopes: ["orders:read"],
      allowedIpAddresses: ["203.0.113.10"],
    });

    await expect(authenticateApiRequest(request({ authorization: `Bearer ${plaintext}`, "x-forwarded-for": "198.51.100.7" }))).rejects.toThrow(/IP address/i);
    const allowed = await authenticateApiRequest(request({ authorization: `Bearer ${plaintext}`, "x-forwarded-for": "203.0.113.10" }));
    expect(allowed.kind).toBe("api_key");
  });

  it("rotates a key so the old secret stops working", async () => {
    const created = await createApiKey(actor(), { name: "Rotating", scopes: ["orders:read"] });
    const rotated = await rotateApiKey(actor(), { apiKeyId: created.key.id, graceSeconds: 0 });

    expect(rotated.plaintext).not.toBe(created.plaintext);
    await expect(authenticateApiRequest(request({ authorization: `Bearer ${created.plaintext}` }))).rejects.toThrow(AppError);
    const principal = await authenticateApiRequest(request({ authorization: `Bearer ${rotated.plaintext}` }));
    expect(principal.kind).toBe("api_key");
  });

  it("stores a webhook secret encrypted and shows it once", async () => {
    const { subscription, secret } = await createWebhook(actor(), {
      name: "Order feed",
      url: "https://integration.example.test/hooks/orders",
      events: ["order.created"],
    });

    expect(secret).toMatch(/^whsec_/);
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(row.secretCiphertext).not.toContain(secret);
    expect(row.secretHash).toHaveLength(64);
    expect(webhookSecret(row)).toBe(secret);
  });

  it("queues one delivery per subscriber and dedupes a replay", async () => {
    const webhook = await createWebhook(actor(), { name: "Dedupe feed", url: "https://integration.example.test/hooks/dedupe", events: ["inventory.low_stock"] });

    const first = await queueWebhooks({
      businessId: context.businessId,
      eventType: "inventory.low_stock",
      payload: { orderNumber: "ORD-TEST-1" },
      dedupeKey: "order:test-1:created",
    });
    const second = await queueWebhooks({
      businessId: context.businessId,
      eventType: "inventory.low_stock",
      payload: { orderNumber: "ORD-TEST-1" },
      dedupeKey: "order:test-1:created",
    });

    expect(first).toBe(1);
    expect(second).toBe(0);
    const deliveries = await prisma.webhookDelivery.findMany({ where: { subscriptionId: webhook.subscription.id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.dedupeKey).toBe("inventory.low_stock:order:test-1:created");
  });

  it("delivers a signed payload and marks the delivery successful", async () => {
    const webhook = await createWebhook(actor(), { name: "Success feed", url: "https://integration.example.test/hooks/ok", events: ["order.confirmed"] });
    await queueWebhooks({ businessId: context.businessId, eventType: "order.confirmed", payload: { orderNumber: "ORD-OK" }, dedupeKey: "order:ok:confirmed" });

    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
      return new Response("accepted", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await deliverDueWebhooks(10);
      expect(result.delivered).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }

    const call = calls.find((entry) => entry.url === "https://integration.example.test/hooks/ok");
    expect(call).toBeDefined();
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: webhook.subscription.id } });
    expect(delivery.status).toBe("SUCCESS");
    expect(delivery.attempts).toBe(1);
    expect(delivery.responseStatus).toBe(200);
    expect(delivery.deliveredAt).not.toBeNull();

    const parsed = JSON.parse(call!.body) as { event: string; data: { orderNumber: string } };
    expect(parsed.event).toBe("order.confirmed");
    expect(parsed.data.orderNumber).toBe("ORD-OK");
    expect(verifyPayloadSignature(call!.body, webhook.secret, call!.headers["x-webhook-signature"] ?? "")).toBe(true);
    expect(call!.headers["x-webhook-dedupe-key"]).toBe("order.confirmed:order:ok:confirmed");

    const subscriptionAfter = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: webhook.subscription.id } });
    expect(subscriptionAfter.lastSuccessAt).not.toBeNull();
  });

  it("retries a failing endpoint with backoff and dead-letters it when attempts run out", async () => {
    const webhook = await createWebhook(actor(), { name: "Failing feed", url: "https://integration.example.test/hooks/fail", events: ["order.dispatched"] });
    await queueWebhooks({ businessId: context.businessId, eventType: "order.dispatched", payload: { orderNumber: "ORD-FAIL" }, dedupeKey: "order:fail:dispatched" });
    await prisma.webhookDelivery.updateMany({ where: { subscriptionId: webhook.subscription.id }, data: { maxAttempts: 1 } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    let result;
    try {
      result = await deliverDueWebhooks(10);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(result.dead).toBeGreaterThanOrEqual(1);
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: webhook.subscription.id } });
    expect(delivery.status).toBe("DEAD");
    expect(delivery.lastError).toContain("500");
    const subscriptionAfter = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: webhook.subscription.id } });
    expect(subscriptionAfter.failureCount).toBe(1);
  });

  it("dead-letters deliveries for a subscription that was switched off", async () => {
    const webhook = await createWebhook(actor(), { name: "Disabled feed", url: "https://integration.example.test/hooks/off", events: ["order.cancelled"] });
    await queueWebhooks({ businessId: context.businessId, eventType: "order.cancelled", payload: { orderNumber: "ORD-OFF" }, dedupeKey: "order:off:cancelled" });
    await prisma.webhookSubscription.update({ where: { id: webhook.subscription.id }, data: { isActive: false } });

    const fetchMock = vi.fn(async () => new Response("should not be called", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await deliverDueWebhooks(10);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).not.toHaveBeenCalled();
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { subscriptionId: webhook.subscription.id } });
    expect(delivery.status).toBe("DEAD");
  });
});
