"use client";

import * as React from "react";
import { Archive, ImageIcon, RotateCcw, Search, Star } from "lucide-react";
import { Badge, Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/tooltip";
import { MediaThumb } from "@/components/media/media-field";
import { MediaPicker } from "@/components/media/media-picker";
import { cn } from "@/lib/utils";
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

/**
 * The variant table.
 *
 * Beyond editing rows, two things matter here:
 *
 *  - **why** a variant shows the image it shows (variant override / attribute-value
 *    default / product default), so inheritance is never mistaken for a missing
 *    image, and a one-click reset restores it;
 *  - **staying responsive** with hundreds of rows: images are resolved once per page
 *    through a single media query, rows are memoised, and the list is filtered and
 *    paginated instead of rendering everything.
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
  selectedKeys: string[];
  /** Per-row validation messages, keyed by variant key (SKU clashes, bad prices…). */
  rowErrors?: Record<string, string>;
  onSelectionChange: (keys: string[]) => void;
  onUpdate: (key: string, patch: Partial<DraftVariant>, options?: { touched?: boolean }) => void;
  onRemove: (key: string) => void;
  canViewCost: boolean;
}

const PAGE_SIZES = [25, 50, 100, 250];

export function VariantTable({
  rows,
  attributes,
  orphanKeys = [],
  productImage,
  selectedKeys,
  rowErrors = {},
  onSelectionChange,
  onUpdate,
  onRemove,
  canViewCost,
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

  // The product primary image is already in memory — seed it into the thumbnail map
  // as soon as it changes (render-time adjustment, no effect round-trip).
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
    const controller = new AbortController();
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
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assets is read only to skip already-known ids
  }, [neededIds.join("|"), productImageId, productImage]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (valueFilter && !row.attributeValueIds.includes(valueFilter)) return false;
      if (!needle) return true;
      const haystack = [
        row.sku,
        row.name,
        row.barcode ?? "",
        ...row.attributeValueIds.map((id) => valueLabels.get(id)?.value ?? ""),
      ]
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
    onUpdate,
    onRemove,
    canViewCost,
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
              placeholder="SKU, barcode or option"
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="variant-filter" className="text-xs">
              Only variants with
            </Label>
            <InfoTip>Narrow the table to one attribute value, for example every Black variant, before selecting them in bulk.</InfoTip>
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
        <table className="w-full min-w-[66rem] text-sm">
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
              <th scope="col" className="px-3 py-2">Variant</th>
              <th scope="col" className="px-3 py-2">Image</th>
              <th scope="col" className="px-3 py-2">Code (SKU)</th>
              <th scope="col" className="px-3 py-2">Price</th>
              <th scope="col" className="px-3 py-2">Compare at</th>
              {canViewCost ? <th scope="col" className="px-3 py-2">Cost</th> : null}
              <th scope="col" className="px-3 py-2">Weight</th>
              <th scope="col" className="px-3 py-2">Preorder</th>
              <th scope="col" className="px-3 py-2">Actions</th>
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
        <MediaSourceBadge source={resolved.label} inline />
        <div className="flex items-center gap-1">
          <MediaPicker
            title={`Image for ${row.name || row.sku || "variant"}`}
            mimeGroup="image"
            onSelect={(chosen) => onUpdate(row.key, { imageMediaId: chosen.id }, { touched: true })}
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
              onClick={() => onUpdate(row.key, { imageMediaId: null }, { touched: true })}
            >
              Inherit
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Small text badge naming the source of the effective image. */
function MediaSourceBadge({ source, inline }: { source: string; inline?: boolean }) {
  const isOverride = source.startsWith("Custom variant");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        isOverride ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600",
        inline && "whitespace-nowrap",
      )}
      title={source}
    >
      {isOverride ? <Star className="h-2.5 w-2.5" aria-hidden="true" /> : null}
      <span className="max-w-[11rem] truncate">{source}</span>
    </span>
  );
}

const VariantRow = React.memo(function VariantRow(props: RowSharedProps) {
  const { row, valueLabels, orphanKeys, rowErrors, selected, onSelect, onUpdate, onRemove, canViewCost, attributes, assets, productImageId } = props;
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
          aria-label={`Select variant ${row.sku || row.name}`}
        />
      </td>
      <td className="max-w-[16rem] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-800">{row.name || "Untitled variant"}</p>
          {isOrphan ? (
            <Badge variant="warning" title="This variant is no longer part of the generated combinations. It keeps its data and is archived only if you remove it.">
              Not in matrix
            </Badge>
          ) : null}
          {row.id ? null : <Badge variant="brand">New</Badge>}
        </div>
        <p className="text-xs text-slate-500">{optionSummary(row, valueLabels)}</p>
        {row.id ? <p className="font-mono text-[10px] text-slate-400">{row.id.slice(0, 8)}</p> : null}
      </td>
      <td className="px-3 py-2">
        <VariantImageCell
          row={row}
          attributes={attributes}
          assets={assets}
          productImageId={productImageId}
          onUpdate={onUpdate}
          valueLabels={valueLabels}
          orphanKeys={orphanKeys}
          rowErrors={rowErrors}
          selected={selected}
          onSelect={onSelect}
          onRemove={onRemove}
          canViewCost={canViewCost}
        />
      </td>
      <td className="px-3 py-2">
        <Input
          aria-label={`Variant code for ${row.name}`}
          className={cn("h-9 w-40", error && "border-red-400")}
          value={row.sku}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onUpdate(row.key, { sku: event.target.value })}
        />
        {error ? <p className="mt-1 max-w-[12rem] text-[11px] text-red-600">{error}</p> : null}
      </td>
      <td className="px-3 py-2">
        <Input
          aria-label={`Price for ${row.name}`}
          className="h-9 w-28"
          inputMode="decimal"
          value={row.price ?? ""}
          onChange={(event) => onUpdate(row.key, { price: event.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <Input
          aria-label={`Compare-at price for ${row.name}`}
          className="h-9 w-28"
          inputMode="decimal"
          value={row.compareAt ?? ""}
          onChange={(event) => onUpdate(row.key, { compareAt: event.target.value })}
        />
      </td>
      {canViewCost ? (
        <td className="px-3 py-2">
          <Input
            aria-label={`Cost for ${row.name}`}
            className="h-9 w-28"
            inputMode="decimal"
            value={row.cost ?? ""}
            onChange={(event) => onUpdate(row.key, { cost: event.target.value })}
          />
        </td>
      ) : null}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Weight for ${row.name}`}
            className="h-9 w-20"
            inputMode="decimal"
            value={row.weight ?? ""}
            onChange={(event) => onUpdate(row.key, { weight: event.target.value })}
          />
          <NativeSelect
            aria-label={`Weight unit for ${row.name}`}
            className="h-9 w-20"
            value={row.weightUnit ?? DEFAULT_WEIGHT_UNIT}
            onChange={(event) => onUpdate(row.key, { weightUnit: event.target.value as WeightUnit })}
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
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={Boolean(row.isPreorderEnabled)}
          onChange={(event) => onUpdate(row.key, { isPreorderEnabled: event.target.checked })}
          aria-label={`Allow preorder for ${row.name}`}
        />
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
            onClick={() => onUpdate(row.key, { imageMediaId: null }, { touched: true })}
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
  const { row, valueLabels, orphanKeys, rowErrors, selected, onSelect, onUpdate, onRemove, canViewCost, attributes, assets, productImageId } = props;
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
          aria-label={`Select variant ${row.sku || row.name}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{row.name || "Untitled variant"}</p>
          <p className="text-xs text-slate-500">{optionSummary(row, valueLabels)}</p>
          {isOrphan ? <Badge variant="warning">Not in matrix</Badge> : null}
        </div>
        <VariantImageCell
          row={row}
          attributes={attributes}
          assets={assets}
          productImageId={productImageId}
          onUpdate={onUpdate}
          valueLabels={valueLabels}
          orphanKeys={orphanKeys}
          rowErrors={rowErrors}
          selected={selected}
          onSelect={onSelect}
          onRemove={onRemove}
          canViewCost={canViewCost}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Input
            aria-label={`Variant code for ${row.name}`}
            className={cn(error && "border-red-400")}
            value={row.sku}
            placeholder="SKU"
            aria-invalid={error ? true : undefined}
            onChange={(event) => onUpdate(row.key, { sku: event.target.value })}
          />
          {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
        </div>
        <Input
          aria-label={`Price for ${row.name}`}
          inputMode="decimal"
          value={row.price ?? ""}
          placeholder="Price"
          onChange={(event) => onUpdate(row.key, { price: event.target.value })}
        />
        <Input
          aria-label={`Compare-at price for ${row.name}`}
          inputMode="decimal"
          value={row.compareAt ?? ""}
          placeholder="Compare at"
          onChange={(event) => onUpdate(row.key, { compareAt: event.target.value })}
        />
        {canViewCost ? (
          <Input
            aria-label={`Cost for ${row.name}`}
            inputMode="decimal"
            value={row.cost ?? ""}
            placeholder="Cost"
            onChange={(event) => onUpdate(row.key, { cost: event.target.value })}
          />
        ) : null}
        <div className="flex items-center gap-1">
          <Input
            aria-label={`Weight for ${row.name}`}
            inputMode="decimal"
            value={row.weight ?? ""}
            placeholder="Weight"
            onChange={(event) => onUpdate(row.key, { weight: event.target.value })}
          />
          <NativeSelect
            aria-label={`Weight unit for ${row.name}`}
            value={row.weightUnit ?? DEFAULT_WEIGHT_UNIT}
            onChange={(event) => onUpdate(row.key, { weightUnit: event.target.value as WeightUnit })}
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
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={Boolean(row.isPreorderEnabled)}
            onChange={(event) => onUpdate(row.key, { isPreorderEnabled: event.target.checked })}
          />
          Allow preorder
        </label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!row.imageMediaId}
            onClick={() => onUpdate(row.key, { imageMediaId: null }, { touched: true })}
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
