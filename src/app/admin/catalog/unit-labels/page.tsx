import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listUnitLabels } from "@/modules/catalog/presets-service";
import { PageHeader } from "@/components/ui/primitives";
import { UnitLabelsManager } from "./unit-labels-client";

export const metadata: Metadata = { title: "Unit Labels" };
export const dynamic = "force-dynamic";

export default async function UnitLabelsPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const unitLabels = await listUnitLabels(session.businessId);
  const canManage = can(session, "product.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unit Labels"
        description="Units of sale (e.g. piece, kg, box, pair, litre, metre) available on products."
      />
      <UnitLabelsManager initialItems={unitLabels} canManage={canManage} />
    </div>
  );
}
