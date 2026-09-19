/**
 * Shared types and pure helpers for the file-explorer media workspace.
 *
 * This module is intentionally client-safe (no server imports) so the admin
 * library, every picker, and the unit tests can share one implementation.
 */

export type MimeFilter = "all" | "image" | "video" | "audio" | "file" | "unused";

export type SortKey =
  | "newest"
  | "oldest"
  | "name"
  | "name_desc"
  | "largest"
  | "smallest"
  | "recently_modified";

export type ViewMode = "grid" | "list";

export interface ExplorerFolder {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  assetCount: number;
}

export type MediaKind = "image" | "video" | "audio" | "pdf" | "file";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mediaKindOf(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "file";
}

export function kindLabel(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "pdf":
      return "PDF";
    case "file":
      return "File";
  }
}

/** Inline preview capability of the preview dialog (anything else gets actions). */
export function previewKindOf(mimeType: string): "image" | "video" | "audio" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

export const MIME_FILTER_OPTIONS: Array<{ value: MimeFilter; label: string }> = [
  { value: "all", label: "All files" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "file", label: "Documents" },
  { value: "unused", label: "Unused" },
];

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "recently_modified", label: "Recently modified" },
  { value: "name", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "largest", label: "Largest first" },
  { value: "smallest", label: "Smallest first" },
];

/**
 * Validate a folder name. Returns the human-readable problem, or `null` when
 * the name is acceptable. Mirrors the server schema plus a few path-safety
 * rules so typos are caught before the round trip.
 */
export function validateFolderName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter a folder name";
  if (name.length > 80) return "Folder names must be 80 characters or fewer";
  if (name === "." || name === "..") return "This name is reserved";
  if (name.includes("/") || name.includes("\\")) return "Folder names cannot contain slashes";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Folder names cannot contain control characters";
  if (/^[.\s]+$/.test(name)) return "Use a more descriptive folder name";
  return null;
}

/** Breadcrumb chain from the root to (and including) `folderId`. */
export function breadcrumbsFor(folders: ExplorerFolder[], folderId: string | null): ExplorerFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const crumbs: ExplorerFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    crumbs.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return crumbs;
}

/** True when `childPath` is strictly inside `ancestorPath` (`a/b` inside `a`). */
export function isDescendantPath(childPath: string, ancestorPath: string): boolean {
  return childPath.startsWith(`${ancestorPath}/`);
}

/**
 * Recursive contents of a folder tree, derived from the flat folder list plus
 * the per-folder asset counts the server provides.
 */
export function countFolderTree(
  folders: ExplorerFolder[],
  folderId: string,
): { files: number; subfolders: number } {
  const byParent = new Map<string | null, ExplorerFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  let files = 0;
  let subfolders = 0;
  const stack = [...(byParent.get(folderId) ?? [])];
  const seen = new Set<string>([folderId]);
  // The folder's own direct files:
  const self = folders.find((folder) => folder.id === folderId);
  if (self) files += self.assetCount;
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    subfolders += 1;
    files += next.assetCount;
    stack.push(...(byParent.get(next.id) ?? []));
  }
  return { files, subfolders };
}

/** Display name used across the explorer (title falls back to the filename). */
export function displayName(asset: { title: string | null; originalName: string }): string {
  return asset.title ?? asset.originalName;
}
