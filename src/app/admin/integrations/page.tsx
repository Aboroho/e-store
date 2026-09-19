import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { MarketingIntegrationForm } from "@/components/forms/marketing-forms";
import { listMarketingEvents, marketingEventStats, listMarketingIntegrations } from "@/modules/marketing/service";
import { MARKETING_PROVIDERS } from "@/modules/marketing/providers";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Marketing integrations" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requireSession();
  assertPermission(session, "integration.manage");

  const [integrations, stats, events, storefronts] = await Promise.all([
    listMarketingIntegrations(session.businessId),
    marketingEventStats(session.businessId),
    listMarketingEvents(session.businessId, { limit: 25 }),
    prisma.storefront.findMany({ where: { businessId: session.businessId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing integrations"
        description="Browser pixels for on-site measurement and server-side conversion events for the providers that support them. Credentials are encrypted; the storefront only ever receives public ids."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Configured" value={String(integrations.length)} hint={`${integrations.filter((integration) => integration.isEnabled).length} enabled`} tone="brand" />
        <StatCard label="Sent" value={String(stats.sent)} hint="confirmed by the provider" tone="success" />
        <StatCard label="Queued / retrying" value={String(stats.pending + stats.failed)} hint={`${stats.failed} waiting for a retry`} />
        <StatCard label="Without consent" value={String(stats.skippedNoConsent)} hint="recorded, not sent" tone="warning" />
        <StatCard label="Discarded" value={String(stats.discarded)} hint="bad configuration or exhausted retries" tone={stats.discarded > 0 ? "danger" : "slate"} />
      </div>

      <Alert variant="info">
        <p className="font-medium">Consent and personal data</p>
        <p className="text-sm">
          When an integration requires consent, no pixel is loaded and no server event leaves the system until the visitor accepts — the attempt is still recorded as
          &ldquo;without consent&rdquo; so reports can explain the gap. Server events carry a hashed customer id only: no phone number, no email address, and every event
          carries a dedupe key so a retry cannot double-count a conversion.
        </p>
      </Alert>

      <div className="space-y-6">
        {MARKETING_PROVIDERS.map((provider) => {
          const integration = integrations.find((entry) => entry.provider === provider.key && !entry.storefrontId);
          const perStorefront = integrations.filter((entry) => entry.provider === provider.key && entry.storefrontId);
          return (
            <Card key={provider.key}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {provider.label}
                  <Badge variant={provider.delivery === "browser" ? "info" : provider.delivery === "server" ? "violet" : "brand"}>{provider.delivery}</Badge>
                  {integration?.isEnabled ? <Badge variant="success">enabled</Badge> : null}
                  {perStorefront.length > 0 ? <Badge variant="neutral">{perStorefront.length} per-storefront</Badge> : null}
                </CardTitle>
                <p className="text-sm text-slate-600">{provider.description}</p>
                {provider.docsUrl ? (
                  <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                    Provider documentation
                  </a>
                ) : null}
              </CardHeader>
              <CardContent>
                <MarketingIntegrationForm
                  providerKey={provider.key}
                  storefronts={storefronts}
                  integration={
                    integration
                      ? {
                          id: integration.id,
                          name: integration.name,
                          isEnabled: integration.isEnabled,
                          consentRequired: integration.consentRequired,
                          testEventCode: integration.testEventCode,
                          publicConfig: integration.publicConfig,
                          secretKeys: integration.secretKeys,
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState title="No marketing events yet" description="Events appear here once an enabled integration receives a purchase or a refund." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Integration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Dedupe key</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">{event.eventName}</TableCell>
                    <TableCell className="text-sm">{event.integration.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.status === "SENT" ? "success" : event.status === "FAILED" ? "warning" : event.status === "SKIPPED_NO_CONSENT" ? "info" : event.status === "DISCARDED" ? "danger" : "neutral"
                        }
                      >
                        {event.status.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                      {event.lastError ? <span className="block max-w-[220px] truncate text-xs text-rose-600">{event.lastError}</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">{event.attempts}</TableCell>
                    <TableCell className="max-w-[220px] truncate font-mono text-xs text-slate-500">{event.dedupeKey}</TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
