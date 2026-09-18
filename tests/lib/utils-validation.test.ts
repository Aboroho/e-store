import { describe, expect, it } from "vitest";
import { groupBy, normalizeBdPhone, percent, slugify, toggleInArray, toNumber, truncate } from "@/lib/utils";
import { parseListQuery } from "@/lib/validation";
import { AppError } from "@/lib/errors";

const params = (input: Record<string, string>) => input;

describe("text and phone helpers", () => {
  it("slugs business names into URL safe identifiers", () => {
    expect(slugify("Demo Store — Dhaka")).toBe("demo-store-dhaka");
    expect(slugify("  Multi   Space  ")).toBe("multi-space");
    expect(slugify("!!!")).toBe("");
  });

  it("normalises Bangladeshi mobile numbers", () => {
    expect(normalizeBdPhone("01712345678")).toBe("01712345678");
    expect(normalizeBdPhone("+8801712345678")).toBe("01712345678");
    expect(normalizeBdPhone("8801712345678")).toBe("01712345678");
    expect(normalizeBdPhone("0171-234 5678")).toBe("01712345678");
    expect(normalizeBdPhone("01212345678")).toBeNull();
    expect(normalizeBdPhone("0171234567")).toBeNull();
    expect(normalizeBdPhone("+14155552671")).toBeNull();
  });

  it("truncates and groups values", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(truncate("abcd", 5)).toBe("abcd");
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("nonsense", 3)).toBe(3);
    expect(toggleInArray(["a", "b"], "b")).toEqual(["a"]);
    expect(toggleInArray(["a"], "b")).toEqual(["a", "b"]);
    expect(percent(1, 4)).toBe("25.0%");
    expect(percent(0, 0)).toBe("0%");
    expect(groupBy([{ k: "a" }, { k: "b" }, { k: "a" }], (item) => item.k)).toEqual({
      a: [{ k: "a" }, { k: "a" }],
      b: [{ k: "b" }],
    });
  });
});

describe("list query parsing", () => {
  it("applies defaults and converts the page into skip/take", () => {
    const query = parseListQuery(params({}), { defaultSortBy: "createdAt" });
    expect(query).toMatchObject({ page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "createdAt", sortDir: "desc" });
  });

  it("caps the page size so a client cannot request unlimited rows", () => {
    const query = parseListQuery(params({ pageSize: "5000" }), { defaultSortBy: "name", maxPageSize: 100 });
    expect(query.pageSize).toBe(100);
  });

  it("ignores client supplied sort columns that are not allowed", () => {
    const query = parseListQuery(params({ sortBy: "dropTable" }), { defaultSortBy: "placedAt" });
    expect(query.sortBy).toBe("placedAt");
  });

  it("accepts an allowed sort column and direction", () => {
    const query = parseListQuery(params({ sortBy: "total", sortDir: "asc" }), {
      defaultSortBy: "placedAt",
      allowedSortBy: ["placedAt", "total"],
    });
    expect(query.sortBy).toBe("total");
    expect(query.sortDir).toBe("asc");
  });

  it("normalises search and clamps negative pages", () => {
    const query = parseListQuery(params({ q: "  puma  ", page: "-3", pageSize: "0" }), { defaultSortBy: "name" });
    expect(query.search).toBe("puma");
    expect(query.page).toBe(1);
    expect(query.pageSize).toBeGreaterThan(0);
  });
});

describe("AppError", () => {
  it("maps error codes to HTTP status codes", () => {
    expect(AppError.validation("bad").status).toBe(422);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.conflict("dup").status).toBe(409);
    expect(AppError.insufficientStock("short").status).toBe(409);
    expect(AppError.rateLimited().status).toBe(429);
  });

  it("keeps details for the caller without leaking internals", () => {
    const error = AppError.validation("Quantity must be positive", [{ path: "quantity", message: "too small" }]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual([{ path: "quantity", message: "too small" }]);
  });
});
