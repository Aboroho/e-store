"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import {
  addAttributeValue,
  archiveProduct,
  archiveVariant,
  createAttribute,
  createCategory,
  createStarterAttributes,
  deleteCategory,
  restoreProduct,
  updateCategory,
  updateVariant,
} from "@/modules/catalog/service";
import { attributeInputSchema, categoryInputSchema, variantInputSchema } from "@/modules/catalog/schemas";
import { attributeValuesFromForm } from "@/modules/catalog/attribute-form-values";
import { setPriceListItem, setPriceListItems } from "@/modules/pricing/service";
import type { ActionState } from "@/modules/auth/action-state";
import { logger } from "@/lib/logging";

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { userId: session.id, businessId: session.businessId, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [
            issue.path ?? "_",
            [issue.message ?? "Invalid value"],
          ]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Catalog action failed", error);
  return { status: "error", message: fallback };
}

/** Money fields arrive from HTML forms in BDT; the domain layer only ever sees integer paisa. */
function bdtToPaisa(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * 100);
}


export async function archiveProductAction(productId: string, reasonOrForm?: string | FormData): Promise<void> {
  const context = await actor("product.delete");
  const reason = typeof reasonOrForm === "string" ? reasonOrForm : undefined;
  await archiveProduct(context, productId, reason);
  revalidatePath("/admin/catalog/products");
  revalidatePath("/admin/bin");
  redirect("/admin/catalog/products");
}

export async function restoreProductAction(productId: string): Promise<void> {
  const context = await actor("product.update");
  await restoreProduct(context, productId);
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/products/${productId}`);
}

export async function updateVariantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("product.update");
  } catch (error) {
    return toState(error, "You are not allowed to update products");
  }

  try {
    const raw = formDataToObject(formData);
    const variantId = String(raw.variantId ?? "");
    const parsed = parseInput(
      variantInputSchema.partial({ name: true, pricePaisa: true }),
      {
        ...raw,
        pricePaisa: bdtToPaisa(raw.pricePaisa),
        compareAtPricePaisa: bdtToPaisa(raw.compareAtPricePaisa),
        costPaisa: bdtToPaisa(raw.costPaisa),
        isPreorderEnabled: raw.isPreorderEnabled === "on",
      },
      "Update variant",
    );
    await updateVariant(context, variantId, parsed);
    revalidatePath(String(raw.productPath ?? "/admin/catalog/products"));
    return { status: "success", message: "Variant saved." };
  } catch (error) {
    return toState(error, "Unable to save the variant");
  }
}

export async function archiveVariantAction(variantId: string, productId: string): Promise<void> {
  const context = await actor("product.archive");
  await archiveVariant(context, variantId);
  revalidatePath(`/admin/catalog/products/${productId}`);
}


// ------------------------------------------------------------------ categories

export async function createCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("category.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage categories");
  }

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(
      categoryInputSchema,
      {
        ...raw,
        parentId: raw.parentId || undefined,
        isActive: raw.isActive === "on",
        isFeatured: raw.isFeatured === "on",
      },
      "Create category",
    );
    await createCategory(context, parsed);
    revalidatePath("/admin/catalog/categories");
    return { status: "success", message: "Category created." };
  } catch (error) {
    return toState(error, "Unable to create the category");
  }
}

export async function updateCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("category.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage categories");
  }

  try {
    const raw = formDataToObject(formData);
    const categoryId = String(raw.categoryId ?? "");
    const parsed = parseInput(
      categoryInputSchema.partial(),
      {
        ...raw,
        parentId: raw.parentId || undefined,
        isActive: raw.isActive === "on",
        isFeatured: raw.isFeatured === "on",
      },
      "Update category",
    );
    await updateCategory(context, categoryId, parsed);
    revalidatePath("/admin/catalog/categories");
    return { status: "success", message: "Category saved." };
  } catch (error) {
    return toState(error, "Unable to save the category");
  }
}

export async function deleteCategoryAction(categoryId: string): Promise<void> {
  const context = await actor("category.manage");
  await deleteCategory(context, categoryId);
  revalidatePath("/admin/catalog/categories");
  revalidatePath("/admin/bin");
}

// ------------------------------------------------------------------ attributes

export async function createAttributeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("attribute.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage attributes");
  }

  try {
    const raw = formDataToObject(formData);
    // Values arrive as parallel arrays from the dynamic row editor: one
    // `valueTexts` input per row plus an optional `valueColors` hex input.
    const values = attributeValuesFromForm({
      texts: formData.getAll("valueTexts").map(String),
      colors: formData.getAll("valueColors").map(String),
    });

    const parsed = parseInput(
      attributeInputSchema,
      { ...raw, isVariantDefining: raw.isVariantDefining === "on", values },
      "Create attribute",
    );
    await createAttribute(context, parsed);
    revalidatePath("/admin/catalog/attributes");
    return { status: "success", message: "Attribute created." };
  } catch (error) {
    return toState(error, "Unable to create the attribute");
  }
}

export async function addAttributeValueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("attribute.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage attributes");
  }

  const raw = formDataToObject(formData);
  try {
    await addAttributeValue(context, String(raw.attributeId ?? ""), {
      value: String(raw.value ?? "").trim(),
      colorHex: raw.colorHex ? String(raw.colorHex) : undefined,
    });
    revalidatePath("/admin/catalog/attributes");
    return { status: "success", message: "Value added." };
  } catch (error) {
    return toState(error, "Unable to add the value");
  }
}

export async function createStarterAttributesAction(): Promise<void> {
  const context = await actor("attribute.manage");
  await createStarterAttributes(context);
  revalidatePath("/admin/catalog/attributes");
}

// --------------------------------------------------------------------- pricing

export async function setPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("pricing.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage prices");
  }

  const raw = formDataToObject(formData);
  const priceListId = String(raw.priceListId ?? "");
  const rows: Array<{ variantId: string; pricePaisa: number }> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("price_")) continue;
    const variantId = key.slice("price_".length);
    if (value === "" || value === undefined) continue;
    rows.push({ variantId, pricePaisa: Math.round(Number(value) * 100) });
  }

  try {
    if (rows.length === 0) return { status: "error", message: "Enter at least one price" };
    const count = await setPriceListItems(context, priceListId, rows);
    revalidatePath("/admin/catalog/price-lists");
    return { status: "success", message: `${count} price(s) saved.` };
  } catch (error) {
    return toState(error, "Unable to save the prices");
  }
}

export async function setSinglePriceAction(variantId: string, priceListId: string, pricePaisa: number): Promise<void> {
  const context = await actor("pricing.manage");
  await setPriceListItem(context, { priceListId, variantId, pricePaisa });
  revalidatePath("/admin/catalog/products");
  revalidatePath(`/admin/catalog/price-lists`);
}
