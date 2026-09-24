import { describe, expect, it } from "vitest";
import {
  STATUS_GROUPS,
  STATUS_GROUP_PERMISSIONS,
  USER_FACING_STATUSES,
  availableTransitions,
  canManageStatusGroup,
  canOverrideStatuses,
  courierStatusText,
  displayStatus,
  evaluateOrderEditPermission,
  evaluateStatusTransition,
  holdsPermission,
  isBackwardTransition,
  isDispatchEligible,
  isPreCourier,
  statusGroupOf,
  statusLabel,
  statusesInGroup,
  type StatusActor,
  type StatusSubject,
} from "@/modules/orders/status";

/**
 * The status policy in isolation.
 *
 * These are pure functions: no database, no session, no HTTP. What is asserted
 * here is exactly what the server enforces on every status request, so the UI
 * and the API can never disagree (docs/BUSINESS_RULES.md → "Order status model").
 */

function actor(permissions: string[], extra: Partial<StatusActor> = {}): StatusActor {
  return { userId: "user-1", permissions: new Set(permissions), ...extra };
}

function subject(status: string, extra: Partial<StatusSubject> = {}): StatusSubject {
  return {
    status,
    orderType: "ONLINE_DELIVERY",
    channel: "ADMIN",
    createdByUserId: "user-1",
    resellerId: null,
    shipmentState: "NONE",
    hasSettledFinance: false,
    ...extra,
  };
}

const PRE = STATUS_GROUP_PERMISSIONS.PRE_COURIER;
const COURIER = STATUS_GROUP_PERMISSIONS.COURIER;
const POST = STATUS_GROUP_PERMISSIONS.POST_COURIER;
const OVERRIDE = "order.status.override";

describe("status groups", () => {
  it("puts every user-facing status in exactly one group", () => {
    const seen = new Set<string>();
    for (const status of USER_FACING_STATUSES) {
      const group = statusGroupOf(status);
      expect(STATUS_GROUPS[group]).toContain(status);
      expect(seen.has(status)).toBe(false);
      seen.add(status);
    }
  });

  it("treats processing, confirmed, on hold and canceled as pre-courier", () => {
    for (const status of ["PROCESSING", "CONFIRMED", "ON_HOLD", "CANCELLED"]) {
      expect(isPreCourier(status)).toBe(true);
      expect(statusGroupOf(status)).toBe("PRE_COURIER");
    }
  });

  it("treats shipped as the courier stage and delivery outcomes as post-courier", () => {
    expect(statusGroupOf("SHIPPED")).toBe("COURIER");
    for (const status of ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"]) {
      expect(statusGroupOf(status)).toBe("POST_COURIER");
    }
    expect(statusesInGroup("PRE_COURIER")).toEqual(STATUS_GROUPS.PRE_COURIER);
  });

  it("labels a status with the courier status alongside it", () => {
    expect(displayStatus("SHIPPED", "in_review")).toBe("In Courier (In review)");
    expect(displayStatus("SHIPPED", null)).toBe("In Courier");
    expect(displayStatus("DELIVERED")).toBe(statusLabel("DELIVERED"));
    expect(courierStatusText("partial_delivered")).toBe("Partial delivered");
    expect(courierStatusText("")).toBeNull();
  });

  it("knows which moves are backward in the linear sequence", () => {
    expect(isBackwardTransition("CONFIRMED", "PROCESSING")).toBe(true);
    expect(isBackwardTransition("PROCESSING", "CONFIRMED")).toBe(false);
    expect(isBackwardTransition("DELIVERED", "SHIPPED")).toBe(true);
    expect(isBackwardTransition("SHIPPED", "PROCESSING")).toBe(true);
  });
});

describe("permission helpers", () => {
  it("gives the owner everything", () => {
    expect(holdsPermission(actor([], { isOwner: true }), "order.status.override")).toBe(true);
    expect(canOverrideStatuses(actor([], { isOwner: true }))).toBe(true);
  });

  it("honours the wildcard permission", () => {
    expect(holdsPermission(actor(["*"]), PRE)).toBe(true);
  });

  it("requires the group permission explicitly", () => {
    expect(canManageStatusGroup(actor([PRE]), "PRE_COURIER")).toBe(true);
    expect(canManageStatusGroup(actor([PRE]), "COURIER")).toBe(false);
    expect(canOverrideStatuses(actor([PRE, COURIER, POST]))).toBe(false);
  });
});

describe("evaluateStatusTransition — creator inside the pre-courier group", () => {
  const creator = actor([PRE, "order.cancel", "order.update"]);

  it("allows forward and backward moves inside the group", () => {
    // Forward from PROCESSING -> CONFIRMED
    const forward = evaluateStatusTransition({ actor: creator, subject: subject("PROCESSING"), target: "CONFIRMED" });
    expect(forward.allowed).toBe(true);
    expect(forward.isAdminOverride).toBe(false);

    // Forward to ON_HOLD with reason
    const hold = evaluateStatusTransition({
      actor: creator,
      subject: subject("PROCESSING"),
      target: "ON_HOLD",
      reason: "Waiting on customer address",
    });
    expect(hold.allowed).toBe(true);

    // Backward from CONFIRMED -> PROCESSING
    const backward = evaluateStatusTransition({ actor: creator, subject: subject("CONFIRMED"), target: "PROCESSING" });
    expect(backward.allowed).toBe(true);
    expect(backward.isBackward).toBe(true);
  });

  it("requires a written reason for on hold and canceled", () => {
    for (const target of ["ON_HOLD", "CANCELLED"] as const) {
      const withoutReason = evaluateStatusTransition({ actor: creator, subject: subject("PROCESSING"), target });
      expect(withoutReason.allowed).toBe(false);
      expect(withoutReason.requiresReason).toBe(true);
      expect(withoutReason.deniedReason).toMatch(/reason is required/i);

      const withReason = evaluateStatusTransition({
        actor: creator,
        subject: subject("PROCESSING"),
        target,
        reason: "Customer asked to wait",
      });
      expect(withReason.allowed).toBe(true);
    }
  });

  it("refuses to leave the pre-courier group without the group permission", () => {
    const decision = evaluateStatusTransition({ actor: creator, subject: subject("CONFIRMED"), target: "DELIVERED" });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/post-courier/i);
  });

  it("refuses a plain move into courier — dispatch is its own workflow", () => {
    const decision = evaluateStatusTransition({
      actor: actor([PRE, COURIER]),
      subject: subject("CONFIRMED"),
      target: "SHIPPED",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/Send to courier/i);
    expect(decision.effect).toBe("REQUIRES_DISPATCH");
  });

  it("refuses to reopen a cancelled order without the override", () => {
    const decision = evaluateStatusTransition({ actor: creator, subject: subject("CANCELLED"), target: "PROCESSING" });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/administrative status override/i);
  });

  it("refuses a backward move that crosses groups without the override", () => {
    const decision = evaluateStatusTransition({
      actor: actor([PRE, POST]),
      subject: subject("DELIVERED"),
      target: "PROCESSING",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.crossesGroup).toBe(true);
    expect(decision.isBackward).toBe(true);
  });

  it("reports cancelling as releasing reservations", () => {
    const decision = evaluateStatusTransition({
      actor: creator,
      subject: subject("PROCESSING"),
      target: "CANCELLED",
      reason: "Out of stock",
    });
    expect(decision.effect).toBe("RELEASE_RESERVATIONS");
  });
});

describe("evaluateStatusTransition — administrative override", () => {
  const admin = actor([PRE, COURIER, POST, OVERRIDE, "order.cancel"]);

  it("allows any → any but demands a confirmation for backward and cross-group moves", () => {
    const unconfirmed = evaluateStatusTransition({ actor: admin, subject: subject("DELIVERED"), target: "PROCESSING" });
    expect(unconfirmed.allowed).toBe(false);
    expect(unconfirmed.isAdminOverride).toBe(true);
    expect(unconfirmed.requiresConfirmation).toBe(true);
    expect(unconfirmed.deniedReason).toMatch(/explicit confirmation/i);
    expect(unconfirmed.warning?.points.length).toBeGreaterThan(0);
    expect(unconfirmed.warning?.points.join(" ")).toMatch(/backward/i);

    const confirmed = evaluateStatusTransition({
      actor: admin,
      subject: subject("DELIVERED"),
      target: "PROCESSING",
      confirmed: true,
      reason: "Courier delivered the wrong parcel",
    });
    expect(confirmed.allowed).toBe(true);
    expect(confirmed.isAdminOverride).toBe(true);
  });

  it("still refuses to reopen a cancelled order with settled finance", () => {
    const decision = evaluateStatusTransition({
      actor: admin,
      subject: subject("CANCELLED", { hasSettledFinance: true }),
      target: "PROCESSING",
      confirmed: true,
      reason: "Reopening for reconciliation",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/settled financial records/i);
  });

  it("reopening a cancelled order restores reservations", () => {
    const decision = evaluateStatusTransition({
      actor: admin,
      subject: subject("CANCELLED"),
      target: "PROCESSING",
      confirmed: true,
      reason: "Customer paid after all",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.effect).toBe("RESTORE_RESERVATIONS");
    expect(decision.warning).toBeUndefined();
  });

  it("a same-status move is always refused", () => {
    const decision = evaluateStatusTransition({ actor: admin, subject: subject("PROCESSING"), target: "PROCESSING" });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/already/i);
  });
});

describe("evaluateStatusTransition — partial delivery and returns", () => {
  it("routes a partial delivery through the partial-delivery workflow", () => {
    const decision = evaluateStatusTransition({
      actor: actor([COURIER, POST]),
      subject: subject("SHIPPED", { shipmentState: "CREATED" }),
      target: "PARTIALLY_DELIVERED",
      reason: "Customer rejected 1 of 2 items",
    });
    expect(decision.effect).toBe("PARTIAL_DELIVERY");
    expect(decision.allowed).toBe(true);
  });

  it("needs the post-courier permission to record a partial delivery", () => {
    const decision = evaluateStatusTransition({
      actor: actor([PRE]),
      subject: subject("SHIPPED", { shipmentState: "CREATED" }),
      target: "PARTIALLY_DELIVERED",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.deniedReason).toMatch(/post-courier/i);
  });

  it("records a return as returning stock", () => {
    const decision = evaluateStatusTransition({
      actor: actor([COURIER, POST]),
      subject: subject("SHIPPED", { shipmentState: "FINAL" }),
      target: "RETURNED",
      reason: "Customer refused the parcel",
    });
    expect(decision.effect).toBe("RETURN_TO_STOCK");
    expect(decision.allowed).toBe(true);
  });
});

describe("availableTransitions", () => {
  it("offers the creator only what the server would accept", () => {
    const options = availableTransitions({ actor: actor([PRE, "order.cancel"]), subject: subject("PROCESSING") });
    const labels = options.map((option) => option.label);
    expect(labels).toContain(statusLabel("CONFIRMED"));
    expect(labels).not.toContain(statusLabel("PROCESSING"));

    const confirmed = options.find((option) => option.target === "CONFIRMED");
    expect(confirmed?.allowed).toBe(true);
    const delivered = options.find((option) => option.target === "DELIVERED");
    expect(delivered?.allowed).toBe(false);
    expect(delivered?.deniedReason).toBeTruthy();
  });

  it("marks override moves as needing confirmation before they are allowed", () => {
    const options = availableTransitions({ actor: actor([PRE, POST, OVERRIDE]), subject: subject("DELIVERED") });
    const back = options.find((option) => option.target === "PROCESSING");
    expect(back?.allowed).toBe(false);
    expect(back?.requiresConfirmation).toBe(true);
    expect(back?.warning).toBeTruthy();
  });
});

describe("evaluateOrderEditPermission", () => {
  it("lets a permitted user edit a pre-courier order without a warning", () => {
    const result = evaluateOrderEditPermission({ actor: actor(["order.update"]), subject: subject("PROCESSING") });
    expect(result).toMatchObject({ allowed: true, requiresConfirmation: false, isPostCourier: false });
  });

  it("refuses a pre-courier edit without order.update", () => {
    const result = evaluateOrderEditPermission({ actor: actor([PRE]), subject: subject("PROCESSING") });
    expect(result.allowed).toBe(false);
    expect(result.deniedReason).toMatch(/not allowed to edit/i);
  });

  it("requires the post-courier permission once the parcel left", () => {
    const denied = evaluateOrderEditPermission({
      actor: actor(["order.update"]),
      subject: subject("SHIPPED", { shipmentState: "CREATED" }),
    });
    expect(denied.allowed).toBe(false);
    expect(denied.isPostCourier).toBe(true);
    expect(denied.deniedReason).toMatch(/Edit orders after courier handover/);

    const unconfirmed = evaluateOrderEditPermission({
      actor: actor(["order.update", "order.edit_post_courier"]),
      subject: subject("SHIPPED", { shipmentState: "CREATED" }),
    });
    expect(unconfirmed.allowed).toBe(false);
    expect(unconfirmed.requiresConfirmation).toBe(true);
    expect(unconfirmed.warning?.points.join(" ")).toMatch(/audit/i);

    const allowed = evaluateOrderEditPermission({
      actor: actor(["order.update", "order.edit_post_courier"]),
      subject: subject("SHIPPED", { shipmentState: "CREATED" }),
      confirmed: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.requiresConfirmation).toBe(true);
  });

  it("treats the administrative override as post-courier editing rights", () => {
    const result = evaluateOrderEditPermission({
      actor: actor(["order.update", OVERRIDE]),
      subject: subject("DELIVERED"),
      confirmed: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.isPostCourier).toBe(true);
  });

  it("still asks for the confirmation when it was not given", () => {
    const result = evaluateOrderEditPermission({
      actor: actor(["order.update", "order.edit_post_courier"]),
      subject: subject("DELIVERED"),
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
  });
});

describe("isDispatchEligible", () => {
  it("allows confirmed online-delivery orders with shipping address", () => {
    const result = isDispatchEligible({
      status: "CONFIRMED",
      orderType: "ONLINE_DELIVERY",
      channel: "ADMIN",
      shipmentState: "NONE",
      hasShippingAddress: true,
    });
    expect(result.eligible).toBe(true);
  });

  it("rejects non-confirmed orders", () => {
    const result = isDispatchEligible({
      status: "PROCESSING",
      orderType: "ONLINE_DELIVERY",
      hasShippingAddress: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Only confirmed orders/);
  });

  it("rejects in-store orders", () => {
    const result = isDispatchEligible({
      status: "CONFIRMED",
      orderType: "IN_STORE",
      hasShippingAddress: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/In-store orders/);
  });

  it("rejects orders without shipping address", () => {
    const result = isDispatchEligible({
      status: "CONFIRMED",
      orderType: "ONLINE_DELIVERY",
      hasShippingAddress: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/district and full address/);
  });

  it("rejects orders already sent to courier", () => {
    const result = isDispatchEligible({
      status: "CONFIRMED",
      orderType: "ONLINE_DELIVERY",
      shipmentState: "CREATED",
      hasShippingAddress: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/already sent/);
  });
});
