import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { decryptSecret, encryptSecret, hashApiKey } from "@/lib/crypto";
import { logger } from "@/lib/logging";
import { getBusinessSettings } from "@/lib/settings";
import { marketingIntegrationSchema, marketingEventSchema } from "./schemas";
import { browserConfigFor, marketingProvider, providerSupportsServerDelivery, serverEventPayload, type MarketingEventName } from "./providers";

/**
 * Marketing integrations.
 *
 * Three rules drive the design:
 *
 *  1. server credentials never reach the browser — public ids are read from `config`,
 *     secrets live encrypted in `IntegrationSecret`;
 *  2. nothing is sent without consent when the integration requires it (events are
 *     recorded as skipped instead), and payloads carry a hashed customer id, never a
 *     phone number or an email address;
 *  3. every event carries a deterministic dedupe key, so a retry or a double call site
 *     cannot double-count a conversion.
 */

export interface MarketingActor {
  businessId: string;
  userId: string;
  actorLabel: string;
}

export interface MarketingIntegrationView {
  id: string;
  provider: string;
  providerLabel: string;
  name: string;
  storefrontId: string | null;
  isEnabled: boolean;
  consentRequired: boolean;
  publicConfig: Record<string, string>;
  hasSecrets: boolean;
  secretKeys: string[];
  delivery: "browser" | "server" | "both";
  testEventCode: string | null;
  eventCount: number;
  lastEventAt: Date | null;
  createdAt: Date;
}

async function toView(integration: {
  id: string;
  provider: string;
  name: string;
  storefrontId: string | null;
  isEnabled: boolean;
  consentRequired: boolean;
  config: unknown;
  testEventCode: string | null;
  createdAt: Date;
  _count?: { events: number };
  secrets?: Array<{ key: string }>;
}): Promise<MarketingIntegrationView> {
  const provider = marketingProvider(integration.provider);
  const config = (integration.config as Record<string, unknown> | null) ?? {};
  const publicConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") publicConfig[key] = value;
  }

  return {
    id: integration.id,
    provider: integration.provider,
    providerLabel: provider?.label ?? integration.provider,
    name: integration.name,
    storefrontId: integration.storefrontId,
    isEnabled: integration.isEnabled,
    consentRequired: integration.consentRequired,
    publicConfig,
    hasSecrets: (integration.secrets?.length ?? 0) > 0,
    secretKeys: (integration.secrets ?? []).map((secret) => secret.key),
    delivery: provider?.delivery ?? "server",
    testEventCode: integration.testEventCode,
    eventCount: integration._count?.events ?? 0,
    lastEventAt: null,
    createdAt: integration.createdAt,
  };
}

export async function listMarketingIntegrations(businessId: string): Promise<MarketingIntegrationView[]> {
  const integrations = await prisma.marketingIntegration.findMany({
    where: { businessId },
    orderBy: [{ isEnabled: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { events: true } } },
  });

  const integrationIds = integrations.map((integration) => integration.integrationId).filter((id): id is string => Boolean(id));
  const secrets = integrationIds.length
    ? await prisma.integrationSecret.findMany({ where: { integrationId: { in: integrationIds } }, select: { integrationId: true, key: true } })
    : [];

  return Promise.all(
    integrations.map((integration) =>
      toView({
        ...integration,
        secrets: secrets.filter((secret) => secret.integrationId === integration.integrationId).map((secret) => ({ key: secret.key })),
      }),
    ),
  );
}

export async function getMarketingIntegration(businessId: string, integrationId: string) {
  const integration = await prisma.marketingIntegration.findFirst({ where: { id: integrationId, businessId } });
  if (!integration) throw AppError.notFound("Marketing integration not found");
  const secrets = integration.integrationId
    ? await prisma.integrationSecret.findMany({ where: { integrationId: integration.integrationId }, select: { key: true, updatedAt: true } })
    : [];
  return { ...integration, secrets };
}

/** The only values a storefront may see: public provider ids. */
export async function storefrontMarketingPixels(businessId: string, storefrontId: string | null) {
  const integrations = await prisma.marketingIntegration.findMany({
    where: {
      businessId,
      isEnabled: true,
      provider: { in: ["META_PIXEL", "TIKTOK_PIXEL"] },
      OR: [{ storefrontId }, { storefrontId: null }],
    },
    select: { id: true, provider: true, config: true, consentRequired: true },
  });

  return integrations
    .map((integration) => {
      const config = browserConfigFor(integration.provider, (integration.config as Record<string, unknown> | null) ?? {});
      if (!config) return null;
      return { id: integration.id, provider: integration.provider, config, consentRequired: integration.consentRequired };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function saveMarketingIntegration(actor: MarketingActor, input: unknown) {
  const parsed = marketingIntegrationSchema.parse(input);
  const provider = marketingProvider(parsed.provider);
  if (!provider) throw AppError.validation(`Unknown provider "${parsed.provider}"`);

  const requiredPublic = provider.fields.filter((field) => !field.secret && field.required);
  for (const field of requiredPublic) {
    if (!parsed.publicConfig[field.key]) throw AppError.validation(`${field.label} is required`);
  }

  const data = {
    businessId: actor.businessId,
    provider: parsed.provider as never,
    name: parsed.name,
    storefrontId: parsed.storefrontId ?? null,
    isEnabled: parsed.isEnabled,
    consentRequired: parsed.consentRequired,
    testEventCode: parsed.testEventCode ?? null,
    config: parsed.publicConfig as never,
    trackProductView: parsed.trackProductView,
    trackAddToCart: parsed.trackAddToCart,
    trackInitiateCheckout: parsed.trackInitiateCheckout,
    trackPurchase: parsed.trackPurchase,
  };

  // Credentials hang off an `Integration` row (AES-256-GCM encrypted); the marketing
  // row only points at it, so no secret can ever end up in `config`.
  const scopeKey = parsed.storefrontId ?? "";
  const linked = await prisma.integration.upsert({
    where: { businessId_kind_provider_scopeKey: { businessId: actor.businessId, kind: "MARKETING", provider: parsed.provider, scopeKey } },
    create: {
      businessId: actor.businessId,
      storefrontId: parsed.storefrontId ?? null,
      kind: "MARKETING",
      provider: parsed.provider,
      name: parsed.name,
      scopeKey,
      isEnabled: parsed.isEnabled,
      createdByUserId: actor.userId,
    },
    update: { name: parsed.name, isEnabled: parsed.isEnabled },
  });

  // A compound unique that includes a nullable column cannot be used as a Prisma
  // unique filter, so the existing row is looked up explicitly.
  const existing = parsed.id
    ? await prisma.marketingIntegration.findFirst({ where: { id: parsed.id, businessId: actor.businessId } })
    : await prisma.marketingIntegration.findFirst({
        where: { businessId: actor.businessId, provider: parsed.provider as never, storefrontId: parsed.storefrontId ?? null },
      });

  const integration = existing
    ? await prisma.marketingIntegration.update({ where: { id: existing.id }, data: { ...data, integrationId: linked.id } })
    : await prisma.marketingIntegration.create({ data: { ...data, integrationId: linked.id, createdByUserId: actor.userId } });

  // Secrets are write-only: an empty box keeps the stored value.
  const secrets = Object.entries(parsed.secrets).filter(([, value]) => value.length > 0);
  for (const [key, value] of secrets) {
    const field = provider.fields.find((entry) => entry.key === key);
    if (!field?.secret) continue;
    const encrypted = encryptSecret(value);
    await prisma.integrationSecret.upsert({
      where: { integrationId_key: { integrationId: linked.id, key } },
      create: {
        integrationId: linked.id,
        key,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        description: field.label,
        updatedByUserId: actor.userId,
        lastRotatedAt: new Date(),
      },
      update: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        updatedByUserId: actor.userId,
        lastRotatedAt: new Date(),
      },
    });
  }

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MarketingIntegration",
    entityId: integration.id,
    action: parsed.id ? "marketing.updated" : "marketing.created",
    summary: `${parsed.id ? "Updated" : "Configured"} ${provider.label} (${integration.name})${secrets.length > 0 ? `, rotated ${secrets.length} credential(s)` : ""}`,
  });

  return integration;
}

export async function setMarketingEnabled(actor: MarketingActor, integrationId: string, isEnabled: boolean) {
  const integration = await prisma.marketingIntegration.findFirst({ where: { id: integrationId, businessId: actor.businessId } });
  if (!integration) throw AppError.notFound("Marketing integration not found");

  if (isEnabled && providerSupportsServerDelivery(integration.provider)) {
    const requiredSecrets = (marketingProvider(integration.provider)?.fields ?? []).filter((field) => field.secret && field.required);
    const stored = integration.integrationId
      ? await prisma.integrationSecret.findMany({ where: { integrationId: integration.integrationId }, select: { key: true } })
      : [];
    const missing = requiredSecrets.filter((field) => !stored.some((secret) => secret.key === field.key));
    if (missing.length > 0) throw AppError.invalidState(`Add the ${missing.map((field) => field.label).join(", ")} before enabling this integration`);
  }

  const updated = await prisma.marketingIntegration.update({ where: { id: integration.id }, data: { isEnabled } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MarketingIntegration",
    entityId: integration.id,
    action: isEnabled ? "marketing.enabled" : "marketing.disabled",
    summary: `${isEnabled ? "Enabled" : "Disabled"} ${integration.name}`,
  });
  return updated;
}

export async function deleteMarketingIntegration(actor: MarketingActor, integrationId: string) {
  const integration = await prisma.marketingIntegration.findFirst({ where: { id: integrationId, businessId: actor.businessId } });
  if (!integration) throw AppError.notFound("Marketing integration not found");
  await prisma.marketingIntegration.delete({ where: { id: integration.id } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "MarketingIntegration",
    entityId: integration.id,
    action: "marketing.deleted",
    summary: `Deleted ${integration.name}`,
  });
}

// ------------------------------------------------------------------- events

/**
 * Queue a server-side marketing event for every enabled integration that both listens
 * to it and can deliver it server-side. Consent is evaluated first: a skipped event is
 * still recorded, so support can answer "why did my conversion not appear?".
 */
export async function queueMarketingEvent(actor: { businessId: string }, input: unknown) {
  const parsed = marketingEventSchema.parse(input);

  const integrations = await prisma.marketingIntegration.findMany({
    where: {
      businessId: actor.businessId,
      isEnabled: true,
      OR: [{ storefrontId: parsed.storefrontId ?? null }, { storefrontId: null }],
      ...(parsed.storefrontId ? {} : {}),
    },
  });

  const serverCapable = integrations.filter((integration) => providerSupportsServerDelivery(integration.provider));
  if (serverCapable.length === 0) return { queued: 0, skipped: 0 };

  const hashedCustomerId = parsed.customerId ? hashApiKey(parsed.customerId) : null;
  const settings = await getBusinessSettings(actor.businessId);
  const currency = typeof settings["finance.currency"] === "string" ? (settings["finance.currency"] as string) : "BDT";

  const payload = serverEventPayload({
    eventName: parsed.eventName as MarketingEventName,
    dedupeKey: parsed.dedupeKey,
    orderId: parsed.orderId ?? null,
    amountPaisa: parsed.valuePaisa ?? null,
    currency,
    hashedCustomerId,
    items: parsed.items?.map((item) => ({ id: item.variantId, quantity: item.quantity, pricePaisa: item.pricePaisa })),
  });

  let queued = 0;
  let skipped = 0;

  for (const integration of serverCapable) {
    const consentOk = !integration.consentRequired || parsed.consentGranted;
    const status = consentOk ? ("PENDING" as const) : ("SKIPPED_NO_CONSENT" as const);

    const result = await prisma.marketingEvent.createMany({
      data: [
        {
          businessId: actor.businessId,
          marketingIntegrationId: integration.id,
          storefrontId: parsed.storefrontId ?? null,
          eventName: parsed.eventName,
          dedupeKey: parsed.dedupeKey,
          customerId: parsed.customerId ?? null,
          orderId: parsed.orderId ?? null,
          sessionId: parsed.sessionId ?? null,
          consentGranted: consentOk,
          status,
          payload: payload as never,
          nextAttemptAt: consentOk ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    });

    if (result.count === 0) {
      if (consentOk) {
        // The visitor may have declined and later changed their mind: a previously skipped
        // row is promoted instead of staying blocked by the dedupe key forever.
        const promoted = await prisma.marketingEvent.updateMany({
          where: { marketingIntegrationId: integration.id, dedupeKey: parsed.dedupeKey, status: "SKIPPED_NO_CONSENT" },
          data: { status: "PENDING", consentGranted: true, nextAttemptAt: new Date(), payload: payload as never },
        });
        if (promoted.count > 0) {
          queued += 1;
          continue;
        }
      }
      continue;
    }
    if (consentOk) queued += 1;
    else skipped += 1;
  }

  if (queued > 0) logger.info("marketing.event_queued", { eventName: parsed.eventName, queued, skipped });
  return { queued, skipped };
}

/** Coarse delivery counters for the admin screen. */
export async function marketingEventStats(businessId: string) {
  const rows = await prisma.marketingEvent.groupBy({
    by: ["status"],
    where: { businessId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row._count?._all ?? 0;
  return {
    pending: counts.PENDING ?? 0,
    sent: counts.SENT ?? 0,
    failed: counts.FAILED ?? 0,
    skippedNoConsent: counts.SKIPPED_NO_CONSENT ?? 0,
    discarded: counts.DISCARDED ?? 0,
    total: Object.values(counts).reduce((total, value) => total + value, 0),
  };
}

export async function listMarketingEvents(businessId: string, filter: { status?: string; limit?: number } = {}) {
  return prisma.marketingEvent.findMany({
    where: { businessId, ...(filter.status && filter.status !== "ALL" ? { status: filter.status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, filter.limit ?? 50),
    include: { integration: { select: { id: true, name: true, provider: true } } },
  });
}

/** Decrypt one credential (server-side only). */
export function integrationSecretValue(secret: { ciphertext: string; iv: string; authTag: string }): string {
  return decryptSecret({ ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag });
}

export async function integrationCredentials(integrationId: string): Promise<Record<string, string>> {
  const secrets = await prisma.integrationSecret.findMany({ where: { integrationId } });
  const out: Record<string, string> = {};
  for (const secret of secrets) {
    try {
      out[secret.key] = integrationSecretValue(secret);
    } catch (error) {
      logger.error("marketing.secret_unreadable", error, { integrationId, key: secret.key });
    }
  }
  return out;
}
