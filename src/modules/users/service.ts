import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { hashPassword, evaluatePasswordPolicy } from "@/lib/auth/password";
import { isUniqueConstraintError } from "@/lib/errors";
import type { CreateRoleInput, CreateUserInput, UpdateUserInput } from "@/modules/users/schemas";

/**
 * User and role management.
 *
 * Business rules enforced here (not only in the UI):
 *  - the seeded owner account can never be deleted, suspended or demoted;
 *  - protected system roles cannot be renamed, deleted or have permissions changed;
 *  - at least one active owner with the `user.manage` capability must always exist;
 *  - users can only be assigned roles that belong to their business.
 */

export interface ActorContext {
  userId: string;
  businessId: string;
  isOwner: boolean;
  actorLabel: string;
}

async function loadRoles(businessId: string, roleIds: string[]) {
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds }, businessId } });
  if (roles.length !== roleIds.length) {
    throw AppError.validation("One or more selected roles do not exist");
  }
  return roles;
}

export async function createStaffUser(actor: ActorContext, input: CreateUserInput) {
  const roles = await loadRoles(actor.businessId, input.roleIds);

  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true, deletedAt: true } });
  if (existing) {
    throw AppError.conflict("A user with that email address already exists");
  }

  // A newly created user receives a random password and must reset it; the
  // invite token flow (email delivery) is configured separately.
  const temporaryPassword = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}Aa1!`;

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          businessId: actor.businessId,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          jobTitle: input.jobTitle ?? null,
          status: "ACTIVE",
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          roles: {
            create: roles.map((role) => ({ roleId: role.id })),
          },
        },
        select: { id: true, name: true, email: true },
      });

      await tx.auditLog.create({
        data: {
          businessId: actor.businessId,
          actorType: "USER",
          actorUserId: actor.userId,
          actorLabel: actor.actorLabel,
          action: "user.created",
          entityType: "User",
          entityId: created.id,
          summary: `Created user ${created.email}`,
          after: { email: created.email, name: created.name, roles: roles.map((role) => role.slug) },
          changedFields: ["name", "email", "roleIds"],
        },
      });

      return created;
    });

    return { user, temporaryPassword };
  } catch (error) {
    if (isUniqueConstraintError(error, "email")) {
      throw AppError.conflict("A user with that email address already exists");
    }
    throw error;
  }
}

export async function updateStaffUser(actor: ActorContext, userId: string, input: UpdateUserInput) {
  const user = await prisma.user.findFirst({
    where: { id: userId, businessId: actor.businessId, deletedAt: null },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw AppError.notFound("User not found");

  if (user.isOwner) {
    throw AppError.forbidden("The owner account cannot be modified through user management");
  }

  const roles = await loadRoles(actor.businessId, input.roleIds);
  const before = {
    name: user.name,
    phone: user.phone,
    jobTitle: user.jobTitle,
    status: user.status,
    roles: user.roles.map((entry) => entry.role.slug),
  };

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        status: input.status,
        roles: {
          deleteMany: {},
          create: roles.map((role) => ({ roleId: role.id })),
        },
      },
      select: { id: true, name: true, email: true, status: true },
    });

    // Suspending or disabling a user must immediately revoke their sessions.
    if (input.status !== "ACTIVE") {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "user_status_changed" },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorType: "USER",
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "user.updated",
        entityType: "User",
        entityId: userId,
        summary: `Updated user ${user.email}`,
        before,
        after: { ...result, roles: roles.map((role) => role.slug) },
        changedFields: ["user", "roles"],
      },
    });

    return result;
  });

  return updated;
}

export async function setUserStatus(actor: ActorContext, userId: string, status: "ACTIVE" | "SUSPENDED" | "DISABLED") {
  const user = await prisma.user.findFirst({
    where: { id: userId, businessId: actor.businessId },
    select: { id: true, email: true, isOwner: true, status: true },
  });
  if (!user) throw AppError.notFound("User not found");
  if (user.isOwner) throw AppError.forbidden("The owner account cannot be disabled or suspended");
  if (actor.userId === userId) throw AppError.forbidden("You cannot change your own account status");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status } });
    if (status !== "ACTIVE") {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: `status_${status.toLowerCase()}` },
      });
    }
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    action: "user.status_changed",
    entityType: "User",
    entityId: userId,
    summary: `Changed status of ${user.email} to ${status}`,
    before: { status: user.status },
    after: { status },
    changedFields: ["status"],
  });
}

export async function resetUserPassword(
  actor: ActorContext,
  input: { userId: string; newPassword: string; forceChange: boolean },
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, businessId: actor.businessId, deletedAt: null },
    select: { id: true, email: true, name: true, isOwner: true },
  });
  if (!user) throw AppError.notFound("User not found");
  if (user.isOwner && actor.userId !== user.id) {
    throw AppError.forbidden("Only the owner can reset the owner account password");
  }

  const policy = evaluatePasswordPolicy(input.newPassword, { email: user.email, name: user.name });
  if (!policy.valid) {
    throw AppError.validation("The password does not meet the security policy", policy.problems);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: input.forceChange,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "admin_password_reset" },
    });
  });

  await recordAudit({
    businessId: actor.businessId,
    actorUserId: actor.userId,
    actorLabel: actor.actorLabel,
    action: "user.password_reset",
    entityType: "User",
    entityId: user.id,
    summary: `Administrator reset the password for ${user.email}`,
  });
}

export async function createRole(actor: ActorContext, input: CreateRoleInput) {
  const existing = await prisma.role.findFirst({ where: { businessId: actor.businessId, slug: input.slug } });
  if (existing) throw AppError.conflict("A role with that slug already exists");

  const permissions = await prisma.permission.findMany({ where: { key: { in: input.permissions } } });
  const permissionsDiff = input.permissions.length - permissions.length;
  if (permissionsDiff > 0) throw AppError.validation(`${permissionsDiff} permission key(s) are unknown`);

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        businessId: actor.businessId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      select: { id: true, name: true, slug: true },
    });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "role.created",
        entityType: "Role",
        entityId: created.id,
        summary: `Created role ${created.name}`,
        after: { permissions: permissions.map((permission) => permission.key) },
        changedFields: ["role"],
      },
    });
    return created;
  });

  return role;
}

export async function updateRole(
  actor: ActorContext,
  roleId: string,
  input: { name?: string; description?: string | null; permissions: string[] },
) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, businessId: actor.businessId },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
  });
  if (!role) throw AppError.notFound("Role not found");
  if (role.isProtected) throw AppError.forbidden("Protected system roles cannot be changed");

  // Removing a permission a user relies on is a privileged operation; keep the
  // business safe by refusing to leave a role with no permissions at all.
  if (input.permissions.length === 0) {
    throw AppError.validation("A role must keep at least one permission");
  }

  const permissions = await prisma.permission.findMany({ where: { key: { in: input.permissions } } });
  if (permissions.length !== input.permissions.length) {
    throw AppError.validation("One or more permission keys are unknown");
  }

  const before = role.permissions.map((entry) => entry.permission.key);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.role.update({
      where: { id: roleId },
      data: {
        name: input.name ?? role.name,
        description: input.description ?? role.description,
        permissions: {
          deleteMany: {},
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
      select: { id: true, name: true, slug: true },
    });

    // Permissions are cached in sessions; revoke sessions of affected users so
    // the change takes effect immediately.
    if (input.permissions.length !== before.length || !before.every((key) => input.permissions.includes(key))) {
      const affected = await tx.userRole.findMany({ where: { roleId }, select: { userId: true } });
      if (affected.length > 0) {
        await tx.session.updateMany({
          where: { userId: { in: affected.map((entry) => entry.userId) }, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "role_permissions_changed" },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "role.updated",
        entityType: "Role",
        entityId: roleId,
        summary: `Updated role ${role.name}`,
        before: { permissions: before, name: role.name },
        after: { permissions: input.permissions, name: result.name },
        changedFields: ["role", "permissions"],
      },
    });

    return result;
  });

  return { role: updated, affectedUsers: role._count.users };
}

export async function deleteRole(actor: ActorContext, roleId: string): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, businessId: actor.businessId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw AppError.notFound("Role not found");
  if (role.isProtected || role.isSystem) throw AppError.forbidden("System roles cannot be deleted");
  if (role._count.users > 0) {
    throw AppError.conflict("This role is still assigned to users. Reassign them before deleting the role.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
    await tx.auditLog.create({
      data: {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        actorLabel: actor.actorLabel,
        action: "role.deleted",
        entityType: "Role",
        entityId: roleId,
        summary: `Deleted role ${role.name}`,
        before: { name: role.name, slug: role.slug },
        changedFields: ["role"],
      },
    });
  });
}
