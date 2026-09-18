import "server-only";
import type { OutgoingShipmentData } from "@/modules/couriers/providers/types";
import { asNumber, asRecord, asString, paisasToTaka } from "@/modules/couriers/providers/types";

/**
 * Steadfast payload mapping.
 *
 * Steadfast's create-order API is form based and addresses are free text, so the
 * mapping is mostly normalisation: one row per parcel, COD as taka, the invoice
 * reusing our order number so the courier's own reconciliation stays traceable.
 */

export const STEADFAST_BASE_URL = "https://portal.packzy.com/api/v1";

export interface SteadfastOrderBody {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  note?: string;
  item_description?: string;
  total_lot?: number;
  delivery_type?: number;
}

export function buildSteadfastOrderBody(shipment: OutgoingShipmentData): SteadfastOrderBody {
  const config = asRecord(shipment.providerConfig);
  const addressParts = [shipment.recipientAddress, shipment.recipientArea]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);

  const body: SteadfastOrderBody = {
    invoice: shipment.merchantOrderId ?? shipment.internalCode,
    recipient_name: shipment.recipientName,
    recipient_phone: shipment.recipientPhoneNormalized ?? shipment.recipientPhone,
    recipient_address: addressParts.join(", ").slice(0, 250),
    cod_amount: paisasToTaka(shipment.codAmountPaisa),
  };

  const note = asString(shipment.recipientNote);
  if (note) body.note = note.slice(0, 250);

  const description = asString(shipment.itemDescription);
  if (description) body.item_description = description.slice(0, 250);

  if (shipment.itemQuantity > 0) body.total_lot = shipment.itemQuantity;

  const deliveryType = asNumber(config.deliveryType);
  if (deliveryType) body.delivery_type = deliveryType;

  return body;
}

export function mapSteadfastStatus(rawStatus: string | null): {
  status: "PENDING" | "CREATED" | "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED" | "CANCELLED" | "EXCEPTION";
} {
  const value = (rawStatus ?? "").toLowerCase().replace(/\s+/g, "_");
  switch (value) {
    case "in_review":
    case "pending":
      return { status: "PENDING" };
    case "approved":
      return { status: "CREATED" };
    case "picked":
    case "pickup":
      return { status: "PICKED_UP" };
    case "in_transit":
    case "in-transit":
      return { status: "IN_TRANSIT" };
    case "out_for_delivery":
      return { status: "OUT_FOR_DELIVERY" };
    case "delivered":
    case "delivered_approval_pending":
      return { status: "DELIVERED" };
    case "partial_delivered":
      return { status: "PARTIALLY_DELIVERED" };
    case "returned":
    case "return":
    case "returned_approval_pending":
      return { status: "RETURNED" };
    case "cancelled":
    case "cancel":
      return { status: "CANCELLED" };
    case "hold":
    case "unknown":
      return { status: "EXCEPTION" };
    default:
      return { status: "IN_TRANSIT" };
  }
}
