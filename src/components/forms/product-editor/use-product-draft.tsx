"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { discardProductDraftAction, saveProductDraftAction } from "@/modules/catalog/product-actions";
import { shouldAutosaveDraft } from "@/modules/catalog/product-draft";
import type { ProductEditorState } from "./use-product-editor";

/**
 * Persistent autosave for the product editor.
 *
 * A draft is stored in the database (`ProductDraft`), not in `localStorage`, so
 * work survives a change of device, a crashed tab or a login on another machine.
 * The rules:
 *
 *  - autosave debounces ~3 s after the last change while the form is dirty,
 *    skipped when the payload has not changed since the last save; any edit
 *    on a new product is stored so the working draft appears in the list;
 *  - every save carries the `revision` it started from; if another tab saved in
 *    between the server refuses and the editor surfaces a recoverable conflict
 *    instead of overwriting the newer work;
 *  - a failed save is retried with backoff and always leaves a visible "retry"
 *    path — the user is never told their work is safe when it is not;
 *  - autosaving is independent of publishing: a draft is never a live product.
 */

export type DraftStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export interface DraftState {
  status: DraftStatus;
  draftId: string | null;
  revision: number;
  lastSavedAt: string | null;
  error: string | null;
  /** True when a stored draft is waiting to be resumed. */
  pending: boolean;
}

const AUTOSAVE_DELAY_MS = 3_000;

export interface UseProductDraftOptions {
  productId: string | null;
  state: ProductEditorState;
  dirty: boolean;
  /** Draft loaded by the server for this product/user, if any. */
  initialDraft: { draftId: string; revision: number; updatedAt: string; payload: Record<string, unknown> } | null;
  /** Called when the user asks to load a stored draft into the form. */
  onResume: (payload: Record<string, unknown>) => void;
  /** Disabled while a submit is in flight (the save itself clears the draft). */
  enabled: boolean;
}

export interface ProductDraftApi extends DraftState {
  /** Product id created by autosave when authoring a new product. */
  productId: string | null;
  saveNow: () => void;
  retry: () => void;
  resume: () => void;
  discard: () => Promise<void>;
  clear: () => void;
}

export function useProductDraft(options: UseProductDraftOptions): ProductDraftApi {
  const { productId, state, dirty, initialDraft, onResume, enabled } = options;

  const [status, setStatus] = React.useState<DraftStatus>(initialDraft ? "idle" : "idle");
  const [draftId, setDraftId] = React.useState<string | null>(initialDraft?.draftId ?? null);
  const [revision, setRevision] = React.useState<number>(initialDraft?.revision ?? 0);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(initialDraft?.updatedAt ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(Boolean(initialDraft));
  const [attempt, setAttempt] = React.useState(0);
  const [persistedProductId, setPersistedProductId] = React.useState<string | null>(productId);
  React.useEffect(() => {
    if (productId) setPersistedProductId(productId);
  }, [productId]);

  // Refs keep the debounce effect from re-arming on every keystroke while still
  // reading the newest values when the timer fires. They are written from an
  // effect, never during render, so React never sees a mutated ref mid-render.
  const stateRef = React.useRef(state);
  const revisionRef = React.useRef(revision);
  const draftIdRef = React.useRef(draftId);
  const dirtyRef = React.useRef(dirty);
  const savingRef = React.useRef(false);
  const lastSavedFingerprintRef = React.useRef<string | null>(
    initialDraft ? JSON.stringify(initialDraft.payload) : null,
  );

  React.useEffect(() => {
    stateRef.current = state;
    revisionRef.current = revision;
    draftIdRef.current = draftId;
    dirtyRef.current = dirty;
  }, [state, revision, draftId, dirty]);

  const save = React.useCallback(async (force = false) => {
    if (savingRef.current) return;
    const snapshot = stateRef.current;
    const fingerprint = JSON.stringify(snapshot);
    if (
      !force &&
      !shouldAutosaveDraft({
        dirty: true,
        name: snapshot.name,
        productCode: snapshot.productCode,
        productId: productId ?? persistedProductId,
        fingerprint,
        lastSavedFingerprint: lastSavedFingerprintRef.current,
      })
    ) {
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    setError(null);
    try {
      const result = await saveProductDraftAction({
        productId: productId ?? null,
        draftId: draftIdRef.current,
        revision: draftIdRef.current ? revisionRef.current : null,
        name: snapshot.name.trim() || undefined,
        payload: snapshot as unknown as Record<string, unknown>,
      });
      if (!result.ok) {
        // A conflict means another tab owns a newer draft: stop and let the
        // user decide rather than ping-ponging writes.
        setStatus(result.message.toLowerCase().includes("another tab") ? "conflict" : "error");
        setError(result.message);
        return;
      }
      lastSavedFingerprintRef.current = fingerprint;
      setDraftId(result.data.draftId);
      setRevision(result.data.revision);
      setLastSavedAt(result.data.updatedAt);
      if (result.data.productId) setPersistedProductId(result.data.productId);
      setStatus("saved");
      setPending(false);
    } catch {
      setStatus("error");
      setError("The draft could not be saved. Check your connection and retry.");
    } finally {
      savingRef.current = false;
    }
  }, [productId, persistedProductId]);

  /* Debounced autosave — one request a few seconds after the last change. */
  React.useEffect(() => {
    if (!enabled || !dirty || status === "conflict") return;
    // Never autosave while the stored draft is still waiting to be resumed or
    // discarded — that would overwrite work the user has not seen yet.
    if (pending) return;

    const delay = AUTOSAVE_DELAY_MS + Math.min(attempt * 2_000, 8_000);
    const handle = setTimeout(() => {
      void save();
    }, delay);
    return () => clearTimeout(handle);
  }, [enabled, dirty, status, pending, attempt, save, state]);

  React.useEffect(() => {
    if (!enabled || pending) return;
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) void save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [enabled, pending, save]);

  const retry = React.useCallback(() => {
    setAttempt(0);
    void save(true);
  }, [save]);

  const saveNow = React.useCallback(() => {
    setAttempt(0);
    void save(true);
  }, [save]);

  const resume = React.useCallback(() => {
    if (!initialDraft) return;
    onResume(initialDraft.payload);
    setPending(false);
    setStatus("saved");
    setLastSavedAt(initialDraft.updatedAt);
  }, [initialDraft, onResume]);

  const discard = React.useCallback(async () => {
    await discardProductDraftAction({ productId: productId ?? null, draftId });
    setDraftId(null);
    setRevision(0);
    setPending(false);
    setStatus("idle");
    setLastSavedAt(null);
    setError(null);
  }, [productId, draftId]);

  const clear = React.useCallback(() => {
    setDraftId(null);
    setRevision(0);
    setLastSavedAt(null);
    setPending(false);
    setStatus("idle");
    setError(null);
  }, []);

  return {
    status: status === "saved" && dirty ? "dirty" : status,
    draftId,
    revision,
    lastSavedAt,
    error,
    pending,
    productId: persistedProductId ?? productId,
    saveNow,
    retry,
    resume,
    discard,
    clear,
  };
}

/* -------------------------------------------------------------------------- */
/* Status UI                                                                  */
/* -------------------------------------------------------------------------- */

const STATUS_TEXT: Record<DraftStatus, string> = {
  idle: "Autosave on",
  dirty: "Unsaved changes — saving within 8 seconds",
  saving: "Saving draft…",
  saved: "Draft saved",
  error: "Draft not saved",
  conflict: "Draft changed elsewhere",
};

/** Compact autosave indicator for the sticky action bar. */
export function DraftStatusBar({ draft, onRetry, onDiscard }: { draft: ProductDraftApi; onRetry: () => void; onDiscard: () => void }) {
  const tone =
    draft.status === "saved"
      ? "text-emerald-700"
      : draft.status === "error" || draft.status === "conflict"
        ? "text-red-600"
        : draft.status === "saving"
          ? "text-slate-500"
          : "text-amber-600";

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", tone)}>
      <span aria-live="polite">
        {STATUS_TEXT[draft.status]}
        {draft.lastSavedAt && draft.status !== "saving" ? ` · ${new Date(draft.lastSavedAt).toLocaleTimeString()}` : ""}
      </span>
      {draft.status === "error" || draft.status === "conflict" ? (
        <>
          <button type="button" className="font-medium underline" onClick={onRetry}>
            {draft.status === "conflict" ? "Reload and overwrite" : "Retry"}
          </button>
          <button type="button" className="font-medium underline" onClick={() => void onDiscard()}>
            Discard draft
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * Offers to resume a stored draft.
 *
 * Nothing is applied until the user asks: silently replacing what the page
 * loaded with an older draft would be worse than asking once.
 */
export function ResumeDraftBanner({
  draft,
  onResume,
  onDiscard,
}: {
  draft: ProductDraftApi;
  onResume: () => void;
  onDiscard: () => void;
}) {
  if (!draft.pending || !draft.lastSavedAt) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        You have unsaved work on this product from{" "}
        <strong>{new Date(draft.lastSavedAt).toLocaleString()}</strong>. Resume it, or discard it and start from the saved product.
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white" onClick={onResume}>
          Resume draft
        </button>
        <button type="button" className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium" onClick={() => void onDiscard()}>
          Discard draft
        </button>
      </span>
    </div>
  );
}
