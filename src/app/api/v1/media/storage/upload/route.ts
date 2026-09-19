import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyLocalSignature, localStoragePath } from "@/modules/media/storage";
import { storageDriver } from "@/lib/env";

/**
 * Local storage driver: signed upload receiver.
 *
 * The URL carries its own expiry and HMAC signature (see `localStorageUrl`), so no
 * session is required and no credential is ever handed to the browser. This route is
 * inert unless STORAGE_DRIVER=local.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024 * 1024;

function reject(message: string, status = 400) {
  return NextResponse.json({ error: { code: "INVALID_UPLOAD_URL", message } }, { status });
}

export async function PUT(request: Request) {
  if (storageDriver() !== "local") return reject("Local storage is not enabled on this deployment", 404);

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = Number(url.searchParams.get("expires") ?? 0);
  const signature = url.searchParams.get("signature") ?? "";

  if (!key || !expires || !signature) return reject("Missing upload parameters");
  if (expires * 1000 < Date.now()) return reject("This upload link has expired", 410);

  const payload = new URLSearchParams(url.searchParams);
  payload.delete("signature");
  if (!verifyLocalSignature(payload.toString(), signature)) return reject("Invalid upload signature", 403);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BYTES) return reject("File is too large", 413);

  let full: string;
  try {
    full = localStoragePath(key);
  } catch {
    return reject("Invalid storage key", 400);
  }

  const expectedSize = Number(url.searchParams.get("size") ?? 0);
  const limit = expectedSize > 0 ? Math.min(expectedSize, MAX_BYTES) : MAX_BYTES;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (!reader) return reject("Empty upload");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); return reject("File is too large", 413); }
    chunks.push(value);
  }
  if (expectedSize && total !== expectedSize) return reject("File size does not match", 400);
  const body = Buffer.concat(chunks);

  await mkdir(path.dirname(full), { recursive: true });
  try { await writeFile(full, body, { flag: "wx" }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return reject("Object already uploaded", 412);
    throw error;
  }

  return new NextResponse(null, { status: 200, headers: { "x-stored-bytes": String(body.byteLength) } });
}
