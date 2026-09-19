import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError, ErrorCodes } from "@/lib/errors";
import { DUMMY_PASSWORD_HASH, evaluatePasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, recordLoginEvent, revokeSession } from "@/lib/auth/session";
import { consumeRateLimit, RateLimits } from "@/lib/rate-limit";
import { generateToken, hashToken } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logging";

/**
 * Authentication domain service.
 *
 * All credential checks, lockouts, session creation and security events live
 * here so that API routes, server actions and future SSO flows share exactly
 * one implementation.
 */

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

export interface SignInInput {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  remember?: boolean;
}

export interface SignInResult {
  userId: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
}

export async function signInWithPassword(input: SignInInput): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();

  // Brute force protection: per email address and per IP address.
  const emailLimit = await consumeRateLimit({
    scope: "login:email",
    key: email,
    limit: RateLimits.login.limit,
    windowSeconds: RateLimits.login.windowSeconds,
  });
  const ipLimit = input.ipAddress
    ? await consumeRateLimit({
        scope: "login:ip",
        key: input.ipAddress,
        limit: RateLimits.login.limit * 3,
        windowSeconds: RateLimits.login.windowSeconds,
      })
    : { allowed: true };

  if (!emailLimit.allowed || !ipLimit.allowed) {
    await recordLoginEvent({
      type: "RATE_LIMITED",
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: false,
    });
    throw AppError.rateLimited("Too many sign-in attempts. Please wait a few minutes and try again.");
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      businessId: true,
      email: true,
      name: true,
      passwordHash: true,
      status: true,
      isOwner: true,
      failedLoginCount: true,
      lockedUntil: true,
      mustChangePassword: true,
    },
  });

  if (!user) {
    // Equalise timing so the response does not reveal whether the account exists.
    await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
    await recordLoginEvent({ type: "LOGIN_FAILED", email, ipAddress: input.ipAddress, userAgent: input.userAgent, success: false });
    throw new AppError({ code: ErrorCodes.UNAUTHENTICATED, message: "Invalid email or password" });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordLoginEvent({
      type: "LOGIN_FAILED",
      userId: user.id,
      businessId: user.businessId,
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: false,
      metadata: { reason: "locked" },
    });
    throw new AppError({
      code: ErrorCodes.FORBIDDEN,
      message: "This account is temporarily locked after too many failed attempts. Try again later.",
    });
  }

  if (user.status !== "ACTIVE") {
    await recordLoginEvent({
      type: "LOGIN_FAILED",
      userId: user.id,
      businessId: user.businessId,
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: false,
      metadata: { reason: user.status },
    });
    throw new AppError({ code: ErrorCodes.FORBIDDEN, message: "This account is not active. Contact an administrator." });
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    const failedCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failedCount,
        lockedUntil: failedCount >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    await recordLoginEvent({
      type: "LOGIN_FAILED",
      userId: user.id,
      businessId: user.businessId,
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: false,
      metadata: { failedCount },
    });
    throw new AppError({ code: ErrorCodes.UNAUTHENTICATED, message: "Invalid email or password" });
  }

  const session = await createSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    remember: input.remember,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });

  await recordLoginEvent({
    type: "LOGIN_SUCCESS",
    userId: user.id,
    businessId: user.businessId,
    email,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    userId: user.id,
    sessionId: session.sessionId,
    token: session.token,
    expiresAt: session.expiresAt,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function signOut(sessionId: string, userId: string, businessId?: string | null): Promise<void> {
  await revokeSession(sessionId, "user_logout");
  await recordLoginEvent({ type: "LOGOUT", userId, businessId });
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  actorLabel?: string;
  ipAddress?: string | null;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, name: true, passwordHash: true, businessId: true },
  });
  if (!user) throw AppError.notFound("User not found");

  const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentValid) {
    throw new AppError({ code: ErrorCodes.UNAUTHENTICATED, message: "Current password is incorrect" });
  }

  const policy = evaluatePasswordPolicy(input.newPassword, { email: user.email, name: user.name });
  if (!policy.valid) {
    throw AppError.validation("The new password does not meet the security policy", policy.problems);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
    // Changing a password invalidates every other session.
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "password_changed" },
    });
    await tx.securityEvent.create({
      data: { businessId: user.businessId, userId: user.id, type: "PASSWORD_CHANGED", ipAddress: input.ipAddress ?? null },
    });
  });

  await recordAudit({
    businessId: user.businessId,
    actorUserId: user.id,
    actorLabel: input.actorLabel ?? user.email,
    action: "auth.password_changed",
    entityType: "User",
    entityId: user.id,
    summary: "Password changed",
  });
}

/**
 * Create a password reset token.
 * The caller is responsible for delivering it; no email provider is configured
 * by default, so the token is returned and the UI decides how to present it.
 */
export async function createPasswordResetToken(email: string): Promise<{ token: string; userId: string } | null> {
  const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase(), deletedAt: null } });
  if (!user) {
    // Do not reveal whether the account exists.
    logger.info("Password reset requested for unknown email", { email });
    return null;
  }

  const token = generateToken(32);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  await recordLoginEvent({ type: "PASSWORD_RESET_REQUESTED", userId: user.id, businessId: user.businessId, email: user.email });
  return { token, userId: user.id };
}

export async function resetPasswordWithToken(input: { token: string; newPassword: string; ipAddress?: string | null }): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { user: { select: { id: true, email: true, name: true, businessId: true } } },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw AppError.validation("This password reset link is invalid or has expired");
  }

  const policy = evaluatePasswordPolicy(input.newPassword, { email: record.user.email, name: record.user.name });
  if (!policy.valid) {
    throw AppError.validation("The new password does not meet the security policy", policy.problems);
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.session.updateMany({
      where: { userId: record.user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "password_reset" },
    });
    await tx.securityEvent.create({
      data: { businessId: record.user.businessId, userId: record.user.id, type: "PASSWORD_CHANGED", ipAddress: input.ipAddress ?? null },
    });
  });

  await recordAudit({
    businessId: record.user.businessId,
    actorType: "SYSTEM",
    actorUserId: record.user.id,
    action: "auth.password_reset_completed",
    entityType: "User",
    entityId: record.user.id,
    summary: "Password reset using a recovery token",
  });
}
