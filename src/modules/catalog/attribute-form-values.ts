/**
 * Parsing for the dynamic attribute-value editor.
 *
 * The "New attribute" form renders one text input per row (`valueTexts`) plus a
 * matching optional hex colour input (`valueColors`). Because every row renders
 * both inputs together, the two arrays submitted by the browser stay
 * index-aligned, so we can zip them by position. Blank rows are dropped so the
 * operator can leave boxes empty (or remove them) without creating values.
 */

export interface AttributeValueDraft {
  value: string;
  colorHex?: string;
  mediaId?: string;
}

export function attributeValuesFromForm(entries: { texts: string[]; colors: string[]; mediaIds?: string[] }): AttributeValueDraft[] {
  return entries.texts
    .map((rawText, index) => ({
      text: rawText.trim(),
      colorHex: (entries.colors[index] ?? "").trim(),
      mediaId: (entries.mediaIds?.[index] ?? "").trim(),
    }))
    .filter((row) => row.text !== "")
    .map((row) => ({ value: row.text, colorHex: row.colorHex || undefined, mediaId: row.mediaId || undefined }));
}
