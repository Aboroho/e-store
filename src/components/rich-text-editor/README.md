# Rich text editor

A Notion-style block editor packaged as one self-contained module. Consumers import from
the barrel only; the editing engine (Tiptap / ProseMirror) never leaks outside this folder.

```tsx
import { RichTextEditor, RichTextContent, parseRichText, type RichTextDocument } from "@/components/rich-text-editor";
```

## Using it in a form

The editor owns no business data. The parent keeps the value, persistence and every
external capability:

```tsx
const [value, setValue] = useState<RichTextDocument>(() => parseRichText(product.description));

<RichTextEditor
  id="description"
  name="description"            // hidden input with the serialized document ("" when empty)
  value={value}
  onChange={setValue}
  aria-label="Product description"
  placeholder="Describe the product…"
  onUpload={uploadToMediaLibrary}   // (file, { kind, signal, onProgress }) => Promise<RichTextAsset>
  renderMediaLibrary={({ kind, onSelect }) => <MediaPicker … onSelect={(asset) => onSelect(toRichTextAsset(asset))} />}
/>
```

`src/components/forms/product-editor/sections.tsx` is the reference integration; it
wires the product form to the media library through `src/components/media/media-upload.ts`.

Render stored content anywhere (server components included) with
`<RichTextContent value={parseRichText(stored)} />`. It maps every node to markup here and
never injects HTML.

## Content format

Documents are structured JSON (`RichTextDocument`, a ProseMirror document tree) stored as
a string in the existing text columns:

- `parseRichText(stored)` accepts JSON documents *and* legacy plain text (paragraphs
  separated by blank lines), so existing rows keep working without a migration.
- `serializeRichTextOrEmpty(doc)` returns `""` for empty documents so optional columns stay
  empty; `isRichTextEmpty` and `richTextToPlainText` cover validation and previews.
- Blocks a narrower configuration does not support (e.g. tables when `features.table` is
  off) are unwrapped to their text instead of being dropped.

## Props worth knowing

| Prop | Purpose |
| --- | --- |
| `value` / `defaultValue` / `onChange` | Controlled or uncontrolled document. |
| `editable`, `disabled` | Read-only view (no tools) vs. muted disabled state. |
| `toolbar` | `false`, or `{ items: [...] }` to restrict the fixed toolbar. |
| `bubbleMenu`, `slashCommands` | Contextual selection menu and the `/` command palette. |
| `features` | Switch block types off (`{ table: false, codeBlock: false }`). |
| `minHeight`, `maxHeight`, `expandable` | Writing-area sizing, internal scrolling and full-screen mode. |
| `maxLength` | Character limit with a live counter. |
| `onUpload`, `maxFileSize`, `acceptedFileTypes` | Upload capability injected by the parent; nothing here knows about storage or endpoints. |
| `renderMediaLibrary` | Render prop that embeds the application's picker in the insert dialog. |
| `name`, `id`, `aria-*` | Form and accessibility plumbing. |

Throw `RichTextUploadError("message")` from an upload handler when the message is safe
to show; any other error is reported generically and can be retried.

## Structure

```
rich-text-editor.tsx      component shell (state, controlled value, uploads, expanded mode)
rich-text-content.tsx     read-only renderer (no editor dependency)
serialization.ts          parse / serialize / plain-text helpers
types.ts                  public contract
blocks/                   schema: feature flags, custom nodes (image, file, upload placeholder), slash-command plugin
internal/commands.ts      single command registry feeding toolbar, bubble menu and slash menu
internal/*                toolbar, menus, link editor, media dialog, upload state, small Radix wrappers
rich-text-editor.css      scoped typography and editor state styles (`.rte-content`)
```

Adding a block: register the extension in `blocks/index.ts` behind a feature flag, add a
command in `internal/commands.ts` (it appears in every menu automatically) and a render
case in `rich-text-content.tsx`.
