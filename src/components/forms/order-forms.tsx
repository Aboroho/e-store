"use client";

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  cancelOrderAction,
  createOrderAction,
  dispatchOrderAction,
  markDeliveredAction,
  recordPaymentAction,
  refundPaymentAction,
  refreshShipmentAction,
  recordCourierChargeAction,
  requeueShipmentAction,
  settleRefundAction,
  transitionOrderAction,
  updateShipmentStatusAction,
} from "@/modules/orders/actions";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  NativeSelect,
  Textarea,
} from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { formatPaisa } from "@/lib/money";

export interface VariantPickOption {
  id: string;
  sku: string;
  label: string;
  pricePaisa: number | null;
}

export interface DistrictOption {
  code: string;
  name: string;
}

/** Staff-created order (admin, in-store counter or reseller order). */
export function OrderForm({
  variants,
  districts,
  storefronts = [],
  defaultChannel = "ADMIN",
  returnTo,
}: {
  variants: VariantPickOption[];
  districts: DistrictOption[];
  storefronts?: Array<{ id: string; name: string }>;
  defaultChannel?: "ADMIN" | "IN_STORE" | "RESELLER" | "STOREFRONT";
  returnTo?: string;
}) {
  const [state, formAction] = useActionState(createOrderAction, initialActionState);
  const [rows, setRows] = useState([{ key: "row-0", variantId: "", quantity: "1", unitPrice: "", discount: "", note: "" }]);
  const [channel, setChannel] = useState(defaultChannel);

  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="space-y-6">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Channel and customer</CardTitle>
          <p className="text-xs text-slate-500">
            Stock is reserved as soon as the order is created. If a line exceeds available stock and the product allows
            preorders, the shortage becomes a preorder commitment instead of failing the order.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Channel" htmlFor="channel" required>
              <NativeSelect id="channel" name="channel" value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
                <option value="ADMIN">Admin / phone order</option>
                <option value="IN_STORE">In-store</option>
                <option value="RESELLER">Reseller</option>
                <option value="STOREFRONT">Storefront (manual entry)</option>
              </NativeSelect>
            </FormField>
            {storefronts.length > 0 ? (
              <FormField label="Storefront" htmlFor="storefrontId">
                <NativeSelect id="storefrontId" name="storefrontId" defaultValue="">
                  <option value="">Not linked</option>
                  {storefronts.map((storefront) => (
                    <option key={storefront.id} value={storefront.id}>
                      {storefront.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            ) : null}
            <FormField label={channel === "IN_STORE" ? "Payment" : "Payment method"} htmlFor="paymentMethod">
              <NativeSelect id="paymentMethod" name="paymentMethod" defaultValue={channel === "IN_STORE" ? "CASH" : "COD"}>
                <option value="COD">Cash on delivery</option>
                <option value="CASH">Cash (in store)</option>
                <option value="BKASH">bKash (manual)</option>
                <option value="SSLCOMMERZ">Card / SSLCommerz (manual)</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="MANUAL">Other manual</option>
              </NativeSelect>
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Customer name" htmlFor="customerName" hint={channel === "IN_STORE" ? "Optional for counter sales" : undefined}>
              <Input id="customerName" name="customerName" autoComplete="name" />
            </FormField>
            <FormField label="Phone" htmlFor="customerPhone" hint="Stored normalised; the same number is one customer across storefronts">
              <Input id="customerPhone" name="customerPhone" inputMode="tel" placeholder="01712345678" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="District" htmlFor="shippingDistrictCode">
              <NativeSelect id="shippingDistrictCode" name="shippingDistrictCode" defaultValue="">
                <option value="">Select district…</option>
                {districts.map((district) => (
                  <option key={district.code} value={district.code}>
                    {district.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Area / thana" htmlFor="shippingArea">
              <Input id="shippingArea" name="shippingArea" />
            </FormField>
            <FormField label="Email" htmlFor="customerEmail">
              <Input id="customerEmail" name="customerEmail" type="email" />
            </FormField>
          </div>
          <FormField label="Delivery address" htmlFor="shippingAddressLine">
            <Textarea id="shippingAddressLine" name="shippingAddressLine" rows={2} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <p className="text-xs text-slate-500">
            Leave the unit price empty to use the resolved price for the chosen price list. Prices are stored as an
            immutable snapshot on the order.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.key} className="grid gap-3 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <NativeSelect
                  aria-label={`Item ${index + 1} variant`}
                  name="itemVariantId"
                  value={row.variantId}
                  onChange={(event) => update(row.key, { variantId: event.target.value })}
                >
                  <option value="">Select a variant…</option>
                  {variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.label} {variant.pricePaisa != null ? `— ${formatPaisa(variant.pricePaisa)}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="sm:col-span-2">
                <Input
                  aria-label={`Item ${index + 1} quantity`}
                  name="itemQuantity"
                  type="number"
                  min={1}
                  value={row.quantity}
                  onChange={(event) => update(row.key, { quantity: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  aria-label={`Item ${index + 1} unit price`}
                  name="itemUnitPrice"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Price"
                  value={row.unitPrice}
                  onChange={(event) => update(row.key, { unitPrice: event.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  aria-label={`Item ${index + 1} discount`}
                  name="itemDiscount"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Discount"
                  value={row.discount}
                  onChange={(event) => update(row.key, { discount: event.target.value })}
                />
              </div>
              <div className="flex items-center sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => setRows((current) => (current.length > 1 ? current.filter((entry) => entry.key !== row.key) : current))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <input type="hidden" name="itemNote" value={row.note} />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, { key: `row-${current.length}`, variantId: "", quantity: "1", unitPrice: "", discount: "", note: "" }])}
          >
            <Plus className="mr-2 h-4 w-4" /> Add item
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charges and notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Delivery fee (BDT)" htmlFor="deliveryFeePaisa" hint="Leave empty to use the district zone">
              <Input id="deliveryFeePaisa" name="deliveryFeePaisa" type="number" step="0.01" min={0} />
            </FormField>
            <FormField label="Order discount (BDT)" htmlFor="discountTotalPaisa">
              <Input id="discountTotalPaisa" name="discountTotalPaisa" type="number" step="0.01" min={0} />
            </FormField>
            <FormField label="Discount label" htmlFor="discountLabel">
              <Input id="discountLabel" name="discountLabel" placeholder="Loyalty discount" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Extra charge label" htmlFor="chargeLabel" hint="Required when an amount is entered">
              <Input id="chargeLabel" name="chargeLabel" placeholder="Installation" />
            </FormField>
            <FormField label="Extra charge (BDT)" htmlFor="chargeAmount">
              <Input id="chargeAmount" name="chargeAmount" type="number" step="0.01" min={0} />
            </FormField>
            <FormField label="Charge note" htmlFor="chargeNote">
              <Input id="chargeNote" name="chargeNote" />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Delivery notes" htmlFor="customerNote">
              <Input id="customerNote" name="customerNote" />
            </FormField>
            <FormField label="Internal note" htmlFor="internalNote">
              <Input id="internalNote" name="internalNote" />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="markDelivered" className="h-4 w-4 rounded border-slate-300" />
            Mark delivered immediately (in-store sale — no shipment is created)
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton>Create order</SubmitButton>
        <span className="text-xs text-slate-500">A unique idempotency key is generated per submission.</span>
      </div>
    </form>
  );
}

/** Guarded lifecycle move (confirm, process, ready to ship). */
export function OrderTransitionForm({ orderId, allowed }: { orderId: string; allowed: Array<{ value: string; label: string }> }) {
  const [state, formAction] = useActionState(transitionOrderAction, initialActionState);
  if (allowed.length === 0) return null;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Move to" htmlFor={`status-${orderId}`}>
        <NativeSelect id={`status-${orderId}`} name="status" defaultValue={allowed[0]!.value}>
          {allowed.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Note" htmlFor={`note-${orderId}`}>
        <Input id={`note-${orderId}`} name="note" placeholder="Optional note for the timeline" />
      </FormField>
      <SubmitButton variant="outline">
        Update status
      </SubmitButton>
    </form>
  );
}

export function DispatchOrderForm({
  orderId,
  providers,
  defaultWeightGrams = 500,
}: {
  orderId: string;
  providers: Array<{ id: string; name: string; code: string }>;
  defaultWeightGrams?: number;
}) {
  const [state, formAction] = useActionState(dispatchOrderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Courier" htmlFor={`courier-${orderId}`}>
          <NativeSelect id={`courier-${orderId}`} name="courierProviderId" defaultValue={providers[0]?.id ?? ""}>
            <option value="">Preferred provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Weight (grams)" htmlFor={`weight-${orderId}`}>
          <Input id={`weight-${orderId}`} name="declaredWeightGrams" type="number" min={100} step={50} defaultValue={defaultWeightGrams} />
        </FormField>
      </div>
      <FormField label="Courier charge (BDT)" htmlFor={`charge-${orderId}`}>
        <Input id={`charge-${orderId}`} name="courierChargePaisa" type="number" step="0.01" min={0} />
      </FormField>
      <p className="text-xs text-slate-500">
        Dispatching consumes the reservations and takes the physical stock out exactly once. The provider is called
        afterwards by the outbox worker — never inside this transaction.
      </p>
      <SubmitButton>Dispatch</SubmitButton>
    </form>
  );
}

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(cancelOrderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Cancellation reason" htmlFor={`reason-${orderId}`} required>
        <Textarea id={`reason-${orderId}`} name="reason" rows={2} required minLength={3} />
      </FormField>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="restock" defaultChecked className="h-4 w-4 rounded border-slate-300" />
        Restock dispatched units
      </label>
      <SubmitButton variant="destructive">
        Cancel order
      </SubmitButton>
    </form>
  );
}

export function MarkDeliveredForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(markDeliveredAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Note" htmlFor={`deliver-note-${orderId}`}>
        <Input id={`deliver-note-${orderId}`} name="note" placeholder="Delivered by our own rider" />
      </FormField>
      <SubmitButton>Mark delivered</SubmitButton>
    </form>
  );
}

export function RecordPaymentForm({ orderId, duePaisa, allowCod = true }: { orderId: string; duePaisa: number; allowCod?: boolean }) {
  const [state, formAction] = useActionState(recordPaymentAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Amount (BDT)" htmlFor={`amount-${orderId}`} required hint={duePaisa > 0 ? `Outstanding ${formatPaisa(duePaisa)}` : "Nothing outstanding"}>
          <Input
            id={`amount-${orderId}`}
            name="amount"
            type="number"
            step="0.01"
            min={0.01}
            defaultValue={duePaisa > 0 ? (duePaisa / 100).toFixed(2) : ""}
            required
          />
        </FormField>
        <FormField label="Method" htmlFor={`method-${orderId}`} required>
          <NativeSelect id={`method-${orderId}`} name="method" defaultValue={allowCod ? "COD" : "CASH"}>
            {allowCod ? <option value="COD">Cash on delivery (courier collected)</option> : null}
            <option value="CASH">Cash</option>
            <option value="BKASH">bKash (verified offline)</option>
            <option value="SSLCOMMERZ">Card / SSLCommerz</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="MANUAL">Other manual</option>
          </NativeSelect>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Provider reference" htmlFor={`ref-${orderId}`} hint="Transaction id from the provider">
          <Input id={`ref-${orderId}`} name="providerReference" />
        </FormField>
        <FormField label="Note" htmlFor={`pay-note-${orderId}`}>
          <Input id={`pay-note-${orderId}`} name="note" />
        </FormField>
      </div>
      <SubmitButton>Record payment</SubmitButton>
    </form>
  );
}

export function RefundPaymentForm({
  orderId,
  payments,
}: {
  orderId: string;
  payments: Array<{ id: string; label: string; refundablePaisa: number }>;
}) {
  const [state, formAction] = useActionState(refundPaymentAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Payment" htmlFor={`payment-${orderId}`}>
        <NativeSelect id={`payment-${orderId}`} name="paymentId" defaultValue={payments[0]?.id ?? ""}>
          {payments.map((payment) => (
            <option key={payment.id} value={payment.id}>
              {payment.label} — refundable {formatPaisa(payment.refundablePaisa)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Amount (BDT)" htmlFor={`refund-amount-${orderId}`} required>
          <Input id={`refund-amount-${orderId}`} name="amount" type="number" step="0.01" min={0.01} required />
        </FormField>
        <FormField label="Method" htmlFor={`refund-method-${orderId}`} required>
          <NativeSelect id={`refund-method-${orderId}`} name="method" defaultValue="MANUAL">
            <option value="MANUAL">Manual settlement</option>
            <option value="CASH">Cash</option>
            <option value="BKASH">bKash</option>
            <option value="SSLCOMMERZ">SSLCommerz</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </NativeSelect>
        </FormField>
      </div>
      <FormField label="Reason" htmlFor={`refund-reason-${orderId}`} required>
        <Input id={`refund-reason-${orderId}`} name="reason" required minLength={3} placeholder="Damaged on arrival" />
      </FormField>
      <SubmitButton variant="outline">
        Record refund
      </SubmitButton>
    </form>
  );
}

export function SettleRefundForm({ refundId, orderId, providerReference }: { refundId: string; orderId: string; providerReference?: string | null }) {
  const [state, formAction] = useActionState(settleRefundAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="refundId" value={refundId} />
      <input type="hidden" name="orderId" value={orderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      <FormField label="Provider reference" htmlFor={`settle-${refundId}`}>
        <Input id={`settle-${refundId}`} name="providerReference" defaultValue={providerReference ?? ""} />
      </FormField>
      <SubmitButton variant="outline">
        Mark refund complete
      </SubmitButton>
    </form>
  );
}

export function ShipmentActions({
  shipmentId,
  statuses,
  canRequeue,
}: {
  shipmentId: string;
  statuses: Array<{ value: string; label: string }>;
  canRequeue?: boolean;
}) {
  const [refreshState, refreshAction] = useActionState(refreshShipmentAction, initialActionState);
  const [queueState, queueAction] = useActionState(requeueShipmentAction, initialActionState);

  return (
    <div className="space-y-3">
      {refreshState.message ? <Alert variant={refreshState.status === "error" ? "danger" : "success"}>{refreshState.message}</Alert> : null}
      {queueState.message ? <Alert variant={queueState.status === "error" ? "danger" : "success"}>{queueState.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <form action={refreshAction}>
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <SubmitButton variant="outline">
            Refresh from provider
          </SubmitButton>
        </form>
        {canRequeue ? (
          <form action={queueAction}>
            <input type="hidden" name="shipmentId" value={shipmentId} />
            <SubmitButton variant="outline">
              Queue courier push
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {statuses.length > 0 ? <UpdateShipmentStatusForm shipmentId={shipmentId} statuses={statuses} /> : null}
    </div>
  );
}

function UpdateShipmentStatusForm({ shipmentId, statuses }: { shipmentId: string; statuses: Array<{ value: string; label: string }> }) {
  const [state, formAction] = useActionState(updateShipmentStatusAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3 border-t border-slate-200 pt-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Manual status" htmlFor={`ship-status-${shipmentId}`}>
          <NativeSelect id={`ship-status-${shipmentId}`} name="status" defaultValue={statuses[0]!.value}>
            {statuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Note" htmlFor={`ship-note-${shipmentId}`}>
          <Input id={`ship-note-${shipmentId}`} name="note" />
        </FormField>
      </div>
      <SubmitButton variant="outline">
        Save status
      </SubmitButton>
    </form>
  );
}

export function CourierChargeForm({ shipmentId }: { shipmentId: string }) {
  const [state, formAction] = useActionState(recordCourierChargeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Type" htmlFor={`charge-type-${shipmentId}`}>
          <NativeSelect id={`charge-type-${shipmentId}`} name="type" defaultValue="DELIVERY">
            <option value="DELIVERY">Delivery fee</option>
            <option value="COD">COD charge</option>
            <option value="RETURN">Return fee</option>
            <option value="WEIGHT_ADJUSTMENT">Weight adjustment</option>
            <option value="OTHER">Other</option>
          </NativeSelect>
        </FormField>
        <FormField label="Amount (BDT)" htmlFor={`charge-amount-${shipmentId}`} required>
          <Input id={`charge-amount-${shipmentId}`} name="amount" type="number" step="0.01" min={0} required />
        </FormField>
        <FormField label="COD charge (BDT)" htmlFor={`cod-charge-${shipmentId}`}>
          <Input id={`cod-charge-${shipmentId}`} name="codCharge" type="number" step="0.01" min={0} />
        </FormField>
      </div>
      <FormField label="Note" htmlFor={`charge-note-${shipmentId}`}>
        <Input id={`charge-note-${shipmentId}`} name="note" />
      </FormField>
      <SubmitButton variant="outline">
        Record charge
      </SubmitButton>
    </form>
  );
}
