"use client";

import * as React from "react";
import { exitSuggestion } from "@tiptap/suggestion";
import { cn } from "@/lib/utils";
import { slashCommandPluginKey, type SlashCommandController, type SlashSuggestionProps } from "../blocks/slash-command";
import { SLASH_GROUP_LABELS, searchSlashCommands, type EditorCommand } from "./commands";
import { useEditorUi } from "./editor-context";
import { FloatingAnchor, toContainerRect, type AnchorRect } from "./floating-anchor";
import { formatShortcut } from "./shortcuts";
import { Popover, PopoverContent } from "./ui";
import { useLatest } from "./use-latest";

interface MenuState {
  open: boolean;
  items: EditorCommand[];
  selected: number;
  rect: AnchorRect | null;
  command: ((command: EditorCommand) => void) | null;
}

const CLOSED: MenuState = { open: false, items: [], selected: 0, rect: null, command: null };

/**
 * The `/` menu. The ProseMirror side (blocks/slash-command.ts) reports query, position and
 * key presses through `controllerRef`; this component renders the list with the project's
 * popover and keeps focus inside the editor so typing keeps filtering.
 */
export function SlashCommandMenu({
  controllerRef,
  container,
}: {
  controllerRef: React.MutableRefObject<SlashCommandController | null>;
  container: React.RefObject<HTMLElement | null>;
}) {
  const { editor, commandContext } = useEditorUi();
  const [state, setState] = React.useState<MenuState>(CLOSED);
  const stateRef = useLatest(state);
  const listId = React.useId();
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const positionFrom = React.useCallback(
    (props: SlashSuggestionProps): AnchorRect | null => {
      const rect = props.clientRect?.();
      if (!rect || !container.current) return null;
      return toContainerRect(rect, container.current);
    },
    [container],
  );

  React.useLayoutEffect(() => {
    controllerRef.current = {
      getItems: (query) => searchSlashCommands(query, commandContext),
      onStart: (props) => setState({ open: true, items: props.items, selected: 0, rect: positionFrom(props), command: props.command }),
      onUpdate: (props) =>
        setState((previous) => ({
          open: true,
          items: props.items,
          selected: Math.min(previous.selected, Math.max(props.items.length - 1, 0)),
          rect: positionFrom(props) ?? previous.rect,
          command: props.command,
        })),
      onExit: () => setState(CLOSED),
      onSelect: (command) => command.run(commandContext),
      onKeyDown: ({ event }) => {
        const current = stateRef.current;
        if (!current.open) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (current.items.length === 0) return true;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setState((previous) => ({ ...previous, selected: (previous.selected + delta + previous.items.length) % previous.items.length }));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = current.items[current.selected];
          if (!item) return false;
          event.preventDefault();
          current.command?.(item);
          return true;
        }
        return false;
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, commandContext, positionFrom, stateRef]);

  // Expose the list to assistive technology as the editor's active listbox.
  React.useEffect(() => {
    const dom = editor.view.dom;
    if (!state.open) {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
      return;
    }
    dom.setAttribute("aria-controls", listId);
    const active = state.items[state.selected];
    if (active) dom.setAttribute("aria-activedescendant", `${listId}-${active.id}`);
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [editor, state.open, state.items, state.selected, listId]);

  React.useEffect(() => {
    if (!state.open) return;
    const active = state.items[state.selected];
    if (!active) return;
    listRef.current?.querySelector(`[id="${listId}-${active.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [state.open, state.items, state.selected, listId]);

  const groups = React.useMemo(() => {
    const result: Array<{ group: EditorCommand["group"]; items: Array<{ command: EditorCommand; index: number }> }> = [];
    state.items.forEach((command, index) => {
      const last = result[result.length - 1];
      if (last && last.group === command.group) last.items.push({ command, index });
      else result.push({ group: command.group, items: [{ command, index }] });
    });
    return result;
  }, [state.items]);

  return (
    <Popover open={state.open}>
      <FloatingAnchor rect={state.rect} />
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={() => exitSuggestion(editor.view, slashCommandPluginKey)}
      >
        <div ref={listRef} id={listId} role="listbox" aria-label="Insert block" className="max-h-72 overflow-y-auto overscroll-contain">
          {state.items.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-slate-500">No matching blocks. Keep typing to insert “/” as text.</p>
          ) : (
            groups.map((group) => (
              <div key={group.group} role="group" aria-label={SLASH_GROUP_LABELS[group.group]}>
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{SLASH_GROUP_LABELS[group.group]}</div>
                {group.items.map(({ command, index }) => {
                  const Icon = command.icon;
                  const selected = index === state.selected;
                  return (
                    <div
                      key={command.id}
                      id={`${listId}-${command.id}`}
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-slate-700",
                        selected && "bg-slate-100 text-slate-900",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (!selected) setState((previous) => ({ ...previous, selected: index }));
                      }}
                      onClick={() => state.command?.(command)}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{command.label}</span>
                        <span className="block truncate text-xs text-slate-500">{command.description}</span>
                      </span>
                      {command.shortcut ? <span className="shrink-0 text-[11px] text-slate-400">{formatShortcut(command.shortcut)}</span> : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
