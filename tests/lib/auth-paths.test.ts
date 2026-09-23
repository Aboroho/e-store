import { describe, expect, it } from "vitest";
import { safeRedirectPath, staffLoginPath } from "@/lib/auth/paths";

describe("staff login paths", () => {
  it("keeps an internal admin path and rejects off-site values", () => {
    expect(safeRedirectPath("/admin/catalog/products")).toBe("/admin/catalog/products");
    expect(safeRedirectPath("/admin/catalog/products?q=1")).toBe("/admin/catalog/products?q=1");
    expect(safeRedirectPath("//evil.example")).toBe("/admin");
    expect(safeRedirectPath("https://evil.example")).toBe("/admin");
    expect(safeRedirectPath("/login")).toBe("/admin");
  });

  it("builds the sign-in URL the proxy and the layout both use", () => {
    expect(staffLoginPath()).toBe("/login");
    expect(staffLoginPath({ redirectTo: "/admin/catalog/products" })).toBe("/login?redirectTo=%2Fadmin%2Fcatalog%2Fproducts");
    expect(staffLoginPath({ sessionExpired: true })).toBe("/login?sessionExpired=1");
  });
});
