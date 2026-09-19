"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import { TrackInitiateCheckout } from "@/components/storefront/marketing-events";
import { placeStorefrontOrderAction } from "@/modules/orders/storefront-actions";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export interface CheckoutVariantOption {
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  pricePaisa: number;
  available: number;
  isPreorderEnabled: boolean;
  attributes: Array<{ name: string; value: string }>;
}

export interface DeliveryZoneOption {
  districtCode: string;
  feePaisa: number;
  freeDeliveryThresholdPaisa: number | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
}

function taka(paisa: number): string {
  return `৳${(paisa / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Storefront checkout.
 *
 * The cart lives in this component only — there is no cart table, so nothing is
 * reserved until the customer submits. The totals shown here are a preview: the
 * order service recalculates prices, delivery and totals on the server.
 */
export function CheckoutForm({
  storefront,
  variants,
  districts,
  zones,
  initialCart = [],
}: {
  storefront: { id: string; slug: string; name: string; codEnabled: boolean; freeDeliveryThresholdPaisa: number | null };
  variants: CheckoutVariantOption[];
  districts: Array<{ code: string; name: string }>;
  zones: DeliveryZoneOption[];
  /** Items handed over from the storefront cart (already validated server-side). */
  initialCart?: Array<{ variantId: string; quantity: number }>;
}) {
  const [state, formAction] = useActionState(placeStorefrontOrderAction, initialActionState);
  const [cart, setCart] = useState<Array<{ variantId: string; quantity: number }>>(() =>
    initialCart.filter((row) => variants.some((variant) => variant.variantId === row.variantId)),
  );
  const [districtCode, setDistrictCode] = useState("");
  const [idempotencyKey] = useState(() => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  const byId = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);
  const zone = zones.find((candidate) => candidate.districtCode === districtCode);

  const subtotalPaisa = cart.reduce((total, row) => total + (byId.get(row.variantId)?.pricePaisa ?? 0) * row.quantity, 0);
  const deliveryFeePaisa =
    zone == null
      ? 0
      : zone.freeDeliveryThresholdPaisa != null && subtotalPaisa >= zone.freeDeliveryThresholdPaisa
        ? 0
        : zone.feePaisa;
  const totalPaisa = subtotalPaisa + deliveryFeePaisa;

  const addToCart = (variantId: string) => {
    const variant = byId.get(variantId);
    if (!variant) return;
    setCart((rows) => {
      const existing = rows.find((row) => row.variantId === variantId);
      const max = Math.max(variant.available, variant.isPreorderEnabled ? 20 : 0);
      if (existing) {
        return rows.map((row) => (row.variantId === variantId ? { ...row, quantity: Math.min(max, row.quantity + 1) } : row));
      }
      return [...rows, { variantId, quantity: Math.min(max, 1) }];
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>{storefront.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {variants.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing is published for sale in this storefront yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {variants.map((variant) => (
                  <li key={variant.variantId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {variant.productName} · {variant.variantName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {variant.sku}
                        {variant.attributes.length > 0 ? ` · ${variant.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(", ")}` : ""}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span className="font-medium text-slate-900">{taka(variant.pricePaisa)}</span>
                        {variant.available > 0 ? (
                          <Badge variant="success">{variant.available} in stock</Badge>
                        ) : variant.isPreorderEnabled ? (
                          <Badge variant="warning">preorder</Badge>
                        ) : (
                          <Badge variant="danger">out of stock</Badge>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
                      disabled={variant.available <= 0 && !variant.isPreorderEnabled}
                      onClick={() => addToCart(variant.variantId)}
                    >
                      Add to cart
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" htmlFor="checkout-name" required>
              <Input id="checkout-name" name="customerName" required minLength={2} />
            </FormField>
            <FormField label="Phone" htmlFor="checkout-phone" required hint="Used for delivery updates and to claim your account later">
              <Input id="checkout-phone" name="customerPhone" required inputMode="tel" placeholder="01712345678" />
            </FormField>
            <FormField label="Email (optional)" htmlFor="checkout-email">
              <Input id="checkout-email" name="customerEmail" type="email" />
            </FormField>
            <FormField label="District" htmlFor="checkout-district" required>
              <NativeSelect
                id="checkout-district"
                name="shippingDistrictCode"
                required
                value={districtCode}
                onChange={(event) => setDistrictCode(event.target.value)}
              >
                <option value="">Choose your district</option>
                {districts.map((district) => (
                  <option key={district.code} value={district.code}>
                    {district.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Full address" htmlFor="checkout-address" required>
                <Textarea id="checkout-address" name="shippingAddressLine" rows={3} required minLength={8} />
              </FormField>
            </div>
            <FormField label="Area / landmark (optional)" htmlFor="checkout-area">
              <Input id="checkout-area" name="shippingArea" />
            </FormField>
            <FormField label="Delivery note (optional)" htmlFor="checkout-note">
              <Input id="checkout-note" name="customerNote" />
            </FormField>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Cart</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">Your cart is empty.</p>
            ) : (
              <ul className="space-y-2">
                {cart.map((row) => {
                  const variant = byId.get(row.variantId);
                  if (!variant) return null;
                  return (
                    <li key={row.variantId} className="flex items-center justify-between gap-2 text-sm">
                      <div>
                        <div className="text-slate-900">{variant.productName}</div>
                        <div className="text-xs text-slate-500">
                          {variant.variantName} · {taka(variant.pricePaisa)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={20}
                          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs"
                          value={row.quantity}
                          onChange={(event) =>
                            setCart((rows) =>
                              rows.map((candidate) =>
                                candidate.variantId === row.variantId
                                  ? { ...candidate, quantity: Math.max(1, Math.min(20, Number(event.target.value) || 1)) }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="text-xs text-rose-600 hover:underline"
                          onClick={() => setCart((rows) => rows.filter((candidate) => candidate.variantId !== row.variantId))}
                        >
                          remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="tabular-nums">{taka(subtotalPaisa)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Delivery</span>
                <span className="tabular-nums">{zone ? taka(deliveryFeePaisa) : "choose a district"}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span className="tabular-nums">{taka(totalPaisa)}</span>
              </div>
              <p className="pt-1 text-xs text-slate-500">
                {storefront.codEnabled ? "Cash on delivery is available." : "Cash on delivery is not available for this storefront."} The final total is
                recalculated on the server.
              </p>
            </div>
          </CardContent>
        </Card>

        <form action={formAction} className="space-y-3">
          {cart.length > 0 ? <TrackInitiateCheckout variantIds={cart.map((row) => row.variantId)} valuePaisa={totalPaisa} /> : null}
          <input type="hidden" name="storefrontId" value={storefront.id} />
          <input type="hidden" name="storefrontSlug" value={storefront.slug} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {cart.map((row) => (
            <div key={row.variantId}>
              <input type="hidden" name="itemVariantId" value={row.variantId} />
              <input type="hidden" name="itemQuantity" value={row.quantity} />
            </div>
          ))}
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" name="marketingConsent" defaultChecked={false} className="mt-0.5" />
            <span>Measure this purchase for our own advertising reports (optional). We only send a hashed customer id, never your phone number or email.</span>
          </label>
          <SubmitButton className="w-full" disabled={cart.length === 0}>
            Place order
          </SubmitButton>
          <p className="text-center text-xs text-slate-500">
            Stock is reserved when you place the order. Preorders are only accepted for products marked as preorder.
          </p>
        </form>
      </div>
    </div>
  );
}
