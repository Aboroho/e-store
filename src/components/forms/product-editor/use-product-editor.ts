"use client";

import * as React from "react";
import { parseRichText } from "@/components/rich-text-editor/serialization";
import type { RichTextDocument } from "@/components/rich-text-editor/types";
import type { MediaAssetView } from "@/modules/media/service";
import {
  DEFAULT_WEIGHT_UNIT,
  fromWeightGrams,
  isWeightUnit,
  planMatrix,
  suggestSlug,
  toWeightGrams,
  type DiscountType,
  type DraftAttribute,
  type DraftVariant,
  type WeightUnit,
} from "@/modules/catalog/product-draft";
import type { EditorAttribute, EditorImage, EditorProduct } from "@/modules/catalog/product-queries";

/**
 * All editor state for the product form, in one place.
 *
 * The state is a plain object with narrow setters so that:
 *  - collapsing a section, opening a dialog or expanding the rich-text editor can
 *    never touch it (the data lives here, not inside those components);
 *  - "is this dirty?" is a comparison against the snapshot the form opened with;
 *  - the slug keeps following the name until a person edits it, and only then stops;
 *  - one serialisable object is everything autosave needs to persist.
 *
 * SKU belongs to the product (`productCode`); variant rows never carry one — they
 * are identified by their persisted id and their attribute combination.
 */

export interface EditorImageItem {
  mediaId: string;
  asset: MediaAssetView;
  altText: string | null;
}

export interface ProductEditorState {
  name: string;
  slug: string;
  slugTouched: boolean;
  /** The product's SKU — the only SKU in the workflow. */
  productCode: string;
  barcode: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  brandId: string | null;
  unitLabel: string;
  unitLabelId: string | null;
  weightValue: string;
  weightUnit: WeightUnit;
  categoryIds: string[];
  primaryCategoryId: string | null;
  /** Attributes used for this product (variation or descriptive). */
  attributeIds: string[];
  /** Attribute values chosen for variation — the source of the variant matrix. */
  selectedValueIds: string[];
  shortDescription: RichTextDocument;
  description: RichTextDocument;
  images: EditorImageItem[];
  seoImage: MediaAssetView | null;
  attributeValueImages: Record<string, string | null>;

  /* Product default pricing — level 3 of the inheritance model. */
  currentPrice: string;
  discountType: DiscountType;
  discountValue: string;
  /** Derived sell price (shown read-only; sent so the server can cross-check). */
  defaultPrice: string;
  defaultCost: string;

  taxRateId: string | null;
  taxRateBps: string;
  packagingCostTemplateId: string | null;
  packagingCostPaisa: string;
  requiresShipping: boolean;
  isFeatured: boolean;
  isPreorderEnabled: boolean;
  preorderNote: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  variants: DraftVariant[];
}

export interface ProductEditorInitial {
  product: EditorProduct | null;
  attributes: EditorAttribute[];
  categories: Array<{ id: string }>;
  unitLabels: Array<{ id: string | null; name: string; isDefault: boolean }>;
}

function paisaToInput(paisa: number | null | undefined): string {
  if (paisa == null) return "";
  return (paisa / 100).toFixed(2);
}

function buildInitialState(initial: ProductEditorInitial): ProductEditorState {
  const { product } = initial;

  const variants: DraftVariant[] = product
    ? product.variants.map((variant) => ({
        key: variant.id,
        id: variant.id,
        name: variant.name,
        barcode: variant.barcode ?? "",
        currentPrice: paisaToInput(variant.currentPricePaisa),
        discountType: variant.discountType ?? "NONE",
        discountValue: variant.discountValue ? String(variant.discountValue) : "",
        price: paisaToInput(variant.priceOverridePaisa),
        compareAt: paisaToInput(variant.compareAtPricePaisa),
        cost: paisaToInput(variant.costPaisa),
        weight: fromWeightGrams(variant.weightGrams, isWeightUnit(variant.weightUnit) ? variant.weightUnit : DEFAULT_WEIGHT_UNIT),
        weightUnit: isWeightUnit(variant.weightUnit) ? variant.weightUnit : DEFAULT_WEIGHT_UNIT,
        isPreorderEnabled: variant.isPreorderEnabled ?? undefined,
        packagingCost: paisaToInput(variant.packagingCostPaisa),
        imageMediaId: variant.imageMediaId,
        galleryMediaIds: variant.gallery.map((asset) => asset.id),
        attributeValueIds: variant.attributeValueIds,
        touched: true,
      }))
    : [emptyVariant("default", [])];

  const images: EditorImageItem[] = (product?.images ?? []).map((image: EditorImage) => ({
    mediaId: image.id,
    asset: image,
    altText: image.altText ?? null,
  }));

  return {
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    slugTouched: Boolean(product),
    productCode: product?.productCode ?? "",
    barcode: product?.barcode ?? "",
    status: (product?.status as ProductEditorState["status"]) ?? "DRAFT",
    brandId: product?.brandId ?? null,
    unitLabel: product?.unitLabel ?? initial.unitLabels.find((label) => label.isDefault)?.name ?? "piece",
    unitLabelId: product?.unitLabelId ?? null,
    weightValue: product?.weightGrams != null ? fromWeightGrams(product.weightGrams, isWeightUnit(product.weightUnit) ? product.weightUnit : DEFAULT_WEIGHT_UNIT) : "",
    weightUnit: isWeightUnit(product?.weightUnit) ? product.weightUnit : DEFAULT_WEIGHT_UNIT,
    categoryIds: product?.categoryIds ?? [],
    primaryCategoryId: product?.primaryCategoryId ?? null,
    attributeIds: product?.attributeIds ?? [],
    selectedValueIds: product ? [...new Set(product.variants.flatMap((variant) => variant.attributeValueIds))] : [],
    shortDescription: parseRichText(product?.shortDescription),
    description: parseRichText(product?.description),
    images,
    seoImage: product?.seoImage ?? null,
    attributeValueImages: defaultAttributeValueImages(initial.attributes),
    currentPrice: paisaToInput(product?.currentPricePaisa),
    discountType: product?.discountType ?? "NONE",
    discountValue: product?.discountValue ? String(product.discountValue) : "",
    defaultPrice: paisaToInput(product?.defaultPricePaisa),
    defaultCost: paisaToInput(product?.defaultCostPaisa),
    taxRateBps: String(product?.taxRateBps ?? 0),
    taxRateId: product?.taxRateId ?? null,
    packagingCostTemplateId: product?.packagingCostTemplateId ?? null,
    packagingCostPaisa: product ? (product.packagingCostPaisa / 100).toFixed(2) : "0.00",
    requiresShipping: product?.requiresShipping ?? true,
    isFeatured: product?.isFeatured ?? false,
    isPreorderEnabled: product?.isPreorderEnabled ?? false,
    preorderNote: product?.preorderNote ?? "",
    seoTitle: product?.seoTitle ?? "",
    seoDescription: product?.seoDescription ?? "",
    seoKeywords: product?.seoKeywords ?? "",
    variants,
  };
}

export function toDraftAttribute(attribute: EditorAttribute): DraftAttribute {
  return {
    id: attribute.id,
    name: attribute.name,
    slug: attribute.slug,
    type: attribute.type,
    isVariantDefining: attribute.isVariantDefining,
    values: attribute.values.map((value) => ({
      id: value.id,
      value: value.value,
      colorHex: value.colorHex,
      mediaId: value.mediaId,
      priceOverridePaisa: value.priceOverridePaisa ?? null,
      currentPricePaisa: value.currentPricePaisa ?? null,
      discountType: value.discountType ?? "NONE",
      discountValue: value.discountValue ?? 0,
    })),
  };
}

/** Attribute-value default images, keyed by attribute value id. */
function defaultAttributeValueImages(attributes: EditorAttribute[]): Record<string, string | null> {
  const images: Record<string, string | null> = {};
  for (const attribute of attributes) {
    for (const value of attribute.values) {
      if (value.mediaId) images[value.id] = value.mediaId;
    }
  }
  return images;
}

function emptyVariant(key: string, attributeValueIds: string[]): DraftVariant {
  return {
    key,
    name: "",
    currentPrice: "",
    discountType: "NONE",
    discountValue: "",
    price: "",
    compareAt: "",
    cost: "",
    weight: "",
    weightUnit: DEFAULT_WEIGHT_UNIT,
    isPreorderEnabled: undefined,
    packagingCost: "",
    imageMediaId: null,
    galleryMediaIds: [],
    attributeValueIds,
    touched: false,
  };
}

export interface ProductEditorApi {
  state: ProductEditorState;
  /** True when anything differs from what the form opened with. */
  dirty: boolean;
  setName: (value: string) => void;
  setSlug: (value: string, options?: { manual?: boolean }) => void;
  regenerateSlug: () => string;
  patch: (patch: Partial<ProductEditorState>) => void;
  updateVariant: (key: string, patch: Partial<DraftVariant>, options?: { touched?: boolean }) => void;
  updateVariants: (updater: (rows: DraftVariant[]) => DraftVariant[]) => void;
  addVariant: () => void;
  removeVariant: (key: string) => void;
  generateMatrix: (options?: { keepOrphans?: boolean }) => { added: number; kept: number; orphans: number };
  reset: (next: ProductEditorState) => void;
}

export function useProductEditor(initial: ProductEditorInitial): ProductEditorApi {
  const [state, setState] = React.useState<ProductEditorState>(() => buildInitialState(initial));
  const snapshot = React.useRef(JSON.stringify(state));
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setDirty(JSON.stringify(state) !== snapshot.current);
  }, [state]);

  const patch = React.useCallback((next: Partial<ProductEditorState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const setName = React.useCallback((value: string) => {
    setState((current) => {
      const next = { ...current, name: value };
      // The slug keeps following the name until someone edits it by hand.
      if (!current.slugTouched) next.slug = suggestSlug(value);
      return next;
    });
  }, []);

  const setSlug = React.useCallback((value: string, options?: { manual?: boolean }) => {
    setState((current) => ({ ...current, slug: value, slugTouched: options?.manual ?? true }));
  }, []);

  const regenerateSlug = React.useCallback(() => {
    let generated = "";
    setState((current) => {
      generated = suggestSlug(current.name);
      return { ...current, slug: generated, slugTouched: true };
    });
    return generated;
  }, []);

  const updateVariant = React.useCallback((key: string, changes: Partial<DraftVariant>, options?: { touched?: boolean }) => {
    setState((current) => ({
      ...current,
      variants: current.variants.map((variant) =>
        variant.key === key ? { ...variant, ...changes, touched: options?.touched ?? variant.touched ?? true } : variant,
      ),
    }));
  }, []);

  const updateVariants = React.useCallback((updater: (rows: DraftVariant[]) => DraftVariant[]) => {
    setState((current) => ({ ...current, variants: updater(current.variants) }));
  }, []);

  const addVariant = React.useCallback(() => {
    setState((current) => {
      const index = current.variants.length;
      return {
        ...current,
        variants: [
          ...current.variants,
          { ...emptyVariant(`manual-${Date.now()}-${index}`, []), name: `Variant ${index + 1}`, touched: true },
        ],
      };
    });
  }, []);

  const removeVariant = React.useCallback((key: string) => {
    setState((current) => ({ ...current, variants: current.variants.filter((variant) => variant.key !== key) }));
  }, []);

  const generateMatrix = React.useCallback(
    (options?: { keepOrphans?: boolean }) => {
      let summary = { added: 0, kept: 0, orphans: 0 };
      setState((current) => {
        const attributes = initial.attributes
          .map(toDraftAttribute)
          .filter((attribute) => current.attributeIds.includes(attribute.id));
        const plan = planMatrix(attributes, current.selectedValueIds, current.variants, {
          keepOrphans: options?.keepOrphans ?? true,
        });
        summary = { added: plan.added.length, kept: plan.kept.length, orphans: plan.orphans.length };
        return { ...current, variants: plan.rows };
      });
      return summary;
    },
    [initial.attributes],
  );

  const reset = React.useCallback((next: ProductEditorState) => {
    snapshot.current = JSON.stringify(next);
    setState(next);
    setDirty(false);
  }, []);

  return { state, dirty, setName, setSlug, regenerateSlug, patch, updateVariant, updateVariants, addVariant, removeVariant, generateMatrix, reset };
}

/** Weight of the product in grams, from the value+unit pair the user sees. */
export function productWeightGrams(state: Pick<ProductEditorState, "weightValue" | "weightUnit">): number | null {
  return toWeightGrams(state.weightValue, state.weightUnit);
}
