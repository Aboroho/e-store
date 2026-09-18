import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { prisma } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils";
import { listCourierAdapters } from "@/modules/couriers/providers";
import { listCourierProviders } from "@/modules/couriers/service";
import { listSecretKeys } from "@/modules/integrations/secrets";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import {
  CourierCredentialForm,
  CourierProviderForm,
  CourierTestConnectionForm,
  PaymentIntegrationForm,
  PaymentCredentialForm,
} from "@/components/forms/courier-forms";

export const metadata: Metadata = { title: "Couriers & integrations" };
export const dynamic = "force-dynamic";

export default async function CouriersPage() {
  const session = await requireSession();
  assertPermission(session, "courier.view");
  const canManage = can(session, "courier.manage");

  const [providers, adapters, paymentIntegrations] = await Promise.all([
    listCourierProviders(session.businessId),
    Promise.resolve(listCourierAdapters()),
    prisma.integration.findMany({ where: { businessId: session.businessId }, orderBy: { provider: "asc" } }),
  ]);

  const credentialRows = await Promise.all(providers.map((provider) => listSecretKeys({ courierProviderId: provider.id })));
  const paymentRows = await Promise.all(paymentIntegrations.map((integration) => listSecretKeys({ integrationId: integration.id })));
  const credentialKeys = credentialRows.map((rows) => rows.map((row) => row.key));
  const paymentKeys = paymentRows.map((rows) => rows.map((row) => row.key));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Couriers & payment integrations"
        description="Provider credentials are encrypted at rest and never leave the server. Shipment creation runs through the outbox worker with retries and idempotency keys."
      />

      {!canManage ? <Alert variant="info">You have read-only access to integration settings.</Alert> : null}
      {session.businessId && providers.length === 0 ? (
        <Alert variant="warning">
          No courier provider rows exist yet. Run the seed (<code>npm run db:seed</code>) to create Pathao, Steadfast, CarryBee and the manual
          provider.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {providers.map((provider, index) => (
          <Card key={provider.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>{provider.name}</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {provider.code} · {provider.testMode ? "sandbox" : "live"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant={provider.isEnabled ? "success" : "neutral"}>{provider.isEnabled ? "enabled" : "disabled"}</Badge>
                {provider.code === "MANUAL" ? <Badge variant="info">no provider API</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pickup</span>
                  <span>{provider.pickupCity ?? provider.pickupArea ?? "not set"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Default weight</span>
                  <span className="tabular-nums">{provider.defaultWeightGrams} g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Priority</span>
                  <span className="tabular-nums">{provider.priority}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last sync</span>
                  <span>{provider.lastSyncAt ? formatDateTime(provider.lastSyncAt) : "never"}</span>
                </div>
              </div>

              {canManage ? (
                <>
                  <CourierProviderForm
                    provider={{
                      id: provider.id,
                      code: provider.code,
                      isEnabled: provider.isEnabled,
                      testMode: provider.testMode,
                      pickupName: provider.pickupName,
                      pickupPhone: provider.pickupPhone,
                      pickupAddress: provider.pickupAddress,
                      pickupCity: provider.pickupCity,
                      pickupArea: provider.pickupArea,
                      defaultWeightGrams: provider.defaultWeightGrams,
                      codEnabled: provider.codEnabled,
                      priority: provider.priority,
                    }}
                  />

                  {provider.code !== "MANUAL" ? (
                    <div className="space-y-3 border-t border-slate-100 pt-4">
                      <CourierCredentialForm
                        providerId={provider.id}
                        providerName={provider.name}
                        credentialKeys={adapters.find((adapter) => adapter.code === provider.code)?.credentialKeys ?? []}
                        presentKeys={credentialKeys[index] ?? []}
                      />
                      <CourierTestConnectionForm providerId={provider.id} />
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-slate-500">Credentials: {(credentialKeys[index] ?? []).join(", ") || "none stored"}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment gateways</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            bKash and SSLCommerz credentials stay server-side. Callbacks are verified against the provider API before any order is marked paid —
            a browser redirect alone never marks an order paid.
          </p>
          {paymentIntegrations.length === 0 ? (
            <Alert variant="info">No payment integrations are configured yet.</Alert>
          ) : (
            paymentIntegrations.map((integration, index) => (
              <div key={integration.id} className="space-y-3 rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">{integration.name}</div>
                    <div className="text-xs text-slate-500">
                      {integration.provider} · {integration.testMode ? "sandbox" : "live"} · {integration.isEnabled ? "enabled" : "disabled"}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">{(paymentKeys[index] ?? []).join(", ") || "no credentials"}</div>
                </div>
                {canManage ? <PaymentCredentialForm provider={integration.provider} presentKeys={paymentKeys[index] ?? []} /> : null}
              </div>
            ))
          )}
          {canManage ? <PaymentIntegrationForm /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
