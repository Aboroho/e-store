"use client";

import * as React from "react";
import { AddToCartButton, type CartLine } from "@/components/storefront/cart";
import { TrackViewContent } from "@/components/storefront/marketing-events";
import { Badge } from "@/components/ui/primitives";

/**
 * Storefront variant selection.
 *
 * The shopper picks attribute values — not a price, not a stock level, not a
 * variant id. This component only holds the *selection*; every number it shows
 * (price, compare-at, availability, preorder eligibility) came from the server
 * for the matching row, and the server re-resolves all of it again at checkout.
 *
 * A row is purchasable when it is in stock, or when preorders are allowed AND
 * the requested quantity is not covered by physical stock — exactly the rule the
 * order service enforces.
 */

export interface StorefrontVariantOption {
  id: string;
  value: string;
  colorHex: string | null;
  purchasable: boolean;
}

export interface StorefrontOptionGroup {
  id: string;
  name: string;
  values: StorefrontVariantOption[];
}

export interface StorefrontVariantView {
  id: string;
  name: string;
  pricePaisa: number;
  compareAtPricePaisa: number | null;
  available: number;
  isPreorderEnabled: boolean;
  attributeValueIds: string[];
  attributes: Array<{ name: string; value: string }>;
  imageUrl: string | null;
  imageAlt: string;
  imageSource: "variant" | "attribute" | "product" | "none";
}

function taka(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sameCombination(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export function VariantPicker({
  productName,
  productSlug,
  sku,
  options,
  variants,
  gallery,
  preorderNote,
  unitLabel,
}: {
  productName: string;
  productSlug: string;
  sku: string;
  options: StorefrontOptionGroup[];
  variants: StorefrontVariantView[];
  /** Product images in display order: primary first, then the gallery. */
  gallery: Array<{ url: string | null; alt: string }>;
  preorderNote: string | null;
  unitLabel: string;
}) {
  /*
   * Selection state: attribute id → attribute-value id. A single variant is
   * always pre-selected so the page never opens with an empty price.
   */
  const [selection, setSelection] = React.useState<Record<string, string>>(() => {
    const first = variants[0];
    const initial: Record<string, string> = {};
    if (first) {
      for (const [index, valueId] of first.attributeValueIds.entries()) {
        const group = options[index];
        if (group) initial[group.id] = valueId;
      }
    }
    return initial;
  });

  const [quantity, setQuantity] = React.useState(1);

  const chosenIds = Object.values(selection).filter(Boolean);
  const selected = variants.find((variant) => sameCombination(variant.attributeValueIds, chosenIds)) ?? null;
  const complete = selected !== null;

  /** Does any sellable row exist with this value in this group, keeping the other choices? */
  const isValueAvailable = (groupId: string, valueId: string): boolean =>
    variants.some((variant) => {
      const others = Object.entries(selection)
        .filter(([key]) => key !== groupId)
        .map(([, value]) => value);
      return variant.attributeValueIds.includes(valueId) && others.every((id) => variant.attributeValueIds.includes(id));
    });

  // Images: the selected row's effective image leads, then the product gallery.
  const heroCandidates = [
    ...(selected?.imageUrl ? [{ url: selected.imageUrl, alt: selected.imageAlt }] : []),
    ...gallery.filter((image) => image.url && image.url !== selected?.imageUrl),
  ];
  // The active image is derived, not stored: switching rows resets it without an
  // effect, so there is no second render pass and no flash of the old image.
  const [overrideImage, setOverrideImage] = React.useState<{ rowId: string; index: number } | null>(null);
  const activeIndex = overrideImage && overrideImage.rowId === selected?.id ? overrideImage.index : 0;
  const clampedIndex = Math.min(activeIndex, Math.max(0, heroCandidates.length - 1));
  const hero = heroCandidates[clampedIndex] ?? gallery[0] ?? null;

  const pricePaisa = selected?.pricePaisa ?? variants.reduce((min, row) => (row.pricePaisa < min ? row.pricePaisa : min), variants[0]?.pricePaisa ?? 0);
  const compareAt = selected?.compareAtPricePaisa ?? null;
  const available = selected?.available ?? 0;
  const inStock = available > 0;

  // Preorder applies only to the quantity stock cannot cover.
  const uncovered = Math.max(0, quantity - available);
  const allowsPreorder = Boolean(selected?.isPreorderEnabled);
  const purchasable = Boolean(selected) && (inStock || allowsPreorder);
  const isPreorderLine = !inStock || uncovered > 0;

  const label = !complete
    ? "Choose an option"
    : !purchasable
      ? "Not available"
      : isPreorderLine && allowsPreorder
        ? "Preorder"
        : "Add to cart";

  const cartLine: CartLine | null = selected
    ? {
        variantId: selected.id,
        quantity,
        name: `${productName} · ${selected.name}`,
        pricePaisa: selected.pricePaisa,
        slug: productSlug,
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="aspect-square overflow-hidden rounded-xl bg-slate-100">
          {hero?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- media lives on arbitrary storage hosts
            <img src={hero.url} alt={hero.alt} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">No image</div>
          )}
        </div>
        {heroCandidates.length > 1 ? (
          <div className="grid grid-cols-5 gap-2">
            {heroCandidates.slice(0, 10).map((image, index) => (
              <button
                key={`${image.url}-${index}`}
                type="button"
                onClick={() => setOverrideImage({ rowId: selected?.id ?? "", index })}
                aria-label={`Show image ${index + 1}`}
                className={`overflow-hidden rounded-md border ${index === clampedIndex ? "border-indigo-500" : "border-slate-200"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- media lives on arbitrary storage hosts */}
                <img src={image.url ?? ""} alt={image.alt} className="aspect-square w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        {options.map((group) => (
          <fieldset key={group.id} className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">
              {group.name}
              {selection[group.id] ? (
                <span className="ml-2 font-normal text-slate-500">
                  {group.values.find((value) => value.id === selection[group.id])?.value}
                </span>
              ) : null}
            </legend>
            <div className="flex flex-wrap gap-2">
              {group.values.map((value) => {
                const chosen = selection[group.id] === value.id;
                const reachable = isValueAvailable(group.id, value.id);
                return (
                  <button
                    key={value.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => setSelection((current) => ({ ...current, [group.id]: value.id }))}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      chosen
                        ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                        : reachable
                          ? "border-slate-300 text-slate-700 hover:bg-slate-50"
                          : "border-dashed border-slate-200 text-slate-400"
                    }`}
                  >
                    {value.colorHex ? (
                      <span className="h-4 w-4 rounded-full border border-slate-300" style={{ backgroundColor: value.colorHex }} aria-hidden="true" />
                    ) : null}
                    {value.value}
                    {!reachable ? <span className="text-xs">(unavailable)</span> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900">{taka(pricePaisa)}</span>
            {compareAt && compareAt > pricePaisa ? (
              <span className="text-sm text-slate-400 line-through">{taka(compareAt)}</span>
            ) : null}
            {sku ? <span className="ml-auto text-xs text-slate-500">SKU {sku}</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {!complete ? (
              <Badge variant="warning">Choose {options.map((group) => group.name.toLowerCase()).join(" and ")}</Badge>
            ) : inStock ? (
              <span className="text-emerald-600">{available} {unitLabel} in stock</span>
            ) : allowsPreorder ? (
              <span className="text-amber-600">
                Preorder — ships when restocked{preorderNote ? `: ${preorderNote}` : ""}
              </span>
            ) : (
              <span className="text-rose-600">Out of stock</span>
            )}
            {selected?.imageSource === "variant" ? <Badge variant="brand">Variant image</Badge> : null}
          </div>

          {selected ? (
            <p className="text-xs text-slate-500">
              {selected.attributes.length > 0
                ? selected.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(" · ")
                : selected.name}
            </p>
          ) : null}

          {complete && inStock && quantity > available && allowsPreorder ? (
            <p className="text-xs text-amber-700">
              {available} {unitLabel} ship now, {quantity - available} on preorder.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center rounded-md border">
              <button type="button" className="px-2 py-1 text-sm" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">
                −
              </button>
              <input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                className="w-14 border-x px-1 py-1 text-center text-sm"
                aria-label="Quantity"
              />
              <button type="button" className="px-2 py-1 text-sm" onClick={() => setQuantity((value) => Math.min(50, value + 1))} aria-label="Increase quantity">
                +
              </button>
            </div>

            {cartLine ? (
              <AddToCartButton line={cartLine} quantity={quantity} disabled={!purchasable} label={label} />
            ) : (
              <button
                type="button"
                disabled
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white opacity-50"
              >
                {label}
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Prices, availability and preorder eligibility are resolved on the server when you order — nothing in this browser decides what
            you pay.
          </p>
        </div>

        {selected ? <TrackViewContent variantId={selected.id} valuePaisa={selected.pricePaisa} /> : null}
      </div>
    </div>
  );
}
