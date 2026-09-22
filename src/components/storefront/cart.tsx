"use client";

import { trackMarketingEvent } from "@/lib/marketing-client";

import * as React from "react";
import dynamic from "next/dynamic";

/**
 * Storefront cart.
 *
 * The cart is a browser concern: it lives in `localStorage` and nothing is reserved
 * until the customer submits checkout, where the order service re-resolves every price,
 * quantity and availability server-side. Adding an item therefore stores only a variant
 * id and a quantity.
 */

export interface CartLine {
  variantId: string;
  quantity: number;
  name?: string;
  pricePaisa?: number;
  slug?: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  subtotalPaisa: number;
  add: (line: CartLine) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  ready: boolean;
}

const CartContext = React.createContext<CartContextValue | null>(null);
const STORAGE_KEY = "estore.cart.v1";

function readStorage(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((line): line is CartLine => typeof line === "object" && line !== null && typeof (line as CartLine).variantId === "string")
      .map((line) => ({ ...line, quantity: Math.max(1, Math.min(50, Number(line.quantity) || 1)) }));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Cart store                                                                  */
/* -------------------------------------------------------------------------- */
/*
 * localStorage is an external system, so the cart is a module-level store read through
 * useSyncExternalStore. That keeps the first client render honest (no empty-cart flash
 * after an effect), picks up changes made in another tab, and makes the mutations
 * available outside React as well.
 */

const EMPTY_LINES: CartLine[] = [];

let cachedLines: CartLine[] | null = null;
const subscribers = new Set<() => void>();

function getSnapshot(): CartLine[] {
  if (typeof window === "undefined") return EMPTY_LINES;
  if (cachedLines === null) cachedLines = readStorage();
  return cachedLines;
}

function getServerSnapshot(): CartLine[] {
  return EMPTY_LINES;
}

function getHydratedSnapshot(): boolean {
  return typeof window !== "undefined";
}

function getServerHydratedSnapshot(): boolean {
  return false;
}

function emit() {
  for (const listener of subscribers) listener();
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cachedLines = readStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writeLines(next: CartLine[]) {
  cachedLines = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode or a full quota: the cart simply does not persist.
    }
  }
  emit();
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const lines = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = React.useSyncExternalStore(subscribe, getHydratedSnapshot, getServerHydratedSnapshot);

  const value = React.useMemo<CartContextValue>(() => {
    const count = lines.reduce((total, line) => total + line.quantity, 0);
    const subtotalPaisa = lines.reduce((total, line) => total + (line.pricePaisa ?? 0) * line.quantity, 0);
    return {
      lines,
      count,
      subtotalPaisa,
      ready,
      add: (line) => {
        const current = getSnapshot();
        const existing = current.find((candidate) => candidate.variantId === line.variantId);
        writeLines(
          existing
            ? current.map((candidate) =>
                candidate.variantId === line.variantId ? { ...candidate, ...line, quantity: Math.min(50, candidate.quantity + line.quantity) } : candidate,
              )
            : [...current, { ...line, quantity: Math.max(1, Math.min(50, line.quantity)) }],
        );
      },
      setQuantity: (variantId, quantity) =>
        writeLines(getSnapshot().map((candidate) => (candidate.variantId === variantId ? { ...candidate, quantity: Math.max(1, Math.min(50, quantity)) } : candidate))),
      remove: (variantId) => writeLines(getSnapshot().filter((candidate) => candidate.variantId !== variantId)),
      clear: () => writeLines([]),
    };
  }, [lines, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = React.useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}

/** Add-to-cart button used on product cards and the product detail page. */
export function AddToCartButton({
  line,
  label = "Add to cart",
  className,
  showQuantity = false,
  disabled = false,
  quantity: controlledQuantity,
}: {
  line: CartLine;
  label?: string;
  className?: string;
  showQuantity?: boolean;
  disabled?: boolean;
  /** Quantity chosen outside the button, for example by a variant picker. */
  quantity?: number;
}) {
  const cart = useCart();
  const [quantity, setQuantity] = React.useState(line.quantity ?? 1);
  const [added, setAdded] = React.useState(false);
  const effectiveQuantity = controlledQuantity ?? quantity;

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      {showQuantity ? (
        <div className="flex items-center rounded-md border">
          <button type="button" className="px-2 py-1 text-sm" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">
            −
          </button>
          <input
            type="number"
            min={1}
            max={50}
            value={effectiveQuantity}
            onChange={(event) => setQuantity(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
            className="w-12 border-x px-1 py-1 text-center text-sm"
            aria-label="Quantity"
          />
          <button type="button" className="px-2 py-1 text-sm" onClick={() => setQuantity((value) => Math.min(50, value + 1))} aria-label="Increase quantity">
            +
          </button>
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          cart.add({ ...line, quantity: effectiveQuantity });
          // Pixel-side add-to-cart; a no-op when no pixel is configured or consent is off.
          trackMarketingEvent("AddToCart", { contentIds: [line.variantId], valuePaisa: (line.pricePaisa ?? 0) * effectiveQuantity });
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
        }}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {added ? "Added ✓" : label}
      </button>
    </div>
  );
}

/** Header cart indicator. */
export function CartLink({ href = "/cart" }: { href?: string }) {
  const cart = useCart();
  return (
    <a href={href} className="relative inline-flex items-center gap-1 text-sm font-medium">
      Cart
      {cart.ready && cart.count > 0 ? (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[11px] font-semibold text-white">
          {cart.count}
        </span>
      ) : null}
    </a>
  );
}

/** The cart page body (client) — reads the shared cart and hands it to checkout. */
export function CartView({ currency = "৳" }: { currency?: string }) {
  const cart = useCart();
  const items = cart.lines.map((line) => `${line.variantId}:${line.quantity}`).join(",");
  const checkoutHref = `/checkout${items ? `?items=${encodeURIComponent(items)}` : ""}`;

  if (!cart.ready) return <p className="text-sm text-slate-500">Loading your cart…</p>;
  if (cart.lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-slate-600">Your cart is empty.</p>
        <a href="/products" className="mt-3 inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Browse products
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <ul className="space-y-3 lg:col-span-2">
        {cart.lines.map((line) => (
          <li key={line.variantId} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3">
            <div>
              <p className="text-sm font-medium">{line.name ?? line.variantId.slice(0, 8)}</p>
              <p className="text-xs text-slate-500">
                {line.pricePaisa !== undefined ? `${currency}${(line.pricePaisa / 100).toFixed(2)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={line.quantity}
                onChange={(event) => cart.setQuantity(line.variantId, Number(event.target.value) || 1)}
                className="w-16 rounded border px-2 py-1 text-sm"
                aria-label={`Quantity of ${line.name ?? "item"}`}
              />
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => cart.remove(line.variantId)}>
                remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-3 rounded-lg border bg-white p-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Subtotal</span>
          <span className="font-medium tabular-nums">
            {currency}
            {(cart.subtotalPaisa / 100).toFixed(2)}
          </span>
        </div>
        <p className="text-xs text-slate-500">Delivery and any COD charge are calculated at checkout for your district.</p>
        <a href={checkoutHref} className="block rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700">
          Continue to checkout
        </a>
        <button type="button" className="w-full text-center text-xs text-slate-500 hover:underline" onClick={() => cart.clear()}>
          Clear cart
        </button>
      </div>
    </div>
  );
}

/**
 * Wrapper so the storefront layout (a server component) can provide the cart context
 * without turning the whole tree into a client component.
 */
export function CartProviderBoundary({ children }: { children: React.ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

export const DynamicCartView = dynamic(() => Promise.resolve(CartView), { ssr: false });
