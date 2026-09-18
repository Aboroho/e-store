import { describe, expect, it } from "vitest";
import {
  NAV_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_TEMPLATES,
  permissionsByGroup,
} from "@/lib/permissions/catalog";
import { can, canAll, canAny, assertPermission } from "@/lib/permissions";
import { ADMIN_NAV } from "@/components/layout/nav-config";
import { AppError } from "@/lib/errors";

const subject = (permissions: string[], extra: { isOwner?: boolean } = {}) => ({
  id: "u1",
  businessId: "b1",
  permissions,
  ...extra,
});

describe("permission catalogue", () => {
  it("has no duplicate keys", () => {
    const unique = new Set(PERMISSION_KEYS);
    expect(unique.size).toBe(PERMISSION_KEYS.length);
  });

  it("groups every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.group.length).toBeGreaterThan(0);
      expect(permission.label.length).toBeGreaterThan(0);
    }
    const groups = permissionsByGroup();
    expect(Object.keys(groups).length).toBeGreaterThan(3);
  });

  it("only references known permissions from role templates", () => {
    const known = new Set(PERMISSION_KEYS);
    for (const template of ROLE_TEMPLATES) {
      if (template.permissions === "*") continue;
      for (const key of template.permissions) {
        expect(known.has(key), `${template.slug} references unknown permission ${key}`).toBe(true);
      }
    }
  });

  it("keeps the owner template at wildcard and every other template non-empty", () => {
    const owner = ROLE_TEMPLATES.find((template) => template.slug === "owner");
    expect(owner?.permissions).toBe("*");
    expect(owner?.isProtected).toBe(true);
    for (const template of ROLE_TEMPLATES.filter((candidate) => candidate.slug !== "owner")) {
      expect(Array.isArray(template.permissions)).toBe(true);
      expect((template.permissions as string[]).length).toBeGreaterThan(0);
    }
  });

  it("requires every navigation entry to declare a known permission", () => {
    const known = new Set(PERMISSION_KEYS);
    for (const section of ADMIN_NAV) {
      for (const item of section.items) {
        expect(known.has(item.permission), `nav item ${item.href} uses unknown permission ${item.permission}`).toBe(true);
        expect(NAV_PERMISSIONS[item.permission] ?? item.permission).toBe(item.permission);
      }
    }
  });
});

describe("permission checks", () => {
  it("grants owners everything", () => {
    expect(can(subject([], { isOwner: true }), "settings.manage")).toBe(true);
  });

  it("treats a wildcard as full access", () => {
    expect(can(subject(["*"]), "role.manage")).toBe(true);
  });

  it("is false for missing permissions and null subjects", () => {
    expect(can(subject(["order.view"]), "order.update")).toBe(false);
    expect(can(null, "order.view")).toBe(false);
    expect(canAny(subject(["order.view"]), ["order.update", "payment.view"])).toBe(false);
    expect(canAny(subject(["order.view"]), ["order.view", "payment.view"])).toBe(true);
    expect(canAll(subject(["order.view"]), ["order.view", "payment.view"])).toBe(false);
    expect(canAll(subject(["order.view", "payment.view"]), ["order.view", "payment.view"])).toBe(true);
  });

  it("throws a forbidden AppError when a permission is missing", () => {
    expect(() => assertPermission(subject(["order.view"]), "payment.view")).toThrowError(AppError);
    try {
      assertPermission(subject(["order.view"]), "payment.view");
    } catch (error) {
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
    expect(() => assertPermission(subject(["order.view"]), "order.view")).not.toThrow();
  });

  it("accepts both arrays and sets as permission collections", () => {
    expect(can({ id: "u", businessId: "b", permissions: new Set(["order.view"]) }, "order.view")).toBe(true);
  });
});
