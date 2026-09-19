/** Portable, URL-free image references in rich text. Raw HTML is never executed. */
export type RichTextPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaId: string; alt: string };
export function richTextParts(value: string): RichTextPart[] {
  const expression =
    /!\[([^\]\n]{0,300})\]\(media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
  const parts: RichTextPart[] = [];
  let offset = 0;
  for (const match of value.matchAll(expression)) {
    if (match.index > offset)
      parts.push({ type: "text", text: value.slice(offset, match.index) });
    parts.push({ type: "image", alt: match[1]!, mediaId: match[2]! });
    offset = match.index + match[0].length;
  }
  if (offset < value.length)
    parts.push({ type: "text", text: value.slice(offset) });
  return parts;
}
export function richTextMediaIds(value: string) {
  return [
    ...new Set(
      richTextParts(value).flatMap((part) =>
        part.type === "image" ? [part.mediaId] : [],
      ),
    ),
  ];
}
export function mediaImageToken(id: string, alt: string) {
  return `![${alt.replace(/[\[\]\n]/g, " ").slice(0, 300)}](media:${id})`;
}
