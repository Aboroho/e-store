"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { markAllNotificationsRead, markNotificationRead, markNotificationUnread } from "@/modules/notifications/service";

export async function markNotificationReadAction(recipientId: string): Promise<void> {
  const session = await requireSession();
  await markNotificationRead(session.id, recipientId);
  revalidatePath("/admin");
  revalidatePath("/admin/notifications");
}

export async function markNotificationUnreadAction(recipientId: string): Promise<void> {
  const session = await requireSession();
  await markNotificationUnread(session.id, recipientId);
  revalidatePath("/admin/notifications");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await requireSession();
  await markAllNotificationsRead(session.id);
  revalidatePath("/admin");
  revalidatePath("/admin/notifications");
}
