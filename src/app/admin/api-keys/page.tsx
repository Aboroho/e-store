import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { ApiKeyActions, ApiKeyCreateForm, CardShell, DeliveryStatusBadge, WebhookActions, WebhookCreateForm } from "@/components/forms/api-key-forms";
import { listApiKeys, listDeliveries, listWebhooks } from "@/modules/api-keys/service";
import { SCOPE_KEYS, WEBHOOK_EVENTS } from "@/modules/api-keys/scopes";
import { formatDateTime } from "@/lib/utils";
import { formatPaisa } from "@/lib/money";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const session = await requireSession();
  assertPermission(session, "api_key.manage");

  const [keys, webhooks, deliveries, requestCounts, lastRequest] = await Promise.all([
    listApiKeys(session.businessId),
    listWebhooks(session.businessId),
    listDeliveries(session.businessId, { limit: 25 }),
    prisma.apiRequestLog.groupBy({ by: ["apiKeyId"], where: { apiKey: { businessId: session.businessId } }, _count: { _all: true } }),
    prisma.apiRequestLog.findFirst({ where: { apiKey: { businessId: session.businessId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const counts = new Map(requestCounts.map((row) => [row.apiKeyId ?? "", row._count?._all ?? 0]));
  const failedDeliveries = deliveries.filter((delivery) => delivery.status === "FAILED" || delivery.status === "DEAD").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys and webhooks"
        description="Scoped keys for server-to-server integrations and signed webhooks for event push. Secrets are stored hashed; webhook signing secrets are encrypted because the server must be able to sign every delivery."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active keys" value={String(keys.filter((key) => key.status === "ACTIVE").length)} hint={`${keys.length} total`} tone="brand" />
        <StatCard label="Webhooks" value={String(webhooks.length)} hint={`${webhooks.filter((webhook) => webhook.isActive).length} enabled`} />
        <StatCard label="API requests" value={String([...counts.values()].reduce((total, value) => total + value, 0))} hint={lastRequest ? `Last ${formatDateTime(lastRequest.createdAt)}` : "No calls yet"} />
        <StatCard label="Delivery problems" value={String(failedDeliveries)} hint="failed or dead in the last 25" tone={failedDeliveries > 0 ? "warning" : "success"} />
      </div>

      <Alert variant="warning">
        <p className="font-medium">Keys never expire on their own</p>
        <p className="text-sm">
          Set an expiry date where you can, revoke a key the moment a server is retired, and keep the scope list as short as the integration allows. Every request is logged with the key, the
          path, the status code and the duration.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <EmptyState title="No API keys yet" description="Create one below. The secret is displayed once and only its hash is stored." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{key.name}</span>
                        <Badge variant={key.status === "ACTIVE" ? "success" : key.status === "EXPIRED" ? "warning" : "danger"}>{key.status.toLowerCase()}</Badge>
                      </div>
                      <span className="block font-mono text-xs text-slate-500">{key.keyPreview}</span>
                      {key.expiresAt ? <span className="block text-xs text-slate-500">expires {formatDateTime(key.expiresAt)}</span> : null}
                      {key.allowedIpAddresses.length > 0 ? <span className="block text-xs text-slate-500">IPs: {key.allowedIpAddresses.join(", ")}</span> : null}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="neutral" className="font-mono text-[10px]">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{key.rateLimitPerMinute}/min</TableCell>
                    <TableCell className="text-sm">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "never"}</TableCell>
                    <TableCell className="text-sm">{counts.get(key.id) ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <ApiKeyActions
                        apiKey={{
                          id: key.id,
                          name: key.name,
                          description: key.description,
                          keyPrefix: key.keyPrefix,
                          keyPreview: key.keyPreview,
                          status: key.status,
                          scopes: key.scopes,
                          rateLimitPerMinute: key.rateLimitPerMinute,
                          expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
                          lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
                          usageCount: key.usageCount,
                          allowedIpAddresses: key.allowedIpAddresses,
                          requestCount: counts.get(key.id) ?? 0,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell title="Create an API key" description={`${SCOPE_KEYS.length} scopes are available; grant the minimum the integration needs.`}>
          <ApiKeyCreateForm />
        </CardShell>

        <CardShell title="Create a webhook" description={`${WEBHOOK_EVENTS.length} event types. Deliveries are signed with HMAC-SHA256 (header x-webhook-signature).`}>
          <WebhookCreateForm apiKeys={keys.filter((key) => key.status === "ACTIVE").map((key) => ({ id: key.id, name: key.name }))} />
        </CardShell>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <EmptyState title="No webhooks yet" description="Create one above to push order, payment and shipment events to your own systems." />
          ) : (
            <ul className="space-y-4">
              {webhooks.map((webhook) => (
                <li key={webhook.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{webhook.name}</span>
                        <Badge variant={webhook.isActive ? "success" : "warning"}>{webhook.isActive ? "enabled" : "disabled"}</Badge>
                        {webhook.failureCount > 0 ? <Badge variant="danger">{webhook.failureCount} failures</Badge> : null}
                      </div>
                      <span className="block font-mono text-xs text-slate-500">{webhook.url}</span>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {webhook.events.map((event) => (
                          <Badge key={event} variant="neutral" className="font-mono text-[10px]">
                            {event}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">
                        {webhook.deliveryCount} deliveries · last success {webhook.lastSuccessAt ? formatDateTime(webhook.lastSuccessAt) : "—"} · last failure{" "}
                        {webhook.lastFailureAt ? formatDateTime(webhook.lastFailureAt) : "—"}
                      </p>
                    </div>
                    <WebhookActions
                      webhook={{
                        id: webhook.id,
                        name: webhook.name,
                        url: webhook.url,
                        events: webhook.events,
                        isActive: webhook.isActive,
                        failureCount: webhook.failureCount,
                        lastSuccessAt: webhook.lastSuccessAt ? webhook.lastSuccessAt.toISOString() : null,
                        lastFailureAt: webhook.lastFailureAt ? webhook.lastFailureAt.toISOString() : null,
                        deliveryCount: webhook.deliveryCount,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <EmptyState title="Nothing delivered yet" description="Deliveries appear here as the worker processes queued events." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Next attempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-slate-600">{delivery.subscription?.url ?? "—"}</TableCell>
                    <TableCell>
                      <DeliveryStatusBadge status={delivery.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {delivery.attempts}/{delivery.maxAttempts}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-slate-600">
                      {delivery.responseStatus ?? "—"}
                      {delivery.lastError ? ` · ${delivery.lastError.slice(0, 60)}` : ""}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{delivery.nextAttemptAt ? formatDateTime(delivery.nextAttemptAt) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verifying a delivery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-600">
          <p>Every request carries the raw JSON body and these headers:</p>
          <ul className="list-inside list-disc font-mono text-xs">
            <li>x-webhook-id — delivery id, also present in the body as `id`</li>
            <li>x-webhook-event — the event type</li>
            <li>x-webhook-attempt — 1-based attempt number</li>
            <li>x-webhook-dedupe-key — stable per source event; use it to ignore duplicates</li>
            <li>x-webhook-signature — `sha256=` + HMAC-SHA256 of the raw body with your signing secret</li>
          </ul>
          <p>Failed deliveries retry with exponential backoff (1m, 2m, 4m … capped at 6h) and stop after the attempt limit — the row then shows as dead and the subscription&apos;s failure count goes up.</p>
          <p className="text-xs text-slate-500">Amounts in payloads are integer paisa, like everywhere else in the system — {formatPaisa(12345)} is 123.45 Tk.</p>
        </CardContent>
      </Card>
    </div>
  );
}
