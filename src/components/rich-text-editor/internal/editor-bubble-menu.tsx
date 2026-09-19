"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { isTextSelection } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenuView } from "@tiptap/extension-bubble-menu";
import { COMMANDS_BY_ID, isCommandAvailable, type EditorCommandId } from "./commands";
import { useEditorUi } from "./editor-context";
import { BlockTypeMenu } from "./menus";
import { ToolbarButton, ToolbarSeparator } from "./ui";
import { useRovingToolbar } from "./use-roving-toolbar";

const pluginKey = new PluginKey("rteBubbleMenu");
const MARK_ITEMS: EditorCommandId[] = ["bold", "italic", "underline", "strike", "code"];

/**
 * Contextual toolbar for text selections. The positioning view from the bubble menu
 * extension owns a plain element that it appends next to the editor while visible;
 * React renders the toolbar into it. Menus opened from the toolbar (which move focus into
 * a portal) keep the bubble open until they close.
 */
export function EditorBubbleMenu({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const { editor, editable } = useEditorUi();
  const [element] = React.useState(() => {
    if (typeof document === "undefined") return null;
    const host = document.createElement("div");
    host.className = "rte-bubble";
    return host;
  });
  const viewRef = React.useRef<BubbleMenuView | null>(null);
  const menuOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (!element || !editable) return;
    const plugin = new Plugin({
      key: pluginKey,
      view: (view) => {
        const instance = new BubbleMenuView({
          editor,
          element,
          view,
          pluginKey,
          updateDelay: 120,
          appendTo: () => container.current ?? editor.view.dom.parentElement ?? document.body,
          shouldShow: ({ editor: current, view: currentView, state, from, to }) => {
            if (!current.isEditable) return false;
            const focused = currentView.hasFocus() || element.contains(document.activeElement) || menuOpenRef.current;
            if (!focused) return false;
            const { selection } = state;
            if (selection.empty || selection instanceof NodeSelection) return false;
            if (current.isActive("codeBlock")) return false;
            if (isTextSelection(selection) && !state.doc.textBetween(from, to, " ").trim()) return false;
            return true;
          },
          options: {
            placement: "top",
            offset: 8,
            flip: true,
            shift: { padding: 8 },
          },
        });
        viewRef.current = instance;
        return instance;
      },
    });
    editor.registerPlugin(plugin);
    // The view makes its element focusable; the toolbar inside manages focus instead.
    element.setAttribute("tabindex", "-1");

    // Hide when keyboard focus leaves the toolbar for somewhere other than the editor.
    const onFocusOut = (event: FocusEvent) => {
      if (menuOpenRef.current) return;
      const next = event.relatedTarget as Node | null;
      if (next && (element.contains(next) || editor.view.dom.contains(next))) return;
      viewRef.current?.hide();
    };
    element.addEventListener("focusout", onFocusOut);

    return () => {
      element.removeEventListener("focusout", onFocusOut);
      if (!editor.isDestroyed) editor.unregisterPlugin(pluginKey);
      viewRef.current = null;
      element.remove();
    };
  }, [editor, element, editable, container]);

  const handleMenuOpenChange = React.useCallback((open: boolean) => {
    menuOpenRef.current = open;
    // Opening a menu moves focus into a portal; the resulting editor blur must not hide us.
    if (viewRef.current) viewRef.current.preventHide = open;
  }, []);

  if (!element || !editable) return null;
  return createPortal(<BubbleToolbar onMenuOpenChange={handleMenuOpenChange} />, element);
}

function BubbleToolbar({ onMenuOpenChange }: { onMenuOpenChange: (open: boolean) => void }) {
  const { editor, commandContext, editable } = useEditorUi();
  const { toolbarRef, toolbarProps } = useRovingToolbar<HTMLDivElement>();
  const items = React.useMemo(() => {
    const ids = [...MARK_ITEMS, "link" as const, "clearFormatting" as const];
    return ids.filter((id) => isCommandAvailable(COMMANDS_BY_ID[id], commandContext));
  }, [commandContext]);
  const snapshot = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: Object.fromEntries(items.map((id) => [id, COMMANDS_BY_ID[id].isActive?.(current) ?? false])),
      enabled: Object.fromEntries(items.map((id) => [id, COMMANDS_BY_ID[id].isEnabled ? COMMANDS_BY_ID[id].isEnabled(current) : true])),
    }),
  });

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Text formatting"
      aria-orientation="horizontal"
      {...toolbarProps}
      className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
    >
      <BlockTypeMenu compact onOpenChange={onMenuOpenChange} />
      <ToolbarSeparator />
      {items.map((id, index) => {
        const command = COMMANDS_BY_ID[id];
        const previous = items[index - 1];
        const separator = previous && MARK_ITEMS.includes(previous) && !MARK_ITEMS.includes(id);
        return (
          <React.Fragment key={id}>
            {separator ? <ToolbarSeparator /> : null}
            <ToolbarButton
              label={command.label}
              icon={command.icon}
              shortcut={command.shortcut}
              active={snapshot?.active[id] ?? false}
              disabled={!editable || !(snapshot?.enabled[id] ?? true)}
              onClick={() => command.run(commandContext)}
              tooltipSide="bottom"
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
