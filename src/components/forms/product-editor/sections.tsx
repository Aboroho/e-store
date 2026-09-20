"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Truck,
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
  status,
  productUrlPrefix,
  slugState,
  skuState,
  errors,
  onNameChange,
  onSlugChange,
  onRegenerateSlug,
  onPatch,
}: {
  name: string;
  slug: string;
  slugTouched: boolean;
  productCode: string;
  barcode: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  productUrlPrefix: string | null;
  slugState: { checking: boolean; available: boolean | null; suggestion: string | null };
  skuState: { checking: boolean; message?: string };
  errors: Record<string, string[]>;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string, options?: { manual?: boolean }) => void;
  onRegenerateSlug: () => void;
  onPatch: (patch: { barcode?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; productCode?: string }) => void;
}) {
  return (
    <CollapsibleSection
      id="basic"
      title="Basic information"
      description="What the product is called and how it is identified in your catalogue."
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
              Unique code identifying this product in inventory and order records. It is the parent code — every variant gets its own code
              underneath it.
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

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="product-status" className="text-slate-800">
              Status
            </Label>
            <InfoTip>
              Draft keeps the product invisible on the storefront. Active publishes it (the storefront only serves products that are
              active). Archived hides it while keeping order history.
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
      </div>
    </CollapsibleSection>
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

export function DescriptionSection({
  shortDescription,
  description,
  onShortChange,
  onDescriptionChange,
  canUpload,
}: {
  shortDescription: RichTextDocument;
  description: RichTextDocument;
  onShortChange: (value: RichTextDocument) => void;
  onDescriptionChange: (value: RichTextDocument) => void;
  canUpload: boolean;
}) {
  return (
    <CollapsibleSection
      id="descriptions"
      title="Product description"
      description="Short summary for listings and the full description for the product page."
      icon={<FileText className="h-4 w-4" />}
    >
      <div className="space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-slate-800">Short description</Label>
            <InfoTip>
              One or two sentences shown in listings, category tiles and search results. Keep it plain: it is also used as the fallback
              meta description.
            </InfoTip>
          </div>
          <RichTextEditor
            value={shortDescription}
            onChange={onShortChange}
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

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="text-slate-800">Long description</Label>
            <InfoTip>
              The full product story on the product page. Images and video are picked from the shared media library, so the same asset is
              never uploaded twice and never deleted while a description uses it.
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
            Use “Expand editor” for a full-screen writing surface. Content is structured JSON, never raw HTML: unsupported formatting is
            rejected on save.
          </p>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Product images                                                             */
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

export function PricingSection({
  defaultPrice,
  taxRateBps,
  packagingCostPaisa,
  defaultPriceListName,
  variantCount,
  variantPriceCount,
  unpricedCount,
  canViewCost,
  errors,
  onPatch,
  onApplyDefaultPrice,
}: {
  defaultPrice: string;
  taxRateBps: string;
  packagingCostPaisa: string;
  defaultPriceListName: string;
  variantCount: number;
  variantPriceCount: number;
  unpricedCount: number;
  canViewCost: boolean;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
  /** Copies the default price onto every variant that has no price of its own. */
  onApplyDefaultPrice: () => void;
}) {
  return (
    <CollapsibleSection
      id="pricing"
      title="Pricing and product data"
      description={`Prices are stored in ${defaultPriceListName}. Variant prices override the product default.`}
      icon={<ClipboardList className="h-4 w-4" />}
      badge={`${variantPriceCount}/${variantCount} priced`}
      badgeTone={variantPriceCount === variantCount && variantCount > 0 ? "success" : "warning"}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <FieldWithTip
          id="default-price"
          label="Product default price (BDT)"
          tooltip="A convenience for new variants: press “Apply to unpriced variants” to copy it onto every variant that has no price yet. Each variant keeps its own price in the price list."
          help="Variants with their own price are never overwritten."
          error={errors.defaultPrice}
        >
          <Input
            id="default-price"
            inputMode="decimal"
            value={defaultPrice}
            onChange={(event) => onPatch({ defaultPrice: event.target.value })}
            placeholder="0.00"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            disabled={!defaultPrice.trim() || unpricedCount === 0}
            onClick={onApplyDefaultPrice}
          >
            Apply to {unpricedCount} unpriced variant(s)
          </Button>
        </FieldWithTip>

        <FieldWithTip
          id="tax-rate"
          label="Tax rate (basis points)"
          tooltip="VAT or sales tax applied to this product at checkout. 1500 = 15%. Stored as basis points so no rounding is lost."
          help="1500 means 15%."
        >
          <Input
            id="tax-rate"
            inputMode="numeric"
            value={taxRateBps}
            onChange={(event) => onPatch({ taxRateBps: event.target.value })}
          />
        </FieldWithTip>

        <FieldWithTip
          id="packaging-cost"
          label="Packaging cost (BDT)"
          tooltip="Added per unit when calculating order profitability. It never changes what the shopper pays."
          error={errors.packagingCostPaisa}
        >
          <Input
            id="packaging-cost"
            inputMode="decimal"
            value={packagingCostPaisa}
            onChange={(event) => onPatch({ packagingCostPaisa: event.target.value })}
          />
        </FieldWithTip>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Money is stored as integer paisa — no floating point rounding. {canViewCost ? "Purchase cost is edited per variant (and in bulk) below." : "Purchase cost is hidden because your role cannot view costs."}
      </p>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export function InventorySection({
  requiresShipping,
  isPreorderEnabled,
  preorderNote,
  rows,
  openingStock,
  recordOpeningStock,
  errors,
  onPatch,
  onOpeningStockChange,
}: {
  requiresShipping: boolean;
  isPreorderEnabled: boolean;
  preorderNote: string;
  rows: Array<{ key: string; name: string; sku: string }>;
  openingStock: Record<string, string>;
  recordOpeningStock: boolean;
  errors: Record<string, string[]>;
  onPatch: (patch: Record<string, unknown>) => void;
  onOpeningStockChange: (key: string, value: string) => void;
}) {
  return (
    <CollapsibleSection
      id="inventory"
      title="Inventory and preorder"
      description="How stock behaves for this product and whether orders beyond stock are allowed."
      icon={<Truck className="h-4 w-4" />}
      badge={isPreorderEnabled ? "Preorder on" : undefined}
      badgeTone={isPreorderEnabled ? "warning" : "neutral"}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
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
              checked={isPreorderEnabled}
              onChange={(event) => onPatch({ isPreorderEnabled: event.target.checked })}
            />
            <span className="flex items-start gap-1">
              Allow preorder when out of stock
              <InfoTip>
                Allows orders beyond currently available stock when preorder is enabled. The system tracks uncovered quantities and
                allocates incoming stock according to the platform’s preorder rules.
              </InfoTip>
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

        <Alert variant="warning" title="Opening stock is recorded as a stock adjustment">
          Saving a product never creates stock by itself. Tick the box below to record the quantities you type as an opening stock
          adjustment in the inventory ledger, or leave it unticked and receive stock later through a purchase receipt. Stock always flows
          through the ledger, so on-hand, reservations and history stay consistent.
        </Alert>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={recordOpeningStock}
            onChange={(event) => onPatch({ recordOpeningStock: event.target.checked })}
          />
          Record the quantities below as opening stock when I save
        </label>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">Opening stock per variant</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2">Variant</th>
                <th scope="col" className="px-3 py-2">Opening quantity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="block text-sm text-slate-800">{row.name || "Untitled variant"}</span>
                    <span className="font-mono text-xs text-slate-500">{row.sku || "no code yet"}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Opening stock for ${row.name}`}
                      className="h-9 w-28"
                      inputMode="numeric"
                      value={openingStock[row.key] ?? ""}
                      disabled={!recordOpeningStock}
                      onChange={(event) => onOpeningStockChange(row.key, event.target.value)}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-sm text-slate-500">
                    Generate variants first; opening stock is recorded per variant.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          Later stock movements (receipts, damages, counts) live in{" "}
          <Link href="/admin/inventory" className="text-brand-700 underline">
            Inventory
          </Link>
          .
        </p>
      </div>
    </CollapsibleSection>
  );
}

/* -------------------------------------------------------------------------- */
/* SEO                                                                        */
/* -------------------------------------------------------------------------- */

export function SeoSection({
  seoTitle,
  seoDescription,
  seoKeywords,
  seoImage,
  name,
  slug,
  onPatch,
  onSeoImageChange,
  productUrlPrefix,
}: {
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  seoImage: MediaAssetView | null;
  name: string;
  slug: string;
  onPatch: (patch: Record<string, unknown>) => void;
  onSeoImageChange: (asset: MediaAssetView | null) => void;
  productUrlPrefix: string | null;
}) {
  const title = seoTitle.trim() || name;
  const description = seoDescription.trim();
  const url = slugPreview(productUrlPrefix, slug);

  return (
    <CollapsibleSection
      id="seo"
      title="SEO and social sharing"
      description="How this product appears in search results and when it is shared."
      icon={<Search className="h-4 w-4" />}
      className="mb-10"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <FieldWithTip
            id="seo-title"
            label="SEO title"
            tooltip="The clickable title in search results. Leave empty to use the product name."
            help={`${title.length}/60 characters recommended${title.length > 60 ? " — longer titles are truncated by search engines" : ""}`}
            error={undefined}
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

          <FieldWithTip
            id="seo-keywords"
            label="Keywords"
            tooltip="Internal keywords used by your own storefront search. Major search engines ignore this field."
          >
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
                (name
                  ? `Shop ${name} online. Fast delivery, easy returns.`
                  : "Add a meta description or a short description to control this text.")}
            </p>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Titles are truncated around 60 characters and descriptions around 160 in most search engines.
          </p>
        </div>
      </div>
    </CollapsibleSection>
  );
}

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

