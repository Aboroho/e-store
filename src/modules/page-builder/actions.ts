"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import type { ActionState } from "@/modules/auth/actions";
import { createPage, deletePage, duplicatePage, publishPage, restoreVersion, saveDraft, unpublishPage, updatePageMeta } from "./service";

/**
 * Page builder actions.
 *
 * The layout arrives as JSON from the builder canvas and is validated server-side
 * before it is stored (see `modules/page-builder/schema.ts`). Nothing here executes
 * stored content: publishing only flips which validated version is served.
 */

async function actor() {
  const session = await requireSession();
  assertPermission(session, "page.manage");
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) {
    const fieldErrors = Array.isArray(error.details)
      ? Object.fromEntries(
          (error.details as Array<{ path?: (string | number)[]; message?: string }>).map((issue) => [
            (issue.path ?? []).join(".") || "_",
            [issue.message ?? "Invalid value"],
          ]),
        )
      : undefined;
    return { status: "error", message: error.message, fieldErrors };
  }
  logger.error("Page builder action failed", error);
  return { status: "error", message: fallback };
}

function revalidatePages(pageId?: string) {
  revalidatePath("/admin/pages");
  if (pageId) {
    revalidatePath(`/admin/pages/${pageId}`);
    revalidatePath(`/admin/pages/${pageId}/builder`);
  }
  // Published content is rendered by the public storefront.
  revalidatePath("/", "layout");
}

function readMeta(raw: Record<string, string | string[]>) {
  const value = (key: string) => {
    const entry = raw[key];
    return Array.isArray(entry) ? entry[0] : entry;
  };
  return {
    storefrontId: (value("storefrontId") ?? "") === "" || value("storefrontId") === "all" ? null : String(value("storefrontId")),
    title: String(value("title") ?? "").trim(),
    slug: String(value("slug") ?? "").trim(),
    type: (value("type") ?? "CONTENT") as "HOME" | "CONTENT" | "LANDING" | "POLICY" | "COLLECTION" | "CONTACT",
    template: String(value("template") ?? "default"),
    seoTitle: String(value("seoTitle") ?? "").trim() || undefined,
    seoDescription: String(value("seoDescription") ?? "").trim() || undefined,
    seoKeywords: String(value("seoKeywords") ?? "").trim() || undefined,
    canonicalUrl: String(value("canonicalUrl") ?? "").trim() || undefined,
    robots: (value("robots") ?? "index,follow") as "index,follow" | "noindex,follow" | "index,nofollow" | "noindex,nofollow",
    isHomepage: value("isHomepage") === "true" || value("isHomepage") === "on",
  };
}

export async function createPageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor();
  } catch (error) {
    return toState(error, "You are not allowed to manage pages");
  }

  try {
    const page = await createPage(context, readMeta(formDataToObject(formData)));
    revalidatePages(page.id);
    return { status: "success", message: `Page "${page.title}" created`, data: { pageId: page.id } };
  } catch (error) {
    return toState(error, "Unable to create the page");
  }
}

export async function updatePageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor();
  } catch (error) {
    return toState(error, "You are not allowed to manage pages");
  }

  const raw = formDataToObject(formData);
  try {
    const page = await updatePageMeta(context, { ...readMeta(raw), pageId: String(raw.pageId ?? "") });
    revalidatePages(page.id);
    return { status: "success", message: "Page settings saved" };
  } catch (error) {
    return toState(error, "Unable to save the page settings");
  }
}

/** Called from the builder canvas (JSON payload, not a form). */
export async function saveDraftAction(input: { pageId: string; document: unknown; note?: string }): Promise<{ ok: true; version: number; savedAt: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }> {
  try {
    const context = await actor();
    const version = await saveDraft(context, input);
    revalidatePages(input.pageId);
    return { ok: true, version: version.version, savedAt: version.createdAt.toISOString() };
  } catch (error) {
    const state = toState(error, "Unable to save the draft");
    return { ok: false, message: state.message ?? "Unable to save the draft", fieldErrors: state.fieldErrors };
  }
}

export async function publishPageAction(input: { pageId: string; document?: unknown; versionId?: string }): Promise<{ ok: true; publishedAt: string } | { ok: false; message: string }> {
  try {
    const context = await actor();
    // The builder sends the current canvas so publishing never publishes something
    // other than what the editor sees.
    let versionId = input.versionId;
    if (input.document) {
      const draft = await saveDraft(context, { pageId: input.pageId, document: input.document, note: "Before publish" });
      versionId = draft.id;
    }
    const result = await publishPage(context, { pageId: input.pageId, versionId });
    revalidatePages(input.pageId);
    return { ok: true, publishedAt: (result.page.publishedAt ?? new Date()).toISOString() };
  } catch (error) {
    const state = toState(error, "Unable to publish the page");
    return { ok: false, message: state.message ?? "Unable to publish the page" };
  }
}

export async function unpublishPageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const pageId = String(raw.pageId ?? "");
    await unpublishPage(context, pageId);
    revalidatePages(pageId);
    return { status: "success", message: "Page unpublished" };
  } catch (error) {
    return toState(error, "Unable to unpublish the page");
  }
}

export async function restoreVersionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const pageId = String(raw.pageId ?? "");
    const version = await restoreVersion(context, { pageId, versionId: String(raw.versionId ?? "") });
    revalidatePages(pageId);
    return { status: "success", message: `Restored into draft v${version.version}` };
  } catch (error) {
    return toState(error, "Unable to restore that version");
  }
}

export async function duplicatePageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const copy = await duplicatePage(context, String(raw.pageId ?? ""));
    revalidatePages(copy.id);
    return { status: "success", message: `Copied to "${copy.title}"`, data: { pageId: copy.id } };
  } catch (error) {
    return toState(error, "Unable to duplicate the page");
  }
}

export async function deletePageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const context = await actor();
    const raw = formDataToObject(formData);
    const pageId = String(raw.pageId ?? "");
    await deletePage(context, pageId);
    revalidatePages(pageId);
    return { status: "success", message: "Page deleted" };
  } catch (error) {
    return toState(error, "Unable to delete the page");
  }
}
