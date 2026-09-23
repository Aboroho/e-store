"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Search, Trash2 } from "lucide-react";
import { formatPaisa } from "@/lib/money";
import type { ProductViewVariant } from "@/modules/catalog/queries";
import { archiveVariantsAction } from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";

function VariantThumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- media is served from storage/CDN hosts
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function optionLabel(variant: ProductViewVariant): string {
  if (variant.attributesSummary && Object.keys(variant.attributesSummary).length > 0) {
    return Object.entries(variant.attributesSummary)
      .map(([attribute, value]) => `${attribute}: ${value}`)
      .join(" · ");
  }
  return variant.optionKey && variant.optionKey !== "default" ? variant.optionKey : "Default";
}

export function ProductVariantsPanel({
  productId,
  productName,
  productPreorder,
  variants,
  canEdit,
}: {
  productId: string;
  productName: string;
  productPreorder: boolean;
  variants: ProductViewVariant[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [optionFilter, setOptionFilter] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const optionValues = React.useMemo(() => {
    const values = new Set<string>();
    for (const variant of variants) {
      if (variant.attributesSummary) {
        for (const value of Object.values(variant.attributesSummary)) values.add(value);
      }
    }
    return [...values].sort();
  }, [variants]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return variants.filter((variant) => {
      if (optionFilter) {
        const summary = variant.attributesSummary ?? {};
        if (!Object.values(summary).includes(optionFilter) && variant.optionKey !== optionFilter) return false;
      }
      if (!needle) return true;
      const haystack = [variant.name, variant.barcode ?? "", optionLabel(variant), variant.optionKey].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [variants, query, optionFilter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((variant) => selected.has(variant.id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const variant of filtered) next.delete(variant.id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const variant of filtered) next.add(variant.id);
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    const result = await archiveVariantsAction({ productId, variantIds: ids });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirmDelete(false);
    setSelected(new Set());
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 px-4 pt-4">
        <div className="space-y-1">
          <label htmlFor="variant-view-search" className="text-xs font-medium text-slate-600">
            Search variants
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <Input
              id="variant-view-search"
              className="h-9 w-56 pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, option or barcode"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="variant-view-filter" className="text-xs font-medium text-slate-600">
            Filter by option
          </label>
          <NativeSelect
            id="variant-view-filter"
            className="h-9 w-48"
            value={optionFilter}
            onChange={(event) => setOptionFilter(event.target.value)}
          >
            <option value="">All options</option>
            {optionValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canEdit && selected.size > 0 ? (
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete selected ({selected.size})
          </Button>
        ) : null}
      </div>

      {error ? <p className="px-4 text-sm text-rose-600">{error}</p> : null}

      {filtered.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-500">No variants match the current filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={allFilteredSelected}
                    onChange={toggleAll}
                    aria-label="Select every visible variant"
                  />
                </TableHead>
              ) : null}
              <TableHead>Variant</TableHead>
              <TableHead>Options</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Preorder</TableHead>
              <TableHead>Weight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((variant) => (
              <TableRow key={variant.id}>
                {canEdit ? (
                  <TableCell className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={selected.has(variant.id)}
                      onChange={() => toggleOne(variant.id)}
                      aria-label={`Select ${variant.name}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <VariantThumb url={variant.image?.url ?? null} alt={variant.image?.alt ?? variant.name} />
                    <div>
                      <p className="font-medium text-slate-900">{variant.name}</p>
                      {variant.barcode ? <p className="font-mono text-[11px] text-slate-500">{variant.barcode}</p> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-slate-600">{optionLabel(variant)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {variant.pricePaisa != null && variant.pricePaisa > 0 ? (
                    <span className="inline-flex items-center justify-end gap-1">
                      {formatPaisa(variant.pricePaisa)}
                      {variant.priceOverridePaisa != null ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Override</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Default</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {variant.isPreorderEnabled === null ? (
                    <span className="text-xs text-slate-400">Product ({productPreorder ? "On" : "Off"})</span>
                  ) : variant.isPreorderEnabled ? (
                    <Badge variant="warning">Preorder</Badge>
                  ) : (
                    <span className="text-xs text-slate-400">Off</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {variant.weightGrams != null ? `${variant.weightGrams} g` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {confirmDelete ? (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
          <DialogContent
            title={selected.size === 1 ? "Delete this variant?" : `Delete ${selected.size} variants?`}
            description="They are archived, not erased, so order history stays intact. Variants with stock on hand cannot be deleted."
            className="max-w-md"
          >
            {error ? <p className="mb-3 rounded bg-rose-50 p-2 text-sm text-rose-600">{error}</p> : null}
            <p className="text-sm text-slate-600">
              Remove the selected variant{selected.size === 1 ? "" : "s"} from {productName}?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" disabled={loading} onClick={() => void removeSelected()}>
                {loading ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
