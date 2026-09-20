"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, Button, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { InfoTip } from "@/components/ui/tooltip";
import { MediaField } from "@/components/media/media-field";
import { suggestSlug } from "@/modules/catalog/product-draft";
import { slugPreview } from "./product-url";
import {
  addAttributeValueForProductAction,
  createAttributeForProductAction,
  createBrandAction,
  createCategoryForProductAction,
} from "@/modules/catalog/product-actions";
import type { EditorAttribute, EditorCategory } from "@/modules/catalog/product-queries";
import type { MediaAssetView } from "@/modules/media/service";

/**
 * On-the-go creation dialogs.
 *
 * Every one of them opens *over* the product form, so nothing is lost: the form
 * keeps its state, and on success the new record is selected automatically. Brand
 * logos and category images go through the shared media manager (`MediaField` →
 * `MediaPicker`), never through a local uploader.
 */

/* -------------------------------------------------------------------------- */
/* Brand                                                                      */
/* -------------------------------------------------------------------------- */

export function CreateBrandDialog({
  open,
  onOpenChange,
  onCreated,
  productUrlPrefix,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (brand: { id: string; name: string; slug: string; logo: MediaAssetView | null }) => void;
  productUrlPrefix: string | null;
  disabled?: boolean;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [websiteUrl, setWebsiteUrl] = React.useState("");
  const [logo, setLogo] = React.useState<MediaAssetView | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // Close resets the form. Adjusted during render (the documented alternative to a
  // setState effect), so reopening always starts from a pristine form.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDescription("");
      setWebsiteUrl("");
      setLogo(null);
      setError(null);
      setFieldErrors({});
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create brand"
        description="The brand is created in the catalogue, then selected here. This form stays exactly as you left it."
        className="max-h-[90dvh] max-w-xl overflow-y-auto"
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            setFieldErrors({});
            const result = await createBrandAction({
              name,
              slug: slug || undefined,
              description: description || undefined,
              websiteUrl: websiteUrl || undefined,
              logoMediaId: logo?.id ?? null,
              isActive: true,
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.message);
              setFieldErrors(result.fieldErrors ?? {});
              return;
            }
            toast.success(`Brand “${result.data.name}” created`);
            onCreated({ id: result.data.id, name: result.data.name, slug: result.data.slug, logo });
            onOpenChange(false);
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="brand-name">
                Brand name <span className="text-red-500">*</span>
              </Label>
              <InfoTip>Shown on the storefront and used to group products by maker on category pages.</InfoTip>
            </div>
            <Input
              id="brand-name"
              value={name}
              autoFocus
              required
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(suggestSlug(event.target.value));
              }}
            />
            {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name[0]}</p> : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="brand-slug">URL slug</Label>
              <InfoTip>Used in brand links such as /brands/{"{slug}"}. Lower-case letters, numbers and dashes.</InfoTip>
            </div>
            <Input
              id="brand-slug"
              value={slug}
              maxLength={80}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugTouched(true);
              }}
            />
            {slug ? <p className="text-xs text-slate-500">{slugPreview(productUrlPrefix, slug).replace("/products/", "/brands/")}</p> : null}
            {fieldErrors.slug ? <p className="text-xs text-red-600">{fieldErrors.slug[0]}</p> : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="brand-website">Website</Label>
              <InfoTip>Optional link to the brand’s own site, shown in the brand directory.</InfoTip>
            </div>
            <Input
              id="brand-website"
              value={websiteUrl}
              placeholder="https://example.com"
              onChange={(event) => setWebsiteUrl(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="brand-description">Description</Label>
              <InfoTip>A sentence or two about the brand. Shown on the brand page when the storefront theme renders one.</InfoTip>
            </div>
            <Textarea id="brand-description" rows={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <MediaField
            label="Brand logo"
            value={logo}
            onChange={setLogo}
            size={80}
            emptyLabel="No logo selected"
            help="Chosen from the shared media library. Upload inside the library if the logo is not there yet."
            tooltip="The logo is a media asset: the same file can be reused by other brands, products or pages without being uploaded again."
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || disabled}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create brand
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Category                                                                   */
/* -------------------------------------------------------------------------- */

export function CreateCategoryDialog({
  open,
  onOpenChange,
  onCreated,
  categories,
  productUrlPrefix,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: EditorCategory) => void;
  categories: EditorCategory[];
  productUrlPrefix: string | null;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [parentId, setParentId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [image, setImage] = React.useState<MediaAssetView | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  // See CreateBrandDialog: reset on close as a render-time adjustment.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setParentId("");
      setDescription("");
      setImage(null);
      setError(null);
      setFieldErrors({});
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create category"
        description="Categories organise the catalogue and drive storefront navigation. The new category is selected here automatically."
        className="max-h-[90dvh] max-w-xl overflow-y-auto"
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            setFieldErrors({});
            const result = await createCategoryForProductAction({
              name,
              slug: slug || undefined,
              parentId: parentId || undefined,
              description: description || undefined,
              position: 0,
              isActive: true,
              isFeatured: false,
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.message);
              setFieldErrors(result.fieldErrors ?? {});
              return;
            }
            toast.success(`Category “${result.data.name}” created`);
            onCreated({
              id: result.data.id,
              name: result.data.name,
              slug: result.data.slug,
              path: result.data.path ?? result.data.name,
              parentId: result.data.parentId,
              productCount: 0,
              image,
            });
            onOpenChange(false);
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="category-name">
                Category name <span className="text-red-500">*</span>
              </Label>
              <InfoTip>The name customers see in the storefront menu and breadcrumbs.</InfoTip>
            </div>
            <Input
              id="category-name"
              value={name}
              autoFocus
              required
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(suggestSlug(event.target.value));
              }}
            />
            {fieldErrors.name ? <p className="text-xs text-red-600">{fieldErrors.name[0]}</p> : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="category-slug">URL slug</Label>
              <InfoTip>Used in category links and filters. Duplicate names get a numeric suffix instead of a clash.</InfoTip>
            </div>
            <Input
              id="category-slug"
              value={slug}
              maxLength={80}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugTouched(true);
              }}
            />
            {slug ? <p className="text-xs text-slate-500">{slugPreview(productUrlPrefix, slug).replace("/products/", "/collections/")}</p> : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="category-parent">Parent category</Label>
              <InfoTip>Nest the category under an existing one. A category can never become its own parent, and cycles are refused by the server.</InfoTip>
            </div>
            <NativeSelect id="category-parent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Top level</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path ?? category.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="category-description">Description</Label>
              <InfoTip>Optional short copy used on the category page.</InfoTip>
            </div>
            <Textarea id="category-description" rows={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>

          <MediaField
            label="Category image"
            value={image}
            onChange={setImage}
            size={80}
            emptyLabel="No image selected"
            help="Picked from the shared media library; it can be the same asset another category or product already uses."
            tooltip="Storefront themes show this image on category tiles. Choosing an existing asset never duplicates the file."
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create category
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Attribute                                                                  */
/* -------------------------------------------------------------------------- */

export function CreateAttributeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (attribute: EditorAttribute) => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState("SELECT");
  const [isVariantDefining, setIsVariantDefining] = React.useState(true);
  const [valuesText, setValuesText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // See CreateBrandDialog: reset on close as a render-time adjustment.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setName("");
      setType("SELECT");
      setIsVariantDefining(true);
      setValuesText("");
      setError(null);
    }
  }

  const values = valuesText
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    // Duplicate values (by case/whitespace) would be rejected by the server; drop them here too.
    .filter((value, index, all) => all.findIndex((entry) => entry.toLowerCase() === value.toLowerCase()) === index);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Create attribute"
        description="Attributes describe products (Material, Style) or create variations (Colour, Size)."
        className="max-h-[90dvh] max-w-xl overflow-y-auto"
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            const result = await createAttributeForProductAction({
              name,
              type,
              isVariantDefining,
              values: values.map((value) => ({ value })),
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            toast.success(`Attribute “${result.data.name}” created`);
            onCreated({
              id: result.data.id,
              name: result.data.name,
              slug: result.data.slug,
              type,
              isVariantDefining,
              values: result.data.values.map((value) => ({
                id: value.id,
                value: value.value,
                colorHex: value.colorHex,
                mediaId: value.mediaId,
                image: null,
              })),
            });
            onOpenChange(false);
          }}
        >
          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="attribute-name">
                  Attribute name <span className="text-red-500">*</span>
                </Label>
                <InfoTip>Used as the label in the variant matrix, for example “Colour” or “Size”.</InfoTip>
              </div>
              <Input id="attribute-name" value={name} autoFocus required maxLength={80} onChange={(event) => setName(event.target.value)} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="attribute-type">Type</Label>
                <InfoTip>Colour shows a swatch picker, Select a plain list, Number and Text accept typed values.</InfoTip>
              </div>
              <NativeSelect id="attribute-type" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="SELECT">Select</option>
                <option value="COLOR">Colour</option>
                <option value="NUMBER">Number</option>
                <option value="TEXT">Text</option>
              </NativeSelect>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
              checked={isVariantDefining}
              onChange={(event) => setIsVariantDefining(event.target.checked)}
            />
            <span>
              Can create variations
              <span className="block text-xs text-slate-500">
                When on, every selected value produces variants (Colour × Size). When off, the attribute only describes the product.
              </span>
            </span>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="attribute-values">Values</Label>
              <InfoTip>One value per line, or comma separated: Black, White, Navy Blue. You can add more later without leaving this form.</InfoTip>
            </div>
            <Textarea
              id="attribute-values"
              rows={4}
              value={valuesText}
              onChange={(event) => setValuesText(event.target.value)}
              placeholder={"Black\nWhite\nNavy Blue"}
            />
            <p className="text-xs text-slate-500">
              {values.length} value(s) will be created{values.length !== valuesText.split(/[\n,]/).filter((value) => value.trim()).length ? " (duplicates ignored)" : ""}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create attribute
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline "add value" control used inside the attribute picker. */
export function AddAttributeValueInline({
  attributeId,
  onAdded,
  disabled,
}: {
  attributeId: string;
  onAdded: (value: { id: string; value: string; colorHex: string | null; mediaId: string | null }) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [colorHex, setColorHex] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    const result = await addAttributeValueForProductAction({
      attributeId,
      value: trimmed,
      colorHex: /^#[0-9a-fA-F]{6}$/.test(colorHex) ? colorHex : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Value “${result.data.value}” added`);
    onAdded({ id: result.data.id, value: result.data.value, colorHex: result.data.colorHex, mediaId: result.data.mediaId });
    setValue("");
    setColorHex("");
  };

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <div className="space-y-1">
        <Label htmlFor={`add-value-${attributeId}`} className="text-xs">
          Add value
        </Label>
        <Input
          id={`add-value-${attributeId}`}
          className="h-9 w-40"
          value={value}
          maxLength={80}
          disabled={disabled || saving}
          placeholder="Navy Blue"
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`add-color-${attributeId}`} className="text-xs">
          Colour (optional)
        </Label>
        <Input
          id={`add-color-${attributeId}`}
          className="h-9 w-28"
          value={colorHex}
          placeholder="#1e3a8a"
          disabled={disabled || saving}
          onChange={(event) => setColorHex(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={disabled || saving || !value.trim()}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
        Add
      </Button>
    </form>
  );
}
