"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/auth/session";
import { assertPermission } from "@/lib/permissions";
import { formDataToObject, parseInput } from "@/lib/validation";
import { preorderAllocationInputSchema } from "@/modules/catalog/schemas";
import { allocatePreorderQueue, cancelPreorderCommitment } from "@/modules/preorders/service";
import type { ActionState } from "@/modules/auth/actions";
import { logger } from "@/lib/logging";

function toState(error: unknown, fallback: string): ActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  logger.error("Preorder action failed", error);
  return { status: "error", message: fallback };
}

export async function allocatePreordersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertPermission(session, "preorder.allocate");

    const parsed = parseInput(preorderAllocationInputSchema, formDataToObject(formData), "Allocate preorders");
    const result = await allocatePreorderQueue(
      { userId: session.id, businessId: session.businessId, actorLabel: session.email },
      { ...parsed, note: parsed.note ?? null },
    );

    revalidatePath("/admin/inventory/preorders");
    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/${parsed.variantId}`);

    return {
      status: "success",
      message:
        result.allocated === 0
          ? "Nothing was allocated: no open preorder commitments for this variant."
          : `Allocated ${result.allocated} unit(s) across ${result.commitments.length} commitment(s)${
              result.skipped > 0 ? `; ${result.skipped} unit(s) could not be allocated` : ""
            }.`,
    };
  } catch (error) {
    return toState(error, "Unable to allocate the preorders");
  }
}

export async function cancelPreorderAction(commitmentId: string, reason: string): Promise<void> {
  const session = await requireSession();
  assertPermission(session, "preorder.allocate");
  await cancelPreorderCommitment(
    { userId: session.id, businessId: session.businessId, actorLabel: session.email },
    commitmentId,
    reason,
  );
  revalidatePath("/admin/inventory/preorders");
}
