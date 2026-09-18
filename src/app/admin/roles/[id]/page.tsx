import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listPermissions } from "@/modules/users/queries";
import { EditRoleForm } from "@/components/forms/role-form";
import { Alert, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { deleteRoleAction } from "@/modules/users/actions";
import { SubmitButton } from "@/components/ui/interactive";

export const metadata: Metadata = { title: "Role" };
export const dynamic = "force-dynamic";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "role.manage");
  const { id } = await params;

  const role = await prisma.role.findFirst({
    where: { id, businessId: session.businessId },
    include: {
      permissions: { include: { permission: { select: { key: true } } } },
      users: { include: { user: { select: { id: true, name: true, email: true, status: true } } } },
    },
  });
  if (!role) notFound();

  const permissions = await listPermissions();
  const deleteRole = deleteRoleAction.bind(null, role.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={role.name}
        description={role.description ?? `Role slug: ${role.slug}`}
        actions={
          <Link href="/admin/roles" className="text-sm font-medium text-brand-600 hover:underline">
            Back to roles
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EditRoleForm
            role={{
              id: role.id,
              name: role.name,
              slug: role.slug,
              description: role.description,
              permissions: role.permissions.map((entry) => entry.permission.key),
              isProtected: role.isProtected,
            }}
            permissions={permissions}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assigned users ({role.users.length})</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {role.users.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No users currently hold this role.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {role.users.map((entry) => (
                      <TableRow key={entry.user.id}>
                        <TableCell>
                          <Link href={`/admin/users/${entry.user.id}`} className="font-medium text-brand-600 hover:underline">
                            {entry.user.name}
                          </Link>
                          <p className="text-xs text-slate-500">{entry.user.email}</p>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{entry.user.status.toLowerCase()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {!role.isProtected && !role.isSystem ? (
            <Card>
              <CardHeader>
                <CardTitle>Danger zone</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert variant="danger" title="Deleting a role is permanent">
                  Roles can only be deleted when no user holds them. This action is recorded in the audit log.
                </Alert>
                <form action={deleteRole}>
                  <SubmitButton
                    variant="destructive"
                    pendingLabel="Deleting…"
                    confirm="Delete this role permanently?"
                    disabled={role.users.length > 0}
                  >
                    Delete role
                  </SubmitButton>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
