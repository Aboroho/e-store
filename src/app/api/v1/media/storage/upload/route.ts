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

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return reject("File is too large", 413);

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);

  return new NextResponse(null, { status: 200, headers: { "x-stored-bytes": String(body.byteLength) } });
}
