"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { cn } from "@/lib/utils";
import { CollapsibleGroup, CollapsibleSection } from "@/components/ui/collapsible";
import {
  checkProductSkusAction,
  checkProductSlugAction,
  saveProductAction,
  setAttributeValueImageAction,
} from "@/modules/catalog/product-actions";
import { DraftStatusBar, ResumeDraftBanner, useProductDraft } from "./use-product-draft";
import {
  DEFAULT_WEIGHT_UNIT,
  combinationKey,
  normalizeSku,
  planMatrix,
  toWeightGrams,
  type DraftVariant,
} from "@/modules/catalog/product-draft";
import type { EditorAttribute, EditorCategory, ProductEditorData } from "@/modules/catalog/product-queries";
import {
  BasicInformationSection,
  OrganizationSection,
  PricingSection,
  ProductDescriptionSection,
  ProductImagesSection,
  ProductSettingsSection,
} from "./sections";
import { AttributesVariationsSection } from "./variations";
import { useProductEditor, toDraftAttribute, type ProductEditorState } from "./use-product-editor";
import type { MediaGalleryItem } from "@/components/media/media-field";
import { validateDiscount } from "@/modules/catalog/pricing-rules";
import type { PricingLevelInput } from "@/modules/catalog/inheritance";

/**
 * Create / Edit Product.
 *
 * One client component owns the whole form state (`useProductEditor`) so that
 * collapsing sections, opening dialogs, expanding the rich-text editors or picking
 * media can never lose a value. On submit the entire form is sent to
 * `saveProductAction`, which writes it in one transaction.
 *
 * Saving is explicit: **Save as draft** never publishes, **Create product** honours
 * the chosen status, and **Cancel** asks before throwing work away.
 */

export interface ProductEditorFormProps {
  data: ProductEditorData;
}

/** The subset of a brand the picker needs; kept local so `+ Create brand` can append one. */
interface BrandChoice {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  logo: { url: string | null } | null;
}

function toBrandChoice(brand: ProductEditorData["brands"][number]): BrandChoice {
  return { id: brand.id, name: brand.name, slug: brand.slug, productCount: brand.productCount, logo: brand.logo ?? null };
}

type ErrorMap = Record<string, string[]>;

/**
 * Named section chips, in this order: Information, Organisation, Images,
 * Attributes & variations (variable products only), Description, SEO.
 * Pricing sits after Information and is not a chip.
 */
const SECTIONS = [
  { id: "information", label: "Product information" },
  { id: "organization", label: "Organisation" },
  { id: "images", label: "Images" },
  { id: "variants", label: "Attributes, variations & bulk" },
  { id: "description", label: "Description" },
  { id: "seo", label: "SEO" },
] as const;

function toPaisa(value: string | null | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function isNonNegativeNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function ProductEditorForm({ data }: ProductEditorFormProps) {
  const router = useRouter();
  const product = data.product;

  const editor = useProductEditor({
    product,
    attributes: data.attributes,
    categories: data.categories,
    unitLabels: data.unitLabels,
  });
  const { state } = editor;

  /*
   * Persistent working copy.
   *
   * Autosave happens here, not in the save button: the button publishes the
   * product, the draft keeps the in-progress edits safe across reloads, crashes
   * and a second tab.
   */
  const [saving, setSaving] = React.useState<null | "draft" | "create">(null);
  const draft = useProductDraft({
    productId: product?.id ?? null,
    initialDraft: product ? data.draft : null,
    state,
    dirty: editor.dirty,
    onResume: (payload) => {
      // The draft stores the whole editor state; unknown keys are dropped by
      // `buildInitialState` defaults rather than reaching the save payload.
      editor.reset({ ...state, ...(payload as Partial<ProductEditorState>) });
      setSaved(false);
    },
    enabled: saving == null && Boolean(product),
  });

  /* Option lists that `+ Create …` dialogs extend without a page reload. */
  const [brands, setBrands] = React.useState<BrandChoice[]>(() => data.brands.map(toBrandChoice));
  const [categories, setCategories] = React.useState<EditorCategory[]>(data.categories);
  const [attributes, setAttributes] = React.useState<EditorAttribute[]>(data.attributes);
  const [unitLabels, setUnitLabels] = React.useState(data.unitLabels);

  const [errors, setErrors] = React.useState<ErrorMap>({});
  const [variantErrors, setVariantErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  /** Selected variant rows — UI state only, so selecting rows never marks the form dirty. */
  const [selection, setSelection] = React.useState<string[]>([]);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const [slugState, setSlugState] = React.useState<{ checking: boolean; available: boolean | null; suggestion: string | null }>({
    checking: false,
    available: null,
    suggestion: null,
  });
  const [skuState, setSkuState] = React.useState<{ checking: boolean; message: string | null }>({ checking: false, message: null });




  /* ---------------------------------------------------------------- matrix */

  const draftAttributes = React.useMemo(
    () => attributes.filter((attribute) => state.attributeIds.includes(attribute.id)).map(toDraftAttribute),
    [attributes, state.attributeIds],
  );

  const plan = React.useMemo(
    () =>
      planMatrix(draftAttributes, state.selectedValueIds, state.variants, {
        keepOrphans: true,
      }),
    [draftAttributes, state.selectedValueIds, state.variants],
  );

  /* ------------------------------------------------------------- slug check */

  // Typing invalidates the previous verdict immediately (render-time adjustment);
  // only the network round-trip lives in the effect, debounced.
  const [previousSlug, setPreviousSlug] = React.useState(state.slug);
  if (state.slug !== previousSlug) {
    setPreviousSlug(state.slug);
    setSlugState({ checking: state.slug.trim().length > 0, available: null, suggestion: null });
  }

  const lastCheckedSlug = React.useRef<string>("");
  React.useEffect(() => {
    const slug = state.slug.trim();
    const productId = product?.id ?? draft.productId ?? "";
    const key = `${productId}:${slug}`;
    if (!slug || key === lastCheckedSlug.current) {
      if (!slug) setSlugState({ checking: false, available: null, suggestion: null });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await checkProductSlugAction({ slug, productId: product?.id ?? draft.productId ?? undefined });
      if (cancelled) return;
      lastCheckedSlug.current = key;
      if (!result.ok) {
        setSlugState({ checking: false, available: null, suggestion: null });
        return;
      }
      setSlugState({ checking: false, available: result.data.available, suggestion: result.data.suggestion });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [state.slug, product?.id, draft.productId]);

  /* ------------------------------------------------- product code uniqueness */

  const lastCheckedSku = React.useRef<string>("");
  React.useEffect(() => {
    const code = normalizeSku(state.productCode);
    const productId = product?.id ?? draft.productId ?? "";
    const key = `${productId}:${code}`;
    if (!code || code.length < 2 || key === lastCheckedSku.current) {
      if (!code) setSkuState({ checking: false, message: null });
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await checkProductSkusAction({ productId: product?.id ?? draft.productId ?? undefined, productCode: code });
      if (cancelled) return;
      lastCheckedSku.current = key;
      setSkuState({
        checking: false,
        message: !result.ok
          ? null
          : result.data.productCode.available
            ? null
            : result.data.productCode.message ?? "This product code is already taken.",
      });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [state.productCode, product?.id, draft.productId]);

  /* ------------------------------------------------------- unsaved changes */

  const dirty = editor.dirty && !saved;
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* --------------------------------------------------------------- helpers */

  const patch = editor.patch;

  const images: MediaGalleryItem[] = state.images.map((image) => ({
    mediaId: image.mediaId,
    asset: image.asset,
    altText: image.altText,
  }));
  const primaryImageItem: MediaGalleryItem | null = state.primaryImage
    ? { mediaId: state.primaryImage.mediaId, asset: state.primaryImage.asset, altText: state.primaryImage.altText }
    : null;
  const productImage = state.primaryImage?.asset ?? null;
  const variantDefiningAttributes = draftAttributes.filter((attribute) => attribute.isVariantDefining !== false);

  /** The price a row sells for: its own override, else the attribute default, else the product default. */
  const effectivePaisa = React.useCallback(
    (variant: DraftVariant) => {
      const own = toPaisa(variant.currentPrice) ?? null;
      if (own != null) return own;
      const fromAttribute = variant.attributeValueIds
        .map((valueId) => attributes.flatMap((attribute) => attribute.values).find((value) => value.id === valueId)?.currentPricePaisa ?? null)
        .find((value): value is number => value != null);
      if (fromAttribute != null) return fromAttribute;
      return toPaisa(state.currentPrice) ?? 0;
    },
    [attributes, state.currentPrice],
  );

  const completion = React.useMemo(() => {
    return {
      information: state.name.trim().length >= 2 && state.slug.trim().length > 0 && normalizeSku(state.productCode).length >= 2,
      organization: state.unitLabel.trim().length > 0 && isNonNegativeNumber(state.weightValue),
      images: Boolean(state.primaryImage),
      variants: state.productType === "SIMPLE" || state.variants.length > 0,
      description: true,
      seo: Boolean(state.seoTitle.trim() || state.seoDescription.trim() || state.status),
    } satisfies Record<(typeof SECTIONS)[number]["id"], boolean>;
  }, [state, effectivePaisa]);

  const visibleSections = state.productType === "SIMPLE" ? SECTIONS.filter((section) => section.id !== "variants") : SECTIONS;
  const completedCount = visibleSections.filter((section) => completion[section.id]).length;

  const productPricing: PricingLevelInput = React.useMemo(
    () => ({
      currentPricePaisa: toPaisa(state.currentPrice) ?? null,
      discountType: state.discountType,
      discountValue: Number(state.discountValue) || 0,
    }),
    [state.currentPrice, state.discountType, state.discountValue],
  );

  const overrideCount = React.useMemo(
    () =>
      state.variants.filter((variant) => (toPaisa(variant.currentPrice) ?? null) != null).length +
      attributes.reduce(
        (total, attribute) => total + attribute.values.filter((value) => value.currentPricePaisa != null).length,
        0,
      ),
    [state.variants, attributes],
  );
  const unpricedCount = React.useMemo(
    () => state.variants.filter((variant) => effectivePaisa(variant) <= 0).length,
    [state.variants, effectivePaisa],
  );

  /** Client-side validation that mirrors what the server enforces. */
  const validate = (): { errors: ErrorMap; variantErrors: Record<string, string> } => {
    const next: ErrorMap = {};
    const rowErrors: Record<string, string> = {};

    if (state.name.trim().length < 2) next.name = ["Enter a product name of at least 2 characters."];
    if (state.name.trim().length > 200) next.name = ["Product names are limited to 200 characters."];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.slug.trim())) {
      next.slug = ["Use lower-case letters, numbers and single dashes, for example classic-black-shoes."];
    }
    if (normalizeSku(state.productCode).length < 2) next.productCode = ["Enter a product code of at least 2 characters."];
    if (!state.unitLabel.trim()) next.unitLabel = ["Enter a unit label, for example piece."];
    if (!isNonNegativeNumber(state.weightValue)) next.weightValue = ["Weight must be a number of 0 or more."];
    if (state.categoryIds.includes("") || new Set(state.categoryIds).size !== state.categoryIds.length) {
      next.categoryIds = ["Each category can only be selected once."];
    }
    if (state.attributeIds.length !== new Set(state.attributeIds).size) {
      next.attributeIds = ["Each attribute can only be selected once."];
    }
    if (state.variants.length === 0) next.variants = ["A product needs at least one variant."];
    if (state.variants.length > 500) next.variants = ["Split products with more than 500 variants into several products."];
    if (!isNonNegativeNumber(state.currentPrice)) next.currentPricePaisa = ["Current price must be a number of 0 or more."];
    if (!isNonNegativeNumber(state.defaultCost)) next.defaultCostPaisa = ["Default cost must be a number of 0 or more."];
    if (!isNonNegativeNumber(state.packagingCostPaisa)) next.packagingCostPaisa = ["Packaging cost must be a number of 0 or more."];
    const productDiscount = validateDiscount({
      currentPricePaisa: toPaisa(state.currentPrice) ?? 0,
      discountType: state.discountType,
      discountValue: Number(state.discountValue) || 0,
    });
    if (!productDiscount.ok) next.discountValue = [productDiscount.message ?? "Invalid discount."];

    const seenCombos = new Map<string, string[]>();
    for (const variant of state.variants) {
      if (variant.attributeValueIds.length > 0) {
        const key = combinationKey(variant.attributeValueIds);
        seenCombos.set(key, [...(seenCombos.get(key) ?? []), variant.key]);
      }

      const current = toPaisa(variant.currentPrice);
      if (variant.currentPrice?.trim() && !isNonNegativeNumber(variant.currentPrice)) {
        rowErrors[variant.key] = "Current price must be a number of 0 or more.";
      } else if (variant.discountType && variant.discountType !== "NONE" && current != null) {
        const check = validateDiscount({
          currentPricePaisa: current,
          discountType: variant.discountType,
          discountValue: Number(variant.discountValue) || 0,
        });
        if (!check.ok) rowErrors[variant.key] = check.message ?? "Invalid discount.";
      }
      if (!isNonNegativeNumber(variant.compareAt ?? "")) rowErrors[variant.key] = "Compare-at price must be a number of 0 or more.";
      if (!isNonNegativeNumber(variant.cost ?? "")) rowErrors[variant.key] = "Cost must be a number of 0 or more.";
      if (!isNonNegativeNumber(variant.weight ?? "")) rowErrors[variant.key] = "Weight must be a number of 0 or more.";
      if (!isNonNegativeNumber(variant.packagingCost ?? "")) rowErrors[variant.key] = "Packaging cost must be a number of 0 or more.";

      if (
        !rowErrors[variant.key] &&
        state.status !== "DRAFT" &&
        (current ?? effectivePaisa(variant)) <= 0
      ) {
        rowErrors[variant.key] = "Set a price before publishing, or save the product as a draft.";
      }
    }

    // Surface the worst row problem at section level too, so the summary is never silent.
    const rowMessages = [...new Set(Object.values(rowErrors))];
    if (rowMessages.length > 0) next.variants = rowMessages.slice(0, 3);

    return { errors: next, variantErrors: rowErrors };
  };

  const buildPayload = (saveAsDraft: boolean) => {
    return {
      productId: product?.id ?? draft.productId ?? undefined,
      expectedUpdatedAt: product?.updatedAt,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      name: state.name.trim(),
      slug: state.slug.trim(),
      productCode: normalizeSku(state.productCode),
      barcode: state.barcode.trim() || undefined,
      productType: state.productType,
      status: saveAsDraft && !product ? ("DRAFT" as const) : state.status,
      brandId: state.brandId,
      labelIds: state.labelIds,
      unitLabel: state.unitLabel.trim(),
      unitLabelId: state.unitLabelId,
      categoryIds: state.categoryIds,
      primaryCategoryId: state.primaryCategoryId,
      attributeIds: state.productType === "SIMPLE" ? [] : state.attributeIds,
      shortDescription: state.shortDescription,
      description: state.description,
      primaryImage: state.primaryImage ? { mediaId: state.primaryImage.mediaId, altText: state.primaryImage.altText ?? null } : null,
      images: state.images.map((image) => ({ mediaId: image.mediaId, altText: image.altText ?? null })),
      seoImage: state.seoImage ? { mediaId: state.seoImage.id, altText: state.seoImage.altText ?? null } : null,
      attributeValueImages: Object.fromEntries(
        Object.entries(state.attributeValueImages).filter(([, mediaId]) => Boolean(mediaId)),
      ) as Record<string, string>,
      weightValue: state.weightValue.trim() ? Number(state.weightValue) : null,
      weightUnit: state.weightUnit ?? DEFAULT_WEIGHT_UNIT,
      taxRateId: state.taxRateId,
      taxRateBps: state.taxRateBps.trim() ? Number(state.taxRateBps) : 0,
      packagingCostTemplateId: state.packagingCostTemplateId,
      packagingCostPaisa: toPaisa(state.packagingCostPaisa) ?? 0,
      currentPricePaisa: toPaisa(state.currentPrice),
      discountType: state.discountType,
      discountValue: Number(state.discountValue) || 0,
      defaultCostPaisa: toPaisa(state.defaultCost),
      requiresShipping: state.requiresShipping,
      isFeatured: state.isFeatured,
      isPreorderEnabled: state.isPreorderEnabled,
      preorderNote: state.preorderNote.trim() || undefined,
      seoTitle: state.seoTitle.trim() || undefined,
      seoDescription: state.seoDescription.trim() || undefined,
      seoKeywords: state.seoKeywords.trim() || undefined,
      variants: (state.productType === "SIMPLE" ? state.variants.slice(0, 1) : state.variants).map((variant: DraftVariant) => ({
        id: variant.id,
        name: variant.name.trim() || (state.productType === "SIMPLE" ? state.name.trim() || "Default" : "Variant"),
        barcode: variant.barcode?.trim() || undefined,
        currentPricePaisa: toPaisa(variant.currentPrice) ?? undefined,
        discountType: variant.discountType ?? "NONE",
        discountValue: Number(variant.discountValue) || 0,
        compareAtPricePaisa: toPaisa(variant.compareAt) ?? undefined,
        costPaisa: toPaisa(variant.cost) ?? undefined,
        packagingCostPaisa: toPaisa(variant.packagingCost) ?? undefined,
        clearPackagingCostOverride: variant.clearPackagingCostOverride ?? undefined,
        weightGrams: toWeightGrams(variant.weight ?? "", variant.weightUnit ?? state.weightUnit) ?? undefined,
        weightUnit: variant.weightUnit ?? state.weightUnit,
        isPreorderEnabled: variant.isPreorderEnabled ?? undefined,
        imageMediaId: variant.imageMediaId,
        galleryMediaIds: variant.galleryMediaIds,
        attributeValueIds: state.productType === "SIMPLE" ? [] : variant.attributeValueIds,
        touched: variant.touched,
      })),
      saveAsDraft,
    };
  };

  const submit = async (saveAsDraft: boolean) => {
    if (saving) return;
    const clientValidation = validate();
    setErrors(clientValidation.errors);
    setVariantErrors(clientValidation.variantErrors);
    setFormError(null);

    if (Object.keys(clientValidation.errors).length > 0) {
      toast.error("Please fix the highlighted fields before saving.");
      document.getElementById("information")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setSaving(saveAsDraft ? "draft" : "create");
    const result = await saveProductAction(buildPayload(saveAsDraft));
    if (result.ok) {
      setSaved(true);
      // The product record is now the source of truth; the working copy it came
      // from has served its purpose.
      void draft.clear();
      const { data: savedResult } = result;
      toast.success(
        savedResult.created
          ? saveAsDraft
            ? "Draft saved"
            : "Product created"
          : saveAsDraft
            ? "Draft saved"
            : "Product saved",
        { description: `${savedResult.variantCount} variant(s) · ${savedResult.status.toLowerCase()}` },
      );
      if (savedResult.warnings.length > 0) toast.warning(savedResult.warnings[0]!);
      router.push(`/admin/catalog/products/${savedResult.productId}`);
      router.refresh();
      return;
    }

    setSaving(null);
    setFormError(result.message);
    setErrors(result.fieldErrors ?? {});
    if (result.fieldErrors) {
      const mapped: Record<string, string> = {};
      for (const [path, messages] of Object.entries(result.fieldErrors)) {
        const match = /^variants\.(\d+)\./.exec(path);
        if (match) {
          const variant = state.variants[Number(match[1])];
          if (variant && messages[0]) mapped[variant.key] = messages[0];
        }
      }
      setVariantErrors((current) => ({ ...current, ...mapped }));
    }
    toast.error(result.message, { description: "Nothing was saved. Your entries are still in the form." });
    document.getElementById("basic")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const setAttributeValueImage = async (attributeValueId: string, mediaId: string | null) => {
    patch({ attributeValueImages: { ...state.attributeValueImages, [attributeValueId]: mediaId } });
    if (!product?.id) {
      setAttributes((current) =>
        current.map((attribute) => ({
          ...attribute,
          values: attribute.values.map((value) => (value.id === attributeValueId ? { ...value, mediaId } : value)),
        })),
      );
      return;
    }
    const result = await setAttributeValueImageAction({ attributeValueId, mediaId, productId: product.id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const label = result.data.mediaId ? "Attribute default image saved" : "Attribute default image cleared";
    toast.success(label, {
      description:
        result.data.variantsUpdated > 0
          ? `${result.data.variantsUpdated} existing variant(s) inherited this image.`
          : "New variants of this value will use it.",
    });
    setAttributes((current) =>
      current.map((attribute) => ({
        ...attribute,
        values: attribute.values.map((value) => (value.id === attributeValueId ? { ...value, mediaId: result.data.mediaId } : value)),
      })),
    );
  };

  return (
    <div className="space-y-4 pb-28">
      {formError ? (
        <Alert variant="danger" title="The product was not saved">
          <p>{formError}</p>
          <p className="text-xs text-slate-600">Your entries are unchanged — fix the problem and save again.</p>
        </Alert>
      ) : null}

      {product ? <ResumeDraftBanner draft={draft} onResume={draft.resume} onDiscard={draft.discard} /> : null}

      <CollapsibleGroup
        defaultOpen={["information", "organization", "variants", "pricing"]}
        header={
          <div className="mr-auto flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={completedCount === visibleSections.length ? "success" : "neutral"}>
              {completedCount}/{visibleSections.length} sections complete
            </Badge>
            <span className="flex flex-wrap items-center gap-1.5">
              {visibleSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
                    completion[section.id]
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {completion[section.id] ? (
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Circle className="h-3 w-3" aria-hidden="true" />
                  )}
                  {section.label}
                </a>
              ))}
            </span>
          </div>
        }
      >
        <BasicInformationSection
          name={state.name}
          slug={state.slug}
          slugTouched={state.slugTouched}
          productCode={state.productCode}
          barcode={state.barcode}
          productType={state.productType}
          productUrlPrefix={data.productUrlPrefix}
          slugState={slugState}
          skuState={{ checking: skuState.checking, message: skuState.message ?? undefined }}
          errors={errors}
          onNameChange={editor.setName}
          onSlugChange={(value, options) => editor.setSlug(value, options)}
          onRegenerateSlug={() => {
            editor.regenerateSlug();
            setSlugState({ checking: true, available: null, suggestion: null });
          }}
          onPatch={(value) => {
            if (value.productType === "SIMPLE" && state.variants.length > 1) {
              patch({ ...value, variants: state.variants.slice(0, 1).map((variant) => ({ ...variant, attributeValueIds: [] })) });
              return;
            }
            patch(value);
          }}
        />

        <PricingSection
          currentPrice={state.currentPrice}
          discountType={state.discountType}
          discountValue={state.discountValue}
          taxRateId={state.taxRateId}
          taxRates={data.taxRates}
          taxRateBps={state.taxRateBps}
          packagingTemplateId={state.packagingCostTemplateId}
          packagingTemplates={data.packagingTemplates}
          packagingCostPaisa={state.packagingCostPaisa}
          variantCount={state.variants.length}
          overrideCount={overrideCount}
          unpricedCount={unpricedCount}
          errors={errors}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
        />

        <OrganizationSection
          brandId={state.brandId}
          brands={brands}
          categories={categories}
          attributeCount={attributes.length}
          selectedCategoryIds={state.categoryIds}
          primaryCategoryId={state.primaryCategoryId}
          unitLabels={unitLabels}
          unitLabel={state.unitLabel}
          weightValue={state.weightValue}
          weightUnit={state.weightUnit}
          productUrlPrefix={data.productUrlPrefix}
          errors={errors}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
          onBrandCreated={(brand) => {
            setBrands((current) =>
              current.some((entry) => entry.id === brand.id)
                ? current
                : [{ id: brand.id, name: brand.name, slug: brand.slug, productCount: 0, logo: brand.logo }, ...current],
            );
          }}
          onCategoryCreated={(category) => setCategories((current) => (current.some((entry) => entry.id === category.id) ? current : [...current, category]))}
          onUnitLabelCreated={(label) =>
            setUnitLabels((current) =>
              current.some((entry) => entry.name.toLowerCase() === label.name.toLowerCase()) ? current : [...current, label],
            )
          }
        />

        <ProductImagesSection
          primaryImage={primaryImageItem}
          images={images}
          errors={errors}
          onPrimaryChange={(item) =>
            patch({
              primaryImage: item ? { mediaId: item.mediaId, asset: item.asset, altText: item.altText ?? null } : null,
            })
          }
          onImagesChange={(items) =>
            patch({
              images: items.map((item) => ({ mediaId: item.mediaId, asset: item.asset, altText: item.altText ?? null })),
            })
          }
        />

        {state.productType === "VARIABLE" ? (
          <AttributesVariationsSection
            productId={product?.id ?? draft.productId ?? null}
            attributes={attributes}
            state={state}
            plan={plan}
            errors={errors}
            rowErrors={variantErrors}
            selection={selection}
            productImage={productImage}
            productPricing={productPricing}
            inheritedWeight={state.weightValue}
            inheritedWeightUnit={state.weightUnit}
            variantEditMode={product ? "dialog" : "inline"}
            canViewCost={data.canViewCost}
            onApplied={() => router.refresh()}
            onPatch={(value) => patch(value as Partial<ProductEditorState>)}
            onAttributeCreated={(attribute) => setAttributes((current) => (current.some((entry) => entry.id === attribute.id) ? current : [...current, attribute]))}
            onValueAdded={(attributeId, value) =>
              setAttributes((current) =>
                current.map((attribute) =>
                  attribute.id === attributeId
                    ? {
                        ...attribute,
                        values: attribute.values.some((entry) => entry.id === value.id) ? attribute.values : [...attribute.values, { ...value, image: null }],
                      }
                    : attribute,
                ),
              )
            }
            onSetValueImage={setAttributeValueImage}
            onGenerateMatrix={() => editor.generateMatrix({ keepOrphans: true })}
            onUpdateVariant={editor.updateVariant}
            onAddVariant={editor.addVariant}
            onRemoveVariant={editor.removeVariant}
            onSelectionChange={setSelection}
            onLocalApply={(variants) => patch({ variants })}
          />
        ) : (
          <CollapsibleSection
            id="variants"
            title="Attributes, variations and bulk edit"
            description="Switch to a variable product to generate combinations and bulk-edit variants."
            defaultOpen
          >
            <p className="text-sm text-slate-600">
              This is a single product, so there is one variant and no option matrix. Choose <strong>Variable</strong> under product
              information to add attributes, generate combinations, then bulk-edit selected rows or every variant matching an attribute
              filter.
            </p>
          </CollapsibleSection>
        )}

        <ProductDescriptionSection
          shortDescription={state.shortDescription}
          description={state.description}
          onShortDescriptionChange={(value) => patch({ shortDescription: value })}
          onDescriptionChange={(value) => patch({ description: value })}
          canUpload={data.media.canUpload}
        />

        <ProductSettingsSection
          status={state.status}
          isPreorderEnabled={state.isPreorderEnabled}
          preorderNote={state.preorderNote}
          requiresShipping={state.requiresShipping}
          isFeatured={state.isFeatured}
          seoTitle={state.seoTitle}
          seoDescription={state.seoDescription}
          seoKeywords={state.seoKeywords}
          seoImage={state.seoImage}
          name={state.name}
          slug={state.slug}
          productUrlPrefix={data.productUrlPrefix}
          errors={errors}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
          onSeoImageChange={(asset) => patch({ seoImage: asset })}
        />
      </CollapsibleGroup>

      {/* Sticky action bar ------------------------------------------------ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:pl-[var(--admin-sidebar-width,16rem)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="flex items-center gap-1.5 text-xs text-slate-600" aria-live="polite">
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {saving === "draft" ? "Saving draft…" : product ? "Saving changes…" : "Creating product…"}
                </>
              ) : dirty ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  You have unsaved changes
                </>
              ) : saved ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Saved
                </>
              ) : (
                `${variantDefiningAttributes.length} variation attribute(s) · ${state.variants.length} variant(s)`
              )}
            </p>
            {product ? <DraftStatusBar draft={draft} onRetry={draft.retry} onDiscard={draft.discard} /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => (dirty ? setCancelOpen(true) : router.push("/admin/catalog/products"))} disabled={Boolean(saving)}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => submit(true)} disabled={Boolean(saving)}>
              {saving === "draft" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save as draft
            </Button>
            <Button type="button" onClick={() => submit(false)} disabled={Boolean(saving)}>
              {saving === "create" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {product ? "Save changes" : "Create product"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent
          title="Leave without publishing?"
          description={
            draft.lastSavedAt
              ? "Your work is stored as a draft, so you can pick it up from the product list. Choosing “Discard draft” deletes that copy."
              : "This form has changes that have not been saved to the product yet."
          }
          className="max-w-md"
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCancelOpen(false);
                setSaved(true);
                void draft.saveNow();
                router.push("/admin/catalog/products");
              }}
            >
              Save draft and leave
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setCancelOpen(false);
                setSaved(true);
                void draft.discard();
                router.push("/admin/catalog/products");
              }}
            >
              Discard draft and leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
