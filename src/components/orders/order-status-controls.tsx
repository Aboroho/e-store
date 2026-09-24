"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Send, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, Label, NativeSelect, Textarea, buttonVariants } from "@/components/ui/primitives";
import { Checkbox, Dialog, DialogContent } from "@/components/ui/interactive";
import {
  changeOrderStatusAction,
  deleteOrderAction,
  partialDeliveryAction,
  sendOrdersToCourierAction,
} from "@/modules/orders/manual-actions";
import { STATUS_GROUP_LABELS, STATUS_TONES, statusGroupOf, type InternalOrderStatus } from "@/modules/orders/status";

/**
 * Order status, dispatch, partial-delivery and deletion controls.
 *
 * The buttons rendered here come from the server's own transition evaluation, so
 * the operator only ever sees what the server will accept — and the server checks
 * again on submit. Anything that needs an explicit confirmation (administrative
 * overrides, backward moves, post-courier edits, permanent deletion) opens a
 * dialog with the warning, a reason field and an acknowledgement tick; the browser's
 * own `confirm()` is never used.
 */

export interface TransitionOption {
  status: string;
  label: string;
  allowed: boolean;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  deniedReason: string | null;
  warning: { title: string; points: string[] } | null;
  effect: string;
}

export interface PartialDeliveryLine {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  dispatchedQuantity: number;
  returnedQuantity: number;
  cancelledQuantity: number;
  exchangedQuantity: number;
}

export function OrderStatusControls({
  orderId,
  orderNumber,
  currentStatus,
  statusLabel,
  courierStatus,
  statusGroup,
  transitions,
  dispatch,
  providers,
  mayDispatch,
  deletable,
  deletionBlockers,
  mayDelete,
  partialDeliveryLines,
  mayRecordPartialDelivery,
  mayEdit,
}: {
  orderId: string;
  orderNumber: string;
  currentStatus: string;
  statusLabel: string;
  courierStatus: string | null;
  statusGroup: string;
  transitions: TransitionOption[];
  dispatch: { eligible: boolean; reason?: string };
  providers: Array<{ id: string; name: string }>;
  mayDispatch: boolean;
  deletable: boolean;
  deletionBlockers: string[];
  mayDelete: boolean;
  partialDeliveryLines: PartialDeliveryLine[];
  mayRecordPartialDelivery: boolean;
  mayEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  const [pendingTransition, setPendingTransition] = React.useState<TransitionOption | null>(null);
  const [transitionReason, setTransitionReason] = React.useState("");
  const [transitionAcknowledged, setTransitionAcknowledged] = React.useState(false);

  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [providerId, setProviderId] = React.useState(providers[0]?.id ?? "");

  const [partialOpen, setPartialOpen] = React.useState(false);
  const [partialLines, setPartialLines] = React.useState<Record<string, { delivered: string; returned: string }>>({});
  const [partialNote, setPartialNote] = React.useState("");
  const [partialAcknowledged, setPartialAcknowledged] = React.useState(false);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = React.useState(false);

  /** Run one server action, report the outcome and refresh the server data. */
  const run = async (key: string, action: () => Promise<unknown>, successMessage?: string): Promise<boolean> => {
    setBusy(key);
    try {
      const result = (await action()) as { ok: boolean; message?: string };
      if (!result.ok) {
        toast.error(result.message ?? "That did not work");
        return false;
      }
      if (successMessage) toast.success(successMessage);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const grouped = React.useMemo(() => {
    const groups: Array<{ group: string; label: string; options: TransitionOption[] }> = [];
    for (const key of ["PRE_COURIER", "COURIER", "POST_COURIER"] as const) {
      const options = transitions.filter((transition) => statusGroupOf(transition.status as InternalOrderStatus) === key);
      if (options.length > 0) groups.push({ group: key, label: STATUS_GROUP_LABELS[key], options });
    }
    return groups;
  }, [transitions]);

  const submitTransition = async () => {
    const transition = pendingTransition;
    if (!transition) return;
    if (transition.requiresReason && transitionReason.trim().length === 0) {
      toast.error("A reason is required for this change");
      return;
    }
    if (transition.requiresConfirmation && !transitionAcknowledged) {
      toast.error("Tick the acknowledgement to continue");
      return;
    }
    const done = await run(
      `status:${transition.status}`,
      async () =>
        changeOrderStatusAction({
          orderId,
          status: transition.status,
          reason: transitionReason.trim() || undefined,
          confirmed: transition.requiresConfirmation ? transitionAcknowledged : false,
        }),
      `${orderNumber} is now ${transition.label}`,
    );
    if (!done) return;
    setPendingTransition(null);
    setTransitionReason("");
    setTransitionAcknowledged(false);
  };

  const submitDispatch = async () => {
    const done = await run(
      "dispatch",
      async () => sendOrdersToCourierAction({ orderIds: [orderId], courierProviderId: providerId || undefined }),
      `${orderNumber} was queued for the courier`,
    );
    if (done) setDispatchOpen(false);
  };

  const submitPartial = async () => {
    const items = Object.entries(partialLines)
      .map(([orderItemId, value]) => ({
        orderItemId,
        deliveredQuantity: Math.max(0, Math.trunc(Number(value.delivered) || 0)),
        returnedQuantity: Math.max(0, Math.trunc(Number(value.returned) || 0)),
      }))
      .filter((entry) => entry.deliveredQuantity > 0 || entry.returnedQuantity > 0);
    if (items.length === 0) {
      toast.error("Record at least one delivered or returned unit");
      return;
    }
    const done = await run(
      "partial",
      async () => partialDeliveryAction({ orderId, items, note: partialNote.trim() || undefined, confirmed: partialAcknowledged }),
      `Partial delivery recorded on ${orderNumber}`,
    );
    if (!done) return;
    setPartialOpen(false);
    setPartialLines({});
    setPartialNote("");
    setPartialAcknowledged(false);
  };

  const submitDelete = async () => {
    if (!deleteAcknowledged) {
      toast.error("Confirm that this deletion is permanent");
      return;
    }
    const done = await run(
      "delete",
      async () => deleteOrderAction({ orderId, reason: deleteReason.trim() || undefined, confirmed: true }),
      `${orderNumber} was permanently deleted`,
    );
    if (!done) return;
    setDeleteOpen(false);
    router.push("/admin/orders");
  };

  const outstanding = (line: PartialDeliveryLine) =>
    Math.max(0, line.quantity - line.returnedQuantity - line.cancelledQuantity - line.exchangedQuantity);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_TONES[currentStatus as InternalOrderStatus] ?? "neutral"}>{statusLabel}</Badge>
        <Badge variant="neutral">{statusGroup.replace(/_/g, " ").toLowerCase()} stage</Badge>
        {courierStatus ? <Badge variant="violet">Courier: {courierStatus.replace(/_/g, " ")}</Badge> : null}
      </div>

      {grouped.map((group) => (
        <div key={group.group} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{group.label}</p>
          <div className="flex flex-wrap gap-2">
            {group.options.map((transition) => {
              const active = transition.status === currentStatus;
              return (
                <button
                  key={transition.status}
                  type="button"
                  disabled={!transition.allowed || busy !== null}
                  title={transition.allowed ? undefined : transition.deniedReason ?? undefined}
                  onClick={() => {
                    if (transition.requiresConfirmation || transition.requiresReason) {
                      setPendingTransition(transition);
                      setTransitionReason("");
                      setTransitionAcknowledged(false);
                      return;
                    }
                    void run(
                      `status:${transition.status}`,
                      async () => changeOrderStatusAction({ orderId, status: transition.status, confirmed: false }),
                      `${orderNumber} is now ${transition.label}`,
                    );
                  }}
                  className={cn(
                    buttonVariants({ variant: transition.allowed ? "outline" : "ghost", size: "sm" }),
                    "border-slate-200",
                    !transition.allowed && "cursor-not-allowed text-slate-400 line-through decoration-slate-300",
                    active && "border-brand-500 text-brand-700",
                  )}
                >
                  {busy === `status:${transition.status}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  {transition.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="space-y-2 border-t border-slate-200 pt-3">
        <Button
          type="button"
          size="sm"
          disabled={!dispatch.eligible || !mayDispatch || busy !== null}
          title={dispatch.eligible ? undefined : dispatch.reason}
          onClick={() => setDispatchOpen(true)}
        >
          {busy === "dispatch" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
          Send to courier
        </Button>
        {!dispatch.eligible ? <p className="text-xs text-slate-500">{dispatch.reason}</p> : null}

        {mayRecordPartialDelivery ? (
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setPartialOpen(true)}>
            <Truck className="mr-1 h-4 w-4" /> Partial delivery
          </Button>
        ) : null}

        {mayEdit ? (
          <Link href={`/admin/orders/${orderId}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="mr-1 h-4 w-4" /> Edit order
          </Link>
        ) : null}

        {mayDelete ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!deletable || busy !== null}
            onClick={() => setDeleteOpen(true)}
            title={deletable ? undefined : deletionBlockers.join("; ")}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Delete order
          </Button>
        ) : null}
        {mayDelete && !deletable ? (
          <p className="text-xs text-slate-500">
            {deletionBlockers.length > 0
              ? `Deletion is blocked while this order has ${deletionBlockers.join(", ")}.`
              : "Only cancelled orders can be deleted."}
          </p>
        ) : null}
      </div>

      {/* ------------------------------------------------- transition dialog */}
      <Dialog open={pendingTransition !== null} onOpenChange={(open) => !open && setPendingTransition(null)}>
        <DialogContent
          title={pendingTransition?.warning?.title ?? `Change ${orderNumber} to ${pendingTransition?.label ?? ""}`}
          description={
            pendingTransition?.requiresConfirmation
              ? "This is an administrative override. It is written to the audit trail with your name."
              : "Add a reason so the timeline explains the change."
          }
        >
          <div className="space-y-3">
            {pendingTransition?.warning ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Read this before continuing
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                  {pendingTransition.warning.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {pendingTransition?.requiresReason ? (
              <div className="space-y-1.5">
                <Label htmlFor="transition-reason">Reason</Label>
                <Textarea
                  id="transition-reason"
                  rows={2}
                  maxLength={300}
                  value={transitionReason}
                  placeholder="Why is this order changing status?"
                  onChange={(event) => setTransitionReason(event.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="transition-note">Note (optional)</Label>
                <Input
                  id="transition-note"
                  maxLength={300}
                  value={transitionReason}
                  onChange={(event) => setTransitionReason(event.target.value)}
                />
              </div>
            )}

            {pendingTransition?.requiresConfirmation ? (
              <label className="flex items-start gap-2 text-xs font-medium text-slate-700">
                <Checkbox checked={transitionAcknowledged} onCheckedChange={(checked) => setTransitionAcknowledged(checked === true)} />
                <span>I understand the consequences of this override and accept that it is recorded against my account.</span>
              </label>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPendingTransition(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void submitTransition()} disabled={busy !== null}>
                {busy !== null ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                Apply change
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- dispatch dialog */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent
          title={`Send ${orderNumber} to the courier`}
          description="Dispatching consumes the reserved stock, creates the shipment and queues the provider call."
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-provider">Courier provider</Label>
              <NativeSelect id="dispatch-provider" value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-slate-500">
                The COD amount sent to the courier is the collectible total calculated by the server.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDispatchOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void submitDispatch()} disabled={busy !== null || providers.length === 0}>
                {busy === "dispatch" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Send now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------- partial delivery dialog */}
      <Dialog open={partialOpen} onOpenChange={setPartialOpen}>
        <DialogContent
          title={`Partial delivery for ${orderNumber}`}
          description="Record what reached the customer and what came back. Returned units go to stock inspection and reseller earnings follow the delivered value."
          className="max-w-xl"
        >
          <div className="space-y-3">
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {partialDeliveryLines.map((line) => {
                const left = outstanding(line);
                const value = partialLines[line.id] ?? { delivered: String(left), returned: "0" };
                return (
                  <li key={line.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{line.productName}</p>
                      <p className="text-xs text-slate-500">
                        {line.variantName} · {left} outstanding of {line.quantity}
                      </p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`delivered-${line.id}`}>Delivered</Label>
                        <Input
                          id={`delivered-${line.id}`}
                          type="number"
                          min={0}
                          max={left}
                          value={value.delivered}
                          onChange={(event) =>
                            setPartialLines((current) => ({
                              ...current,
                              [line.id]: { ...value, delivered: event.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`returned-${line.id}`}>Returned</Label>
                        <Input
                          id={`returned-${line.id}`}
                          type="number"
                          min={0}
                          max={left}
                          value={value.returned}
                          onChange={(event) =>
                            setPartialLines((current) => ({
                              ...current,
                              [line.id]: { ...value, returned: event.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-1.5">
              <Label htmlFor="partial-note">Note</Label>
              <Input
                id="partial-note"
                maxLength={300}
                value={partialNote}
                placeholder="e.g. Customer kept 2 of 3 items, one box damaged"
                onChange={(event) => setPartialNote(event.target.value)}
              />
            </div>

            <label className="flex items-start gap-2 text-xs font-medium text-slate-700">
              <Checkbox checked={partialAcknowledged} onCheckedChange={(checked) => setPartialAcknowledged(checked === true)} />
              <span>I understand returned units go back into inspection and the reseller collection is adjusted to the delivered value.</span>
            </label>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPartialOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void submitPartial()} disabled={busy !== null}>
                {busy === "partial" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Truck className="mr-1 h-4 w-4" />}
                Record outcome
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------- delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          title={`Permanently delete ${orderNumber}?`}
          description="This is not a bin. The order and its operational rows are removed for real."
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <p className="font-medium">What is deleted</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>The order, its lines, adjustments, addresses and status history.</li>
                <li>Released stock reservations and cancelled preorder commitments.</li>
              </ul>
              <p className="mt-2 font-medium">What is kept</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>The customer, their addresses and their other orders.</li>
                <li>Every stock movement in the inventory ledger.</li>
                <li>A snapshot of the order in the deletion log and an audit entry with your name.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delete-reason">Reason (optional)</Label>
              <Input
                id="delete-reason"
                maxLength={300}
                value={deleteReason}
                placeholder="e.g. Duplicate test order"
                onChange={(event) => setDeleteReason(event.target.value)}
              />
            </div>

            <label className="flex items-start gap-2 text-xs font-medium text-slate-700">
              <Checkbox checked={deleteAcknowledged} onCheckedChange={(checked) => setDeleteAcknowledged(checked === true)} />
              <span>I understand this cannot be undone and that the snapshot in the deletion log is all that will remain.</span>
            </label>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>
                Keep order
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => void submitDelete()} disabled={busy !== null || !deleteAcknowledged}>
                {busy === "delete" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                Delete permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
