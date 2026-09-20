"use client";

import * as React from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Collapsible form sections.
 *
 * Content is **hidden, never unmounted**: collapsing a section can never discard
 * what the user typed, an open dialog or a media selection. Expanded state is kept
 * above the individual sections in `CollapsibleGroup` so "expand all" / "collapse
 * all" and the completion badges can be driven from one place.
 */

export type SectionTone = "neutral" | "warning" | "success";

interface CollapsibleContextValue {
  isOpen: (id: string) => boolean;
  setOpen: (id: string, open: boolean) => void;
  register: (id: string) => void;
}

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

export function CollapsibleGroup({
  children,
  defaultOpen = [],
  className,
  header,
}: {
  children: React.ReactNode;
  /** Section ids that start expanded. */
  defaultOpen?: string[];
  className?: string;
  /** Optional extra controls rendered next to expand/collapse all. */
  header?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(defaultOpen.map((id) => [id, true])),
  );
  const ids = React.useRef<string[]>([]);

  const value = React.useMemo<CollapsibleContextValue>(
    () => ({
      isOpen: (id) => Boolean(open[id]),
      setOpen: (id, next) => setOpen((current) => ({ ...current, [id]: next })),
      register: (id) => {
        if (!ids.current.includes(id)) ids.current.push(id);
      },
    }),
    [open],
  );

  return (
    <CollapsibleContext.Provider value={value}>
      <div className={cn("mb-3 flex flex-wrap items-center justify-end gap-2", className)}>
        {header}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const all: Record<string, boolean> = {};
            for (const id of ids.current) all[id] = true;
            setOpen(all);
          }}
        >
          <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          Expand all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const all: Record<string, boolean> = {};
            for (const id of ids.current) all[id] = false;
            setOpen(all);
          }}
        >
          <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden="true" />
          Collapse all
        </Button>
      </div>
      <div className="space-y-3">{children}</div>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleSection({
  id,
  title,
  description,
  icon,
  badge,
  badgeTone = "neutral",
  children,
  defaultOpen = false,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Short status text, e.g. "3 variants". */
  badge?: React.ReactNode;
  badgeTone?: SectionTone;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const context = React.useContext(CollapsibleContext);
  const [selfOpen, setSelfOpen] = React.useState(defaultOpen);
  const open = context ? context.isOpen(id) : selfOpen;
  const setOpen = (next: boolean) => (context ? context.setOpen(id, next) : setSelfOpen(next));

  React.useEffect(() => {
    context?.register(id);
  }, [context, id]);

  const regionId = `${id}-section-content`;

  return (
    <section
      id={id}
      className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm", open && "ring-1 ring-slate-200", className)}
    >
      <h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={regionId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
            {icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{title}</span>
              {badge ? (
                <Badge variant={badgeTone === "success" ? "success" : badgeTone === "warning" ? "warning" : "neutral"}>{badge}</Badge>
              ) : null}
            </span>
            {description ? <span className="mt-0.5 block text-xs text-slate-500">{description}</span> : null}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      {/* Hidden rather than unmounted so nothing the user entered is ever lost. */}
      <div id={regionId} hidden={!open} className="border-t border-slate-100 px-4 py-4">
        {children}
      </div>
    </section>
  );
}
