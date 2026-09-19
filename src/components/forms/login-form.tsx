"use client";

import { useActionState } from "react";
import Link from "next/link";
import { initialActionState, signInAction } from "@/modules/auth/actions";
import { Alert, Button, Card, CardContent, FormField, Input } from "@/components/ui/primitives";

export function LoginForm({ redirectTo, notice }: { redirectTo?: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialActionState);

  return (
    <Card className="w-full max-w-md">
      <CardContent className="space-y-5 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-500">Use your staff account to access the management platform.</p>
        </div>

        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}

        <form action={formAction} className="space-y-4">
          {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
          <FormField label="Email address" htmlFor="email" required error={state.fieldErrors?.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              placeholder="you@example.com"
              aria-invalid={Boolean(state.fieldErrors?.email)}
            />
          </FormField>

          <FormField label="Password" htmlFor="password" required error={state.fieldErrors?.password}>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.fieldErrors?.password)}
            />
          </FormField>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="remember" className="h-4 w-4 rounded border-slate-300" />
              Keep me signed in
            </label>
            <Link href="/forgot-password" className="text-sm text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
