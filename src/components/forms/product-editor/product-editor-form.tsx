"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { cn } from "@/lib/utils";
import { CollapsibleGroup } from "@/components/ui/collapsible";
import {
  checkProductSkusAction,
  checkProductSlugAction,
  listBrandsAction,
  saveProductAction,
  setAttributeValueImageAction,
} from "@/modules/catalog/product-actions";
import {
  DEFAULT_WEIGHT_UNIT,
  combinationKey,
  normalizeSku,
  planMatrix,
  toWeightGrams,
  type DraftVariant,
} from "@/modules/catalog/product-draft";
import type { EditorAttribute, EditorCategory, ProductEditorData } from "@/modules/catalog/product-queries";
import type { RichTextDocument } from "@/components/rich-text-editor/types";
import { isRichTextEmpty } from "@/components/rich-text-editor/serialization";
import { BasicInformationSection, DescriptionSection, InventorySection, OrganizationSection, PricingSection, ProductImagesSection, SeoSection } from "./sections";
import { AttributesVariationsSection, BulkActionsSection } from "./variations";
import { useProductEditor, toDraftAttribute, type ProductEditorState } from "./use-product-editor";
import type { MediaGalleryItem } from "@/components/media/media-field";

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

const SECTIONS = [
  { id: "basic", label: "Basic information" },
  { id: "organization", label: "Organisation" },
  { id: "descriptions", label: "Description" },
  { id: "images", label: "Images" },
  { id: "attributes", label: "Attributes & variations" },
  { id: "bulk", label: "Bulk actions" },
  { id: "pricing", label: "Pricing" },
  { id: "inventory", label: "Inventory" },
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
  const [saving, setSaving] = React.useState<null | "draft" | "create">(null);
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
        skuPrefix: normalizeSku(state.productCode) || "SKU",
        keepOrphans: true,
      }),
    [draftAttributes, state.selectedValueIds, state.variants, state.productCode],
  );

  /* ------------------------------------------------------------- slug check */

  // Typing invalidates the previous verdict immediately (render-time adjustment);
  // only the network round-trip lives in the effect, debounced.
  const [previousSlug, setPreviousSlug] = React.useState(state.slug);
  if (state.slug !== previousSlug) {
    setPreviousSlug(state.slug);
    setSlugState({ checking: state.slug.trim().length > 0, available: null, suggestion: null });
  }

  React.useEffect(() => {
    const slug = state.slug.trim();
    if (!slug) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await checkProductSlugAction({ slug, productId: product?.id });
      if (cancelled) return;
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
  }, [state.slug, product?.id]);

  /* -------------------------------------------------------- SKU uniqueness */

  const variantSignature = state.variants.map((variant) => `${variant.key}:${normalizeSku(variant.sku)}`).join("|");

  const skuCheckKey = `${state.productCode}::${variantSignature}`;
  const [previousSkuCheckKey, setPreviousSkuCheckKey] = React.useState(skuCheckKey);
  if (skuCheckKey !== previousSkuCheckKey) {
    setPreviousSkuCheckKey(skuCheckKey);
    setSkuState({ checking: true, message: null });
  }

  React.useEffect(() => {
    const entries = state.variants
      .map((variant) => ({ key: variant.key, sku: normalizeSku(variant.sku) }))
      .filter((entry) => entry.sku.length > 0);

    let cancelled = false;
    const handle = setTimeout(async () => {
      if (entries.length === 0 && !normalizeSku(state.productCode)) {
        setVariantErrors({});
        setSkuState({ checking: false, message: null });
        return;
      }
      const result = await checkProductSkusAction({
        productId: product?.id,
        productCode: normalizeSku(state.productCode) || undefined,
        variantSkus: entries,
      });
      if (cancelled) return;
      if (!result.ok) {
        setSkuState({ checking: false, message: null });
        return;
      }
      const next: Record<string, string> = {};
      for (const [key, entry] of Object.entries(result.data.variants)) {
        if (!entry.available && entry.message) next[key] = entry.message;
      }
      setVariantErrors(next);
      setSkuState({
        checking: false,
        message: result.data.productCode.available ? null : result.data.productCode.message ?? "This product code is already taken.",
      });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature string captures every variant SKU
  }, [variantSignature, state.productCode, product?.id]);

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
  const productImage = state.images[0]?.asset ?? null;
  const variantDefiningAttributes = draftAttributes.filter((attribute) => attribute.isVariantDefining !== false);

  const completion = React.useMemo(() => {
    const pricedVariants = state.variants.filter((variant) => (toPaisa(variant.price) ?? 0) > 0).length;
    const variantSkusOk = state.variants.length > 0 && state.variants.every((variant) => normalizeSku(variant.sku).length >= 2);
    return {
      basic: state.name.trim().length >= 2 && state.slug.trim().length > 0 && normalizeSku(state.productCode).length >= 2,
      organization: state.categoryIds.length > 0 && state.unitLabel.trim().length > 0 && isNonNegativeNumber(state.weightValue),
      descriptions: !isRichTextEmpty(state.shortDescription) || !isRichTextEmpty(state.description),
      images: state.images.length > 0,
      attributes: variantSkusOk,
      bulk: false,
      pricing: state.variants.length > 0 && pricedVariants === state.variants.length,
      inventory: true,
      seo: Boolean(state.seoTitle.trim() || state.seoDescription.trim()),
    } satisfies Record<(typeof SECTIONS)[number]["id"], boolean>;
  }, [state]);

  const completedCount = SECTIONS.filter((section) => section.id !== "bulk" && completion[section.id]).length;

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

    const seenSkus = new Map<string, string[]>();
    const seenCombos = new Map<string, string[]>();
    for (const variant of state.variants) {
      const sku = normalizeSku(variant.sku);
      if (sku.length < 2) rowErrors[variant.key] = "Enter a code of at least 2 characters.";
      else if (!/^[A-Za-z0-9._\-/]+$/.test(sku)) rowErrors[variant.key] = "Use letters, numbers, dot, dash, underscore and slash only.";
      else if (sku === normalizeSku(state.productCode)) rowErrors[variant.key] = "This code is the product code — variants need their own code.";
      seenSkus.set(sku, [...(seenSkus.get(sku) ?? []), variant.key]);

      if (variant.attributeValueIds.length > 0) {
        const key = combinationKey(variant.attributeValueIds);
        seenCombos.set(key, [...(seenCombos.get(key) ?? []), variant.key]);
      }
      if (!isNonNegativeNumber(variant.price ?? "")) rowErrors[variant.key] = "Price must be a number of 0 or more.";
      else if ((toPaisa(variant.price) ?? 0) <= 0 && state.status !== "DRAFT") {
        rowErrors[variant.key] = "Set a price before publishing, or save the product as a draft.";
      }
      if (!isNonNegativeNumber(variant.compareAt ?? "")) rowErrors[variant.key] = "Compare-at price must be a number of 0 or more.";
      if (!isNonNegativeNumber(variant.weight ?? "")) rowErrors[variant.key] = "Weight must be a number of 0 or more.";
    }

    for (const [sku, keys] of seenSkus) {
      if (keys.length > 1) for (const key of keys) rowErrors[key] = `${sku} is used by more than one variant.`;
    }
    for (const keys of seenCombos.values()) {
      if (keys.length > 1) for (const key of keys) rowErrors[key] = "Two variants cannot have the same combination of options.";
    }

    // Surface the worst row problem at section level too, so the summary is never silent.
    const rowMessages = [...new Set(Object.values(rowErrors))];
    if (rowMessages.length > 0) next.variants = rowMessages.slice(0, 3);

    return { errors: next, variantErrors: rowErrors };
  };

  const buildPayload = (saveAsDraft: boolean) => {
    const variantDefining = state.attributeIds.filter(
      (id) => attributes.find((attribute) => attribute.id === id)?.isVariantDefining !== false,
    );
    return {
      productId: product?.id,
      expectedUpdatedAt: product?.updatedAt,
      name: state.name.trim(),
      slug: state.slug.trim(),
      productCode: normalizeSku(state.productCode),
      barcode: state.barcode.trim() || undefined,
      productType: (state.variants.length > 1 || variantDefining.length > 0 ? "VARIABLE" : "SIMPLE") as "SIMPLE" | "VARIABLE",
      status: saveAsDraft && !product ? ("DRAFT" as const) : state.status,
      brandId: state.brandId,
      unitLabel: state.unitLabel.trim(),
      categoryIds: state.categoryIds,
      primaryCategoryId: state.primaryCategoryId,
      attributeIds: state.attributeIds,
      shortDescription: state.shortDescription,
      description: state.description,
      primaryImage: state.images[0] ? { mediaId: state.images[0].mediaId, altText: state.images[0].altText ?? null } : null,
      images: state.images.slice(1).map((image) => ({ mediaId: image.mediaId, altText: image.altText ?? null })),
      seoImage: state.seoImage ? { mediaId: state.seoImage.id, altText: state.seoImage.altText ?? null } : null,
      attributeValueImages: Object.fromEntries(
        Object.entries(state.attributeValueImages).filter(([, mediaId]) => Boolean(mediaId)),
      ) as Record<string, string>,
      weightValue: state.weightValue.trim() ? Number(state.weightValue) : null,
      weightUnit: state.weightUnit ?? DEFAULT_WEIGHT_UNIT,
      taxRateBps: state.taxRateBps.trim() ? Number(state.taxRateBps) : 0,
      packagingCostPaisa: toPaisa(state.packagingCostPaisa) ?? 0,
      defaultPricePaisa: toPaisa(state.defaultPrice),
      requiresShipping: state.requiresShipping,
      isFeatured: state.isFeatured,
      isPreorderEnabled: state.isPreorderEnabled,
      preorderNote: state.preorderNote.trim() || undefined,
      openingStock: Object.entries(state.openingStock)
        .map(([variantKey, quantity]) => ({ variantKey, quantity: Number(quantity) }))
        .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0),
      recordOpeningStock: state.recordOpeningStock,
      seoTitle: state.seoTitle.trim() || undefined,
      seoDescription: state.seoDescription.trim() || undefined,
      seoKeywords: state.seoKeywords.trim() || undefined,
      variants: state.variants.map((variant: DraftVariant) => ({
        id: variant.id,
        name: variant.name.trim() || variant.sku || "Variant",
        sku: normalizeSku(variant.sku),
        barcode: variant.barcode?.trim() || undefined,
        pricePaisa: toPaisa(variant.price) ?? 0,
        compareAtPricePaisa: toPaisa(variant.compareAt) ?? undefined,
        costPaisa: toPaisa(variant.cost) ?? undefined,
        weightGrams: toWeightGrams(variant.weight ?? "", variant.weightUnit ?? state.weightUnit) ?? undefined,
        weightUnit: variant.weightUnit ?? state.weightUnit,
        isPreorderEnabled: Boolean(variant.isPreorderEnabled),
        imageMediaId: variant.imageMediaId,
        galleryMediaIds: variant.galleryMediaIds,
        attributeValueIds: variant.attributeValueIds,
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
      document.getElementById("basic")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setSaving(saveAsDraft ? "draft" : "create");
    const result = await saveProductAction(buildPayload(saveAsDraft));
    if (result.ok) {
      setSaved(true);
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
    const result = await setAttributeValueImageAction({ attributeValueId, mediaId, productId: product?.id });
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

      <CollapsibleGroup
        defaultOpen={["basic", "organization"]}
        header={
          <div className="mr-auto flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={completedCount === SECTIONS.length - 1 ? "success" : "neutral"}>
              {completedCount}/{SECTIONS.length - 1} sections complete
            </Badge>
            <span className="flex flex-wrap items-center gap-1.5">
              {SECTIONS.map((section) => (
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
          status={state.status}
          productUrlPrefix={data.productUrlPrefix}
          slugState={slugState}
          skuState={{ checking: skuState.checking, message: skuState.message ?? undefined }}
          errors={errors}
          onNameChange={editor.setName}
          onSlugChange={(value, options) => editor.setSlug(value, options)}
          onRegenerateSlug={() => {
            const slug = editor.regenerateSlug();
            setSlugState({ checking: true, available: null, suggestion: null });
            void slug;
          }}
          onPatch={(value) => patch(value)}
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
            // Refresh in the background so the counter and logo come from the server.
            void listBrandsAction().then((result) => {
              if (result.ok) setBrands(result.data.map(toBrandChoice));
            });
          }}
          onCategoryCreated={(category) => setCategories((current) => (current.some((entry) => entry.id === category.id) ? current : [...current, category]))}
          onUnitLabelCreated={(label) =>
            setUnitLabels((current) =>
              current.some((entry) => entry.name.toLowerCase() === label.name.toLowerCase()) ? current : [...current, label],
            )
          }
        />

        <DescriptionSection
          shortDescription={state.shortDescription}
          description={state.description}
          canUpload={data.media.canUpload && data.media.configured}
          onShortChange={(value: RichTextDocument) => patch({ shortDescription: value })}
          onDescriptionChange={(value: RichTextDocument) => patch({ description: value })}
        />

        <ProductImagesSection
          images={images}
          errors={errors}
          onChange={(items) =>
            patch({
              images: items.map((item) => ({ mediaId: item.mediaId, asset: item.asset, altText: item.altText ?? null })),
            })
          }
        />

        <AttributesVariationsSection
          attributes={attributes}
          state={state}
          plan={plan}
          errors={errors}
          rowErrors={variantErrors}
          selection={selection}
          productImage={productImage}
          canViewCost={data.canViewCost}
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
        />

        <BulkActionsSection
          productId={product?.id ?? null}
          state={state}
          selection={selection}
          attributes={attributes}
          productImage={productImage}
          canViewCost={data.canViewCost}
          onApplied={() => router.refresh()}
        />

        <PricingSection
          defaultPrice={state.defaultPrice}
          taxRateBps={state.taxRateBps}
          packagingCostPaisa={state.packagingCostPaisa}
          defaultPriceListName={data.priceListName}
          variantCount={state.variants.length}
          variantPriceCount={state.variants.filter((variant) => (toPaisa(variant.price) ?? 0) > 0).length}
          unpricedCount={state.variants.filter((variant) => (toPaisa(variant.price) ?? 0) <= 0).length}
          canViewCost={data.canViewCost}
          errors={errors}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
          onApplyDefaultPrice={() =>
            patch({
              variants: state.variants.map((variant) =>
                (toPaisa(variant.price) ?? 0) > 0 ? variant : { ...variant, price: state.defaultPrice.trim() },
              ),
            })
          }
        />

        <InventorySection
          requiresShipping={state.requiresShipping}
          isPreorderEnabled={state.isPreorderEnabled}
          preorderNote={state.preorderNote}
          rows={state.variants.map((variant) => ({ key: variant.key, name: variant.name, sku: variant.sku }))}
          openingStock={state.openingStock}
          recordOpeningStock={state.recordOpeningStock}
          errors={errors}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
          onOpeningStockChange={(key, value) => patch({ openingStock: { ...state.openingStock, [key]: value } })}
        />

        <SeoSection
          seoTitle={state.seoTitle}
          seoDescription={state.seoDescription}
          seoKeywords={state.seoKeywords}
          seoImage={state.seoImage}
          name={state.name}
          slug={state.slug}
          productUrlPrefix={data.productUrlPrefix}
          onPatch={(value) => patch(value as Partial<ProductEditorState>)}
          onSeoImageChange={(asset) => patch({ seoImage: asset })}
        />
      </CollapsibleGroup>

      {/* Sticky action bar ------------------------------------------------ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:pl-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
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
          title="Discard your changes?"
          description="This form has changes that have not been saved. Leaving now discards them."
          className="max-w-md"
        >
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setCancelOpen(false);
                setSaved(true);
                router.push("/admin/catalog/products");
              }}
            >
              Discard and leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
