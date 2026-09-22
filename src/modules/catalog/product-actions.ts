"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { addAttributeValue as addAttributeValueService, createAttribute as createAttributeService, createCategory as createCategoryService } from "@/modules/catalog/service";
import {
  bulkApplyVariantAction,
  createBrand,
  createUnitLabel,
  discardProductDraft,
  listBrandOptions,
  loadProductDraft,
  saveProduct,
  saveProductDraft,
  setAttributeValueImage,
  updateSingleVariant,
} from "@/modules/catalog/product-service";
import {
  createBrandPreset,
  createPackagingCostTemplate,
  createTaxRate,
  createUnitLabelPreset,
  deleteBrandPreset,
  deletePackagingCostTemplate,
  deleteTaxRate,
  deleteUnitLabelPreset,
  updateBrandPreset,
  updatePackagingCostTemplate,
  updateTaxRate,
  updateUnitLabelPreset,
} from "@/modules/catalog/presets-service";
import {
  attributeInputSchema,
  categoryInputSchema,
} from "@/modules/catalog/schemas";
import {
  attributeValueImageSchema,
  attributeValueInputSchema,
  brandInputSchema,
  bulkVariantActionSchema,
  packagingCostTemplateInputSchema,
  productDraftSchema,
  singleVariantUpdateSchema,
  skuCheckSchema,
  slugCheckSchema,
  taxRateInputSchema,
  unitLabelInputSchema,
} from "@/modules/catalog/product-schemas";
import { nextAvailableSlug, suggestSlug } from "@/modules/catalog/product-draft";
import { prisma } from "@/lib/db/client";

/**
 * Server actions for the Create/Edit Product flow.
 *
 * Every action re-authenticates, re-authorises and re-validates: the browser only
 * ever sends choices (ids, text, documents), never a computed value it could
 * tamper with. Results are plain objects so the client can render field errors,
 * keep the user's data and never claim success before the database confirmed it.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "_";
    errors[path] = [...(errors[path] ?? []), issue.message];
  }
  return errors;
}

function failure(error: unknown, fallback: string): { ok: false; message: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof z.ZodError) {
    return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors: toFieldErrors(error) };
  }
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [issue.path ?? "_", [issue.message ?? "Invalid value"]]),
        )
      : undefined;
    return { ok: false, message: error.message, fieldErrors };
  }
  logger.error("Product action failed", error);
  return { ok: false, message: fallback };
}

/** The signed-in staff actor, requiring at least one of the listed permissions. */
async function actorFor(permissions: string[]) {
  const session = await requireSession();
  const allowed = permissions.some((permission) => can(session, permission));
  if (!allowed) throw AppError.forbidden("You do not have permission to change the catalogue");
  return { userId: session.id, businessId: session.businessId, actorLabel: session.email, session };
}

/* -------------------------------------------------------------------------- */
/* Availability checks                                                        */
/* -------------------------------------------------------------------------- */

export interface SlugCheckResult {
  slug: string;
  available: boolean;
  suggestion: string | null;
  preview: string | null;
}

/**
 * Is this slug free? Runs on the server (the unique index is the authority) and
 * returns a *suggestion* when it is taken, so the form can offer "use
 * classic-black-shoes-2" instead of just failing on save.
 */
export async function checkProductSlugAction(input: { slug: string; productId?: string }): Promise<ActionResult<SlugCheckResult>> {
  try {
    const session = await requireSession();
    assertPermission(session, "product.view");
    const { slug, productId } = slugCheckSchema.parse(input);
    const candidate = suggestSlug(slug);

    if (!candidate) {
      return { ok: true, data: { slug, available: false, suggestion: null, preview: null } };
    }

    const clash = await prisma.product.findFirst({
      where: { businessId: session.businessId, slug: candidate, ...(productId ? { id: { not: productId } } : {}) },
      select: { id: true, slug: true },
    });

    if (!clash) {
      return { ok: true, data: { slug: candidate, available: true, suggestion: null, preview: candidate } };
    }

    const taken = await prisma.product.findMany({
      where: { businessId: session.businessId },
      select: { slug: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });
    const suggestion = nextAvailableSlug(candidate, taken.map((row) => row.slug));
    return { ok: true, data: { slug: candidate, available: false, suggestion, preview: suggestion } };
  } catch (error) {
    return failure(error, "Unable to check that URL slug right now.");
  }
}

export interface SkuCheckEntry {
  available: boolean;
  message?: string;
}

export interface SkuCheckResult {
  productCode: SkuCheckEntry;
  variants: Record<string, SkuCheckEntry>;
}

/**
 * Check the parent code and every variant code in one query.
 *
 * Variant codes are unique across the whole platform (the schema says so), the
 * parent code is unique inside the business — the same asymmetry the create
 * transaction enforces, reported per field so the table can mark the offending row.
 */
export async function checkProductSkusAction(input: {
  productId?: string;
  productCode?: string;
  variantSkus: Array<{ key: string; sku: string }>;
}): Promise<ActionResult<SkuCheckResult>> {
  try {
    const session = await requireSession();
    assertPermission(session, "product.view");
    const parsed = skuCheckSchema.parse(input);

    const variants: Record<string, SkuCheckEntry> = {};
    const seen = new Map<string, string[]>();
    for (const entry of parsed.variantSkus) {
      const sku = entry.sku.trim().toUpperCase();
      if (!sku) continue;
      seen.set(sku, [...(seen.get(sku) ?? []), entry.key]);
    }

    const codes = [...seen.keys()];
    const clashes = codes.length > 0 ? await prisma.variant.findMany({ where: { sku: { in: codes } }, select: { sku: true, productId: true } }) : [];
    const clashMap = new Map(clashes.map((row) => [row.sku, row.productId]));

    for (const [sku, keys] of seen) {
      if (keys.length > 1) {
        for (const key of keys) variants[key] = { available: false, message: `${sku} is used by more than one variant in this product.` };
        continue;
      }
      const owner = clashMap.get(sku);
      const entry: SkuCheckEntry =
        owner && owner !== parsed.productId
          ? { available: false, message: `${sku} is already used by another product.` }
          : { available: true };
      for (const key of keys) variants[key] = entry;
    }

    let productCode: SkuCheckEntry = { available: true };
    const code = parsed.productSku?.trim().toUpperCase();
    if (code) {
      const [productClash, variantClash] = await Promise.all([
        prisma.product.findFirst({
          where: { businessId: session.businessId, sku: { equals: code, mode: "insensitive" }, ...(parsed.productId ? { id: { not: parsed.productId } } : {}) },
          select: { name: true },
        }),
        prisma.variant.findFirst({ where: { sku: code }, select: { id: true } }),
      ]);
      if (productClash) productCode = { available: false, message: `Already used by "${productClash.name}".` };
      else if (variantClash) productCode = { available: false, message: "Already used by a variant." };
    }

    return { ok: true, data: { productCode, variants } };
  } catch (error) {
    return failure(error, "Unable to check product codes right now.");
  }
}

/* -------------------------------------------------------------------------- */
/* On-the-go creation                                                         */
/* -------------------------------------------------------------------------- */

export async function createBrandAction(input: unknown): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = brandInputSchema.parse(input);
    const brand = await createBrand(actor, parsed);
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: brand };
  } catch (error) {
    return failure(error, "Unable to create the brand.");
  }
}

export async function listBrandsAction(): Promise<ActionResult<Awaited<ReturnType<typeof listBrandOptions>>>> {
  try {
    const session = await requireSession();
    assertPermission(session, "product.view");
    return { ok: true, data: await listBrandOptions(session.businessId) };
  } catch (error) {
    return failure(error, "Unable to load brands.");
  }
}

export async function createUnitLabelAction(input: unknown): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = unitLabelInputSchema.parse(input);
    return { ok: true, data: await createUnitLabel(actor, parsed) };
  } catch (error) {
    return failure(error, "Unable to save that unit label.");
  }
}

export async function createCategoryForProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; slug: string; path: string | null; parentId: string | null; imageMediaId: string | null }>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = categoryInputSchema.parse(input);
    const created = await createCategoryService(actor, parsed);
    // Re-read the row so the form receives the computed path and the image id it
    // needs to render the badge without another round trip.
    const category = await prisma.category.findUniqueOrThrow({
      where: { id: created.id },
      select: { id: true, name: true, slug: true, path: true, parentId: true, imageMediaId: true },
    });
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: category };
  } catch (error) {
    return failure(error, "Unable to create the category.");
  }
}

export async function createAttributeForProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; slug: string; values: Array<{ id: string; value: string; colorHex: string | null; mediaId: string | null }> }>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = attributeInputSchema.parse(input);
    const attribute = await createAttributeService(actor, parsed);
    const values = await prisma.attributeValue.findMany({
      where: { attributeId: attribute.id },
      orderBy: { position: "asc" },
      select: { id: true, value: true, colorHex: true, mediaId: true },
    });
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: { id: attribute.id, name: attribute.name, slug: attribute.slug, values } };
  } catch (error) {
    return failure(error, "Unable to create the attribute.");
  }
}

export async function addAttributeValueForProductAction(
  input: unknown,
): Promise<ActionResult<{ id: string; value: string; colorHex: string | null; mediaId: string | null }>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = attributeValueInputSchema.parse(input);
    await addAttributeValueService(actor, parsed.attributeId, {
      value: parsed.value,
      colorHex: parsed.colorHex || undefined,
    });
    const created = await prisma.attributeValue.findFirst({
      where: { attributeId: parsed.attributeId, slug: parsed.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") },
      orderBy: { position: "desc" },
      select: { id: true, value: true, colorHex: true, mediaId: true },
    });
    if (!created) throw AppError.internal("The attribute value was created but could not be read back.");
    return { ok: true, data: created };
  } catch (error) {
    return failure(error, "Unable to add that value.");
  }
}

export async function setAttributeValueImageAction(input: unknown): Promise<ActionResult<{ attributeValueId: string; mediaId: string | null; variantsUpdated: number }>> {
  try {
    const actor = await actorFor(["product.update", "product.create"]);
    const parsed = attributeValueImageSchema.parse(input);
    const result = await setAttributeValueImage(actor, parsed);
    revalidatePath(`/admin/catalog/products`);
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to save that attribute image.");
  }
}

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

export interface SaveProductActionResult {
  productId: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  created: boolean;
  variantCount: number;
  openingStockRecorded: number;
  warnings: string[];
}

/**
 * Save the whole form.
 *
 * `saveAsDraft` never publishes: a new product is created with status DRAFT and an
 * existing one keeps its current publication state while every other change is
 * stored. "Create product" honours the status the user chose in the form.
 */
export async function saveProductAction(input: unknown): Promise<ActionResult<SaveProductActionResult>> {
  try {
    const raw = input as { productId?: string; saveAsDraft?: boolean } | null;
    const actor = await actorFor(raw?.productId ? ["product.update"] : ["product.create", "product.update"]);
    const parsed = productDraftSchema.parse(input);
    const result = await saveProduct(actor, parsed);

    revalidatePath("/admin/catalog/products");
    revalidatePath(`/admin/catalog/products/${result.productId}`);
    revalidatePath("/admin/media");

    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to save the product. Your changes are still in the form.");
  }
}

export async function bulkVariantActionAction(input: unknown): Promise<ActionResult<{ affected: number; skipped: number; targetDescription: string; details: string[] }>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = bulkVariantActionSchema.parse(input);
    if (parsed.action === "set-cost" && !can(actor.session, "product.view_cost")) {
      throw AppError.forbidden("You do not have permission to change purchase cost");
    }
    const result = await bulkApplyVariantAction(actor, parsed);
    revalidatePath(`/admin/catalog/products/${parsed.productId}`);
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to apply the bulk change.");
  }
}

/* -------------------------------------------------------------------------- */
/* Single Variant Editing                                                     */
/* -------------------------------------------------------------------------- */

export async function updateSingleVariantAction(
  input: unknown,
): Promise<ActionResult<{ variantId: string; productName: string; variantName: string }>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = singleVariantUpdateSchema.parse(input);
    if (parsed.costPaisa !== undefined && !can(actor.session, "product.view_cost")) {
      throw AppError.forbidden("You do not have permission to change purchase cost");
    }
    const result = await updateSingleVariant(actor, parsed);
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to update the variant.");
  }
}

/* -------------------------------------------------------------------------- */
/* Persistent Drafts and Autosave                                             */
/* -------------------------------------------------------------------------- */

export async function saveProductDraftAction(input: {
  productId?: string | null;
  name?: string;
  payload: Record<string, unknown>;
}): Promise<ActionResult<{ draftId: string; updatedAt: string }>> {
  try {
    const actor = await actorFor(input.productId ? ["product.update"] : ["product.create"]);
    const result = await saveProductDraft(actor, input);
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to save working draft.");
  }
}

export async function loadProductDraftAction(input: {
  productId?: string | null;
  draftId?: string | null;
}): Promise<ActionResult<{ draftId: string; name: string; payload: Record<string, unknown>; updatedAt: string } | null>> {
  try {
    const actor = await actorFor(input.productId ? ["product.update"] : ["product.create"]);
    const draft = await loadProductDraft(actor.businessId, { ...input, userId: actor.userId });
    return { ok: true, data: draft };
  } catch (error) {
    return failure(error, "Unable to load working draft.");
  }
}

export async function discardProductDraftAction(input: {
  productId?: string | null;
  draftId?: string | null;
}): Promise<ActionResult<{ discarded: boolean }>> {
  try {
    const actor = await actorFor(input.productId ? ["product.update"] : ["product.create"]);
    const discarded = await discardProductDraft(actor.businessId, input);
    return { ok: true, data: { discarded } };
  } catch (error) {
    return failure(error, "Unable to discard working draft.");
  }
}

/* -------------------------------------------------------------------------- */
/* Presets: Tax Rates                                                         */
/* -------------------------------------------------------------------------- */

export async function createTaxRateAction(input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = taxRateInputSchema.parse(input);
    const result = await createTaxRate(actor, parsed);
    revalidatePath("/admin/catalog/tax-rates");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to create tax rate.");
  }
}

export async function updateTaxRateAction(id: string, input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = taxRateInputSchema.partial().parse(input);
    const result = await updateTaxRate(actor, id, parsed);
    revalidatePath("/admin/catalog/tax-rates");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to update tax rate.");
  }
}

export async function deleteTaxRateAction(id: string): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const result = await deleteTaxRate(actor, id);
    revalidatePath("/admin/catalog/tax-rates");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to delete tax rate.");
  }
}

/* -------------------------------------------------------------------------- */
/* Presets: Packaging Cost Templates                                          */
/* -------------------------------------------------------------------------- */

export async function createPackagingCostTemplateAction(input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = packagingCostTemplateInputSchema.parse(input);
    const result = await createPackagingCostTemplate(actor, parsed);
    revalidatePath("/admin/catalog/packaging-costs");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to create packaging cost template.");
  }
}

export async function updatePackagingCostTemplateAction(id: string, input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = packagingCostTemplateInputSchema.partial().parse(input);
    const result = await updatePackagingCostTemplate(actor, id, parsed);
    revalidatePath("/admin/catalog/packaging-costs");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to update packaging cost template.");
  }
}

export async function deletePackagingCostTemplateAction(id: string): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const result = await deletePackagingCostTemplate(actor, id);
    revalidatePath("/admin/catalog/packaging-costs");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to delete packaging cost template.");
  }
}

/* -------------------------------------------------------------------------- */
/* Presets: Unit Labels                                                       */
/* -------------------------------------------------------------------------- */

export async function createUnitLabelPresetAction(input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = unitLabelInputSchema.parse(input);
    const result = await createUnitLabelPreset(actor, parsed);
    revalidatePath("/admin/catalog/unit-labels");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to create unit label.");
  }
}

export async function updateUnitLabelPresetAction(id: string, input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = unitLabelInputSchema.parse(input);
    const result = await updateUnitLabelPreset(actor, id, parsed);
    revalidatePath("/admin/catalog/unit-labels");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to update unit label.");
  }
}

export async function deleteUnitLabelPresetAction(id: string): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const result = await deleteUnitLabelPreset(actor, id);
    revalidatePath("/admin/catalog/unit-labels");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to delete unit label.");
  }
}

/* -------------------------------------------------------------------------- */
/* Presets: Brands                                                            */
/* -------------------------------------------------------------------------- */

export async function createBrandPresetAction(input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.create", "product.update"]);
    const parsed = brandInputSchema.parse(input);
    const result = await createBrandPreset(actor, parsed);
    revalidatePath("/admin/catalog/brands");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to create brand.");
  }
}

export async function updateBrandPresetAction(id: string, input: unknown): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const parsed = brandInputSchema.parse(input);
    const result = await updateBrandPreset(actor, id, parsed);
    revalidatePath("/admin/catalog/brands");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to update brand.");
  }
}

export async function deleteBrandPresetAction(id: string): Promise<ActionResult<any>> {
  try {
    const actor = await actorFor(["product.update"]);
    const result = await deleteBrandPreset(actor, id);
    revalidatePath("/admin/catalog/brands");
    revalidatePath("/admin/catalog/products");
    return { ok: true, data: result };
  } catch (error) {
    return failure(error, "Unable to delete brand.");
  }
}
