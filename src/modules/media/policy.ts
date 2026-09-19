/** Shared picker policy. Client constraints improve UX; domain writers revalidate IDs. */
export type MediaGroup = "image" | "video" | "document" | "all";
export function matchesMediaType(
  mime: string,
  group: MediaGroup,
  allowedTypes?: readonly string[],
) {
  const groupMatch =
    group === "all" ||
    (group === "document"
      ? ["application/pdf", "text/csv"].includes(mime)
      : mime.startsWith(`${group}/`));
  return (
    groupMatch &&
    (!allowedTypes?.length ||
      allowedTypes.some((type) =>
        type.endsWith("/*")
          ? mime.startsWith(type.slice(0, -1))
          : mime === type,
      ))
  );
}
export const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function uploadMimeType(file: { name: string; type: string }) {
  // Browsers disagree on CSV MIME declarations; the server validates UTF-8 text again.
  return /\.csv$/i.test(file.name) &&
    (!file.type ||
      ["text/csv", "application/vnd.ms-excel", "text/plain"].includes(
        file.type,
      ))
    ? "text/csv"
    : file.type;
}
