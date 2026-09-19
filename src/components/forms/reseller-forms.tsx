"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  applyResellerMarkupAction,
  approvePayoutAction,
  cancelPayoutAction,
  createPayoutAction,
  createResellerAction,
  createResellerOrderAction,
  failPayoutAction,
  markPayoutPaidAction,
  recordCollectionChangeAction,
  recordResellerAdjustmentAction,
  refreshEligibilityAction,
  removeResellerPriceAction,
  setResellerPriceAction,
  setResellerStatusAction,
  updateResellerAction,
} from "@/modules/resellers/actions";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, FormField, Input, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

/** Reseller forms: profile, pricing, orders, ledger adjustments and payouts. */

export interface ResellerDefaults {
  id: string;
  code: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  commissionType: string;
  commissionValue: number;
  packagingIncluded: boolean;
  packagingCostPaisa: number;
  deliveryChargePaisa: number;
  codChargePaisa: number;
  defaultDistrictCode: string | null;
  address: string | null;
  nidNumber: string | null;
  payoutMethod: string;
  payoutAccountNumber: string | null;
  payoutAccountName: string | null;
  minimumPayoutPaisa: number;
  creditLimitPaisa: number;
  note: string | null;
}

const COMMISSION_TYPES = ["MARGIN_BASED", "PERCENT_OF_MARGIN", "FIXED_PER_ORDER", "FIXED_PER_ITEM", "NONE"];
const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];
const PAYOUT_METHODS = ["BKASH", "BANK_TRANSFER", "CASH", "OTHER"];

function Feedback({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "error" && state.message) return <Alert variant="danger">{state.message}</Alert>;
  if (state.status === "success" && state.message) return <Alert variant="success">{state.message}</Alert>;
  return null;
}

function moneyValue(paisa: number | null | undefined): string {
  return ((paisa ?? 0) / 100).toFixed(2);
}

export function ResellerForm({ reseller }: { reseller?: ResellerDefaults } = {}) {
  const [state, formAction] = useActionState(reseller ? updateResellerAction : createResellerAction, initialActionState);
  const prefix = reseller?.id ?? "new";

  return (
    <form action={formAction} className="space-y-4">
      {reseller ? <input type="hidden" name="resellerId" value={reseller.id} /> : null}
      <Feedback state={state} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" htmlFor={`name-${prefix}`} required error={state.fieldErrors?.name?.[0]}>
          <Input id={`name-${prefix}`} name="name" defaultValue={reseller?.name ?? ""} required />
        </FormField>
        <FormField label="Code" htmlFor={`code-${prefix}`} hint="Leave blank to generate (RS-0001)">
          <Input id={`code-${prefix}`} name="code" defaultValue={reseller?.code ?? ""} disabled={Boolean(reseller)} />
        </FormField>
        <FormField label="Business name" htmlFor={`businessName-${prefix}`}>
          <Input id={`businessName-${prefix}`} name="businessName" defaultValue={reseller?.businessName ?? ""} />
        </FormField>
        <FormField label="Phone" htmlFor={`phone-${prefix}`} error={state.fieldErrors?.phone?.[0]}>
          <Input id={`phone-${prefix}`} name="phone" defaultValue={reseller?.phone ?? ""} placeholder="01712345678" />
        </FormField>
        <FormField label="Email" htmlFor={`email-${prefix}`}>
          <Input id={`email-${prefix}`} name="email" type="email" defaultValue={reseller?.email ?? ""} />
        </FormField>
        <FormField label="Status" htmlFor={`status-${prefix}`}>
          <NativeSelect id={`status-${prefix}`} name="status" defaultValue={reseller?.status ?? "ACTIVE"}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Default district code" htmlFor={`district-${prefix}`} hint="Two-digit code, e.g. 26 for Pabna">
          <Input id={`district-${prefix}`} name="defaultDistrictCode" defaultValue={reseller?.defaultDistrictCode ?? ""} maxLength={2} />
        </FormField>
        <FormField label="NID number" htmlFor={`nid-${prefix}`}>
          <Input id={`nid-${prefix}`} name="nidNumber" defaultValue={reseller?.nidNumber ?? ""} />
        </FormField>
      </div>

      <FormField label="Address" htmlFor={`address-${prefix}`}>
        <Textarea id={`address-${prefix}`} name="address" rows={2} defaultValue={reseller?.address ?? ""} />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Commission model" htmlFor={`commissionType-${prefix}`}>
          <NativeSelect id={`commissionType-${prefix}`} name="commissionType" defaultValue={reseller?.commissionType ?? "MARGIN_BASED"}>
            {COMMISSION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Commission value" htmlFor={`commissionValue-${prefix}`} hint="Paisa or basis points, depending on the model">
          <Input id={`commissionValue-${prefix}`} name="commissionValue" type="number" min={0} defaultValue={reseller?.commissionValue ?? 0} />
        </FormField>
        <FormField label="Packaging cost (BDT / unit)" htmlFor={`packaging-${prefix}`}>
          <Input id={`packaging-${prefix}`} name="packagingCost" defaultValue={moneyValue(reseller?.packagingCostPaisa)} />
        </FormField>
        <FormField label="Delivery charge (BDT)" htmlFor={`delivery-${prefix}`} hint="Null means: platform setting decides">
          <Input id={`delivery-${prefix}`} name="deliveryCharge" defaultValue={moneyValue(reseller?.deliveryChargePaisa)} />
        </FormField>
        <FormField label="COD charge (BDT)" htmlFor={`cod-${prefix}`}>
          <Input id={`cod-${prefix}`} name="codCharge" defaultValue={moneyValue(reseller?.codChargePaisa)} />
        </FormField>
        <FormField label="Minimum payout (BDT)" htmlFor={`minimumPayout-${prefix}`}>
          <Input id={`minimumPayout-${prefix}`} name="minimumPayout" defaultValue={moneyValue(reseller?.minimumPayoutPaisa)} />
        </FormField>
        <FormField label="Credit limit (BDT)" htmlFor={`creditLimit-${prefix}`}>
          <Input id={`creditLimit-${prefix}`} name="creditLimit" defaultValue={moneyValue(reseller?.creditLimitPaisa)} />
        </FormField>
        <FormField label="Packaging included in price?" htmlFor={`packagingIncluded-${prefix}`}>
          <NativeSelect id={`packagingIncluded-${prefix}`} name="packagingIncluded" defaultValue={reseller?.packagingIncluded === false ? "false" : "true"}>
            <option value="true">Yes — price already includes packaging</option>
            <option value="false">No — charge packaging per unit</option>
          </NativeSelect>
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Payout method" htmlFor={`payoutMethod-${prefix}`}>
          <NativeSelect id={`payoutMethod-${prefix}`} name="payoutMethod" defaultValue={reseller?.payoutMethod ?? "BKASH"}>
            {PAYOUT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Payout account" htmlFor={`payoutAccount-${prefix}`}>
          <Input id={`payoutAccount-${prefix}`} name="payoutAccountNumber" defaultValue={reseller?.payoutAccountNumber ?? ""} />
        </FormField>
        <FormField label="Account name" htmlFor={`payoutAccountName-${prefix}`}>
          <Input id={`payoutAccountName-${prefix}`} name="payoutAccountName" defaultValue={reseller?.payoutAccountName ?? ""} />
        </FormField>
      </div>

      <FormField label="Internal note" htmlFor={`note-${prefix}`}>
        <Textarea id={`note-${prefix}`} name="note" rows={2} defaultValue={reseller?.note ?? ""} />
      </FormField>

      <SubmitButton>{reseller ? "Save reseller" : "Create reseller"}</SubmitButton>
    </form>
  );
}

export function ResellerStatusForm({ resellerId, status }: { resellerId: string; status: string }) {
  const [state, formAction] = useActionState(setResellerStatusAction, initialActionState);
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="resellerId" value={resellerId} />
      <input type="hidden" name="status" value={next} />
      <FormField label="Reason (recorded in the audit log)" htmlFor={`status-reason-${resellerId}`}>
        <Input id={`status-reason-${resellerId}`} name="reason" placeholder="Optional" />
      </FormField>
      <SubmitButton variant={next === "SUSPENDED" ? "destructive" : "default"}>
        {next === "SUSPENDED" ? "Suspend reseller" : "Reactivate reseller"}
      </SubmitButton>
    </form>
  );
}

export interface ResellerPriceRow {
  id: string;
  sku: string;
  product: string;
  variant: string;
  pricePaisa: number;
  minQuantity: number;
}

export function ResellerPricingPanel({
  resellerId,
  items,
  variants,
}: {
  resellerId: string;
  items: ResellerPriceRow[];
  variants: Array<{ id: string; label: string }>;
}) {
  const [priceState, priceAction] = useActionState(setResellerPriceAction, initialActionState);
  const [markupState, markupAction] = useActionState(applyResellerMarkupAction, initialActionState);
  const [removeState, removeAction] = useActionState(removeResellerPriceAction, initialActionState);
  const [search, setSearch] = useState("");

  const filteredVariants = variants.filter((variant) => variant.label.toLowerCase().includes(search.toLowerCase())).slice(0, 50);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Negotiated prices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Feedback state={priceState} />
          <Feedback state={removeState} />
          <form action={priceAction} className="space-y-3">
            <input type="hidden" name="resellerId" value={resellerId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Search variants" htmlFor={`variant-search-${resellerId}`}>
                <Input
                  id={`variant-search-${resellerId}`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="SKU or product name"
                />
              </FormField>
              <FormField label="Variant" htmlFor={`variant-${resellerId}`} required>
                <NativeSelect id={`variant-${resellerId}`} name="variantId" required>
                  <option value="">Select a variant…</option>
                  {filteredVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.label}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Price (BDT)" htmlFor={`price-${resellerId}`} required>
                <Input id={`price-${resellerId}`} name="price" placeholder="0.00" required />
              </FormField>
            </div>
            <SubmitButton size="sm">Save price</SubmitButton>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Min qty</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-slate-500">
                    No negotiated prices yet — the default price list applies.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>
                      <div className="text-sm">{item.product}</div>
                      <div className="text-xs text-slate-500">{item.variant}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{(item.pricePaisa / 100).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.minQuantity}</TableCell>
                    <TableCell className="text-right">
                      <form action={removeAction}>
                        <input type="hidden" name="resellerId" value={resellerId} />
                        <input type="hidden" name="itemId" value={item.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Remove
                        </SubmitButton>
                      </form>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bulk markup from the default price list</CardTitle>
        </CardHeader>
        <CardContent>
          <Feedback state={markupState} />
          <form action={markupAction} className="space-y-3">
            <input type="hidden" name="resellerId" value={resellerId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Markup %" htmlFor={`markup-${resellerId}`} hint="20 means default price + 20%">
                <Input id={`markup-${resellerId}`} name="markupPercent" type="number" step="0.01" defaultValue={0} />
              </FormField>
              <FormField label="Apply to" htmlFor={`onlyMissing-${resellerId}`}>
                <NativeSelect id={`onlyMissing-${resellerId}`} name="onlyMissing" defaultValue="true">
                  <option value="true">Only variants without a negotiated price</option>
                  <option value="false">Every variant (overwrite negotiated prices)</option>
                </NativeSelect>
              </FormField>
            </div>
            <SubmitButton size="sm" variant="outline">
              Apply markup
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ResellerOrderForm({
  resellerId,
  variants,
}: {
  resellerId: string;
  variants: Array<{ id: string; label: string; pricePaisa: number }>;
}) {
  const [state, formAction] = useActionState(createResellerOrderAction, initialActionState);
  const [rows, setRows] = useState([{ key: 0 }]);
  const [lines, setLines] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");

  const filtered = variants.filter((variant) => variant.label.toLowerCase().includes(search.toLowerCase())).slice(0, 50);
  const subtotalPaisa = rows.reduce((total, row) => {
    const variant = variants.find((entry) => entry.id === lines[row.key]);
    return total + (variant?.pricePaisa ?? 0);
  }, 0);

  return (
    <form action={formAction} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="resellerId" value={resellerId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Customer name" htmlFor="reseller-customer-name" required>
          <Input id="reseller-customer-name" name="customerName" required />
        </FormField>
        <FormField label="Customer phone" htmlFor="reseller-customer-phone" required>
          <Input id="reseller-customer-phone" name="customerPhone" placeholder="01712345678" required />
        </FormField>
        <FormField label="District code" htmlFor="reseller-district" required hint="Two-digit code, e.g. 26">
          <Input id="reseller-district" name="shippingDistrictCode" maxLength={2} required />
        </FormField>
        <FormField label="Area" htmlFor="reseller-area">
          <Input id="reseller-area" name="shippingArea" />
        </FormField>
      </div>
      <FormField label="Delivery address" htmlFor="reseller-address" required>
        <Textarea id="reseller-address" name="shippingAddressLine" rows={2} required />
      </FormField>

      <div className="space-y-3 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900">Items</p>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter variants" className="w-48" />
            <button
              type="button"
              className="text-sm font-medium text-brand-600 hover:underline"
              onClick={() => setRows((current) => [...current, { key: current.length }])}
            >
              + Add line
            </button>
          </div>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <NativeSelect
              name="itemVariantId"
              value={lines[row.key] ?? ""}
              onChange={(event) => setLines((current) => ({ ...current, [row.key]: event.target.value }))}
            >
              <option value="">Select a variant…</option>
              {filtered.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label} — {((variant.pricePaisa ?? 0) / 100).toFixed(2)} BDT
                </option>
              ))}
            </NativeSelect>
            <Input name="itemQuantity" type="number" min={1} defaultValue={1} />
          </div>
        ))}
        <p className="text-xs text-slate-500">
          Approximate reseller price: {(subtotalPaisa / 100).toFixed(2)} BDT per unit selection. Delivery, COD and packaging rules for this reseller are
          applied server-side.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Collection amount from the customer (BDT)" htmlFor="reseller-collection" hint="Leave blank to collect the computed cost">
          <Input id="reseller-collection" name="collection" placeholder="0.00" />
        </FormField>
        <FormField label="Internal note" htmlFor="reseller-note">
          <Input id="reseller-note" name="internalNote" />
        </FormField>
      </div>

      <SubmitButton>Create reseller order</SubmitButton>
    </form>
  );
}

export function CollectionChangeForm({ orderId, currentPaisa }: { orderId: string; currentPaisa: number }) {
  const [state, formAction] = useActionState(recordCollectionChangeAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="New collection amount (BDT)" htmlFor={`collection-${orderId}`} hint={`Currently ${(currentPaisa / 100).toFixed(2)} BDT`}>
          <Input id={`collection-${orderId}`} name="amount" defaultValue={(currentPaisa / 100).toFixed(2)} required />
        </FormField>
        <FormField label="Reason" htmlFor={`collection-reason-${orderId}`}>
          <Input id={`collection-reason-${orderId}`} name="reason" />
        </FormField>
      </div>
      <SubmitButton size="sm" variant="outline">
        Record change
      </SubmitButton>
    </form>
  );
}

export function ResellerAdjustmentForm({ resellerId }: { resellerId: string }) {
  const [state, formAction] = useActionState(recordResellerAdjustmentAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="resellerId" value={resellerId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Direction" htmlFor={`adj-direction-${resellerId}`}>
          <NativeSelect id={`adj-direction-${resellerId}`} name="direction" defaultValue="CREDIT">
            <option value="CREDIT">Credit — business owes the reseller</option>
            <option value="DEBIT">Debit — reseller owes the business</option>
          </NativeSelect>
        </FormField>
        <FormField label="Amount (BDT)" htmlFor={`adj-amount-${resellerId}`} required>
          <Input id={`adj-amount-${resellerId}`} name="amount" required />
        </FormField>
        <FormField label="Description" htmlFor={`adj-description-${resellerId}`} required>
          <Input id={`adj-description-${resellerId}`} name="description" required />
        </FormField>
      </div>
      <SubmitButton size="sm" variant="outline">
        Record adjustment
      </SubmitButton>
    </form>
  );
}

export function RefreshEligibilityForm({ resellerId }: { resellerId?: string }) {
  const [state, formAction] = useActionState(refreshEligibilityAction, initialActionState);

  return (
    <form action={formAction} className="space-y-2">
      <Feedback state={state} />
      {resellerId ? <input type="hidden" name="resellerId" value={resellerId} /> : null}
      <SubmitButton size="sm" variant="outline">
        Refresh payable balances
      </SubmitButton>
    </form>
  );
}

export function PayoutForm({
  resellerId,
  entries,
  eligiblePaisa,
  minimumPayoutPaisa,
}: {
  resellerId: string;
  entries: Array<{ id: string; label: string; amountPaisa: number }>;
  eligiblePaisa: number;
  minimumPayoutPaisa: number;
}) {
  const [state, formAction] = useActionState(createPayoutAction, initialActionState);
  const [selected, setSelected] = useState<string[]>(entries.map((entry) => entry.id));

  const selectedPaisa = entries.filter((entry) => selected.includes(entry.id)).reduce((total, entry) => total + entry.amountPaisa, 0);

  return (
    <form action={formAction} className="space-y-3">
      <Feedback state={state} />
      <input type="hidden" name="resellerId" value={resellerId} />

      {entries.length === 0 ? (
        <Alert variant="info">
          Nothing is payable yet. Earnings become payable only after the courier COD settlement that carried the cash has been reconciled.
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="text-brand-600 hover:underline" onClick={() => setSelected(entries.map((entry) => entry.id))}>
              Select all
            </button>
            <button type="button" className="text-brand-600 hover:underline" onClick={() => setSelected([])}>
              Clear
            </button>
            <span className="text-slate-500">
              Selected {(selectedPaisa / 100).toFixed(2)} BDT of {(eligiblePaisa / 100).toFixed(2)} BDT eligible
            </span>
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {entries.map((entry) => (
              <label key={entry.id} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  name="ledgerEntryId"
                  value={entry.id}
                  checked={selected.includes(entry.id)}
                  onChange={(event) =>
                    setSelected((current) => (event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)))
                  }
                />
                <span className="flex-1">{entry.label}</span>
                <span className="tabular-nums">{(entry.amountPaisa / 100).toFixed(2)}</span>
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Method" htmlFor={`payout-method-${resellerId}`}>
              <NativeSelect id={`payout-method-${resellerId}`} name="method" defaultValue="BKASH">
                {PAYOUT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Account" htmlFor={`payout-account-${resellerId}`}>
              <Input id={`payout-account-${resellerId}`} name="accountNumber" />
            </FormField>
            <FormField label="Note" htmlFor={`payout-note-${resellerId}`}>
              <Input id={`payout-note-${resellerId}`} name="note" />
            </FormField>
          </div>

          {minimumPayoutPaisa > 0 ? (
            <p className="text-xs text-slate-500">Minimum payout for this reseller: {(minimumPayoutPaisa / 100).toFixed(2)} BDT.</p>
          ) : null}

          <SubmitButton>Create payout</SubmitButton>
        </>
      )}
    </form>
  );
}

export function PayoutDecisionForm({ payoutId, status }: { payoutId: string; status: string }) {
  const [approveState, approveAction] = useActionState(approvePayoutAction, initialActionState);
  const [paidState, paidAction] = useActionState(markPayoutPaidAction, initialActionState);
  const [cancelState, cancelAction] = useActionState(cancelPayoutAction, initialActionState);
  const [failState, failAction] = useActionState(failPayoutAction, initialActionState);

  if (status === "PAID" || status === "CANCELLED") {
    return (
      <Alert variant="info">
        This payout is {status.toLowerCase()}. Its ledger entries are final; corrections must be recorded as adjustments or reversals.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Feedback state={approveState} />
      <Feedback state={paidState} />
      <Feedback state={cancelState} />
      <Feedback state={failState} />

      {status !== "APPROVED" ? (
        <form action={approveAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="payoutId" value={payoutId} />
          <FormField label="Approval note" htmlFor={`approve-note-${payoutId}`}>
            <Input id={`approve-note-${payoutId}`} name="note" />
          </FormField>
          <SubmitButton>Approve payout</SubmitButton>
        </form>
      ) : null}

      <form action={paidAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <input type="hidden" name="payoutId" value={payoutId} />
        <FormField label="Transaction reference" htmlFor={`paid-ref-${payoutId}`} required hint="bKash TrxID, bank reference or cash voucher">
          <Input id={`paid-ref-${payoutId}`} name="transactionReference" required />
        </FormField>
        <FormField label="Paid at" htmlFor={`paid-at-${payoutId}`}>
          <Input id={`paid-at-${payoutId}`} name="paidAt" type="date" />
        </FormField>
        <SubmitButton>Mark as paid</SubmitButton>
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <form action={failAction} className="space-y-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="payoutId" value={payoutId} />
          <FormField label="Mark failed — reason" htmlFor={`fail-reason-${payoutId}`} required>
            <Input id={`fail-reason-${payoutId}`} name="reason" required />
          </FormField>
          <SubmitButton size="sm" variant="outline">
            Mark failed
          </SubmitButton>
        </form>
        <form action={cancelAction} className="space-y-2 border-t border-slate-100 pt-4">
          <input type="hidden" name="payoutId" value={payoutId} />
          <FormField label="Cancel — reason" htmlFor={`cancel-reason-${payoutId}`} required hint="Releases the ledger entries back to the payable pool">
            <Input id={`cancel-reason-${payoutId}`} name="reason" required />
          </FormField>
          <SubmitButton size="sm" variant="destructive">
            Cancel payout
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

export function ResellerBalanceSummary({
  pendingPaisa,
  eligiblePaisa,
  paidPaisa,
  allocatedPaisa = 0,
}: {
  pendingPaisa: number;
  eligiblePaisa: number;
  paidPaisa: number;
  /** Eligible but claimed by a payout that has not been paid yet. */
  allocatedPaisa?: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-medium text-amber-700">Awaiting settlement (not payable)</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-amber-900">{(pendingPaisa / 100).toFixed(2)} BDT</p>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-xs font-medium text-emerald-700">Payable now</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-900">{(eligiblePaisa / 100).toFixed(2)} BDT</p>
      </div>
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
        <p className="text-xs font-medium text-sky-700">Claimed by a pending payout</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-sky-900">{(allocatedPaisa / 100).toFixed(2)} BDT</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-600">Paid out</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{(paidPaisa / 100).toFixed(2)} BDT</p>
      </div>
    </div>
  );
}

export { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
