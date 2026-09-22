import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listPackagingCostTemplates } from "@/modules/catalog/presets-service";
import { PageHeader } from "@/components/ui/primitives";
import { PackagingCostsManager } from "./packaging-costs-client";

export const metadata: Metadata = { title: "Packaging Cost Templates" };
export const dynamic = "force-dynamic";

export default async function PackagingCostsPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const templates = await listPackagingCostTemplates(session.businessId);
  const canManage = can(session, "product.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packaging Cost Templates"
        description="Standard packaging and material cost presets for calculating product profit margins."
      />
      <PackagingCostsManager initialItems={templates} canManage={canManage} />
    </div>
  );
}
