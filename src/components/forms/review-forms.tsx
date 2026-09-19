"use client";

import { useActionState } from "react";
import { Alert, Button, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger, SubmitButton } from "@/components/ui/interactive";
import { initialActionState } from "@/modules/auth/actions";
import { moderateReviewAction } from "@/modules/reviews/actions";

/**
 * Review moderation controls.
 *
 * Every decision posts through the same permission-checked server action; the UI only
 * decides which decisions to offer for the current status.
 */
export function ModerationButtons({ reviewId, status, isFeatured }: { reviewId: string; status: string; isFeatured: boolean }) {
  const [state, action] = useActionState(moderateReviewAction, initialActionState);

  const button = (decision: string, label: string, variant: "default" | "outline" | "destructive" | "ghost" = "outline") => (
    <form action={action} className="inline">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="decision" value={decision} />
      <SubmitButton variant={variant} size="sm" pendingLabel="…">
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status !== "APPROVED" ? button("APPROVE", "Approve", "default") : null}
        {status !== "REJECTED" ? (
          <RejectDialog reviewId={reviewId} action={action} />
        ) : null}
        {status !== "SPAM" ? button("SPAM", "Spam") : null}
        {isFeatured ? button("UNFEATURE", "Unfeature") : button("FEATURE", "Feature In homepage")}
      </div>
      {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
      {state.status === "success" ? <Alert variant="success">{state.message}</Alert> : null}
    </div>
  );
}

function RejectDialog({ reviewId, action }: { reviewId: string; action: (formData: FormData) => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent title="Reject this review" description="The customer keeps their review; it simply is not published. The reason is internal.">
        <form action={action} className="space-y-3">
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="decision" value="REJECT" />
          <Textarea name="reason" rows={3} placeholder="Why is this review not being published?" required minLength={3} maxLength={300} />
          <SubmitButton variant="destructive" pendingLabel="Rejecting…">
            Reject review
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
