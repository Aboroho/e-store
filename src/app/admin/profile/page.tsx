import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/utils";
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/primitives";
import { ChangePasswordForm } from "@/components/forms/change-password-form";

export const metadata: Metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireSession();

  const [user, sessions, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.id },
      include: { roles: { include: { role: { select: { name: true } } } } },
    }),
    prisma.session.findMany({
      where: { userId: session.id, revokedAt: null },
      orderBy: { lastUsedAt: "desc" },
      take: 10,
    }),
    prisma.securityEvent.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your account, active sessions and recent security activity." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Name</span>
                <span className="font-medium text-slate-900">{user.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Email</span>
                <span className="text-slate-700">{user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Roles</span>
                <span className="flex flex-wrap gap-1">
                  {user.roles.map((entry) => (
                    <Badge key={entry.role.name} variant="neutral">
                      {entry.role.name}
                    </Badge>
                  ))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Last sign-in</span>
                <span className="text-slate-700">{formatDateTime(user.lastLoginAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Permissions</span>
                <span className="text-slate-700">{session.permissions.size === 0 || user.isOwner ? "All" : session.permissions.size}</span>
              </div>
            </CardContent>
          </Card>

          <ChangePasswordForm />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Device</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</TableCell>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(entry.lastUsedAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.ipAddress ?? "—"}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs text-slate-500">{entry.userAgent ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security activity</CardTitle>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</TableCell>
                      <TableCell className="text-sm">{event.type}</TableCell>
                      <TableCell className="font-mono text-xs">{event.ipAddress ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={event.success ? "success" : "danger"}>{event.success ? "success" : "failed"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
