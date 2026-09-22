"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Edit3, Layers, Check } from "lucide-react";
import { formatPaisa } from "@/lib/money";
import type { ProductListRow, ProductListVariantRow } from "@/modules/catalog/queries";
import { updateSingleVariantAction } from "@/modules/catalog/product-actions";
import {
  Badge,
  Button,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";
import { Dialog, DialogContent } from "@/components/ui/interactive";

const STATUS_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  ARCHIVED: "neutral",
};

export function ProductListTable({
  products,
  canEdit,
  canViewCost,
}: {
  products: ProductListRow[];
  canEdit: boolean;
  canViewCost: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [editingVariant, setEditingVariant] = React.useState<{
    product: ProductListRow;
    variant: ProductListVariantRow;
  } | null>(null);

  // Variant editing state
  const [priceTaka, setPriceTaka] = React.useState("");
  const [clearPrice, setClearPrice] = React.useState(false);
  const [compareAtTaka, setCompareAtTaka] = React.useState("");
  const [costTaka, setCostTaka] = React.useState("");
  const [clearCost, setClearCost] = React.useState(false);
  const [weightGrams, setWeightGrams] = React.useState("");
  const [clearWeight, setClearWeight] = React.useState(false);
  const [preorderSetting, setPreorderSetting] = React.useState<"INHERIT" | "ENABLED" | "DISABLED">("INHERIT");
  const [packagingTaka, setPackagingTaka] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openVariantEditor = (product: ProductListRow, variant: ProductListVariantRow) => {
    setEditingVariant({ product, variant });
    setPriceTaka(variant.priceOverridePaisa != null ? (variant.priceOverridePaisa / 100).toFixed(2) : (variant.pricePaisa / 100).toFixed(2));
    setClearPrice(variant.priceOverridePaisa == null);
    setCompareAtTaka(variant.compareAtPricePaisa != null ? (variant.compareAtPricePaisa / 100).toFixed(2) : "");
    setCostTaka(variant.costPaisa != null ? (variant.costPaisa / 100).toFixed(2) : "");
    setClearCost(variant.costPaisa == null);
    setWeightGrams(variant.weightGrams != null ? String(variant.weightGrams) : "");
    setClearWeight(variant.weightGrams == null);
    setPreorderSetting(
      variant.isPreorderEnabled === null
        ? "INHERIT"
        : variant.isPreorderEnabled
          ? "ENABLED"
          : "DISABLED",
    );
    setPackagingTaka(variant.packagingCostPaisa != null ? (variant.packagingCostPaisa / 100).toFixed(2) : "");
    setError(null);
    setSuccessMessage(null);
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVariant) return;
    setError(null);
    setSaving(true);

    const payload: Parameters<typeof updateSingleVariantAction>[0] = {
      variantId: editingVariant.variant.id,
      clearPriceOverride: clearPrice,
      ...(!clearPrice && priceTaka.trim()
        ? {
            priceOverridePaisa: Math.round(parseFloat(priceTaka) * 100),
            compareAtPricePaisa: compareAtTaka.trim() ? Math.round(parseFloat(compareAtTaka) * 100) : null,
          }
        : {}),
      clearCostOverride: clearCost,
      ...(!clearCost && costTaka.trim() ? { costPaisa: Math.round(parseFloat(costTaka) * 100) } : {}),
      clearWeightOverride: clearWeight,
      ...(!clearWeight && weightGrams.trim() ? { weightGrams: parseInt(weightGrams, 10) } : {}),
      clearPreorderOverride: preorderSetting === "INHERIT",
      ...(preorderSetting !== "INHERIT" ? { isPreorderEnabled: preorderSetting === "ENABLED" } : {}),
      ...(packagingTaka.trim() ? { packagingCostPaisa: Math.round(parseFloat(packagingTaka) * 100) } : {}),
    };

    const res = await updateSingleVariantAction(payload);
    setSaving(false);

    if (res.ok) {
      setSuccessMessage("Variant updated successfully");
      setTimeout(() => {
        setEditingVariant(null);
        router.refresh();
      }, 700);
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
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

            return (
              <React.Fragment key={product.id}>
                <TableRow className={isExpanded ? "bg-slate-50/70 border-b-0" : undefined}>
                  <TableCell className="w-10 pr-0">
                    {product.variants.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(product.id)}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
                        aria-label={isExpanded ? "Collapse variants" : "Expand variants"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/catalog/products/${product.id}`}
                        className="font-medium text-brand-600 hover:underline flex items-center gap-1.5"
                      >
                        {product.name}
                      </Link>
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
                      <span>·</span>
                      <span className="text-slate-400 font-mono text-[11px]">{product.slug}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[product.status] ?? "neutral"}>
                      {product.status.toLowerCase()}
                    </Badge>
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
                    <div className="flex items-center justify-end gap-2">
                      {canEdit ? (
                        <Link
                          href={`/admin/catalog/products/${product.id}/edit`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-md transition-colors"
                        >
                          <Edit3 className="h-3.5 w-3.5" /> Edit
                        </Link>
                      ) : (
                        <Link
                          href={`/admin/catalog/products/${product.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 px-2.5 py-1.5 rounded-md"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>

                {/* Collapsible Nested Variant Rows */}
                {isExpanded && (
                  <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                    <TableCell colSpan={6} className="p-0 border-t border-slate-200/80">
                      <div className="py-3 px-6 bg-slate-50/60 border-l-4 border-l-brand-500">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-brand-600" />
                            Variants of {product.name} ({product.variants.length})
                          </span>
                          <span className="text-xs text-slate-500">
                            Parent SKU: <code className="font-mono text-slate-700">{product.sku ?? "None"}</code>
                          </span>
                        </div>

                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase font-medium border-b border-slate-200">
                              <tr>
                                <th className="px-3 py-2 text-left">Variant</th>
                                <th className="px-3 py-2 text-right">Price</th>
                                {canViewCost && <th className="px-3 py-2 text-right">Cost</th>}
                                <th className="px-3 py-2 text-center">Preorder</th>
                                <th className="px-3 py-2 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {product.variants.map((variant) => {
                                const hasPriceOverride = variant.priceOverridePaisa != null;
                                return (
                                  <tr key={variant.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-3 py-2 font-medium text-slate-900">
                                      {variant.name || "Default"}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium">
                                      <div className="inline-flex items-center gap-1 justify-end">
                                        <span>{formatPaisa(variant.pricePaisa)}</span>
                                        {hasPriceOverride ? (
                                          <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded font-medium" title="Manual variant price override">
                                            Override
                                          </span>
                                        ) : (
                                          <span className="bg-slate-100 text-slate-600 text-[10px] px-1.5 py-0.2 rounded" title="Inherited price">
                                            Inherited
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    {canViewCost && (
                                      <td className="px-3 py-2 text-right text-slate-600">
                                        {variant.costPaisa != null ? formatPaisa(variant.costPaisa) : "—"}
                                      </td>
                                    )}
                                    <td className="px-3 py-2 text-center">
                                      {variant.isPreorderEnabled === null ? (
                                        <span className="text-slate-400 text-[11px]">
                                          Inherited ({product.isPreorderEnabled ? "On" : "Off"})
                                        </span>
                                      ) : variant.isPreorderEnabled ? (
                                        <Badge variant="warning">Preorder</Badge>
                                      ) : (
                                        <span className="text-slate-400 text-[11px]">Disabled</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {canEdit && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50"
                                          onClick={() => openVariantEditor(product, variant)}
                                        >
                                          <Edit3 className="mr-1 h-3 w-3" /> Edit Variant
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>

      {/* Modal Dedicated Variant Editor Dialog */}
      {editingVariant && (
        <Dialog open={Boolean(editingVariant)} onOpenChange={(o) => { if (!o) setEditingVariant(null); }}>
          <DialogContent title="Edit Variant Overrides" className="max-w-lg">
            <form onSubmit={handleSaveVariant} className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mt-0.5">
                  {editingVariant.variant.name || "Default Variant"}
                </h3>
                <p className="text-xs text-slate-500">
                  Product: <span className="font-medium text-slate-700">{editingVariant.product.name}</span>
                  {editingVariant.product.sku && <span> · Product SKU: {editingVariant.product.sku}</span>}
                </p>
              </div>

              {error && <p className="text-sm text-rose-600 bg-rose-50 p-2.5 rounded-md">{error}</p>}
              {successMessage && (
                <p className="text-sm text-emerald-700 bg-emerald-50 p-2.5 rounded-md flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> {successMessage}
                </p>
              )}

              {/* Pricing Override */}
              <div className="rounded-lg border border-slate-200 p-3.5 space-y-3 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                    Pricing & Inheritance
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600"
                      checked={clearPrice}
                      onChange={(e) => setClearPrice(e.target.checked)}
                    />
                    <span>Inherit default price</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Sell Price (৳)" htmlFor="var-price">
                    <Input
                      id="var-price"
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={clearPrice}
                      placeholder={clearPrice ? `Inherited (${formatPaisa(editingVariant.product.defaultPricePaisa ?? 0)})` : "e.g. 850.00"}
                      value={clearPrice ? "" : priceTaka}
                      onChange={(e) => setPriceTaka(e.target.value)}
                    />
                  </FormField>
                  <FormField label="Compare-at Price (৳)" htmlFor="var-compare-at">
                    <Input
                      id="var-compare-at"
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={clearPrice}
                      placeholder="Optional original price"
                      value={clearPrice ? "" : compareAtTaka}
                      onChange={(e) => setCompareAtTaka(e.target.value)}
                    />
                  </FormField>
                </div>
                {clearPrice && (
                  <p className="text-[11px] text-slate-500">
                    Restoring price inheritance uses attribute pricing if configured, otherwise falls back to the product default ({formatPaisa(editingVariant.product.defaultPricePaisa ?? 0)}).
                  </p>
                )}
              </div>

              {/* Purchase Cost & Packaging */}
              <div className="rounded-lg border border-slate-200 p-3.5 space-y-3 bg-slate-50/50">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide block">
                  Cost & Packaging
                </span>
                <div className="grid grid-cols-2 gap-3">
                  {canViewCost && (
                    <FormField label="Cost Price (৳)" htmlFor="var-cost">
                      <div className="space-y-1">
                        <Input
                          id="var-cost"
                          type="number"
                          step="0.01"
                          min="0"
                          disabled={clearCost}
                          placeholder={clearCost ? "Inherit" : "0.00"}
                          value={clearCost ? "" : costTaka}
                          onChange={(e) => setCostTaka(e.target.value)}
                        />
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer mt-1">
                          <input
                            type="checkbox"
                            className="h-3 w-3 rounded border-slate-300"
                            checked={clearCost}
                            onChange={(e) => setClearCost(e.target.checked)}
                          />
                          <span>Inherit cost</span>
                        </label>
                      </div>
                    </FormField>
                  )}
                  <FormField label="Packaging Cost (৳)" htmlFor="var-pkg">
                    <Input
                      id="var-pkg"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 25.00"
                      value={packagingTaka}
                      onChange={(e) => setPackagingTaka(e.target.value)}
                    />
                  </FormField>
                </div>
              </div>

              {/* Preorder & Weight */}
              <div className="rounded-lg border border-slate-200 p-3.5 space-y-3 bg-slate-50/50">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide block">
                  Fulfillment & Preorder
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">
                      Preorder Status
                    </label>
                    <select
                      className="w-full text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none"
                      value={preorderSetting}
                      onChange={(e) => setPreorderSetting(e.target.value as any)}
                    >
                      <option value="INHERIT">Inherit from product</option>
                      <option value="ENABLED">Enable Preorder</option>
                      <option value="DISABLED">Disable Preorder</option>
                    </select>
                  </div>
                  <FormField label="Weight (Grams)" htmlFor="var-weight">
                    <div className="space-y-1">
                      <Input
                        id="var-weight"
                        type="number"
                        min="0"
                        disabled={clearWeight}
                        placeholder={clearWeight ? "Inherit" : "Grams"}
                        value={clearWeight ? "" : weightGrams}
                        onChange={(e) => setWeightGrams(e.target.value)}
                      />
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer mt-1">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-slate-300"
                          checked={clearWeight}
                          onChange={(e) => setClearWeight(e.target.checked)}
                        />
                        <span>Inherit weight</span>
                      </label>
                    </div>
                  </FormField>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingVariant(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save Variant Overrides"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
