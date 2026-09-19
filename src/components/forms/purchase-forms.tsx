"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { initialActionState } from "@/modules/auth/actions";
import {
  cancelPurchaseOrderAction,
  createPurchaseOrderAction,
  receivePurchaseOrderAction,
  recordSupplierPaymentAction,
} from "@/modules/purchasing/actions";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  NativeSelect,
  Textarea,
} from "@/components/ui/primitives";

export interface VariantPickOption {
  id: string;
  sku: string;
  label: string;
  costPaisa: number | null;
}

export function PurchaseOrderForm({
  suppliers,
  variants,
}: {
  suppliers: Array<{ id: string; name: string }>;
  variants: VariantPickOption[];
}) {
  const [state, formAction, pending] = useActionState(createPurchaseOrderAction, initialActionState);
  const [rows, setRows] = useState([{ key: "row-0", variantId: "", quantity: "1", unitCost: "", note: "" }]);

  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Purchase order</CardTitle>
          <p className="text-xs text-slate-500">
            Costs are recorded in BDT and stored as integer paisa. Additional costs (transport, duty) are allocated
            across the received lines when you post a goods receipt.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Supplier" htmlFor="supplierId" required>
              <NativeSelect id="supplierId" name="supplierId" required defaultValue="">
                <option value="">Select a supplier…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Expected date" htmlFor="expectedAt">
              <Input id="expectedAt" name="expectedAt" type="date" />
            </FormField>
            <FormField label="Additional costs (BDT)" htmlFor="extraCostPaisa" hint="Freight, duty, clearing — allocated to the received units.">
              <Input id="extraCostPaisa" name="extraCostPaisa" type="number" step="0.01" min={0} defaultValue="0.00" />
            </FormField>
            <FormField label="Internal note" htmlFor="internalNote">
              <Input id="internalNote" name="internalNote" />
            </FormField>
          </div>
          <FormField label="Supplier note" htmlFor="note">
            <Textarea id="note" name="note" rows={2} />
          </FormField>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Items</p>
            {rows.map((row) => (
              <div key={row.key} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                <FormField label="Variant" htmlFor={`item-${row.key}`} className="sm:col-span-5">
                  <NativeSelect
                    id={`item-${row.key}`}
                    name="itemVariantId"
                    value={row.variantId}
                    onChange={(event) => {
                      const variant = variants.find((entry) => entry.id === event.target.value);
                      update(row.key, {
                        variantId: event.target.value,
                        unitCost: variant?.costPaisa != null ? (variant.costPaisa / 100).toFixed(2) : row.unitCost,
                      });
                    }}
                    required
                  >
                    <option value="">Select a variant…</option>
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.sku} — {variant.label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="Quantity" htmlFor={`qty-${row.key}`} className="sm:col-span-2">
                  <Input
                    id={`qty-${row.key}`}
                    name="itemQuantity"
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(event) => update(row.key, { quantity: event.target.value })}
                    required
                  />
                </FormField>
                <FormField label="Unit cost (BDT)" htmlFor={`cost-${row.key}`} className="sm:col-span-2">
                  <Input
                    id={`cost-${row.key}`}
                    name="itemUnitCost"
                    type="number"
                    step="0.01"
                    min={0}
                    value={row.unitCost}
                    onChange={(event) => update(row.key, { unitCost: event.target.value })}
                    required
                  />
                </FormField>
                <FormField label="Note" htmlFor={`note-${row.key}`} className="sm:col-span-2">
                  <Input id={`note-${row.key}`} name="itemNote" value={row.note} onChange={(event) => update(row.key, { note: event.target.value })} />
                </FormField>
                <div className="flex items-end sm:col-span-1">
                  {rows.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((current) => [...current, { key: `row-${current.length}-${Date.now()}`, variantId: "", quantity: "1", unitCost: "", note: "" }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add line
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create purchase order"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function GoodsReceiptForm({
  purchaseOrderId,
  locations,
  items,
}: {
  purchaseOrderId: string;
  locations: Array<{ id: string; name: string; isDefault: boolean }>;
  items: Array<{ id: string; sku: string; productName: string; outstanding: number; unitCostPaisa: number }>;
}) {
  const [state, formAction, pending] = useActionState(receivePurchaseOrderAction, initialActionState);
  const [expenses, setExpenses] = useState([{ key: "expense-0", label: "", amount: "", method: "VALUE" }]);

  return (
    <form action={formAction}>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      <Card>
        <CardHeader>
          <CardTitle>Record goods receipt</CardTitle>
          <p className="text-xs text-slate-500">
            Leave a quantity at zero to receive later. Posting the receipt updates stock and the weighted average cost
            in one transaction.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Location" htmlFor="receipt-location">
              <NativeSelect id="receipt-location" name="locationId" defaultValue={locations.find((location) => location.isDefault)?.id ?? ""}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="External reference" htmlFor="externalReference" hint="Supplier invoice or consignment number.">
              <Input id="externalReference" name="externalReference" />
            </FormField>
            <FormField label="Idempotency key" htmlFor="idempotencyKey" hint="Submitting the same key twice books the stock once.">
              <Input id="idempotencyKey" name="idempotencyKey" placeholder="optional" />
            </FormField>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2">Variant</th>
                  <th className="px-2 py-2">Outstanding</th>
                  <th className="px-2 py-2">Receive now</th>
                  <th className="px-2 py-2">Unit cost (BDT)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-2 py-2">
                      <input type="hidden" name="receiptItemId" value={item.id} />
                      <p className="font-medium text-slate-800">{item.productName}</p>
                      <p className="font-mono text-xs text-slate-500">{item.sku}</p>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{item.outstanding}</td>
                    <td className="px-2 py-2">
                      <Input
                        name="receiptQuantity"
                        type="number"
                        min={0}
                        max={item.outstanding}
                        defaultValue={0}
                        className="h-9 w-20"
                        id={`receipt-qty-${index}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        name="receiptUnitCost"
                        type="number"
                        step="0.01"
                        min={0}
                        defaultValue={(item.unitCostPaisa / 100).toFixed(2)}
                        className="h-9 w-28"
                        id={`receipt-cost-${index}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Additional costs on this receipt (optional)</p>
            {expenses.map((expense) => (
              <div key={expense.key} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                <FormField label="Label" htmlFor={`label-${expense.key}`} className="sm:col-span-5">
                  <Input
                    id={`label-${expense.key}`}
                    name="expenseLabel"
                    value={expense.label}
                    onChange={(event) =>
                      setExpenses((current) => current.map((entry) => (entry.key === expense.key ? { ...entry, label: event.target.value } : entry)))
                    }
                    placeholder="Freight"
                  />
                </FormField>
                <FormField label="Amount (BDT)" htmlFor={`amount-${expense.key}`} className="sm:col-span-3">
                  <Input
                    id={`amount-${expense.key}`}
                    name="expenseAmount"
                    type="number"
                    step="0.01"
                    min={0}
                    value={expense.amount}
                    onChange={(event) =>
                      setExpenses((current) => current.map((entry) => (entry.key === expense.key ? { ...entry, amount: event.target.value } : entry)))
                    }
                  />
                </FormField>
                <FormField label="Allocation" htmlFor={`method-${expense.key}`} className="sm:col-span-3">
                  <NativeSelect
                    id={`method-${expense.key}`}
                    name="expenseMethod"
                    value={expense.method}
                    onChange={(event) =>
                      setExpenses((current) => current.map((entry) => (entry.key === expense.key ? { ...entry, method: event.target.value } : entry)))
                    }
                  >
                    <option value="VALUE">By value</option>
                    <option value="QUANTITY">By quantity</option>
                    <option value="NONE">Do not capitalise</option>
                  </NativeSelect>
                </FormField>
                <div className="flex items-end sm:col-span-1">
                  {expenses.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove cost" onClick={() => setExpenses((current) => current.filter((entry) => entry.key !== expense.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpenses((current) => [...current, { key: `expense-${current.length}-${Date.now()}`, label: "", amount: "", method: "VALUE" }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Add cost
            </Button>
          </div>

          <FormField label="Receipt note" htmlFor="receipt-note">
            <Textarea id="receipt-note" name="note" rows={2} />
          </FormField>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Posting…" : "Post receipt"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function CancelPurchaseOrderForm({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [state, formAction, pending] = useActionState(cancelPurchaseOrderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Cancellation reason" htmlFor="cancel-reason" required>
        <Textarea id="cancel-reason" name="reason" rows={2} required />
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Cancelling…" : "Cancel purchase order"}
      </Button>
    </form>
  );
}

export function SupplierPaymentForm({
  suppliers,
  purchaseOrders,
  presetSupplierId,
  presetPurchaseOrderId,
}: {
  suppliers: Array<{ id: string; name: string }>;
  purchaseOrders: Array<{ id: string; code: string; supplierId: string; outstandingPaisa: number }>;
  presetSupplierId?: string;
  presetPurchaseOrderId?: string;
}) {
  const [state, formAction, pending] = useActionState(recordSupplierPaymentAction, initialActionState);
  const [supplierId, setSupplierId] = useState(presetSupplierId ?? "");

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Record supplier payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Supplier" htmlFor="pay-supplier" required>
              <NativeSelect id="pay-supplier" name="supplierId" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
                <option value="">Select a supplier…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Purchase order (optional)" htmlFor="pay-po">
              <NativeSelect id="pay-po" name="purchaseOrderId" defaultValue={presetPurchaseOrderId ?? ""}>
                <option value="">Not linked</option>
                {purchaseOrders
                  .filter((order) => !supplierId || order.supplierId === supplierId)
                  .map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.code} — outstanding {(order.outstandingPaisa / 100).toFixed(2)} BDT
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            <FormField label="Amount (BDT)" htmlFor="pay-amount" required>
              <Input id="pay-amount" name="amountPaisa" type="number" step="0.01" min={0.01} required />
            </FormField>
            <FormField label="Method" htmlFor="pay-method">
              <NativeSelect id="pay-method" name="method" defaultValue="CASH">
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="BKASH">bKash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </NativeSelect>
            </FormField>
            <FormField label="Reference" htmlFor="pay-reference">
              <Input id="pay-reference" name="reference" />
            </FormField>
            <FormField label="Paid at" htmlFor="pay-date">
              <Input id="pay-date" name="paidAt" type="date" />
            </FormField>
          </div>
          <FormField label="Note" htmlFor="pay-note">
            <Textarea id="pay-note" name="note" rows={2} />
          </FormField>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
