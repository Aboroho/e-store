import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listBrands } from "@/modules/catalog/presets-service";
import { PageHeader } from "@/components/ui/primitives";
import { BrandsManager } from "./brands-client";

export const metadata: Metadata = { title: "Brands" };
export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");

  const brands = await listBrands(session.businessId);
  const canManage = can(session, "product.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Catalog brands and manufacturers for categorising and filtering products."
      />
      <BrandsManager initialItems={brands} canManage={canManage} />
    </div>
  );
}
