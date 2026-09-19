"use client";

import * as React from "react";
import type { Editor } from "@tiptap/core";
import { PopoverAnchor } from "./ui";

/**
 * Popovers (link editor, slash menu) are positioned by the project's Radix popover, which
 * needs a DOM anchor. This zero-size element is placed at the caret / selection inside the
 * scrolling content so the popover follows the text, flips and shifts like every other
 * popover in the application.
 */

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function FloatingAnchor({ rect }: { rect: AnchorRect | null }) {
  return (
    <PopoverAnchor asChild>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: rect?.top ?? 0,
          left: rect?.left ?? 0,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          pointerEvents: "none",
        }}
      />
    </PopoverAnchor>
  );
}

/** Converts viewport coordinates to coordinates relative to `container`. */
export function toContainerRect(rect: { top: number; left: number; width: number; height: number }, container: HTMLElement): AnchorRect {
  const bounds = container.getBoundingClientRect();
  return {
    top: rect.top - bounds.top,
    left: rect.left - bounds.left,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

/** Viewport rect of the current selection (falls back to the caret). */
export function selectionRect(editor: Editor, container: HTMLElement): AnchorRect | null {
  try {
    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to, -1);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right, left + 1);
    return toContainerRect({ top, left, width: right - left, height: bottom - top }, container);
  } catch {
    return null;
  }
}
