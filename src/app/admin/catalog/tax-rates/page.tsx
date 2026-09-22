import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listTaxRates } from "@/modules/catalog/presets-service";
import { PageHeader } from "@/components/ui/primitives";
import { TaxRatesManager } from "./tax-rates-client";

export const metadata: Metadata = { title: "Tax Rates" };
export const dynamic = "force-dynamic";

export default async function TaxRatesPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const taxRates = await listTaxRates(session.businessId);
  const canManage = can(session, "product.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Rates"
        description="Manage standard tax rate presets used across catalog products and checkout calculations."
      />
      <TaxRatesManager initialItems={taxRates} canManage={canManage} />
    </div>
  );
}
