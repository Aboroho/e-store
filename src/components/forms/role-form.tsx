"use client";

import { useActionState, useMemo, useState } from "react";
import { initialActionState } from "@/modules/auth/actions";
import { createRoleAction, updateRoleAction } from "@/modules/users/actions";
import { Alert, Badge, Button, Card, CardContent, CardFooter, CardHeader, CardTitle, FormField, Input, Textarea } from "@/components/ui/primitives";

export interface PermissionOption {
  key: string;
  group: string;
  label: string;
  description?: string | null;
  isDangerous?: boolean;
}

function PermissionMatrix({
  permissions,
  selected,
  onToggle,
}: {
  permissions: PermissionOption[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const map = new Map<string, PermissionOption[]>();
    for (const permission of permissions) {
      if (filter && !`${permission.key} ${permission.label} ${permission.group}`.toLowerCase().includes(filter.toLowerCase())) continue;
      const list = map.get(permission.group) ?? [];
      list.push(permission);
      map.set(permission.group, list);
    }
    return [...map.entries()];
  }, [permissions, filter]);

  return (
    <div className="space-y-4">
      <Input placeholder="Filter permissions…" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter permissions" />
      <div className="space-y-4">
        {groups.map(([group, items]) => (
          <div key={group} className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <p className="text-sm font-semibold text-slate-700">{group}</p>
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() => {
                  const keys = items.map((item) => item.key);
                  const allSelected = keys.every((key) => selected.includes(key));
                  keys.forEach((key) => {
                    if (allSelected && selected.includes(key)) onToggle(key);
                    if (!allSelected && !selected.includes(key)) onToggle(key);
                  });
                }}
              >
                Toggle all
              </button>
            </div>
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:bg-slate-50"
                  title={permission.description ?? permission.key}
                >
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    checked={selected.includes(permission.key)}
                    onChange={() => onToggle(permission.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="block font-medium text-slate-800">{permission.label}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{permission.key}</span>
                  </span>
                  {permission.isDangerous ? (
                    <Badge variant="danger" className="ml-auto">
                      sensitive
                    </Badge>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? <p className="text-sm text-slate-500">No permissions match the filter.</p> : null}
      </div>
    </div>
  );
}

export function CreateRoleForm({ permissions }: { permissions: PermissionOption[] }) {
  const [state, formAction, pending] = useActionState(createRoleAction, initialActionState);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (key: string) =>
    setSelected((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Role details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Role name" htmlFor="name" required error={state.fieldErrors?.name}>
              <Input id="name" name="name" required placeholder="Warehouse supervisor" />
            </FormField>
            <FormField label="Slug" htmlFor="slug" required hint="Lower case identifier used in code and audit logs." error={state.fieldErrors?.slug}>
              <Input id="slug" name="slug" required placeholder="warehouse-supervisor" />
            </FormField>
          </div>
          <FormField label="Description" htmlFor="description">
            <Textarea id="description" name="description" rows={2} placeholder="What this role is allowed to do" />
          </FormField>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Permissions <span className="text-red-500">*</span> ({selected.length} selected)
            </p>
            <PermissionMatrix permissions={permissions} selected={selected} onToggle={toggle} />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending || selected.length === 0}>
            {pending ? "Creating…" : "Create role"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

export function EditRoleForm({
  role,
  permissions,
}: {
  role: { id: string; name: string; slug: string; description: string | null; permissions: string[]; isProtected: boolean };
  permissions: PermissionOption[];
}) {
  const [state, formAction, pending] = useActionState(updateRoleAction, initialActionState);
  const [selected, setSelected] = useState<string[]>(role.permissions);

  const toggle = (key: string) =>
    setSelected((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>{role.isProtected ? "Protected system role" : "Role details"}</CardTitle>
          {role.isProtected ? (
            <Badge variant="warning">permissions locked</Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <input type="hidden" name="roleId" value={role.id} />
          {state.status === "error" && state.message ? <Alert variant="danger">{state.message}</Alert> : null}
          {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
          {role.isProtected ? (
            <Alert variant="warning" title="This role cannot be edited">
              The owner role always holds every permission and cannot be demoted, renamed or deleted.
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Role name" htmlFor="name" required>
              <Input id="name" name="name" defaultValue={role.name} required disabled={role.isProtected} />
            </FormField>
            <FormField label="Slug" htmlFor="slug" hint="Slugs cannot be changed once the role exists.">
              <Input id="slug" value={role.slug} disabled readOnly />
            </FormField>
          </div>
          <FormField label="Description" htmlFor="description">
            <Textarea id="description" name="description" rows={2} defaultValue={role.description ?? ""} disabled={role.isProtected} />
          </FormField>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">
              Permissions ({selected.length} selected)
            </p>
            {role.isProtected ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {permissions.map((permission) => (
                  <div key={permission.key} className="rounded-md bg-slate-50 px-2 py-1.5 text-sm">
                    <span className="block font-medium text-slate-800">{permission.label}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{permission.key}</span>
                  </div>
                ))}
              </div>
            ) : (
              <PermissionMatrix permissions={permissions} selected={selected} onToggle={toggle} />
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending || role.isProtected}>
            {pending ? "Saving…" : "Save role"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
