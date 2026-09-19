import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { verifyLocalSignature, localStoragePath } from "@/modules/media/storage";
import { storageDriver } from "@/lib/env";

/**
 * Local storage driver: signed reader.
 *
 * Same contract as an S3 presigned GET — a URL that stops working when it expires and
 * that only ever exposes one object. Files are streamed, never buffered whole.
 */

export const dynamic = "force-dynamic";

function reject(message: string, status = 400) {
  return NextResponse.json({ error: { code: "INVALID_DOWNLOAD_URL", message } }, { status });
}

export async function GET(request: Request) {
  if (storageDriver() !== "local") return reject("Local storage is not enabled on this deployment", 404);

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = Number(url.searchParams.get("expires") ?? 0);
  const signature = url.searchParams.get("signature") ?? "";
  const downloadName = url.searchParams.get("name");
  const disposition = url.searchParams.get("disposition") === "attachment" ? "attachment" : "inline";

  if (!key || !expires || !signature) return reject("Missing download parameters");
  if (expires * 1000 < Date.now()) return reject("This download link has expired", 410);

  const payload = new URLSearchParams(url.searchParams);
  payload.delete("signature");
  if (!verifyLocalSignature(payload.toString(), signature)) return reject("Invalid download signature", 403);

  let full: string;
  try {
    full = localStoragePath(key);
  } catch {
    return reject("Invalid storage key", 400);
  }

  let info;
  try {
    info = await stat(full);
  } catch {
    return reject("File not found", 404);
  }
  if (!info.isFile()) return reject("File not found", 404);

  const contentType = key.endsWith(".png")
    ? "image/png"
    : key.endsWith(".webp")
      ? "image/webp"
      : key.endsWith(".avif")
        ? "image/avif"
        : key.endsWith(".gif")
          ? "image/gif"
          : key.endsWith(".svg")
            ? "image/svg+xml"
            : key.endsWith(".pdf")
              ? "application/pdf"
              : key.endsWith(".jpg") || key.endsWith(".jpeg")
                ? "image/jpeg"
                : "application/octet-stream";

  const stream = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(info.size),
      "cache-control": "private, max-age=60",
      "content-disposition": `${disposition}${downloadName ? `; filename="${downloadName.replace(/"/g, "")}"` : ""}`,
      "x-content-type-options": "nosniff",
    },
  });
}
