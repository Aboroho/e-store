/**
 * File-name helpers for the media library.
 *
 * Every media file must have a unique display/stored name **inside its folder**
 * (`/products/product.jpg` and `/brands/product.jpg` are fine, two
 * `/products/product.jpg` are not). The rules live here — as pure functions
 * without any database or storage import — so that every write path (upload,
 * copy, move, replace, folder change) shares one implementation and the unit
 * tests can exercise it directly.
 */

/** Longest name we ever store; mirrors `uploadRequestSchema.fileName`. */
export const MAX_FILE_NAME_LENGTH = 255;

export interface SplitFileName {
  /** Everything before the extension (never empty). */
  base: string;
  /** Extension including the leading dot, or an empty string. */
  extension: string;
}

/**
 * Split a file name into its base and extension.
 *
 * `product.jpg` → `product` + `.jpg`, `archive.tar.gz` → `archive.tar` + `.gz`,
 * `.env` → `.env` + `` (a leading dot is part of the name, not an extension).
 */
export function splitFileName(fileName: string): SplitFileName {
  const name = fileName.trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return { base: name, extension: "" };
  return { base: name.slice(0, dot), extension: name.slice(dot) };
}

/** Case-insensitive comparison key; storage and humans both treat names that way. */
export function fileNameKey(fileName: string): string {
  return fileName.trim().toLowerCase();
}

/** Keep the generated name inside the column/schema limit without losing the extension. */
function clamp(base: string, suffix: string, extension: string): string {
  const budget = MAX_FILE_NAME_LENGTH - suffix.length - extension.length;
  const trimmed = budget > 0 ? base.slice(0, budget) : base.slice(0, 1);
  return `${trimmed}${suffix}${extension}`;
}

/**
 * First name in the `name.ext`, `name-1.ext`, `name-2.ext`, … sequence that is
 * not already taken.
 *
 * The comparison is case-insensitive and the extension is always preserved, so
 * uploading `product.jpg` into a folder that already holds `product.jpg`,
 * `product-1.jpg` and `product-2.jpg` yields `product-3.jpg`.
 */
export function generateUniqueFileName(desired: string, taken: Iterable<string>): string {
  const takenKeys = new Set<string>();
  for (const name of taken) takenKeys.add(fileNameKey(name));

  const cleaned = desired.trim() || "file";
  const { base, extension } = splitFileName(cleaned);
  const candidate = clamp(base, "", extension);
  if (!takenKeys.has(fileNameKey(candidate))) return candidate;

  for (let counter = 1; counter <= takenKeys.size + 1; counter += 1) {
    const next = clamp(base, `-${counter}`, extension);
    if (!takenKeys.has(fileNameKey(next))) return next;
  }
  // Unreachable for a finite `taken` set, but never return a colliding name.
  return clamp(base, `-${Date.now()}`, extension);
}

/**
 * Names that could collide with `desired` — used to narrow the database lookup
 * to `base%` instead of reading a whole folder.
 */
export function fileNamePrefix(desired: string): string {
  return splitFileName(desired.trim() || "file").base;
}
