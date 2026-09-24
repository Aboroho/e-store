import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listLabels } from "@/modules/catalog/presets-service";
import { PageHeader } from "@/components/ui/primitives";
import { LabelsManager } from "./labels-client";

export const metadata: Metadata = { title: "Labels" };
export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const labels = await listLabels(session.businessId);
  const canManage = can(session, "product.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labels"
        description="Merchandising labels such as New, Sale or Featured. Create them here or inline while editing a product."
      />
      <LabelsManager initialItems={labels} canManage={canManage} />
    </div>
  );
}
