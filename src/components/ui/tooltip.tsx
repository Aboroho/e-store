"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tooltip primitives.
 *
 * One provider wraps the application shell, so every help affordance below can be a
 * plain component. Tooltips open on hover *and* on keyboard focus (Radix handles
 * both) and are reachable on touch by tapping the trigger, which is what makes the
 * "explain every field" requirement usable on a phone.
 */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-[60] max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-100 shadow-lg",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/**
 * The help "?" next to a label. Always rendered as a focusable button so screen
 * readers and keyboard users can reach the same explanation as a mouse user.
 */
export function InfoTip({ children, label = "More information", className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1",
            className,
          )}
          // A tap on a touch device should reveal the tip rather than submit anything.
          onClick={(event) => event.preventDefault()}
        >
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

/** Convenience wrapper: any element with an explanatory tooltip. */
export function WithTooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
