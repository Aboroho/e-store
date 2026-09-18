import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";

/**
 * In-app notifications.
 *
 * A notification row is created once and fanned out to recipients; read state
 * lives on the recipient row so two users can never affect each other. Email /
 * SMS delivery is queued in later stages through the outbox.
 */

export interface CreateNotificationInput {
  businessId: string;
  type: string;
  title: string;
  body?: string | null;
  severity?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  entityType?: string | null;
  entityId?: string | null;
  url?: string | null;
  permissionKey?: string | null;
  createdByUserId?: string | null;
  /** Explicit recipients. When omitted, every user holding `permissionKey` is notified. */
  userIds?: string[];
  /** Do not create a duplicate for the same entity while an unread one exists. */
  dedupeByEntity?: boolean;
}

export async function createNotification(input: CreateNotificationInput): Promise<{ id: string; recipients: number }> {
  let userIds = input.userIds ?? [];

  if (userIds.length === 0 && input.permissionKey) {
    const holders = await prisma.user.findMany({
      where: {
        businessId: input.businessId,
        status: "ACTIVE",
        deletedAt: null,
        roles: { some: { role: { permissions: { some: { permission: { key: input.permissionKey } } } } } },
      },
      select: { id: true },
    });
    userIds = holders.map((holder) => holder.id);

    // Owners implicitly hold every permission, so include them explicitly.
    const owners = await prisma.user.findMany({
      where: { businessId: input.businessId, isOwner: true, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    userIds = [...new Set([...userIds, ...owners.map((owner) => owner.id)])];
  }

  if (input.dedupeByEntity && input.entityType && input.entityId) {
    const existing = await prisma.notification.findFirst({
      where: {
        businessId: input.businessId,
        entityType: input.entityType,
        entityId: input.entityId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, recipients: 0 };
  }

  const notification = await prisma.notification.create({
    data: {
      businessId: input.businessId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? "INFO",
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      url: input.url ?? null,
      permissionKey: input.permissionKey ?? null,
      createdByUserId: input.createdByUserId ?? null,
      recipients: { create: userIds.map((userId) => ({ userId })) },
    },
    select: { id: true },
  });

  return { id: notification.id, recipients: userIds.length };
}

export async function markNotificationRead(userId: string, recipientId: string): Promise<void> {
  const recipient = await prisma.notificationRecipient.findFirst({
    where: { id: recipientId, userId },
    select: { id: true, readAt: true },
  });
  if (!recipient) throw AppError.notFound("Notification not found");
  if (recipient.readAt) return;
  await prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
}

export async function markNotificationUnread(userId: string, recipientId: string): Promise<void> {
  const recipient = await prisma.notificationRecipient.findFirst({ where: { id: recipientId, userId }, select: { id: true } });
  if (!recipient) throw AppError.notFound("Notification not found");
  await prisma.notificationRecipient.update({ where: { id: recipient.id }, data: { readAt: null } });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notificationRecipient.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notificationRecipient.count({ where: { userId, readAt: null, archivedAt: null } });
}
