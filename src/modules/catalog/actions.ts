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

  let productId: string;
  try {
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

  try {
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

  try {
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

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(
      categoryInputSchema,
      {
        ...raw,
        parentId: raw.parentId || undefined,
        imageMediaId: raw.imageMediaId || undefined,
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

// ------------------------------------------------------------------ media
// Product galleries, variant images and attribute-value images reference shared
// media assets; these actions own the associations (never the bytes).

export async function setProductGalleryAction(input: {
  productId: string;
  mediaIds: string[];
  primaryMediaId?: string | null;
}): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  try {
    const context = await actor("product.update");
    const { setProductGallery } = await import("@/modules/catalog/media");
    const images = await setProductGallery(context, input);
    revalidatePath("/admin/catalog/products");
    revalidatePath(`/admin/catalog/products/${input.productId}`);
    return { ok: true, count: images.length };
  } catch (error) {
    const state = toState(error, "Unable to save the gallery");
    return { ok: false, message: state.message ?? "Unable to save the gallery" };
  }
}

export async function setVariantImagesAction(input: {
  variantId: string;
  mediaIds: string[];
}): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  try {
    const context = await actor("product.update");
    const { setVariantImages } = await import("@/modules/catalog/media");
    const images = await setVariantImages(context, { variantId: input.variantId, mediaIds: input.mediaIds });
    revalidatePath("/admin/catalog/products");
    return { ok: true, count: images.length };
  } catch (error) {
    const state = toState(error, "Unable to save the variant images");
    return { ok: false, message: state.message ?? "Unable to save the variant images" };
  }
}

export async function bulkApplyVariantImageAction(input: {
  productId: string;
  mediaId: string;
  attributeValueId: string;
}): Promise<{ ok: true; affected: Array<{ id: string; name: string; sku: string }> } | { ok: false; message: string }> {
  try {
    const context = await actor("product.update");
    const { bulkApplyVariantImage } = await import("@/modules/catalog/media");
    const result = await bulkApplyVariantImage(context, input);
    revalidatePath("/admin/catalog/products");
    revalidatePath(`/admin/catalog/products/${input.productId}`);
    return { ok: true, affected: result.affected };
  } catch (error) {
    const state = toState(error, "Unable to apply the image");
    return { ok: false, message: state.message ?? "Unable to apply the image" };
  }
}

export async function previewBulkVariantTargetsAction(input: {
  productId: string;
  attributeValueId: string;
}): Promise<Array<{ id: string; name: string; sku: string }>> {
  const context = await actor("product.update");
  const { previewBulkVariantImageTargets } = await import("@/modules/catalog/media");
  return previewBulkVariantImageTargets(context.businessId, input);
}

export async function setAttributeValueImageAction(input: {
  attributeValueId: string;
  mediaId: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const context = await actor("attribute.manage");
    const { setAttributeValueImage } = await import("@/modules/catalog/service");
    await setAttributeValueImage(context, input.attributeValueId, input.mediaId);
    revalidatePath("/admin/catalog/attributes");
    return { ok: true };
  } catch (error) {
    const state = toState(error, "Unable to save the value image");
    return { ok: false, message: state.message ?? "Unable to save the value image" };
  }
}
