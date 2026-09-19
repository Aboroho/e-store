"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/modules/auth/actions";
import { initialActionState } from "@/modules/auth/action-state";
import { Alert, Button, Card, CardContent, FormField, Input } from "@/components/ui/primitives";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialActionState);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Reset your password</h1>
          <p className="text-sm text-slate-500">
            Enter the email address of your staff account and we will create a single-use reset link.
          </p>
        </div>

        {state.status === "success" ? (
          <Alert variant="success" title="Request received">
            {state.message}
            {state.data?.resetPath ? (
              <p className="mt-2">
                Development link:{" "}
                <Link href={state.data.resetPath} className="font-medium underline">
                  open reset form
                </Link>
              </p>
            ) : null}
          </Alert>
        ) : null}
        {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}

        <form action={formAction} className="space-y-4">
          <FormField label="Email address" htmlFor="email" required>
            <Input id="email" name="email" type="email" required autoComplete="username" />
          </FormField>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating link…" : "Create reset link"}
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
