import { describe, expect, it } from "vitest";
import {
  MAX_FILE_NAME_LENGTH,
  fileNameKey,
  fileNamePrefix,
  generateUniqueFileName,
  splitFileName,
} from "@/modules/media/filename";

describe("splitFileName", () => {
  it("separates the base from the extension", () => {
    expect(splitFileName("product.jpg")).toEqual({ base: "product", extension: ".jpg" });
  });

  it("only treats the last dot as the extension", () => {
    expect(splitFileName("archive.tar.gz")).toEqual({ base: "archive.tar", extension: ".gz" });
  });

  it("keeps a leading dot as part of the name", () => {
    expect(splitFileName(".env")).toEqual({ base: ".env", extension: "" });
  });

  it("handles names with no extension at all", () => {
    expect(splitFileName("README")).toEqual({ base: "README", extension: "" });
  });

  it("does not treat a trailing dot as an extension", () => {
    expect(splitFileName("weird.")).toEqual({ base: "weird.", extension: "" });
  });
});

describe("fileNameKey", () => {
  it("compares case-insensitively and ignores surrounding whitespace", () => {
    expect(fileNameKey("  Product.JPG ")).toBe("product.jpg");
    expect(fileNameKey("PRODUCT.jpg")).toBe(fileNameKey("product.JPG"));
  });
});

describe("generateUniqueFileName", () => {
  it("keeps the original name when the folder is free", () => {
    expect(generateUniqueFileName("product.jpg", [])).toBe("product.jpg");
  });

  it("appends -1 for the first collision", () => {
    expect(generateUniqueFileName("product.jpg", ["product.jpg"])).toBe("product-1.jpg");
  });

  it("walks the sequence until it finds a free slot", () => {
    expect(generateUniqueFileName("product.jpg", ["product.jpg", "product-1.jpg", "product-2.jpg"])).toBe("product-3.jpg");
  });

  it("fills a gap left by a deleted file rather than always taking the highest number", () => {
    expect(generateUniqueFileName("product.jpg", ["product.jpg", "product-2.jpg"])).toBe("product-1.jpg");
  });

  it("treats existing names case-insensitively", () => {
    expect(generateUniqueFileName("Product.JPG", ["PRODUCT.jpg"])).toBe("Product-1.JPG");
  });

  it("always preserves the extension", () => {
    expect(generateUniqueFileName("archive.tar.gz", ["archive.tar.gz"])).toBe("archive.tar-1.gz");
    expect(generateUniqueFileName("notes", ["notes"])).toBe("notes-1");
  });

  it("ignores unrelated names in the folder", () => {
    expect(generateUniqueFileName("product.jpg", ["banner.png", "hero.jpg"])).toBe("product.jpg");
  });

  it("does not collide a different extension with the same base", () => {
    // product.png is a different file; product.jpg is still free.
    expect(generateUniqueFileName("product.jpg", ["product.png"])).toBe("product.jpg");
  });

  it("falls back to a usable name when the input is blank", () => {
    expect(generateUniqueFileName("   ", [])).toBe("file");
  });

  it("stays within the maximum length while keeping the extension and suffix", () => {
    const longBase = "a".repeat(MAX_FILE_NAME_LENGTH + 50);
    const desired = `${longBase}.jpg`;
    const first = generateUniqueFileName(desired, []);
    expect(first.length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
    expect(first.endsWith(".jpg")).toBe(true);

    const second = generateUniqueFileName(desired, [first]);
    expect(second.length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
    expect(second.endsWith("-1.jpg")).toBe(true);
    expect(fileNameKey(second)).not.toBe(fileNameKey(first));
  });

  it("never returns a name that is already taken", () => {
    const taken: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const next = generateUniqueFileName("photo.png", taken);
      expect(taken.map(fileNameKey)).not.toContain(fileNameKey(next));
      taken.push(next);
    }
    expect(taken[0]).toBe("photo.png");
    expect(taken[1]).toBe("photo-1.png");
    expect(taken[24]).toBe("photo-24.png");
  });
});

describe("fileNamePrefix", () => {
  it("returns the base so a lookup can narrow to potential collisions", () => {
    expect(fileNamePrefix("product.jpg")).toBe("product");
    expect(fileNamePrefix("archive.tar.gz")).toBe("archive.tar");
  });

  it("matches every name the generator can produce for that base", () => {
    const prefix = fileNamePrefix("product.jpg");
    for (const name of ["product.jpg", "product-1.jpg", "product-17.jpg"]) {
      expect(name.startsWith(prefix)).toBe(true);
    }
  });
});
