"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, NativeSelect } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/interactive";
import { loadCheckoutFieldsAction, saveCheckoutFieldAction } from "@/modules/orders/manual-actions";
import type { ResolvedCheckoutField } from "@/modules/orders/checkout-fields";
import { ORDER_TYPE_LABELS, type OrderTypeValue } from "@/modules/orders/status";

/**
 * Checkout field editor (Orders → Checkout fields).
 *
 * One row per customer-facing field: enabled, required, label, help text and
 * order. The same configuration drives the manual order screen and the public
 * checkout, and required-ness is per order type — an in-store sale never forces
 * customer details, which is why the order types each field applies to are shown
 * next to it.
 */

export function CheckoutFieldsEditor({
  fields,
  storefronts,
  mayManage,
}: {
  fields: ResolvedCheckoutField[];
  storefronts: Array<{ id: string; name: string }>;
  mayManage: boolean;
}) {
  const router = useRouter();
  const [storefrontId, setStorefrontId] = React.useState<string>("");
  const [rows, setRows] = React.useState<ResolvedCheckoutField[]>(fields);
  const [loading, setLoading] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState<string | null>(null);

  const loadFor = async (nextStorefrontId: string) => {
    setLoading(true);
    try {
      const loaded = await loadCheckoutFieldsAction(nextStorefrontId || null);
      setRows(loaded);
    } catch {
      toast.error("The checkout fields could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  const update = (key: string, patch: Partial<ResolvedCheckoutField>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const save = async (row: ResolvedCheckoutField) => {
    setSavingKey(row.key);
    try {
      const result = await saveCheckoutFieldAction({
        fieldKey: row.key,
        label: row.customLabel ?? row.label,
        isEnabled: row.isEnabled,
        isRequired: row.isRequired,
        position: row.position,
        helpText: row.customHelpText ?? row.helpText,
        storefrontId: storefrontId || null,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRows(result.fields);
      toast.success(result.message);
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  };

  const reset = async (row: ResolvedCheckoutField) => {
    setSavingKey(row.key);
    try {
      const result = await saveCheckoutFieldAction({
        fieldKey: row.key,
        label: row.label,
        isEnabled: row.defaultEnabled,
        isRequired: row.defaultRequiredForDelivery,
        position: row.position,
        helpText: "",
        storefrontId: storefrontId || null,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRows(result.fields);
      toast.success(`${row.label} reset to the platform default`);
      router.refresh();
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which configuration are you editing?</CardTitle>
          <CardDescription>
            A storefront-specific row wins over the business-wide row for that storefront. Leave it on “Business default”
            to change what every screen uses unless a storefront overrides it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Storefront</span>
            <NativeSelect
              value={storefrontId}
              disabled={!mayManage || loading}
              onChange={(event) => {
                const next = event.target.value;
                setStorefrontId(next);
                void loadFor(next);
              }}
              className="min-w-56"
            >
              <option value="">Business default</option>
              {storefronts.map((storefront) => (
                <option key={storefront.id} value={storefront.id}>
                  {storefront.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          {loading ? (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </span>
          ) : null}
          {!mayManage ? (
            <span className="text-xs text-slate-500">
              You can see the configuration; changing it needs the “Manage checkout fields” permission.
            </span>
          ) : null}
        </CardContent>
      </Card>

      <ul className="space-y-3">
        {rows.map((row) => {
          const dirty =
            row.customLabel !== null ||
            row.customHelpText !== null ||
            row.isEnabled !== row.defaultEnabled ||
            row.isRequired !== row.defaultRequiredForDelivery;
          return (
            <li key={row.key}>
              <Card className={cn(row.isRequired && row.isEnabled && "border-brand-200")}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {row.label}
                      <span className="ml-2 text-xs font-normal text-slate-400">{row.key}</span>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.appliesTo.map((type) => (
                        <Badge key={type} variant="neutral">
                          {ORDER_TYPE_LABELS[type as OrderTypeValue] ?? type}
                        </Badge>
                      ))}
                      {row.storefrontId ? <Badge variant="info">Storefront override</Badge> : null}
                    </div>
                  </div>
                  <CardDescription>{row.helpText}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                      <span className="text-sm text-slate-700">
                        Enabled
                        <span className="ml-1 text-xs text-slate-400">ask for this field at all</span>
                      </span>
                      <Switch
                        checked={row.isEnabled}
                        disabled={!mayManage || savingKey === row.key}
                        onCheckedChange={(checked) => update(row.key, { isEnabled: checked, isRequired: checked ? row.isRequired : false })}
                      />
                    </label>
                    <label
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                        row.isEnabled ? "border-slate-200" : "border-slate-100 bg-slate-50 opacity-60",
                      )}
                    >
                      <span className="text-sm text-slate-700">
                        Required
                        <span className="ml-1 text-xs text-slate-400">order cannot be saved without it</span>
                      </span>
                      <Switch
                        checked={row.isRequired}
                        disabled={!mayManage || !row.isEnabled || savingKey === row.key}
                        onCheckedChange={(checked) => update(row.key, { isRequired: checked })}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Label</span>
                      <Input
                        value={row.customLabel ?? row.label}
                        maxLength={80}
                        disabled={!mayManage}
                        onChange={(event) =>
                          update(row.key, { customLabel: event.target.value === row.label ? null : event.target.value })
                        }
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Help text</span>
                      <Input
                        value={row.customHelpText ?? row.helpText}
                        maxLength={200}
                        disabled={!mayManage}
                        onChange={(event) =>
                          update(row.key, { customHelpText: event.target.value === row.helpText ? null : event.target.value })
                        }
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">Order</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={row.position}
                        disabled={!mayManage}
                        onChange={(event) => update(row.key, { position: Number(event.target.value) || 0 })}
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <Info className="h-3.5 w-3.5" />
                      {row.key === "district" || row.key === "address"
                        ? "In-store orders never require this field, whatever is set here."
                        : "Applies to the manual order screen and the public checkout."}
                    </p>
                    {mayManage ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={savingKey === row.key || !dirty}
                          onClick={() => void reset(row)}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" /> Reset
                        </Button>
                        <Button type="button" size="sm" disabled={savingKey === row.key} onClick={() => void save(row)}>
                          {savingKey === row.key ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-4 w-4" />
                          )}
                          Save field
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
