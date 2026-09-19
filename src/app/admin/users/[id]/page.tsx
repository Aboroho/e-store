import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { EditUserForm, ResetPasswordForm } from "@/components/forms/user-form";
import { listAssignableRoles } from "@/modules/users/queries";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "User" };
export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  assertPermission(session, "user.manage");
  const { id } = await params;

  const [user, roles] = await Promise.all([
    prisma.user.findFirst({
      where: { id, businessId: session.businessId },
      include: {
        roles: { include: { role: { select: { id: true, name: true, slug: true } } } },
        sessions: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 5 },
      },
    }),
    listAssignableRoles(session.businessId),
  ]);

  if (!user) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={user.name}
        description={user.email}
        actions={
          <Link href="/admin/users" className="text-sm font-medium text-brand-600 hover:underline">
            Back to users
          </Link>
        }
      />

      {user.isOwner ? (
        <Alert variant="info" title="Owner account">
          The owner holds every permission and cannot be demoted, suspended or deleted.
        </Alert>
      ) : null}
      {user.mustChangePassword ? (
        <Alert variant="warning" title="Password change required">
          This user must choose a new password the next time they sign in.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EditUserForm
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              jobTitle: user.jobTitle,
              status: user.status,
              roleIds: user.roles.map((entry) => entry.role.id),
            }}
            roles={roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug, description: role.description }))}
          />

          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
              {user.sessions.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No active sessions. Suspending a user revokes their sessions immediately.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Signed in</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead>IP address</TableHead>
                      <TableHead>Device</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {user.sessions.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</TableCell>
                        <TableCell className="text-xs text-slate-500">{formatDateTime(entry.lastUsedAt)}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.ipAddress ?? "—"}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-slate-500">{entry.userAgent ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Account status</span>
                <Badge variant={user.status === "ACTIVE" ? "success" : user.status === "SUSPENDED" ? "danger" : "neutral"}>
                  {user.status.toLowerCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Last sign-in</span>
                <span className="text-slate-700">{formatDateTime(user.lastLoginAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Failed sign-ins</span>
                <span className="text-slate-700">{user.failedLoginCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-700">{formatDateTime(user.createdAt)}</span>
              </div>
            </CardContent>
          </Card>

          <ResetPasswordForm userId={user.id} isSelf={user.id === session.id} />
        </div>
      </div>
    </div>
  );
}
