import { Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import type { EditorCommand } from "../internal/commands";

/**
 * Notion style `/` menu.
 *
 * The extension only detects the trigger and forwards the query, position and keyboard
 * events to a controller implemented by the React layer (`slash-command-menu.tsx`). The
 * list of commands comes from the shared registry, so new blocks appear automatically.
 */

export type SlashSuggestionProps = SuggestionProps<EditorCommand, EditorCommand>;

export interface SlashCommandController {
  getItems: (query: string) => EditorCommand[];
  onStart: (props: SlashSuggestionProps) => void;
  onUpdate: (props: SlashSuggestionProps) => void;
  onExit: () => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onSelect: (command: EditorCommand, range: Range) => void;
}

export interface SlashCommandOptions {
  controller: SlashCommandController;
}

export const slashCommandPluginKey = new PluginKey("rteSlashCommand");

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      controller: {
        getItems: () => [],
        onStart: () => undefined,
        onUpdate: () => undefined,
        onExit: () => undefined,
        onKeyDown: () => false,
        onSelect: () => undefined,
      },
    };
  },

  addProseMirrorPlugins() {
    const { controller } = this.options;
    return [
      Suggestion<EditorCommand, EditorCommand>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        allow: ({ editor, state }) => {
          // Slash commands make no sense inside code, and never in read-only mode.
          if (!editor.isEditable) return false;
          const { $from } = state.selection;
          return $from.parent.type.name !== "codeBlock";
        },
        items: ({ query }) => controller.getItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          controller.onSelect(props, range);
        },
        render: () => ({
          onStart: (props) => controller.onStart(props),
          onUpdate: (props) => controller.onUpdate(props),
          onExit: () => controller.onExit(),
          onKeyDown: (props) => controller.onKeyDown(props),
        }),
      }),
    ];
  },
});
