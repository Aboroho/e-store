"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { initialActionState } from "@/modules/auth/action-state";
import { bulkUpdateVariantsAction, createProductAction, updateProductAction } from "@/modules/catalog/actions";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  NativeSelect,
  Textarea,
  buttonVariants,
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { MultiMediaField, type MediaAssetView } from "@/components/media/media-picker";
import { cn } from "@/lib/utils";

export interface AttributeOption {
  id: string;
  name: string;
  type: string;
  values: Array<{ id: string; value: string; colorHex: string | null }>;
}

export interface CategoryOption {
  id: string;
  name: string;
  path: string | null;
}

interface VariantRow {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  compareAt: string;
  cost: string;
  weight: string;
  isPreorder: boolean;
  attributeValueIds: string[];
}

function newRow(index: number): VariantRow {
  return {
    key: `row-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Variant ${index + 1}`,
    sku: "",
    barcode: "",
    price: "",
    compareAt: "",
    cost: "",
    weight: "",
    isPreorder: false,
    attributeValueIds: [],
  };
}

/** Cartesian product of the selected attribute values, so merchandisers do not type combinations by hand. */
function buildCombinations(attributes: AttributeOption[], selectedValueIds: string[]): string[][] {
  const relevant = attributes
    .map((attribute) => ({
      attribute,
      values: attribute.values.filter((value) => selectedValueIds.includes(value.id)),
    }))
    .filter((entry) => entry.values.length > 0);

  if (relevant.length === 0) return [[]];

  return relevant.reduce<string[][]>(
    (combinations, entry) =>
      combinations.flatMap((combination) => entry.values.map((value) => [...combination, value.id])),
    [[]],
  );
}

export function ProductForm({
  categories,
  attributes,
  defaultPriceListName,
  product,
}: {
  categories: CategoryOption[];
  attributes: AttributeOption[];
  defaultPriceListName: string;
  product?: {
    id: string;
    name: string;
    slug: string;
    productType: string;
    status: string;
    shortDescription: string | null;
    description: string | null;
    brand: string | null;
    sku: string | null;
    barcode: string | null;
    unitLabel: string;
    weightGrams: number | null;
    requiresShipping: boolean;
    isFeatured: boolean;
    isPreorderEnabled: boolean;
    preorderNote: string | null;
    taxRateBps: number;
    packagingCostPaisa: number;
    seoTitle: string | null;
    seoDescription: string | null;
    categoryIds: string[];
    primaryCategoryId: string | null;
    attributeIds: string[];
    images: MediaAssetView[];
    variants: Array<{
      id: string;
      name: string;
      sku: string;
      barcode: string | null;
      priceOverridePaisa: number | null;
      compareAtPricePaisa: number | null;
      costPaisa: number | null;
      weightGrams: number | null;
      isPreorderEnabled: boolean | null;
      attributeValueIds: string[];
    }>;
  };
}) {
  const isEdit = Boolean(product);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateProductAction : createProductAction,
    initialActionState,
  );

  const [rows, setRows] = useState<VariantRow[]>(() =>
    product
      ? product.variants.map((variant) => ({
          key: variant.id,
          name: variant.name,
          sku: variant.sku,
          barcode: variant.barcode ?? "",
          price: variant.priceOverridePaisa != null ? (variant.priceOverridePaisa / 100).toFixed(2) : "",
          compareAt: variant.compareAtPricePaisa != null ? (variant.compareAtPricePaisa / 100).toFixed(2) : "",
          cost: variant.costPaisa != null ? (variant.costPaisa / 100).toFixed(2) : "",
          weight: variant.weightGrams != null ? String(variant.weightGrams) : "",
          isPreorder: Boolean(variant.isPreorderEnabled),
          attributeValueIds: variant.attributeValueIds,
        }))
      : [newRow(0)],
  );
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(product?.categoryIds ?? []);
  const [selectedAttributeIds, setSelectedAttributeIds] = useState<string[]>(product?.attributeIds ?? []);
  const [selectedValueIds, setSelectedValueIds] = useState<string[]>(
    product ? [...new Set(product.variants.flatMap((variant) => variant.attributeValueIds))] : [],
  );
  const [selectedImages, setSelectedImages] = useState<MediaAssetView[]>(product?.images ?? []);

  const relevantAttributes = useMemo(
    () => attributes.filter((attribute) => selectedAttributeIds.includes(attribute.id)),
    [attributes, selectedAttributeIds],
  );

  const updateRow = (key: string, patch: Partial<VariantRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const generateCombinations = () => {
    const combinations = buildCombinations(relevantAttributes, selectedValueIds);
    if (combinations.length === 0) return;
    setRows((current) => {
      const existing = new Map(current.map((row) => [[...row.attributeValueIds].sort().join("|"), row]));
      const productSlug = (document.getElementById("name") as HTMLInputElement | null)?.value
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 12) ?? "SKU";

      return combinations.map((combination, index) => {
        const key = [...combination].sort().join("|");
        const existingRow = existing.get(key);
        const label = combination
          .map((valueId) => {
            for (const attribute of relevantAttributes) {
              const value = attribute.values.find((entry) => entry.id === valueId);
              if (value) return value.value;
            }
            return "";
          })
          .filter(Boolean)
          .join(" / ");
        if (existingRow) return { ...existingRow, name: label || existingRow.name };
        const base = product?.variants[0];
        return {
          ...newRow(index),
          name: label || `Variant ${index + 1}`,
          sku: `${productSlug || "SKU"}-${index + 1}`,
          price: base?.priceOverridePaisa != null ? (base.priceOverridePaisa / 100).toFixed(2) : "",
          cost: base?.costPaisa != null ? (base.costPaisa / 100).toFixed(2) : "",
          attributeValueIds: combination,
        };
      });
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      {isEdit ? <input type="hidden" name="productId" value={product!.id} /> : null}
      <input type="hidden" name="productType" value={rows.length > 1 || selectedValueIds.length > 0 ? "VARIABLE" : "SIMPLE"} />

      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" htmlFor="name" required error={state.fieldErrors?.name}>
              <Input id="name" name="name" defaultValue={product?.name} required />
            </FormField>
            <FormField label="URL slug" htmlFor="slug" hint="Leave blank to generate it from the name." error={state.fieldErrors?.slug}>
              <Input id="slug" name="slug" defaultValue={product?.slug} />
            </FormField>
            <FormField label="Status" htmlFor="status">
              <NativeSelect id="status" name="status" defaultValue={product?.status ?? "DRAFT"}>
                <option value="DRAFT">Draft — not sellable yet</option>
                <option value="ACTIVE">Active — visible and sellable</option>
                <option value="ARCHIVED">Archived</option>
              </NativeSelect>
            </FormField>
            <FormField label="Brand" htmlFor="brand">
              <Input id="brand" name="brand" defaultValue={product?.brand ?? ""} />
            </FormField>
            <FormField label="Product code" htmlFor="sku" hint="Optional parent code; every variant has its own SKU.">
              <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} />
            </FormField>
            <FormField label="Unit label" htmlFor="unitLabel">
              <Input id="unitLabel" name="unitLabel" defaultValue={product?.unitLabel ?? "piece"} />
            </FormField>
            <FormField label="Weight (grams)" htmlFor="weightGrams" error={state.fieldErrors?.weightGrams}>
              <Input id="weightGrams" name="weightGrams" type="number" min={0} defaultValue={product?.weightGrams ?? ""} />
            </FormField>
            <FormField label="Tax rate (basis points)" htmlFor="taxRateBps" hint="1500 = 15% VAT.">
              <Input id="taxRateBps" name="taxRateBps" type="number" min={0} max={5000} defaultValue={product?.taxRateBps ?? 0} />
            </FormField>
            <FormField label="Packaging cost (BDT)" htmlFor="packagingCostPaisa" hint="Added per unit when calculating order profitability.">
              <Input
                id="packagingCostPaisa"
                name="packagingCostPaisa"
                type="number"
                step="0.01"
                min={0}
                defaultValue={product ? (product.packagingCostPaisa / 100).toFixed(2) : "0.00"}
              />
            </FormField>
            <FormField label="Preorder expected date" htmlFor="preorderExpectedAt">
              <Input id="preorderExpectedAt" name="preorderExpectedAt" type="date" />
            </FormField>
          </div>

          <FormField label="Short description" htmlFor="shortDescription">
            <Input id="shortDescription" name="shortDescription" defaultValue={product?.shortDescription ?? ""} />
          </FormField>
          <FormField label="Description" htmlFor="description">
            <Textarea id="description" name="description" rows={5} defaultValue={product?.description ?? ""} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="SEO title" htmlFor="seoTitle">
              <Input id="seoTitle" name="seoTitle" defaultValue={product?.seoTitle ?? ""} />
            </FormField>
            <FormField label="SEO description" htmlFor="seoDescription" className="sm:col-span-2">
              <Input id="seoDescription" name="seoDescription" defaultValue={product?.seoDescription ?? ""} />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requiresShipping" defaultChecked={product?.requiresShipping ?? true} className="h-4 w-4 rounded border-slate-300" />
              Requires shipping
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isFeatured" defaultChecked={product?.isFeatured ?? false} className="h-4 w-4 rounded border-slate-300" />
              Featured
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isPreorderEnabled"
                defaultChecked={product?.isPreorderEnabled ?? false}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow preorder when out of stock
            </label>
          </div>
          <FormField label="Preorder note" htmlFor="preorderNote" hint="Shown to customers when the item is not in stock.">
            <Input id="preorderNote" name="preorderNote" defaultValue={product?.preorderNote ?? ""} />
          </FormField>
        </CardContent>
      </Card>

      {/* Hidden inputs for selected media IDs */}
      {selectedImages.map((img, i) => (
        <input key={img.id} type="hidden" name="mediaIds" value={img.id} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Media</CardTitle>
        </CardHeader>
        <CardContent>
          <MultiMediaField
            label="Product images"
            value={selectedImages}
            onChange={setSelectedImages}
            maxSelection={20}
            mimeGroup="image"
          />
          <p className="mt-2 text-xs text-slate-500">
            The first image is used as the primary product image. Drag to reorder after selection.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Categories</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    checked={selectedCategoryIds.includes(category.id)}
                    onChange={(event) =>
                      setSelectedCategoryIds((current) =>
                        event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="truncate">{category.path ?? category.name}</span>
                </label>
              ))}
              {categories.length === 0 ? <p className="text-sm text-slate-500">No categories yet.</p> : null}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Attributes {selectedAttributeIds.length > 0 ? `(${selectedAttributeIds.length} selected)` : ""}
            </p>
            <div className="space-y-3">
              {attributes.map((attribute) => {
                const selected = selectedAttributeIds.includes(attribute.id);
                return (
                  <div key={attribute.id} className="rounded-lg border border-slate-200 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        name="attributeIds"
                        value={attribute.id}
                        checked={selected}
                        onChange={(event) =>
                          setSelectedAttributeIds((current) =>
                            event.target.checked ? [...current, attribute.id] : current.filter((id) => id !== attribute.id),
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {attribute.name}
                      <span className="text-xs font-normal text-slate-400">{attribute.type.toLowerCase()}</span>
                    </label>
                    {selected ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {attribute.values.map((value) => (
                          <label
                            key={value.id}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                              selectedValueIds.includes(value.id)
                                ? "border-brand-300 bg-brand-50 text-brand-700"
                                : "border-slate-200 text-slate-600",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={selectedValueIds.includes(value.id)}
                              onChange={(event) =>
                                setSelectedValueIds((current) =>
                                  event.target.checked ? [...current, value.id] : current.filter((id) => id !== value.id),
                                )
                              }
                            />
                            {value.colorHex ? (
                              <span className="h-3 w-3 rounded-full border border-slate-300" style={{ backgroundColor: value.colorHex }} />
                            ) : null}
                            {value.value}
                          </label>
                        ))}
                        {attribute.values.length === 0 ? (
                          <span className="text-xs text-slate-400">No values configured for this attribute yet.</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {attributes.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No attributes yet — create them on the{" "}
                  <Link href="/admin/catalog/attributes" className="text-brand-600 hover:underline">
                    attributes page
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variants</CardTitle>
          <p className="text-xs text-slate-500">
            Prices are stored in {defaultPriceListName}. Each combination must be unique.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={generateCombinations} disabled={relevantAttributes.length === 0}>
                Generate combinations
              </Button>
              <span className="text-xs text-slate-500">
                Uses the attribute values selected above; existing rows keep the values you typed.
              </span>
            </div>
          ) : null}

          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={row.key} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="Variant name" htmlFor={`variantName-${index}`}>
                    <Input
                      id={`variantName-${index}`}
                      name="variantName"
                      value={row.name}
                      onChange={(event) => updateRow(row.key, { name: event.target.value })}
                    />
                  </FormField>
                  <FormField label="SKU" htmlFor={`variantSku-${index}`} required>
                    <Input
                      id={`variantSku-${index}`}
                      name="variantSku"
                      value={row.sku}
                      onChange={(event) => updateRow(row.key, { sku: event.target.value })}
                      required
                    />
                  </FormField>
                  <FormField label="Price (BDT)" htmlFor={`variantPrice-${index}`} required>
                    <Input
                      id={`variantPrice-${index}`}
                      name="variantPrice"
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.price}
                      onChange={(event) => updateRow(row.key, { price: event.target.value })}
                      required
                    />
                  </FormField>
                  <FormField label="Cost (BDT)" htmlFor={`variantCost-${index}`} hint="Used for margin reporting.">
                    <Input
                      id={`variantCost-${index}`}
                      name="variantCost"
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.cost}
                      onChange={(event) => updateRow(row.key, { cost: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Compare-at price" htmlFor={`variantCompareAt-${index}`}>
                    <Input
                      id={`variantCompareAt-${index}`}
                      name="variantCompareAt"
                      type="number"
                      step="0.01"
                      min={0}
                      value={row.compareAt}
                      onChange={(event) => updateRow(row.key, { compareAt: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Barcode" htmlFor={`variantBarcode-${index}`}>
                    <Input
                      id={`variantBarcode-${index}`}
                      name="variantBarcode"
                      value={row.barcode}
                      onChange={(event) => updateRow(row.key, { barcode: event.target.value })}
                    />
                  </FormField>
                  <FormField label="Weight (g)" htmlFor={`variantWeight-${index}`}>
                    <Input
                      id={`variantWeight-${index}`}
                      name="variantWeight"
                      type="number"
                      min={0}
                      value={row.weight}
                      onChange={(event) => updateRow(row.key, { weight: event.target.value })}
                    />
                  </FormField>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        name="variantPreorder"
                        checked={row.isPreorder}
                        onChange={(event) => updateRow(row.key, { isPreorder: event.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Preorder OK
                    </label>
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.name}`}
                        onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {!isEdit
                  ? row.attributeValueIds.map((valueId, valueIndex) => (
                      <input key={valueId} type="hidden" name={`variantAttributes_${index}`} value={valueId} data-index={valueIndex} />
                    ))
                  : null}
                <input type="hidden" name="variantId" value={product?.variants[index]?.id ?? ""} />
              </div>
            ))}
          </div>

          {!isEdit ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, newRow(current.length)])}>
              <Plus className="mr-1 h-4 w-4" /> Add variant
            </Button>
          ) : null}
        </CardContent>
        <CardFooter className="justify-between">
          <Link href="/admin/catalog/products" className={cn(buttonVariants({ variant: "secondary" }))}>
            Cancel
          </Link>
          <SubmitButton pendingLabel="Saving…" disabled={pending}>
            {isEdit ? "Save product" : "Create product"}
          </SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}

/** Bulk editor for variant price/cost/status, submitted as a single action. */
export function BulkVariantEditor({
  productId,
  variants,
}: {
  productId: string;
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    pricePaisa: number | null;
    costPaisa: number | null;
    compareAtPricePaisa: number | null;
    status: string;
  }>;
}) {
  const [state, formAction, pending] = useActionState(bulkUpdateVariantsAction, initialActionState);

  return (
    <form action={formAction}>
      <input type="hidden" name="productId" value={productId} />
      <Card>
        <CardHeader>
          <CardTitle>Bulk variant editor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Price (BDT)</th>
                  <th className="px-2 py-2">Compare-at</th>
                  <th className="px-2 py-2">Cost (BDT)</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <input type="hidden" name="bulkVariantId" value={variant.id} />
                      <span className="font-mono text-xs">{variant.sku}</span>
                      <p className="text-xs text-slate-500">{variant.name}</p>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        name="bulkPrice"
                        type="number"
                        step="0.01"
                        min={0}
                        defaultValue={variant.pricePaisa != null ? (variant.pricePaisa / 100).toFixed(2) : ""}
                        className="h-9 w-28"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        name="bulkCompareAt"
                        type="number"
                        step="0.01"
                        min={0}
                        defaultValue={variant.compareAtPricePaisa != null ? (variant.compareAtPricePaisa / 100).toFixed(2) : ""}
                        className="h-9 w-28"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        name="bulkCost"
                        type="number"
                        step="0.01"
                        min={0}
                        defaultValue={variant.costPaisa != null ? (variant.costPaisa / 100).toFixed(2) : ""}
                        className="h-9 w-28"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <NativeSelect name="bulkStatus" defaultValue={variant.status} className="h-9 w-32">
                        <option value="ACTIVE">Active</option>
                        <option value="ARCHIVED">Archived</option>
                      </NativeSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter>
          <SubmitButton pendingLabel="Saving…" disabled={pending}>
            Save all variants
          </SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}
