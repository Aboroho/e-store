import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { apiKeyPrefix, encryptSecret, generateApiKey, generateToken, hashApiKey, maskSecret, signPayload, decryptSecret } from "@/lib/crypto";
import { createWebhookSchema, createApiKeySchema, revokeApiKeySchema, rotateApiKeySchema, updateWebhookSchema } from "./schemas";
import { isWebhookEvent } from "./scopes";

/**
 * API keys and webhooks.
 *
 * The plaintext secret is returned exactly once, at creation: only its SHA-256 hash is
 * stored, so a database dump cannot be replayed against the API. Webhook signing secrets
 * are encrypted at rest (AES-256-GCM) because the server must be able to reproduce the
 * HMAC signature on every delivery.
 */

export interface ApiKeyActor {
  businessId: string;
  userId: string;
  actorLabel: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  keyPreview: string;
  status: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  allowedIpAddresses: string[];
  createdAt: Date;
  revokedAt: Date | null;
}

function toView(key: {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  lastFour: string | null;
  status: string;
  rateLimitPerMinute: number;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  allowedIpAddresses: string[];
  createdAt: Date;
  revokedAt: Date | null;
  scopes: Array<{ scope: string }>;
}): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    description: key.description,
    keyPrefix: key.keyPrefix,
    keyPreview: `${key.keyPrefix}…${key.lastFour ?? "****"}`,
    status: key.status,
    scopes: key.scopes.map((scope) => scope.scope),
    rateLimitPerMinute: key.rateLimitPerMinute,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    usageCount: key.usageCount,
    allowedIpAddresses: key.allowedIpAddresses,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

export async function listApiKeys(businessId: string): Promise<ApiKeyView[]> {
  const keys = await prisma.apiKey.findMany({
    where: { businessId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { scopes: true },
  });
  return keys.map(toView);
}

export async function getApiKey(businessId: string, apiKeyId: string) {
  const key = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, businessId },
    include: { scopes: true, webhookSubscriptions: { orderBy: { createdAt: "desc" } } },
  });
  if (!key) throw AppError.notFound("API key not found");
  return key;
}

/** Create a key: the plaintext is returned once and never stored. */
export async function createApiKey(actor: ApiKeyActor, input: unknown) {
  const parsed = createApiKeySchema.parse(input);

  const generated = generateApiKey();
  const key = await prisma.apiKey.create({
    data: {
      businessId: actor.businessId,
      name: parsed.name,
      description: parsed.description ?? null,
      keyPrefix: await uniquePrefix(generated.prefix),
      keyHash: generated.hash,
      lastFour: generated.lastFour,
      status: "ACTIVE",
      rateLimitPerMinute: parsed.rateLimitPerMinute,
      expiresAt: parsed.expiresAt ?? null,
      allowedIpAddresses: parsed.allowedIpAddresses,
      createdByUserId: actor.userId,
      scopes: { create: parsed.scopes.map((scope) => ({ scope })) },
    },
    include: { scopes: true },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "ApiKey",
    entityId: key.id,
    action: "api_key.created",
    summary: `Created API key "${key.name}" with scopes ${parsed.scopes.join(", ")}`,
  });

  return { key: toView(key), plaintext: generated.plaintext };
}

async function uniquePrefix(prefix: string): Promise<string> {
  let candidate = prefix;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.apiKey.findFirst({ where: { keyPrefix: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = apiKeyPrefix(`${prefix.slice(0, 8)}.${generateToken(6).replace(/[-_]/g, "")}`) ?? prefix;
  }
  throw AppError.conflict("Could not allocate a unique key prefix");
}

export async function revokeApiKey(actor: ApiKeyActor, input: unknown) {
  const parsed = revokeApiKeySchema.parse(input);
  const key = await prisma.apiKey.findFirst({ where: { id: parsed.apiKeyId, businessId: actor.businessId } });
  if (!key) throw AppError.notFound("API key not found");
  if (key.status === "REVOKED") throw AppError.invalidState("This key is already revoked");

  const updated = await prisma.apiKey.update({
    where: { id: key.id },
    data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: actor.userId, revokedReason: parsed.reason },
    include: { scopes: true },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "ApiKey",
    entityId: key.id,
    action: "api_key.revoked",
    summary: `Revoked API key "${key.name}": ${parsed.reason}`,
  });

  return toView(updated);
}

/**
 * Rotate a key: a new secret is issued immediately and the old one is revoked (after an
 * optional grace period) so a client can roll over without downtime.
 */
export async function rotateApiKey(actor: ApiKeyActor, input: unknown) {
  const parsed = rotateApiKeySchema.parse(input);
  const key = await prisma.apiKey.findFirst({ where: { id: parsed.apiKeyId, businessId: actor.businessId }, include: { scopes: true } });
  if (!key) throw AppError.notFound("API key not found");
  if (key.status === "REVOKED") throw AppError.invalidState("Revoked keys cannot be rotated");

  const generated = generateApiKey();
  const replacement = await prisma.$transaction(async (tx) => {
    const created = await tx.apiKey.create({
      data: {
        businessId: actor.businessId,
        name: `${key.name} (rotated)`,
        description: key.description,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        lastFour: generated.lastFour,
        status: "ACTIVE",
        rateLimitPerMinute: key.rateLimitPerMinute,
        expiresAt: key.expiresAt,
        allowedIpAddresses: key.allowedIpAddresses,
        createdByUserId: actor.userId,
        rotatedFromKeyId: key.id,
        scopes: { create: key.scopes.map((scope) => ({ scope: scope.scope })) },
      },
      include: { scopes: true },
    });

    if (parsed.gracePeriodSeconds <= 0) {
      await tx.apiKey.update({
        where: { id: key.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: actor.userId, revokedReason: "Rotated" },
      });
    }
    return created;
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "ApiKey",
    entityId: replacement.id,
    action: "api_key.rotated",
    summary: `Rotated API key "${key.name}"`,
  });

  return {
    key: toView(replacement),
    plaintext: generated.plaintext,
    previousKeyId: key.id,
    note: parsed.gracePeriodSeconds > 0 ? `The old key stays valid for ${parsed.gracePeriodSeconds}s — revoke it manually after the rollover.` : "The previous key was revoked immediately.",
  };
}

/** Requests made with a key (newest first) — the audit trail for integrators. */
export async function apiKeyUsage(businessId: string, apiKeyId: string, limit = 100) {
  const key = await prisma.apiKey.findFirst({ where: { id: apiKeyId, businessId }, select: { id: true } });
  if (!key) throw AppError.notFound("API key not found");
  return prisma.apiRequestLog.findMany({ where: { apiKeyId: key.id }, orderBy: { createdAt: "desc" }, take: Math.min(500, limit) });
}

// --------------------------------------------------------------- webhooks

export interface WebhookActor extends ApiKeyActor {}

export async function listWebhooks(businessId: string) {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { deliveries: true } }, apiKey: { select: { id: true, name: true } } },
  });
  return subscriptions.map((subscription) => ({
    id: subscription.id,
    name: subscription.name,
    url: subscription.url,
    events: subscription.events,
    isActive: subscription.isActive,
    failureCount: subscription.failureCount,
    lastSuccessAt: subscription.lastSuccessAt,
    lastFailureAt: subscription.lastFailureAt,
    createdAt: subscription.createdAt,
    deliveryCount: subscription._count.deliveries,
    apiKey: subscription.apiKey,
  }));
}

export async function createWebhook(actor: WebhookActor, input: unknown) {
  const parsed = createWebhookSchema.parse(input);
  const secret = `whsec_${generateToken(24).replace(/[-_]/g, "")}`;
  const encrypted = encryptSecret(secret);

  const subscription = await prisma.webhookSubscription.create({
    data: {
      businessId: actor.businessId,
      apiKeyId: parsed.apiKeyId ?? null,
      name: parsed.name,
      url: parsed.url,
      secretHash: hashApiKey(secret),
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      events: parsed.events,
      createdByUserId: actor.userId,
    },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "WebhookSubscription",
    entityId: subscription.id,
    action: "webhook.created",
    summary: `Webhook "${subscription.name}" → ${subscription.url} for ${parsed.events.join(", ")}`,
  });

  return { subscription, secret, secretMasked: maskSecret(secret, 4) };
}

export async function updateWebhook(actor: WebhookActor, input: unknown) {
  const parsed = updateWebhookSchema.parse(input);
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: parsed.webhookId, businessId: actor.businessId } });
  if (!subscription) throw AppError.notFound("Webhook not found");

  const updated = await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: {
      ...(parsed.isActive === undefined ? {} : { isActive: parsed.isActive, ...(parsed.isActive ? { failureCount: 0 } : {}) }),
      ...(parsed.events ? { events: parsed.events } : {}),
      ...(parsed.url ? { url: parsed.url } : {}),
    },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "WebhookSubscription",
    entityId: subscription.id,
    action: "webhook.updated",
    summary: `Updated webhook "${subscription.name}"`,
  });

  return updated;
}

export async function deleteWebhook(actor: WebhookActor, webhookId: string) {
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: webhookId, businessId: actor.businessId } });
  if (!subscription) throw AppError.notFound("Webhook not found");
  await prisma.webhookSubscription.delete({ where: { id: subscription.id } });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "WebhookSubscription",
    entityId: subscription.id,
    action: "webhook.deleted",
    summary: `Deleted webhook "${subscription.name}"`,
  });
}

export async function rotateWebhookSecret(actor: WebhookActor, webhookId: string) {
  const subscription = await prisma.webhookSubscription.findFirst({ where: { id: webhookId, businessId: actor.businessId } });
  if (!subscription) throw AppError.notFound("Webhook not found");

  const secret = `whsec_${generateToken(24).replace(/[-_]/g, "")}`;
  const encrypted = encryptSecret(secret);
  await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: { secretHash: hashApiKey(secret), secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "WebhookSubscription",
    entityId: subscription.id,
    action: "webhook.secret_rotated",
    summary: `Rotated the signing secret for "${subscription.name}"`,
  });

  return { secret, secretMasked: maskSecret(secret, 4) };
}

export async function listDeliveries(businessId: string, filter: { webhookId?: string; status?: string; limit?: number } = {}) {
  const subscriptions = await prisma.webhookSubscription.findMany({ where: { businessId }, select: { id: true } });
  const ids = subscriptions.map((subscription) => subscription.id);
  if (ids.length === 0) return [];

  return prisma.webhookDelivery.findMany({
    where: {
      subscriptionId: filter.webhookId ? filter.webhookId : { in: ids },
      ...(filter.status && filter.status !== "ALL" ? { status: filter.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, filter.limit ?? 50),
    include: { subscription: { select: { id: true, name: true, url: true } } },
  });
}

/**
 * Queue an event for every active subscription that listens to it.
 *
 * Called after the domain transaction commits, never inside it: the delivery row is the
 * durability boundary, and the worker (scripts/worker.ts) owns the HTTP call with
 * exponential backoff. `dedupeKey` is unique per subscription, so a retried service call
 * can never double-notify an integrator.
 */
export async function queueWebhooks(input: {
  businessId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Identifies the domain object (order id, shipment id, …) for deduplication. */
  dedupeKey: string;
}) {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { businessId: input.businessId, isActive: true, events: { has: input.eventType } },
    select: { id: true },
  });
  if (subscriptions.length === 0) return 0;

  const result = await prisma.webhookDelivery.createMany({
    data: subscriptions.map((subscription) => ({
      subscriptionId: subscription.id,
      eventType: input.eventType,
      payload: input.payload as never,
      dedupeKey: `${input.eventType}:${input.dedupeKey}`,
      status: "PENDING" as const,
      nextAttemptAt: new Date(),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/** Events that are queued when a subscription's endpoint is created/reset. */
export const WEBHOOK_PAYLOAD_MAX_BYTES = 64 * 1024;

/** Decrypt a subscription's signing secret (server-side only). */
export function webhookSecret(subscription: { secretCiphertext: string; secretIv: string; secretAuthTag: string }): string {
  return decryptSecret({ ciphertext: subscription.secretCiphertext, iv: subscription.secretIv, authTag: subscription.secretAuthTag });
}

/** The exact signature an integrator should verify. */
export function webhookSignature(secret: string, body: string): string {
  return `sha256=${signPayload(body, secret)}`;
}

/** Event name validation for callers that pass a string straight through. */
export function assertWebhookEvent(eventType: string) {
  if (!isWebhookEvent(eventType)) throw AppError.validation(`"${eventType}" is not a webhook event`);
  return eventType;
}
