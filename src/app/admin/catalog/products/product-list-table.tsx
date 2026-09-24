"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Edit3, ImageIcon, Layers, Pencil, Trash2 } from "lucide-react";
import { formatPaisa } from "@/lib/money";
import type { CatalogImageThumb, ProductListRow } from "@/modules/catalog/queries";
import { discardProductDraftAction, moveProductsToBinAction, setProductPublicationAction } from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";
import { PersistedVariantDialog, type PersistedVariantSnapshot } from "@/components/forms/product-editor/persisted-variant-dialog";

const STATUS_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  ARCHIVED: "neutral",
};

function ProductThumb({ image, label }: { image: CatalogImageThumb | null; label: string }) {
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
      {image?.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- media is served from storage/CDN hosts
        <img src={image.url} alt={image.alt || label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-300">
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/**
 * Product list. Edit always opens the product editor (`/:id/edit`); there is no
 * intermediate variant page. Inventory is a separate module, so this table does
 * not show on-hand or available quantities. Purchase cost is not shown here.
 */
export function ProductListTable({
  products,
  canEdit,
  canCreate = false,
  canDelete,
}: {
  products: ProductListRow[];
  canEdit: boolean;
  canCreate?: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState<string[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [publishingId, setPublishingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editingVariant, setEditingVariant] = React.useState<{ productId: string; variant: PersistedVariantSnapshot } | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectableIds = products.filter((product) => !product.isWorkingDraft).map((product) => product.id);
  const allIds = selectableIds;
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const moveToBin = async (ids: string[]) => {
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    const result = await moveProductsToBinAction(ids);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirmDelete(null);
    setSelected(new Set());
    router.refresh();
  };

  const discardDraft = async (draftId: string) => {
    setLoading(true);
    setError(null);
    const result = await discardProductDraftAction({ draftId });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirmDelete(null);
    router.refresh();
  };

  const publish = async (id: string, published: boolean) => {
    setPublishingId(id);
    setError(null);
    const result = await setProductPublicationAction(id, published);
    setPublishingId(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  };

  const colSpan = 7;
  const editingProduct = products.find((row) => row.id === editingVariant?.productId);

  return (
    <div className="space-y-4">
      {error ? <p className="px-4 text-sm text-rose-600">{error}</p> : null}

      {canDelete && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
          <p className="text-sm text-slate-700">
            <span className="font-medium">{selected.size}</span> selected
          </p>
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete([...selected])}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Move to bin
          </Button>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              {canDelete ? (
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all products on this page"
                />
              ) : null}
            </TableHead>
            <TableHead className="w-10"></TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-center">Variants</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const isExpanded = expanded.has(product.id);
            const hasMultipleVariants = product.variants.length > 1;
            const isSelected = selected.has(product.id);
            const href = product.isWorkingDraft ? "/admin/catalog/products/new" : `/admin/catalog/products/${product.id}`;
            const editHref = product.isWorkingDraft ? "/admin/catalog/products/new" : `/admin/catalog/products/${product.id}/edit`;

            return (
              <React.Fragment key={product.id}>
                <TableRow className={isExpanded ? "bg-slate-50/70 border-b-0" : undefined}>
                  <TableCell className="w-10 pr-0">
                    {canDelete && !product.isWorkingDraft ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={isSelected}
                        onChange={() => toggleOne(product.id)}
                        aria-label={`Select ${product.name}`}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="w-10 pr-0">
                    {product.variants.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(product.id)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
                        aria-label={isExpanded ? "Collapse variants" : "Expand variants"}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ProductThumb image={product.image} label={product.name} />
                      <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={href}
                        className="font-medium text-brand-600 hover:underline flex items-center gap-1.5"
                      >
                        {product.name}
                      </Link>
                      {product.isWorkingDraft ? <Badge variant="warning">working draft</Badge> : null}
                      {product.hasUnsavedDraft ? <Badge variant="warning">unsaved draft</Badge> : null}
                      {product.isFeatured ? <Badge variant="violet">featured</Badge> : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                      {product.brand && <span className="font-medium text-slate-700">{product.brand}</span>}
                      {product.brand && <span>·</span>}
                      {product.sku && (
                        <span className="font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                          SKU: {product.sku}
                        </span>
                      )}
                      {product.slug ? (
                        <>
                          <span>·</span>
                          <span className="text-slate-400 font-mono text-[11px]">{product.slug}</span>
                        </>
                      ) : null}
                    </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[product.status] ?? "neutral"}>{product.status.toLowerCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => toggleExpand(product.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-brand-600 bg-slate-100 px-2 py-1 rounded-md"
                    >
                      <Layers className="h-3 w-3 text-slate-400" />
                      {product.variantCount} {product.variantCount === 1 ? "variant" : "variants"}
                    </button>
                  </TableCell>
                  <TableCell className="text-right font-medium text-slate-800">
                    {product.priceFromPaisa != null ? (
                      <span>
                        {hasMultipleVariants ? "From " : ""}
                        {formatPaisa(product.priceFromPaisa)}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">Unpriced</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && !product.isWorkingDraft ? (
                        product.status === "ACTIVE" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={publishingId === product.id}
                            onClick={() => void publish(product.id, false)}
                          >
                            Unpublish
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={publishingId === product.id}
                            onClick={() => void publish(product.id, true)}
                          >
                            {publishingId === product.id ? "Publishing…" : "Publish"}
                          </Button>
                        )
                      ) : null}
                      {(product.isWorkingDraft ? canEdit || canCreate : canEdit) ? (
                        <Link
                          href={editHref}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-md transition-colors"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> {product.isWorkingDraft ? "Continue" : "Edit"}
                        </Link>
                      ) : (
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 px-2.5 py-1.5 rounded-md"
                        >
                          View
                        </Link>
                      )}
                      {(product.isWorkingDraft ? canDelete || canCreate : canDelete) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => setConfirmDelete([product.id])}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>

                {isExpanded && (
                  <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                    <TableCell colSpan={colSpan} className="p-0 border-t border-slate-200/80">
                      <div className="py-3 px-6 bg-slate-50/60 border-l-4 border-l-brand-500">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-brand-600" />
                            Variants of {product.name} ({product.variants.length})
                          </span>
                          <span className="text-xs text-slate-500">
                            Product SKU: <code className="font-mono text-slate-700">{product.sku ?? "None"}</code>
                          </span>
                        </div>

                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase font-medium border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-2 text-left">Variant</th>
                                <th className="px-3 py-2 text-right">Price</th>
                                {canEdit && !product.isWorkingDraft ? <th className="px-3 py-2 text-right">Actions</th> : null}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {product.variants.map((variant) => {
                                const hasPriceOverride = variant.priceOverridePaisa != null;
                                return (
                                  <tr key={variant.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-3 py-2 font-medium text-slate-900">
                                      <div className="flex items-center gap-2">
                                        <ProductThumb image={variant.image} label={variant.name || "Default"} />
                                        <span>{variant.name || "Default"}</span>
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium">
                                      <div className="inline-flex items-center gap-1 justify-end">
                                        <span>{formatPaisa(variant.pricePaisa)}</span>
                                        {hasPriceOverride ? (
                                          <span
                                            className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded font-medium"
                                            title="Manual variant price override"
                                          >
                                            Override
                                          </span>
                                        ) : (
                                          <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.2 rounded" title="Uses the product or attribute price">
                                            Inherited
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    {canEdit && !product.isWorkingDraft ? (
                                      <td className="px-3 py-2 text-right">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setEditingVariant({
                                              productId: product.id,
                                              variant: {
                                                id: variant.id,
                                                name: variant.name || "Default",
                                                imageUrl: variant.image?.url ?? null,
                                                imageMediaId: variant.imageMediaId,
                                                currentPricePaisa: variant.currentPricePaisa,
                                                discountType: variant.discountType,
                                                discountValue: variant.discountValue,
                                                priceOverridePaisa: variant.priceOverridePaisa,
                                                weightGrams: variant.weightGrams,
                                              },
                                            });
                                          }}
                                        >
                                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                          Edit
                                        </Button>
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {product.isPreorderEnabled ? (
                          <p className="mt-2 text-[11px] text-slate-500">Preorder is on for this product — any variant can be pre-ordered.</p>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>

      {confirmDelete ? (
        <Dialog open onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
          <DialogContent
            title={
              confirmDelete.length === 1 && products.find((product) => product.id === confirmDelete[0])?.isWorkingDraft
                ? "Discard this working draft?"
                : confirmDelete.length === 1
                  ? "Move this product to the bin?"
                  : `Move ${confirmDelete.length} products to the bin?`
            }
            description={
              confirmDelete.length === 1 && products.find((product) => product.id === confirmDelete[0])?.isWorkingDraft
                ? "The unsaved product work will be removed. This cannot be undone."
                : "They leave the catalogue and can be restored from the bin. Permanent deletion happens only from the bin."
            }
            className="max-w-md"
          >
            {error ? <p className="mb-3 text-sm text-rose-600 bg-rose-50 p-2 rounded">{error}</p> : null}
            <p className="text-sm text-slate-600">
              {confirmDelete.length === 1
                ? products.find((product) => product.id === confirmDelete[0])?.isWorkingDraft
                  ? `Discard “${products.find((product) => product.id === confirmDelete[0])?.name ?? "this draft"}”?`
                  : `Move “${products.find((product) => product.id === confirmDelete[0])?.name ?? "this product"}” to the bin?`
                : `${confirmDelete.length} products will be moved to the bin.`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={loading}
                onClick={() => {
                  const draft = confirmDelete.length === 1 ? products.find((product) => product.id === confirmDelete[0]) : null;
                  if (draft?.isWorkingDraft) void discardDraft(draft.id);
                  else void moveToBin(confirmDelete);
                }}
              >
                {loading
                  ? "Working…"
                  : confirmDelete.length === 1 && products.find((product) => product.id === confirmDelete[0])?.isWorkingDraft
                    ? "Discard draft"
                    : "Move to bin"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <PersistedVariantDialog
        open={Boolean(editingVariant)}
        variant={editingVariant?.variant ?? null}
        product={{
          currentPricePaisa: editingProduct?.defaultCurrentPricePaisa ?? null,
          discountType: editingProduct?.defaultDiscountType ?? "NONE",
          discountValue: editingProduct?.defaultDiscountValue ?? 0,
          weightGrams: editingProduct?.weightGrams ?? null,
        }}
        onClose={() => setEditingVariant(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
