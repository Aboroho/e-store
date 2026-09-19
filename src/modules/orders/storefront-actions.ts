"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { enforceRateLimit } from "@/lib/rate-limit";
import { placeStorefrontOrder } from "@/modules/orders/checkout";
import type { ActionState } from "@/modules/auth/actions";

/**
 * Public storefront checkout action.
 *
 * There is no session here: the inputs are validated by hand, quantities are
 * bounded, prices are never accepted from the browser and the whole thing is
 * rate limited per IP so a script cannot fill the reservation table.
 */

async function clientIp(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headerList.get("x-real-ip") ?? "unknown";
}

export async function placeStorefrontOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let orderNumber: string;

  try {
    const ip = await clientIp();
    await enforceRateLimit({ scope: "storefront-checkout", key: ip, limit: 10, windowSeconds: 600 }, "Too many checkout attempts from this connection");

    const variantIds = formData.getAll("itemVariantId").map(String).filter(Boolean);
    const quantities = formData.getAll("itemQuantity").map((value) => Number(value ?? 0));
    const items = variantIds
      .map((variantId, index) => ({ variantId, quantity: Math.trunc(quantities[index] ?? 0) }))
      .filter((item) => item.quantity > 0 && item.quantity <= 20);

    if (items.length === 0) return { status: "error", message: "Add at least one item to your cart" };
    if (items.length > 30) return { status: "error", message: "Too many different items in one order" };

    const text = (key: string) => String(formData.get(key) ?? "").trim();

    const name = text("customerName");
    const phone = text("customerPhone");
    const districtCode = text("shippingDistrictCode");
    const addressLine = text("shippingAddressLine");
    const area = text("shippingArea");
    const email = text("customerEmail");
    const note = text("customerNote");

    if (name.length < 2) return { status: "error", message: "Enter your name" };
    if (phone.length < 6) return { status: "error", message: "Enter a valid phone number" };
    if (districtCode.length !== 2) return { status: "error", message: "Choose your district" };
    if (addressLine.length < 8) return { status: "error", message: "Enter your full delivery address" };

    const idempotencyKey = text("idempotencyKey") || `storefront-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

    const result = await placeStorefrontOrder(
      {
        storefrontSlug: text("storefrontSlug") || undefined,
        storefrontId: text("storefrontId") || undefined,
        customerName: name,
        customerPhone: phone,
        customerEmail: email || undefined,
        districtCode,
        addressLine,
        area: area || undefined,
        note: note || undefined,
        items,
        idempotencyKey,
        marketingConsent: formData.get("marketingConsent") === "on",
      },
      { actorLabel: `storefront:${ip}`, ipAddress: ip },
    );

    orderNumber = result.order.orderNumber;
    logger.info("checkout.order_placed", { orderNumber, items: items.length, ip });
  } catch (error) {
    if (error instanceof AppError) return { status: "error", message: error.message };
    logger.error("Storefront checkout failed", error);
    return { status: "error", message: "We could not place your order. Please try again." };
  }

  redirect(`/checkout/success?order=${encodeURIComponent(orderNumber)}`);
}
