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
