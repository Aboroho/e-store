import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Upload placeholders.
 *
 * While a file is uploading the editor shows a widget at the insertion point. Widgets
 * are decorations, not document nodes, so a document saved mid-upload never contains a
 * half-finished block and undo history stays clean. The React UI for the widget is
 * portalled into the DOM element registered here (see `use-uploads.ts`).
 */

export interface UploadPlaceholderAction {
  add?: { id: string; pos: number; element: HTMLElement };
  remove?: { id: string };
}

export const uploadPlaceholderKey = new PluginKey<DecorationSet>("rteUploadPlaceholder");

export const UploadPlaceholder = Extension.create({
  name: "uploadPlaceholder",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: uploadPlaceholderKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, set: DecorationSet) {
            let next = set.map(tr.mapping, tr.doc);
            const action = tr.getMeta(uploadPlaceholderKey) as UploadPlaceholderAction | undefined;
            if (action?.add) {
              const { id, pos, element } = action.add;
              const widget = Decoration.widget(pos, element, {
                id,
                side: -1,
                stopEvent: () => true,
                ignoreSelection: true,
              });
              next = next.add(tr.doc, [widget]);
            }
            if (action?.remove) {
              const id = action.remove.id;
              next = next.remove(next.find(undefined, undefined, (spec) => spec.id === id));
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return uploadPlaceholderKey.getState(state) ?? null;
          },
        },
      }),
    ];
  },
});

/** Current document position of a placeholder, or null when it was removed. */
export function findUploadPlaceholder(state: EditorState, id: string): number | null {
  const set = uploadPlaceholderKey.getState(state);
  if (!set) return null;
  const found = set.find(undefined, undefined, (spec) => spec.id === id);
  return found.length > 0 && found[0] ? found[0].from : null;
}
