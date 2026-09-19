"use client";

import { useActionState } from "react";
import { changePasswordAction, initialActionState } from "@/modules/auth/actions";
import { Alert, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, FormField, Input } from "@/components/ui/primitives";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <FormField label="Current password" htmlFor="currentPassword" required error={state.fieldErrors?.currentPassword}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </FormField>
          <FormField
            label="New password"
            htmlFor="newPassword"
            required
            hint="At least 10 characters with three of: upper case, lower case, numbers, symbols."
            error={state.fieldErrors?.newPassword}
          >
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
          </FormField>
          <FormField label="Confirm new password" htmlFor="confirmPassword" required error={state.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required />
          </FormField>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Updating…" : "Update password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
