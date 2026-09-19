import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { CreateUserForm } from "@/components/forms/user-form";
import { listAssignableRoles } from "@/modules/users/queries";
import { PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "New user" };
export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const session = await requireSession();
  assertPermission(session, "user.manage");
  const roles = await listAssignableRoles(session.businessId);

  return (
    <div className="space-y-4">
      <PageHeader title="Create staff user" description="Assign one or more roles. The user receives a temporary password." />
      <CreateUserForm roles={roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, description: role.description }))} />
    </div>
  );
}
