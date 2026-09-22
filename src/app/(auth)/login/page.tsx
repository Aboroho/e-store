import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/paths";
import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const redirectTo = safeRedirectPath(typeof params.redirectTo === "string" ? params.redirectTo : params.next);
  if (session) {
    redirect(redirectTo);
  }

  const notice =
    params.passwordReset === "1"
      ? "Your password has been reset. Sign in with your new password."
      : params.passwordChanged === "1"
        ? "Your password has been changed. Sign in again to continue."
        : params.sessionExpired === "1"
          ? "Your session expired. Please sign in again."
          : undefined;

  return (
    <LoginForm
      redirectTo={redirectTo === "/admin" ? undefined : redirectTo}
      notice={notice}
    />
  );
}
