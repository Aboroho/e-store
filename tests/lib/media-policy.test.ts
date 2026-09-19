import { describe, expect, it } from "vitest";
import { matchesMediaType } from "@/modules/media/policy";
import {
  mediaImageToken,
  richTextMediaIds,
  richTextParts,
} from "@/modules/media/rich-text";
import {
  documentMediaIds,
  parsePageDocument,
} from "@/modules/page-builder/schema";
import { uploadRequestSchema } from "@/modules/media/schemas";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const id = "138325e6-41b5-4c48-834a-4fbe2f312a69";
describe("shared media policy and document references", () => {
  it("keeps context type restrictions even when filtering the library", () => {
    expect(matchesMediaType("application/pdf", "image")).toBe(false);
    expect(matchesMediaType("image/png", "all", ["image/*"])).toBe(true);
    expect(matchesMediaType("video/webm", "all", ["image/*"])).toBe(false);
    expect(matchesMediaType("image/jpeg", "image", ["image/png"])).toBe(false);
    expect(matchesMediaType("video/mp4", "document")).toBe(false);
    expect(matchesMediaType("video/mp4", "video")).toBe(true);
  });
  it("stores IDs instead of URLs and escapes token delimiters in alt text", () => {
    const token = mediaImageToken(id, "A ] picture\n[caption]");
    expect(richTextParts(token)).toEqual([
      { type: "image", mediaId: id, alt: "A   picture  caption " },
    ]);
    expect(richTextMediaIds(`${token} ${token}`)).toEqual([id]);
  });
  it("treats HTML and remote or javascript image markup as plain text", () => {
    const value =
      "<script>alert(1)</script> ![remote](https://evil.test/file) ![x](javascript:alert(1))";
    expect(richTextParts(value)).toEqual([{ type: "text", text: value }]);
    expect(richTextMediaIds("![x](media:not-a-uuid)")).toEqual([]);
  });
  it("collects background, image, rich-text and video references", () => {
    const second = "f7a4e358-6268-4340-bbde-0a9530a8d74a";
    const document = parsePageDocument({
      sections: [
        {
          id: "s",
          background: { mediaId: id },
          blocks: [
            { id: "b", type: "text", props: { text: mediaImageToken(id, "") } },
            { id: "i", type: "image", props: { mediaId: id } },
            {
              id: "v",
              type: "embed",
              props: { videoId: "dQw4w9WgXcQ", videoMediaId: second },
            },
          ],
        },
      ],
    });
    expect(documentMediaIds(document).sort()).toEqual([id, second].sort());
  });
  it("validates checksums and hard file-size ceilings", () => {
    const input = { fileName: "x.png", mimeType: "image/png", sizeBytes: 10 };
    expect(
      uploadRequestSchema.safeParse({ ...input, checksum: "z".repeat(64) })
        .success,
    ).toBe(false);
    expect(
      uploadRequestSchema.safeParse({ ...input, sizeBytes: 65 * 1024 * 1024 })
        .success,
    ).toBe(false);
    expect(
      uploadRequestSchema.safeParse({ ...input, checksum: "a".repeat(64) })
        .success,
    ).toBe(true);
  });
  it("does not allow module-specific file controls or S3 clients", () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(path.join(dir, entry.name))
          : [path.join(dir, entry.name)],
      );
    }
    const source = [...files("src/components"), ...files("src/modules")].filter(
      (file) => /\.tsx?$/.test(file),
    );
    for (const file of source) {
      const text = readFileSync(file, "utf8");
      if (!file.startsWith("src/components/media/"))
        expect(text, file).not.toMatch(/type=["']file["']/);
      if (file !== "src/modules/media/storage.ts")
        expect(text, file).not.toMatch(/from ["']@aws-sdk\/client-s3["']/);
      if (file !== "src/modules/media/upload-client.ts")
        expect(text, file).not.toContain("new XMLHttpRequest");
    }
  });
});
