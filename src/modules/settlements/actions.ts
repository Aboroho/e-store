"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject } from "@/lib/validation";
import { formatPaisa } from "@/lib/money";
import type { ActionState } from "@/modules/auth/action-state";
import { importCourierSettlement, promoteResellerEarnings, reconcileSettlement, resolveSettlementEntry } from "@/modules/settlements/service";
import { parseStatementCsv } from "@/modules/settlements/csv";

/**
 * Settlement actions.
 *
 * Statements arrive as CSV pasted by staff (the couriers' portals export CSV),
 * which keeps the import path free of external API calls and lets finance keep
 * the original file as evidence.
 */

async function actor(permission: string) {
  const session = await requireSession();
  assertPermission(session, permission);
  return { businessId: session.businessId, userId: session.id, actorLabel: session.email, actorType: "USER" as const };
}

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Settlement action failed", error);
  return { status: "error", message: fallback };
}

export async function importSettlementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.reconcile");
  } catch (error) {
    return toState(error, "You are not allowed to import settlements");
  }

  const raw = formDataToObject(formData);
  const providerCode = String(raw.providerCode ?? "") as "PATHAO" | "STEADFAST" | "CARRYBEE" | "MANUAL";
  const reference = String(raw.reference ?? "").trim();
  const csv = String(raw.csv ?? "");

  if (!reference) return { status: "error", message: "Enter the courier's statement reference" };

  try {
    const rows = parseStatementCsv(csv);
    const result = await importCourierSettlement(context, {
      providerCode,
      reference,
      periodStart: raw.periodStart ? new Date(String(raw.periodStart)) : null,
      periodEnd: raw.periodEnd ? new Date(String(raw.periodEnd)) : null,
      settlementDate: raw.settlementDate ? new Date(String(raw.settlementDate)) : null,
      bankReference: String(raw.bankReference ?? "").trim() || null,
      sourceFileName: String(raw.sourceFileName ?? "").trim() || null,
      idempotencyKey: String(raw.idempotencyKey ?? "").trim() || null,
      rows,
    });

    revalidatePath("/admin/settlements");
    if (result.reused) return { status: "success", message: "That statement was already imported" };
    return {
      status: "success",
      message: `Imported ${rows.length} row(s): ${result.matched} matched, ${result.unmatched} need a decision. Net ${formatPaisa(result.settlement.netReceivedPaisa)}.`,
    };
  } catch (error) {
    return toState(error, "Unable to import the statement");
  }
}

export async function resolveSettlementEntryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.reconcile");
  } catch (error) {
    return toState(error, "You are not allowed to reconcile settlements");
  }

  const raw = formDataToObject(formData);
  const entryId = String(raw.entryId ?? "");
  try {
    await resolveSettlementEntry(context, {
      entryId,
      shipmentId: String(raw.shipmentId ?? "").trim() || undefined,
      ignore: raw.ignore === "on" || raw.ignore === "true",
      note: String(raw.note ?? "").trim() || null,
    });
  } catch (error) {
    return toState(error, "Unable to resolve the settlement row");
  }

  revalidatePath(`/admin/settlements/${raw.settlementId ?? ""}`);
  return { status: "success", message: "Settlement row updated" };
}

export async function reconcileSettlementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let context: Awaited<ReturnType<typeof actor>>;
  try {
    context = await actor("courier.reconcile");
  } catch (error) {
    return toState(error, "You are not allowed to reconcile settlements");
  }

  const raw = formDataToObject(formData);
  const settlementId = String(raw.settlementId ?? "");
  try {
    const settlement = await reconcileSettlement(context, settlementId);
    // Reconciled cash is what makes reseller earnings payable.
    const promoted = await promoteResellerEarnings(context.businessId, settlementId);
    revalidatePath("/admin/settlements");
    revalidatePath(`/admin/settlements/${settlementId}`);
    revalidatePath("/admin/resellers");
    return {
      status: "success",
      message:
        promoted.promoted > 0
          ? `Settlement ${settlement.reference} reconciled — ${promoted.promoted} reseller ledger entr${promoted.promoted === 1 ? "y" : "ies"} became payable`
          : `Settlement ${settlement.reference} reconciled`,
    };
  } catch (error) {
    return toState(error, "Unable to reconcile the settlement");
  }
}
