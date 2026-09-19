import "server-only";
import type { CourierProviderCode } from "@/generated/prisma/client";
import type { CourierAdapter } from "@/modules/couriers/providers/types";
import { pathaoAdapter } from "@/modules/couriers/providers/pathao";
import { steadfastAdapter } from "@/modules/couriers/providers/steadfast";
import { carrybeeAdapter } from "@/modules/couriers/providers/carrybee";

/**
 * Provider registry.
 *
 * `MANUAL` providers (hand delivery, own rider) have no adapter: shipments stay
 * in our own status lifecycle and staff move them forward by hand.
 */

const ADAPTERS: Partial<Record<CourierProviderCode, CourierAdapter>> = {
  PATHAO: pathaoAdapter,
  STEADFAST: steadfastAdapter,
  CARRYBEE: carrybeeAdapter,
};

export function getCourierAdapter(code: CourierProviderCode): CourierAdapter | null {
  return ADAPTERS[code] ?? null;
}

export function requireCourierAdapter(code: CourierProviderCode): CourierAdapter {
  const adapter = getCourierAdapter(code);
  if (!adapter) throw new Error(`No courier adapter is registered for ${code}`);
  return adapter;
}

export function listCourierAdapters(): Array<{ code: CourierProviderCode; label: string; credentialKeys: string[] }> {
  return Object.values(ADAPTERS).map((adapter) => ({
    code: adapter!.code,
    label: adapter!.label,
    credentialKeys: adapter!.credentialKeys,
  }));
}
