"use client";

import { useActionState } from "react";
import { initialActionState } from "@/modules/auth/action-state";
import { Alert, FormField, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import {
  addDomainAction,
  addNavigationItemAction,
  createMenuAction,
  updateStorefrontAction,
} from "@/modules/storefront/actions";
import {
  createPageAction,
  deletePageAction,
  duplicatePageAction,
  restoreVersionAction,
  unpublishPageAction,
  updatePageAction,
} from "@/modules/page-builder/actions";

/**
 * Page forms.
 *
 * Layout editing lives in the builder; these forms handle page identity (title, slug,
 * storefront, SEO) and the version/publish lifecycle.
 */

export interface StorefrontOption {
  id: string;
  name: string;
  slug: string;
}

export interface PageValues {
  id: string;
  title: string;
  slug: string;
  type: string;
  template: string;
  storefrontId: string | null;
  status: string;
  isHomepage: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  canonicalUrl: string | null;
  robots: string;
}

const TYPES = [
  { value: "CONTENT", label: "Content page" },
  { value: "HOME", label: "Homepage" },
  { value: "LANDING", label: "Landing page" },
  { value: "COLLECTION", label: "Collection" },
  { value: "POLICY", label: "Policy" },
  { value: "CONTACT", label: "Contact" },
];

export function PageForm({ storefronts }: { storefronts: StorefrontOption[] }) {
  const [state, action] = useActionState(createPageAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
      <FormField label="Title" htmlFor="page-title" required hint="Shown in the browser tab when no SEO title is set.">
        <Input id="page-title" name="title" required />
      </FormField>
      <FormField label="Slug" htmlFor="page-slug" required hint="Lower case letters, numbers and dashes.">
        <Input id="page-slug" name="slug" placeholder="about-us" required />
      </FormField>
      <FormField label="Storefront" htmlFor="page-storefront">
        <NativeSelect id="page-storefront" name="storefrontId" defaultValue="">
          <option value="">All storefronts</option>
          {storefronts.map((storefront) => (
            <option key={storefront.id} value={storefront.id}>
              {storefront.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label="Type" htmlFor="page-type">
        <NativeSelect id="page-type" name="type" defaultValue="CONTENT">
          {TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHomepage" value="true" className="h-4 w-4 rounded border-slate-300" />
        Use as the storefront homepage
      </label>
      <SubmitButton pendingLabel="Creating…">Create page</SubmitButton>
    </form>
  );
}

export function PageSettingsForm({ page, storefronts }: { page: PageValues; storefronts: StorefrontOption[] }) {
  const [state, action] = useActionState(updatePageAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
      <input type="hidden" name="pageId" value={page.id} />

      <FormField label="Title" htmlFor="settings-title" required>
        <Input id="settings-title" name="title" defaultValue={page.title} required />
      </FormField>
      <FormField label="Slug" htmlFor="settings-slug" required>
        <Input id="settings-slug" name="slug" defaultValue={page.slug} required />
      </FormField>
      <FormField label="Storefront" htmlFor="settings-storefront">
        <NativeSelect id="settings-storefront" name="storefrontId" defaultValue={page.storefrontId ?? ""}>
          <option value="">All storefronts</option>
          {storefronts.map((storefront) => (
            <option key={storefront.id} value={storefront.id}>
              {storefront.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Type" htmlFor="settings-type">
          <NativeSelect id="settings-type" name="type" defaultValue={page.type}>
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Template" htmlFor="settings-template" hint="Reserved for theme templates.">
          <Input id="settings-template" name="template" defaultValue={page.template} />
        </FormField>
      </div>

      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Search engines</legend>
        <FormField label="SEO title" htmlFor="settings-seo-title" hint="Around 60 characters works best in search results.">
          <Input id="settings-seo-title" name="seoTitle" defaultValue={page.seoTitle ?? ""} />
        </FormField>
        <FormField label="Meta description" htmlFor="settings-seo-description">
          <Textarea id="settings-seo-description" name="seoDescription" rows={2} defaultValue={page.seoDescription ?? ""} maxLength={320} />
        </FormField>
        <FormField label="Keywords" htmlFor="settings-seo-keywords">
          <Input id="settings-seo-keywords" name="seoKeywords" defaultValue={page.seoKeywords ?? ""} />
        </FormField>
        <FormField label="Canonical URL" htmlFor="settings-canonical">
          <Input id="settings-canonical" name="canonicalUrl" defaultValue={page.canonicalUrl ?? ""} placeholder="https://example.com/about-us" />
        </FormField>
        <FormField label="Robots" htmlFor="settings-robots">
          <NativeSelect id="settings-robots" name="robots" defaultValue={page.robots}>
            <option value="index,follow">index, follow</option>
            <option value="noindex,follow">noindex, follow</option>
            <option value="index,nofollow">index, nofollow</option>
            <option value="noindex,nofollow">noindex, nofollow</option>
          </NativeSelect>
        </FormField>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHomepage" value="true" defaultChecked={page.isHomepage} className="h-4 w-4 rounded border-slate-300" />
        Use as the storefront homepage
      </label>

      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </form>
  );
}

export function PublishControls({ pageId, canPublish, hasDraft }: { pageId: string; canPublish: boolean; hasDraft: boolean }) {
  const [unpublishState, unpublishAction] = useActionState(unpublishPageAction, initialActionState);
  const [duplicateState, duplicateAction] = useActionState(duplicatePageAction, initialActionState);
  const [deleteState, deleteAction] = useActionState(deletePageAction, initialActionState);

  return (
    <div className="space-y-3">
      {unpublishState.status !== "idle" ? <Alert variant={unpublishState.status === "error" ? "danger" : "success"}>{unpublishState.message}</Alert> : null}
      {duplicateState.status !== "idle" ? <Alert variant={duplicateState.status === "error" ? "danger" : "success"}>{duplicateState.message}</Alert> : null}
      {deleteState.status !== "idle" ? <Alert variant={deleteState.status === "error" ? "danger" : "success"}>{deleteState.message}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <form action={unpublishAction}>
          <input type="hidden" name="pageId" value={pageId} />
          <SubmitButton variant="outline" disabled={!canPublish} confirm="Take this page offline?" pendingLabel="Working…">
            Unpublish
          </SubmitButton>
        </form>
        <form action={duplicateAction}>
          <input type="hidden" name="pageId" value={pageId} />
          <SubmitButton variant="outline" pendingLabel="Copying…">
            Duplicate
          </SubmitButton>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="pageId" value={pageId} />
          <SubmitButton variant="destructive" confirm="Delete this page? The published version stops being served." pendingLabel="Deleting…">
            Delete
          </SubmitButton>
        </form>
      </div>

      {!hasDraft ? <p className="text-xs text-slate-500">There are no unpublished changes on this page.</p> : null}
    </div>
  );
}

export function VersionList({
  pageId,
  versions,
}: {
  pageId: string;
  versions: Array<{ id: string; version: number; status: string; blocksCount: number; note: string | null; createdAt: string; isPublished: boolean; isCurrentDraft: boolean }>;
}) {
  const [state, action] = useActionState(restoreVersionAction, initialActionState);
  return (
    <div className="space-y-2">
      {state.status !== "idle" ? <Alert variant={state.status === "error" ? "danger" : "success"}>{state.message}</Alert> : null}
      <ul className="divide-y text-sm">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              v{version.version} · {version.blocksCount} blocks · {version.status.toLowerCase()}
              {version.isPublished ? " · live" : ""}
              {version.isCurrentDraft ? " · draft" : ""}
              {version.note ? <span className="ml-2 text-xs text-slate-500">{version.note}</span> : null}
            </span>
            <form action={action}>
              <input type="hidden" name="pageId" value={pageId} />
              <input type="hidden" name="versionId" value={version.id} />
              <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                Restore
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StorefrontForm({
  storefront,
}: {
  storefront: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    themeKey: string;
    themeConfig: Record<string, unknown>;
    supportPhone: string | null;
    supportEmail: string | null;
    addressLine: string | null;
    codEnabled: boolean;
    preorderEnabled: boolean;
    freeDeliveryThresholdPaisa: number | null;
    defaultPriceListId: string | null;
    defaultLocationId: string | null;
  };
}) {
  const [state, action] = useActionState(updateStorefrontAction, initialActionState);
  return (
    <form action={action} className="space-y-3">
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
      <input type="hidden" name="storefrontId" value={storefront.id} />
      <FormField label="Name" htmlFor="storefront-name" required>
        <Input id="storefront-name" name="name" defaultValue={storefront.name} required />
      </FormField>
      <FormField label="Slug" htmlFor="storefront-slug" required>
        <Input id="storefront-slug" name="slug" defaultValue={storefront.slug} required />
      </FormField>
      <FormField label="Description" htmlFor="storefront-description">
        <Textarea id="storefront-description" name="description" rows={2} defaultValue={storefront.description ?? ""} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Support phone" htmlFor="storefront-phone">
          <Input id="storefront-phone" name="supportPhone" defaultValue={storefront.supportPhone ?? ""} />
        </FormField>
        <FormField label="Support email" htmlFor="storefront-email">
          <Input id="storefront-email" name="supportEmail" defaultValue={storefront.supportEmail ?? ""} />
        </FormField>
      </div>
      <FormField label="Address" htmlFor="storefront-address">
        <Input id="storefront-address" name="addressLine" defaultValue={storefront.addressLine ?? ""} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Theme key" htmlFor="storefront-theme" hint="Theme token set used by the storefront.">
          <Input id="storefront-theme" name="themeKey" defaultValue={storefront.themeKey} />
        </FormField>
        <FormField label="Primary colour" htmlFor="storefront-primary">
          <Input id="storefront-primary" name="primaryColor" defaultValue={String(storefront.themeConfig.primaryColor ?? "")} placeholder="#4f46e5" />
        </FormField>
        <FormField label="Accent colour" htmlFor="storefront-accent">
          <Input id="storefront-accent" name="accentColor" defaultValue={String(storefront.themeConfig.accentColor ?? "")} placeholder="#0f172a" />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="codEnabled" value="true" defaultChecked={storefront.codEnabled} className="h-4 w-4 rounded border-slate-300" />
        Cash on delivery enabled
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="preorderEnabled" value="true" defaultChecked={storefront.preorderEnabled} className="h-4 w-4 rounded border-slate-300" />
        Preorders enabled
      </label>
      <SubmitButton pendingLabel="Saving…">Save storefront</SubmitButton>
    </form>
  );
}

export function DomainForm({ storefrontId, domains }: { storefrontId: string; domains: Array<{ id: string; host: string; status: string; isPrimary: boolean }> }) {
  const [state, action] = useActionState(addDomainAction, initialActionState);
  return (
    <div className="space-y-3">
      {state.status !== "idle" ? <Alert variant={state.status === "error" ? "danger" : "success"}>{state.message}</Alert> : null}
      <ul className="divide-y text-sm">
        {domains.map((domain) => (
          <li key={domain.id} className="flex items-center justify-between py-2">
            <span>
              <span className="font-mono text-xs">{domain.host}</span>
              {domain.isPrimary ? <span className="ml-2 text-xs text-indigo-600">primary</span> : null}
            </span>
            <span className="text-xs text-slate-500">{domain.status.toLowerCase()}</span>
          </li>
        ))}
        {domains.length === 0 ? <li className="py-2 text-sm text-slate-500">No custom domains yet.</li> : null}
      </ul>
      <form action={action} className="flex items-end gap-2">
        <input type="hidden" name="storefrontId" value={storefrontId} />
        <div className="flex-1">
          <Label htmlFor="host">Add domain</Label>
          <Input id="host" name="host" placeholder="shop.example.com" />
        </div>
        <SubmitButton variant="outline" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </form>
    </div>
  );
}

export function NavigationForm({
  storefrontId,
  menus,
}: {
  storefrontId: string;
  menus: Array<{ id: string; handle: string; name: string; items: Array<{ id: string; label: string; type: string; url: string | null }> }>;
}) {
  const [menuState, menuAction] = useActionState(createMenuAction, initialActionState);
  const [itemState, itemAction] = useActionState(addNavigationItemAction, initialActionState);

  return (
    <div className="space-y-4">
      {menuState.status !== "idle" ? <Alert variant={menuState.status === "error" ? "danger" : "success"}>{menuState.message}</Alert> : null}
      {itemState.status !== "idle" ? <Alert variant={itemState.status === "error" ? "danger" : "success"}>{itemState.message}</Alert> : null}
      <form action={menuAction} className="flex items-end gap-2">
        <input type="hidden" name="storefrontId" value={storefrontId} />
        <div className="flex-1">
          <Label htmlFor="handle">New menu (handle)</Label>
          <Input id="handle" name="handle" placeholder="main" />
        </div>
        <div className="flex-1">
          <Label htmlFor="menuName">Name</Label>
          <Input id="menuName" name="name" placeholder="Main menu" />
        </div>
        <SubmitButton variant="outline" pendingLabel="Creating…">
          Create
        </SubmitButton>
      </form>

      {menus.map((menu) => (
        <div key={menu.id} className="rounded-md border p-3">
          <p className="text-sm font-medium">
            {menu.name} <span className="text-xs text-slate-500">({menu.handle})</span>
          </p>
          <ul className="mt-2 divide-y text-sm">
            {menu.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-1">
                <span>
                  {item.label} <span className="text-xs text-slate-500">{item.url ?? item.type.toLowerCase()}</span>
                </span>
              </li>
            ))}
            {menu.items.length === 0 ? <li className="py-1 text-xs text-slate-500">No items yet.</li> : null}
          </ul>
          <form action={itemAction} className="mt-2 grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="menuId" value={menu.id} />
            <div className="sm:col-span-2">
              <Label htmlFor={`label-${menu.id}`} className="text-xs">
                Label
              </Label>
              <Input id={`label-${menu.id}`} name="label" placeholder="Shop" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`url-${menu.id}`} className="text-xs">
                URL
              </Label>
              <Input id={`url-${menu.id}`} name="url" placeholder="/products" />
            </div>
            <div className="sm:col-span-4">
              <SubmitButton variant="outline" size="sm" pendingLabel="Adding…">
                Add item
              </SubmitButton>
            </div>
          </form>
        </div>
      ))}
    </div>
  );
}
