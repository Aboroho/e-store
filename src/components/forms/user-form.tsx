"use client";

import { useActionState } from "react";
import Link from "next/link";
import { initialActionState } from "@/modules/auth/action-state";
import { createUserAction, resetUserPasswordAction, updateUserAction } from "@/modules/users/actions";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  NativeSelect,
  badgeVariants,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export interface RoleOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export function CreateUserForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(createUserAction, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>New staff user</CardTitle>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? (
            <Alert variant="success" title={state.message}>
              Temporary password: <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">{state.data?.temporaryPassword}</code>
              <br />
              Share it over a secure channel — the user must change it after signing in.
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" htmlFor="name" required error={state.fieldErrors?.name}>
              <Input id="name" name="name" required autoComplete="off" />
            </FormField>
            <FormField label="Email address" htmlFor="email" required error={state.fieldErrors?.email} hint="Used to sign in.">
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </FormField>
            <FormField label="Phone" htmlFor="phone" error={state.fieldErrors?.phone}>
              <Input id="phone" name="phone" autoComplete="off" />
            </FormField>
            <FormField label="Job title" htmlFor="jobTitle" error={state.fieldErrors?.jobTitle}>
              <Input id="jobTitle" name="jobTitle" autoComplete="off" />
            </FormField>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">
              Roles <span className="text-red-500">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <label key={role.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                  <input type="checkbox" name="roleIds" value={role.id} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
                  <span>
                    <span className="block font-medium text-slate-800">{role.name}</span>
                    {role.description ? <span className="block text-xs text-slate-500">{role.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
            {state.fieldErrors?.roleIds ? <p className="text-xs text-red-600">{state.fieldErrors.roleIds[0]}</p> : null}
          </fieldset>
        </CardContent>
        <CardFooter>
          <Link href="/admin/users" className={cn(badgeVariants({ variant: "neutral" }), "px-3 py-2 text-sm")}>
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create user"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function EditUserForm({
  user,
  roles,
}: {
  user: { id: string; name: string; email: string; phone: string | null; jobTitle: string | null; status: string; roleIds: string[] };
  roles: RoleOption[];
}) {
  const [state, formAction, pending] = useActionState(updateUserAction, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account details</CardTitle>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <input type="hidden" name="userId" value={user.id} />
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" htmlFor="name" required error={state.fieldErrors?.name}>
              <Input id="name" name="name" defaultValue={user.name} required />
            </FormField>
            <FormField label="Email address" htmlFor="email" hint="Email addresses cannot be changed.">
              <Input id="email" value={user.email} disabled readOnly />
            </FormField>
            <FormField label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={user.phone ?? ""} />
            </FormField>
            <FormField label="Job title" htmlFor="jobTitle">
              <Input id="jobTitle" name="jobTitle" defaultValue={user.jobTitle ?? ""} />
            </FormField>
            <FormField label="Status" htmlFor="status" required>
              <NativeSelect id="status" name="status" defaultValue={user.status}>
                <option value="ACTIVE">Active — can sign in</option>
                <option value="SUSPENDED">Suspended — cannot sign in (sessions revoked)</option>
                <option value="DISABLED">Disabled — retained for audit only</option>
              </NativeSelect>
            </FormField>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Roles</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <label key={role.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={role.id}
                    defaultChecked={user.roleIds.includes(role.id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block font-medium text-slate-800">{role.name}</span>
                    {role.description ? <span className="block text-xs text-slate-500">{role.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ResetPasswordForm({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState(resetUserPasswordAction, initialActionState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <input type="hidden" name="userId" value={userId} />
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          <Alert variant="warning" title="Sessions are revoked">
            Setting a password signs the user out everywhere. This keeps account recovery auditable.
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="New password" htmlFor="newPassword" required error={state.fieldErrors?.newPassword}>
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
            </FormField>
            <FormField label="Confirm password" htmlFor="confirmPassword" required error={state.fieldErrors?.confirmPassword}>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="forceChange" defaultChecked className="h-4 w-4 rounded border-slate-300" />
            Require the user to choose a new password at next sign-in
          </label>
        </CardContent>
        <CardFooter>
          <Button type="submit" variant={isSelf ? "default" : "secondary"} disabled={pending}>
            {pending ? "Updating…" : "Update password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
