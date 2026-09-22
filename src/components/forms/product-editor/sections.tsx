"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import { Alert, Badge, Button, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/tooltip";
import { CollapsibleSection } from "@/components/ui/collapsible";
import { MediaField, MediaGalleryField, type MediaGalleryItem } from "@/components/media/media-field";
import { MediaPicker } from "@/components/media/media-picker";
import { RichTextEditor } from "@/components/rich-text-editor";
import { assetToRichTextAsset, uploadToMediaLibrary } from "@/components/media/media-upload";
import { Combobox, FieldWithTip } from "./combobox";
import { AddAttributeValueInline, CreateAttributeDialog, CreateBrandDialog, CreateCategoryDialog } from "./product-dialogs";
import { slugPreview } from "./product-url";
import { WEIGHT_UNITS, type WeightUnit } from "@/modules/catalog/product-draft";
import { formatPaisa } from "@/lib/money";
import { calculatePricing, validateDiscount } from "@/modules/catalog/pricing-rules";
import type { EditorAttribute, EditorCategory } from "@/modules/catalog/product-queries";
import type { MediaAssetView } from "@/modules/media/service";
import type { RichTextDocument } from "@/components/rich-text-editor/types";

/* -------------------------------------------------------------------------- */
/* Basic information                                                          */
/* -------------------------------------------------------------------------- */

export function BasicInformationSection({
  name,
  slug,
  slugTouched,
  productCode,
  barcode,
  productUrlPrefix,
  slugState,
  skuState,
  errors,
  onNameChange,
  onSlugChange,
  onRegenerateSlug,
  onPatch,
  shortDescription,
  description,
  onShortDescriptionChange,
  onDescriptionChange,
  canUpload,
}: {
  name: string;
  slug: string;
  slugTouched: boolean;
  productCode: string;
  barcode: string;
  productUrlPrefix: string | null;
  slugState: { checking: boolean; available: boolean | null; suggestion: string | null };
  skuState: { checking: boolean; message?: string };
  errors: Record<string, string[]>;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string, options?: { manual?: boolean }) => void;
  onRegenerateSlug: () => void;
  onPatch: (patch: { barcode?: string; productCode?: string }) => void;
  /** Rich-text documents live with the product information, not with the settings. */
  shortDescription?: RichTextDocument;
  description?: RichTextDocument;
  onShortDescriptionChange?: (value: RichTextDocument) => void;
  onDescriptionChange?: (value: RichTextDocument) => void;
  canUpload?: boolean;
}) {
  return (
    <CollapsibleSection
      id="information"
      title="Product information"
      description="What the product is called, how it is identified and what it is. Every variant inherits these values."
      icon={<Tag className="h-4 w-4" />}
      defaultOpen
      badge={name ? "In progress" : "Required"}
      badgeTone={name ? "success" : "warning"}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="product-name" className="text-slate-800">
              Product name <span className="text-red-500">*</span>
            </Label>
            <InfoTip>
              The name shoppers see on the storefront, in search engines and on invoices. It also drives the suggested URL slug.
            </InfoTip>
          </div>
          <Input
            id="product-name"
            value={name}
            required
            maxLength={200}
            autoComplete="off"
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Classic Black Leather Shoes"
            aria-describedby="product-name-counter"
          />
          <div className="flex items-center justify-between text-xs">
            <span id="product-name-counter" className={name.length > 200 ? "text-red-600" : "text-slate-500"}>
              {name.length}/200 characters
            </span>
            {errors.name ? <span className="text-red-600">{errors.name[0]}</span> : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="product-slug" className="text-slate-800">
              URL slug <span className="text-red-500">*</span>
            </Label>
            <InfoTip>
              The last part of the product address. It is suggested from the name and stays editable; changing it later changes the
              product URL, so search engines may need to re-index the page.
            </InfoTip>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="product-slug"
              value={slug}
              maxLength={80}
              onChange={(event) => onSlugChange(event.target.value, { manual: true })}
              onBlur={(event) => onSlugChange(event.target.value.trim(), { manual: true })}
            />
            <Button type="button" variant="outline" size="sm" onClick={onRegenerateSlug} disabled={!name}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Regenerate
            </Button>
          </div>
          <div className="space-y-1 text-xs">
            <p className="truncate text-slate-500" title={slugPreview(productUrlPrefix, slug)}>
              {slugPreview(productUrlPrefix, slug)}
            </p>
            <p className="flex items-center gap-1.5">
              {slugState.checking ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-hidden="true" />
                  <span className="text-slate-500">Checking availability…</span>
                </>
              ) : slugState.available === false ? (
                <>
                  <span className="text-amber-700">Already used by another product.</span>
                  {slugState.suggestion ? (
                    <button
                      type="button"
                      className="font-medium text-brand-700 underline"
                      onClick={() => onSlugChange(slugState.suggestion!, { manual: true })}
                    >
                      Use {slugState.suggestion}
                    </button>
                  ) : null}
                </>
              ) : slugState.available ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                  <span className="text-emerald-700">Available</span>
                </>
              ) : null}
            </p>
            <p className="text-slate-400">
              {slugTouched ? "Edited by you — the name will not overwrite it." : "Follows the product name until you edit it."} Creating a
              slug never publishes the product.
            </p>
            {errors.slug ? <p className="text-red-600">{errors.slug[0]}</p> : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="product-code" className="text-slate-800">
              Product code (SKU) <span className="text-red-500">*</span>
            </Label>
            <InfoTip>
              The product&apos;s stock keeping unit — the only SKU in the system. Variants do not carry their own code: they are identified by
              their options in inventory, purchasing, orders and reports.
            </InfoTip>
          </div>
          <Input
            id="product-code"
            value={productCode}
            required
            maxLength={64}
            autoComplete="off"
            onChange={(event) => onPatch({ productCode: event.target.value })}
            placeholder="SHOE-CLASSIC-01"
          />
          <p className="text-xs">
            {skuState.checking ? (
              <span className="text-slate-500">Checking…</span>
            ) : skuState.message ? (
              <span className="text-amber-700">{skuState.message}</span>
            ) : (
              <span className="text-slate-500">Unique inside your business. Letters, numbers, dot, dash, underscore and slash.</span>
            )}
          </p>
          {errors.productCode ? <p className="text-xs text-red-600">{errors.productCode[0]}</p> : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="product-barcode" className="text-slate-800">
              Barcode
            </Label>
            <InfoTip>Optional EAN/UPC printed on the packaging. Used by the barcode scan box on packing screens.</InfoTip>
          </div>
          <Input id="product-barcode" value={barcode} maxLength={64} onChange={(event) => onPatch({ barcode: event.target.value })} />
        </div>
      </div>

      {onShortDescriptionChange || onDescriptionChange ? (
        <div className="mt-5 space-y-6 border-t border-slate-200 pt-5">
          {onShortDescriptionChange ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-slate-800">Short description</Label>
                <InfoTip>
                  One or two sentences shown in listings, category tiles and search results. Keep it plain: it is also used as the
                  fallback meta description.
                </InfoTip>
              </div>
              <RichTextEditor
                value={shortDescription}
                onChange={onShortDescriptionChange}
                aria-label="Short description"
                expandedTitle="Short description"
                placeholder="Lightweight leather shoes for everyday wear."
                minHeight={140}
                maxHeight={260}
                features={{ heading: false, table: false, taskList: false, image: true, file: false, blockquote: false, codeBlock: false, horizontalRule: false }}
                toolbar={{ items: ["bold", "italic", "underline", "strike", "link", "bulletList", "orderedList", "image", "clearFormatting", "undo", "redo", "expand"] }}
                onUpload={canUpload ? uploadToMediaLibrary : undefined}
                renderMediaLibrary={({ kind, onSelect }) => <MediaLibraryTrigger kind={kind} onSelect={onSelect} />}
              />
            </div>
          ) : null}
          {onDescriptionChange ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-slate-800">Long description</Label>
                <InfoTip>
                  The full product story on the product page. Images and video are picked from the shared media library, so the same asset
                  is never uploaded twice and never deleted while a description uses it.
                </InfoTip>
              </div>
              <RichTextEditor
                value={description}
                onChange={onDescriptionChange}
                aria-label="Long description"
                expandedTitle="Long description"
                placeholder="Describe the materials, sizing, care instructions… Press / for headings, lists, images and video."
                minHeight={260}
                expandable
                onUpload={canUpload ? uploadToMediaLibrary : undefined}
                renderMediaLibrary={({ kind, onSelect }) => <MediaLibraryTrigger kind={kind} onSelect={onSelect} />}
              />
              <p className="text-xs text-slate-500">
                Use “Expand editor” for a full-screen writing surface. Content is structured JSON, never raw HTML: unsupported formatting
                is rejected on save.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </CollapsibleSection>
  );
}

function MediaLibraryTrigger({ kind, onSelect }: { kind: "image" | "file"; onSelect: (asset: { id?: string | null; url: string; name?: string; mimeType?: string; size?: number; width?: number; height?: number; alt?: string }) => void }) {
  return (
    <MediaPicker
      title={kind === "image" ? "Insert image" : "Insert video or file"}
      mimeGroup={kind === "image" ? "image" : "all"}
      trigger={
        <Button type="button" variant="outline" className="w-full">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          Choose from media library
        </Button>
      }
      onSelect={(asset) => {
        const converted = assetToRichTextAsset(asset);
        if (converted) onSelect(converted);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Organisation                                                               */
/* -------------------------------------------------------------------------- */

export function OrganizationSection({
  brandId,
  brands,
  categories,
  attributeCount,
  selectedCategoryIds,
  primaryCategoryId,
  unitLabels,
  unitLabel,
  weightValue,
  weightUnit,
  productUrlPrefix,
  errors,
  onPatch,
  onBrandCreated,
  onCategoryCreated,
  onUnitLabelCreated,
}: {
  brandId: string | null;
  brands: Array<{ id: string; name: string; slug: string; productCount: number; logo: { url: string | null } | null }>;
  categories: EditorCategory[];
  attributeCount: number;
  selectedCategoryIds: string[];
  primaryCategoryId: string | null;
  unitLabels: Array<{ id: string | null; name: string; slug: string; isDefault: boolean }>;
  unitLabel: string;
  weightValue: string;
  weightUnit: WeightUnit;
  productUrlPrefix: string | null;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
  onBrandCreated: (brand: { id: string; name: string; slug: string; logo: { url: string | null } | null }) => void;
  onCategoryCreated: (category: EditorCategory) => void;
  onUnitLabelCreated: (label: { id: string | null; name: string; slug: string; isDefault: boolean }) => void;
}) {
  const [brandDialog, setBrandDialog] = React.useState(false);
  const [categoryDialog, setCategoryDialog] = React.useState(false);
  const [unitDraft, setUnitDraft] = React.useState("");
  const [unitSaving, setUnitSaving] = React.useState(false);

  const categoryOptions = React.useMemo(
    () =>
      categories.map((category) => ({
        value: category.id,
        label: category.path ?? category.name,
        hint: `${category.productCount} product(s)`,
        imageUrl: category.image?.url ?? null,
      })),
    [categories],
  );

  const addUnitLabel = async () => {
    const name = unitDraft.trim();
    if (!name) return;
    setUnitSaving(true);
    const { createUnitLabelAction } = await import("@/modules/catalog/product-actions");
    const result = await createUnitLabelAction({ name });
    setUnitSaving(false);
    if (!result.ok) return;
    onPatch({ unitLabel: result.data.name });
    onUnitLabelCreated({ id: result.data.id, name: result.data.name, slug: result.data.slug, isDefault: unitLabels.length === 0 });
    setUnitDraft("");
  };

  return (
    <CollapsibleSection
      id="organization"
      title="Product organisation"
      description="Brand, categories, how the product is sold and how much it weighs."
      icon={<Layers className="h-4 w-4" />}
      defaultOpen
      badge={selectedCategoryIds.length > 0 ? `${selectedCategoryIds.length} category(ies)` : undefined}
      badgeTone={selectedCategoryIds.length > 0 ? "success" : "neutral"}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Combobox
          id="product-brand"
          label="Brand"
          placeholder="Search brands…"
          tooltip="Groups products by maker. The brand name is shown on the product page and used by storefront search."
          help="Leave empty if the product is unbranded."
          options={brands.map((brand) => ({
            value: brand.id,
            label: brand.name,
            hint: `${brand.productCount} product(s)`,
            imageUrl: brand.logo?.url ?? null,
          }))}
          value={brandId}
          onChange={(value) => onPatch({ brandId: value })}
          emptyMessage="No brand matches that search."
          error={errors.brandId}
          footer={
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setBrandDialog(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create brand
            </Button>
          }
        />

        <Combobox
          id="product-categories"
          label="Categories"
          multiple
          placeholder="Search categories…"
          tooltip="Where the product appears in the storefront navigation, filters and collections."
          help="Select as many as apply; the first one (or the primary you choose) is used for breadcrumbs."
          options={categoryOptions}
          value={selectedCategoryIds}
          onChange={(value) => onPatch({ categoryIds: value, primaryCategoryId: value.includes(primaryCategoryId ?? "") ? primaryCategoryId : (value[0] ?? null) })}
          emptyMessage="No category matches that search."
          error={errors.categoryIds}
          footer={
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCategoryDialog(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create category
            </Button>
          }
        >
          {selectedCategoryIds.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Label htmlFor="primary-category" className="text-xs">
                Primary category
              </Label>
              <InfoTip>Used for breadcrumbs and the canonical category link.</InfoTip>
              <NativeSelect
                id="primary-category"
                className="h-8 w-56 text-xs"
                value={primaryCategoryId ?? ""}
                onChange={(event) => onPatch({ primaryCategoryId: event.target.value || null })}
              >
                {selectedCategoryIds.map((id) => {
                  const category = categories.find((entry) => entry.id === id);
                  return (
                    <option key={id} value={id}>
                      {category?.path ?? category?.name ?? id}
                    </option>
                  );
                })}
              </NativeSelect>
            </div>
          ) : null}
        </Combobox>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="unit-label" className="text-slate-800">
              Unit label
            </Label>
            <InfoTip>
              Describes how this product is sold or counted, such as piece, pair or box. This is different from the weight unit below.
            </InfoTip>
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="unit-label"
              list="unit-label-options"
              value={unitLabel}
              maxLength={24}
              onChange={(event) => onPatch({ unitLabel: event.target.value })}
            />
            <datalist id="unit-label-options">
              {unitLabels.map((label) => (
                <option key={label.slug} value={label.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-40 text-xs"
              value={unitDraft}
              placeholder="Add a label"
              maxLength={24}
              onChange={(event) => setUnitDraft(event.target.value)}
            />
            <Button type="button" variant="outline" size="sm" disabled={unitSaving || !unitDraft.trim()} onClick={addUnitLabel}>
              {unitSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Save label
            </Button>
            <span className="text-xs text-slate-500">Labels are shared by every product; duplicates are ignored.</span>
          </div>
          {errors.unitLabel ? <p className="text-xs text-red-600">{errors.unitLabel[0]}</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FieldWithTip
            id="product-weight"
            label="Weight"
            tooltip="Used with the courier rates and on shipping labels. Never leave it empty for physical products: a wrong weight means a wrong delivery charge."
            help="Numbers only, for example 1.5"
            error={errors.weightValue}
          >
            <Input
              id="product-weight"
              inputMode="decimal"
              value={weightValue}
              onChange={(event) => onPatch({ weightValue: event.target.value })}
              placeholder="0"
            />
          </FieldWithTip>
          <FieldWithTip
            id="product-weight-unit"
            label="Weight unit"
            tooltip="Gram, kilogram or pound. The value is converted to grams before it is stored, so reports and couriers always agree."
          >
            <NativeSelect id="product-weight-unit" value={weightUnit} onChange={(event) => onPatch({ weightUnit: event.target.value as WeightUnit })}>
              {WEIGHT_UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </NativeSelect>
          </FieldWithTip>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {attributeCount} attribute(s) available — configure them in the attributes section below.
      </p>

      <CreateBrandDialog
        open={brandDialog}
        onOpenChange={setBrandDialog}
        productUrlPrefix={productUrlPrefix}
        onCreated={(brand) => {
          onBrandCreated(brand);
          onPatch({ brandId: brand.id });
        }}
      />
      <CreateCategoryDialog
        open={categoryDialog}
        onOpenChange={setCategoryDialog}
        categories={categories}
        productUrlPrefix={productUrlPrefix}
        onCreated={(category) => {
          onCategoryCreated(category);
          onPatch({ categoryIds: [...selectedCategoryIds, category.id], primaryCategoryId: primaryCategoryId ?? category.id });
        }}
      />
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Descriptions                                                               */
/* -------------------------------------------------------------------------- */

export function ProductImagesSection({
  images,
  onChange,
  errors,
}: {
  images: MediaGalleryItem[];
  onChange: (items: MediaGalleryItem[]) => void;
  errors: Record<string, string[]>;
}) {
  const primary = images[0] ?? null;
  const gallery = images.slice(1);

  return (
    <CollapsibleSection
      id="images"
      title="Product images"
      description="The image every listing shows, plus the gallery shoppers browse on the product page."
      icon={<ImageIcon className="h-4 w-4" />}
      badge={images.length > 0 ? `${images.length} image(s)` : "No images"}
      badgeTone={images.length > 0 ? "success" : "warning"}
    >
      <div className="space-y-5">
        <MediaField
          label="Primary image"
          required
          value={primary?.asset ?? null}
          onChange={(asset) => {
            if (!asset) {
              onChange(images.filter((item) => item.mediaId !== primary?.mediaId));
              return;
            }
            const rest = images.filter((item) => item.mediaId !== primary?.mediaId && item.mediaId !== asset.id);
            onChange([{ mediaId: asset.id, asset, altText: primary?.altText ?? null }, ...rest]);
          }}
          tooltip="Shown in listings, search results, cart and social previews. Choosing an existing asset reuses the same file instead of uploading it again."
          help="Pick from the shared media library — upload inside the library if the image is not there yet."
          size={128}
          error={errors.primaryImage}
        />

        <MediaGalleryField
          label="Additional images"
          items={gallery}
          onChange={(items) => onChange(primary ? [primary, ...items] : items)}
          max={19}
          tooltip="Extra angles shown as thumbnails under the main image. Order matters: the first three are usually visible without scrolling."
          help="Use the arrows to reorder and “Make primary” to promote an image. Removing an image here only detaches it from this product."
          onAltTextChange={(mediaId, altText) =>
            onChange(images.map((item) => (item.mediaId === mediaId ? { ...item, altText: altText || null } : item)))
          }
        />
      </div>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Attributes                                                                 */
/* -------------------------------------------------------------------------- */

/** Small thumbnail for an attribute-value default image. */
export function AttributeValueThumb({ mediaId }: { mediaId: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    import("@/modules/media/actions").then(async ({ browseMediaAction }) => {
      try {
        const result = await browseMediaAction({ page: 1, pageSize: 60, mimeGroup: "image" });
        if (live) setUrl(result.rows.find((entry) => entry.id === mediaId)?.url ?? null);
      } catch {
        if (live) setUrl(null);
      }
    });
    return () => {
      live = false;
    };
  }, [mediaId]);

  if (!url) return <span className="h-3 w-3 rounded-full bg-slate-200" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- media lives on arbitrary storage hosts
  return <img src={url} alt="" className="h-6 w-6 object-cover" />;
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Product default pricing — level 3 of the inheritance model.
 *
 * Variants inherit these values; an attribute-value override (level 2) or a
 * manual variant override (level 1) wins over them. Nothing here is written onto
 * a variant that already has an override of its own.
 */
function toPaisaOrZero(value: string | null | undefined): number {
  const parsed = Number((value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export function PricingSection({
  currentPrice,
  discountType,
  discountValue,
  defaultCost,
  variantCount,
  overrideCount,
  unpricedCount,
  canViewCost,
  errors,
  onPatch,
}: {
  currentPrice: string;
  discountType: "PERCENTAGE" | "FLAT" | "NONE";
  discountValue: string;
  defaultCost: string;
  variantCount: number;
  /** Variants carrying a price override of their own. */
  overrideCount: number;
  /** Variants that would sell for nothing because no level defines a price. */
  unpricedCount: number;
  canViewCost: boolean;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const current = toPaisaOrZero(currentPrice);
  const pricing = calculatePricing({
    currentPricePaisa: current,
    discountType,
    discountValue: Number(discountValue) || 0,
  });
  const discountError = validateDiscount({
    currentPricePaisa: current,
    discountType,
    discountValue: Number(discountValue) || 0,
  });

  return (
    <CollapsibleSection
      id="pricing"
      title="Pricing"
      description="The default price every variant starts from. Set it before generating variants — they inherit it until overridden."
      icon={<ClipboardList className="h-4 w-4" />}
      badge={unpricedCount === 0 && variantCount > 0 ? "Every variant priced" : `${unpricedCount} unpriced`}
      badgeTone={unpricedCount === 0 && variantCount > 0 ? "success" : "warning"}
    >
      <div className="grid gap-4 lg:grid-cols-4">
        <FieldWithTip
          id="product-current-price"
          label="Current price (BDT)"
          tooltip="The price before discount — shown struck through when a discount applies. Every variant inherits it unless it carries an override."
          error={errors.currentPricePaisa}
        >
          <Input
            id="product-current-price"
            inputMode="decimal"
            value={currentPrice}
            placeholder="0.00"
            onChange={(event) => onPatch({ currentPrice: event.target.value })}
          />
        </FieldWithTip>

        <FieldWithTip
          id="product-discount-type"
          label="Discount type"
          tooltip="Percentage takes a share of the current price off; flat subtracts an amount in BDT. “None” means the current price is the selling price."
        >
          <NativeSelect
            id="product-discount-type"
            value={discountType}
            onChange={(event) => onPatch({ discountType: event.target.value as "PERCENTAGE" | "FLAT" | "NONE" })}
          >
            <option value="NONE">No discount</option>
            <option value="PERCENTAGE">Percentage (%)</option>
            <option value="FLAT">Flat amount (BDT)</option>
          </NativeSelect>
        </FieldWithTip>

        <FieldWithTip
          id="product-discount-value"
          label={discountType === "PERCENTAGE" ? "Discount (%)" : "Discount (BDT)"}
          tooltip="A percentage is 0–100. A flat amount may not exceed the current price."
          error={discountError.ok ? undefined : [discountError.message ?? "Invalid discount"]}
        >
          <Input
            id="product-discount-value"
            inputMode="decimal"
            value={discountValue}
            placeholder="0"
            disabled={discountType === "NONE"}
            onChange={(event) => onPatch({ discountValue: event.target.value })}
          />
        </FieldWithTip>

        <FieldWithTip
          id="product-sell-price"
          label="Sell price (BDT)"
          tooltip="What the shopper pays: the current price minus the discount. Calculated on the server in whole paisa — it is never taken from the browser."
        >
          <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800">
            {formatPaisa(pricing.sellPricePaisa)}
          </div>
          {pricing.compareAtPricePaisa != null ? (
            <p className="text-xs text-slate-500">
              Shows as <span className="line-through">{formatPaisa(pricing.compareAtPricePaisa)}</span> {formatPaisa(pricing.sellPricePaisa)}
            </p>
          ) : null}
        </FieldWithTip>
      </div>

      {canViewCost ? (
        <div className="mt-4 max-w-xs">
          <FieldWithTip
            id="product-default-cost"
            label="Default purchase cost (BDT)"
            tooltip="Fallback unit cost for margin reporting when a variant has no cost of its own. Never shown to shoppers."
            error={errors.defaultCostPaisa}
          >
            <Input
              id="product-default-cost"
              inputMode="decimal"
              value={defaultCost}
              placeholder="0.00"
              onChange={(event) => onPatch({ defaultCost: event.target.value })}
            />
          </FieldWithTip>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="neutral">{overrideCount} variant override(s)</Badge>
        <Badge variant={unpricedCount === 0 ? "success" : "warning"}>{unpricedCount} variant(s) without a price</Badge>
        <span className="text-slate-500">
          Changing a default never overwrites an explicit variant or attribute override — those rows keep their own price.
        </span>
      </div>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings, SEO and publication                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything that is not the product's identity, price, variants or images:
 * tax and packaging presets, preorder policy, shipping, the SEO metadata and
 * the publication status.
 */
export function ProductSettingsSection({
  status,
  taxRateId,
  taxRates,
  taxRateBps,
  packagingTemplateId,
  packagingTemplates,
  packagingCostPaisa,
  isPreorderEnabled,
  preorderNote,
  requiresShipping,
  isFeatured,
  seoTitle,
  seoDescription,
  seoKeywords,
  seoImage,
  name,
  slug,
  productUrlPrefix,
  canViewCost,
  errors,
  onPatch,
  onSeoImageChange,
}: {
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  taxRateId: string | null;
  taxRates: Array<{ id: string; name: string; rateBps: number; isDefault: boolean }>;
  taxRateBps: string;
  packagingTemplateId: string | null;
  packagingTemplates: Array<{ id: string; name: string; costPaisa: number; isDefault: boolean }>;
  packagingCostPaisa: string;
  isPreorderEnabled: boolean;
  preorderNote: string;
  requiresShipping: boolean;
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  seoImage: MediaAssetView | null;
  name: string;
  slug: string;
  productUrlPrefix: string | null;
  canViewCost: boolean;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
  onSeoImageChange: (asset: MediaAssetView | null) => void;
}) {
  const title = seoTitle.trim() || name;
  const description = seoDescription.trim();
  const url = slugPreview(productUrlPrefix, slug);

  return (
    <CollapsibleSection
      id="settings"
      title="Settings, SEO and publication"
      description="Tax and packaging presets, preorder policy, search metadata and whether the product is live."
      icon={<Search className="h-4 w-4" />}
      badge={status === "ACTIVE" ? "Published" : status === "DRAFT" ? "Draft" : "Archived"}
      badgeTone={status === "ACTIVE" ? "success" : "neutral"}
      className="mb-10"
    >
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <FieldWithTip
            id="product-tax-rate"
            label="Tax rate"
            tooltip="Reusable preset. Selecting one copies its rate onto this product; editing the preset later does not rewrite historical orders."
          >
            <NativeSelect
              id="product-tax-rate"
              value={taxRateId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value || null;
                const preset = taxRates.find((rate) => rate.id === nextId);
                onPatch({ taxRateId: nextId, ...(preset ? { taxRateBps: String(preset.rateBps) } : {}) });
              }}
            >
              <option value="">No tax preset</option>
              {taxRates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.name} ({(rate.rateBps / 100).toFixed(2)}%)
                </option>
              ))}
            </NativeSelect>
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="product-tax-bps" className="text-xs text-slate-500">
                Custom rate (basis points)
              </Label>
              <Input
                id="product-tax-bps"
                className="h-8 w-24"
                inputMode="numeric"
                value={taxRateBps}
                onChange={(event) => onPatch({ taxRateBps: event.target.value })}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Manage presets in <Link href="/admin/catalog/tax-rates" className="text-brand-700 underline">Tax rates</Link>. Tax is recorded
              separately from discounts, inventory cost and profit.
            </p>
          </FieldWithTip>

          <FieldWithTip
            id="product-packaging-template"
            label="Packaging cost template"
            tooltip="Reusable packaging cost per unit. Used for profitability reporting only — it is never added to what the shopper pays."
          >
            <NativeSelect
              id="product-packaging-template"
              value={packagingTemplateId ?? ""}
              onChange={(event) => {
                const nextId = event.target.value || null;
                const preset = packagingTemplates.find((template) => template.id === nextId);
                onPatch({ packagingCostTemplateId: nextId, ...(preset ? { packagingCostPaisa: (preset.costPaisa / 100).toFixed(2) } : {}) });
              }}
            >
              <option value="">No template</option>
              {packagingTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} — {formatPaisa(template.costPaisa)}
                </option>
              ))}
            </NativeSelect>
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="product-packaging-cost" className="text-xs text-slate-500">
                Custom cost (BDT)
              </Label>
              <Input
                id="product-packaging-cost"
                className="h-8 w-24"
                inputMode="decimal"
                value={packagingCostPaisa}
                onChange={(event) => onPatch({ packagingCostPaisa: event.target.value })}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Manage presets in{" "}
              <Link href="/admin/catalog/packaging-costs" className="text-brand-700 underline">
                Packaging costs
              </Link>
              .
            </p>
          </FieldWithTip>

          {canViewCost ? (
            <div className="space-y-2 text-xs text-slate-500">
              <p className="font-medium text-slate-700">How these are used</p>
              <p>Packaging cost is added to the cost side of an order line when profit is reported.</p>
              <p>Tax is stored on the product and kept on the order line; it is never treated as a discount or as stock cost.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={isPreorderEnabled}
                onChange={(event) => onPatch({ isPreorderEnabled: event.target.checked })}
              />
              <span>
                Allow preorders on this product
                <span className="block text-xs text-slate-500">
                  Orders are only split into a preorder when the requested quantity exceeds available stock (or stock is zero). A variant
                  can override this.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={requiresShipping}
                onChange={(event) => onPatch({ requiresShipping: event.target.checked })}
              />
              <span>
                Requires shipping
                <span className="block text-xs text-slate-500">Turn off for digital goods and services; they skip courier booking.</span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={isFeatured}
                onChange={(event) => onPatch({ isFeatured: event.target.checked })}
              />
              <span>
                Featured
                <span className="block text-xs text-slate-500">Shown first in storefront collections that honour the flag.</span>
              </span>
            </label>
          </div>

          <FieldWithTip
            id="preorder-note"
            label="Preorder note"
            tooltip="Shown to customers when the item is not in stock, for example an expected delivery window."
            help="Leave empty to use the storefront default wording."
            error={errors.preorderNote}
          >
            <Input id="preorder-note" value={preorderNote} maxLength={300} onChange={(event) => onPatch({ preorderNote: event.target.value })} />
          </FieldWithTip>

          <Alert variant="info" title="Stock comes from purchasing">
            Saving a product never creates stock. Every unit arrives through a{" "}
            <Link href="/admin/purchasing" className="underline">
              purchase receipt
            </Link>{" "}
            or an authorised{" "}
            <Link href="/admin/inventory/adjustments" className="underline">
              inventory adjustment
            </Link>
            , both of which write their own ledger movement.
          </Alert>
        </div>

        <div className="grid gap-4 border-t border-slate-200 pt-5 lg:grid-cols-2">
          <div className="space-y-4">
            <FieldWithTip
              id="seo-title"
              label="SEO title"
              tooltip="The clickable title in search results. Leave empty to use the product name."
              help={`${title.length}/60 characters recommended${title.length > 60 ? " — longer titles are truncated" : ""}`}
            >
              <Input
                id="seo-title"
                value={seoTitle}
                maxLength={200}
                onChange={(event) => onPatch({ seoTitle: event.target.value })}
                placeholder={name || "Product name"}
              />
            </FieldWithTip>

            <FieldWithTip
              id="seo-description"
              label="Meta description"
              tooltip="The summary under the title in search results. Leave empty to let search engines use the short description."
              help={`${description.length}/160 characters recommended`}
            >
              <Textarea
                id="seo-description"
                rows={3}
                maxLength={400}
                value={seoDescription}
                onChange={(event) => onPatch({ seoDescription: event.target.value })}
              />
            </FieldWithTip>

            <FieldWithTip id="seo-keywords" label="Keywords" tooltip="Internal keywords used by your own storefront search.">
              <Input id="seo-keywords" value={seoKeywords} maxLength={400} onChange={(event) => onPatch({ seoKeywords: event.target.value })} />
            </FieldWithTip>

            <MediaField
              label="Social sharing image"
              value={seoImage}
              onChange={onSeoImageChange}
              size={96}
              emptyLabel="Falls back to the primary product image"
              tooltip="Shown when the product link is shared on social networks. Leave empty to use the primary product image."
              help="Chosen from the shared media library; 1200×630 works best."
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="product-status" className="text-slate-800">
                  Publication
                </Label>
                <InfoTip>
                  Draft keeps the product invisible on the storefront. Active publishes it (the storefront only serves active products).
                  Archived hides it while keeping order history.
                </InfoTip>
              </div>
              <NativeSelect
                id="product-status"
                value={status}
                onChange={(event) => onPatch({ status: event.target.value as "DRAFT" | "ACTIVE" | "ARCHIVED" })}
              >
                <option value="DRAFT">Draft — not sellable yet</option>
                <option value="ACTIVE">Active — visible and sellable</option>
                <option value="ARCHIVED">Archived</option>
              </NativeSelect>
              <p className="text-xs text-slate-500">“Save as draft” always saves as a draft, whatever this says.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-slate-800">Search preview</Label>
                <InfoTip>
                  An approximation of how the result may look. Search engines decide the final appearance; this preview does not promise
                  indexing or ranking.
                </InfoTip>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-emerald-700">{url}</p>
                <p className="mt-1 text-base font-medium text-sky-800">{title || "Product name"}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {description ||
                    (name ? `Shop ${name} online. Fast delivery, easy returns.` : "Add a meta description or a short description to control this text.")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */

export function AttributesAndValues({
  attributes,
  selectedAttributeIds,
  selectedValueIds,
  attributeValueImages,
  attributesSummary,
  errors,
  onPatch,
  onAttributeCreated,
  onValueAdded,
  onSetValueImage,
}: {
  attributes: EditorAttribute[];
  selectedAttributeIds: string[];
  selectedValueIds: string[];
  attributeValueImages: Record<string, string | null>;
  attributesSummary: string;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
  onAttributeCreated: (attribute: EditorAttribute) => void;
  onValueAdded: (attributeId: string, value: { id: string; value: string; colorHex: string | null; mediaId: string | null }) => void;
  onSetValueImage: (attributeValueId: string, mediaId: string | null) => void;
}) {
  const [dialog, setDialog] = React.useState(false);
  const selected = attributes.filter((attribute) => selectedAttributeIds.includes(attribute.id));

  return (
    <div className="space-y-4">
        <Combobox
          id="product-attributes"
          label="Attributes"
          multiple
          placeholder="Search attributes…"
          tooltip="Variation attributes create one variant per combination. Descriptive attributes only show information on the product page."
          help="Choose the attributes this product uses, then pick the values that apply."
          options={attributes.map((attribute) => ({
            value: attribute.id,
            label: attribute.name,
            hint: attribute.isVariantDefining ? "variations" : "describes",
          }))}
          value={selectedAttributeIds}
          onChange={(value) =>
            onPatch({
              attributeIds: value,
              // Dropping an attribute also drops its values, so the matrix cannot reference stale options.
              selectedValueIds: selectedValueIds.filter((valueId) =>
                value.some((attributeId) => attributes.find((attribute) => attribute.id === attributeId)?.values.some((entry) => entry.id === valueId)),
              ),
            })
          }
          emptyMessage="No attribute matches that search."
          error={errors.attributeIds}
          footer={
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setDialog(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create attribute
            </Button>
          }
        />

        {selected.length === 0 ? (
          <Alert variant="info">
            No attributes yet. Add Colour and Size to build a variant matrix, or Material to describe the product without creating
            variants.
          </Alert>
        ) : null}

        <div className="space-y-3">
          {selected.map((attribute) => (
            <div key={attribute.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">{attribute.name}</p>
                  <Badge variant={attribute.isVariantDefining ? "brand" : "neutral"}>
                    {attribute.isVariantDefining ? "Used for variations" : "Describes the product"}
                  </Badge>
                  <InfoTip>
                    {attribute.isVariantDefining
                      ? "Every selected value of this attribute becomes part of a variant (Colour × Size)."
                      : "This attribute only shows information on the product page and never creates variants."}
                  </InfoTip>
                </div>
                <AddAttributeValueInline attributeId={attribute.id} onAdded={(value) => onValueAdded(attribute.id, value)} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {attribute.values.map((value) => {
                  const checked = selectedValueIds.includes(value.id);
                  const imageId = attributeValueImages[value.id] ?? value.mediaId ?? null;
                  return (
                    <div
                      key={value.id}
                      className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                        checked ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(event) =>
                            onPatch({
                              selectedValueIds: event.target.checked
                                ? [...selectedValueIds, value.id]
                                : selectedValueIds.filter((id) => id !== value.id),
                            })
                          }
                        />
                        {value.colorHex ? (
                          <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: value.colorHex }} aria-hidden="true" />
                        ) : null}
                        {value.value}
                      </label>

                      <MediaPicker
                        title={`Default image for ${attribute.name}: ${value.value}`}
                        mimeGroup="image"
                        onSelect={(asset) => onSetValueImage(value.id, asset.id)}
                        trigger={
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-slate-300 bg-white"
                            aria-label={imageId ? `Change the default image for ${value.value}` : `Set a default image for ${value.value}`}
                            title={imageId ? "Change the attribute default image" : "Set an attribute default image"}
                          >
                            {imageId ? (
                              <AttributeValueThumb mediaId={imageId} />
                            ) : (
                              <Plus className="h-3 w-3 text-slate-400" aria-hidden="true" />
                            )}
                          </button>
                        }
                      />

                      {imageId ? (
                        <button
                          type="button"
                          className="text-[10px] text-slate-500 underline"
                          onClick={() => onSetValueImage(value.id, null)}
                          title="Remove the default image for this value"
                        >
                          clear
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {attribute.values.length === 0 ? <span className="text-xs text-slate-400">No values yet — add one on the right.</span> : null}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          {attributesSummary} Attribute default images are shared: the same asset can be the default of several values and a product image at
          the same time.
        </p>
        {errors.selectedValueIds ? <p className="text-xs text-red-600">{errors.selectedValueIds[0]}</p> : null}

      <CreateAttributeDialog
        open={dialog}
        onOpenChange={setDialog}
        onCreated={(attribute) => {
          onAttributeCreated(attribute);
          onPatch({ attributeIds: [...selectedAttributeIds, attribute.id] });
        }}
      />
    </div>
  );
}

