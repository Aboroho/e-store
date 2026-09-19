import { describe, expect, it } from "vitest";
import {
  createRichTextDocument,
  isRichTextEmpty,
  parseRichText,
  richTextToPlainText,
  serializeRichText,
  serializeRichTextOrEmpty,
} from "@/components/rich-text-editor/serialization";
import type { RichTextDocument } from "@/components/rich-text-editor/types";

/**
 * The editor stores structured JSON in existing text columns. These tests pin the
 * compatibility rules: legacy plain text upgrades transparently, empty documents
 * serialize to "" so optional columns stay empty, and stored JSON round-trips.
 */
describe("rich text serialization", () => {
  it("upgrades legacy plain text into paragraphs with hard breaks", () => {
    const document = createRichTextDocument("First paragraph\nsecond line\n\nSecond paragraph");
    expect(document).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First paragraph" }, { type: "hardBreak" }, { type: "text", text: "second line" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
      ],
    });
  });

  it("parses stored JSON documents and falls back to plain text otherwise", () => {
    const stored: RichTextDocument = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hi" }] }] };
    expect(parseRichText(serializeRichText(stored))).toEqual(stored);
    expect(parseRichText("{ not json")).toEqual(createRichTextDocument("{ not json"));
    expect(parseRichText(null)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(parseRichText("   ")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("rejects JSON that is not a document", () => {
    expect(parseRichText('{"type":"paragraph"}')).toEqual(createRichTextDocument('{"type":"paragraph"}'));
    expect(parseRichText('{"type":"doc","content":[]}')).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("treats whitespace-only documents as empty but keeps media blocks", () => {
    expect(isRichTextEmpty({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] })).toBe(true);
    expect(isRichTextEmpty({ type: "doc", content: [{ type: "image", attrs: { src: "https://cdn.example.com/a.png" } }] })).toBe(false);
    expect(serializeRichTextOrEmpty(createRichTextDocument())).toBe("");
    expect(serializeRichTextOrEmpty(createRichTextDocument("Hello"))).toContain('"Hello"');
  });

  it("projects documents to plain text for previews", () => {
    const document: RichTextDocument = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }] },
          ],
        },
        { type: "image", attrs: { src: "https://cdn.example.com/a.png", alt: "A photo" } },
      ],
    };
    expect(richTextToPlainText(document)).toBe("Title\nOne\nTwo\nA photo");
  });
});
