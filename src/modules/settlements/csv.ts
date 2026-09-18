import "server-only";
import { AppError } from "@/lib/errors";

/**
 * Courier statement CSV parsing.
 *
 * Kept out of the action module (which may only export async server actions) and
 * deliberately strict: the header is required so a reordered export can never
 * silently turn fees into collections.
 */

export interface ParsedStatementRow {
  trackingCode?: string;
  orderNumber?: string;
  grossPaisa: number;
  courierFeePaisa: number;
  codChargePaisa: number;
  otherDeductionPaisa: number;
  note?: string;
}

function toPaisa(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export function parseStatementCsv(csv: string): ParsedStatementRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw AppError.validation("Paste the statement including its header row");

  const header = lines[0]!.split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (...names: string[]) => header.findIndex((cell) => names.includes(cell));

  const trackingIndex = indexOf("tracking_code", "tracking", "consignment_id");
  const orderIndex = indexOf("merchant_order_id", "order_number", "invoice", "reference");
  const grossIndex = indexOf("collected", "gross", "amount", "cod_amount", "collected_amount");
  const feeIndex = indexOf("delivery_charge", "courier_fee", "fee", "delivery_fee");
  const codChargeIndex = indexOf("cod_charge", "cod_fee");
  const otherIndex = indexOf("other_deduction", "deduction", "adjustment");
  const noteIndex = indexOf("note", "remarks");

  if (grossIndex === -1) throw AppError.validation('The statement needs a "collected" (or "gross") column');
  if (trackingIndex === -1 && orderIndex === -1) {
    throw AppError.validation('The statement needs a "tracking_code" or an "order_number" column so rows can be matched');
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return {
      trackingCode: trackingIndex >= 0 ? cells[trackingIndex] || undefined : undefined,
      orderNumber: orderIndex >= 0 ? cells[orderIndex] || undefined : undefined,
      grossPaisa: toPaisa(cells[grossIndex]),
      courierFeePaisa: feeIndex >= 0 ? toPaisa(cells[feeIndex]) : 0,
      codChargePaisa: codChargeIndex >= 0 ? toPaisa(cells[codChargeIndex]) : 0,
      otherDeductionPaisa: otherIndex >= 0 ? toPaisa(cells[otherIndex]) : 0,
      note: noteIndex >= 0 ? cells[noteIndex] || undefined : undefined,
    };
  });
}
