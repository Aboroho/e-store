import "server-only";
import type { OutgoingShipmentData } from "@/modules/couriers/providers/types";
import { CourierRequestError, asNumber, asRecord, asString, paisasToTaka } from "@/modules/couriers/providers/types";
import { env } from "@/lib/env";

/**
 * Steadfast payload mapping.
 *
 * Steadfast's create-order API accepts JSON and addresses are free text, so the
 * mapping is mostly normalisation: one row per parcel, COD in taka, the invoice
 * reusing our order number so the courier's own reconciliation stays traceable.
 *
 * Field limits follow the published API contract: `invoice` is alphanumeric plus
 * `-`/`_`, `recipient_name` ≤ 100 characters, `recipient_phone` exactly 11 digits
 * (`01XXXXXXXXX`), `recipient_address` ≤ 250 characters and `cod_amount` a
 * non-negative taka number. Violating them is a hard error *before* the call, so
 * the shipment is never marked as requested on a payload Steadfast would reject.
 */

/** Default endpoint; `STEADFAST_BASE_URL` overrides it per deployment. */
export const STEADFAST_BASE_URL = "https://portal.packzy.com/api/v1";

/** Configured Steadfast API base URL (env wins over the compiled default). */
export function steadfastBaseUrl(): string {
  const configured = env().STEADFAST_BASE_URL?.trim();
  return (configured || STEADFAST_BASE_URL).replace(/\/+$/, "");
}

export interface SteadfastOrderBody {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  alternative_phone?: string;
  recipient_email?: string;
  note?: string;
  item_description?: string;
  deliver_within?: string;
  total_lot?: number;
  /** 0 = home delivery, 1 = point/hub delivery. */
  delivery_type?: number;
}

/** Steadfast accepts letters, digits, hyphens and underscores in the invoice. */
export function steadfastInvoice(shipment: OutgoingShipmentData): string {
  const raw = (shipment.merchantOrderId ?? shipment.internalCode).trim();
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-{2,}/g, "-").slice(0, 60);
  return cleaned || shipment.internalCode.slice(0, 60);
}

/** Local Bangladeshi mobile form Steadfast requires: `01XXXXXXXXX`. */
export function steadfastPhone(shipment: OutgoingShipmentData): string {
  const digits = (shipment.recipientPhoneNormalized ?? shipment.recipientPhone).replace(/\D/g, "");
  if (digits.startsWith("880")) return `0${digits.slice(3)}`;
  return digits;
}

export function buildSteadfastOrderBody(shipment: OutgoingShipmentData): SteadfastOrderBody {
  const config = asRecord(shipment.providerConfig);
  const addressParts = [shipment.recipientAddress, shipment.recipientArea]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);

  const body: SteadfastOrderBody = {
    invoice: steadfastInvoice(shipment),
    recipient_name: shipment.recipientName.trim().slice(0, 100),
    recipient_phone: steadfastPhone(shipment),
    recipient_address: addressParts.join(", ").slice(0, 250),
    cod_amount: paisasToTaka(shipment.codAmountPaisa),
  };

  const note = asString(shipment.recipientNote);
  if (note) body.note = note.slice(0, 250);

  const description = asString(shipment.itemDescription);
  if (description) body.item_description = description.slice(0, 250);

  if (shipment.itemQuantity > 0) body.total_lot = shipment.itemQuantity;

  const deliveryType = asNumber(config.deliveryType) ?? asNumber(shipment.deliveryType);
  if (deliveryType != null) body.delivery_type = deliveryType;

  const deliverWithin = asString(config.deliverWithin);
  if (deliverWithin) body.deliver_within = deliverWithin;

  const alternativePhone = asString(config.alternativePhone);
  if (alternativePhone) body.alternative_phone = alternativePhone.replace(/\D/g, "").slice(0, 14);

  const email = asString(config.recipientEmail);
  if (email) body.recipient_email = email.slice(0, 100);

  return body;
}

/**
 * Refuse to call Steadfast with a payload it would reject.
 *
 * The errors are written for the operator: they say which field to fix on the
 * order, not which provider rule was hit.
 */
export function validateSteadfastOrderBody(body: SteadfastOrderBody): void {
  if (!body.invoice || !/^[A-Za-z0-9_-]+$/.test(body.invoice)) {
    throw new CourierRequestError("STEADFAST", 0, "The order number cannot be used as a Steadfast invoice");
  }
  if (!body.recipient_name) {
    throw new CourierRequestError("STEADFAST", 0, "Add the customer's name before sending this parcel to Steadfast");
  }
  if (!/^01[3-9]\d{8}$/.test(body.recipient_phone)) {
    throw new CourierRequestError(
      "STEADFAST",
      0,
      `Steadfast needs an 11-digit Bangladeshi mobile number, got "${body.recipient_phone}"`,
    );
  }
  if (!body.recipient_address || body.recipient_address.length < 5) {
    throw new CourierRequestError("STEADFAST", 0, "Add the customer's full address before sending this parcel to Steadfast");
  }
  if (body.recipient_address.length > 250) {
    throw new CourierRequestError("STEADFAST", 0, "The delivery address is longer than Steadfast's 250 character limit");
  }
  if (!Number.isFinite(body.cod_amount) || body.cod_amount < 0) {
    throw new CourierRequestError("STEADFAST", 0, "The cash-on-delivery amount cannot be negative");
  }
}

export interface SteadfastStatusMapping {
  status:
    | "PENDING"
    | "CREATED"
    | "PICKED_UP"
    | "IN_TRANSIT"
    | "OUT_FOR_DELIVERY"
    | "DELIVERED"
    | "PARTIALLY_DELIVERED"
    | "RETURNED"
    | "CANCELLED"
    | "EXCEPTION";
  /**
   * True when Steadfast is waiting for the merchant to approve the outcome
   * (`*_approval_pending`). Delivered parcels are treated as delivered — the COD
   * approval is a money step handled by settlement — but a *return* or a
   * *cancellation* that is still pending approval is not applied automatically:
   * it would restock or release stock the courier may still bring back. Those
   * land on EXCEPTION and the raw text stays visible for an operator to confirm.
   */
  needsReview: boolean;
}

export function mapSteadfastStatus(rawStatus: string | null): SteadfastStatusMapping {
  const value = (rawStatus ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  switch (value) {
    case "in_review":
    case "pending":
      return { status: "PENDING", needsReview: false };
    case "approved":
      return { status: "CREATED", needsReview: false };
    case "picked":
    case "pickup":
    case "picked_up":
      return { status: "PICKED_UP", needsReview: false };
    case "in_transit":
    case "received_at_warehouse":
    case "dispatched_from_warehouse":
      return { status: "IN_TRANSIT", needsReview: false };
    case "out_for_delivery":
    case "delivery_attempted":
      return { status: "OUT_FOR_DELIVERY", needsReview: false };
    case "delivered":
      return { status: "DELIVERED", needsReview: false };
    case "delivered_approval_pending":
    case "delivered_partial_approval_pending":
      return { status: "DELIVERED", needsReview: true };
    case "partial_delivered":
      return { status: "PARTIALLY_DELIVERED", needsReview: false };
    case "partial_delivered_approval_pending":
      return { status: "PARTIALLY_DELIVERED", needsReview: true };
    case "returned":
    case "return":
    case "returned_to_warehouse":
      return { status: "RETURNED", needsReview: false };
    case "returned_approval_pending":
    case "return_approval_pending":
      return { status: "EXCEPTION", needsReview: true };
    case "cancelled":
    case "cancel":
      return { status: "CANCELLED", needsReview: false };
    case "cancelled_approval_pending":
    case "cancel_approval_pending":
      return { status: "EXCEPTION", needsReview: true };
    case "hold":
    case "on_hold":
    case "unknown":
      return { status: "EXCEPTION", needsReview: true };
    default:
      return { status: "IN_TRANSIT", needsReview: false };
  }
}

/**
 * Notification types Steadfast sends. Only delivery-status notifications change a
 * shipment; anything else is stored and ignored so an unrelated message can never
 * move an order.
 */
export function steadfastNotificationKind(payload: Record<string, unknown>): "delivery_status" | "other" | "unknown" {
  const type = asString(payload.notification_type) ?? asString(payload.type) ?? asString(payload.event);
  if (!type) return "unknown";
  const value = type.toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "delivery_status" || value === "shipment_status" || value === "order_status") return "delivery_status";
  return "other";
}
