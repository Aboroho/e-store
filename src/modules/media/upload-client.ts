"use client";
import { uploadMimeType } from "./policy";
import { requestUploadAction, confirmUploadAction } from "./actions";

/** The only browser upload workflow. Retry the same reservation, never a second asset. */
export async function uploadMedia(
  file: File,
  options: {
    folderId?: string | null;
    visibility?: "PUBLIC" | "PRIVATE";
    audience?: "staff" | "customer";
    onProgress?: (percent: number) => void;
  } = {},
) {
  if (!file.size || file.size > 64 * 1024 * 1024)
    throw new Error("Choose a file between 1 byte and 64 MB");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const start = await requestUploadAction({
    fileName: file.name,
    mimeType: uploadMimeType(file),
    visibility: options.visibility,
    sizeBytes: file.size,
    checksum,
    folderId: options.folderId,
    audience: options.audience,
  });
  if (!start.ok) throw new Error(start.message);
  if (!start.reused && start.uploadUrl) {
    let uploaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(start.method, start.uploadUrl!);
          for (const [name, value] of Object.entries(start.headers))
            xhr.setRequestHeader(name, value);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable)
              options.onProgress?.(
                Math.round((event.loaded / event.total) * 90),
              );
          };
          // 412 means an earlier retry already wrote the immutable object. Confirm its hash.
          xhr.onload = () =>
            (xhr.status >= 200 && xhr.status < 300) || xhr.status === 412
              ? resolve()
              : reject(new Error(`Storage rejected upload (${xhr.status})`));
          xhr.onerror = () => reject(new Error("Upload connection failed"));
          xhr.timeout = 120000;
          xhr.ontimeout = () => reject(new Error("Upload timed out"));
          xhr.send(file);
        });
        uploaded = true;
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (!uploaded) throw new Error("Upload failed");
    let dimensions = {};
    if (file.type.startsWith("image/")) {
      try {
        const bitmap = await createImageBitmap(file);
        dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
      } catch {
        /* Optional dimensions. */
      }
    }
    const confirmed = await confirmUploadAction({
      assetId: start.assetId,
      checksum,
      audience: options.audience,
      ...dimensions,
    });
    if (!confirmed.ok) throw new Error(confirmed.message);
  }
  options.onProgress?.(100);
  return start.assetId;
}
