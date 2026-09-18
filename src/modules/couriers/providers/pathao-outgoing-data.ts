import "server-only";
import type { OutgoingShipmentData } from "@/modules/couriers/providers/types";
import { asNumber, asRecord, asString, paisasToTaka } from "@/modules/couriers/providers/types";
import { CourierRequestError } from "@/modules/couriers/providers/types";

/**
 * Pathao payload mapping.
 *
 * Pathao addresses are id based: the business keeps the city/zone/area ids in the
 * provider `config` JSON (keyed by Bangladesh district code, and optionally by
 * area name) and this module turns an order into the exact body the Aladdin API
 * expects. Keeping the mapping in its own file means the adapter itself stays a
 * thin transport wrapper.
 */

export const PATHAO_BASE_URL = "https://api-hermes.pathao.com";
export const PATHAO_SANDBOX_BASE_URL = "https://courier-api-sandbox.pathao.com";

export interface PathaoOrderBody {
  store_id: number;
  merchant_order_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_city: number;
  recipient_zone: number;
  recipient_area?: number;
  recipient_address: string;
  delivery_type: number;
  item_type: number;
  item_quantity: number;
  item_weight: number;
  amount_to_collect: number;
  item_description?: string;
  special_instruction?: string;
}

/** District code → Pathao city id, taken from `config.cityIds`. */
function resolveCityId(shipment: OutgoingShipmentData): number {
  const config = asRecord(shipment.providerConfig);
  const cityIds = asRecord(config.cityIds);
  const district = shipment.recipientDistrictCode ?? "";
  const cityId = asNumber(cityIds[district]);
  if (!cityId) {
    throw new CourierRequestError(
      "PATHAO",
      0,
      `No Pathao city id is mapped for district ${district || "(missing)"}. Add it on the courier provider screen.`,
    );
  }
  return cityId;
}

function resolveZoneId(shipment: OutgoingShipmentData): number {
  const config = asRecord(shipment.providerConfig);
  const zoneIds = asRecord(config.zoneIds);
  if (shipment.recipientArea) {
    const byArea = asRecord(config.zoneIdsByArea);
    const areaZone = asNumber(byArea[shipment.recipientArea]);
    if (areaZone) return areaZone;
  }
  const district = shipment.recipientDistrictCode ?? "";
  const zoneId = asNumber(zoneIds[district]);
  if (!zoneId) {
    throw new CourierRequestError(
      "PATHAO",
      0,
      `No Pathao zone id is mapped for district ${district || "(missing)"}. Add it on the courier provider screen.`,
    );
  }
  return zoneId;
}

function resolveAreaId(shipment: OutgoingShipmentData): number | null {
  const config = asRecord(shipment.providerConfig);
  if (!shipment.recipientArea) return null;
  const byArea = asRecord(config.areaIdsByArea);
  return asNumber(byArea[shipment.recipientArea]) ?? null;
}

/** Pathao `delivery_type`: 48 = normal, 12 = on-demand (within city). */
export function resolvePathaoDeliveryType(shipment: OutgoingShipmentData): number {
  if (shipment.deliveryType === "ON_DEMAND" || shipment.deliveryType === "12") return 12;
  const config = asRecord(shipment.providerConfig);
  const configured = asNumber(config.deliveryType);
  return configured ?? 48;
}

export function buildPathaoOrderBody(shipment: OutgoingShipmentData): PathaoOrderBody {
  const config = asRecord(shipment.providerConfig);
  const storeId = asNumber(config.storeId);
  if (!storeId) {
    throw new CourierRequestError("PATHAO", 0, "Set the Pathao store id on the courier provider screen before dispatching.");
  }

  const body: PathaoOrderBody = {
    store_id: storeId,
    merchant_order_id: shipment.merchantOrderId ?? shipment.internalCode,
    recipient_name: shipment.recipientName,
    recipient_phone: shipment.recipientPhoneNormalized ?? shipment.recipientPhone,
    recipient_city: resolveCityId(shipment),
    recipient_zone: resolveZoneId(shipment),
    recipient_address: [shipment.recipientAddress, shipment.recipientArea].filter(Boolean).join(", "),
    delivery_type: resolvePathaoDeliveryType(shipment),
    item_type: asNumber(config.itemType) ?? 2,
    item_quantity: Math.max(1, shipment.itemQuantity),
    item_weight: Math.max(0.1, shipment.declaredWeightGrams / 1000),
    amount_to_collect: paisasToTaka(shipment.codAmountPaisa),
  };

  const areaId = resolveAreaId(shipment);
  if (areaId) body.recipient_area = areaId;

  const description = asString(shipment.itemDescription);
  if (description) body.item_description = description.slice(0, 250);

  const instruction = asString(shipment.recipientNote);
  if (instruction) body.special_instruction = instruction.slice(0, 250);

  return body;
}

/** Pathao statuses mapped onto our shipment lifecycle. */
export function mapPathaoStatus(rawStatus: string | null): {
  status: "PENDING" | "CREATED" | "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED" | "CANCELLED" | "EXCEPTION";
} {
  const value = (rawStatus ?? "").toLowerCase().replace(/\s+/g, "_");
  switch (value) {
    case "pending":
    case "requested":
      return { status: "PENDING" };
    case "assigned":
    case "picked":
    case "pickup":
      return { status: "CREATED" };
    case "picked_up":
    case "picked-up":
      return { status: "PICKED_UP" };
    case "in_transit":
    case "at_sorting_hub":
    case "in-transit":
      return { status: "IN_TRANSIT" };
    case "out_for_delivery":
      return { status: "OUT_FOR_DELIVERY" };
    case "delivered":
    case "delivered_approval_pending":
      return { status: "DELIVERED" };
    case "partial_delivered":
    case "partial_delivered_approval_pending":
      return { status: "PARTIALLY_DELIVERED" };
    case "return":
    case "returned":
    case "return_approval_pending":
    case "return_in_transit":
      return { status: "RETURNED" };
    case "cancelled":
    case "cancel":
      return { status: "CANCELLED" };
    case "hold":
    case "on_hold":
    case "pickup_failed":
    case "delivery_failed":
      return { status: "EXCEPTION" };
    default:
      return { status: "IN_TRANSIT" };
  }
}
