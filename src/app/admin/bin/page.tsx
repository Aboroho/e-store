import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission, can } from "@/lib/permissions";
import { listBinnedItems } from "@/modules/catalog/product-service";
import { PageHeader } from "@/components/ui/primitives";
import { BinManager } from "./bin-client";

export const metadata: Metadata = { title: "Bin" };
export const dynamic = "force-dynamic";

export default async function BinPage() {
  const session = await requireSession();
  assertPermission(session, "product.view");
  const items = await listBinnedItems(session.businessId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bin"
        description="Everything deleted in the catalogue lands here — products, brands, labels and categories. Restore them, or permanently delete them when they have no history you need to keep."
      />
      <BinManager
        items={items}
        canManage={can(session, "product.delete") || can(session, "product.update") || can(session, "category.manage")}
      />
    </div>
  );
}
