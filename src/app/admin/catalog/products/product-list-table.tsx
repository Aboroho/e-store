"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Edit3, Layers } from "lucide-react";
import { formatPaisa } from "@/lib/money";
import type { ProductListRow } from "@/modules/catalog/queries";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives";

const STATUS_VARIANT: Record<string, "success" | "neutral" | "warning"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  ARCHIVED: "neutral",
};

/**
 * Product list. Edit always opens the product editor (`/:id/edit`); there is no
 * intermediate variant page. Inventory is a separate module, so this table does
 * not show on-hand or available quantities.
 */
export function ProductListTable({
  products,
  canEdit,
  canViewCost,
}: {
  products: ProductListRow[];
  canEdit: boolean;
  canViewCost: boolean;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
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
                            Product SKU: <code className="font-mono text-slate-700">{product.sku ?? "None"}</code>
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
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {product.variants.map((variant) => {
                                const hasPriceOverride = variant.priceOverridePaisa != null;
                                return (
                                  <tr key={variant.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-3 py-2 font-medium text-slate-900">{variant.name || "Default"}</td>
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
                                            Default
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
                                          Product ({product.isPreorderEnabled ? "On" : "Off"})
                                        </span>
                                      ) : variant.isPreorderEnabled ? (
                                        <Badge variant="warning">Preorder</Badge>
                                      ) : (
                                        <span className="text-slate-400 text-[11px]">Disabled</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {canEdit ? (
                          <p className="mt-2 text-[11px] text-slate-500">
                            Change variants in the{" "}
                            <Link href={`/admin/catalog/products/${product.id}/edit`} className="font-medium text-brand-600 hover:underline">
                              product editor
                            </Link>
                            .
                          </p>
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
    </div>
  );
}
