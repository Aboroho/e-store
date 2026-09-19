import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { signInWithPassword, changePassword } from "@/modules/auth/service";
import { AppError } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";

/**
 * Integration tests against the development PostgreSQL database.
 *
 * They exercise the real service layer (no mocks): rate limiting, lockout,
 * password verification and session rows are all produced by the same code the
 * application runs. The seeded owner account is used for the happy path.
 */

const OWNER_EMAIL = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").toLowerCase();
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "ChangeMe!2026";

async function databaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const reachable = await databaseReachable();

describe.skipIf(!reachable)("authentication service (database)", () => {
  beforeAll(async () => {
    // Clean up rate-limit buckets so repeated local runs are deterministic.
    await prisma.rateLimitBucket.deleteMany({ where: { scope: { in: ["login:email", "login:ip"] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a wrong password without revealing whether the account exists", async () => {
    await expect(
      signInWithPassword({ email: OWNER_EMAIL, password: "definitely-not-the-password", ipAddress: "10.0.0.1" }),
    ).rejects.toThrowError(/Invalid email or password/);

    await expect(
      signInWithPassword({ email: "nobody@example.com", password: "definitely-not-the-password", ipAddress: "10.0.0.2" }),
    ).rejects.toThrowError(/Invalid email or password/);
  });

  it("records the failed attempt and a security event", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    expect(user.failedLoginCount).toBeGreaterThan(0);
    const events = await prisma.securityEvent.count({ where: { type: "LOGIN_FAILED", userId: user.id } });
    expect(events).toBeGreaterThan(0);
  });

  it("signs in with valid credentials, creates a session row and resets the failure count", async () => {
    const result = await signInWithPassword({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(result.token.length).toBeGreaterThan(20);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(typeof result.mustChangePassword).toBe("boolean");
    expect(typeof result.sessionId).toBe("string");

    const session = await prisma.session.findFirst({
      where: { userId: result.userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    expect(session).not.toBeNull();
    expect(session?.ipAddress).toBe("127.0.0.1");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lastLoginAt).not.toBeNull();

    // The stored hash must never equal the plain text.
    expect(user.passwordHash).not.toBe(OWNER_PASSWORD);
    await expect(verifyPassword(OWNER_PASSWORD, user.passwordHash)).resolves.toBe(true);
  });

  it("enforces the password policy when changing a password", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    await expect(
      changePassword({
        userId: user.id,
        currentPassword: OWNER_PASSWORD,
        newPassword: "short",
        actorLabel: "test",
      }),
    ).rejects.toThrowError(AppError);

    await expect(
      changePassword({
        userId: user.id,
        currentPassword: "wrong-current-password",
        newPassword: "Warehouse-2026!",
        actorLabel: "test",
      }),
    ).rejects.toThrowError(/current password/i);
  });

  it("locks an account after repeated failures", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    const before = owner.lockedUntil;

    await prisma.rateLimitBucket.deleteMany({ where: { scope: "login:email", key: OWNER_EMAIL } });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await signInWithPassword({ email: OWNER_EMAIL, password: `wrong-${attempt}`, ipAddress: "10.9.9.9" }).catch(() => {
        // expected to fail
      });
    }

    const after = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
    expect(after.lockedUntil).not.toBeNull();
    expect(after.lockedUntil?.getTime()).toBeGreaterThanOrEqual(after.updatedAt.getTime() - 1_000);

    if (after.lockedUntil && after.lockedUntil.getTime() > Date.now()) {
      await expect(
        signInWithPassword({ email: OWNER_EMAIL, password: OWNER_PASSWORD, ipAddress: "10.9.9.9" }),
      ).rejects.toThrowError();
    }

    // Leave the account usable for the next run.
    await prisma.user.update({
      where: { id: owner.id },
      data: { lockedUntil: null, failedLoginCount: 0 },
    });
    await prisma.rateLimitBucket.deleteMany({ where: { scope: { in: ["login:email", "login:ip"] } } });
    expect(before === null || before instanceof Date).toBe(true);
  });
});
