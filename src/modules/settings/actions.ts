"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { zEmail } from "@/lib/validation";
import { z } from "zod";
import { updateBusinessProfile, updateBusinessSettings, updateStorefrontSettings } from "@/modules/settings/service";
import type { ActionState } from "@/modules/auth/action-state";

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

/** Collect only the submitted keys that match known setting names. */
function collectSettingValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  // Checkboxes are absent when unchecked, so gather known boolean keys first.
  const uncheckedBooleans = String(formData.get("__booleanKeys") ?? "")
    .split(",")
    .filter(Boolean);
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("__") || key === "storefrontId") continue;
    values[key] = String(formData.get(key) ?? "");
  }
  for (const key of uncheckedBooleans) {
    if (!(key in values)) values[key] = "false";
  }
  return values;
}

export async function updateBusinessSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertPermission(session, "settings.manage");
    const values = collectSettingValues(formData);
    const keys = await updateBusinessSettings(
      { userId: session.id, businessId: session.businessId, actorLabel: session.email },
      values,
    );
    revalidatePath("/admin/settings");
    return { status: "success", message: `${keys.length} setting(s) saved.` };
  } catch (error) {
    return toState(error, "Unable to save the settings");
  }
}

export async function updateStorefrontSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertPermission(session, "storefront.manage");
    const storefrontId = String(formData.get("storefrontId") ?? "");
    if (!storefrontId) return { status: "error", message: "Missing storefront" };
    const values = collectSettingValues(formData);
    const keys = await updateStorefrontSettings(
      { userId: session.id, businessId: session.businessId, actorLabel: session.email },
      storefrontId,
      values,
    );
    revalidatePath(`/admin/storefronts/${storefrontId}`);
    return { status: "success", message: `${keys.length} setting(s) saved.` };
  } catch (error) {
    return toState(error, "Unable to save the storefront settings");
  }
}

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const businessProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the trading name").max(160),
  logoMediaId: z.string().uuid().nullable().optional(),
  legalName: optionalText(200),
  phone: optionalText(24),
  email: optionalText(200).pipe(z.union([zEmail, z.undefined()])),
  address: optionalText(500),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a three letter ISO 4217 code")
    .optional(),
});

export async function updateBusinessProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertPermission(session, "settings.manage");

    const logoMediaId = String(formData.get("logoMediaId") ?? "");
    const parsed = businessProfileSchema.safeParse({
      name: formData.get("name"),
      legalName: formData.get("legalName") ?? undefined,
      phone: formData.get("phone") ?? undefined,
      email: formData.get("email") ?? undefined,
      address: formData.get("address") ?? undefined,
      currency: formData.get("currency") ?? undefined,
      logoMediaId: logoMediaId || null,
    });
    if (!parsed.success) {
      return {
        status: "error",
        message: "Please correct the highlighted fields",
        fieldErrors: Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0] ?? "_"), [issue.message]]),
        ),
      };
    }

    await updateBusinessProfile(
      { userId: session.id, businessId: session.businessId, actorLabel: session.email },
      {
        name: parsed.data.name,
        legalName: parsed.data.legalName ?? undefined,
        phone: parsed.data.phone ?? undefined,
        email: parsed.data.email || undefined,
        address: parsed.data.address ?? undefined,
        currency: parsed.data.currency || undefined,
        logoMediaId: parsed.data.logoMediaId ?? null,
      },
    );
    revalidatePath("/admin/settings");
    return { status: "success", message: "Business profile saved." };
  } catch (error) {
    return toState(error, "Unable to save the business profile");
  }
}
