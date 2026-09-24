"use client";

import * as React from "react";
import { Check, Loader2, PackageSearch, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { formatPaisa } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { searchOrderProductsAction } from "@/modules/orders/manual-actions";
import type { OrderCatalogSearchProduct } from "@/modules/orders/catalog";

/**
 * Server-backed product picker for the manual order screen.
 *
 * The browser only ever sends the search text: prices, images and availability
 * come from the server for the signed-in user's own sales context, so a reseller
 * sees their negotiated price list and never the business cost. Products with no
 * stock stay selectable — the order screen turns the uncovered quantity into a
 * preorder line.
 */

export interface PickedVariant {
  productId: string;
  productName: string;
  productSku: string;
  variantId: string;
  variantName: string;
  attributes: Array<{ name: string; value: string }>;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  imageUrl: string | null;
  isPreorderEnabled: boolean;
}

export function ProductPicker({
  onAdd,
  disabled,
  autoFocus,
}: {
  onAdd: (variant: PickedVariant, quantity: number) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [products, setProducts] = React.useState<OrderCatalogSearchProduct[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  const [openProductId, setOpenProductId] = React.useState<string | null>(null);
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [addedVariantId, setAddedVariantId] = React.useState<string | null>(null);
  const requestId = React.useRef(0);

  React.useEffect(() => {
    const term = query.trim();
    // An empty search renders nothing anyway (derived below), so the effect only
    // ever runs for a real query.
    if (term.length === 0) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      // Set inside the timer callback: the spinner tracks the request in flight,
      // not the keystrokes.
      setSearching(true);
      searchOrderProductsAction(term, 8)
        .then((result) => {
          if (id !== requestId.current) return;
          if (result.ok) {
            setProducts(result.products);
            setSearched(true);
          } else {
            setProducts([]);
            setSearched(true);
            toast.error(result.message);
          }
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setProducts([]);
          setSearched(true);
          toast.error("Product search failed");
        })
        .finally(() => {
          if (id === requestId.current) setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const visibleProducts = hasQuery ? products : [];

  const quantityFor = (variantId: string) => quantities[variantId] ?? 1;
  const setQuantity = (variantId: string, value: number) =>
    setQuantities((current) => ({ ...current, [variantId]: Math.max(1, Math.min(1000, Math.trunc(value) || 1)) }));

  const add = (product: OrderCatalogSearchProduct, variant: OrderCatalogSearchProduct["variants"][number]) => {
    const quantity = quantityFor(variant.id);
    onAdd(
      {
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        variantId: variant.id,
        variantName: variant.name,
        attributes: variant.attributes,
        pricePaisa: variant.pricePaisa,
        compareAtPricePaisa: variant.compareAtPricePaisa,
        available: variant.available,
        imageUrl: variant.imageUrl,
        isPreorderEnabled: variant.isPreorderEnabled,
      },
      quantity,
    );
    setAddedVariantId(variant.id);
    setTimeout(() => setAddedVariantId((current) => (current === variant.id ? null : current)), 1200);
    setQuantity(variant.id, 1);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          type="search"
          value={query}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by product name, SKU or barcode…"
          className="pl-9"
          aria-label="Search products"
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        ) : null}
      </div>

      {!hasQuery ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          Type at least one character to search the catalogue. Prices and stock are resolved on the server for your sales
          context.
        </p>
      ) : null}

      {hasQuery && searched && visibleProducts.length === 0 && !searching ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          <PackageSearch className="mx-auto h-5 w-5" />
          <span className="mx-auto">No product matches “{query.trim()}”.</span>
        </div>
      ) : null}

      <ul className="space-y-2">
        {visibleProducts.map((product) => {
          const open = openProductId === product.id;
          const single = product.variants.length === 1 ? product.variants[0] : null;
          return (
            <li key={product.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-start gap-3 p-3">
                <ProductImage src={single?.imageUrl ?? product.variants[0]?.imageUrl ?? null} name={product.name} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {product.sku ? `SKU ${product.sku}` : "No SKU"}
                    {product.brand ? ` · ${product.brand}` : ""}
                    {product.barcode ? ` · ${product.barcode}` : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="neutral">{formatPaisa(product.cheapestPricePaisa ?? 0)}</Badge>
                    <Badge variant={product.totalAvailable > 0 ? "success" : "warning"}>
                      {product.totalAvailable > 0 ? `${product.totalAvailable} available` : "Out of stock"}
                    </Badge>
                    {product.variants.length > 1 ? <Badge variant="info">{product.variants.length} variants</Badge> : null}
                  </div>
                </div>
                {single ? (
                  <VariantAdd
                    variant={single}
                    quantity={quantityFor(single.id)}
                    onQuantity={(value) => setQuantity(single.id, value)}
                    onAdd={() => add(product, single)}
                    added={addedVariantId === single.id}
                    disabled={disabled}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenProductId(open ? null : product.id)}
                    aria-expanded={open}
                  >
                    {open ? "Hide" : "Choose"}
                  </Button>
                )}
              </div>

              {open && !single ? (
                <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                  {product.variants.map((variant) => (
                    <li key={variant.id} className="flex items-center gap-3 p-3">
                      <ProductImage src={variant.imageUrl} name={variant.name} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800">
                          {variant.attributes.map((attribute) => attribute.value).join(" / ") || variant.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatPaisa(variant.pricePaisa)} ·{" "}
                          {variant.available > 0 ? `${variant.available} available` : "Out of stock — preorder"}
                        </p>
                      </div>
                      <VariantAdd
                        variant={variant}
                        quantity={quantityFor(variant.id)}
                        onQuantity={(value) => setQuantity(variant.id, value)}
                        onAdd={() => add(product, variant)}
                        added={addedVariantId === variant.id}
                        disabled={disabled}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProductImage({ src, name, size = 44 }: { src: string | null; name: string; size?: number }) {
  if (!src) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-medium uppercase text-slate-400"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {name.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- media URLs are per-business and may point at any configured storage host.
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-lg border border-slate-200 object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function VariantAdd({
  variant,
  quantity,
  onQuantity,
  onAdd,
  added,
  disabled,
}: {
  variant: { id: string; available: number; isPreorderEnabled: boolean };
  quantity: number;
  onQuantity: (value: number) => void;
  onAdd: () => void;
  added: boolean;
  disabled?: boolean;
}) {
  const preorder = variant.available <= 0;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="flex items-center rounded-lg border border-slate-300 bg-white">
        <button
          type="button"
          className="px-2 py-1 text-slate-500 hover:text-slate-800 disabled:opacity-40"
          onClick={() => onQuantity(quantity - 1)}
          disabled={disabled || quantity <= 1}
          aria-label="Decrease quantity"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={1000}
          value={quantity}
          onChange={(event) => onQuantity(Number(event.target.value))}
          className="w-10 border-x border-slate-200 py-1 text-center text-sm tabular-nums focus:outline-none"
          aria-label="Quantity"
        />
        <button
          type="button"
          className="px-2 py-1 text-slate-500 hover:text-slate-800 disabled:opacity-40"
          onClick={() => onQuantity(quantity + 1)}
          disabled={disabled}
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      <Button type="button" size="sm" variant={preorder ? "secondary" : "default"} onClick={onAdd} disabled={disabled}>
        {added ? <Check className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
        {added ? "Added" : preorder ? "Pre-order" : "Add"}
      </Button>
    </div>
  );
}

export function StockHint({ available, requested }: { available: number; requested: number }) {
  if (requested <= available) {
    return <span className={cn("text-xs text-emerald-600")}>{available} available — covered from stock</span>;
  }
  return (
    <span className="text-xs text-amber-600">
      {available} available — {requested - available} will be recorded as a preorder
    </span>
  );
}
