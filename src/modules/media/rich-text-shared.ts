/**
 * Client-safe rich-text helpers (no database, no secrets).
 *
 * The page-builder schema runs in the browser (builder canvas) as well as on
 * the server, so media-id extraction and sanitising live here. URL resolution
 * and usage sync stay server-side in `./rich-text`.
 */

const MEDIA_ID_PATTERN = /data-media-id="([0-9a-fA-F-]{36})"/g;

const ALLOWED_TAGS = new Set(["p", "br", "h2", "h3", "strong", "em", "u", "ul", "ol", "li", "a", "img"]);
const VOID_TAGS = new Set(["br", "img"]);

/** Was this value authored with the rich-text editor (as opposed to plain text)? */
export function isRichText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<\/?(p|br|img|ul|ol|li|h2|h3|strong|em|u|a)[\s>/]/i.test(value);
}

/** Every media id referenced by `<img data-media-id="…">` tags (deduplicated). */
export function extractRichTextMediaIds(html: string | null | undefined): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  for (const match of html.matchAll(MEDIA_ID_PATTERN)) {
    if (match[1]) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

/** Plain-text excerpt of rich-text HTML (builder canvas previews, excerpts). */
export function richTextExcerpt(html: string | null | undefined, maxLength = 120): string {
  if (!html) return "";
  const text = String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attributeValue(tag: string, name: string): string | null {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (!quoted) return null;
  return quoted[2] ?? quoted[3] ?? null;
}

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (/^(\/|https?:\/\/|mailto:|tel:)/i.test(trimmed) && !/[\s<>"]/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Allow-list sanitiser. Unknown tags are dropped but their text is kept;
 * `img` keeps only `data-media-id` + `alt` (the `src` is always re-resolved
 * server-side); `a` keeps only safe `href` values.
 */
export function sanitizeRichText(html: string): string {
  const tokens = String(html).split(/(<[^>]*>)/g);
  let output = "";

  for (const token of tokens) {
    if (!token.startsWith("<") || !token.endsWith(">")) {
      output += escapeHtml(token);
      continue;
    }
    const closing = /^<\/\s*([a-z0-9]+)\s*>$/i.exec(token);
    if (closing) {
      const name = closing[1]!.toLowerCase();
      if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) output += `</${name}>`;
      continue;
    }
    const opening = /^<\s*([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?\s*>$/i.exec(token);
    if (!opening) {
      output += escapeHtml(token);
      continue;
    }
    const name = opening[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;

    if (name === "a") {
      const href = safeHref(attributeValue(token, "href"));
      output += href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">` : "<span>";
      continue;
    }
    if (name === "img") {
      const mediaId = attributeValue(token, "data-media-id");
      if (!mediaId || !/^[0-9a-fA-F-]{36}$/.test(mediaId)) continue;
      const alt = attributeValue(token, "alt") ?? "";
      output += `<img data-media-id="${mediaId.toLowerCase()}" alt="${escapeHtml(alt)}" loading="lazy" />`;
      continue;
    }
    if (name === "br") {
      output += "<br />";
      continue;
    }
    output += `<${name}>`;
  }

  return output;
}
