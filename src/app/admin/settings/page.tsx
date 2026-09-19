import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { businessSettingGroups } from "@/modules/settings/service";
import { BUSINESS_SETTINGS } from "@/lib/settings";
import { BusinessProfileForm, BusinessSettingsForm } from "@/components/forms/settings-form";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  assertPermission(session, "settings.manage");

  const [business, groups, storefronts] = await Promise.all([
    prisma.business.findUnique({
      where: { id: session.businessId },
      select: { logoMediaId: true, name: true, legalName: true, phone: true, email: true, address: true, currency: true },
    }),
    businessSettingGroups(session.businessId),
    prisma.storefront.findMany({
      where: { businessId: session.businessId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true, domains: { select: { host: true, isPrimary: true } } },
    }),
  ]);

  const booleanKeys = Object.values(BUSINESS_SETTINGS)
    .filter((definition) => typeof definition.defaultValue === "boolean")
    .map((definition) => definition.key)
    .join(",");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Business-wide configuration. Every change is written to the audit log with the previous and new value."
      />

      {business ? <BusinessProfileForm business={business} /> : null}

      <BusinessSettingsForm groups={groups} booleanKeys={booleanKeys} />

      <Card>
        <CardHeader>
          <CardTitle>Storefronts</CardTitle>
          <p className="text-xs text-slate-500">
            Storefront appearance and checkout settings are configured per storefront.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {storefronts.length === 0 ? (
            <Alert variant="info" title="No storefronts yet">
              Storefronts are introduced in Stage 5. Until then the primary storefront is created by the seed script.
            </Alert>
          ) : (
            storefronts.map((storefront) => (
              <div key={storefront.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-800">{storefront.name}</p>
                  <p className="text-xs text-slate-500">
                    {storefront.domains.find((domain) => domain.isPrimary)?.host ?? storefront.domains[0]?.host ?? "No custom domain"}
                  </p>
                </div>
                {can(session, "storefront.manage") ? (
                  <Link href={`/admin/storefronts/${storefront.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                    Manage
                  </Link>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
