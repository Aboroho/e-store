import "server-only";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db/client";

/**
 * Atomic document numbering (orders, purchase orders, receipts, shipments,
 * exchanges, payouts).
 *
 * Numbers are allocated inside the caller's transaction using an atomic
 * increment so concurrent requests can never produce duplicates. A unique
 * database constraint on the document columns provides the second line of
 * defence.
 */

export type SequenceKey =
  | "order"
  | "purchase_order"
  | "goods_receipt"
  | "shipment"
  | "exchange"
  | "reseller_payout"
  | "invoice";

const SEQUENCE_DEFAULTS: Record<SequenceKey, { prefix: string; padding: number }> = {
  order: { prefix: "ORD", padding: 5 },
  purchase_order: { prefix: "PO", padding: 5 },
  goods_receipt: { prefix: "GRN", padding: 5 },
  shipment: { prefix: "SHP", padding: 5 },
  exchange: { prefix: "EX", padding: 5 },
  reseller_payout: { prefix: "PAY", padding: 5 },
  invoice: { prefix: "INV", padding: 5 },
};

export interface NextNumberOptions {
  businessId: string;
  key: SequenceKey;
  /** Extra scope, e.g. the year for yearly sequences. Defaults to ''. */
  scope?: string;
  prefix?: string;
  padding?: number;
}

/**
 * Allocate the next document number. Must be called inside a transaction that
 * also writes the document, so that a rollback also rolls the counter back.
 */
export async function nextDocumentNumber(
  client: Prisma.TransactionClient | typeof prisma,
  options: NextNumberOptions,
): Promise<string> {
  const defaults = SEQUENCE_DEFAULTS[options.key];
  const scope = options.scope ?? "";
  const prefix = options.prefix ?? defaults.prefix;
  const padding = options.padding ?? defaults.padding;

  const sequence = await client.numberSequence.upsert({
    where: { businessId_key_scope: { businessId: options.businessId, key: options.key, scope } },
    create: {
      businessId: options.businessId,
      key: options.key,
      scope,
      prefix,
      padding,
      nextValue: 1,
    },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true, prefix: true, padding: true },
  });

  // upsert returns the value after increment for an existing row, but the
  // freshly created row starts at 1 - normalise both cases.
  const value = sequence.nextValue;
  const padded = String(value).padStart(sequence.padding ?? padding, "0");
  return `${sequence.prefix ?? prefix}-${padded}`;
}

/** Peek at the next number without consuming it (for UI previews). */
export async function peekDocumentNumber(businessId: string, key: SequenceKey, scope = ""): Promise<string> {
  const defaults = SEQUENCE_DEFAULTS[key];
  const sequence = await prisma.numberSequence.findUnique({
    where: { businessId_key_scope: { businessId, key, scope } },
  });
  const value = sequence?.nextValue ?? 1;
  const prefix = sequence?.prefix ?? defaults.prefix;
  const padding = sequence?.padding ?? defaults.padding;
  return `${prefix}-${String(value).padStart(padding, "0")}`;
}
