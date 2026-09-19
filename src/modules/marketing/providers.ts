/**
 * Marketing provider registry.
 *
 * Providers are code, not data: a provider must be explicitly registered here before an
 * integration row can use it, and only providers listed here can ever receive an event.
 * Browser providers are configured with a public id and are injected into the storefront;
 * server providers additionally accept an encrypted credential (never rendered to the
 * browser) and are delivered by the worker with retries.
 */

export type MarketingProviderKey = "META_PIXEL" | "META_CONVERSIONS" | "TIKTOK_PIXEL" | "GOOGLE_ANALYTICS" | "CUSTOM";

export type MarketingEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase" | "Refund" | "Lead";

export interface ProviderField {
  key: string;
  label: string;
  /** Public fields are safe in the browser; secret fields are encrypted at rest. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  pattern?: string;
}

export interface MarketingProviderDefinition {
  key: MarketingProviderKey;
  label: string;
  description: string;
  /** Browser: injected as a pixel. Server: delivered by the worker with retries. Both: either. */
  delivery: "browser" | "server" | "both";
  fields: ProviderField[];
  events: MarketingEventName[];
  /** Providers that accept an event id use it to drop duplicate conversions. */
  supportsDedupe: boolean;
  docsUrl?: string;
}

const PIXEL_ID: ProviderField = { key: "pixelId", label: "Pixel / measurement id", secret: false, required: true, placeholder: "1234567890", pattern: "^[A-Za-z0-9_-]{4,64}$" };

export const MARKETING_PROVIDERS: MarketingProviderDefinition[] = [
  {
    key: "META_PIXEL",
    label: "Meta Pixel (browser)",
    description: "Injects the Meta Pixel into the storefront so page views, product views, add-to-cart and checkout start are measured in the browser.",
    delivery: "browser",
    fields: [PIXEL_ID],
    events: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    supportsDedupe: true,
    docsUrl: "https://developers.facebook.com/docs/meta-pixel",
  },
  {
    key: "META_CONVERSIONS",
    label: "Meta Conversions API (server)",
    description: "Sends conversion events from the server with a hashed customer id, so a browser blocker cannot hide a purchase. Each event carries an event_id for deduplication.",
    delivery: "server",
    fields: [
      { key: "pixelId", label: "Pixel / dataset id", secret: false, required: true },
      { key: "accessToken", label: "Access token", secret: true, required: true, placeholder: "EAAG…" },
    ],
    events: ["Purchase", "Refund", "Lead"],
    supportsDedupe: true,
    docsUrl: "https://developers.facebook.com/docs/marketing-api/conversions-api",
  },
  {
    key: "TIKTOK_PIXEL",
    label: "TikTok Pixel (browser)",
    description: "Injects the TikTok pixel into the storefront for browser-side measurement.",
    delivery: "browser",
    fields: [PIXEL_ID],
    events: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    supportsDedupe: true,
    docsUrl: "https://ads.tiktok.com/help/article/get-started-pixel",
  },
  {
    key: "GOOGLE_ANALYTICS",
    label: "Google Analytics 4 (server)",
    description: "Sends server-side events through the Measurement Protocol. The API secret stays encrypted on the server.",
    delivery: "server",
    fields: [
      { key: "pixelId", label: "Measurement id", secret: false, required: true, placeholder: "G-XXXXXXX" },
      { key: "apiSecret", label: "API secret", secret: true, required: true },
    ],
    events: ["Purchase", "Refund", "Lead"],
    supportsDedupe: false,
    docsUrl: "https://developers.google.com/analytics/devguides/collection/protocol/ga4",
  },
  {
    key: "CUSTOM",
    label: "Custom endpoint",
    description: "Posts the event as JSON to an https endpoint you control. The shared secret is sent as a bearer token and never leaves the server.",
    delivery: "server",
    fields: [
      { key: "endpointUrl", label: "Endpoint URL", secret: false, required: true, placeholder: "https://example.com/events" },
      { key: "sharedSecret", label: "Bearer token", secret: true, required: true },
    ],
    events: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase", "Refund", "Lead"],
    supportsDedupe: true,
  },
];

export function marketingProvider(key: string): MarketingProviderDefinition | undefined {
  return MARKETING_PROVIDERS.find((provider) => provider.key === key);
}

export function providerSupportsServerDelivery(key: string): boolean {
  const provider = marketingProvider(key);
  return provider?.delivery === "server" || provider?.delivery === "both";
}

export function providerSupportsBrowserPixel(key: string): boolean {
  const provider = marketingProvider(key);
  return provider?.delivery === "browser" || provider?.delivery === "both";
}

/** Providers whose public fields may be handed to the storefront. */
export function browserConfigFor(providerKey: string, config: Record<string, unknown> | null | undefined): Record<string, string> | null {
  const provider = marketingProvider(providerKey);
  if (!provider || !providerSupportsBrowserPixel(providerKey)) return null;
  const out: Record<string, string> = {};
  for (const field of provider.fields.filter((entry) => !entry.secret)) {
    const value = config?.[field.key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (field.pattern && !new RegExp(field.pattern).test(value)) continue;
    out[field.key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** `Purchase` payload for a server provider. Amounts stay integer paisa. */
export function serverEventPayload(input: {
  eventName: MarketingEventName;
  dedupeKey: string;
  orderId?: string | null;
  orderNumber?: string | null;
  amountPaisa?: number | null;
  currency?: string;
  /** Already hashed — raw contact details never leave the server. */
  hashedCustomerId?: string | null;
  customerCountry?: string | null;
  items?: Array<{ id: string; quantity: number; pricePaisa: number }>;
}): Record<string, unknown> {
  return {
    event_name: input.eventName,
    event_id: input.dedupeKey,
    event_time: Math.floor(Date.now() / 1000),
    order_id: input.orderId ?? null,
    order_number: input.orderNumber ?? null,
    currency: input.currency ?? "BDT",
    value: input.amountPaisa == null ? null : input.amountPaisa / 100,
    value_paisa: input.amountPaisa ?? null,
    user_data: input.hashedCustomerId
      ? {
          external_id: input.hashedCustomerId,
          ...(input.customerCountry ? { country: input.customerCountry } : {}),
        }
      : null,
    contents: (input.items ?? []).map((item) => ({ id: item.id, quantity: item.quantity, item_price: item.pricePaisa / 100 })),
  };
}
