"use client";

import * as React from "react";

const FOCUSABLE = 'button:not([disabled]):not([data-roving-skip]), [role="combobox"]:not([disabled])';

/**
 * WAI-ARIA toolbar keyboard pattern: a single tab stop, arrow keys move between tools.
 * Works on whatever buttons are currently rendered, so menus can appear and disappear.
 */
export function useRovingToolbar<T extends HTMLElement>() {
  const toolbarRef = React.useRef<T | null>(null);

  const items = React.useCallback(() => {
    const root = toolbarRef.current;
    return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
  }, []);

  const syncTabStops = React.useCallback(
    (preferred?: HTMLElement | null) => {
      const list = items();
      if (list.length === 0) return;
      const current = preferred && list.includes(preferred) ? preferred : list.find((item) => item.tabIndex === 0) ?? list[0];
      for (const item of list) item.tabIndex = item === current ? 0 : -1;
    },
    [items],
  );

  // Re-run after every render: the set of tools changes with the selection.
  React.useEffect(() => {
    syncTabStops();
  });

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<T>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const list = items();
      const active = document.activeElement as HTMLElement | null;
      const index = active ? list.indexOf(active) : -1;
      if (index === -1) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
      if (event.key === "ArrowRight") next = (index + 1) % list.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = list.length - 1;
      const target = list[next];
      if (target) {
        syncTabStops(target);
        target.focus();
      }
    },
    [items, syncTabStops],
  );

  const onFocus = React.useCallback(
    (event: React.FocusEvent<T>) => {
      const target = event.target as HTMLElement;
      if (target.matches(FOCUSABLE)) syncTabStops(target);
    },
    [syncTabStops],
  );

  const toolbarProps = React.useMemo(() => ({ onKeyDown, onFocus }), [onKeyDown, onFocus]);

  return { toolbarRef, toolbarProps };
}
