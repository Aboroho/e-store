"use client";

import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import {
  deleteCourierCredentialAction,
  saveCourierCredentialAction,
  saveCourierProviderAction,
  savePaymentCredentialAction,
  savePaymentIntegrationAction,
  testCourierConnectionAction,
} from "@/modules/couriers/actions";
import { Alert, Badge, Button, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";

export interface CourierProviderDefaults {
  id: string;
  code: string;
  isEnabled: boolean;
  testMode: boolean;
  pickupName: string | null;
  pickupPhone: string | null;
  pickupAddress: string | null;
  pickupCity: string | null;
  pickupArea: string | null;
  defaultWeightGrams: number;
  codEnabled: boolean;
  priority: number;
}

export function CourierProviderForm({ provider }: { provider: CourierProviderDefaults }) {
  const [state, formAction] = useActionState(saveCourierProviderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3 border-t border-slate-100 pt-4">
      <input type="hidden" name="providerId" value={provider.id} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Pickup contact" htmlFor={`pickup-name-${provider.id}`}>
          <Input id={`pickup-name-${provider.id}`} name="pickupName" defaultValue={provider.pickupName ?? ""} />
        </FormField>
        <FormField label="Pickup phone" htmlFor={`pickup-phone-${provider.id}`}>
          <Input id={`pickup-phone-${provider.id}`} name="pickupPhone" defaultValue={provider.pickupPhone ?? ""} />
        </FormField>
        <FormField label="Pickup city" htmlFor={`pickup-city-${provider.id}`}>
          <Input id={`pickup-city-${provider.id}`} name="pickupCity" defaultValue={provider.pickupCity ?? ""} />
        </FormField>
        <FormField label="Pickup area" htmlFor={`pickup-area-${provider.id}`}>
          <Input id={`pickup-area-${provider.id}`} name="pickupArea" defaultValue={provider.pickupArea ?? ""} />
        </FormField>
        <FormField label="Default weight (g)" htmlFor={`weight-${provider.id}`}>
          <Input id={`weight-${provider.id}`} name="defaultWeightGrams" type="number" min={100} max={30000} defaultValue={provider.defaultWeightGrams} />
        </FormField>
        <FormField label="Priority" htmlFor={`priority-${provider.id}`} hint="Higher wins when a courier is picked automatically">
          <Input id={`priority-${provider.id}`} name="priority" type="number" min={0} max={100} defaultValue={provider.priority} />
        </FormField>
      </div>
      <FormField label="Pickup address" htmlFor={`pickup-address-${provider.id}`}>
        <Input id={`pickup-address-${provider.id}`} name="pickupAddress" defaultValue={provider.pickupAddress ?? ""} />
      </FormField>
      <FormField
        label="Provider config (JSON)"
        htmlFor={`config-${provider.id}`}
        hint="Provider specific ids, e.g. Pathao store id, CarryBee store/city/zone/area ids"
      >
        <Textarea id={`config-${provider.id}`} name="config" rows={2} placeholder='{"store_id": 12345}' className="font-mono text-xs" />
      </FormField>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isEnabled" defaultChecked={provider.isEnabled} className="h-4 w-4 rounded border-slate-300" /> Enabled
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="testMode" defaultChecked={provider.testMode} className="h-4 w-4 rounded border-slate-300" /> Sandbox
        </label>
      </div>

      <SubmitButton variant="outline">Save provider</SubmitButton>
    </form>
  );
}

export function CourierCredentialForm({
  providerId,
  providerName,
  credentialKeys,
  presentKeys,
}: {
  providerId: string;
  providerName: string;
  credentialKeys: string[];
  presentKeys: string[];
}) {
  const [saveState, saveAction] = useActionState(saveCourierCredentialAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deleteCourierCredentialAction, initialActionState);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Credentials</span>
        {credentialKeys.map((key) => (
          <Badge key={key} variant={presentKeys.includes(key) ? "success" : "warning"}>
            {key}
            {presentKeys.includes(key) ? "" : " missing"}
          </Badge>
        ))}
      </div>

      <form action={saveAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="providerId" value={providerId} />
        {saveState.status === "error" && saveState.message ? <Alert variant="danger">{saveState.message}</Alert> : null}
        {saveState.status === "success" && saveState.message ? <Alert variant="success">{saveState.message}</Alert> : null}
        <div className="w-44">
          <FormField label="Key" htmlFor={`key-${providerId}`}>
            <NativeSelect id={`key-${providerId}`} name="key" defaultValue={credentialKeys[0] ?? ""}>
              {credentialKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <div className="min-w-[200px] flex-1">
          <FormField label="Value" htmlFor={`value-${providerId}`} hint="Encrypted at rest; never shown again">
            <Input id={`value-${providerId}`} name="value" type="password" autoComplete="off" />
          </FormField>
        </div>
        <SubmitButton variant="outline">Save credential</SubmitButton>
      </form>

      {presentKeys.length > 0 ? (
        <form action={deleteAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="providerId" value={providerId} />
          {deleteState.status === "error" && deleteState.message ? <Alert variant="danger">{deleteState.message}</Alert> : null}
          {deleteState.status === "success" && deleteState.message ? <Alert variant="success">{deleteState.message}</Alert> : null}
          <div className="w-44">
            <FormField label={`Remove from ${providerName}`} htmlFor={`remove-${providerId}`}>
              <NativeSelect id={`remove-${providerId}`} name="key" defaultValue={presentKeys[0]}>
                {presentKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <Button type="submit" variant="ghost" size="sm">
            Remove credential
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function CourierTestConnectionForm({ providerId }: { providerId: string }) {
  const [state, formAction] = useActionState(testCourierConnectionAction, initialActionState);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="providerId" value={providerId} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <SubmitButton variant="ghost">Test credentials</SubmitButton>
    </form>
  );
}

export function PaymentIntegrationForm() {
  const [state, formAction] = useActionState(savePaymentIntegrationAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-slate-200 p-4">
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Provider" htmlFor="payment-provider">
          <NativeSelect id="payment-provider" name="provider" defaultValue="bkash">
            <option value="bkash">bKash</option>
            <option value="sslcommerz">SSLCommerz</option>
          </NativeSelect>
        </FormField>
        <FormField label="Config (JSON)" htmlFor="payment-config" hint='e.g. {"base_url":"https://tokenized.sandbox.bka.sh/v1.2.0-beta"}'>
          <Input id="payment-config" name="config" className="font-mono text-xs" />
        </FormField>
        <div className="flex flex-wrap items-center gap-4 pt-6">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isEnabled" className="h-4 w-4 rounded border-slate-300" /> Enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="testMode" defaultChecked className="h-4 w-4 rounded border-slate-300" /> Sandbox
          </label>
        </div>
      </div>
      <SubmitButton variant="outline">Save gateway</SubmitButton>
    </form>
  );
}

export function PaymentCredentialForm({ provider, presentKeys }: { provider: string; presentKeys: string[] }) {
  const [state, formAction] = useActionState(savePaymentCredentialAction, initialActionState);
  const keys = provider === "bkash" ? ["app_key", "app_secret", "username", "password"] : ["store_id", "store_password"];

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="provider" value={provider} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.message ? <Alert variant="success">{state.message}</Alert> : null}
      <div className="w-44">
        <FormField label="Key" htmlFor={`payment-key-${provider}`}>
          <NativeSelect id={`payment-key-${provider}`} name="key" defaultValue={keys[0]}>
            {keys.map((key) => (
              <option key={key} value={key}>
                {key}
                {presentKeys.includes(key) ? " ✓" : ""}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>
      <div className="min-w-[200px] flex-1">
        <FormField label="Value" htmlFor={`payment-value-${provider}`} hint="Encrypted at rest">
          <Input id={`payment-value-${provider}`} name="value" type="password" autoComplete="off" />
        </FormField>
      </div>
      <SubmitButton variant="outline">Save credential</SubmitButton>
    </form>
  );
}
