"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { recordStockAdjustment } from "@/modules/inventory/service";
import { stockAdjustmentInputSchema } from "@/modules/catalog/schemas";
import type { ActionState } from "@/modules/auth/action-state";
import { logger } from "@/lib/logging";

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Inventory action failed", error);
  return { status: "error", message: fallback };
}

export async function recordAdjustmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertPermission(session, "inventory.adjust");

    const parsed = parseInput(stockAdjustmentInputSchema, formDataToObject(formData), "Stock adjustment");
    const result = await recordStockAdjustment({
      ...parsed,
      locationId: parsed.locationId,
      businessId: session.businessId,
      actorUserId: session.id,
    });

    revalidatePath("/admin/inventory");
    revalidatePath("/admin/inventory/adjustments");
    revalidatePath(`/admin/inventory/${parsed.variantId}`);

    return {
      status: "success",
      message: `Stock updated. On hand is now ${result.balance.onHand} (available ${result.balance.available}).`,
      data: { movementId: result.movementId, adjustmentId: result.adjustmentId },
    };
  } catch (error) {
    return toState(error, "Unable to record the adjustment");
  }
}
