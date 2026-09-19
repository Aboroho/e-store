"use client";

import { useActionState } from "react";
import { Alert, Badge, Button, FormField, Input, NativeSelect } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { initialActionState } from "@/modules/auth/action-state";
import { deleteMarketingIntegrationAction, retryMarketingEventsAction, saveMarketingIntegrationAction, toggleMarketingIntegrationAction } from "@/modules/marketing/actions";
import { MARKETING_PROVIDERS } from "@/modules/marketing/providers";

export interface IntegrationFormValues {
  id: string;
  name: string;
  isEnabled: boolean;
  consentRequired: boolean;
  testEventCode: string | null;
  publicConfig: Record<string, string>;
  secretKeys: string[];
}

/** One card per registered provider: configure, enable, delete. */
export function MarketingIntegrationForm({
  providerKey,
  storefronts,
  integration,
}: {
  providerKey: string;
  storefronts: Array<{ id: string; name: string }>;
  integration: IntegrationFormValues | null;
}) {
  const [state, action] = useActionState(saveMarketingIntegrationAction, initialActionState);
  const [toggleState, toggleAction] = useActionState(toggleMarketingIntegrationAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deleteMarketingIntegrationAction, initialActionState);
  const [retryState, retryAction] = useActionState(retryMarketingEventsAction, initialActionState);

  const provider = MARKETING_PROVIDERS.find((entry) => entry.key === providerKey);
  if (!provider) return null;

  return (
    <div className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <form action={action} className="space-y-3">
        <input type="hidden" name="provider" value={provider.key} />
        {integration ? <input type="hidden" name="id" value={integration.id} /> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name">
            <Input name="name" defaultValue={integration?.name ?? provider.label} required />
          </FormField>
          <FormField label="Applies to" hint="Leave as “all storefronts” for a single-shop setup.">
            <NativeSelect name="storefrontId" defaultValue="">
              <option value="">All storefronts</option>
              {storefronts.map((storefront) => (
                <option key={storefront.id} value={storefront.id}>
                  {storefront.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {provider.fields.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              hint={
                field.secret
                  ? integration?.secretKeys.includes(field.key)
                    ? "A value is stored (encrypted). Type a new one only to replace it."
                    : "Encrypted at rest, never sent to the browser."
                  : undefined
              }
            >
              <Input
                name={field.key}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={field.secret && integration?.secretKeys.includes(field.key) ? "•••••• stored" : field.placeholder}
                defaultValue={field.secret ? "" : integration?.publicConfig[field.key] ?? ""}
              />
            </FormField>
          ))}
          {provider.delivery === "server" ? (
            <FormField label="Test event code" hint="Optional. Meta shows test events in the Events Manager.">
              <Input name="testEventCode" defaultValue={integration?.testEventCode ?? ""} />
            </FormField>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isEnabled" value="true" defaultChecked={integration?.isEnabled ?? false} />
            Enabled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="consentRequired" value="true" defaultChecked={integration?.consentRequired ?? true} />
            Require visitor consent before measuring
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="trackPurchase" value="on" defaultChecked />
            Purchases
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="trackAddToCart" value="on" defaultChecked />
            Add to cart
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="trackInitiateCheckout" value="on" defaultChecked />
            Checkout starts
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="trackProductView" value="on" defaultChecked />
            Product views
          </label>
        </div>

        {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
        {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
        <SubmitButton pendingLabel="Saving…">{integration ? "Save changes" : "Connect"}</SubmitButton>
      </form>

      {integration ? (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <form action={toggleAction}>
            <input type="hidden" name="integrationId" value={integration.id} />
            <input type="hidden" name="isEnabled" value={integration.isEnabled ? "false" : "true"} />
            <Button type="submit" variant="outline" size="sm">
              {integration.isEnabled ? "Disable" : "Enable"}
            </Button>
          </form>
          <form action={retryAction}>
            <input type="hidden" name="integrationId" value={integration.id} />
            <Button type="submit" variant="outline" size="sm">
              Retry failed events
            </Button>
          </form>
          <form action={deleteAction}>
            <input type="hidden" name="integrationId" value={integration.id} />
            <Button type="submit" variant="destructive" size="sm">
              Delete
            </Button>
          </form>
          <Badge variant={integration.isEnabled ? "success" : "neutral"}>{integration.isEnabled ? "enabled" : "disabled"}</Badge>
          {toggleState.status === "success" ? <span className="text-xs text-emerald-600">{toggleState.message}</span> : null}
          {toggleState.status === "error" ? <span className="text-xs text-rose-600">{toggleState.message}</span> : null}
          {deleteState.status === "success" ? <span className="text-xs text-emerald-600">{deleteState.message}</span> : null}
          {deleteState.status === "error" ? <span className="text-xs text-rose-600">{deleteState.message}</span> : null}
          {retryState.status === "success" ? <span className="text-xs text-emerald-600">{retryState.message}</span> : null}
          {retryState.status === "error" ? <span className="text-xs text-rose-600">{retryState.message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
