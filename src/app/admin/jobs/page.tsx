import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Background jobs" };
export const dynamic = "force-dynamic";

/**
 * Operations screen for the asynchronous side of the system: the transactional outbox,
 * webhook deliveries, marketing conversions and queued background jobs. Read-only by
 * design — the worker owns state transitions, and a stuck row is retried there.
 */
export default async function JobsPage() {
  const session = await requireSession();
  assertPermission(session, "job.manage");

  const [outbox, deliveries, marketing, jobs, counts] = await Promise.all([
    prisma.outboxEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.webhookDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { subscription: { select: { name: true } } } }),
    prisma.marketingEvent.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { integration: { select: { name: true, provider: true } } } }),
    prisma.backgroundJob.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    Promise.all([
      prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.webhookDelivery.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
      prisma.marketingEvent.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
      prisma.outboxEvent.count({ where: { status: "DEAD" } }),
    ]),
  ]);

  const [pendingOutbox, pendingWebhooks, pendingMarketing, deadOutbox] = counts;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Background jobs"
        description="The web app never calls a courier, gateway or marketing provider inside a request. It writes a row, and one worker (npm run worker) performs the call with retries and a dead-letter state."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Outbox queue" value={String(pendingOutbox)} hint="pending or processing" tone={pendingOutbox > 0 ? "warning" : "success"} />
        <StatCard label="Webhook queue" value={String(pendingWebhooks)} hint="pending or retrying" />
        <StatCard label="Marketing queue" value={String(pendingMarketing)} hint="pending or retrying" />
        <StatCard label="Dead letters" value={String(deadOutbox)} hint="need a human decision" tone={deadOutbox > 0 ? "danger" : "success"} />
      </div>

      <Alert variant="info">
        <p className="font-medium">Deploying the worker</p>
        <p className="text-sm">
          Run <span className="font-mono">npm run worker</span> under systemd or supervisor next to the app (see <span className="font-mono">docs/DEPLOYMENT.md</span>). It polls the outbox, delivers webhooks, sends
          marketing conversions and refreshes stale courier tracking. A single worker is enough for this volume; the claim queries are written so two workers can never process the same row.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactional outbox</CardTitle>
        </CardHeader>
        <CardContent>
          {outbox.length === 0 ? (
            <EmptyState title="Nothing queued" description="Events appear here when an order is dispatched to a courier." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Aggregate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Last error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outbox.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">{event.eventType}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {event.aggregateType} · {event.aggregateId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={event.status === "PUBLISHED" ? "success" : event.status === "DEAD" ? "danger" : event.status === "PROCESSING" ? "info" : "neutral"}>{event.status.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {event.attempts}/{event.maxAttempts}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(event.availableAt)}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-rose-600">{event.lastError ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook deliveries</CardTitle>
          </CardHeader>
          <CardContent>
            {deliveries.length === 0 ? (
              <EmptyState title="No deliveries" description="Subscribe an endpoint under API keys to see deliveries here." />
            ) : (
              <ul className="space-y-2 text-sm">
                {deliveries.map((delivery) => (
                  <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                    <span className="font-mono text-xs">{delivery.eventType}</span>
                    <span className="text-xs text-slate-500">{delivery.subscription?.name}</span>
                    <Badge variant={delivery.status === "SUCCESS" ? "success" : delivery.status === "DEAD" ? "danger" : delivery.status === "FAILED" ? "warning" : "neutral"}>
                      {delivery.status.toLowerCase()}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {delivery.attempts}/{delivery.maxAttempts}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Marketing conversions</CardTitle>
          </CardHeader>
          <CardContent>
            {marketing.length === 0 ? (
              <EmptyState title="No conversions" description="Configure a server-side provider under Integrations." />
            ) : (
              <ul className="space-y-2 text-sm">
                {marketing.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                    <span className="font-mono text-xs">{event.eventName}</span>
                    <span className="text-xs text-slate-500">{event.integration.name}</span>
                    <Badge variant={event.status === "SENT" ? "success" : event.status === "DISCARDED" ? "danger" : event.status === "SKIPPED_NO_CONSENT" ? "info" : "warning"}>
                      {event.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queued background jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <EmptyState title="No jobs queued" description="Long-running work is registered here when a feature needs it." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Run at</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">{job.type}</TableCell>
                    <TableCell className="text-xs text-slate-500">{job.queue}</TableCell>
                    <TableCell>
                      <Badge variant={job.status === "SUCCEEDED" ? "success" : job.status === "FAILED" || job.status === "DEAD" ? "danger" : "neutral"}>{job.status.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.attempts}/{job.maxAttempts}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(job.runAt)}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-slate-600">{job.resultSummary ?? job.lastError ?? "—"}</TableCell>
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
