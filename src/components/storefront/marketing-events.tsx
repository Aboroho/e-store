"use client";

import * as React from "react";
import { trackMarketingEvent } from "@/lib/marketing-client";

/**
 * Browser-side conversion events.
 *
 * Each of these fires once per mount, and only when a pixel is actually loaded — the
 * helper talks to `fbq`/`ttq`/`gtag` if they exist and does nothing otherwise, so an
 * unconfigured shop (or a visitor who declined) simply never measures. Purchase is also
 * sent from the server with the same event id, which is what the provider deduplicates on.
 */

function useOnce(callback: () => void, deps: unknown[]) {
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    callback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function TrackViewContent({ variantId, valuePaisa }: { variantId: string; valuePaisa: number }) {
  useOnce(() => trackMarketingEvent("ViewContent", { contentIds: [variantId], valuePaisa, currency: "BDT" }), [variantId, valuePaisa]);
  return null;
}

export function TrackInitiateCheckout({ variantIds, valuePaisa }: { variantIds: string[]; valuePaisa: number }) {
  useOnce(() => trackMarketingEvent("InitiateCheckout", { contentIds: variantIds, valuePaisa, currency: "BDT" }), [variantIds.join(","), valuePaisa]);
  return null;
}

export function TrackPurchase({ orderNumber, valuePaisa, variantIds }: { orderNumber: string; valuePaisa: number; variantIds: string[] }) {
  useOnce(
    () => trackMarketingEvent("Purchase", { eventId: `order:${orderNumber}:purchase`, contentIds: variantIds, valuePaisa, currency: "BDT" }),
    [orderNumber, valuePaisa],
  );
  return null;
}
