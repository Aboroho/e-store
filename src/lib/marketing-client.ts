"use client";

/**
 * Browser-side marketing helper.
 *
 * Pixel providers are injected by `MarketingPixels` and expose a global function
 * (`fbq`, `ttq`). This helper talks to those globals only — it never sees a credential,
 * because credentials live on the server, and it fires nothing before consent when the
 * integration requires consent.
 */

export const CONSENT_STORAGE_KEY = "estore.marketing.consent";
export const CONSENT_EVENT = "estore:consent-changed";
export const TRACK_EVENT = "estore:track";

export type MarketingEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase" | "Lead";

export interface TrackPayload {
  /** Stable id used for provider-side deduplication. */
  eventId?: string;
  valuePaisa?: number;
  currency?: string;
  contentIds?: string[];
  contents?: Array<{ id: string; quantity: number; pricePaisa: number }>;
}

export function hasMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "granted";
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Consent as an external store                                                */
/* -------------------------------------------------------------------------- */
/*
 * localStorage is an external system, so components read it through
 * useSyncExternalStore rather than copying it into state from an effect: the value is
 * available on the first client render, changes made in another tab are picked up, and
 * there is no render → effect → render round trip.
 */

let consentKnown = false;
let consentValue = false;
const consentListeners = new Set<() => void>();

function notifyConsentListeners() {
  for (const listener of consentListeners) listener();
}

function refreshConsentFromStorage() {
  consentValue = hasMarketingConsent();
  consentKnown = true;
  notifyConsentListeners();
}

function handleConsentEvent(event: Event) {
  consentValue = Boolean((event as CustomEvent<{ granted: boolean }>).detail?.granted);
  consentKnown = true;
  notifyConsentListeners();
}

let globalConsentListenerAttached = false;

/** Subscribe to consent changes (storage, this tab, or another tab). */
export function subscribeConsent(listener: () => void): () => void {
  consentListeners.add(listener);
  if (!globalConsentListenerAttached && typeof window !== "undefined") {
    globalConsentListenerAttached = true;
    window.addEventListener(CONSENT_EVENT, handleConsentEvent);
    window.addEventListener("storage", (event) => {
      if (event.key === CONSENT_STORAGE_KEY) refreshConsentFromStorage();
    });
  }
  return () => {
    consentListeners.delete(listener);
  };
}

/** `null` until the stored choice is known; then the visitor's decision. */
export function getConsentSnapshot(): boolean | null {
  if (typeof window === "undefined") return null;
  if (!consentKnown) refreshConsentFromStorage();
  return consentValue;
}

export function getServerConsentSnapshot(): null {
  return null;
}

export function setMarketingConsent(granted: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, granted ? "granted" : "denied");
  } catch {
    // Storage can be unavailable in private modes; the banner simply reappears.
  }
  consentKnown = true;
  consentValue = granted;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { granted } }));
}

interface PixelGlobals {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (name: string, data?: unknown) => void };
}

/** Fire one event at every pixel that is loaded. */
export function trackMarketingEvent(name: MarketingEventName, payload: TrackPayload = {}) {
  if (typeof window === "undefined") return;
  const globals = window as unknown as PixelGlobals;
  const value = payload.valuePaisa == null ? undefined : payload.valuePaisa / 100;

  try {
    if (typeof globals.fbq === "function") {
      globals.fbq("track", name, {
        ...(value === undefined ? {} : { value, currency: payload.currency ?? "BDT" }),
        ...(payload.contentIds ? { content_ids: payload.contentIds, content_type: "product" } : {}),
        ...(payload.contents ? { contents: payload.contents.map((item) => ({ id: item.id, quantity: item.quantity, item_price: item.pricePaisa / 100 })) } : {}),
        ...(payload.eventId ? { eventID: payload.eventId } : {}),
      });
    }
  } catch {
    // A failing pixel must never break the page.
  }

  try {
    if (globals.ttq && typeof globals.ttq.track === "function") {
      globals.ttq.track(name, {
        ...(value === undefined ? {} : { value, currency: payload.currency ?? "BDT" }),
        ...(payload.eventId ? { event_id: payload.eventId } : {}),
      });
    }
  } catch {
    // Same here.
  }
}
