import { beforeEach, describe, expect, it, vi } from "vitest";
import { formDataToObject, parseInput } from "@/lib/validation";
import { safeRedirectTarget, signInSchema } from "@/modules/auth/schemas";
import { AppError } from "@/lib/errors";
// `vi.mock` calls below are hoisted above the imports, so the action itself runs for
// real while only its database-backed collaborators are replaced.
import { signInAction } from "@/modules/auth/actions";

const { signInWithPassword, setSessionCookie, redirect } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  setSessionCookie: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/auth/service", () => ({
  signInWithPassword,
  signOut: vi.fn(),
  changePassword: vi.fn(),
  createPasswordResetToken: vi.fn(),
  resetPasswordWithToken: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  CUSTOMER_SESSION_COOKIE: "estore_customer_session",
  requestMetadata: async () => ({ ipAddress: "10.0.0.1", userAgent: "vitest" }),
  setSessionCookie,
  clearSessionCookie: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/auth/customer-session", () => ({ clearCustomerSessionCookie: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ allowed: true })),
  RateLimits: { login: { limit: 5, windowSeconds: 300 }, passwordReset: { limit: 5, windowSeconds: 900 } },
}));

/** Build the FormData a browser would post for the given fields. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** Next.js `redirect()` never returns: it throws so the response can be flushed. */
function expectRedirect(target: string) {
  redirect.mockImplementation(() => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${target};303;` });
  });
}

describe("sign in form validation", () => {
  it("accepts a submission where 'keep me signed in' is left unchecked", () => {
    const raw = formDataToObject(
      form({ email: " Owner@Example.com ", password: "ChangeMe!2026", redirectTo: "/admin/orders" }),
    );
    // An unchecked checkbox is simply absent from the payload.
    expect(raw).not.toHaveProperty("remember");

    const parsed = parseInput(signInSchema, raw, "Sign in");
    expect(parsed).toEqual({
      email: "owner@example.com",
      password: "ChangeMe!2026",
      remember: false,
      redirectTo: "/admin/orders",
    });
  });

  it("treats a ticked checkbox as remember me", () => {
    const parsed = parseInput(
      signInSchema,
      formDataToObject(form({ email: "owner@example.com", password: "ChangeMe!2026", remember: "on" })),
      "Sign in",
    );
    expect(parsed.remember).toBe(true);
  });

  it("still rejects an empty password", () => {
    expect(() =>
      parseInput(signInSchema, formDataToObject(form({ email: "owner@example.com", password: "" })), "Sign in"),
    ).toThrowError(/invalid input/);
  });

  it("only allows same-origin redirect targets", () => {
    expect(safeRedirectTarget("/admin/course-offerings/abc/attendance?tab=report")).toBe(
      "/admin/course-offerings/abc/attendance?tab=report",
    );
    expect(safeRedirectTarget("//evil.example.com")).toBe("/admin");
    expect(safeRedirectTarget("https://evil.example.com")).toBe("/admin");
    expect(safeRedirectTarget(undefined)).toBe("/admin");
  });
});

describe("signInAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValue({
      userId: "user-1",
      sessionId: "session-1",
      token: "token-1",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      mustChangePassword: false,
    });
  });

  it("signs in and redirects when 'keep me signed in' is left unchecked", async () => {
    expectRedirect("/admin");

    await expect(
      signInAction({ status: "idle" }, form({ email: "owner@example.com", password: "ChangeMe!2026" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "ChangeMe!2026",
      remember: false,
      ipAddress: "10.0.0.1",
      userAgent: "vitest",
    });
    expect(setSessionCookie).toHaveBeenCalledWith("token-1", new Date("2026-01-01T00:00:00.000Z"));
    expect(redirect).toHaveBeenCalledWith("/admin");
  });

  it("honours the checkbox and the redirect target when both are present", async () => {
    expectRedirect("/admin/inventory");

    await expect(
      signInAction(
        { status: "idle" },
        form({ email: "owner@example.com", password: "ChangeMe!2026", remember: "on", redirectTo: "/admin/inventory" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ remember: true }),
    );
    expect(redirect).toHaveBeenCalledWith("/admin/inventory");
  });

  it("surfaces an authentication failure as a form error", async () => {
    signInWithPassword.mockRejectedValue(AppError.unauthenticated("Email or password is incorrect"));

    const state = await signInAction(
      { status: "idle" },
      form({ email: "owner@example.com", password: "wrong-password" }),
    );

    expect(state).toEqual({ status: "error", message: "Email or password is incorrect" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("reports the offending field when the payload is invalid", async () => {
    const state = await signInAction({ status: "idle" }, form({ email: "owner@example.com", password: "" }));

    expect(state.status).toBe("error");
    expect(state.fieldErrors).toHaveProperty("password");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
