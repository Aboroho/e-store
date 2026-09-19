"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CONSENT_STORAGE_KEY, getConsentSnapshot, getServerConsentSnapshot, setMarketingConsent, subscribeConsent } from "@/lib/marketing-client";

/**
 * Storefront pixel integration.
 *
 * The component only ever receives public ids (validated server-side against the
 * provider's pattern) — credentials never reach the browser. Where an integration
 * requires consent, nothing is loaded until the visitor accepts; the choice is stored
 * locally and can be changed from the banner.
 */

export interface PixelConfig {
  id: string;
  provider: string;
  config: Record<string, string>;
  consentRequired: boolean;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    ttq?: { track: (name: string, data?: unknown) => void; load: (id: string) => void };
    TiktokAnalyticsObject?: string;
  }
}

function loadMetaPixel(pixelId: string) {
  if (window.fbq) return;
  const fbq = function (...args: unknown[]) {
    (fbq as unknown as { queue: unknown[] }).queue.push(args);
  } as unknown as ((...args: unknown[]) => void) & { queue: unknown[]; loaded: boolean; version: string; push: (...args: unknown[]) => void };
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.push = fbq as unknown as (...args: unknown[]) => void;
  window.fbq = fbq;
  window._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  (window.fbq as (...args: unknown[]) => void)("init", pixelId);
  (window.fbq as (...args: unknown[]) => void)("track", "PageView");
}

function loadTikTokPixel(pixelId: string) {
  if (window.ttq) {
    window.ttq.load(pixelId);
    return;
  }
  const queue: unknown[] = [];
  const stub = {
    _q: queue,
    load(id: string) {
      queue.push(["load", id]);
    },
    track(name: string, data?: unknown) {
      queue.push(["track", name, data]);
    },
  };
  window.TiktokAnalyticsObject = "ttq";
  window.ttq = stub as unknown as Window["ttq"];
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`;
  document.head.appendChild(script);
  window.ttq?.load(pixelId);
}

export function MarketingPixels({ pixels }: { pixels: PixelConfig[] }) {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot);
  const [dismissed, setDismissed] = useState(false);

  const needsConsent = pixels.some((pixel) => pixel.consentRequired);
  const allowed = pixels.filter((pixel) => !pixel.consentRequired || consent === true);

  useEffect(() => {
    for (const pixel of allowed) {
      const id = pixel.config.pixelId;
      if (!id) continue;
      if (pixel.provider === "META_PIXEL") loadMetaPixel(id);
      if (pixel.provider === "TIKTOK_PIXEL") loadTikTokPixel(id);
    }
    // `allowed` is rebuilt on every render; the pixel id set is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allowed.map((pixel) => `${pixel.provider}:${pixel.config.pixelId}`))]);

  if (pixels.length === 0) return null;

  if (needsConsent && consent === null && !dismissed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-700">
            We would like to measure how our shop is used (page views, products viewed, purchases) so we can improve it. Nothing is shared with advertising
            partners until you accept, and you can change your mind at any time.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => {
                setMarketingConsent(false);
                setDismissed(true);
              }}
            >
              Decline
            </button>
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => {
                setMarketingConsent(true);
                setDismissed(true);
              }}
            >
              Accept measurement
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsConsent && consent === true) {
    return (
      <button
        type="button"
        onClick={() => {
          setMarketingConsent(false);
          window.localStorage.removeItem(CONSENT_STORAGE_KEY);
          setDismissed(true);
        }}
        className="fixed bottom-2 left-2 z-40 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm"
      >
        Measurement on · turn off
      </button>
    );
  }

  return null;
}
