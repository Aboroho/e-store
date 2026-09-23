import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, withTransaction } from "@/lib/db/client";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { permissionsFromUser } from "@/lib/permissions";
import { logger } from "@/lib/logging";
import { staffLoginPath } from "@/lib/auth/paths";

/**
 * Staff/admin session management.
 *
 * The cookie only carries an opaque random token; the database stores its
 * SHA-256 hash together with expiry and revocation state. Sessions are always
 * validated on the server before any privileged work happens.
 */

export const SESSION_COOKIE = "estore_session";
export const CUSTOMER_SESSION_COOKIE = "estore_customer_session";

const SESSION_TTL_HOURS = 12;
const SESSION_TTL_REMEMBER_HOURS = 24 * 30;
const LAST_USED_TOUCH_MINUTES = 5;

export interface SessionUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  isOwner: boolean;
  avatarMediaId: string | null;
  jobTitle: string | null;
  lastLoginAt: Date | null;
  roles: Array<{ id: string; slug: string; name: string }>;
  permissions: Set<string>;
  sessionId: string;
}

const userWithAccess = {
  roles: {
    include: {
      role: {
        include: {
          permissions: { include: { permission: { select: { key: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userWithAccess }>;

function toSessionUser(user: UserWithAccess, sessionId: string): SessionUser {
  return {
    id: user.id,
    businessId: user.businessId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    isOwner: user.isOwner,
    avatarMediaId: user.avatarMediaId,
    jobTitle: user.jobTitle,
    lastLoginAt: user.lastLoginAt,
    roles: user.roles.map((entry) => ({ id: entry.role.id, slug: entry.role.slug, name: entry.role.name })),
    permissions: permissionsFromUser(user),
    sessionId,
  };
}

export interface CreateSessionOptions {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  remember?: boolean;
}

export async function createSession(options: CreateSessionOptions): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = generateToken(32);
  const expiresAt = new Date(
    Date.now() + (options.remember ? SESSION_TTL_REMEMBER_HOURS : SESSION_TTL_HOURS) * 60 * 60 * 1000,
  );

  const session = await prisma.session.create({
    data: {
      userId: options.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent?.slice(0, 400) ?? null,
    },
  });

  return { token, expiresAt, sessionId: session.id };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/** Resolve the current staff session (cached per request). */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { include: userWithAccess },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.deletedAt || session.user.status !== "ACTIVE") return null;

  // Touch `lastUsedAt` at most every few minutes to avoid write amplification.
  if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_TOUCH_MINUTES * 60 * 1000) {
    prisma.session
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(), ipAddress: session.ipAddress },
      })
      .catch((error: unknown) => logger.warn("Failed to touch session", { sessionId: session.id }, error));
  }

  return toSessionUser(session.user, session.id);
});

/** Require an authenticated staff session. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw AppError.unauthenticated("You must sign in to continue");
  return session;
}

/**
 * Require a staff session in a Server Component (layouts and pages).
 *
 * `requireSession()` throws `AppError` so API routes and actions can return 401.
 * Layouts have no parent error boundary, so that throw surfaces as an uncaught
 * overlay. Pages send the visitor to sign-in instead.
 */
export async function requirePageSession(): Promise<SessionUser> {
  const session = await getSession();
  if (session) return session;

  const cookieStore = await cookies();
  const hadCookie = Boolean(cookieStore.get(SESSION_COOKIE)?.value);
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "/admin";
  const search = headerList.get("x-search") ?? "";
  const redirectTo = pathname.startsWith("/admin") ? `${pathname}${search}` : "/admin";
  redirect(staffLoginPath({ redirectTo, sessionExpired: hadCookie }));
}

export async function revokeSession(sessionId: string, reason?: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason ?? "user_logout" },
  });
}

export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.count;
}

/** Record a successful or failed sign-in attempt for auditing. */
export async function recordLoginEvent(input: {
  type: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGOUT" | "PASSWORD_CHANGED" | "PASSWORD_RESET_REQUESTED" | "SESSION_REVOKED" | "RATE_LIMITED" | "PERMISSION_DENIED";
  userId?: string | null;
  businessId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        businessId: input.businessId ?? null,
        userId: input.userId ?? null,
        type: input.type,
        success: input.success ?? true,
        email: input.email ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    logger.warn("Failed to record security event", { type: input.type }, error);
  }
}

/** Best effort request metadata for security events and audit logs. */
export async function requestMetadata(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ipAddress = forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : headerList.get("x-real-ip");
    return { ipAddress, userAgent: headerList.get("user-agent") };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/** Update the last login timestamp and reset failed attempt counters. */
export async function markLoginSuccess(userId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  });
}
