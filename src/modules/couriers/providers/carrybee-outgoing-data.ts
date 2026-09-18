import "server-only";
import type { OutgoingShipmentData } from "@/modules/couriers/providers/types";
import { CourierRequestError, asRecord, asString, paisasToTaka } from "@/modules/couriers/providers/types";

/**
 * CarryBee payload mapping.
 *
 * CarryBee addresses are id based like Pathao's, so the business stores its
 * city/zone/area ids in the provider `config` JSON. The create-order endpoint
 * wants taka amounts and an explicit parcel weight in kilograms.
 */

export const CARRYBEE_BASE_URL = "https://api.carrybee.com";
export const CARRYBEE_SANDBOX_BASE_URL = "https://sandbox.carrybee.com";

export interface CarryBeeOrderBody {
  store_id: string;
  merchant_order_id: string;
  receiver_name: string;
  receiver_phone: string;
  city_id: string;
  zone_id: string;
  area_id?: string;
  address: string;
  product_description?: string;
  quantity: number;
  weight: number;
  collectable_amount: number;
  delivery_type: string;
}

function resolveIds(shipment: OutgoingShipmentData): { cityId: string; zoneId: string; areaId: string | null } {
  const config = asRecord(shipment.providerConfig);
  const district = shipment.recipientDistrictCode ?? "";
  const cityIds = asRecord(config.cityIds);
  const zoneIds = asRecord(config.zoneIds);

  const cityId = asString(cityIds[district]) ?? asString(config.cityId);
  if (!cityId) {
    throw new CourierRequestError("CARRYBEE", 0, `No CarryBee city id is mapped for district ${district || "(missing)"}`);
  }

  const areaZone = shipment.recipientArea ? asString(asRecord(config.zoneIdsByArea)[shipment.recipientArea]) : null;
  const zoneId = areaZone ?? asString(zoneIds[district]) ?? asString(config.zoneId);
  if (!zoneId) {
    throw new CourierRequestError("CARRYBEE", 0, `No CarryBee zone id is mapped for district ${district || "(missing)"}`);
  }

  const areaId = shipment.recipientArea ? asString(asRecord(config.areaIdsByArea)[shipment.recipientArea]) : null;
  return { cityId, zoneId, areaId };
}

export function buildCarryBeeOrderBody(shipment: OutgoingShipmentData): CarryBeeOrderBody {
  const config = asRecord(shipment.providerConfig);
  const storeId = asString(config.storeId);
  if (!storeId) throw new CourierRequestError("CARRYBEE", 0, "Set the CarryBee store id on the courier provider screen before dispatching.");

  const { cityId, zoneId, areaId } = resolveIds(shipment);
  const body: CarryBeeOrderBody = {
    store_id: storeId,
    merchant_order_id: shipment.merchantOrderId ?? shipment.internalCode,
    receiver_name: shipment.recipientName,
    receiver_phone: shipment.recipientPhoneNormalized ?? shipment.recipientPhone,
    city_id: cityId,
    zone_id: zoneId,
    address: [shipment.recipientAddress, shipment.recipientArea].filter(Boolean).join(", ").slice(0, 250),
    quantity: Math.max(1, shipment.itemQuantity),
    weight: Math.max(0.1, shipment.declaredWeightGrams / 1000),
    collectable_amount: paisasToTaka(shipment.codAmountPaisa),
    delivery_type: shipment.deliveryType ?? "regular",
  };

  if (areaId) body.area_id = areaId;
  const description = asString(shipment.itemDescription);
  if (description) body.product_description = description.slice(0, 250);

  return body;
}

export function mapCarryBeeStatus(rawStatus: string | null): {
  status: "PENDING" | "CREATED" | "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED" | "CANCELLED" | "EXCEPTION";
} {
  const value = (rawStatus ?? "").toLowerCase().replace(/\s+/g, "_");
  switch (value) {
    case "pending":
    case "requested":
    case "new":
      return { status: "PENDING" };
    case "accepted":
    case "approved":
    case "assigned":
      return { status: "CREATED" };
    case "picked":
    case "picked_up":
      return { status: "PICKED_UP" };
    case "in_transit":
    case "in_transit_to_hub":
      return { status: "IN_TRANSIT" };
    case "out_for_delivery":
    case "on_the_way":
      return { status: "OUT_FOR_DELIVERY" };
    case "delivered":
      return { status: "DELIVERED" };
    case "partially_delivered":
    case "partial_delivered":
      return { status: "PARTIALLY_DELIVERED" };
    case "returned":
    case "return":
    case "returned_to_store":
      return { status: "RETURNED" };
    case "cancelled":
    case "declined":
      return { status: "CANCELLED" };
    case "hold":
    case "failed":
      return { status: "EXCEPTION" };
    default:
      return { status: "IN_TRANSIT" };
  }
}
