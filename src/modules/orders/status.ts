/**
 * Order status model, status groups and transition rules.
 *
 * One source of truth for:
 *   - the internal lifecycle (`OrderStatus`) and the labels users see;
 *   - the three status groups (pre-courier, courier stage, post-courier);
 *   - which permission manages which group;
 *   - whether a requested transition is allowed, whether it needs an explicit
 *     confirmation, whether it needs a reason and what it does to stock;
 *   - the initial status of a manually created order.
 *
 * The module is deliberately free of `server-only` imports and of database
 * access: it decides *policy* from plain data. Every caller (server action, API
 * route, domain service) resolves the order and the actor's permissions first
 * and then asks this module for a decision, so the UI and the enforcement path
 * can never disagree. Hiding a button in the UI is never authorization — the
 * decision is re-evaluated on the server for every request.
 */

export type InternalOrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "CONFIRMED"
  | "ON_HOLD"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "RETURNED"
  | "COMPLETED"
  | "CANCELLED";

export type OrderTypeValue = "ONLINE_DELIVERY" | "IN_STORE" | "PREORDER";

export type StatusGroup = "PRE_COURIER" | "COURIER" | "POST_COURIER";

/** The eight user-facing statuses required by the order-management workflow. */
export const USER_FACING_STATUSES: InternalOrderStatus[] = [
  "PROCESSING",
  "CONFIRMED",
  "ON_HOLD",
  "CANCELLED",
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
];

export const STATUS_LABELS: Record<InternalOrderStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  CONFIRMED: "Confirmed",
  ON_HOLD: "On Hold",
  READY_TO_SHIP: "Ready to Ship",
  SHIPPED: "In Courier",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partially Delivered",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  CANCELLED: "Canceled",
};

export const ORDER_TYPE_LABELS: Record<OrderTypeValue, string> = {
  ONLINE_DELIVERY: "Online delivery",
  IN_STORE: "In-store",
  PREORDER: "Pre-order",
};

export const ORDER_TYPE_HINTS: Record<OrderTypeValue, string> = {
  ONLINE_DELIVERY:
    "Courier delivery to the customer's address. Delivery charge, district and address are required; the parcel can be sent to the courier once the order is confirmed.",
  IN_STORE:
    "Counter sale. Customer details are optional, no courier fields are needed and the sale is completed and paid immediately using the in-store workflow.",
  PREORDER:
    "Accept the order even when stock is not available. The uncovered quantity is recorded as a preorder commitment and allocated FIFO when stock arrives.",
};

export const STATUS_TONES: Record<InternalOrderStatus, "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet"> = {
  PENDING: "warning",
  PROCESSING: "brand",
  CONFIRMED: "info",
  ON_HOLD: "warning",
  READY_TO_SHIP: "violet",
  SHIPPED: "violet",
  DELIVERED: "success",
  PARTIALLY_DELIVERED: "warning",
  RETURNED: "danger",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export const STATUS_GROUPS: Record<StatusGroup, InternalOrderStatus[]> = {
  PRE_COURIER: ["PENDING", "PROCESSING", "CONFIRMED", "ON_HOLD", "READY_TO_SHIP", "CANCELLED"],
  COURIER: ["SHIPPED"],
  POST_COURIER: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "COMPLETED"],
};

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  PRE_COURIER: "Pre-courier",
  COURIER: "In courier",
  POST_COURIER: "Post-courier",
};

export const STATUS_GROUP_PERMISSIONS: Record<StatusGroup, string> = {
  PRE_COURIER: "order.status.pre_courier",
  COURIER: "order.status.courier",
  POST_COURIER: "order.status.post_courier",
};

export const STATUS_GROUP_HINTS: Record<StatusGroup, string> = {
  PRE_COURIER: "Processing, Confirmed, On Hold, Ready to Ship and Canceled — nothing has been handed to a courier yet.",
  COURIER: "In Courier — the parcel is with the courier. Data changes here can desynchronise the shipment, COD and stock.",
  POST_COURIER: "Delivered, Partially Delivered, Returned and Completed — the outcome of the delivery.",
};

/**
 * Linear order inside the pre-courier group, used only to tell a backward move
 * from a forward one. `ON_HOLD` and `CANCELLED` are side states: moving to them
 * is never "forward", moving away from them is never "backward".
 */
const PRE_COURIER_SEQUENCE: InternalOrderStatus[] = ["PENDING", "PROCESSING", "CONFIRMED", "READY_TO_SHIP"];

const GROUP_RANK: Record<StatusGroup, number> = { PRE_COURIER: 0, COURIER: 1, POST_COURIER: 2 };

/** Status a manually created order starts in — the client never chooses it. */
export const INITIAL_STATUS_BY_ORDER_TYPE: Record<OrderTypeValue, InternalOrderStatus> = {
  ONLINE_DELIVERY: "PROCESSING",
  PREORDER: "PROCESSING",
  // In-store sales keep the documented counter behaviour: handed over and paid
  // on the spot, so the order is completed immediately (see docs/BUSINESS_RULES.md).
  IN_STORE: "COMPLETED",
};

export function statusLabel(status: InternalOrderStatus | string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status as InternalOrderStatus] ?? String(status).replace(/_/g, " ").toLowerCase();
}

/** `In Courier (Delivered to hub)` — internal status plus the courier's own words. */
export function displayStatus(status: InternalOrderStatus | string, courierStatusRaw?: string | null): string {
  const base = statusLabel(status);
  const courier = courierStatusText(courierStatusRaw);
  return courier ? `${base} (${courier})` : base;
}

/** Turn a provider status such as `out_for_delivery` into readable text. */
export function courierStatusText(raw?: string | null): string | null {
  if (!raw) return null;
  const words = String(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusGroupOf(status: InternalOrderStatus | string): StatusGroup {
  for (const group of Object.keys(STATUS_GROUPS) as StatusGroup[]) {
    if (STATUS_GROUPS[group].includes(status as InternalOrderStatus)) return group;
  }
  return "PRE_COURIER";
}

export function isPreCourier(status: InternalOrderStatus | string): boolean {
  return statusGroupOf(status) === "PRE_COURIER";
}

/** True when the target status sits earlier in the lifecycle than the current one. */
export function isBackwardTransition(from: InternalOrderStatus | string, to: InternalOrderStatus | string): boolean {
  const fromGroup = statusGroupOf(from);
  const toGroup = statusGroupOf(to);
  if (GROUP_RANK[toGroup] < GROUP_RANK[fromGroup]) return true;
  if (toGroup !== fromGroup) return false;
  if (to === "CANCELLED" || to === "ON_HOLD") return false;
  const fromIndex = PRE_COURIER_SEQUENCE.indexOf(from as InternalOrderStatus);
  const toIndex = PRE_COURIER_SEQUENCE.indexOf(to as InternalOrderStatus);
  if (fromIndex < 0 || toIndex < 0) return false;
  return toIndex < fromIndex;
}

export function statusesInGroup(group: StatusGroup): InternalOrderStatus[] {
  return STATUS_GROUPS[group];
}

// ---------------------------------------------------------------------------
// Actor / subject shapes
// ---------------------------------------------------------------------------

export interface StatusActor {
  userId: string | null;
  permissions: ReadonlySet<string> | readonly string[];
  isOwner?: boolean;
  /** Role label snapshot used for the audit trail and the order list. */
  roleLabel?: string | null;
  /** Reseller profile id when the signed-in user is a reseller. */
  resellerId?: string | null;
}

export interface StatusSubject {
  status: InternalOrderStatus | string;
  orderType?: OrderTypeValue | string;
  channel?: string;
  createdByUserId?: string | null;
  resellerId?: string | null;
  /** Whether a courier shipment exists and how far it got. */
  shipmentState?: "NONE" | "REQUESTED" | "CREATED" | "IN_PROGRESS" | "FINAL";
  /** True when the order already has reconciled financial records. */
  hasSettledFinance?: boolean;
}

export type InventoryEffect =
  | "NONE"
  | "RELEASE_RESERVATIONS"
  | "RESTORE_RESERVATIONS"
  | "REQUIRES_DISPATCH"
  | "MARK_DELIVERED"
  | "PARTIAL_DELIVERY"
  | "RETURN_TO_STOCK";

export interface TransitionDecision {
  allowed: boolean;
  /** Why the transition was refused — shown to the user verbatim. */
  deniedReason?: string;
  target: InternalOrderStatus;
  fromGroup: StatusGroup;
  toGroup: StatusGroup;
  isBackward: boolean;
  crossesGroup: boolean;
  isAdminOverride: boolean;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  effect: InventoryEffect;
  /** Warning copy for the confirmation dialog (present when confirmation is required). */
  warning?: { title: string; points: string[] };
}

export function holdsPermission(actor: StatusActor, permission: string): boolean {
  if (actor.isOwner) return true;
  const set = actor.permissions instanceof Set ? actor.permissions : new Set(actor.permissions);
  if (set.has("*")) return true;
  return set.has(permission);
}

export function canManageStatusGroup(actor: StatusActor, group: StatusGroup): boolean {
  return holdsPermission(actor, STATUS_GROUP_PERMISSIONS[group]);
}

export function canOverrideStatuses(actor: StatusActor): boolean {
  return holdsPermission(actor, "order.status.override");
}

/** Statuses whose transition always needs a written reason. */
const REASON_REQUIRED: InternalOrderStatus[] = ["CANCELLED", "ON_HOLD", "RETURNED", "PARTIALLY_DELIVERED"];

/**
 * Decide whether `actor` may move `subject` to `target`.
 *
 * Rules implemented (docs/BUSINESS_RULES.md → "Status transitions"):
 *  - a normal transition needs the group permission for *both* the current and
 *    the target group, so a creator loses access the moment the order leaves
 *    their range and never regains it because it was once inside;
 *  - `order.status.override` allows any → any, but backward and cross-group
 *    moves require an explicit confirmation and a reason;
 *  - moving out of `CANCELLED` always needs the override (stock was released);
 *  - moving into `SHIPPED` is refused here: handing a parcel to a courier is the
 *    dispatch workflow, which consumes stock and creates the shipment;
 *  - post-courier outcomes on an order that is still in courier need the
 *    post-courier permission, and a partial delivery or return needs details.
 */
export function evaluateStatusTransition(input: {
  actor: StatusActor;
  subject: StatusSubject;
  target: InternalOrderStatus;
  confirmed?: boolean;
  reason?: string | null;
}): TransitionDecision {
  const { actor, subject, target } = input;
  const from = subject.status as InternalOrderStatus;
  const fromGroup = statusGroupOf(from);
  const toGroup = statusGroupOf(target);
  const backward = isBackwardTransition(from, target);
  const crossesGroup = fromGroup !== toGroup;
  const override = canOverrideStatuses(actor);
  const managesFrom = canManageStatusGroup(actor, fromGroup);
  const managesTo = canManageStatusGroup(actor, toGroup);

  const base: TransitionDecision = {
    allowed: false,
    target,
    fromGroup,
    toGroup,
    isBackward: backward,
    crossesGroup,
    isAdminOverride: false,
    requiresConfirmation: false,
    requiresReason: REASON_REQUIRED.includes(target),
    effect: effectFor(from, target),
  };

  if (from === target) {
    return { ...base, deniedReason: `This order is already ${statusLabel(target)}` };
  }

  if (target === "SHIPPED" && !override) {
    return {
      ...base,
      deniedReason:
        "Use “Send to courier” to move an order into courier: dispatching consumes the reserved stock and creates the shipment record.",
    };
  }

  if (target === "PARTIALLY_DELIVERED" && base.effect === "PARTIAL_DELIVERY" && !managesTo && !override) {
    return { ...base, deniedReason: `You are not allowed to record ${STATUS_GROUP_LABELS[toGroup].toLowerCase()} outcomes` };
  }

  // --- administrative override ------------------------------------------------
  if (override) {
    const requiresConfirmation = backward || crossesGroup || from === "CANCELLED";
    const decision: TransitionDecision = {
      ...base,
      allowed: true,
      isAdminOverride: true,
      requiresConfirmation,
      requiresReason: base.requiresReason || requiresConfirmation,
    };
    if (requiresConfirmation && !input.confirmed) {
      return {
        ...decision,
        allowed: false,
        deniedReason: "This change needs an explicit confirmation",
        warning: overrideWarning({ from, target, subject, backward, crossesGroup }),
      };
    }
    if (decision.requiresReason && !(input.reason ?? "").trim()) {
      return { ...decision, allowed: false, deniedReason: "A reason is required for this transition" };
    }
    if (from === "CANCELLED" && subject.hasSettledFinance) {
      return {
        ...decision,
        allowed: false,
        deniedReason:
          "This cancelled order has settled financial records. Reverse them through the settlement workflow before reopening the order.",
      };
    }
    return decision;
  }

  // --- normal, permission-scoped transitions ---------------------------------
  if (!managesFrom || !managesTo) {
    const missing = !managesFrom && !managesTo ? [fromGroup, toGroup] : !managesFrom ? [fromGroup] : [toGroup];
    return {
      ...base,
      deniedReason: `Your role cannot manage ${missing.map((group) => STATUS_GROUP_LABELS[group].toLowerCase()).join(" or ")} statuses`,
    };
  }

  if (from === "CANCELLED") {
    return {
      ...base,
      deniedReason:
        "A cancelled order can only be reopened by a user with the administrative status override, because its stock reservations were released.",
    };
  }

  if (backward && crossesGroup) {
    return { ...base, deniedReason: "Moving this order backward across status groups needs the administrative override" };
  }

  if (target === "CANCELLED" && !holdsPermission(actor, "order.cancel")) {
    return { ...base, deniedReason: "You are not allowed to cancel orders" };
  }

  if (target === "SHIPPED") {
    return { ...base, deniedReason: "Use “Send to courier” to hand this order to the courier" };
  }

  const decision: TransitionDecision = { ...base, allowed: true };
  if (decision.requiresReason && !(input.reason ?? "").trim()) {
    return { ...decision, allowed: false, deniedReason: "A reason is required for this transition" };
  }
  return decision;
}

function effectFor(from: InternalOrderStatus | string, target: InternalOrderStatus): InventoryEffect {
  if (target === "CANCELLED") return "RELEASE_RESERVATIONS";
  if (from === "CANCELLED") return "RESTORE_RESERVATIONS";
  if (target === "SHIPPED") return "REQUIRES_DISPATCH";
  if (target === "DELIVERED" || target === "COMPLETED") return "MARK_DELIVERED";
  if (target === "PARTIALLY_DELIVERED") return "PARTIAL_DELIVERY";
  if (target === "RETURNED") return "RETURN_TO_STOCK";
  return "NONE";
}

function overrideWarning(input: {
  from: InternalOrderStatus;
  target: InternalOrderStatus;
  subject: StatusSubject;
  backward: boolean;
  crossesGroup: boolean;
}): { title: string; points: string[] } {
  const { from, target, subject, backward, crossesGroup } = input;
  const points: string[] = [
    `This is an administrative override: ${statusLabel(from)} → ${statusLabel(target)}.`,
  ];
  if (backward) points.push("It moves the order backward in its lifecycle.");
  if (crossesGroup) {
    points.push(
      `It crosses status groups (${STATUS_GROUP_LABELS[statusGroupOf(from)]} → ${STATUS_GROUP_LABELS[statusGroupOf(target)]}).`,
    );
  }
  if (statusGroupOf(from) !== "PRE_COURIER" || subject.shipmentState === "CREATED" || subject.shipmentState === "IN_PROGRESS") {
    points.push("A courier shipment may already exist; the courier's own records are not rewritten by this change.");
  }
  if (from === "CANCELLED") {
    points.push("Stock reservations were released when the order was cancelled; reopening re-reserves what is available now.");
  }
  if (target === "CANCELLED") points.push("Cancelling releases the reserved stock and cancels open preorder commitments.");
  if (target === "RETURNED" || target === "PARTIALLY_DELIVERED") {
    points.push("Returned units go back into stock inspection and reseller earnings for them are voided.");
  }
  if (subject.hasSettledFinance) {
    points.push("This order has financial records; the change is written to the audit trail and must be reconciled manually.");
  }
  return { title: `Administrative override on this ${subject.orderType === "IN_STORE" ? "in-store order" : "order"}`, points };
}

/**
 * Every status the actor may move this order to, with the reason the others are
 * locked. The UI renders exactly this list, so what the operator sees matches
 * what the server will accept.
 */
export function availableTransitions(input: {
  actor: StatusActor;
  subject: StatusSubject;
  confirmed?: boolean;
}): Array<TransitionDecision & { label: string }> {
  const candidates = USER_FACING_STATUSES.filter((status) => status !== input.subject.status);
  return candidates.map((target) => {
    const decision = evaluateStatusTransition({ ...input, target });
    return { ...decision, label: STATUS_LABELS[target] };
  });
}

/**
 * Data-editing permission for an order (customer, address, notes, items,
 * adjustments). Pre-courier edits need `order.update`; anything later needs the
 * explicit post-courier permission plus a confirmation.
 */
export function evaluateOrderEditPermission(input: {
  actor: StatusActor;
  subject: StatusSubject;
  confirmed?: boolean;
}): { allowed: boolean; requiresConfirmation: boolean; isPostCourier: boolean; deniedReason?: string; warning?: { title: string; points: string[] } } {
  const { actor, subject } = input;
  const postCourier = statusGroupOf(subject.status) !== "PRE_COURIER";
  if (!postCourier) {
    if (!holdsPermission(actor, "order.update")) {
      return { allowed: false, requiresConfirmation: false, isPostCourier: false, deniedReason: "You are not allowed to edit orders" };
    }
    return { allowed: true, requiresConfirmation: false, isPostCourier: false };
  }

  if (!holdsPermission(actor, "order.edit_post_courier") && !canOverrideStatuses(actor)) {
    return {
      allowed: false,
      requiresConfirmation: false,
      isPostCourier: true,
      deniedReason: `This order is ${statusLabel(subject.status)}; editing it needs the “Edit orders after courier handover” permission`,
    };
  }
  if (!input.confirmed) {
    return {
      allowed: false,
      requiresConfirmation: true,
      isPostCourier: true,
      deniedReason: "Confirm the post-courier edit warning before saving",
      warning: {
        title: `This order is ${statusLabel(subject.status)}`,
        points: [
          "The order already left the pre-courier stage, so the courier shipment, the COD amount and the stock movements were created from the current data.",
          "Changing customer, address, items or charges here can make the shipment and the financial records inconsistent.",
          "The courier's own shipment is not rewritten. If the parcel must change, cancel the shipment with the courier first.",
          "The before/after values, your identity and this confirmation are written to the audit trail.",
        ],
      },
    };
  }
  return { allowed: true, requiresConfirmation: true, isPostCourier: true };
}

/** Statuses that may be handed to a courier: confirmed, online-delivery orders. */
export function isDispatchEligible(subject: {
  status: InternalOrderStatus | string;
  orderType?: OrderTypeValue | string;
  channel?: string;
  shipmentState?: "NONE" | "REQUESTED" | "CREATED" | "IN_PROGRESS" | "FINAL";
  hasShippingAddress?: boolean;
}): { eligible: boolean; reason?: string } {
  if (subject.orderType === "IN_STORE" || subject.channel === "IN_STORE") {
    return { eligible: false, reason: "In-store orders are handed over at the counter and are never sent to a courier" };
  }
  if (subject.status !== "CONFIRMED") {
    return { eligible: false, reason: `Only confirmed orders can be sent to the courier (this one is ${statusLabel(subject.status)})` };
  }
  if (subject.shipmentState && subject.shipmentState !== "NONE") {
    return { eligible: false, reason: "This order was already sent to the courier" };
  }
  if (!subject.hasShippingAddress) {
    return { eligible: false, reason: "Add the customer's district and full address before sending it to the courier" };
  }
  return { eligible: true };
}

/** Only cancelled orders may be deleted. */
export function isDeletable(subject: { status: InternalOrderStatus | string }): boolean {
  return subject.status === "CANCELLED";
}

/** Filter options for the order list, grouped the same way as the model. */
export function statusFilterOptions(): Array<{ value: string; label: string; group: StatusGroup }> {
  return (Object.keys(STATUS_GROUPS) as StatusGroup[]).flatMap((group) =>
    STATUS_GROUPS[group].map((status) => ({ value: status, label: STATUS_LABELS[status], group })),
  );
}
