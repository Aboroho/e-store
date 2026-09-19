"use client";

import { useActionState } from "react";
import { Alert, Button, FormField, Input } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { initialActionState } from "@/modules/auth/actions";
import { configurePluginAction, installPluginAction, setPluginEnabledAction } from "@/modules/plugins/actions";

/** Plugin install / enable / configure controls. */

export function PluginInstallButton({ pluginKey, installed }: { pluginKey: string; installed: boolean }) {
  const [state, action] = useActionState(installPluginAction, initialActionState);

  return (
    <div className="space-y-1 text-right">
      {installed ? (
        <span className="text-xs text-slate-500">Installed</span>
      ) : (
        <form action={action}>
          <input type="hidden" name="key" value={pluginKey} />
          <SubmitButton variant="outline" size="sm" pendingLabel="Installing…">
            Install
          </SubmitButton>
        </form>
      )}
      {state.status === "error" ? <p className="text-xs text-rose-600">{state.message}</p> : null}
      {state.status === "success" ? <p className="text-xs text-emerald-600">{state.message}</p> : null}
    </div>
  );
}

export function PluginActions({
  pluginKey,
  installed,
  enabled,
  configFields,
  config,
  lastError,
}: {
  pluginKey: string;
  installed: boolean;
  enabled: boolean;
  configFields: string[];
  config: Record<string, unknown> | null;
  lastError: string | null;
}) {
  const [toggleState, toggleAction] = useActionState(setPluginEnabledAction, initialActionState);
  const [configState, configAction] = useActionState(configurePluginAction, initialActionState);

  if (!installed) return null;

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={toggleAction}>
          <input type="hidden" name="key" value={pluginKey} />
          <input type="hidden" name="isEnabled" value={enabled ? "false" : "true"} />
          <SubmitButton variant={enabled ? "outline" : "default"} size="sm" pendingLabel="…">
            {enabled ? "Disable" : "Enable"}
          </SubmitButton>
        </form>
        {toggleState.status === "error" ? <span className="text-xs text-rose-600">{toggleState.message}</span> : null}
        {toggleState.status === "success" ? <span className="text-xs text-emerald-600">{toggleState.message}</span> : null}
        {lastError ? <span className="text-xs text-rose-600">Last error: {lastError}</span> : null}
      </div>

      {configFields.length > 0 ? (
        <form action={configAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="key" value={pluginKey} />
          {configFields.map((field) => (
            <FormField key={field} label={field}>
              <Input name={field} defaultValue={config && typeof config[field] === "string" ? String(config[field]) : config && typeof config[field] === "number" ? String(config[field]) : ""} />
            </FormField>
          ))}
          <div className="sm:col-span-2">
            {configState.status === "error" ? <Alert variant="danger">{configState.message}</Alert> : null}
            {configState.status === "success" ? <Alert variant="success">{configState.message}</Alert> : null}
            <Button type="submit" variant="outline" size="sm" className="mt-2">
              Save configuration
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
