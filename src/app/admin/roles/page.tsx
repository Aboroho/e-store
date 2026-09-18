import type { Metadata } from "next";
import Link from "next/link";
import { ShieldPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { listAssignableRoles } from "@/modules/users/queries";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { ROLE_TEMPLATES } from "@/lib/permissions/catalog";

export const metadata: Metadata = { title: "Roles & permissions" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requireSession();
  assertPermission(session, "role.manage");
  const roles = await listAssignableRoles(session.businessId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles & permissions"
        description="Permissions are enforced on the server for every request, not just hidden in the interface."
        actions={
          <Link
            href="/admin/roles/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            <ShieldPlus className="h-4 w-4" /> New role
          </Link>
        }
      />

      <Card>
        {roles.length === 0 ? (
          <CardContent>
            <EmptyState title="No roles" description="Seed the role templates to get started." />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-center">Permissions</TableHead>
                <TableHead className="text-center">Users</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{role.name}</span>
                      {role.isProtected ? <Badge variant="brand">system</Badge> : null}
                    </div>
                    {role.description ? <p className="text-xs text-slate-500">{role.description}</p> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{role.slug}</TableCell>
                  <TableCell className="text-center tabular-nums">{role._count.permissions}</TableCell>
                  <TableCell className="text-center tabular-nums">{role._count.users}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/roles/${role.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                      {role.isProtected ? "View" : "Edit"}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommended role templates</CardTitle>
          <p className="text-xs text-slate-500">
            These templates are seeded into the permissions catalogue. They are shown here for reference when building custom roles.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLE_TEMPLATES.map((template) => {
            const exists = roles.some((role) => role.slug === template.slug);
            return (
              <div key={template.slug} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">{template.name}</p>
                  <Badge variant={exists ? "success" : "neutral"}>
                    {exists
                      ? "created"
                      : template.permissions === "*"
                        ? "all permissions"
                        : `${template.permissions.length} perms`}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{template.description}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
