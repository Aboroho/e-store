"use client";

import { useActionState } from "react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { CopyButton, Dialog, DialogContent, DialogTrigger, SubmitButton } from "@/components/ui/interactive";
import { initialActionState } from "@/modules/auth/actions";
import { createApiKeyAction, createWebhookAction, deleteWebhookAction, revokeApiKeyAction, rotateApiKeyAction, rotateWebhookSecretAction, sendTestWebhookAction, updateWebhookAction } from "@/modules/api-keys/actions";
import { SCOPES, WEBHOOK_EVENTS } from "@/modules/api-keys/scopes";

interface ApiKeyRow {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  keyPreview: string;
  status: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  allowedIpAddresses: string[];
  requestCount: number;
}

/** The plaintext secret: shown once, copyable, never stored again. */
function SecretReveal({ secret, message }: { secret: string; message?: string }) {
  return (
    <Alert variant="success" className="space-y-2">
      <p className="font-medium">{message ?? "Copy the secret now — it will not be shown again."}</p>
      <div className="flex items-center gap-2">
        <code className="block flex-1 overflow-x-auto rounded bg-white/70 px-2 py-1 font-mono text-xs">{secret}</code>
        <CopyButton value={secret} />
      </div>
    </Alert>
  );
}

export function ApiKeyCreateForm() {
  const [state, action] = useActionState(createApiKeyAction, initialActionState);
  const groups = [...new Set(SCOPES.map((scope) => scope.group))];

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" hint="Shown in the audit log and on every request log row.">
          <Input name="name" required minLength={3} maxLength={80} placeholder="e.g. Courier integrator" />
        </FormField>
        <FormField label="Description">
          <Input name="description" maxLength={300} placeholder="Who uses this key and why" />
        </FormField>
        <FormField label="Expires on" hint="Leave empty for a key without an expiry date.">
          <Input type="date" name="expiresAt" />
        </FormField>
        <FormField label="Requests per minute">
          <Input type="number" name="rateLimitPerMinute" min={10} max={6000} defaultValue={120} />
        </FormField>
      </div>

      <div className="space-y-3">
        <Label>Scopes</Label>
        {groups.map((group) => (
          <fieldset key={group} className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">{group}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPES.filter((scope) => scope.group === group).map((scope) => {
                const disabled = group === "Customers" && !scope.key.endsWith(":read") ? true : false;
                return (
                  <label key={scope.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="scopes" value={scope.key} defaultChecked={scope.key === "orders:read"} disabled={disabled} className="mt-1" />
                    <span>
                      <span className="font-medium">{scope.label}</span>
                      <span className="block text-xs text-slate-500">{scope.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <FormField label="IP allowlist" hint="Optional. One address or CIDR-free IP per line; empty means any address.">
        <Textarea name="allowedIpAddresses" rows={2} placeholder="203.0.113.10" />
      </FormField>

      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" && state.data?.secret ? <SecretReveal secret={state.data.secret} message={state.message} /> : null}
      {state.status === "success" && !state.data?.secret ? <Alert variant="success">{state.message}</Alert> : null}

      <SubmitButton pendingLabel="Creating…">Create API key</SubmitButton>
    </form>
  );
}

export function ApiKeyActions({ apiKey }: { apiKey: ApiKeyRow }) {
  const [revokeState, revokeAction] = useActionState(revokeApiKeyAction, initialActionState);
  const [rotateState, rotateAction] = useActionState(rotateApiKeyAction, initialActionState);

  if (apiKey.status === "REVOKED") {
    return <span className="text-xs text-slate-500">Revoked</span>;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              Rotate
            </Button>
          </DialogTrigger>
          <DialogContent title="Rotate this key" description="A new secret is issued immediately. Keep the old key for a short grace period if you need a zero-downtime rollover.">
            <form action={rotateAction} className="space-y-3">
              <input type="hidden" name="apiKeyId" value={apiKey.id} />
              <FormField label="Grace period (seconds)" hint="0 revokes the old key right away.">
                <Input type="number" name="gracePeriodSeconds" min={0} max={86400} defaultValue={0} />
              </FormField>
              {rotateState.status === "error" ? <Alert variant="danger">{rotateState.message}</Alert> : null}
              {rotateState.status === "success" && rotateState.data?.secret ? <SecretReveal secret={rotateState.data.secret} message={rotateState.message} /> : null}
              <SubmitButton pendingLabel="Rotating…">Rotate key</SubmitButton>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              Revoke
            </Button>
          </DialogTrigger>
          <DialogContent title="Revoke this key" description="Requests using this key start failing immediately. This cannot be undone.">
            <form action={revokeAction} className="space-y-3">
              <input type="hidden" name="apiKeyId" value={apiKey.id} />
              <FormField label="Reason">
                <Input name="reason" required minLength={3} maxLength={300} placeholder="Rotated for a new server" />
              </FormField>
              {revokeState.status === "error" ? <Alert variant="danger">{revokeState.message}</Alert> : null}
              <SubmitButton variant="destructive" pendingLabel="Revoking…">
                Revoke key
              </SubmitButton>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {revokeState.status === "success" ? <p className="text-xs text-emerald-600">{revokeState.message}</p> : null}
    </div>
  );
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  deliveryCount: number;
}

export function WebhookCreateForm({ apiKeys }: { apiKeys: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(createWebhookAction, initialActionState);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name">
          <Input name="name" required minLength={3} maxLength={80} placeholder="e.g. Warehouse sync" />
        </FormField>
        <FormField label="Endpoint URL" hint="https in production. Retries with exponential backoff for up to 6 attempts.">
          <Input name="url" required type="url" placeholder="https://example.com/webhooks/estore" />
        </FormField>
        <FormField label="Bound API key" hint="Optional — only used to group deliveries in the log.">
          <NativeSelect name="apiKeyId" defaultValue="">
            <option value="">None</option>
            {apiKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">Events</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WEBHOOK_EVENTS.map((event) => (
            <label key={event} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={event} defaultChecked={event === "order.created"} />
              <span className="font-mono text-xs">{event}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <SecretReveal secret={state.data?.secret ?? ""} message={state.message} /> : null}

      <SubmitButton pendingLabel="Creating…">Create webhook</SubmitButton>
    </form>
  );
}

export function WebhookActions({ webhook }: { webhook: WebhookRow }) {
  const [updateState, updateAction] = useActionState(updateWebhookAction, initialActionState);
  const [rotateState, rotateAction] = useActionState(rotateWebhookSecretAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deleteWebhookAction, initialActionState);
  const [testState, testAction] = useActionState(sendTestWebhookAction, initialActionState);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={updateAction}>
          <input type="hidden" name="webhookId" value={webhook.id} />
          <input type="hidden" name="action" value={webhook.isActive ? "disable" : "enable"} />
          <SubmitButton variant="outline" size="sm" pendingLabel="…">
            {webhook.isActive ? "Disable" : "Enable"}
          </SubmitButton>
        </form>
        <form action={testAction}>
          <input type="hidden" name="webhookId" value={webhook.id} />
          <SubmitButton variant="outline" size="sm" pendingLabel="…">
            Send test
          </SubmitButton>
        </form>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              Rotate secret
            </Button>
          </DialogTrigger>
          <DialogContent title="Rotate the signing secret" description="Every future delivery is signed with the new secret. Update your verifier at the same time.">
            <form action={rotateAction} className="space-y-3">
              <input type="hidden" name="webhookId" value={webhook.id} />
              {rotateState.status === "error" ? <Alert variant="danger">{rotateState.message}</Alert> : null}
              {rotateState.status === "success" ? <SecretReveal secret={rotateState.data?.secret ?? ""} message={rotateState.message} /> : null}
              <SubmitButton pendingLabel="Rotating…">Rotate secret</SubmitButton>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" type="button">
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent title="Delete this webhook" description="Deliveries stop and the delivery history is removed. This cannot be undone.">
            <form action={deleteAction} className="space-y-3">
              <input type="hidden" name="webhookId" value={webhook.id} />
              {deleteState.status === "error" ? <Alert variant="danger">{deleteState.message}</Alert> : null}
              <SubmitButton variant="destructive" pendingLabel="Deleting…">
                Delete webhook
              </SubmitButton>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {testState.status === "success" ? <p className="text-xs text-emerald-600">{testState.message}</p> : null}
      {testState.status === "error" ? <p className="text-xs text-rose-600">{testState.message}</p> : null}
      {updateState.status === "success" ? <p className="text-xs text-emerald-600">{updateState.message}</p> : null}
    </div>
  );
}

export function DeliveryStatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCESS" ? "success" : status === "DEAD" ? "danger" : status === "FAILED" ? "warning" : ("neutral" as const);
  return <Badge variant={variant}>{status.toLowerCase()}</Badge>;
}

export function ApiKeysCardTitle({ count }: { count: number }) {
  return <CardTitle className="text-base">{count} active key{count === 1 ? "" : "s"}</CardTitle>;
}

export function CardShell({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-slate-500">{description}</p> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
