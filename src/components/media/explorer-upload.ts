"use client";

import * as React from "react";
import { confirmUploadAction, requestUploadAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { formatBytes, transferPercent } from "./explorer-utils";

/**
 * Shared upload queue for the media explorer.
 *
 * Every file walks the same handshake as all other uploads in the app
 * (request → PUT to storage → confirm) so validation, deduplication and
 * auditing stay identical no matter where the upload started.
 *
 * Two properties the media manager relies on:
 *
 * - The queue items are created **synchronously** from the user's selection, in
 *   the order the files were picked, so the content area can show them before
 *   the first server round trip.
 * - Each item carries the media asset it became, so a finished upload can
 *   replace its placeholder in place instead of forcing a full reload.
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
  /** Folder the file is being uploaded into (`null` is the library root). */
  folderId: string | null;
  /** Monotonic sequence: the order the user selected the files in. */
  order: number;
  /** Object URL for the local file, so images preview before they exist server-side. */
  previewUrl?: string;
  /** The real media item, available once the upload is confirmed. */
  asset?: MediaAssetView;
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
  /** Called with each confirmed asset so the caller can show and select it. */
  onUploaded?: (asset: MediaAssetView, item: UploadItem) => void;
}

export function useUploadQueue(options: UploadQueueOptions) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  // Mirror of `items` that is always up to date within the current tick, so the
  // pipeline can read an item without waiting for a re-render and without
  // running side effects inside a state updater.
  const itemsRef = React.useRef<UploadItem[]>([]);
  const filesRef = React.useRef(new Map<string, File>());
  const targetFolderRef = React.useRef(new Map<string, string | null>());
  const xhrRef = React.useRef(new Map<string, XMLHttpRequest>());
  const previewUrlsRef = React.useRef(new Map<string, string>());
  const queueRef = React.useRef<string[]>([]);
  const activeRef = React.useRef(0);
  const completedRef = React.useRef(0);
  const failedRef = React.useRef(0);
  const optionsRef = React.useRef(options);

  React.useEffect(() => {
    optionsRef.current = options;
  });

  // Object URLs are owned by the queue: released when an item is cleared and
  // when the explorer unmounts, never while a card is still showing them.
  React.useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /** Single write path for the queue, keeping `itemsRef` and state in step. */
  function commitItems(updater: (prev: UploadItem[]) => UploadItem[]) {
    itemsRef.current = updater(itemsRef.current);
    setItems(itemsRef.current);
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    commitItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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

  /**
   * Report a finished upload exactly once. Reading from `itemsRef` keeps this
   * out of a state updater, which React is free to run more than once.
   */
  function announce(id: string, asset: MediaAssetView) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item) optionsRef.current.onUploaded?.(asset, item);
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
        // The media manager never refuses a repeat upload: picking the same
        // local file again always produces another media object.
        allowDuplicate: true,
      });

      if (!start.ok) {
        updateItem(id, { status: "failed", error: start.message });
        failedRef.current += 1;
        return;
      }

      // The server may have renamed the file to keep the folder unique.
      if (start.fileName && start.fileName !== file.name) updateItem(id, { fileName: start.fileName });

      if (start.reused || !start.uploadUrl) {
        updateItem(id, { status: "completed", progress: 100, assetId: start.assetId, asset: start.asset });
        completedRef.current += 1;
        announce(id, start.asset);
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
        updateItem(id, { status: "completed", progress: 100, asset: confirmed.asset });
        completedRef.current += 1;
        announce(id, confirmed.asset);
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

  /**
   * Queue a selection. The placeholder items are created synchronously and in
   * the order the files arrived, so the caller can render "Uploading x.jpg"
   * immediately — nothing here waits on the server.
   *
   * Identical files are never deduplicated: selecting `product.jpg` four times
   * queues four uploads, each with its own item and its own media object.
   */
  function addFiles(files: File[], folderId?: string | null) {
    const opts = optionsRef.current;
    if (files.length === 0) return [] as UploadItem[];
    if (!opts.storageConfigured) return [] as UploadItem[];

    const targetFolderId = folderId !== undefined ? folderId : opts.folderId;
    const created: UploadItem[] = [];

    for (const file of files) {
      uploadSequence += 1;
      const id = `upload-${Date.now()}-${uploadSequence}`;
      const mimeType = file.type || "application/octet-stream";
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewUrlsRef.current.set(id, previewUrl);
      const base: UploadItem = {
        id,
        fileName: file.name,
        size: file.size,
        mimeType,
        status: "waiting",
        progress: 0,
        folderId: targetFolderId,
        order: uploadSequence,
        previewUrl,
      };

      if (opts.allowedTypes.length > 0 && !opts.allowedTypes.includes(mimeType)) {
        created.push({ ...base, status: "failed", error: `${mimeType} is not an allowed file type` });
        failedRef.current += 1;
        continue;
      }
      if (file.size > opts.maxUploadBytes) {
        created.push({ ...base, status: "failed", error: `Files must be ${formatBytes(opts.maxUploadBytes)} or smaller` });
        failedRef.current += 1;
        continue;
      }

      filesRef.current.set(id, file);
      targetFolderRef.current.set(id, targetFolderId);
      queueRef.current.push(id);
      created.push(base);
    }

    // Newest batch first, matching the "newest" default sort of the library.
    if (created.length > 0) commitItems((prev) => [...created, ...prev]);
    pump();
    maybeSettled();
    return created;
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

  function release(id: string) {
    filesRef.current.delete(id);
    targetFolderRef.current.delete(id);
    const url = previewUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(id);
    }
  }

  /**
   * Drop finished items once the real media rows have taken their place, so the
   * grid goes back to the library's own ordering. Failed items are never
   * forgotten here — the user still has to see (and retry) them.
   */
  function forget(ids: string[]) {
    if (ids.length === 0) return;
    const dropped = new Set(ids);
    for (const id of ids) release(id);
    commitItems((prev) => prev.filter((item) => !dropped.has(item.id)));
  }

  function clearFinished() {
    const keptIds = new Set(
      itemsRef.current
        .filter((item) => item.status === "waiting" || item.status === "uploading" || item.status === "processing")
        .map((item) => item.id),
    );
    for (const id of [...filesRef.current.keys()]) {
      if (!keptIds.has(id)) release(id);
    }
    for (const id of [...previewUrlsRef.current.keys()]) {
      if (!keptIds.has(id)) release(id);
    }
    commitItems((prev) => prev.filter((item) => keptIds.has(item.id)));
  }

  const activeCount = items.filter(
    (item) => item.status === "waiting" || item.status === "uploading" || item.status === "processing",
  ).length;

  return { items, activeCount, addFiles, retry, cancel, forget, clearFinished };
}
