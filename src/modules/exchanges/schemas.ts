import { z } from "zod";

/**
 * Exchange schemas.
 *
 * Amounts arrive in integer paisa; staff screens convert from BDT before
 * validation. Quantities are validated against the purchased quantity in the
 * service, which is the only place that knows the order contents.
 */

export const exchangeItemInputSchema = z.object({
  orderItemId: z.string().uuid().optional(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10_000),
  note: z.string().trim().max(300).optional(),
});
export type ExchangeItemInput = z.infer<typeof exchangeItemInputSchema>;

export const createExchangeInputSchema = z
  .object({
    orderId: z.string().uuid(),
    reasonCode: z.string().trim().min(2).max(60),
    reasonNote: z.string().trim().max(500).optional(),
    channel: z.enum(["CUSTOMER", "STAFF"]).default("STAFF"),
    returnItems: z.array(exchangeItemInputSchema).min(1, "Select at least one item to exchange"),
    replacementItems: z.array(exchangeItemInputSchema).default([]),
    deliveryChargePaisa: z.number().int().min(0).optional(),
    additionalChargePaisa: z.number().int().min(0).optional(),
    discountPaisa: z.number().int().min(0).optional(),
    internalNote: z.string().trim().max(500).optional(),
    expectedDeliveryAt: z.coerce.date().optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .refine((value) => value.replacementItems.length === 0 || value.returnItems.length > 0, {
    message: "An exchange needs at least one returned item",
    path: ["returnItems"],
  });
export type CreateExchangeInput = z.infer<typeof createExchangeInputSchema>;

export const inspectExchangeInputSchema = z.object({
  exchangeId: z.string().uuid(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        outcome: z.enum(["SELLABLE", "DAMAGED", "DISCARDED"]),
        quantity: z.number().int().min(0).max(10_000).optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1),
});
export type InspectExchangeInput = z.infer<typeof inspectExchangeInputSchema>;

export const exchangeDecisionInputSchema = z.object({
  exchangeId: z.string().uuid(),
  reason: z.string().trim().max(400).optional(),
});
export type ExchangeDecisionInput = z.infer<typeof exchangeDecisionInputSchema>;
