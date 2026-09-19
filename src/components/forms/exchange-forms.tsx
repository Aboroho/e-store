"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/actions";
import {
  approveExchangeAction,
  cancelExchangeAction,
  completeExchangeAction,
  createExchangeAction,
  inspectExchangeAction,
  receiveExchangeAction,
  recordExchangeCollectionAction,
  rejectExchangeAction,
} from "@/modules/exchanges/actions";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export interface ExchangeableItem {
  id: string;
  sku: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPricePaisa: number;
  returnedQuantity: number;
  exchangedQuantity: number;
  variantId: string | null;
}

export interface ExchangeableOrder {
  id: string;
  orderNumber: string;
  customerName: string | null;
  deliveredAt: Date | null;
  items: ExchangeableItem[];
}

/**
 * Exchange request screen.
 *
 * Prices are shown for the operator's benefit only: the server re-reads the
 * original item snapshots for credit and resolves current prices for the
 * replacements, so nothing the browser sends can change what is charged.
 */
export function ExchangeCreateForm({
  orders,
  reasons,
  variants,
  presetOrderId,
}: {
  orders: ExchangeableOrder[];
  reasons: Array<{ code: string; label: string; deliveryChargePaisa: number; requiresNote: boolean }>;
  variants: Array<{ id: string; sku: string; name: string; productName: string }>;
  presetOrderId?: string;
}) {
  const [state, formAction] = useActionState(createExchangeAction, initialActionState);
  const [orderId, setOrderId] = useState(presetOrderId ?? orders[0]?.id ?? "");
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? "");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [replacements, setReplacements] = useState<Array<{ variantId: string; quantity: number }>>([{ variantId: "", quantity: 1 }]);

  const order = orders.find((candidate) => candidate.id === orderId);
  const reason = reasons.find((candidate) => candidate.code === reasonCode);

  const creditPaisa = useMemo(() => {
    if (!order) return 0;
    return order.items.reduce((total, item) => total + (returnQuantities[item.id] ?? 0) * item.unitPricePaisa, 0);
  }, [order, returnQuantities]);

  const replacementCount = replacements.filter((row) => row.variantId).reduce((total, row) => total + row.quantity, 0);

  return (
    <form action={formAction} className="space-y-6">
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Delivered order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Order" htmlFor="exchange-order" required hint="Only delivered or completed orders can be exchanged">
              <NativeSelect id="exchange-order" name="orderId" value={orderId} onChange={(event) => setOrderId(event.target.value)} required>
                {orders.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.orderNumber}
                    {candidate.customerName ? ` · ${candidate.customerName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Reason" htmlFor="exchange-reason" required>
              <NativeSelect id="exchange-reason" name="reasonCode" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} required>
                {reasons.map((candidate) => (
                  <option key={candidate.code} value={candidate.code}>
                    {candidate.label}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <FormField label="Reason note" htmlFor="exchange-reason-note" hint={reason?.requiresNote ? "Required for this reason" : "Optional"}>
            <Input id="exchange-reason-note" name="reasonNote" required={reason?.requiresNote} />
          </FormField>
          <input type="hidden" name="channel" value="STAFF" />
          <input type="hidden" name="idempotencyKey" value={`exchange-${orderId}-${reasonCode}-${creditPaisa}-${replacementCount}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Returned items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!order ? (
            <p className="text-sm text-slate-500">Pick an order to see its items.</p>
          ) : (
            order.items.map((item) => {
              const exchangeable = item.quantity - item.returnedQuantity - item.exchangedQuantity;
              return (
                <div key={item.id} className="flex flex-wrap items-end justify-between gap-3 rounded border border-slate-200 p-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {item.productName} · {item.variantName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {item.sku} · bought {item.quantity} · exchangeable {exchangeable}
                    </div>
                  </div>
                  <div className="w-28">
                    <FormField label="Return" htmlFor={`return-${item.id}`}>
                      <Input
                        id={`return-${item.id}`}
                        name="returnQuantity"
                        type="number"
                        min={0}
                        max={exchangeable}
                        value={returnQuantities[item.id] ?? 0}
                        onChange={(event) =>
                          setReturnQuantities((previous) => ({ ...previous, [item.id]: Math.min(exchangeable, Math.max(0, Number(event.target.value) || 0)) }))
                        }
                      />
                    </FormField>
                  </div>
                  <input type="hidden" name="returnItemId" value={item.id} />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Replacement items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {replacements.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1">
                <FormField label="Variant" htmlFor={`replacement-${index}`}>
                  <NativeSelect
                    id={`replacement-${index}`}
                    name="replacementVariantId"
                    value={row.variantId}
                    onChange={(event) => setReplacements((rows) => rows.map((candidate, position) => (position === index ? { ...candidate, variantId: event.target.value } : candidate)))}
                  >
                    <option value="">— none —</option>
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.sku} · {variant.productName} {variant.name}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <div className="w-24">
                <FormField label="Qty" htmlFor={`replacement-qty-${index}`}>
                  <Input
                    id={`replacement-qty-${index}`}
                    name="replacementQuantity"
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(event) => setReplacements((rows) => rows.map((candidate, position) => (position === index ? { ...candidate, quantity: Math.max(1, Number(event.target.value) || 1) } : candidate)))}
                  />
                </FormField>
              </div>
              <button
                type="button"
                className="pb-2 text-xs text-rose-600 hover:underline"
                onClick={() => setReplacements((rows) => rows.filter((_, position) => position !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setReplacements((rows) => [...rows, { variantId: "", quantity: 1 }])}>
            + Add replacement
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField label="Delivery charge (৳)" htmlFor="exchange-delivery" hint={reason ? `Reason default: ${(reason.deliveryChargePaisa / 100).toFixed(2)}` : undefined}>
            <Input id="exchange-delivery" name="deliveryChargePaisa" defaultValue={reason ? (reason.deliveryChargePaisa / 100).toFixed(2) : "0.00"} />
          </FormField>
          <FormField label="Additional charge (৳)" htmlFor="exchange-additional">
            <Input id="exchange-additional" name="additionalChargePaisa" defaultValue="0.00" />
          </FormField>
          <FormField label="Discount (৳)" htmlFor="exchange-discount">
            <Input id="exchange-discount" name="discountPaisa" defaultValue="0.00" />
          </FormField>
          <div className="sm:col-span-3">
            <FormField label="Internal note" htmlFor="exchange-internal">
              <Textarea id="exchange-internal" name="internalNote" rows={2} />
            </FormField>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-3">
            Returned credit at snapshot prices: ৳{(creditPaisa / 100).toFixed(2)}. Replacement prices, delivery and the final difference are
            calculated on the server when the request is saved.
          </p>
        </CardContent>
      </Card>

      <SubmitButton>Create exchange request</SubmitButton>
    </form>
  );
}

export function ExchangeApproveForm({ exchangeId, requiresApproval }: { exchangeId: string; requiresApproval: boolean }) {
  const [state, formAction] = useActionState(approveExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Approval note" htmlFor={`approve-${exchangeId}`}>
        <Input id={`approve-${exchangeId}`} name="note" />
      </FormField>
      <SubmitButton variant="outline">{requiresApproval ? "Approve request" : "Approve (auto)"}</SubmitButton>
    </form>
  );
}

export function ExchangeRejectForm({ exchangeId }: { exchangeId: string }) {
  const [state, formAction] = useActionState(rejectExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      <FormField label="Rejection reason" htmlFor={`reject-${exchangeId}`} required>
        <Textarea id={`reject-${exchangeId}`} name="reason" rows={2} required minLength={3} />
      </FormField>
      <SubmitButton variant="destructive">Reject request</SubmitButton>
    </form>
  );
}

export function ExchangeReceiveForm({ exchangeId }: { exchangeId: string }) {
  const [state, formAction] = useActionState(receiveExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <p className="text-xs text-slate-500">Mark the returned parcel as received so the items can be inspected.</p>
      <SubmitButton variant="outline">Mark returned items received</SubmitButton>
    </form>
  );
}

export function ExchangeInspectForm({
  exchangeId,
  items,
}: {
  exchangeId: string;
  items: Array<{ id: string; sku: string; productName: string; quantity: number; inspectionOutcome: string }>;
}) {
  const [state, formAction] = useActionState(inspectExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      {items.map((item) => (
        <div key={item.id} className="space-y-2 rounded border border-slate-200 p-3">
          <input type="hidden" name="inspectItemId" value={item.id} />
          <div className="text-sm font-medium text-slate-900">
            {item.productName} <span className="text-xs text-slate-500">{item.sku}</span>{" "}
            <Badge variant={item.inspectionOutcome === "PENDING" ? "warning" : "success"}>{item.inspectionOutcome.toLowerCase()}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Condition" htmlFor={`outcome-${item.id}`}>
              <NativeSelect id={`outcome-${item.id}`} name="inspectOutcome" defaultValue="SELLABLE">
                <option value="SELLABLE">Sellable — back to stock</option>
                <option value="DAMAGED">Damaged — damaged stock</option>
                <option value="DISCARDED">Discarded — write off</option>
              </NativeSelect>
            </FormField>
            <FormField label="Quantity" htmlFor={`qty-${item.id}`}>
              <Input id={`qty-${item.id}`} name="inspectQuantity" type="number" min={0} max={item.quantity} defaultValue={item.quantity} />
            </FormField>
            <FormField label="Note" htmlFor={`note-${item.id}`}>
              <Input id={`note-${item.id}`} name="inspectNote" />
            </FormField>
          </div>
        </div>
      ))}
      <SubmitButton variant="outline">Save inspection</SubmitButton>
    </form>
  );
}

export function ExchangeCompleteForm({ exchangeId, canComplete }: { exchangeId: string; canComplete: boolean }) {
  const [state, formAction] = useActionState(completeExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <p className="text-xs text-slate-500">
        Completing takes the replacement stock out of inventory, fulfils (or reverses) the original order lines and raises a refund when the
        difference is negative.
      </p>
      <SubmitButton disabled={!canComplete}>Complete exchange</SubmitButton>
    </form>
  );
}

export function ExchangeCancelForm({ exchangeId }: { exchangeId: string }) {
  const [state, formAction] = useActionState(cancelExchangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      <FormField label="Cancel reason" htmlFor={`cancel-${exchangeId}`} required>
        <Input id={`cancel-${exchangeId}`} name="reason" required minLength={3} />
      </FormField>
      <SubmitButton variant="destructive">Cancel exchange</SubmitButton>
    </form>
  );
}

export function ExchangeCollectionForm({ exchangeId, differencePaisa }: { exchangeId: string; differencePaisa: number }) {
  const [state, formAction] = useActionState(recordExchangeCollectionAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="exchangeId" value={exchangeId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Method" htmlFor={`method-${exchangeId}`}>
          <NativeSelect id={`method-${exchangeId}`} name="method" defaultValue="CASH">
            <option value="CASH">Cash</option>
            <option value="BKASH">bKash</option>
            <option value="SSLCOMMERZ">SSLCommerz</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="MANUAL">Manual</option>
          </NativeSelect>
        </FormField>
        <FormField label="Amount (৳)" htmlFor={`amount-${exchangeId}`}>
          <Input id={`amount-${exchangeId}`} name="amount" defaultValue={(Math.max(differencePaisa, 0) / 100).toFixed(2)} />
        </FormField>
        <FormField label="Reference" htmlFor={`ref-${exchangeId}`}>
          <Input id={`ref-${exchangeId}`} name="reference" />
        </FormField>
      </div>
      <SubmitButton variant="outline">Record collection</SubmitButton>
    </form>
  );
}
