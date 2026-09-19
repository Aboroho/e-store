/**
 * API scopes.
 *
 * An API key is only ever as powerful as the scopes granted to it, and every endpoint
 * demands a specific scope. A response only contains the data the granted scopes allow —
 * customer contact details, for example, require `customers:read`.
 */

export interface ScopeDefinition {
  key: string;
  group: string;
  label: string;
  description: string;
  write?: boolean;
}

export const SCOPES: ScopeDefinition[] = [
  { key: "products:read", group: "Catalogue", label: "Read products", description: "List products, variants and their storefront prices." },
  { key: "orders:read", group: "Orders", label: "Read orders", description: "List orders and read a single order with its items and shipments." },
  { key: "orders:write", group: "Orders", label: "Write orders", description: "Create orders and cancel them.", write: true },
  { key: "shipments:read", group: "Fulfilment", label: "Read shipments", description: "Read shipment tracking status and courier charges." },
  { key: "customers:read", group: "Customers", label: "Read customer details", description: "Include customer phone, email and address in responses (personal data)." },
  { key: "reports:read", group: "Reports", label: "Read reports", description: "Run reports and download PDF/XLSX exports." },
];

export const SCOPE_KEYS = SCOPES.map((scope) => scope.key);

export function scopeDefinition(key: string): ScopeDefinition | undefined {
  return SCOPES.find((scope) => scope.key === key);
}

export function scopesByGroup(): Array<{ group: string; scopes: ScopeDefinition[] }> {
  const groups = new Map<string, ScopeDefinition[]>();
  for (const scope of SCOPES) {
    const bucket = groups.get(scope.group) ?? [];
    bucket.push(scope);
    groups.set(scope.group, bucket);
  }
  return [...groups.entries()].map(([group, scopes]) => ({ group, scopes }));
}

/** Event names a webhook subscription may listen to. */
export const WEBHOOK_EVENTS = [
  "order.created",
  "order.confirmed",
  "order.dispatched",
  "order.delivered",
  "order.cancelled",
  "payment.recorded",
  "payment.refunded",
  "shipment.updated",
  "shipment.delivered",
  "review.approved",
  "reseller.payout_paid",
  "inventory.low_stock",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
