import { z } from "zod";
import { MARKETING_PROVIDERS } from "./providers";

const providerKeys = MARKETING_PROVIDERS.map((provider) => provider.key) as [string, ...string[]];

export const marketingIntegrationSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum(providerKeys),
  name: z.string().trim().min(2).max(80),
  storefrontId: z.string().uuid().nullable().optional(),
  isEnabled: z.boolean().default(false),
  consentRequired: z.boolean().default(true),
  testEventCode: z.string().trim().max(40).optional(),
  /** Public (non-secret) provider settings: ids, endpoint urls. */
  publicConfig: z.record(z.string(), z.string().max(300)).default({}),
  /** Secret settings. Write-only: they are encrypted and never read back into a form. */
  secrets: z.record(z.string(), z.string().max(2000)).default({}),
  trackProductView: z.boolean().default(true),
  trackAddToCart: z.boolean().default(true),
  trackInitiateCheckout: z.boolean().default(true),
  trackPurchase: z.boolean().default(true),
});

export const marketingEventSchema = z.object({
  eventName: z.enum(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase", "Refund", "Lead"]),
  dedupeKey: z.string().trim().min(3).max(200),
  storefrontId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  sessionId: z.string().trim().max(100).nullable().optional(),
  consentGranted: z.boolean(),
  valuePaisa: z.number().int().nonnegative().nullable().optional(),
  items: z.array(z.object({ variantId: z.string(), quantity: z.number().int().positive(), pricePaisa: z.number().int().nonnegative() })).max(100).optional(),
});

export type MarketingIntegrationInput = z.infer<typeof marketingIntegrationSchema>;
export type MarketingEventInput = z.infer<typeof marketingEventSchema>;

/** Public fields rendered into the form (no secrets) for a provider. */
export function publicFieldsFor(providerKey: string) {
  const provider = MARKETING_PROVIDERS.find((entry) => entry.key === providerKey);
  return provider?.fields.filter((field) => !field.secret) ?? [];
}

export function secretFieldsFor(providerKey: string) {
  const provider = MARKETING_PROVIDERS.find((entry) => entry.key === providerKey);
  return provider?.fields.filter((field) => field.secret) ?? [];
}
