"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { formDataToObject, parseInput } from "@/lib/validation";
import { requestMetadata, clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth/session";
import { clearCustomerSessionCookie } from "@/lib/auth/customer-session";
import { enforceRateLimit, RateLimits } from "@/lib/rate-limit";
import { changePassword, createPasswordResetToken, resetPasswordWithToken, signInWithPassword, signOut } from "@/modules/auth/service";
import { type ActionState } from "@/modules/auth/action-state";
import { safeRedirectTarget, signInSchema } from "@/modules/auth/schemas";
import { env } from "@/lib/env";
import { logger } from "@/lib/logging";

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formDataToObject(formData);
  const meta = await requestMetadata();

  let parsed: z.infer<typeof signInSchema>;
  try {
    parsed = parseInput(signInSchema, raw, "Sign in");
  } catch (error) {
    if (error instanceof AppError) {
      return { status: "error", message: error.message, fieldErrors: groupIssues(error.details) };
    }
    throw error;
  }

  try {
    const result = await signInWithPassword({
      email: parsed.email,
      password: parsed.password,
      remember: parsed.remember,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    await setSessionCookie(result.token, result.expiresAt);
  } catch (error) {
    if (error instanceof AppError) {
      return { status: "error", message: error.message };
    }
    logger.error("Unexpected sign-in failure", error);
    return { status: "error", message: "Unable to sign in right now. Please try again." };
  }

  redirect(safeRedirectTarget(parsed.redirectTo));
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await signOut(session.sessionId, session.id, session.businessId);
  }
  await clearSessionCookie();
  await clearCustomerSessionCookie();
  redirect("/login");
}

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
    confirmPassword: z.string().min(10).max(200),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "The new password and confirmation do not match",
    path: ["confirmPassword"],
  });

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { status: "error", message: "Your session has expired. Please sign in again." };

  const meta = await requestMetadata();
  let parsed: z.infer<typeof passwordChangeSchema>;
  try {
    parsed = parseInput(passwordChangeSchema, formDataToObject(formData), "Change password");
  } catch (error) {
    if (error instanceof AppError) {
      return { status: "error", message: error.message, fieldErrors: groupIssues(error.details) };
    }
    throw error;
  }

  try {
    await enforceRateLimit({ scope: "password:change", key: session.id, ...RateLimits.passwordReset });
    await changePassword({
      userId: session.id,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
      actorLabel: session.email,
      ipAddress: meta.ipAddress,
    });
    // Password change revokes all sessions including this one.
    await clearSessionCookie();
  } catch (error) {
    if (error instanceof AppError) return { status: "error", message: error.message };
    logger.error("Unexpected password change failure", error);
    return { status: "error", message: "Unable to change the password right now." };
  }

  redirect("/login?passwordChanged=1");
}

const forgotSchema = z.object({ email: z.string().trim().min(3).max(200).toLowerCase() });

export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let parsed: z.infer<typeof forgotSchema>;
  try {
    parsed = parseInput(forgotSchema, formDataToObject(formData), "Password reset");
  } catch {
    return { status: "error", message: "Enter a valid email address" };
  }

  await enforceRateLimit({
    scope: "password:forgot",
    key: parsed.email,
    ...RateLimits.passwordReset,
  }).catch(() => undefined);

  const result = await createPasswordResetToken(parsed.email);
  const data: Record<string, string> = {};
  if (result && env().NODE_ENV !== "production") {
    // Without a configured mail provider the link is surfaced to the operator
    // so that self-hosted installs remain usable. Never done in production.
    data.resetPath = `/reset-password?token=${result.token}`;
  }

  return {
    status: "success",
    message: "If an account exists for that email address, a password reset link has been created.",
    data,
  };
}

const resetSchema = z.object({
  token: z.string().min(10).max(400),
  newPassword: z.string().min(10).max(200),
  confirmPassword: z.string().min(10).max(200),
});

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const meta = await requestMetadata();
  let parsed: z.infer<typeof resetSchema>;
  try {
    parsed = parseInput(resetSchema, formDataToObject(formData), "Reset password");
  } catch (error) {
    if (error instanceof AppError) return { status: "error", message: error.message, fieldErrors: groupIssues(error.details) };
    throw error;
  }

  if (parsed.newPassword !== parsed.confirmPassword) {
    return { status: "error", message: "The new password and confirmation do not match" };
  }

  try {
    await resetPasswordWithToken({
      token: parsed.token,
      newPassword: parsed.newPassword,
      ipAddress: meta.ipAddress,
    });
  } catch (error) {
    if (error instanceof AppError) return { status: "error", message: error.message };
    logger.error("Unexpected password reset failure", error);
    return { status: "error", message: "Unable to reset the password right now." };
  }

  revalidatePath("/login");
  redirect("/login?passwordReset=1");
}

function groupIssues(details: unknown): Record<string, string[]> | undefined {
  if (!Array.isArray(details)) return undefined;
  const grouped: Record<string, string[]> = {};
  for (const issue of details as Array<{ path?: string; message?: string }>) {
    const key = issue.path ?? "_";
    (grouped[key] ??= []).push(issue.message ?? "Invalid value");
  }
  return grouped;
}
