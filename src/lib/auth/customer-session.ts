import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";
import { generateToken, hashToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Customer sessions are stored in their own table and cookie so that a
 * customer session can never be mistaken for a staff session.
 */

const CUSTOMER_SESSION_TTL_DAYS = 30;

export interface CustomerSessionUser {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  phoneNormalized: string;
  email: string | null;
  status: string;
  hasAccount: boolean;
  sessionId: string;
}

export async function createCustomerSession(input: {
  customerId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.customerSession.create({
    data: {
      customerId: input.customerId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function setCustomerSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearCustomerSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export const getCustomerSession = cache(async (): Promise<CustomerSessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { customer: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  if (session.customer.deletedAt || session.customer.status !== "ACTIVE") return null;

  const customer = session.customer;
  return {
    id: customer.id,
    businessId: customer.businessId,
    name: customer.name,
    phone: customer.phone ?? customer.phoneNormalized,
    phoneNormalized: customer.phoneNormalized,
    email: customer.email,
    status: customer.status,
    hasAccount: customer.hasAccount,
    sessionId: session.id,
  };
});

export async function revokeCustomerSession(sessionId: string): Promise<void> {
  await prisma.customerSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
