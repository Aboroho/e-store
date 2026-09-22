"use client";

import * as React from "react";
import { Archive, ImageIcon, RotateCcw, Search } from "lucide-react";
import { Badge, Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/tooltip";
import { MediaThumb } from "@/components/media/media-field";
import { MediaPicker } from "@/components/media/media-picker";
import { cn } from "@/lib/utils";
import { formatPaisa } from "@/lib/money";
import { calculatePricing } from "@/modules/catalog/pricing-rules";
import { browseMediaAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import {
  DEFAULT_WEIGHT_UNIT,
  WEIGHT_UNITS,
  resolveVariantImage,
  variantLabel,
  type DraftAttribute,
  type DraftVariant,
  type WeightUnit,
} from "@/modules/catalog/product-draft";
import { resolvePricing, type PricingLevelInput } from "@/modules/catalog/inheritance";

/**
 * The variant table.
 *
 * Beyond editing rows, three things matter here:
 *
 *  - **no variant SKU**: the product owns the SKU, so a row is identified by its
 *    options (and its persisted id once saved);
 *  - **why** a row shows the price and image it shows — the badge under each
 *    value says whether it is a manual override, an attribute-level override or
 *    the product default, and one click restores inheritance;
 *  - **staying responsive** with hundreds of rows: images are resolved once per
 *    page through a single media query, rows are memoised, and the list is
 *    filtered and paginated instead of rendering everything.
 *
 * Every change here is local form state. Nothing is written until the product is
 * saved, and a row that is removed is archived (never deleted) on save.
 */

export interface VariantTableProps {
  rows: DraftVariant[];
  attributes: DraftAttribute[];
  /** Keys that no longer belong to the generated matrix (kept, never dropped silently). */
  orphanKeys?: string[];
  productImage: MediaAssetView | null;
  /** Product default pricing — level 3 of the inheritance model. */
  productPricing: PricingLevelInput;
  inheritedWeight?: string;
  inheritedWeightUnit?: WeightUnit;
  selectedKeys: string[];
  /** Extra controls rendered next to “Rows per page” (bulk edit trigger). */
  toolbarExtra?: React.ReactNode;
  /** Per-row validation messages, keyed by variant key (bad prices, duplicates…). */
  rowErrors?: Record<string, string>;
  onSelectionChange: (keys: string[]) => void;
  onUpdate: (key: string, patch: Partial<DraftVariant>, options?: { touched?: boolean }) => void;
  onRemove: (key: string) => void;
  canViewCost: boolean;
}

const PAGE_SIZES = [25, 50, 100, 250];

function formatInheritedMoney(paisa: number | null | undefined): string {
  if (paisa == null || paisa <= 0) return "";
  return paisa % 100 === 0 ? String(paisa / 100) : (paisa / 100).toFixed(2);
}

function toPaisa(value: string | null | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** The pricing override this row carries (empty values mean "inherit"). */
function overrideFor(row: DraftVariant): PricingLevelInput | null {
  const currentPricePaisa = toPaisa(row.currentPrice);
  const pricePaisa = toPaisa(row.price);
  if ((currentPricePaisa == null || currentPricePaisa <= 0) && (pricePaisa == null || pricePaisa <= 0)) return null;
  return {
    currentPricePaisa,
    discountType: row.discountType ?? "NONE",
    discountValue: row.discountValue ? Number(row.discountValue) : 0,
    pricePaisa,
    compareAtPricePaisa: toPaisa(row.compareAt),
  };
}

/** Effective price of a row, resolved with the same rule the server uses. */
export function effectiveRowPrice(
  row: DraftVariant,
  attributes: DraftAttribute[],
  productPricing: PricingLevelInput,
) {
  return resolvePricing({
    productDefault: productPricing,
    attributeValues: attributes.flatMap((attribute) =>
      attribute.values
        .filter((value) => row.attributeValueIds.includes(value.id))
        .filter((value) => (value.priceOverridePaisa ?? 0) > 0 || (value.currentPricePaisa ?? 0) > 0)
        .map((value) => ({
          attributeValueId: value.id,
          attributeName: attribute.name,
          valueLabel: value.value,
          value: {
            currentPricePaisa: value.currentPricePaisa ?? null,
            discountType: (value.discountType ?? "NONE") as PricingLevelInput["discountType"],
            discountValue: value.discountValue ?? 0,
            pricePaisa: value.priceOverridePaisa ?? null,
          },
        })),
    ),
    variantOverride: overrideFor(row),
    clearOverride: row.clearPriceOverride,
  });
}

export function VariantTable({
  rows,
  attributes,
  orphanKeys = [],
  productImage,
  productPricing,
  inheritedWeight = "",
  inheritedWeightUnit = DEFAULT_WEIGHT_UNIT,
  selectedKeys,
  rowErrors = {},
  onSelectionChange,
  onUpdate,
  onRemove,
  canViewCost: _canViewCost,
  toolbarExtra,
}: VariantTableProps) {
  const [query, setQuery] = React.useState("");
  const [valueFilter, setValueFilter] = React.useState("");
  const [pageSize, setPageSize] = React.useState(25);
  const [page, setPage] = React.useState(1);

  const valueLabels = React.useMemo(() => {
    const map = new Map<string, { attribute: string; value: string }>();
    for (const attribute of attributes) {
      for (const value of attribute.values) map.set(value.id, { attribute: attribute.name, value: value.value });
    }
    return map;
  }, [attributes]);

  const productImageId = productImage?.id ?? null;

  /** Assets referenced by the visible rows, resolved with a single media query. */
  const [assets, setAssets] = React.useState<Record<string, MediaAssetView>>({});
  const neededIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.imageMediaId) ids.add(row.imageMediaId);
      else {
        const resolved = resolveVariantImage({
          imageMediaId: null,
          attributeValueIds: row.attributeValueIds,
          productImageMediaId: productImageId,
          attributes,
        });
        if (resolved.mediaId) ids.add(resolved.mediaId);
      }
    }
    if (productImageId) ids.add(productImageId);
    return [...ids];
  }, [rows, attributes, productImageId]);

  const [previousProductImage, setPreviousProductImage] = React.useState(productImage);
  if (productImage !== previousProductImage) {
    setPreviousProductImage(productImage);
    if (productImage) {
      setAssets((current) => (current[productImage.id] ? current : { ...current, [productImage.id]: productImage }));
    }
  }

  React.useEffect(() => {
    const missing = neededIds.filter((id) => !assets[id] && id !== productImageId);
    if (missing.length === 0) return;

    let live = true;
    void (async () => {
      try {
        const result = await browseMediaAction({ page: 1, pageSize: 200, mimeGroup: "image" });
        if (!live) return;
        const found = Object.fromEntries(result.rows.map((asset) => [asset.id, asset]));
        setAssets((current) => ({ ...current, ...found }));
      } catch {
        /* A failed thumbnail lookup only means no preview; the fields still work. */
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assets is read only to skip already-known ids
  }, [neededIds.join("|"), productImageId, productImage]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (valueFilter && !row.attributeValueIds.includes(valueFilter)) return false;
      if (!needle) return true;
      const haystack = [row.name, row.barcode ?? "", ...row.attributeValueIds.map((id) => valueLabels.get(id)?.value ?? "")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, query, valueFilter, valueLabels]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = React.useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  const selected = React.useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const pageKeys = pageRows.map((row) => row.key);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));

  const togglePage = () => {
    if (allPageSelected) {
      onSelectionChange(selectedKeys.filter((key) => !pageKeys.includes(key)));
      return;
    }
    onSelectionChange([...new Set([...selectedKeys, ...pageKeys])]);
  };

  const selectMatching = () => onSelectionChange([...new Set([...selectedKeys, ...filtered.map((row) => row.key)])]);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        This product has no variants yet. Choose the attribute values above, then generate the combinations — or add a single variant by
        hand.
      </p>
    );
  }

  const shared = {
    attributes,
    valueLabels,
    assets,
    orphanKeys,
    rowErrors,
    productPricing,
    inheritedWeight,
    inheritedWeightUnit,
    onUpdate,
    onRemove,
    canViewCost: _canViewCost,
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="variant-search" className="text-xs">
            Search variants
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              id="variant-search"
              className="h-9 w-60 pl-8"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Option or barcode"
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="variant-filter" className="text-xs">
              Only variants with
            </Label>
            <InfoTip>
              Narrow the table to one attribute value — for example every Black variant — before selecting them for a bulk change.
            </InfoTip>
          </div>
          <NativeSelect
            id="variant-filter"
            className="h-9 w-52"
            value={valueFilter}
            onChange={(event) => {
              setValueFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All attribute values</option>
            {attributes.map((attribute) => (
              <optgroup key={attribute.id} label={attribute.name}>
                {attribute.values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {attribute.name}: {value.value}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1">
          <Label htmlFor="variant-page-size" className="text-xs">
            Rows per page
          </Label>
          <NativeSelect
            id="variant-page-size"
            className="h-9 w-24"
            value={String(pageSize)}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
        </div>

        {toolbarExtra ? <div className="pb-0.5">{toolbarExtra}</div> : null}

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <Button type="button" variant="outline" size="sm" onClick={selectMatching} disabled={filtered.length === 0}>
            Select {filtered.length} shown
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelectionChange([])} disabled={selectedKeys.length === 0}>
            Clear selection ({selectedKeys.length})
          </Button>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
        <table className="w-full min-w-[90rem] text-sm">
          <caption className="sr-only">Product variants</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={allPageSelected}
                  onChange={togglePage}
                  aria-label="Select every variant on this page"
                />
              </th>
              <th scope="col" className="px-3 py-2">
                Variant
              </th>
              <th scope="col" className="px-3 py-2">
                Image
              </th>
              <th scope="col" className="px-3 py-2">
                Current price
              </th>
              <th scope="col" className="px-3 py-2">
                Discount type
              </th>
              <th scope="col" className="px-3 py-2">
                Discount
              </th>
              <th scope="col" className="px-3 py-2">
                Sell price
              </th>
              <th scope="col" className="px-3 py-2">
                Weight
              </th>
              <th scope="col" className="px-3 py-2">
                Preorder
              </th>
              <th scope="col" className="px-3 py-2">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <VariantRow
                key={row.key}
                row={row}
                selected={selected.has(row.key)}
                onSelect={(checked) =>
                  onSelectionChange(checked ? [...new Set([...selectedKeys, row.key])] : selectedKeys.filter((key) => key !== row.key))
                }
                productImageId={productImageId}
                {...shared}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {pageRows.map((row) => (
          <VariantCard
            key={row.key}
            row={row}
            selected={selected.has(row.key)}
            onSelect={(checked) =>
              onSelectionChange(checked ? [...new Set([...selectedKeys, row.key])] : selectedKeys.filter((key) => key !== row.key))
            }
            productImageId={productImageId}
            {...shared}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          Showing {pageRows.length} of {filtered.length} variant(s)
          {filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ""}
          {selectedKeys.length > 0 ? ` · ${selectedKeys.length} selected` : ""}
        </span>
        {totalPages > 1 ? (
          <span className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
              Next
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface RowSharedProps {
  row: DraftVariant;
  attributes: DraftAttribute[];
  valueLabels: Map<string, { attribute: string; value: string }>;
  assets: Record<string, MediaAssetView>;
  orphanKeys: string[];
  rowErrors: Record<string, string>;
  productImageId: string | null;
  productPricing: PricingLevelInput;
  inheritedWeight: string;
  inheritedWeightUnit: WeightUnit;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onUpdate: VariantTableProps["onUpdate"];
  onRemove: VariantTableProps["onRemove"];
  canViewCost: boolean;
}

function optionSummary(row: DraftVariant, valueLabels: RowSharedProps["valueLabels"]) {
  const labels = row.attributeValueIds
    .map((id) => valueLabels.get(id))
    .filter((entry): entry is { attribute: string; value: string } => Boolean(entry))
    .map((entry) => `${entry.attribute}: ${entry.value}`);
  if (labels.length === 0) return variantLabel([], row.attributeValueIds) || "No options";
  return labels.join(" · ");
}

/** Image cell: shows the effective image plus exactly where it comes from. */
function VariantImageCell({ row, attributes, assets, productImageId, onUpdate }: RowSharedProps) {
  const resolved = resolveVariantImage({
    imageMediaId: row.imageMediaId,
    attributeValueIds: row.attributeValueIds,
    productImageMediaId: productImageId,
    attributes,
  });
  const asset = resolved.mediaId ? assets[resolved.mediaId] ?? null : null;

  return (
    <div className="flex items-start gap-2">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        {asset ? (
          <MediaThumb asset={asset} rounded="rounded-none" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <SourceBadge label={resolved.label} />
        <div className="flex items-center gap-1">
          <MediaPicker
            title={`Image for ${row.name || "this variant"}`}
            mimeGroup="image"
            onSelect={(chosen) => onUpdate(row.key, { imageMediaId: chosen.id, clearImageOverride: false }, { touched: true })}
            trigger={
              <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-[11px]">
                {row.imageMediaId ? "Replace" : "Set image"}
              </Button>
            }
          />
          {row.imageMediaId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-[11px]"
              title="Drop the variant image so the attribute or product image is used again"
              onClick={() => onUpdate(row.key, { imageMediaId: null, clearImageOverride: true }, { touched: true })}
            >
              Use default
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Small badge naming where an effective value came from. */
export function SourceBadge({ label }: { label: string }) {
  const tone = label.startsWith("Custom variant")
    ? "bg-violet-50 text-violet-700"
    : label.startsWith("Inherited from product")
      ? "bg-slate-100 text-slate-600"
      : label.startsWith("Inherited from")
        ? "bg-sky-50 text-sky-700"
        : "bg-slate-100 text-slate-500";
  return (
    <span className={cn("inline-flex max-w-[13rem] items-center truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium", tone)} title={label}>
      {label}
    </span>
  );
}

function displayedPricing(row: DraftVariant, productPricing: PricingLevelInput) {
  const inheritedCurrent = formatInheritedMoney(productPricing.currentPricePaisa);
  const inheritedType = productPricing.discountType ?? "NONE";
  const inheritedDiscount =
    inheritedType === "NONE" || !productPricing.discountValue ? "" : String(productPricing.discountValue);
  const inheriting =
    Boolean(row.clearPriceOverride) ||
    (!row.currentPrice?.trim() && !row.discountValue?.trim() && (!row.discountType || row.discountType === "NONE"));
  return {
    inheriting,
    current: inheriting ? inheritedCurrent : (row.currentPrice ?? ""),
    type: (inheriting ? inheritedType : (row.discountType ?? inheritedType)) as DraftVariant["discountType"],
    discount: inheriting ? inheritedDiscount : (row.discountValue ?? ""),
    inheritedCurrent,
    inheritedType,
    inheritedDiscount,
  };
}

function VariantPriceFields({
  row,
  attributes,
  productPricing,
  onUpdate,
  layout,
}: RowSharedProps & { layout: "row" | "stack" }) {
  const effective = effectiveRowPrice(row, attributes, productPricing);
  const display = displayedPricing(row, productPricing);
  const hasOverride = !display.inheriting;

  const commit = (patch: Partial<DraftVariant>) => {
    onUpdate(
      row.key,
      {
        currentPrice: patch.currentPrice ?? (display.inheriting ? display.inheritedCurrent : display.current),
        discountType: patch.discountType ?? display.type,
        discountValue: patch.discountValue ?? display.discount,
        clearPriceOverride: false,
        price: "",
      },
      { touched: true },
    );
  };

  const sell = calculatePricing({
    currentPricePaisa: toPaisa(display.current) ?? 0,
    discountType: display.type ?? "NONE",
    discountValue: Number(display.discount) || 0,
  });

  const currentField = (
    <Input
      aria-label={`Current price for ${row.name}`}
      className={cn("h-9 w-24", display.inheriting && "text-slate-500")}
      inputMode="decimal"
      value={display.current}
      onChange={(event) => commit({ currentPrice: event.target.value })}
    />
  );
  const typeField = (
    <NativeSelect
      aria-label={`Discount type for ${row.name}`}
      className={cn("h-9 w-32", display.inheriting && "text-slate-500")}
      value={display.type ?? "NONE"}
      onChange={(event) => commit({ discountType: event.target.value as DraftVariant["discountType"] })}
    >
      <option value="NONE">No discount</option>
      <option value="PERCENTAGE">Percentage</option>
      <option value="FLAT">Flat</option>
    </NativeSelect>
  );
  const discountField = (
    <Input
      aria-label={`Discount for ${row.name}`}
      className={cn("h-9 w-20", display.inheriting && "text-slate-500")}
      inputMode="decimal"
      disabled={(display.type ?? "NONE") === "NONE"}
      value={display.discount}
      onChange={(event) => commit({ discountValue: event.target.value })}
    />
  );
  const sellField = (
    <div className="space-y-1">
      <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm font-medium text-slate-800">
        {formatPaisa(sell.sellPricePaisa)}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <SourceBadge label={effective.label} />
        {hasOverride ? (
          <button
            type="button"
            className="text-[11px] font-medium text-brand-700 underline"
            onClick={() =>
              onUpdate(
                row.key,
                { currentPrice: "", discountType: "NONE", discountValue: "", price: "", compareAt: "", clearPriceOverride: true },
                { touched: true },
              )
            }
          >
            Use default
          </button>
        ) : null}
      </div>
    </div>
  );

  if (layout === "stack") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Current price</Label>
          {currentField}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Discount type</Label>
          {typeField}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Discount</Label>
          {discountField}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Sell price</Label>
          {sellField}
        </div>
      </div>
    );
  }

  return (
    <>
      <td className="px-3 py-2">{currentField}</td>
      <td className="px-3 py-2">{typeField}</td>
      <td className="px-3 py-2">{discountField}</td>
      <td className="px-3 py-2">{sellField}</td>
    </>
  );
}

const VariantRow = React.memo(function VariantRow(props: RowSharedProps) {
  const { row, valueLabels, orphanKeys, rowErrors, selected, onSelect, onUpdate, onRemove } = props;
  const isOrphan = orphanKeys.includes(row.key);
  const error = rowErrors[row.key];

  return (
    <tr className={cn("border-t border-slate-100 align-top", isOrphan && "bg-amber-50/40")}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={`Select variant ${row.name || "row"}`}
        />
      </td>
      <td className="max-w-[16rem] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-800">{row.name || "Untitled variant"}</p>
          {isOrphan ? (
            <Badge
              variant="warning"
              title="This variant is no longer part of the generated combinations. It keeps its data and is archived only if you remove it."
            >
              Not in matrix
            </Badge>
          ) : null}
          {row.id ? null : <Badge variant="brand">New</Badge>}
        </div>
        <p className="text-xs text-slate-500">{optionSummary(row, valueLabels)}</p>
        {error ? <p className="mt-1 max-w-[14rem] text-[11px] text-red-600">{error}</p> : null}
      </td>
      <td className="px-3 py-2">
        <VariantImageCell {...props} />
      </td>
      <VariantPriceFields {...props} layout="row" />
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Weight for ${row.name}`}
            className={cn("h-9 w-20", (!row.weight?.trim() || row.clearWeightOverride) && "text-slate-500")}
            inputMode="decimal"
            value={!row.weight?.trim() || row.clearWeightOverride ? props.inheritedWeight : row.weight}
            onChange={(event) => onUpdate(row.key, { weight: event.target.value, clearWeightOverride: false }, { touched: true })}
          />
          <NativeSelect
            aria-label={`Weight unit for ${row.name}`}
            className="h-9 w-20"
            value={row.weightUnit ?? props.inheritedWeightUnit ?? DEFAULT_WEIGHT_UNIT}
            onChange={(event) => onUpdate(row.key, { weightUnit: event.target.value as WeightUnit, clearWeightOverride: false }, { touched: true })}
          >
            {WEIGHT_UNITS.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.value}
              </option>
            ))}
          </NativeSelect>
        </div>
      </td>
      <td className="px-3 py-2">
        <NativeSelect
          aria-label={`Preorder for ${row.name}`}
          className="h-9 w-28"
          value={row.isPreorderEnabled === undefined ? "" : row.isPreorderEnabled ? "ON" : "OFF"}
          onChange={(event) =>
            onUpdate(
              row.key,
              {
                isPreorderEnabled: event.target.value === "" ? undefined : event.target.value === "ON",
                clearPreorderOverride: event.target.value === "",
              },
              { touched: true },
            )
          }
        >
          <option value="">Use product setting</option>
          <option value="ON">Allowed</option>
          <option value="OFF">Not allowed</option>
        </NativeSelect>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Reset the image of ${row.name} to the inherited one`}
            disabled={!row.imageMediaId}
            onClick={() => onUpdate(row.key, { imageMediaId: null, clearImageOverride: true }, { touched: true })}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-red-600 hover:bg-red-50"
            title="Removes the variant from the form. On save it is archived, never deleted — its order history stays intact."
            onClick={() => onRemove(row.key)}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </td>
    </tr>
  );
});

const VariantCard = React.memo(function VariantCard(props: RowSharedProps) {
  const { row, valueLabels, orphanKeys, rowErrors, selected, onSelect, onUpdate, onRemove } = props;
  const isOrphan = orphanKeys.includes(row.key);
  const error = rowErrors[row.key];

  return (
    <li className={cn("space-y-3 rounded-lg border border-slate-200 bg-white p-3", isOrphan && "border-amber-200 bg-amber-50/40")}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          aria-label={`Select variant ${row.name || "row"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{row.name || "Untitled variant"}</p>
          <p className="text-xs text-slate-500">{optionSummary(row, valueLabels)}</p>
          {isOrphan ? <Badge variant="warning">Not in matrix</Badge> : null}
          {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
        </div>
        <VariantImageCell {...props} />
      </div>

      <VariantPriceFields {...props} layout="stack" />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Weight for ${row.name}`}
            inputMode="decimal"
            className={cn((!row.weight?.trim() || row.clearWeightOverride) && "text-slate-500")}
            value={!row.weight?.trim() || row.clearWeightOverride ? props.inheritedWeight : row.weight}
            onChange={(event) => onUpdate(row.key, { weight: event.target.value, clearWeightOverride: false }, { touched: true })}
          />
          <NativeSelect
            aria-label={`Weight unit for ${row.name}`}
            value={row.weightUnit ?? props.inheritedWeightUnit ?? DEFAULT_WEIGHT_UNIT}
            onChange={(event) => onUpdate(row.key, { weightUnit: event.target.value as WeightUnit, clearWeightOverride: false }, { touched: true })}
          >
            {WEIGHT_UNITS.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <NativeSelect
          aria-label={`Preorder for ${row.name}`}
          className="h-9 w-32"
          value={row.isPreorderEnabled === undefined ? "" : row.isPreorderEnabled ? "ON" : "OFF"}
          onChange={(event) =>
            onUpdate(
              row.key,
              {
                isPreorderEnabled: event.target.value === "" ? undefined : event.target.value === "ON",
                clearPreorderOverride: event.target.value === "",
              },
              { touched: true },
            )
          }
        >
          <option value="">Preorder: product setting</option>
          <option value="ON">Preorder: allowed</option>
          <option value="OFF">Preorder: off</option>
        </NativeSelect>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!row.imageMediaId}
            onClick={() => onUpdate(row.key, { imageMediaId: null, clearImageOverride: true }, { touched: true })}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset image
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => onRemove(row.key)}>
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </div>
    </li>
  );
});
