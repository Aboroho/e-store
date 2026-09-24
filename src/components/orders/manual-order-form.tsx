"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Info, Loader2, MapPin, MinusCircle, Phone, Plus, Save, ShoppingCart, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { formatPaisa } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@/components/ui/primitives";
import { Checkbox, Dialog, DialogContent, Switch } from "@/components/ui/interactive";
import { ProductPicker, StockHint, type PickedVariant } from "@/components/orders/product-picker";
import { SavedAddressDialog } from "@/components/orders/saved-address-dialog";
import {
  createManualOrderAction,
  lookupCustomerPhoneAction,
  previewManualOrderAction,
  updateManualOrderAction,
} from "@/modules/orders/manual-actions";
import type { ManualOrderDraft } from "@/modules/orders/draft";
import type { ManualOrderPreview } from "@/modules/orders/manual";
import type { SavedAddressLookupResult } from "@/modules/orders/lookup";
import { ORDER_TYPE_HINTS, ORDER_TYPE_LABELS, type OrderTypeValue } from "@/modules/orders/status";

/**
 * Manual order screen (admin counter and reseller).
 *
 * Mobile-first: one column of cards with a sticky summary bar on phones and a
 * sticky summary column on desktop.
 *
 * What the browser controls: which variant, how many, the discounts, the charges
 * and the customer details. What the server controls: every price, every total,
 * stock availability, the delivery charge, the required fields and the initial
 * status — there is deliberately no unit-price input and no status selector here.
 */

export interface CheckoutFieldView {
  key: string;
  label: string;
  helpText: string;
  isEnabled: boolean;
  isRequired: boolean;
  appliesTo: string[];
}

export interface ManualOrderFormProps {
  mode: "create" | "edit";
  districts: Array<{ code: string; name: string }>;
  storefronts: Array<{ id: string; name: string }>;
  checkoutFields: CheckoutFieldView[];
  priceListName: string | null;
  mayViewCosts: boolean;
  maxDiscountPercent: number;
  defaultStorefrontId?: string | null;
  draft?: ManualOrderDraft | null;
  /** Resellers cannot choose in-store: the counter channel belongs to staff. */
  allowInStore?: boolean;
}

interface OrderLine {
  key: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  attributes: Array<{ name: string; value: string }>;
  imageUrl: string | null;
  quantity: number;
  /** Taka text the operator typed; converted to paisa on submit. */
  discountTaka: string;
  allowPreorder: boolean;
  note: string;
  available: number;
  unitPricePaisa: number;
}

const PAYMENT_METHODS = [
  { value: "COD", label: "Cash on delivery" },
  { value: "CASH", label: "Cash (paid now)" },
  { value: "BKASH", label: "bKash" },
  { value: "SSLCOMMERZ", label: "SSLCommerz" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "MANUAL", label: "Manual / other" },
];

function takaToPaisa(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

function paisaToTaka(value: number | null | undefined): string {
  if (!value) return "";
  return (value / 100).toString();
}

let lineCounter = 0;
function nextLineKey() {
  lineCounter += 1;
  return `line-${Date.now().toString(36)}-${lineCounter}`;
}

export function ManualOrderForm({
  mode,
  districts,
  storefronts,
  checkoutFields,
  priceListName,
  mayViewCosts,
  maxDiscountPercent,
  defaultStorefrontId,
  draft,
  allowInStore = true,
}: ManualOrderFormProps) {
  const router = useRouter();
  const [orderType, setOrderType] = React.useState<OrderTypeValue>(
    (draft?.orderType as OrderTypeValue) ?? "ONLINE_DELIVERY",
  );
  const [lines, setLines] = React.useState<OrderLine[]>(
    (draft?.items ?? []).map((item) => ({
      key: item.key,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      attributes: [],
      imageUrl: null,
      quantity: item.quantity,
      discountTaka: paisaToTaka(item.itemDiscountPaisa),
      allowPreorder: item.allowPreorder,
      note: item.note,
      available: Number.MAX_SAFE_INTEGER,
      unitPricePaisa: item.unitPricePaisa,
    })),
  );
  const [customer, setCustomer] = React.useState({
    name: draft?.customer.name ?? "",
    phone: draft?.customer.phone ?? "",
    email: draft?.customer.email ?? "",
    districtCode: draft?.customer.districtCode ?? "",
    addressLine: draft?.customer.addressLine ?? "",
    area: draft?.customer.area ?? "",
  });
  const [courierNote, setCourierNote] = React.useState(draft?.courierNote ?? "");
  const [customerNote, setCustomerNote] = React.useState(draft?.customerNote ?? "");
  const [orderNote, setOrderNote] = React.useState(draft?.orderNote ?? "");
  const [paymentMethod, setPaymentMethod] = React.useState(draft?.paymentMethod ?? "COD");
  const [storefrontId, setStorefrontId] = React.useState(draft?.storefrontId ?? defaultStorefrontId ?? "");
  const [deliveryOverride, setDeliveryOverride] = React.useState({
    enabled: draft?.deliveryFeeManualPaisa != null,
    taka: paisaToTaka(draft?.deliveryFeeManualPaisa ?? null),
    note: draft?.deliveryFeeNote ?? "",
  });
  const [orderDiscount, setOrderDiscount] = React.useState<{ type: "NONE" | "FLAT" | "PERCENTAGE"; value: string }>({
    type: draft?.orderDiscountType ?? "NONE",
    value:
      draft?.orderDiscountType === "FLAT"
        ? paisaToTaka(draft.orderDiscountValue)
        : draft?.orderDiscountType === "PERCENTAGE" && draft.orderDiscountValue != null
          ? (draft.orderDiscountValue / 100).toString()
          : "",
  });
  const [extraCharges, setExtraCharges] = React.useState<Array<{ key: string; label: string; taka: string; note: string }>>(
    (draft?.extraCharges ?? []).map((charge, index) => ({
      key: `charge-${index}`,
      label: charge.label,
      taka: paisaToTaka(charge.amountPaisa),
      note: charge.note,
    })),
  );
  const [customerId, setCustomerId] = React.useState<string | null>(draft?.customerId ?? null);

  const [preview, setPreview] = React.useState<ManualOrderPreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const [postCourierAcknowledged, setPostCourierAcknowledged] = React.useState(false);
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());

  const [lookup, setLookup] = React.useState<SavedAddressLookupResult | null>(null);
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const lookedUpPhone = React.useRef<string | null>(null);

  const isInStore = orderType === "IN_STORE";
  const enabledFields = checkoutFields.filter((field) => field.isEnabled);
  const visibleFields = enabledFields.filter((field) => field.appliesTo.includes(orderType));
  const requiredKeys = React.useMemo(
    () =>
      new Set(
        lines.length > 0 && preview?.requiredFields
          ? preview.requiredFields
          : visibleFields.filter((field) => field.isRequired).map((field) => field.key),
      ),
    [preview, visibleFields, lines.length],
  );

  const payload = React.useCallback(() => {
    const discountType = orderDiscount.type === "NONE" ? undefined : orderDiscount.type;
    const discountValue =
      orderDiscount.type === "FLAT"
        ? takaToPaisa(orderDiscount.value)
        : orderDiscount.type === "PERCENTAGE"
          ? Math.round((Number.parseFloat(orderDiscount.value) || 0) * 100)
          : undefined;

    return {
      orderType,
      items: lines.map((line) => ({
        key: line.key,
        variantId: line.variantId,
        quantity: line.quantity,
        itemDiscountPaisa: takaToPaisa(line.discountTaka),
        allowPreorder: line.allowPreorder,
        note: line.note.trim() || undefined,
      })),
      customer: {
        name: customer.name.trim() || undefined,
        phone: customer.phone.trim() || undefined,
        email: customer.email.trim() || undefined,
        districtCode: customer.districtCode || undefined,
        addressLine: customer.addressLine.trim() || undefined,
        area: customer.area.trim() || undefined,
      },
      courierNote: courierNote.trim() || undefined,
      customerNote: customerNote.trim() || undefined,
      orderNote: orderNote.trim() || undefined,
      paymentMethod: isInStore ? "CASH" : paymentMethod,
      deliveryFeeManualPaisa: deliveryOverride.enabled ? takaToPaisa(deliveryOverride.taka) : null,
      deliveryFeeNote: deliveryOverride.note.trim() || undefined,
      orderDiscountType: discountType,
      orderDiscountValue: discountValue,
      extraCharges: extraCharges
        .filter((charge) => charge.label.trim().length >= 2 && takaToPaisa(charge.taka) > 0)
        .map((charge) => ({
          label: charge.label.trim(),
          amountPaisa: takaToPaisa(charge.taka),
          note: charge.note.trim() || undefined,
        })),
      storefrontId: storefrontId || undefined,
      customerId: customerId ?? undefined,
      idempotencyKey,
    };
  }, [
    orderType,
    lines,
    customer,
    courierNote,
    customerNote,
    orderNote,
    paymentMethod,
    isInStore,
    deliveryOverride,
    orderDiscount,
    extraCharges,
    storefrontId,
    customerId,
    idempotencyKey,
  ]);

  // Live, server-calculated preview. Debounced so typing does not hammer the API.
  // With no lines there is nothing to price, so the preview is derived away below
  // instead of being cleared from inside the effect.
  React.useEffect(() => {
    if (lines.length === 0) return;
    const request = payload();
    const timer = setTimeout(() => {
      // Set inside the timer callback: the spinner tracks the request in flight,
      // not the keystrokes.
      setPreviewLoading(true);
      previewManualOrderAction(mode === "edit" ? { ...request, orderId: draft?.orderId } : request)
        .then((result) => {
          if (result.ok) {
            setPreview(result.preview);
            setFieldErrors(result.preview.fieldErrors);
          } else {
            setFieldErrors(result.fieldErrors ?? {});
          }
        })
        .catch(() => undefined)
        .finally(() => setPreviewLoading(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [payload, lines.length, mode, draft?.orderId]);

  // Debounced phone lookup with the saved-address dialog.
  React.useEffect(() => {
    const digits = customer.phone.replace(/\D/g, "");
    if (digits.length < 6) {
      lookedUpPhone.current = null;
      return;
    }
    if (lookedUpPhone.current === digits) return;
    const timer = setTimeout(() => {
      lookedUpPhone.current = digits;
      setLookupBusy(true);
      lookupCustomerPhoneAction(customer.phone)
        .then((result) => {
          if (!result.ok) return;
          if (result.lookup.found) {
            setLookup(result.lookup);
            setLookupOpen(true);
            if (result.lookup.customer) setCustomerId(result.lookup.customer.id);
          } else {
            setLookup(null);
            setCustomerId(null);
            toast.info(`No address found for ${customer.phone.trim()}`);
          }
        })
        .catch(() => undefined)
        .finally(() => setLookupBusy(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [customer.phone]);

  const addLine = (variant: PickedVariant, quantity: number) => {
    setLines((current) => {
      const existing = current.find((line) => line.variantId === variant.variantId);
      if (existing) {
        toast.success(`Merged into the existing ${existing.productName} line`);
        return current.map((line) =>
          line.variantId === variant.variantId ? { ...line, quantity: line.quantity + quantity } : line,
        );
      }
      return [
        ...current,
        {
          key: nextLineKey(),
          variantId: variant.variantId,
          productName: variant.productName,
          variantName: variant.variantName,
          sku: variant.productSku,
          attributes: variant.attributes,
          imageUrl: variant.imageUrl,
          quantity,
          discountTaka: "",
          allowPreorder: variant.available <= 0,
          note: "",
          available: variant.available,
          unitPricePaisa: variant.pricePaisa,
        },
      ];
    });
  };

  const updateLine = (key: string, patch: Partial<OrderLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const removeLine = (key: string) => setLines((current) => current.filter((line) => line.key !== key));

  const applySavedAddress = (entry: {
    recipientName?: string | null;
    phone?: string | null;
    districtCode?: string | null;
    area?: string | null;
    addressLine?: string | null;
  }) => {
    setCustomer((current) => ({
      ...current,
      name: entry.recipientName?.trim() || current.name,
      phone: entry.phone?.trim() || current.phone,
      districtCode: entry.districtCode || current.districtCode,
      area: entry.area || current.area,
      addressLine: entry.addressLine?.trim() || current.addressLine,
    }));
    setLookupOpen(false);
    toast.success("Saved address applied");
  };

  const submit = async () => {
    if (lines.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    if (mode === "edit" && draft?.requiresConfirmation && !postCourierAcknowledged) {
      toast.error("Confirm the post-courier edit warning before saving");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const request = payload();
      const result =
        mode === "edit" && draft
          ? await updateManualOrderAction({
              ...request,
              orderId: draft.orderId,
              confirmPostCourierEdit: draft.requiresConfirmation ? postCourierAcknowledged : false,
            })
          : await createManualOrderAction(request);

      if (!result.ok) {
        setFormError(result.message);
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }

      if (mode === "edit" && draft) {
        const update = result as { changedFields: string[]; warnings: string[]; orderNumber: string };
        toast.success(`${update.orderNumber} updated (${update.changedFields.length} change(s))`);
        for (const warning of update.warnings) toast.warning(warning);
        router.push(`/admin/orders/${draft.orderId}`);
        router.refresh();
        return;
      }

      const created = result as { orderNumber: string; statusLabel: string; redirect: string };
      toast.success(`${created.orderNumber} created — ${created.statusLabel}`);
      setIdempotencyKey(crypto.randomUUID());
      router.push(created.redirect);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "The order could not be saved";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const effectivePreview = lines.length === 0 ? null : preview;
  const previewLine = (variantId: string) => effectivePreview?.lines.find((line) => line.variantId === variantId) ?? null;
  const totals = effectivePreview?.totals ?? null;
  const blockingErrors = Object.entries(fieldErrors).filter(([, messages]) => messages.length > 0);
  const postCourierBlocked = Boolean(mode === "edit" && draft?.requiresConfirmation && !postCourierAcknowledged);

  const summary = (
    <SummaryBody
      preview={effectivePreview}
      loading={previewLoading}
      lineCount={lines.length}
      mayViewCosts={mayViewCosts}
      mode={mode}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="space-y-4 pb-44 lg:pb-0">
        {mode === "edit" && draft?.requiresConfirmation ? (
          <Alert variant="warning" title={draft.editWarning?.title ?? "This order is past the pre-courier stage"}>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {(draft.editWarning?.points ?? []).map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 text-xs font-medium text-slate-700">
              <Checkbox
                checked={postCourierAcknowledged}
                onCheckedChange={(checked) => setPostCourierAcknowledged(checked === true)}
              />
              <span>I understand the shipment and the financial records were created from the current data.</span>
            </label>
          </Alert>
        ) : null}

        {formError ? (
          <Alert variant="danger" title="The order was not saved">
            <p className="text-xs">{formError}</p>
          </Alert>
        ) : null}

        {/* ------------------------------------------------------------ type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order type</CardTitle>
            <CardDescription>
              The type decides which details are required, how the delivery charge is calculated and which status the
              order starts in. The starting status is always assigned by the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(ORDER_TYPE_LABELS) as OrderTypeValue[])
                .filter((value) => allowInStore || value !== "IN_STORE")
                .map((value) => {
                  const active = orderType === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={mode === "edit"}
                      onClick={() => setOrderType(value)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                        active ? "border-brand-500 bg-brand-50/70 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300",
                      )}
                    >
                      <span className="flex items-center justify-between text-sm font-medium text-slate-900">
                        {ORDER_TYPE_LABELS[value]}
                        {active ? <Check className="h-4 w-4 text-brand-600" /> : null}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-500">{ORDER_TYPE_HINTS[value]}</span>
                    </button>
                  );
                })}
            </div>
            {mode === "edit" ? (
              <p className="mt-2 text-xs text-slate-500">
                The order type cannot be changed after creation — it drives the stock and financial records that were
                already written.
              </p>
            ) : null}
            {effectivePreview ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <Info className="h-3.5 w-3.5 text-slate-400" />
                This order will start as{" "}
                <strong className="font-semibold">{effectivePreview.initialStatusLabel}</strong> — there is no status
                selector on this screen.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* --------------------------------------------------------- products */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Items</CardTitle>
            <CardDescription>
              {priceListName ? `Prices come from “${priceListName}”. ` : "Prices come from the active price list. "}
              Unit prices are always resolved on the server and can never be typed in. Adding the same variant twice
              merges the quantity into one line.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProductPicker onAdd={addLine} disabled={submitting} />

            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                No items yet. Search above and add the first line.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((line) => {
                  const resolved = previewLine(line.variantId);
                  const unitPrice = resolved?.unitPricePaisa ?? line.unitPricePaisa;
                  const lineTotal = resolved
                    ? resolved.unitPricePaisa * resolved.quantity - resolved.itemDiscountPaisa
                    : unitPrice * line.quantity;
                  const shortfall = resolved ? resolved.preorderUnits : Math.max(0, line.quantity - line.available);
                  return (
                    <li key={line.key} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-sm font-medium text-slate-900">{line.productName}</p>
                          <p className="truncate text-xs text-slate-500">
                            {[line.variantName, line.sku ? `SKU ${line.sku}` : null].filter(Boolean).join(" · ")}
                          </p>
                          <p className="text-xs text-slate-600">
                            {formatPaisa(unitPrice)} each · line total{" "}
                            <strong className="font-semibold text-slate-900">{formatPaisa(Math.max(0, lineTotal))}</strong>
                          </p>
                          {line.attributes.length > 0 ? (
                            <p className="text-[11px] text-slate-400">
                              {line.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove ${line.productName}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-end">
                        <div className="space-y-1">
                          <Label htmlFor={`qty-${line.key}`}>Quantity</Label>
                          <div className="flex items-center rounded-lg border border-slate-300 bg-white">
                            <button
                              type="button"
                              className="px-2 py-1.5 text-slate-500 hover:text-slate-800 disabled:opacity-40"
                              onClick={() => updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })}
                              disabled={line.quantity <= 1}
                              aria-label="Decrease quantity"
                            >
                              <MinusCircle className="h-4 w-4" />
                            </button>
                            <input
                              id={`qty-${line.key}`}
                              type="number"
                              min={1}
                              max={1000}
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  quantity: Math.max(1, Math.min(1000, Math.trunc(Number(event.target.value)) || 1)),
                                })
                              }
                              className="w-12 border-x border-slate-200 py-1.5 text-center text-sm tabular-nums focus:outline-none"
                            />
                            <button
                              type="button"
                              className="px-2 py-1.5 text-slate-500 hover:text-slate-800"
                              onClick={() => updateLine(line.key, { quantity: Math.min(1000, line.quantity + 1) })}
                              aria-label="Increase quantity"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`discount-${line.key}`}>Item discount (৳)</Label>
                          <Input
                            id={`discount-${line.key}`}
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={line.discountTaka}
                            placeholder="0"
                            onChange={(event) => updateLine(line.key, { discountTaka: event.target.value })}
                            className="w-28"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor={`note-${line.key}`}>Line note</Label>
                          <Input
                            id={`note-${line.key}`}
                            value={line.note}
                            maxLength={200}
                            placeholder="Optional note for this line"
                            onChange={(event) => updateLine(line.key, { note: event.target.value })}
                          />
                        </div>
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {resolved && !isInStore ? (
                          <StockHint available={resolved.available} requested={line.quantity} />
                        ) : null}
                        {shortfall > 0 ? (
                          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                            <Checkbox
                              checked={line.allowPreorder}
                              onCheckedChange={(checked) => updateLine(line.key, { allowPreorder: checked === true })}
                              className="mt-0.5"
                            />
                            <span>
                              {shortfall} unit(s) are not in stock. Tick to record them as a preorder commitment —
                              stock is allocated FIFO when it arrives. Pre-order is always allowed, even at zero stock.
                            </span>
                          </label>
                        ) : null}
                        {resolved?.error ? (
                          <p className="flex items-start gap-1 text-xs text-red-600">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                            <span>{resolved.error}</span>
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* -------------------------------------------------------- customer */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-slate-400" /> Customer
            </CardTitle>
            <CardDescription>
              {isInStore
                ? "In-store sales do not need customer details, a district or an address. Fill in what the customer gives you."
                : "Type a phone number and we look up saved addresses for it. Required fields follow the checkout field configuration."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleFields.map((field) => {
                const required = requiredKeys.has(field.key);
                const error = fieldErrors[field.key];
                switch (field.key) {
                  case "phone":
                    return (
                      <FormField key={field.key} label={field.label} htmlFor="customer-phone" required={required} error={error} hint={field.helpText}>
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <Input
                            id="customer-phone"
                            value={customer.phone}
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="01XXXXXXXXX"
                            className="pl-9"
                            onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))}
                          />
                          {lookupBusy ? (
                            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                          ) : null}
                        </div>
                      </FormField>
                    );
                  case "full_name":
                    return (
                      <FormField key={field.key} label={field.label} htmlFor="customer-name" required={required} error={error} hint={field.helpText}>
                        <Input
                          id="customer-name"
                          value={customer.name}
                          maxLength={120}
                          autoComplete="name"
                          onChange={(event) => setCustomer((current) => ({ ...current, name: event.target.value }))}
                        />
                      </FormField>
                    );
                  case "district":
                    return (
                      <FormField key={field.key} label={field.label} htmlFor="customer-district" required={required} error={error} hint={field.helpText}>
                        <NativeSelect
                          id="customer-district"
                          value={customer.districtCode}
                          onChange={(event) => setCustomer((current) => ({ ...current, districtCode: event.target.value }))}
                        >
                          <option value="">Choose a district</option>
                          {districts.map((district) => (
                            <option key={district.code} value={district.code}>
                              {district.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                    );
                  case "area":
                    return (
                      <FormField key={field.key} label={field.label} htmlFor="customer-area" required={required} error={error} hint={field.helpText}>
                        <Input
                          id="customer-area"
                          value={customer.area}
                          maxLength={120}
                          onChange={(event) => setCustomer((current) => ({ ...current, area: event.target.value }))}
                        />
                      </FormField>
                    );
                  case "email":
                    return (
                      <FormField key={field.key} label={field.label} htmlFor="customer-email" required={required} error={error} hint={field.helpText}>
                        <Input
                          id="customer-email"
                          type="email"
                          value={customer.email}
                          maxLength={200}
                          autoComplete="email"
                          onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))}
                        />
                      </FormField>
                    );
                  case "address":
                    return (
                      <FormField
                        key={field.key}
                        label={field.label}
                        htmlFor="customer-address"
                        required={required}
                        error={error}
                        hint={field.helpText}
                        className="sm:col-span-2"
                      >
                        <Textarea
                          id="customer-address"
                          rows={2}
                          value={customer.addressLine}
                          maxLength={300}
                          autoComplete="street-address"
                          onChange={(event) => setCustomer((current) => ({ ...current, addressLine: event.target.value }))}
                        />
                      </FormField>
                    );
                  default:
                    return null;
                }
              })}
            </div>

            {lookup ? (
              <button
                type="button"
                onClick={() => setLookupOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" /> Show saved addresses for this phone
              </button>
            ) : null}

            {storefronts.length > 0 ? (
              <FormField label="Storefront" htmlFor="storefront" hint="Used for the delivery zone and the order's channel context.">
                <NativeSelect id="storefront" value={storefrontId} onChange={(event) => setStorefrontId(event.target.value)}>
                  <option value="">Business default</option>
                  {storefronts.map((storefront) => (
                    <option key={storefront.id} value={storefront.id}>
                      {storefront.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
          </CardContent>
        </Card>

        {/* ------------------------------------------------- charges & notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Charges, discounts and payment</CardTitle>
            <CardDescription>
              The delivery charge is calculated from the delivery zone of the chosen district. Overriding it keeps the
              calculated value and records the override with your name and a note.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">Delivery charge</p>
                  <p className="text-xs text-slate-500">
                    {preview?.delivery.zoneName ? `${preview.delivery.zoneName} zone · ` : ""}
                    calculated {formatPaisa(effectivePreview?.delivery.calculatedPaisa ?? 0)}
                    {effectivePreview?.delivery.freeDeliveryApplied ? " · free delivery applied" : ""}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <Switch
                    checked={deliveryOverride.enabled}
                    onCheckedChange={(checked) => setDeliveryOverride((current) => ({ ...current, enabled: checked }))}
                    disabled={isInStore}
                  />
                  Override
                </label>
              </div>
              {deliveryOverride.enabled && !isInStore ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <FormField label="Charged amount (৳)" htmlFor="delivery-override">
                    <Input
                      id="delivery-override"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={deliveryOverride.taka}
                      placeholder="0"
                      onChange={(event) => setDeliveryOverride((current) => ({ ...current, taka: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Why is it overridden?" htmlFor="delivery-note" hint="Stored with the adjustment and shown in the audit trail.">
                    <Input
                      id="delivery-note"
                      value={deliveryOverride.note}
                      maxLength={200}
                      placeholder="e.g. Customer agreed to pay half the charge"
                      onChange={(event) => setDeliveryOverride((current) => ({ ...current, note: event.target.value }))}
                    />
                  </FormField>
                </div>
              ) : null}
              {isInStore ? <p className="mt-2 text-xs text-slate-500">In-store orders have no delivery charge.</p> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Order discount" htmlFor="order-discount-type" hint={`Capped at ${maxDiscountPercent}% of the net item value.`}>
                <div className="flex gap-2">
                  <NativeSelect
                    id="order-discount-type"
                    value={orderDiscount.type}
                    onChange={(event) =>
                      setOrderDiscount({ type: event.target.value as "NONE" | "FLAT" | "PERCENTAGE", value: "" })
                    }
                    className="w-36"
                  >
                    <option value="NONE">No discount</option>
                    <option value="FLAT">Flat amount</option>
                    <option value="PERCENTAGE">Percentage</option>
                  </NativeSelect>
                  {orderDiscount.type === "NONE" ? null : (
                    <Input
                      type="number"
                      min={0}
                      step={orderDiscount.type === "FLAT" ? "0.01" : "0.01"}
                      inputMode="decimal"
                      value={orderDiscount.value}
                      placeholder={orderDiscount.type === "FLAT" ? "৳ amount" : "% off"}
                      onChange={(event) => setOrderDiscount((current) => ({ ...current, value: event.target.value }))}
                      aria-label="Order discount value"
                    />
                  )}
                </div>
              </FormField>

              <FormField label="Payment method" htmlFor="payment-method" hint={isInStore ? "In-store sales are recorded as paid cash." : undefined}>
                <NativeSelect
                  id="payment-method"
                  value={isInStore ? "CASH" : paymentMethod}
                  disabled={isInStore}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">Extra charges</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setExtraCharges((current) => [...current, { key: `charge-${current.length}-${Date.now()}`, label: "", taka: "", note: "" }])
                  }
                >
                  <Plus className="mr-1 h-4 w-4" /> Add charge
                </Button>
              </div>
              {extraCharges.length === 0 ? (
                <p className="text-xs text-slate-500">No extra charges. Packaging is added automatically from the product or the business default.</p>
              ) : null}
              {extraCharges.map((charge) => (
                <div key={charge.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto] sm:items-center">
                  <Input
                    value={charge.label}
                    maxLength={80}
                    placeholder="Charge label"
                    onChange={(event) =>
                      setExtraCharges((current) =>
                        current.map((entry) => (entry.key === charge.key ? { ...entry, label: event.target.value } : entry)),
                      )
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={charge.taka}
                    placeholder="৳ amount"
                    onChange={(event) =>
                      setExtraCharges((current) =>
                        current.map((entry) => (entry.key === charge.key ? { ...entry, taka: event.target.value } : entry)),
                      )
                    }
                  />
                  <Input
                    value={charge.note}
                    maxLength={200}
                    placeholder="Note (optional)"
                    onChange={(event) =>
                      setExtraCharges((current) =>
                        current.map((entry) => (entry.key === charge.key ? { ...entry, note: event.target.value } : entry)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setExtraCharges((current) => current.filter((entry) => entry.key !== charge.key))}
                    className="justify-self-end rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove charge"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
            <CardDescription>The courier note travels with the parcel; the internal note is for staff only.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <FormField label="Courier instructions" htmlFor="courier-note">
              <Textarea
                id="courier-note"
                rows={3}
                maxLength={300}
                value={courierNote}
                placeholder="e.g. Call before delivery, flat 4/5"
                onChange={(event) => setCourierNote(event.target.value)}
              />
            </FormField>
            <FormField label="Customer note" htmlFor="customer-note">
              <Textarea
                id="customer-note"
                rows={3}
                maxLength={1000}
                value={customerNote}
                placeholder="Visible to the customer"
                onChange={(event) => setCustomerNote(event.target.value)}
              />
            </FormField>
            <FormField label="Internal note" htmlFor="order-note">
              <Textarea
                id="order-note"
                rows={3}
                maxLength={1000}
                value={orderNote}
                placeholder="Staff only"
                onChange={(event) => setOrderNote(event.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        {mode === "edit" && draft && draft.lockedLineCount > 0 ? (
          <Alert variant="warning" title="Some lines cannot be edited here">
            <p className="text-xs">
              {draft.lockedLineCount} line(s) on this order no longer point at a catalogue variant, so they cannot be
              repriced. They stay untouched unless you rebuild the item list.
            </p>
          </Alert>
        ) : null}
      </div>

      {/* Desktop summary column */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary}
              <Button type="button" className="w-full" onClick={() => void submit()} disabled={submitting || lines.length === 0 || postCourierBlocked}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {mode === "edit" ? "Save changes" : "Create order"}
              </Button>
              {blockingErrors.length > 0 ? (
                <ul className="space-y-1 text-xs text-red-600">
                  {blockingErrors.map(([field, messages]) => (
                    <li key={field}>{messages[0]}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </aside>

      {/* Mobile sticky summary bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {lines.length} line(s) · {totals ? `${totals.totalUnits} unit(s)` : "—"}
            </p>
            <p className="truncate text-lg font-semibold tabular-nums text-slate-900">
              {formatPaisa(totals?.grandTotalPaisa ?? 0)}
            </p>
            <p className="truncate text-xs text-slate-500">Collect {formatPaisa(totals?.collectiblePaisa ?? 0)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowBreakdown(true)}>
              Breakdown
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} disabled={submitting || lines.length === 0 || postCourierBlocked}>
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-1 h-4 w-4" />}
              {mode === "edit" ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showBreakdown} onOpenChange={setShowBreakdown}>
        <DialogContent title="Order summary" description="Every amount below is calculated on the server." className="max-w-md">
          <div className="space-y-3">
            {summary}
            {blockingErrors.length > 0 ? (
              <ul className="space-y-1 text-xs text-red-600">
                {blockingErrors.map(([field, messages]) => (
                  <li key={field}>{messages[0]}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <SavedAddressDialog
        open={lookupOpen}
        onOpenChange={setLookupOpen}
        lookup={lookup}
        onApply={applySavedAddress}
      />
    </div>
  );
}

function SummaryBody({
  preview,
  loading,
  lineCount,
  mayViewCosts,
  mode,
}: {
  preview: ManualOrderPreview | null;
  loading: boolean;
  lineCount: number;
  mayViewCosts: boolean;
  mode: "create" | "edit";
}) {
  if (lineCount === 0) {
    return <p className="text-xs text-slate-500">Add items to see the totals. The server calculates every amount.</p>;
  }

  const totals = preview?.totals ?? null;

  return (
    <div className="space-y-2 text-sm">
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recalculating on the server…
        </p>
      ) : null}

      <SummaryRow label="Items subtotal" value={formatPaisa(totals?.itemsSubtotalPaisa ?? 0)} />
      {totals && totals.itemDiscountPaisa > 0 ? (
        <SummaryRow label="Item discounts" value={`− ${formatPaisa(totals.itemDiscountPaisa)}`} tone="success" />
      ) : null}
      {totals && totals.orderDiscountPaisa > 0 ? (
        <SummaryRow label="Order discount" value={`− ${formatPaisa(totals.orderDiscountPaisa)}`} tone="success" />
      ) : null}
      {totals && totals.orderDiscountRequestedPaisa > totals.orderDiscountPaisa ? (
        <p className="text-[11px] text-amber-700">
          The order discount was limited to {formatPaisa(totals.orderDiscountPaisa)} by the configured maximum.
        </p>
      ) : null}
      {totals && totals.packagingCostPaisa > 0 ? (
        <SummaryRow label="Packaging" value={formatPaisa(totals.packagingCostPaisa)} />
      ) : null}
      {totals && totals.extraChargePaisa > 0 ? <SummaryRow label="Extra charges" value={formatPaisa(totals.extraChargePaisa)} /> : null}
      <SummaryRow
        label={preview?.delivery.overridden ? "Delivery (overridden)" : "Delivery"}
        value={formatPaisa(totals?.deliveryFeePaisa ?? 0)}
        tone={preview?.delivery.overridden ? "warning" : undefined}
        hint={
          preview?.delivery.overridden
            ? `Calculated ${formatPaisa(preview.delivery.calculatedPaisa)} — the original value is kept with the override note`
            : undefined
        }
      />
      {totals && totals.codSurchargePaisa > 0 ? <SummaryRow label="COD surcharge" value={formatPaisa(totals.codSurchargePaisa)} /> : null}
      {mayViewCosts && totals && totals.inventoryCostPaisa > 0 ? (
        <SummaryRow label="Inventory cost" value={formatPaisa(totals.inventoryCostPaisa)} tone="muted" />
      ) : null}

      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
        <SummaryRow label="Grand total" value={formatPaisa(totals?.grandTotalPaisa ?? 0)} strong />
        <SummaryRow label="To collect" value={formatPaisa(totals?.collectiblePaisa ?? 0)} strong tone="brand" />
      </div>

      {mode === "create" && preview ? (
        <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
          Starts as <strong className="font-semibold">{preview.initialStatusLabel}</strong> — assigned by the server from
          the order type.
        </p>
      ) : null}

      {preview && preview.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {totals && totals.warnings.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-amber-700">
          {totals.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  tone?: "success" | "warning" | "brand" | "muted";
}) {
  const tones = {
    success: "text-emerald-600",
    warning: "text-amber-700",
    brand: "text-brand-700",
    muted: "text-slate-500",
  } as const;
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-xs text-slate-500", strong && "text-sm font-medium text-slate-800")}>{label}</span>
        <span
          className={cn(
            "tabular-nums text-slate-900",
            strong ? "text-base font-semibold" : "text-sm",
            tone ? tones[tone] : undefined,
          )}
        >
          {value}
        </span>
      </div>
      {hint ? <p className="text-[11px] leading-snug text-slate-400">{hint}</p> : null}
    </div>
  );
}
