import "server-only";
import { AppError } from "@/lib/errors";

/**
 * Authorisation helpers.
 *
 * Permissions are always evaluated on the server from the authenticated user's
 * roles as stored in the database. Hiding a UI element is never sufficient.
 */

export interface PermissionSubject {
  id: string;
  /** The business the subject belongs to. All business-owned rows are scoped by it. */
  businessId: string;
  isOwner?: boolean;
  permissions: ReadonlySet<string> | readonly string[];
}

export function toPermissionSet(permissions: ReadonlySet<string> | readonly string[]): Set<string> {
  return permissions instanceof Set ? new Set(permissions) : new Set(permissions);
}

/** Does the subject hold this permission? */
export function can(subject: PermissionSubject | null | undefined, permission: string): boolean {
  if (!subject) return false;
  if (subject.isOwner) return true;
  const set = toPermissionSet(subject.permissions);
  if (set.has("*")) return true;
  return set.has(permission);
}

/** Does the subject hold every permission? */
export function canAll(subject: PermissionSubject | null | undefined, permissions: string[]): boolean {
  return permissions.every((permission) => can(subject, permission));
}

/** Does the subject hold at least one of the permissions? */
export function canAny(subject: PermissionSubject | null | undefined, permissions: string[]): boolean {
  return permissions.some((permission) => can(subject, permission));
}

/** Throw a 403 when the subject lacks the permission. */
export function assertPermission(subject: PermissionSubject | null | undefined, permission: string): void {
  if (!can(subject, permission)) {
    throw AppError.forbidden(`Missing permission: ${permission}`);
  }
}

/** Throw a 401 when there is no subject, otherwise assert the permission. */
export function requirePermission(subject: PermissionSubject | null | undefined, permission: string): PermissionSubject {
  if (!subject) throw AppError.unauthenticated();
  assertPermission(subject, permission);
  return subject;
}

/** Build a set of permission keys from a user record with roles included. */
export function permissionsFromUser(user: {
  isOwner?: boolean | null;
  roles?: Array<{ role: { permissions: Array<{ permission: { key: string } }> } }>;
}): Set<string> {
  const result = new Set<string>();
  for (const userRole of user.roles ?? []) {
    for (const rolePermission of userRole.role.permissions ?? []) {
      result.add(rolePermission.permission.key);
    }
  }
  return result;
}
