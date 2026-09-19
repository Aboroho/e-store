"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { installPlugin, setPluginEnabled, updatePluginConfig } from "./service";
import { pluginDefinition } from "./registry";

/** Plugin actions. Only registered keys can ever be installed or enabled. */

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? "_", [issue.message ?? "Invalid value"]]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Plugin action failed", error);
  return { status: "error", message: fallback };
}

function revalidate() {
  revalidatePath("/admin/plugins");
}

export async function installPluginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("plugin.manage");
    const raw = formDataToObject(formData);
    const definition = pluginDefinition(String(raw["key"] ?? ""));
    if (!definition) throw AppError.validation("That plugin is not in the registry");
    await installPlugin(session, definition.key);
    revalidate();
    return { status: "success", message: `${definition.name} installed. Enable it once you have reviewed its permissions.` };
  } catch (error) {
    return toState(error, "Could not install the plugin");
  }
}

export async function setPluginEnabledAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("plugin.manage");
    const raw = formDataToObject(formData);
    const enable = String(raw["isEnabled"] ?? "") === "true";
    await setPluginEnabled(session, String(raw["key"] ?? ""), enable);
    revalidate();
    return { status: "success", message: enable ? "Plugin enabled." : "Plugin disabled — its capability stops being offered." };
  } catch (error) {
    return toState(error, "Could not change the plugin state");
  }
}

export async function configurePluginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await actor("plugin.manage");
    const raw = formDataToObject(formData);
    const key = String(raw["key"] ?? "");
    const definition = pluginDefinition(key);
    if (!definition) throw AppError.validation("That plugin is not in the registry");

    const schema = (definition.configSchema ?? {}) as { properties?: Record<string, { type?: string }> };
    const config: Record<string, unknown> = {};
    for (const field of Object.keys(schema.properties ?? {})) {
      const value = String(raw[field] ?? "").trim();
      if (!value) continue;
      const type = schema.properties?.[field]?.type;
      config[field] = type === "integer" ? Number(value) : value;
    }

    await updatePluginConfig(session, key, config);
    revalidate();
    return { status: "success", message: `${definition.name} configuration saved.` };
  } catch (error) {
    return toState(error, "Could not save the plugin configuration");
  }
}
