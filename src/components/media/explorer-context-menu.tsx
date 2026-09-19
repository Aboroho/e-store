"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Custom right-click menu for the media explorer.
 *
 * The menu is portalled to the body with viewport positioning, so it is never
 * clipped by the (translated) picker dialog. Two things about modal dialogs
 * need explicit handling here:
 *
 * - Radix modal dialogs set `pointer-events: none` on the body, which the
 *   body-portalled menu would inherit — so the menu root re-enables them.
 * - The dialog focus trap pulls focus back into the dialog, so the menu
 *   element itself may never receive keyboard events. A document-level
 *   capture listener therefore mirrors the menu keyboard handling (and always
 *   owns Escape, so dismissing the menu never closes the dialog underneath).
 */

export interface ContextMenuItemDef {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onSelect: () => void;
}

export interface ExplorerContextMenuProps {
  x: number;
  y: number;
  /** Groups of items; groups are visually separated. */
  sections: ContextMenuItemDef[][];
  title?: string;
  onClose: () => void;
}

export function ExplorerContextMenu({ x, y, sections, title, onClose }: ExplorerContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: x, top: y });
  const [focusIndex, setFocusIndex] = React.useState(-1);
  const swallowTimer = React.useRef<number | null>(null);

  const flat = React.useMemo(() => sections.flat(), [sections]);
  const enabled = React.useMemo(() => flat.filter((item) => !item.disabled), [flat]);
  const enabledIndexByKey = React.useMemo(() => {
    const map = new Map<string, number>();
    enabled.forEach((item, index) => map.set(item.key, index));
    return map;
  }, [enabled]);

  // Clamp into the viewport once the menu size is known, then take focus so
  // keyboard input lands here instead of the dialog underneath.
  React.useEffect(() => {
    const node = ref.current;
    if (node) {
      const rect = node.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      });
      // preventScroll: focusing must never scroll (a scroll would dismiss us).
      node.focus({ preventScroll: true });
    }
  }, [x, y]);

  const activate = (item: ContextMenuItemDef) => {
    if (item.disabled) return;
    // Capture the callback before closing — closing unmounts the menu and
    // could theoretically invalidate the item reference in edge cases.
    const callback = item.onSelect;
    onClose();
    // Defer so the menu unmounts before dialogs opened by the action mount.
    setTimeout(() => callback(), 0);
  };

  const moveFocus = (delta: number) => {
    if (enabled.length === 0) return;
    setFocusIndex((prev) => {
      const next = prev < 0 ? (delta > 0 ? 0 : enabled.length - 1) : (prev + delta + enabled.length) % enabled.length;
      return next;
    });
  };

  const activateFocused = () => {
    const item = focusIndex >= 0 ? enabled[focusIndex] : undefined;
    if (item) activate(item);
  };

  /** Single-letter jump: focus the first enabled item starting with the key. */
  const jumpToLetter = (key: string): boolean => {
    if (!/^[a-z0-9]$/i.test(key) || key.length !== 1) return false;
    const found = enabled.findIndex((item) => typeof item.label === "string" && item.label.toLowerCase().startsWith(key.toLowerCase()));
    if (found >= 0) {
      setFocusIndex(found);
      return true;
    }
    return false;
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      activateFocused();
      return;
    }
    if (jumpToLetter(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // Latest keyboard closure for the document-level fallback below.
  const keyHandlerRef = React.useRef((_event: KeyboardEvent) => {});
  React.useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Always owned by the menu: the dialog underneath must NOT close.
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      // Keys already inside the menu are handled by the menu element itself.
      if (ref.current && ref.current.contains(event.target as Node)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveFocus(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopImmediatePropagation();
        activateFocused();
      } else if (event.key === "Tab") {
        // Dismiss, but let focus move naturally.
        onClose();
      } else if (jumpToLetter(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
  });

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, []);

  // Close on outside pointer-down or window blur. The click that follows an
  // outside dismiss is swallowed (capture, before React dispatches it) so it
  // cannot accidentally select items or navigate into folders. Right-clicks
  // are never swallowed: the contextmenu event that follows them must open
  // the menu for the newly right-clicked target.
  React.useEffect(() => {
    const swallow = (event: Event) => {
      if (swallowTimer.current !== null) {
        window.clearTimeout(swallowTimer.current);
        swallowTimer.current = null;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const disarmSwallow = () => {
      if (swallowTimer.current !== null) {
        window.clearTimeout(swallowTimer.current);
        swallowTimer.current = null;
      }
      document.removeEventListener("click", swallow, { capture: true });
      document.removeEventListener("dblclick", swallow, { capture: true });
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
        if (event.button !== 0) return;
        disarmSwallow();
        document.addEventListener("click", swallow, { capture: true, once: true });
        document.addEventListener("dblclick", swallow, { capture: true, once: true });
        // A press that turns into a drag fires no click; disarm so a later,
        // unrelated click is never swallowed.
        swallowTimer.current = window.setTimeout(disarmSwallow, 500);
      }
    };
    const handleBlur = () => onClose();
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("blur", handleBlur);
    // A scroll anywhere except inside the menu itself dismisses it.
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("scroll", handleScroll, true);
      disarmSwallow();
    };
  }, [onClose]);

  // Portalled to the body: inside the (translated) picker dialog, fixed
  // positioning would otherwise resolve against the dialog, not the viewport.
  // `pointer-events-auto` opts back out of the `pointer-events: none` that
  // modal dialogs apply to the body — without it the menu is visible but
  // dead to the mouse.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title ?? "Actions"}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.left, top: position.top }}
      className="pointer-events-auto fixed z-[70] min-w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-2xl outline-none"
    >
      {title ? (
        <p className="truncate px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      ) : null}
      {sections.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 0 ? <div className="my-1 h-px bg-slate-100" role="separator" /> : null}
          {group.map((item) => {
            const isFocused = !item.disabled && enabledIndexByKey.get(item.key) === focusIndex;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => activate(item)}
                onMouseEnter={() => {
                  if (!item.disabled) setFocusIndex(enabled.findIndex((entry) => entry.key === item.key));
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  item.danger ? "text-red-600" : "text-slate-700",
                  item.disabled && "cursor-not-allowed opacity-40",
                  !item.disabled && isFocused && (item.danger ? "bg-red-50" : "bg-slate-100"),
                  !item.disabled && !isFocused && "hover:bg-slate-50",
                )}
              >
                {item.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut ? <kbd className="rounded border border-slate-200 bg-slate-50 px-1 text-[10px] text-slate-400">{item.shortcut}</kbd> : null}
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </div>,
    document.body,
  );
}
