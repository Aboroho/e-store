"use client";

import * as React from "react";
import type { Editor } from "@tiptap/core";
import { findUploadPlaceholder, uploadPlaceholderKey } from "../blocks/upload-placeholder";
import { RichTextUploadError, type RichTextAsset, type RichTextMediaKind, type RichTextUploadHandler } from "../types";
import { formatBytes } from "./format";
import { safeSrc } from "./url";
import { useLatest } from "./use-latest";

export interface UploadEntry {
  id: string;
  file: File;
  kind: RichTextMediaKind;
  status: "uploading" | "error";
  progress: number | null;
  error?: string;
  element: HTMLElement;
}

export interface UploadPolicy {
  onUpload?: RichTextUploadHandler;
  /** Which block an uploaded file becomes; images fall back to files when images are disabled. */
  allowImages: boolean;
  allowFiles: boolean;
  maxFileSize?: number;
  accept?: string;
}

export interface UploadRequest {
  /** Document position for the placeholder; defaults to the end of the selection. */
  position?: number;
  /** Force the block type, e.g. when the user explicitly chose "Attach file". */
  kind?: RichTextMediaKind;
}

export type UploadFiles = (files: File[], request?: UploadRequest) => void;

export interface UseUploadsResult {
  entries: UploadEntry[];
  canUpload: boolean;
  uploadFiles: UploadFiles;
  retry: (id: string) => void;
  cancel: (id: string) => void;
}

const isImage = (file: File) => file.type.startsWith("image/");

/** Mirrors the browser's `accept` attribute semantics. */
function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const rules = accept
    .split(",")
    .map((rule) => rule.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Only messages the handler explicitly marked as user-facing are shown verbatim. */
function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "The upload was cancelled.";
  if (error instanceof RichTextUploadError && error.message) return error.message;
  return "Something went wrong while uploading. Please try again.";
}

/** Inserts the uploaded/linked asset as an image or file block at `position` (or the selection). */
export function insertAsset(editor: Editor, kind: RichTextMediaKind, asset: RichTextAsset, position?: number): boolean {
  const url = safeSrc(asset.url);
  if (!url) return false;
  const useImage = kind === "image" && Boolean(editor.schema.nodes.image);
  const content = useImage
    ? { type: "image", attrs: { src: url, alt: asset.alt ?? "", width: asset.width ?? null, height: asset.height ?? null } }
    : { type: "fileAttachment", attrs: { href: url, name: asset.name ?? url.split("/").pop() ?? "File", size: asset.size ?? null, mimeType: asset.mimeType ?? null } };
  if (!useImage && !editor.schema.nodes.fileAttachment) return false;
  const chain = editor.chain().focus();
  return (typeof position === "number" ? chain.insertContentAt(position, content) : chain.insertContent(content)).run();
}

/**
 * Tracks in-flight uploads. Each upload owns a placeholder widget in the document; the
 * React card rendered into it (by the editor shell) shows progress, errors and retry.
 */
export function useUploads(editor: Editor | null, policy: UploadPolicy, notify: (message: string) => void): UseUploadsResult {
  const [entries, setEntries] = React.useState<UploadEntry[]>([]);
  const controllers = React.useRef(new Map<string, AbortController>());
  const policyRef = useLatest(policy);
  const notifyRef = useLatest(notify);

  const canUpload = Boolean(policy.onUpload) && (policy.allowImages || policy.allowFiles);

  const update = React.useCallback((id: string, patch: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const removePlaceholder = React.useCallback(
    (id: string) => {
      if (!editor || editor.isDestroyed) return;
      const { state, view } = editor;
      if (findUploadPlaceholder(state, id) == null) return;
      view.dispatch(state.tr.setMeta(uploadPlaceholderKey, { remove: { id } }).setMeta("addToHistory", false));
    },
    [editor],
  );

  const finish = React.useCallback(
    (id: string) => {
      controllers.current.delete(id);
      removePlaceholder(id);
      setEntries((current) => current.filter((entry) => entry.id !== id));
    },
    [removePlaceholder],
  );

  const start = React.useCallback(
    (entry: UploadEntry) => {
      const { onUpload } = policyRef.current;
      if (!editor || !onUpload) return;
      const controller = new AbortController();
      controllers.current.set(entry.id, controller);
      update(entry.id, { status: "uploading", progress: null, error: undefined });

      onUpload(entry.file, {
        kind: entry.kind,
        onProgress: (percent) => {
          if (controller.signal.aborted) return;
          update(entry.id, { progress: Math.max(0, Math.min(100, percent)) });
        },
        signal: controller.signal,
      }).then(
        (asset) => {
          if (controller.signal.aborted || editor.isDestroyed) return;
          const position = findUploadPlaceholder(editor.state, entry.id);
          finish(entry.id);
          if (position == null) return; // Placeholder was removed while uploading.
          const inserted = insertAsset(editor, entry.kind, asset, position);
          if (!inserted) notifyRef.current(`“${entry.file.name}” was uploaded but could not be inserted.`);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          controllers.current.delete(entry.id);
          update(entry.id, { status: "error", error: describeError(error) });
        },
      );
    },
    [editor, update, finish, policyRef, notifyRef],
  );

  const uploadFiles = React.useCallback<UploadFiles>(
    (files, request = {}) => {
      const current = policyRef.current;
      if (!editor || !current.onUpload || files.length === 0) return;
      const rejected: string[] = [];
      const accepted: UploadEntry[] = [];

      for (const file of files) {
        const wantsImage = request.kind ? request.kind === "image" : isImage(file);
        const kind: RichTextMediaKind = wantsImage && isImage(file) && current.allowImages ? "image" : "file";
        if (kind === "file" && !current.allowFiles) {
          rejected.push(`“${file.name}” is not an image.`);
          continue;
        }
        if (!matchesAccept(file, current.accept)) {
          rejected.push(`“${file.name}” is not an accepted file type.`);
          continue;
        }
        if (current.maxFileSize && file.size > current.maxFileSize) {
          rejected.push(`“${file.name}” is too large (max ${formatBytes(current.maxFileSize)}).`);
          continue;
        }
        const element = document.createElement("div");
        element.className = "rte-upload-widget";
        accepted.push({ id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, kind, status: "uploading", progress: null, element });
      }

      if (rejected.length > 0) notifyRef.current(rejected.join(" "));
      if (accepted.length === 0) return;

      let tr = editor.state.tr;
      const at = typeof request.position === "number" ? request.position : editor.state.selection.to;
      for (const entry of accepted) {
        tr = tr.setMeta(uploadPlaceholderKey, { add: { id: entry.id, pos: at, element: entry.element } });
        // One meta per transaction: dispatch each placeholder separately.
        editor.view.dispatch(tr.setMeta("addToHistory", false));
        tr = editor.state.tr;
      }
      setEntries((existing) => [...existing, ...accepted]);
      accepted.forEach(start);
    },
    [editor, start, policyRef, notifyRef],
  );

  const retry = React.useCallback(
    (id: string) => {
      const entry = entries.find((item) => item.id === id);
      if (entry) start(entry);
    },
    [entries, start],
  );

  const cancel = React.useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      finish(id);
    },
    [finish],
  );

  // Abort everything when the editor goes away.
  React.useEffect(() => {
    const active = controllers.current;
    return () => {
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, [editor]);

  return { entries, canUpload, uploadFiles, retry, cancel };
}
