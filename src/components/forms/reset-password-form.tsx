"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/modules/auth/actions";
import { initialActionState } from "@/modules/auth/action-state";
import { Alert, Button, Card, CardContent, FormField, Input } from "@/components/ui/primitives";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialActionState);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
          <p className="text-sm text-slate-500">Passwords must be at least 10 characters and mix character types.</p>
        </div>

        {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <FormField label="New password" htmlFor="newPassword" required error={state.fieldErrors?.newPassword}>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirmPassword" required error={state.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-500">
          <Link href="/login" className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
