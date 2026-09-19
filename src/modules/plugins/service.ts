import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { CORE_VERSION, PLUGIN_REGISTRY, pluginDefinition, satisfiesCore } from "./registry";

/**
 * Plugin installation state.
 *
 * The registry is the source of truth for what may exist; the database only records which
 * registered plugin is installed, what configuration it was given and whether it is
 * enabled. Installing an unknown key is impossible, and a plugin whose compatibility
 * range excludes this core version is refused rather than half-working.
 */

export interface PluginActor {
  businessId: string;
  userId: string;
  actorLabel: string;
}

export interface PluginView {
  key: string;
  name: string;
  version: string;
  author: string;
  description: string;
  trusted: boolean;
  capabilities: string[];
  permissions: string[];
  source: string;
  installed: boolean;
  status: "REGISTERED" | "ENABLED" | "DISABLED" | "INCOMPATIBLE" | "ERROR";
  isTrusted: boolean;
  config: Record<string, unknown> | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  lastError: string | null;
}

export async function listPlugins(businessId: string): Promise<PluginView[]> {
  const rows = await prisma.plugin.findMany({ where: { businessId } });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  return PLUGIN_REGISTRY.map((definition) => {
    const row = byKey.get(definition.key);
    const compatible = satisfiesCore(CORE_VERSION, definition.compatibility.core);
    return {
      key: definition.key,
      name: definition.name,
      version: definition.version,
      author: definition.author,
      description: definition.description,
      trusted: definition.trusted,
      capabilities: definition.capabilities.map((capability) => capability.label),
      permissions: definition.permissions.map((permission) => permission.key),
      source: definition.source,
      installed: Boolean(row),
      status: !compatible ? "INCOMPATIBLE" : ((row?.status as PluginView["status"]) ?? "REGISTERED"),
      isTrusted: row?.isTrusted ?? definition.trusted,
      config: (row?.config as Record<string, unknown> | null) ?? null,
      enabledAt: row?.enabledAt ?? null,
      disabledAt: row?.disabledAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}

function assertRegistered(key: string) {
  const definition = pluginDefinition(key);
  if (!definition) throw AppError.validation(`"${key}" is not a registered plugin`);
  if (!satisfiesCore(CORE_VERSION, definition.compatibility.core)) {
    throw AppError.invalidState(`${definition.name} ${definition.version} requires core ${definition.compatibility.core}; this build is ${CORE_VERSION}`);
  }
  return definition;
}

export async function installPlugin(actor: PluginActor, key: string) {
  const definition = assertRegistered(key);

  const plugin = await prisma.plugin.upsert({
    where: { businessId_key: { businessId: actor.businessId, key } },
    create: {
      businessId: actor.businessId,
      key,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      author: definition.author,
      status: "DISABLED",
      isTrusted: definition.trusted,
      capabilities: definition.capabilities.map((capability) => capability.key),
      permissions: definition.permissions.map((permission) => permission.key),
      config: {} as never,
      configSchema: definition.configSchema as never,
      compatibility: definition.compatibility as never,
      installedByUserId: actor.userId,
      disabledAt: new Date(),
    },
    update: { version: definition.version, name: definition.name },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Plugin",
    entityId: plugin.id,
    action: "plugin.installed",
    summary: `Installed ${definition.name} ${definition.version}`,
  });

  return plugin;
}

export async function setPluginEnabled(actor: PluginActor, key: string, isEnabled: boolean, config?: Record<string, unknown>) {
  const definition = assertRegistered(key);
  if (isEnabled && !definition.trusted) throw AppError.invalidState("Untrusted plugins cannot be enabled");

  const existing = await prisma.plugin.findFirst({ where: { businessId: actor.businessId, key } });
  if (!existing) throw AppError.invalidState("Install the plugin before enabling it");

  const plugin = await prisma.plugin.update({
    where: { id: existing.id },
    data: {
      status: isEnabled ? "ENABLED" : "DISABLED",
      ...(isEnabled ? { enabledAt: new Date(), disabledAt: null, lastError: null } : { disabledAt: new Date() }),
      ...(config ? { config: config as never } : {}),
    },
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Plugin",
    entityId: plugin.id,
    action: isEnabled ? "plugin.enabled" : "plugin.disabled",
    summary: `${isEnabled ? "Enabled" : "Disabled"} ${definition.name}`,
  });

  return plugin;
}

export async function updatePluginConfig(actor: PluginActor, key: string, config: Record<string, unknown>) {
  const definition = assertRegistered(key);
  const existing = await prisma.plugin.findFirst({ where: { businessId: actor.businessId, key } });
  if (!existing) throw AppError.invalidState("Install the plugin before configuring it");

  const schema = (definition.configSchema ?? {}) as { properties?: Record<string, { type?: string }> };
  const allowed = Object.keys(schema.properties ?? {});
  for (const [field, value] of Object.entries(config)) {
    if (!allowed.includes(field)) throw AppError.validation(`Unknown configuration field "${field}" for ${definition.name}`);
    const expected = schema.properties?.[field]?.type;
    if (expected === "integer" && !Number.isInteger(value)) throw AppError.validation(`${field} must be a whole number`);
    if (expected === "string" && typeof value !== "string") throw AppError.validation(`${field} must be text`);
  }

  const plugin = await prisma.plugin.update({ where: { id: existing.id }, data: { config: config as never } });
  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    entityType: "Plugin",
    entityId: plugin.id,
    action: "plugin.configured",
    summary: `Updated configuration for ${definition.name}`,
  });
  return plugin;
}

/** Enabled plugins, so the app can ask "is this capability active?" without a hard link. */
export async function enabledPlugins(businessId: string) {
  const rows = await prisma.plugin.findMany({ where: { businessId, status: "ENABLED" }, select: { key: true, version: true, capabilities: true, config: true } });
  return rows.filter((row) => pluginDefinition(row.key)?.trusted === true);
}
