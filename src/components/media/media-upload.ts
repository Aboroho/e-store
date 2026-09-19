"use client";

import { confirmUploadAction, requestUploadAction, searchMediaAction } from "@/modules/media/actions";
import type { MediaAssetView } from "@/modules/media/service";
import { RichTextUploadError, type RichTextAsset } from "@/components/rich-text-editor";

/**
 * Browser side of the media upload handshake (request → PUT to storage → confirm), shaped
 * as a `RichTextEditor` upload handler so editors can add images and files that land in
 * the business's media library like every other upload.
 */

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

/** PUT with real progress events and cancellation; `fetch` offers neither for uploads. */
function putWithProgress(url: string, method: string, headers: Record<string, string>, file: File, signal: AbortSignal, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new RichTextUploadError(`Storage rejected the upload (${request.status}).`)));
    request.onerror = () => reject(new RichTextUploadError("The upload could not reach the storage service."));
    request.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export function assetToRichTextAsset(asset: MediaAssetView): RichTextAsset | null {
  if (!asset.url) return null;
  return {
    url: asset.url,
    name: asset.title ?? asset.originalName,
    mimeType: asset.mimeType,
    size: asset.sizeBytes,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
    alt: asset.altText ?? undefined,
  };
}

/** Finds the asset (by id) after the upload was confirmed, to obtain its public URL. */
async function lookupAsset(assetId: string, fileName: string): Promise<RichTextAsset> {
  const candidates = await searchMediaAction({ search: fileName, mimeGroup: "all" });
  const asset = candidates.find((candidate) => candidate.id === assetId) ?? (await searchMediaAction({ mimeGroup: "all" })).find((candidate) => candidate.id === assetId);
  const converted = asset ? assetToRichTextAsset(asset) : null;
  if (!converted) throw new RichTextUploadError("The file was uploaded but its link is not available yet. Insert it from the media library.");
  return converted;
}

export async function uploadToMediaLibrary(file: File, options: { signal: AbortSignal; onProgress: (percent: number) => void }): Promise<RichTextAsset> {
  const checksum = await fileChecksum(file);
  if (options.signal.aborted) throw new DOMException("Upload aborted", "AbortError");

  const start = await requestUploadAction({
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    visibility: "PUBLIC",
    checksum,
  });
  if (!start.ok) throw new RichTextUploadError(start.message);

  if (!start.reused && start.uploadUrl) {
    await putWithProgress(start.uploadUrl, start.method, start.headers, file, options.signal, options.onProgress);
    const size = await imageSize(file);
    const confirmed = await confirmUploadAction({ assetId: start.assetId, checksum, ...size });
    if (!confirmed.ok) throw new RichTextUploadError(confirmed.message);
  }
  options.onProgress(100);

  return lookupAsset(start.assetId, file.name);
}
