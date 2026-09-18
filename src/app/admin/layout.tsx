import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { ADMIN_NAV, type NavSection } from "@/components/layout/nav-config";
import { AdminShell } from "@/components/layout/admin-shell";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · E-Store Admin" } };
export const dynamic = "force-dynamic";

/** Current implementation stage; navigation entries from later stages are shown disabled. */
const CURRENT_STAGE = 1;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  // Filter the navigation by the permissions the signed-in user actually holds.
  const sections: NavSection[] = ADMIN_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => can(session, item.permission)),
  })).filter((section) => section.items.length > 0);

  const [business, unreadCount, notifications] = await Promise.all([
    prisma.business.findUnique({ where: { id: session.businessId }, select: { name: true } }),
    prisma.notificationRecipient.count({ where: { userId: session.id, readAt: null, archivedAt: null } }),
    prisma.notificationRecipient.findMany({
      where: { userId: session.id, readAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { notification: { select: { id: true, title: true, body: true, url: true, severity: true, createdAt: true } } },
    }),
  ]);

  return (
    <AdminShell
      sections={sections}
      businessName={business?.name ?? "E-Store"}
      currentStage={CURRENT_STAGE}
      unreadCount={unreadCount}
      notifications={notifications.map((recipient) => ({
        id: recipient.id,
        title: recipient.notification.title,
        body: recipient.notification.body,
        url: recipient.notification.url,
        severity: recipient.notification.severity,
        createdAt: recipient.notification.createdAt.toISOString(),
      }))}
      user={{
        id: session.id,
        name: session.name,
        email: session.email,
        roles: session.roles.map((role) => role.name),
        isOwner: session.isOwner,
      }}
    >
      {children}
    </AdminShell>
  );
}
