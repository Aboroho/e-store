import "server-only";
import { prisma } from "@/lib/db/client";

/** Shared read queries for user/role management screens. */

export async function listAssignableRoles(businessId: string) {
  const roles = await prisma.role.findMany({
    where: { businessId },
    orderBy: [{ isProtected: "desc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, description: true, isProtected: true, _count: { select: { permissions: true, users: true } } },
  });
  return roles;
}

export async function listPermissions() {
  const permissions = await prisma.permission.findMany({
    orderBy: [{ group: "asc" }, { key: "asc" }],
    select: { key: true, group: true, label: true, description: true, isDangerous: true },
  });
  return permissions;
}

/**
 * Maps user ids to display names. Ledger tables store the actor id without a
 * relation (so audit rows survive a user rename), therefore screens resolve the
 * names in a second, batched query.
 */
export async function userDisplayNames(userIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}
