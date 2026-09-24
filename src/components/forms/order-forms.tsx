"use client";

import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  recordPaymentAction,
  refundPaymentAction,
  refreshShipmentAction,
  recordCourierChargeAction,
  requeueShipmentAction,
  settleRefundAction,
  updateShipmentStatusAction,
} from "@/modules/orders/actions";
import { Alert, FormField, Input, NativeSelect } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { formatPaisa } from "@/lib/money";

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
