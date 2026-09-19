import { z } from "zod";
import { zBooleanFromForm } from "@/lib/validation";

/**
 * Validation schemas for the authentication server actions.
 *
 * These must NOT live in a `"use server"` file: such a file may only export async
 * functions, and keeping the schemas here also lets them be unit tested directly
 * (see `tests/lib/auth-signin.test.ts`).
 */

/**
 * Sign in form payload.
 *
 * `remember` comes from a plain `<input type="checkbox">`, so the browser posts
 * `remember=on` when it is ticked and omits the key entirely when it is not.
 *
 * In Zod 4 an object key is only skipped when it is absent if the value schema is
 * itself optional; a `z.undefined()` member inside a union does not mark it optional.
 * The previous `z.union([z.literal("on"), …, z.undefined()])` therefore rejected every
 * sign-in that left the box unchecked with "expected nonoptional, received undefined",
 * which surfaced as `Sign in: invalid input` with a `remember` field error. `.default()`
 * both makes the key optional and keeps the parsed value a real boolean.
 */
export const signInSchema = z.object({
  email: z.string().trim().min(3).max(200).toLowerCase(),
  password: z.string().min(1, "Enter your password").max(200),
  remember: zBooleanFromForm.default(false),
  redirectTo: z.string().optional(),
});

export type SignInValues = z.infer<typeof signInSchema>;

/** Same-origin paths only; anything else falls back to the admin home. */
export function safeRedirectTarget(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/admin";
  return value;
}
