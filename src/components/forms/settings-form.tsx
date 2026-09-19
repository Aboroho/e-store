"use client";

import { MediaField } from "@/components/media/media-picker";
import { useActionState, useState } from "react";
import type { SettingGroup } from "@/modules/settings/service";
import { initialActionState } from "@/modules/auth/action-state";
import { updateBusinessProfileAction, updateBusinessSettingsAction, updateStorefrontSettingsAction } from "@/modules/settings/actions";
import { Alert, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, FormField, Input, NativeSelect, Textarea } from "@/components/ui/primitives";

function SettingControl({ definition }: { definition: SettingGroup["items"][number] }) {
  const id = `setting-${definition.key}`;
  const value = definition.value;

  if (typeof definition.defaultValue === "boolean") {
    return (
      <label htmlFor={id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
        <span>
          <span className="block text-sm font-medium text-slate-800">{definition.label}</span>
          <span className="block text-xs text-slate-500">{definition.description}</span>
        </span>
        <input
          id={id}
          name={definition.key}
          type="checkbox"
          value="true"
          defaultChecked={Boolean(value)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
        />
      </label>
    );
  }

  if (definition.key === "inventory.valuation_method") {
    return (
      <FormField label={definition.label} htmlFor={id} hint={definition.description}>
        <NativeSelect id={id} name={definition.key} defaultValue={String(value)}>
          <option value="WEIGHTED_AVERAGE">Weighted average</option>
          <option value="FIFO">FIFO (first in, first out)</option>
        </NativeSelect>
      </FormField>
    );
  }

  if (definition.key === "reseller.default_commission_type") {
    return (
      <FormField label={definition.label} htmlFor={id} hint={definition.description}>
        <NativeSelect id={id} name={definition.key} defaultValue={String(value)}>
          <option value="MARGIN_BASED">Margin based</option>
          <option value="COMMISSION_BASED">Commission based</option>
        </NativeSelect>
      </FormField>
    );
  }

  if (definition.key === "storefront.announcement") {
    return (
      <FormField label={definition.label} htmlFor={id} hint={definition.description}>
        <Textarea id={id} name={definition.key} rows={2} defaultValue={String(value ?? "")} />
      </FormField>
    );
  }

  return (
    <FormField
      label={definition.label}
      htmlFor={id}
      hint={definition.description}
      className={definition.key.endsWith("_color") ? undefined : "sm:col-span-2"}
    >
      <Input
        id={id}
        name={definition.key}
        type={typeof definition.defaultValue === "number" ? "number" : "text"}
        defaultValue={String(value ?? "")}
        min={typeof definition.defaultValue === "number" ? 0 : undefined}
      />
    </FormField>
  );
}

export function BusinessSettingsForm({ groups, booleanKeys }: { groups: SettingGroup[]; booleanKeys: string }) {
  const [state, formAction, pending] = useActionState(updateBusinessSettingsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="__booleanKeys" value={booleanKeys} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}

      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader>
            <CardTitle>{group.group}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {group.items.map((definition) => (
              <SettingControl key={definition.key} definition={definition} />
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="sticky bottom-4 flex justify-end">
        <Button type="submit" disabled={pending} className="shadow-lg">
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function StorefrontSettingsForm({
  storefrontId,
  groups,
  booleanKeys,
}: {
  storefrontId: string;
  groups: SettingGroup[];
  booleanKeys: string;
}) {
  const [state, formAction, pending] = useActionState(updateStorefrontSettingsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="storefrontId" value={storefrontId} />
      <input type="hidden" name="__booleanKeys" value={booleanKeys} />
      {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}

      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader>
            <CardTitle>{group.group}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {group.items.map((definition) => (
              <SettingControl key={definition.key} definition={definition} />
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save storefront settings"}
        </Button>
      </div>
    </form>
  );
}

export function BusinessProfileForm({
  business,
}: {
  business: { logoMediaId?: string | null; name: string; legalName: string | null; phone: string | null; email: string | null; address: string | null; currency: string };
}) {
  const [logo, setLogo] = useState<string | null>(business.logoMediaId ?? null);
  const [state, formAction, pending] = useActionState(updateBusinessProfileAction, initialActionState);

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <MediaField name="logoMediaId" value={logo} onChange={setLogo} label="Brand logo" />
            <FormField label="Trading name" htmlFor="business-name" required>
              <Input id="business-name" name="name" defaultValue={business.name} required />
            </FormField>
            <FormField label="Legal name" htmlFor="business-legalName">
              <Input id="business-legalName" name="legalName" defaultValue={business.legalName ?? ""} />
            </FormField>
            <FormField label="Phone" htmlFor="business-phone">
              <Input id="business-phone" name="phone" defaultValue={business.phone ?? ""} />
            </FormField>
            <FormField label="Email" htmlFor="business-email">
              <Input id="business-email" name="email" type="email" defaultValue={business.email ?? ""} />
            </FormField>
            <FormField label="Address" htmlFor="business-address" className="sm:col-span-2">
              <Textarea id="business-address" name="address" rows={2} defaultValue={business.address ?? ""} />
            </FormField>
            <FormField label="Currency" htmlFor="business-currency" hint="Three letter ISO 4217 code. Amounts are stored in minor units.">
              <Input id="business-currency" name="currency" maxLength={3} defaultValue={business.currency} />
            </FormField>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
