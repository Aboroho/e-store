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
  bulkUpdateVariants,
  createAttribute,
  createCategory,
  createProduct,
  createStarterAttributes,
  deleteCategory,
  restoreProduct,
  updateCategory,
  updateProduct,
  updateVariant,
} from "@/modules/catalog/service";
import { attributeInputSchema, categoryInputSchema, productInputSchema, variantInputSchema } from "@/modules/catalog/schemas";
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

/** Variants arrive as parallel arrays from the dynamic variant editor. */
function variantsFromFormData(formData: FormData) {
  const skus = formData.getAll("variantSku").map(String);
  const rows = skus.map((sku, index) => ({
    id: String(formData.getAll("variantId")[index] ?? "") || undefined,
    name: String(formData.getAll("variantName")[index] ?? "").trim() || `Variant ${index + 1}`,
    sku,
    barcode: String(formData.getAll("variantBarcode")[index] ?? "").trim() || undefined,
    pricePaisa: bdtToPaisa(formData.getAll("variantPrice")[index]) ?? 0,
    compareAtPricePaisa: bdtToPaisa(formData.getAll("variantCompareAt")[index]),
    costPaisa: bdtToPaisa(formData.getAll("variantCost")[index]),
    weightGrams: formData.getAll("variantWeight")[index] ? Number(formData.getAll("variantWeight")[index]) : undefined,
    isPreorderEnabled: formData.getAll("variantPreorder")[index] === "on",
    attributeValueIds: formData.getAll(`variantAttributes_${index}`).map(String).filter(Boolean),
  }));
  return rows;
}

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("product.create");
  } catch (error) {
    return toState(error, "You are not allowed to create products");
  }

  const raw = formDataToObject(formData);
  const parsed = parseInput(
    productInputSchema,
    {
      ...raw,
      productType: raw.productType === "VARIABLE" ? "VARIABLE" : "SIMPLE",
      requiresShipping: raw.requiresShipping === "on",
      isFeatured: raw.isFeatured === "on",
      isPreorderEnabled: raw.isPreorderEnabled === "on",
      packagingCostPaisa: bdtToPaisa(raw.packagingCostPaisa) ?? 0,
      weightGrams: raw.weightGrams === "" ? undefined : Number(raw.weightGrams),
      taxRateBps: raw.taxRateBps === "" ? 0 : Number(raw.taxRateBps),
      preorderExpectedAt: raw.preorderExpectedAt || undefined,
      categoryIds: formData.getAll("categoryIds").map(String),
      primaryCategoryId: raw.primaryCategoryId || undefined,
      attributeIds: formData.getAll("attributeIds").map(String),
      variants: variantsFromFormData(formData),
    },
    "Create product",
  );

  let productId: string;
  try {
    const product = await createProduct(context, parsed);
    productId = product.id;
  } catch (error) {
    return toState(error, "Unable to create the product");
  }

  revalidatePath("/admin/catalog/products");
  redirect(`/admin/catalog/products/${productId}`);
}

export async function updateProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("product.update");
  } catch (error) {
    return toState(error, "You are not allowed to update products");
  }

  const raw = formDataToObject(formData);
  const productId = String(raw.productId ?? "");
  const parsed = parseInput(
    productInputSchema.omit({ variants: true }),
    {
      ...raw,
      requiresShipping: raw.requiresShipping === "on",
      isFeatured: raw.isFeatured === "on",
      isPreorderEnabled: raw.isPreorderEnabled === "on",
      packagingCostPaisa: bdtToPaisa(raw.packagingCostPaisa) ?? 0,
      weightGrams: raw.weightGrams === "" ? undefined : Number(raw.weightGrams),
      taxRateBps: raw.taxRateBps === "" ? 0 : Number(raw.taxRateBps),
      preorderExpectedAt: raw.preorderExpectedAt || undefined,
      categoryIds: formData.getAll("categoryIds").map(String),
      primaryCategoryId: raw.primaryCategoryId || undefined,
      attributeIds: formData.getAll("attributeIds").map(String),
    },
    "Update product",
  );

  try {
    await updateProduct(context, productId, parsed);
    revalidatePath("/admin/catalog/products");
    revalidatePath(`/admin/catalog/products/${productId}`);
    return { status: "success", message: "Product saved." };
  } catch (error) {
    return toState(error, "Unable to save the product");
  }
}

export async function archiveProductAction(productId: string, reasonOrForm?: string | FormData): Promise<void> {
  const context = await actor("product.archive");
  const reason = typeof reasonOrForm === "string" ? reasonOrForm : undefined;
  await archiveProduct(context, productId, reason);
  revalidatePath("/admin/catalog/products");
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

  const raw = formDataToObject(formData);
  const variantId = String(raw.variantId ?? "");
  const parsed = parseInput(
    variantInputSchema.partial({ name: true, sku: true, pricePaisa: true }),
    {
      ...raw,
      pricePaisa: bdtToPaisa(raw.pricePaisa),
      compareAtPricePaisa: bdtToPaisa(raw.compareAtPricePaisa),
      costPaisa: bdtToPaisa(raw.costPaisa),
      isPreorderEnabled: raw.isPreorderEnabled === "on",
    },
    "Update variant",
  );

  try {
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

/** Bulk editor: rows arrive as `bulk_<variantId>_<field>`. */
export async function bulkUpdateVariantsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("product.update");
  } catch (error) {
    return toState(error, "You are not allowed to update products");
  }

  const productId = String(formData.get("productId") ?? "");
  const variantIds = formData.getAll("bulkVariantId").map(String);
  const rows = variantIds.map((variantId, index) => {
    const price = formData.getAll("bulkPrice")[index];
    const compareAt = formData.getAll("bulkCompareAt")[index];
    const cost = formData.getAll("bulkCost")[index];
    const status = formData.getAll("bulkStatus")[index];
    return {
      variantId,
      pricePaisa: bdtToPaisa(price),
      compareAtPricePaisa: bdtToPaisa(compareAt),
      costPaisa: bdtToPaisa(cost),
      status: status === "ACTIVE" || status === "ARCHIVED" ? (status as "ACTIVE" | "ARCHIVED") : undefined,
    };
  });

  try {
    const count = await bulkUpdateVariants(context, productId, rows);
    revalidatePath(`/admin/catalog/products/${productId}`);
    revalidatePath("/admin/catalog/products");
    return { status: "success", message: `${count} variant(s) updated.` };
  } catch (error) {
    return toState(error, "Unable to update the variants");
  }
}

// ------------------------------------------------------------------ categories

export async function createCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("category.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage categories");
  }

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

  try {
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

  try {
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
}

// ------------------------------------------------------------------ attributes

export async function createAttributeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context;
  try {
    context = await actor("attribute.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage attributes");
  }

  const raw = formDataToObject(formData);
  const values = formData
    .getAll("values")
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((value) => {
      const [text, color] = value.split("|");
      return { value: text ?? "", colorHex: color || undefined };
    });

  const parsed = parseInput(
    attributeInputSchema,
    { ...raw, isVariantDefining: raw.isVariantDefining === "on", values },
    "Create attribute",
  );

  try {
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
