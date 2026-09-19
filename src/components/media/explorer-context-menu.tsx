"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Custom right-click menu for the media explorer.
 *
 * The menu renders inline (fixed positioning) with a z-index above dialogs, so
 * it is never clipped by the picker. Keyboard handling lives on the menu
 * element itself with stopped propagation, so pressing Escape closes only the
 * menu — never the dialog underneath it.
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
      node.focus();
    }
  }, [x, y]);

  // Close on outside pointer-down or window blur; Escape is handled onKeyDown
  // so it never reaches (and closes) the parent dialog.
  React.useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
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
    };
  }, [onClose]);

  const activate = (item: ContextMenuItemDef) => {
    if (item.disabled) return;
    onClose();
    // Defer so the menu unmounts before dialogs opened by the action mount.
    setTimeout(() => item.onSelect(), 0);
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
      if (enabled.length === 0) return;
      setFocusIndex((prev) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = prev < 0 ? (delta > 0 ? 0 : enabled.length - 1) : (prev + delta + enabled.length) % enabled.length;
        return next;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const item = focusIndex >= 0 ? enabled[focusIndex] : undefined;
      if (item) activate(item);
      return;
    }
    // Single-letter jump: focus the first enabled item starting with the key.
    if (/^[a-z0-9]$/i.test(event.key) && event.key.length === 1) {
      const found = enabled.findIndex((item) => typeof item.label === "string" && item.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (found >= 0) {
        event.preventDefault();
        event.stopPropagation();
        setFocusIndex(found);
      }
    }
  };

  // Portalled to the body: inside the (translated) picker dialog, fixed
  // positioning would otherwise resolve against the dialog, not the viewport.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title ?? "Actions"}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[70] min-w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-2xl outline-none"
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
