"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import {
  createRole,
  createStaffUser,
  deleteRole,
  resetUserPassword,
  setUserStatus,
  updateRole,
  updateStaffUser,
  type ActorContext,
} from "@/modules/users/service";
import {
  createRoleSchema,
  createUserSchema,
  resetUserPasswordSchema,
  updateUserSchema,
} from "@/modules/users/schemas";
import type { ActionState } from "@/modules/auth/action-state";

async function actorContext(permission: string): Promise<ActorContext> {
  const session = await requireSession();
  assertPermission(session, permission);
  return {
    userId: session.id,
    businessId: session.businessId,
    isOwner: session.isOwner,
    actorLabel: session.email,
  };
}

function toState(error: unknown, fallbackMessage: string): ActionState {
  if (error instanceof AppError) {
    const details = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: string; message?: string }>).map((issue) => [
            issue.path ?? "_",
            [issue.message ?? "Invalid value"],
          ]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors: details };
  }
  return { status: "error", message: fallbackMessage };
}

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor: ActorContext;
  try {
    actor = await actorContext("user.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage users");
  }

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(
      createUserSchema,
      {
        ...raw,
        roleIds: formData.getAll("roleIds").map(String),
        sendInvite: raw.sendInvite === "on" || raw.sendInvite === "true",
      },
      "Create user",
    );

    const result = await createStaffUser(actor, parsed);
    revalidatePath("/admin/users");
    return {
      status: "success",
      message: `User ${result.user.email} created.`,
      data: { temporaryPassword: result.temporaryPassword, userId: result.user.id },
    };
  } catch (error) {
    return toState(error, "Unable to create the user");
  }
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor: ActorContext;
  try {
    actor = await actorContext("user.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage users");
  }

  try {
    const raw = formDataToObject(formData);
    const userId = String(raw.userId ?? "");
    const parsed = parseInput(
      updateUserSchema,
      { ...raw, roleIds: formData.getAll("roleIds").map(String) },
      "Update user",
    );
    await updateStaffUser(actor, userId, parsed);
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/users");
    return { status: "success", message: "User updated." };
  } catch (error) {
    return toState(error, "Unable to update the user");
  }
}

export async function setUserStatusAction(userId: string, status: "ACTIVE" | "SUSPENDED" | "DISABLED"): Promise<void> {
  const actor = await actorContext("user.manage");
  await setUserStatus(actor, userId, status);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function resetUserPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor: ActorContext;
  try {
    actor = await actorContext("user.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage users");
  }

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(resetUserPasswordSchema, {
      ...raw,
      forceChange: raw.forceChange === "on" || raw.forceChange === "true",
    });
    if (parsed.newPassword !== parsed.confirmPassword) {
      return { status: "error", message: "The password and confirmation do not match" };
    }

    await resetUserPassword(actor, {
      userId: parsed.userId,
      newPassword: parsed.newPassword,
      forceChange: parsed.forceChange,
    });
    revalidatePath(`/admin/users/${parsed.userId}`);
    return { status: "success", message: "Password updated. The user's sessions were signed out." };
  } catch (error) {
    return toState(error, "Unable to reset the password");
  }
}

export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor: ActorContext;
  try {
    actor = await actorContext("role.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage roles");
  }

  try {
    const raw = formDataToObject(formData);
    const parsed = parseInput(createRoleSchema, {
      ...raw,
      permissions: formData.getAll("permissions").map(String),
    });

    const role = await createRole(actor, parsed);
    revalidatePath("/admin/roles");
    redirect(`/admin/roles/${role.id}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return toState(error, "Unable to create the role");
  }
}

export async function updateRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let actor: ActorContext;
  try {
    actor = await actorContext("role.manage");
  } catch (error) {
    return toState(error, "You are not allowed to manage roles");
  }

  const raw = formDataToObject(formData);
  const roleId = String(raw.roleId ?? "");
  const permissions = formData.getAll("permissions").map(String);

  try {
    const result = await updateRole(actor, roleId, {
      name: typeof raw.name === "string" ? raw.name : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
      permissions,
    });
    revalidatePath("/admin/roles");
    revalidatePath(`/admin/roles/${roleId}`);
    return {
      status: "success",
      message: `Role updated. ${result.affectedUsers} user session(s) were signed out so the change applies immediately.`,
    };
  } catch (error) {
    return toState(error, "Unable to update the role");
  }
}

export async function deleteRoleAction(roleId: string): Promise<void> {
  const actor = await actorContext("role.manage");
  await deleteRole(actor, roleId);
  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
