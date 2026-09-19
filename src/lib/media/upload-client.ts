import { confirmUploadAction, requestUploadAction } from "@/modules/media/actions";

/**
 * Shared browser-side upload workflow for the Media Manager.
 *
 * Every upload in the application — the media library, the shared picker, the
 * customer review form — runs this exact handshake:
 *
 *   1. `request` validates the declaration server-side and returns a short-lived
 *      signed PUT URL plus a reserved asset id (or `reused: true` when identical
 *      bytes already exist, in which case nothing is uploaded twice).
 *   2. the browser PUTs the bytes straight to storage (the app never proxies
 *      file bodies), with retries on transient failures.
 *   3. `confirm` verifies what actually landed and publishes the asset.
 *
 * Client-side checks (type, size) are a courtesy for fast feedback only: the
 * server re-validates everything on request *and* on confirm.
 */

export interface UploadRequestResult {
  ok: true;
  assetId: string;
  uploadUrl: string | null;
  method?: string;
  headers?: Record<string, string>;
  reused?: boolean;
}

export type UploadRequester = (input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  checksum?: string;
}) => Promise<UploadRequestResult | { ok: false; message: string }>;

export type UploadConfirmer = (input: {
  assetId: string;
  checksum?: string;
  width?: number;
  height?: number;
}) => Promise<{ ok: true } | { ok: false; message?: string }>;

export interface MediaUploadOptions {
  folderId?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  /** Client-side pre-check; the server enforces the real limit. */
  maxBytes?: number;
  /** Client-side pre-check; the server enforces the real allow-list. */
  allowedTypes?: string[];
  /** PUT retries on network/5xx failures (default 2). */
  retries?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, currentFile: string) => void;
  /** Injectable handshake (the review flow uses its own rate-limited actions). */
  request?: UploadRequester;
  confirm?: UploadConfirmer;
}

export interface MediaUploadSuccess {
  assetId: string;
  fileName: string;
  reused: boolean;
}

export interface MediaUploadFailure {
  fileName: string;
  message: string;
}

export interface MediaUploadReport {
  succeeded: MediaUploadSuccess[];
  failed: MediaUploadFailure[];
}

/** SHA-256 of the file bytes; drives duplicate reuse on the server. */
export async function fileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Intrinsic dimensions, probed in the browser so the server does not have to. */
export async function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putWithRetries(url: string, method: string, headers: Record<string, string>, file: File, retries: number, signal?: AbortSignal): Promise<Response> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const response = await fetch(url, { method, headers, body: file, signal });
      // 5xx from storage is worth one more try; 4xx is final (bad signature, gone key).
      if (response.ok || response.status < 500 || attempt > retries + 1) return response;
    } catch (error) {
      if (attempt > retries + 1 || (signal?.aborted ?? false)) throw error;
    }
    await sleep(Math.min(4000, 250 * 2 ** (attempt - 1)));
  }
}

export async function uploadMediaFiles(files: File[], options: MediaUploadOptions = {}): Promise<MediaUploadReport> {
  const request = options.request ?? (requestUploadAction as UploadRequester);
  const confirm = options.confirm ?? (confirmUploadAction as UploadConfirmer);
  const retries = options.retries ?? 2;
  const report: MediaUploadReport = { succeeded: [], failed: [] };

  let completed = 0;
  for (const file of files) {
    if (options.signal?.aborted) {
      report.failed.push({ fileName: file.name, message: "Upload cancelled" });
      continue;
    }
    options.onProgress?.(completed, files.length, file.name);

    if (options.maxBytes && file.size > options.maxBytes) {
      report.failed.push({ fileName: file.name, message: `Files must be ${(options.maxBytes / (1024 * 1024)).toFixed(0)} MB or smaller` });
      completed += 1;
      continue;
    }
    if (options.allowedTypes && options.allowedTypes.length > 0 && file.type && !options.allowedTypes.includes(file.type)) {
      report.failed.push({ fileName: file.name, message: `${file.type || "This file type"} is not allowed here` });
      completed += 1;
      continue;
    }

    try {
      const checksum = await fileChecksum(file);
      const start = await request({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        folderId: options.folderId ?? null,
        visibility: options.visibility ?? "PUBLIC",
        checksum,
      });
      if (!start.ok) {
        report.failed.push({ fileName: file.name, message: start.message });
        completed += 1;
        continue;
      }
      if (start.reused || !start.uploadUrl) {
        report.succeeded.push({ assetId: start.assetId, fileName: file.name, reused: true });
        completed += 1;
        options.onProgress?.(completed, files.length, file.name);
        continue;
      }

      const response = await putWithRetries(start.uploadUrl, start.method ?? "PUT", start.headers ?? {}, file, retries, options.signal);
      if (!response.ok) {
        report.failed.push({ fileName: file.name, message: `Storage rejected the upload (${response.status})` });
        completed += 1;
        continue;
      }

      const size = await imageDimensions(file);
      const confirmed = await confirm({ assetId: start.assetId, checksum, ...size });
      if (!confirmed.ok) {
        report.failed.push({ fileName: file.name, message: confirmed.message ?? "Upload failed" });
      } else {
        report.succeeded.push({ assetId: start.assetId, fileName: file.name, reused: false });
      }
    } catch (error) {
      report.failed.push({ fileName: file.name, message: error instanceof Error ? error.message : "Upload failed" });
    }
    completed += 1;
    options.onProgress?.(completed, files.length, file.name);
  }

  return report;
}
