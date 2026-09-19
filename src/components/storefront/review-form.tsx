"use client";

import { MediaPicker } from "@/components/media/media-picker";
import * as React from "react";
import { useActionState } from "react";
import { Alert, Card, CardContent, CardHeader, CardTitle, FormField, Input, Label, Textarea } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/interactive";
import { initialActionState } from "@/modules/auth/action-state";
import { reportReviewAction, submitReviewAction } from "@/modules/reviews/actions";

/**
 * Customer review form.
 *
 * Images are uploaded with the same signed-URL handshake used everywhere else: the
 * browser asks for a target, PUTs the bytes, then confirms. The server enforces the
 * image count and combined size limits on submit.
 */

export function ReviewForm({ productId, productName, maxImages = 3 }: { productId: string; productName: string; maxImages?: number }) {
  const [state, action] = useActionState(submitReviewAction, initialActionState);
  const [rating, setRating] = React.useState(5);
  const [images, setImages] = React.useState<Array<{ assetId: string; name: string; previewUrl: string }>>([]);
  // Reset the picker when a submission succeeds. This is the "adjust state while
  // rendering" pattern from the React docs: cheaper and more obvious than an effect that
  // watches the action result, and it cannot flash the old images.
  const [lastStatus, setLastStatus] = React.useState(state.status);
  if (lastStatus !== state.status) {
    setLastStatus(state.status);
    if (state.status === "success") {
      setImages([]);
    }
  }

  if (state.status === "success") {
    return <Alert variant="success">{state.message}</Alert>;
  }

  return (
    <Card id="write-review">
      <CardHeader>
        <CardTitle className="text-base">Write a review for {productName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.status === "error" ? <Alert variant="danger">{state.message}</Alert> : null}
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="rating" value={rating} />

          <div>
            <Label>Your rating</Label>
            <div className="mt-1 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  aria-label={`${star} star${star === 1 ? "" : "s"}`}
                  className={`text-2xl leading-none ${star <= rating ? "text-amber-500" : "text-slate-300"}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-sm text-slate-500">{rating} of 5</span>
            </div>
          </div>

          <FormField label="Title" htmlFor="review-title" hint="Optional — a short summary">
            <Input id="review-title" name="title" maxLength={120} />
          </FormField>

          <FormField label="Your review" htmlFor="review-body" required hint="What did you like or dislike? Minimum 10 characters.">
            <Textarea id="review-body" name="body" rows={4} required minLength={10} maxLength={4000} />
          </FormField>

          <div className="space-y-2">
            <Label>Photos ({images.length} of {maxImages})</Label>
            <MediaPicker audience="customer" multiple maxSelection={Math.max(0, maxImages - images.length)} excludeIds={images.map((image) => image.assetId)} onConfirm={(assets) => setImages((current) => [...current, ...assets.map((asset) => ({ assetId: asset.id, name: asset.originalName, previewUrl: asset.url ?? "" }))])} />
            <div className="flex flex-wrap items-center gap-2">
              {images.map((image) => (
                <span key={image.assetId} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.previewUrl} alt={image.name} className="h-16 w-16 rounded object-cover" />
                  <input type="hidden" name="imageAssetId" value={image.assetId} />
                  <button
                    type="button"
                    className="absolute -right-2 -top-2 rounded-full bg-white text-xs text-rose-600 shadow"
                    onClick={() => setImages((current) => current.filter((candidate) => candidate.assetId !== image.assetId))}
                    aria-label={`Remove ${image.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500">Only customers who bought this product can review it. Reviews are checked before publishing.</p>
          </div>

          <SubmitButton pendingLabel="Submitting…">Submit review</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

/** Compact "report this review" control. */
export function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useActionState(reportReviewAction, initialActionState);

  if (!open) {
    return (
      <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }

  return (
    <form action={action} className="mt-1 space-y-1 text-xs">
      <input type="hidden" name="reviewId" value={reviewId} />
      {state.status === "success" ? (
        <p className="text-emerald-600">{state.message}</p>
      ) : (
        <>
          <select name="reason" className="rounded border px-1 py-0.5 text-xs">
            <option value="SPAM">Spam</option>
            <option value="OFFENSIVE">Offensive language</option>
            <option value="WRONG_PRODUCT">Not about this product</option>
            <option value="OTHER">Other</option>
          </select>
          <SubmitButton variant="outline" size="sm" pendingLabel="…">
            Send
          </SubmitButton>
          {state.status === "error" ? <p className="text-rose-600">{state.message}</p> : null}
        </>
      )}
    </form>
  );
}

