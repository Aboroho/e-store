"use client";

import * as React from "react";
import { confirmUploadAction, requestUploadAction } from "@/modules/media/actions";
import { formatBytes, transferPercent } from "./explorer-utils";

/**
 * Shared upload queue for the media explorer.
 *
 * Every file walks the same handshake as all other uploads in the app
 * (request → PUT to storage → confirm) so validation, deduplication and
 * auditing stay identical no matter where the upload started.
 *
 * The pipeline intentionally uses plain functions (no manual memoization):
 * the queue is driven by refs and the React Compiler memoizes the rest.
 */

export type UploadStatus = "waiting" | "uploading" | "processing" | "completed" | "failed" | "canceled";

export interface UploadItem {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  assetId?: string;
}

async function fileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

let uploadSequence = 0;

export interface UploadQueueOptions {
  /** Folder new uploads land in (per-batch overrides win over this). */
  folderId: string | null;
  /** MIME allowlist for instant client-side feedback; the server re-validates. */
  allowedTypes: string[];
  maxUploadBytes: number;
  storageConfigured: boolean;
  concurrency?: number;
  /** Called with the batch totals once the queue drains. */
  onSettled: (completed: number, failed: number) => void;
}

export function useUploadQueue(options: UploadQueueOptions) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const filesRef = React.useRef(new Map<string, File>());
  const targetFolderRef = React.useRef(new Map<string, string | null>());
  const xhrRef = React.useRef(new Map<string, XMLHttpRequest>());
  const queueRef = React.useRef<string[]>([]);
  const activeRef = React.useRef(0);
  const completedRef = React.useRef(0);
  const failedRef = React.useRef(0);
  const optionsRef = React.useRef(options);

  React.useEffect(() => {
    optionsRef.current = options;
  });

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function maybeSettled() {
    if (activeRef.current === 0 && queueRef.current.length === 0) {
      const completed = completedRef.current;
      const failed = failedRef.current;
      if (completed > 0 || failed > 0) {
        completedRef.current = 0;
        failedRef.current = 0;
        optionsRef.current.onSettled(completed, failed);
      }
    }
  }

  function pump() {
    const limit = optionsRef.current.concurrency ?? 3;
    while (activeRef.current < limit && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (next) void runOne(next);
    }
  }

  async function runOne(id: string) {
    const file = filesRef.current.get(id);
    if (!file) {
      updateItem(id, { status: "failed", error: "The original file is no longer available" });
      failedRef.current += 1;
      maybeSettled();
      return;
    }
    activeRef.current += 1;
    try {
      updateItem(id, { status: "uploading", progress: 0, error: undefined });

      const checksum = await fileChecksum(file);
      const start = await requestUploadAction({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        folderId: targetFolderRef.current.get(id) ?? null,
        visibility: "PUBLIC",
        checksum,
      });

      if (!start.ok) {
        updateItem(id, { status: "failed", error: start.message });
        failedRef.current += 1;
        return;
      }

      if (start.reused || !start.uploadUrl) {
        updateItem(id, { status: "completed", progress: 100, assetId: start.assetId });
        completedRef.current += 1;
        return;
      }

      updateItem(id, { status: "uploading", progress: 0, assetId: start.assetId });
      const uploadUrl = start.uploadUrl;
      const headers = start.headers;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current.set(id, xhr);
        xhr.open("PUT", uploadUrl);
        for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = transferPercent(event.loaded, event.total);
            if (percent !== null) updateItem(id, { progress: percent });
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage returned ${xhr.status}`));
        xhr.onerror = () => reject(new Error("The upload could not reach the storage service"));
        xhr.onabort = () => reject(new DOMException("Upload canceled", "AbortError"));
        xhr.send(file);
      });

      updateItem(id, { status: "processing" });
      const size = await imageSize(file);
      const confirmed = await confirmUploadAction({ assetId: start.assetId, checksum, ...size });
      if (confirmed.ok) {
        updateItem(id, { status: "completed", progress: 100 });
        completedRef.current += 1;
      } else {
        updateItem(id, { status: "failed", error: confirmed.message });
        failedRef.current += 1;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        updateItem(id, { status: "canceled" });
      } else {
        updateItem(id, { status: "failed", error: error instanceof Error ? error.message : "Upload failed" });
        failedRef.current += 1;
      }
    } finally {
      xhrRef.current.delete(id);
      activeRef.current -= 1;
      pump();
      maybeSettled();
    }
  }

  function addFiles(files: File[], folderId?: string | null) {
    const opts = optionsRef.current;
    if (files.length === 0) return;
    if (!opts.storageConfigured) return;

    const created: UploadItem[] = [];
    for (const file of files) {
      uploadSequence += 1;
      const id = `upload-${Date.now()}-${uploadSequence}`;
      const mimeType = file.type || "application/octet-stream";

      if (opts.allowedTypes.length > 0 && !opts.allowedTypes.includes(mimeType)) {
        created.push({
          id,
          fileName: file.name,
          size: file.size,
          mimeType,
          status: "failed",
          progress: 0,
          error: `${mimeType} is not an allowed file type`,
        });
        failedRef.current += 1;
        continue;
      }
      if (file.size > opts.maxUploadBytes) {
        created.push({
          id,
          fileName: file.name,
          size: file.size,
          mimeType,
          status: "failed",
          progress: 0,
          error: `Files must be ${formatBytes(opts.maxUploadBytes)} or smaller`,
        });
        failedRef.current += 1;
        continue;
      }

      filesRef.current.set(id, file);
      targetFolderRef.current.set(id, folderId !== undefined ? folderId : opts.folderId);
      queueRef.current.push(id);
      created.push({ id, fileName: file.name, size: file.size, mimeType, status: "waiting", progress: 0 });
    }

    if (created.length > 0) setItems((prev) => [...created, ...prev]);
    pump();
    maybeSettled();
  }

  function retry(id: string) {
    if (!filesRef.current.get(id)) {
      updateItem(id, { error: "The original file is no longer available for retry" });
      return;
    }
    if (queueRef.current.includes(id)) return;
    updateItem(id, { status: "waiting", progress: 0, error: undefined });
    queueRef.current.push(id);
    pump();
  }

  function cancel(id: string) {
    const pendingIndex = queueRef.current.indexOf(id);
    if (pendingIndex >= 0) {
      queueRef.current.splice(pendingIndex, 1);
      updateItem(id, { status: "canceled" });
      maybeSettled();
      return;
    }
    xhrRef.current.get(id)?.abort();
  }

  function clearFinished() {
    const keptIds = new Set(
      items
        .filter((item) => item.status === "waiting" || item.status === "uploading" || item.status === "processing")
        .map((item) => item.id),
    );
    for (const id of [...filesRef.current.keys()]) {
      if (!keptIds.has(id)) {
        filesRef.current.delete(id);
        targetFolderRef.current.delete(id);
      }
    }
    setItems((prev) => prev.filter((item) => keptIds.has(item.id)));
  }

  const activeCount = items.filter(
    (item) => item.status === "waiting" || item.status === "uploading" || item.status === "processing",
  ).length;

  return { items, activeCount, addFiles, retry, cancel, clearFinished };
}
