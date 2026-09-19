import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listPermissions } from "@/modules/users/queries";
import { CreateRoleForm } from "@/components/forms/role-form";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New role" };
export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const session = await requireSession();
  assertPermission(session, "role.manage");
  const permissions = await listPermissions();

  return (
    <div className="space-y-4">
      <PageHeader title="Create role" description="Choose exactly what this role may do. Permissions apply immediately on save." />
      <CreateRoleForm permissions={permissions} />
    </div>
  );
}
