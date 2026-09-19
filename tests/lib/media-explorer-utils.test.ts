import { describe, expect, it } from "vitest";
import {
  breadcrumbsFor,
  confirmNameMatches,
  countFolderTree,
  displayName,
  explorerViewId,
  formatBytes,
  isDescendantPath,
  kindLabel,
  mediaKindOf,
  previewKindOf,
  transferPercent,
  validateFolderName,
  type ExplorerFolder,
} from "@/components/media/explorer-utils";

function folder(overrides: Partial<ExplorerFolder> & { id: string }): ExplorerFolder {
  return {
    name: overrides.id,
    path: overrides.id,
    parentId: null,
    assetCount: 0,
    ...overrides,
  };
}

describe("formatBytes", () => {
  it("formats byte ranges", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("mediaKindOf / kindLabel / previewKindOf", () => {
  it("classifies mime types", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("audio/mpeg")).toBe("audio");
    expect(mediaKindOf("application/pdf")).toBe("pdf");
    expect(mediaKindOf("application/zip")).toBe("file");
  });

  it("labels every kind", () => {
    for (const kind of ["image", "video", "audio", "pdf", "file"] as const) {
      expect(kindLabel(kind).length).toBeGreaterThan(0);
    }
  });

  it("detects inline previews", () => {
    expect(previewKindOf("image/webp")).toBe("image");
    expect(previewKindOf("video/mp4")).toBe("video");
    expect(previewKindOf("audio/mpeg")).toBe("audio");
    expect(previewKindOf("application/pdf")).toBeNull();
  });
});

describe("validateFolderName", () => {
  it("accepts ordinary names", () => {
    expect(validateFolderName("Product Images")).toBeNull();
    expect(validateFolderName("  shoes  ")).toBeNull();
    expect(validateFolderName("summer-2026 (2)")).toBeNull();
  });

  it("rejects empty, long, and unsafe names", () => {
    expect(validateFolderName("   ")).toBe("Enter a folder name");
    expect(validateFolderName("a".repeat(81))).toBe("Folder names must be 80 characters or fewer");
    expect(validateFolderName("a/b")).toBe("Folder names cannot contain slashes");
    expect(validateFolderName("a\\b")).toBe("Folder names cannot contain slashes");
    expect(validateFolderName("..")).toBe("This name is reserved");
    expect(validateFolderName("...")).toBe("Use a more descriptive folder name");
  });
});

describe("breadcrumbsFor", () => {
  const folders = [
    folder({ id: "a", name: "A", path: "A", parentId: null }),
    folder({ id: "b", name: "B", path: "A/B", parentId: "a" }),
    folder({ id: "c", name: "C", path: "A/B/C", parentId: "b" }),
  ];

  it("returns the chain from the root", () => {
    expect(breadcrumbsFor(folders, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(breadcrumbsFor(folders, "a").map((f) => f.id)).toEqual(["a"]);
  });

  it("returns an empty chain for the root or unknown folders", () => {
    expect(breadcrumbsFor(folders, null)).toEqual([]);
    expect(breadcrumbsFor(folders, "missing")).toEqual([]);
  });

  it("survives parent cycles without hanging", () => {
    const cyclic = [
      folder({ id: "x", name: "X", path: "X", parentId: "y" }),
      folder({ id: "y", name: "Y", path: "Y", parentId: "x" }),
    ];
    expect(breadcrumbsFor(cyclic, "x").map((f) => f.id)).toEqual(["y", "x"]);
  });
});

describe("isDescendantPath", () => {
  it("detects strict descendants", () => {
    expect(isDescendantPath("A/B", "A")).toBe(true);
    expect(isDescendantPath("A/B/C", "A")).toBe(true);
    expect(isDescendantPath("A", "A")).toBe(false);
    expect(isDescendantPath("A2/B", "A")).toBe(false);
    expect(isDescendantPath("B", "A")).toBe(false);
  });
});

describe("countFolderTree", () => {
  const folders = [
    folder({ id: "root", name: "root", path: "root", parentId: null, assetCount: 2 }),
    folder({ id: "child", name: "child", path: "root/child", parentId: "root", assetCount: 3 }),
    folder({ id: "grand", name: "grand", path: "root/child/grand", parentId: "child", assetCount: 1 }),
    folder({ id: "other", name: "other", path: "other", parentId: null, assetCount: 9 }),
  ];

  it("sums recursive contents", () => {
    expect(countFolderTree(folders, "root")).toEqual({ files: 6, subfolders: 2 });
    expect(countFolderTree(folders, "child")).toEqual({ files: 4, subfolders: 1 });
    expect(countFolderTree(folders, "grand")).toEqual({ files: 1, subfolders: 0 });
    expect(countFolderTree(folders, "other")).toEqual({ files: 9, subfolders: 0 });
  });

  it("returns zeros for unknown folders", () => {
    expect(countFolderTree(folders, "missing")).toEqual({ files: 0, subfolders: 0 });
  });
});

describe("displayName", () => {
  it("prefers the title", () => {
    expect(displayName({ title: "Hero", originalName: "img.png" })).toBe("Hero");
    expect(displayName({ title: null, originalName: "img.png" })).toBe("img.png");
  });
});

describe("explorerViewId", () => {
  it("identifies folders, with a stable root id", () => {
    expect(explorerViewId(false, "abc", "")).toBe("folder:abc");
    expect(explorerViewId(false, null, "")).toBe("folder:root");
    expect(explorerViewId(false, "a", "")).not.toBe(explorerViewId(false, "b", ""));
  });

  it("identifies searches case-insensitively, ignoring the current folder", () => {
    expect(explorerViewId(true, "abc", "  Shoes ")).toBe("search:shoes");
    expect(explorerViewId(true, null, "shoes")).toBe("search:shoes");
    expect(explorerViewId(true, null, "shoes")).not.toBe(explorerViewId(true, null, "boots"));
    expect(explorerViewId(true, "abc", "shoes")).not.toBe(explorerViewId(false, "abc", ""));
  });
});

describe("confirmNameMatches", () => {
  it("requires the exact folder name", () => {
    expect(confirmNameMatches("Summer Collection", "Summer Collection")).toBe(true);
    expect(confirmNameMatches("summer collection", "Summer Collection")).toBe(false);
    expect(confirmNameMatches("Summer", "Summer Collection")).toBe(false);
    expect(confirmNameMatches("", "Summer Collection")).toBe(false);
  });

  it("trims accidental surrounding whitespace", () => {
    expect(confirmNameMatches("  Summer Collection\n", "Summer Collection")).toBe(true);
  });

  it("never matches a blank expected name", () => {
    expect(confirmNameMatches("", "")).toBe(false);
    expect(confirmNameMatches("   ", "   ")).toBe(false);
  });
});

describe("transferPercent", () => {
  it("reports real byte-level progress", () => {
    expect(transferPercent(0, 100)).toBe(0);
    expect(transferPercent(60, 100)).toBe(60);
    expect(transferPercent(1, 3)).toBe(33);
    expect(transferPercent(150, 100)).toBe(100);
  });

  it("returns null when no honest percentage exists", () => {
    expect(transferPercent(10, 0)).toBeNull();
    expect(transferPercent(-1, 100)).toBeNull();
    expect(transferPercent(Number.NaN, 100)).toBeNull();
    expect(transferPercent(10, Number.NaN)).toBeNull();
  });
});
