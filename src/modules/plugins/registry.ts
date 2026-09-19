/**
 * Plugin registry.
 *
 * A "plugin" in v1 is an explicitly registered, first-party extension point. Nothing is
 * executed from the database: a plugin row may only reference a key that appears in this
 * registry, and the code that implements it ships with the application. That keeps the
 * promise that an admin cannot upload and run arbitrary third-party code, while still
 * giving a clean place to add capabilities (a marketplace can be layered on later without
 * changing this contract).
 */

export interface PluginCapability {
  key: string;
  label: string;
  description: string;
}

export interface PluginPermission {
  key: string;
  label: string;
  /** Why the plugin needs it — shown to the administrator before enabling. */
  reason: string;
}

export interface PluginDefinition {
  key: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Registered plugins are trusted by definition; untrusted keys cannot be enabled. */
  trusted: boolean;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  /** JSON schema of the configuration form the plugin accepts. */
  configSchema: Record<string, unknown>;
  /** Semver range of the core the plugin was built against. */
  compatibility: { core: string };
  /** Where the code lives, for the operations screen. */
  source: string;
}

export const CORE_VERSION = "1.0.0";

const CONFIG_SCHEMA = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
});

export const PLUGIN_REGISTRY: PluginDefinition[] = [
  {
    key: "courier-steadfast",
    name: "Steadfast courier",
    version: "1.0.0",
    author: "e-store core",
    description: "Ships parcels with Steadfast and consumes their tracking webhooks.",
    trusted: true,
    capabilities: [{ key: "fulfilment.courier", label: "Courier provider", description: "Registers itself as a courier adapter." }],
    permissions: [{ key: "shipment.write", label: "Write shipments", reason: "Creates the consignment and stores the tracking code." }],
    configSchema: CONFIG_SCHEMA({
      defaultWeightGrams: { type: "integer", minimum: 100, maximum: 50000, title: "Default parcel weight (g)" },
    }),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/couriers/providers/steadfast.ts",
  },
  {
    key: "courier-pathao",
    name: "Pathao courier",
    version: "1.0.0",
    author: "e-store core",
    description: "Ships parcels with Pathao (city/zone aware) and reads their status feed.",
    trusted: true,
    capabilities: [{ key: "fulfilment.courier", label: "Courier provider", description: "Registers itself as a courier adapter." }],
    permissions: [{ key: "shipment.write", label: "Write shipments", reason: "Creates the consignment and stores the tracking code." }],
    configSchema: CONFIG_SCHEMA({
      storeId: { type: "string", title: "Pathao store id" },
      defaultWeightGrams: { type: "integer", minimum: 100, maximum: 50000, title: "Default parcel weight (g)" },
    }),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/couriers/providers/pathao.ts",
  },
  {
    key: "courier-carrybee",
    name: "CarryBee courier",
    version: "1.0.0",
    author: "e-store core",
    description: "Ships parcels with CarryBee and consumes their settlement statements.",
    trusted: true,
    capabilities: [{ key: "fulfilment.courier", label: "Courier provider", description: "Registers itself as a courier adapter." }],
    permissions: [{ key: "shipment.write", label: "Write shipments", reason: "Creates the consignment and stores the tracking code." }],
    configSchema: CONFIG_SCHEMA({
      defaultWeightGrams: { type: "integer", minimum: 100, maximum: 50000, title: "Default parcel weight (g)" },
    }),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/couriers/providers/carrybee.ts",
  },
  {
    key: "payment-bkash",
    name: "bKash payments",
    version: "1.0.0",
    author: "e-store core",
    description: "bKash checkout, callback verification and refunds.",
    trusted: true,
    capabilities: [{ key: "payment.gateway", label: "Payment gateway", description: "Adds bKash as a payment method." }],
    permissions: [{ key: "payment.write", label: "Write payments", reason: "Records the payment and its provider reference." }],
    configSchema: CONFIG_SCHEMA({
      mode: { type: "string", enum: ["sandbox", "live"], title: "Mode" },
    }),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/payments/providers/bkash.ts",
  },
  {
    key: "payment-sslcommerz",
    name: "SSLCommerz payments",
    version: "1.0.0",
    author: "e-store core",
    description: "Card and mobile-banking checkout through SSLCommerz with IPN verification.",
    trusted: true,
    capabilities: [{ key: "payment.gateway", label: "Payment gateway", description: "Adds SSLCommerz as a payment method." }],
    permissions: [{ key: "payment.write", label: "Write payments", reason: "Records the payment and its provider reference." }],
    configSchema: CONFIG_SCHEMA({
      mode: { type: "string", enum: ["sandbox", "live"], title: "Mode" },
    }),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/payments/providers/sslcommerz.ts",
  },
  {
    key: "analytics-reports",
    name: "Extended reports",
    version: "1.0.0",
    author: "e-store core",
    description: "Adds the reseller and settlement report families to the report hub.",
    trusted: true,
    capabilities: [{ key: "reporting.report", label: "Report provider", description: "Registers extra report keys." }],
    permissions: [{ key: "report.view", label: "Read reports", reason: "Builds the report queries." }],
    configSchema: CONFIG_SCHEMA({}),
    compatibility: { core: ">=1.0.0 <2.0.0" },
    source: "src/modules/reports/queries.ts",
  },
];

export function pluginDefinition(key: string): PluginDefinition | undefined {
  return PLUGIN_REGISTRY.find((plugin) => plugin.key === key);
}

export function pluginKeys(): string[] {
  return PLUGIN_REGISTRY.map((plugin) => plugin.key);
}

/** Loose semver range check — good enough for ">=x <y" style compatibility strings. */
export function satisfiesCore(version: string, range: string): boolean {
  const parse = (value: string) => {
    const parts = value.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0] as const;
  };
  const [major, minor, patch] = parse(version);
  const constraints = range.split(/\s+/).filter(Boolean);
  return constraints.every((constraint) => {
    const match = /^([<>]=?)(\d+)\.(\d+)\.(\d+)$/.exec(constraint);
    if (!match) return true;
    const operator = match[1] ?? "";
    const target: [number, number, number] = [Number(match[2] ?? 0), Number(match[3] ?? 0), Number(match[4] ?? 0)];
    const left: [number, number, number] = [major, minor, patch];
    const compare = left[0] !== target[0] ? left[0] - target[0] : left[1] !== target[1] ? left[1] - target[1] : left[2] - target[2];
    switch (operator) {
      case ">=":
        return compare >= 0;
      case ">":
        return compare > 0;
      case "<=":
        return compare <= 0;
      case "<":
        return compare < 0;
      default:
        return true;
    }
  });
}
