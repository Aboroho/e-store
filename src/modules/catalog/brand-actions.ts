"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/action-state";
import { brandInputSchema, createBrand, deleteBrand, updateBrand } from "@/modules/catalog/brands";

/** Brand management shares the catalog-taxonomy permission with categories. */
async function brandActor() {
  const session = await requireSession();
  assertPermission(session, "category.manage");
  return { userId: session.id, businessId: session.businessId, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Brand action failed", error);
  return { status: "error", message: fallback };
}

export async function createBrandAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await brandActor();
  } catch (error) {
    return toState(error, "You are not allowed to manage brands");
  }
  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(
      brandInputSchema,
      { ...raw, slug: raw.slug || undefined, logoMediaId: raw.logoMediaId || undefined, isActive: raw.isActive === "on" },
      "Create brand",
    );
    await createBrand(context, parsed);
    revalidatePath("/admin/catalog/brands");
    return { status: "success", message: "Brand created." };
  } catch (error) {
    return toState(error, "Unable to create the brand");
  }
}

export async function updateBrandAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await brandActor();
  } catch (error) {
    return toState(error, "You are not allowed to manage brands");
  }
  try {
    const raw = formDataToObject(formData);
    const brandId = String(raw.brandId ?? "");
    const parsed = parseInput(
      brandInputSchema.partial(),
      {
        ...raw,
        slug: raw.slug || undefined,
        logoMediaId: raw.logoMediaId === undefined ? undefined : String(raw.logoMediaId) || null,
        isActive: raw.isActive === "on",
      },
      "Update brand",
    );
    await updateBrand(context, brandId, parsed);
    revalidatePath("/admin/catalog/brands");
    return { status: "success", message: "Brand saved." };
  } catch (error) {
    return toState(error, "Unable to save the brand");
  }
}

export async function deleteBrandAction(brandId: string): Promise<void> {
  const context = await brandActor();
  await deleteBrand(context, brandId);
  revalidatePath("/admin/catalog/brands");
}
