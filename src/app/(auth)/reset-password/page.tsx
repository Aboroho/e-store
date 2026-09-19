import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          <Alert variant="danger" title="Missing reset token">
            This page requires a valid password reset link.
          </Alert>
          <Link href="/forgot-password" className="text-sm text-brand-600 hover:underline">
            Request a new reset link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} />;
}
