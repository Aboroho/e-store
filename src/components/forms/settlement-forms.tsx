"use client";

import { useState } from "react";
import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/actions";
import { importSettlementAction, reconcileSettlementAction, resolveSettlementEntryAction } from "@/modules/settlements/actions";
import { Alert, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

const SAMPLE = `tracking_code,order_number,gross,courier_fee,cod_fee,other_deduction
EST-000001,ORD-000001,1250.00,60.00,12.50,0.00`;

/**
 * Courier statement import.
 *
 * The CSV is pasted or chosen from disk and posted as text — the server parses it
 * and matches every row against real shipments, so nothing here is trusted.
 */
export function SettlementImportForm({ providers }: { providers: Array<{ code: string; name: string }> }) {
  const [state, formAction] = useActionState(importSettlementAction, initialActionState);
  const [csv, setCsv] = useState("");

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Courier" htmlFor="settlement-provider" required>
          <NativeSelect id="settlement-provider" name="providerCode" defaultValue={providers[0]?.code ?? "MANUAL"} required>
            {providers.map((provider) => (
              <option key={provider.code} value={provider.code}>
                {provider.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Statement reference" htmlFor="settlement-reference" required hint="Unique per courier — re-importing the same reference is refused">
          <Input id="settlement-reference" name="reference" required />
        </FormField>
        <FormField label="Period start" htmlFor="settlement-period-start">
          <Input id="settlement-period-start" name="periodStart" type="date" />
        </FormField>
        <FormField label="Period end" htmlFor="settlement-period-end">
          <Input id="settlement-period-end" name="periodEnd" type="date" />
        </FormField>
        <FormField label="Settlement date" htmlFor="settlement-date">
          <Input id="settlement-date" name="settlementDate" type="date" />
        </FormField>
        <FormField label="Bank reference" htmlFor="settlement-bank">
          <Input id="settlement-bank" name="bankReference" />
        </FormField>
      </div>

      <FormField label="Statement CSV" htmlFor="settlement-csv" required hint="Columns: tracking_code or order_number, gross, courier_fee, cod_fee, other_deduction">
        <Textarea
          id="settlement-csv"
          name="csv"
          rows={8}
          required
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={SAMPLE}
          className="font-mono text-xs"
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-xs"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setCsv(await file.text());
          }}
        />
        <input type="hidden" name="sourceFileName" value="uploaded.csv" />
      </div>

      <SubmitButton>Import statement</SubmitButton>
    </form>
  );
}

export function SettlementEntryResolveForm({ entryId, settlementId }: { entryId: string; settlementId: string }) {
  const [state, formAction] = useActionState(resolveSettlementEntryAction, initialActionState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="settlementId" value={settlementId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      <div className="w-56">
        <FormField label="Match shipment" htmlFor={`shipment-${entryId}`}>
          <Input id={`shipment-${entryId}`} name="shipmentId" placeholder="Shipment id" />
        </FormField>
      </div>
      <div className="w-48">
        <FormField label="Note" htmlFor={`note-${entryId}`}>
          <Input id={`note-${entryId}`} name="note" />
        </FormField>
      </div>
      <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
        <input type="checkbox" name="ignore" className="h-4 w-4 rounded border-slate-300" /> Ignore row
      </label>
      <SubmitButton variant="outline">Save</SubmitButton>
    </form>
  );
}

export function SettlementReconcileForm({ settlementId }: { settlementId: string }) {
  const [state, formAction] = useActionState(reconcileSettlementAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="settlementId" value={settlementId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <p className="text-xs text-slate-500">
        Reconciling marks every matched shipment as collected, records the courier charges it deducted and flags rows whose amount does not
        match the shipment. It is idempotent — running it twice changes nothing.
      </p>
      <SubmitButton>Reconcile settlement</SubmitButton>
    </form>
  );
}
