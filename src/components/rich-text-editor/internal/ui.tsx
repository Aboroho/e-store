"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/primitives";
import { formatShortcut } from "./shortcuts";

/**
 * Thin, project-styled wrappers around the Radix tooltip and popover primitives (both
 * already dependencies of the application, but without shared wrappers yet). They follow
 * the conventions of `components/ui/interactive.tsx` so they could be promoted there
 * later without touching the editor.
 */

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] select-none rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white shadow-md"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-900" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                    */
/* -------------------------------------------------------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar button                                                             */
/* -------------------------------------------------------------------------- */

export interface ToolbarButtonProps extends Omit<ButtonProps, "children" | "size" | "variant"> {
  /** Accessible name and tooltip text. */
  label: string;
  icon?: LucideIcon;
  /** Shortcut such as "Mod+B"; rendered in the tooltip for the current platform. */
  shortcut?: string;
  active?: boolean;
  /** Renders a small chevron for menu triggers. */
  menu?: boolean;
  children?: React.ReactNode;
  tooltipSide?: "top" | "bottom";
}

/**
 * Icon button used across the toolbar, bubble menu and block menus. Pointer-down is
 * prevented so the editor keeps focus and its selection while a tool is used.
 */
export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { label, icon: Icon, shortcut, active = false, menu = false, children, className, onMouseDown, tooltipSide = "top", ...props },
  ref,
) {
  const tooltip = shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
  return (
    <Tooltip content={tooltip} side={tooltipSide}>
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={menu ? undefined : active}
        data-active={active ? "true" : undefined}
        className={cn(
          "h-8 w-8 shrink-0 rounded-md text-slate-600 hover:text-slate-900 data-[active=true]:bg-slate-200/80 data-[active=true]:text-slate-900 data-[state=open]:bg-slate-200/80 data-[state=open]:text-slate-900",
          menu && children ? "w-auto gap-1 px-2" : null,
          className,
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          onMouseDown?.(event);
        }}
        {...props}
      >
        {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
        {children}
        {menu ? <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" /> : null}
      </Button>
    </Tooltip>
  );
});

export function ToolbarSeparator() {
  return <span role="separator" aria-orientation="vertical" className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;
}
