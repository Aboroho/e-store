"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea } from "@/components/ui/primitives";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { MediaPicker } from "@/components/media/media-picker";
import { BLOCK_DEFINITIONS, blockDefinition, blocksByCategory } from "@/modules/page-builder/blocks";
import { SECTION_FIELDS, fieldsFor, type FieldSpec } from "@/modules/page-builder/fields";
import { publishPageAction, saveDraftAction } from "@/modules/page-builder/actions";
import type { PageDocument, PageSection } from "@/modules/page-builder/schema";

/**
 * Page builder canvas.
 *
 * The document is plain JSON the whole way through: the palette inserts a registered
 * block type with its default props, the inspector edits props, and save/publish send
 * the document to the server where it is validated against the block schemas. The
 * canvas itself only draws lightweight previews — the real, trusted rendering happens
 * on the server (see `components/page-builder/block-renderer.tsx`).
 */

export interface BuilderPage {
  id: string;
  title: string;
  slug: string;
  status: string;
  isHomepage: boolean;
  storefrontId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  updatedAt: string;
  publishedAt: string | null;
}

export interface BuilderVersion {
  id: string;
  version: number;
  status: string;
  note: string | null;
  createdAt: string;
  isCurrentDraft: boolean;
  isPublished: boolean;
}

interface BuilderProps {
  page: BuilderPage;
  document: PageDocument;
  versions: BuilderVersion[];
  storefronts: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  previewUrl: string;
}

type Device = "desktop" | "tablet" | "mobile";

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), source);
}

function writePath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const clone: Record<string, unknown> = { ...source };
  if (rest.length === 0) {
    clone[head!] = value;
    return clone;
  }
  const child = (clone[head!] as Record<string, unknown> | undefined) ?? {};
  clone[head!] = writePath(child, rest.join("."), value);
  return clone;
}

export function PageBuilder(props: BuilderProps) {
  const router = useRouter();
  const [document, setDocument] = React.useState<PageDocument>(props.document);
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = React.useState<string | null>(props.document.sections[0]?.id ?? null);
  const [device, setDevice] = React.useState<Device>("desktop");
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const update = React.useCallback((mutate: (draft: PageDocument) => PageDocument) => {
    setDocument((current) => mutate(current));
    setDirty(true);
  }, []);

  const selectedSection = document.sections.find((section) => section.id === selectedSectionId) ?? null;
  const selectedBlock = document.sections.flatMap((section) => section.blocks).find((block) => block.id === selectedBlockId) ?? null;

  // --------------------------------------------------------------- operations

  const addSection = () => {
    const section: PageSection = {
      id: newId("section"),
      layout: { columns: 1, gap: "md" },
      padding: { top: "md", bottom: "md", horizontal: "md" },
      background: { mediaId: null, overlay: 0 },
      align: "left",
      container: "boxed",
      responsive: { hideOnMobile: false, hideOnTablet: false, hideOnDesktop: false, stackOnMobile: true },
      blocks: [],
    };
    update((current) => ({ ...current, sections: [...current.sections, section] }));
    setSelectedSectionId(section.id);
  };

  const insertBlock = (type: string, sectionId: string, column: number, index?: number) => {
    const definition = blockDefinition(type);
    if (!definition) return;
    update((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const block = {
          id: newId("block"),
          type,
          props: { ...definition.defaultProps },
          responsive: { hideOnMobile: false, hideOnTablet: false, hideOnDesktop: false, stackOnMobile: true },
          column,
        };
        const blocks = [...section.blocks];
        if (index === undefined) blocks.push(block);
        else blocks.splice(index, 0, block);
        const nextSection = { ...section, blocks };
        return nextSection;
      }),
    }));
  };

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Palette → canvas: `new:{type}` dropped onto `drop:{sectionId}:{column}`.
    if (activeId.startsWith("new:")) {
      const type = activeId.slice(4);
      if (overId.startsWith("drop:")) {
        const [, sectionId, column] = overId.split(":");
        insertBlock(type, sectionId!, Number(column ?? 0));
      } else if (overId.startsWith("block:")) {
        const targetBlockId = overId.slice(6);
        const location = findBlockLocation(document, targetBlockId);
        if (location) insertBlock(type, location.sectionId, location.column, location.index + 1);
      }
      return;
    }

    // Reorder sections.
    if (activeId.startsWith("section-drag:") && overId.startsWith("section-drag:")) {
      const from = document.sections.findIndex((section) => section.id === activeId.slice(13));
      const to = document.sections.findIndex((section) => section.id === overId.slice(13));
      if (from >= 0 && to >= 0 && from !== to) update((current) => ({ ...current, sections: arrayMove(current.sections, from, to) }));
      return;
    }

    // Reorder / move blocks.
    if (activeId.startsWith("block-drag:")) {
      const movingId = activeId.slice(11);
      const source = findBlockLocation(document, movingId);
      if (!source) return;
      if (overId.startsWith("block:")) {
        const targetId = overId.slice(6);
        const target = findBlockLocation(document, targetId);
        if (!target) return;
        update((current) => moveBlock(current, movingId, target.sectionId, target.column, target.index));
      } else if (overId.startsWith("drop:")) {
        const [, sectionId, column] = overId.split(":");
        update((current) => moveBlock(current, movingId, sectionId!, Number(column ?? 0), Number.MAX_SAFE_INTEGER));
      }
    }
  };

  const removeBlock = (blockId: string) => {
    update((current) => ({
      ...current,
      sections: current.sections.map((section) => ({ ...section, blocks: section.blocks.filter((block) => block.id !== blockId) })),
    }));
    if (selectedBlockId === blockId) setSelectedBlockId(null);
  };

  const duplicateBlock = (blockId: string) => {
    update((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        const index = section.blocks.findIndex((block) => block.id === blockId);
        if (index < 0) return section;
        const source = section.blocks[index]!;
        const copy = { ...source, id: newId("block"), props: { ...source.props } };
        const blocks = [...section.blocks];
        blocks.splice(index + 1, 0, copy);
        return { ...section, blocks };
      }),
    }));
  };

  const save = async () => {
    setSaving(true);
    const result = await saveDraftAction({ pageId: props.page.id, document, note: "Saved from the builder" });
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setMessage({ tone: "success", text: `Draft v${result.version} saved` });
      router.refresh();
    } else {
      setMessage({ tone: "danger", text: result.message });
    }
  };

  const publish = async () => {
    setSaving(true);
    const result = await publishPageAction({ pageId: props.page.id, document });
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setMessage({ tone: "success", text: `Published at ${new Date(result.publishedAt).toLocaleString()}` });
      router.refresh();
    } else {
      setMessage({ tone: "danger", text: result.message });
    }
  };

  const canvasWidth = device === "desktop" ? "w-full" : device === "tablet" ? "w-[768px] max-w-full" : "w-[390px] max-w-full";

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr_300px]">
        {/* ------------------------------------------------------------ palette */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Widgets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {blocksByCategory().map((group) => (
                <div key={group.category}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.category}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {group.blocks.map((definition) => (
                      <PaletteItem key={definition.type} type={definition.type} label={definition.label} description={definition.description} />
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-slate-500">Drag a widget into a section, or click it to add it to the selected section.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Sections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={addSection}>
                + Add section
              </Button>
              <SortableContext items={document.sections.map((section) => `section-drag:${section.id}`)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1 text-xs">
                  {document.sections.map((section, index) => (
                    <SortableSection
                      key={section.id}
                      id={section.id}
                      index={index}
                      label={`Section ${index + 1} · ${section.blocks.length} block${section.blocks.length === 1 ? "" : "s"}`}
                      selected={section.id === selectedSectionId}
                      onSelect={() => {
                        setSelectedSectionId(section.id);
                        setSelectedBlockId(null);
                      }}
                      onRemove={() =>
                        update((current) => ({ ...current, sections: current.sections.filter((candidate) => candidate.id !== section.id) }))
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Version history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {props.versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <span>
                    v{version.version}{" "}
                    {version.isPublished ? <Badge variant="success">live</Badge> : version.isCurrentDraft ? <Badge variant="warning">draft</Badge> : null}
                  </span>
                  <Link href={`/admin/pages/${props.page.id}/builder?version=${version.id}`} className="text-indigo-600 hover:underline">
                    open
                  </Link>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------- canvas */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              {(["desktop", "tablet", "mobile"] as Device[]).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setDevice(candidate)}
                  className={`rounded px-3 py-1 text-xs capitalize ${device === candidate ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {candidate}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : dirty ? "Save draft *" : "Save draft"}
            </Button>
            <Button type="button" size="sm" onClick={() => void publish()} disabled={saving}>
              Publish
            </Button>
            <a href={props.previewUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
              Preview in a new tab ↗
            </a>
            {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
          </div>

          {message ? <Alert variant={message.tone}>{message.text}</Alert> : null}

          <div className="overflow-x-auto rounded-lg bg-slate-100 p-4">
            <div className={`mx-auto space-y-3 ${canvasWidth}`}>
              {document.sections.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
                  Add a section to start building this page.
                </div>
              ) : null}

              {document.sections.map((section, sectionIndex) => (
                <CanvasSection
                  key={section.id}
                  section={section}
                  index={sectionIndex}
                  selected={section.id === selectedSectionId}
                  selectedBlockId={selectedBlockId}
                  onSelectSection={() => {
                    setSelectedSectionId(section.id);
                    setSelectedBlockId(null);
                  }}
                  onSelectBlock={(blockId) => setSelectedBlockId(blockId)}
                  onRemoveBlock={removeBlock}
                  onDuplicateBlock={duplicateBlock}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- inspector */}
        <div className="space-y-3">
          {selectedBlock ? (
            <BlockInspector
              blockId={selectedBlock.id}
              type={selectedBlock.type}
              props={selectedBlock.props}
              responsive={selectedBlock.responsive}
              products={props.products}
              categories={props.categories}
              onChange={(path, value) =>
                update((current) => ({
                  ...current,
                  sections: current.sections.map((section) => ({
                    ...section,
                    blocks: section.blocks.map((block) => (block.id === selectedBlock.id ? { ...block, props: writePath(block.props, path, value) } : block)),
                  })),
                }))
              }
              onResponsive={(patch) =>
                update((current) => ({
                  ...current,
                  sections: current.sections.map((section) => ({
                    ...section,
                    blocks: section.blocks.map((block) => (block.id === selectedBlock.id ? { ...block, responsive: { ...block.responsive, ...patch } } : block)),
                  })),
                }))
              }
              onColumn={(column) =>
                update((current) => ({
                  ...current,
                  sections: current.sections.map((section) => ({
                    ...section,
                    blocks: section.blocks.map((block) => (block.id === selectedBlock.id ? { ...block, column } : block)),
                  })),
                }))
              }
            />
          ) : selectedSection ? (
            <SectionInspector
              section={selectedSection}
              onChange={(path, value) =>
                update((current) => ({
                  ...current,
                  sections: current.sections.map((section) => (section.id === selectedSection.id ? (writePath(section as unknown as Record<string, unknown>, path, value) as unknown as PageSection) : section)),
                }))
              }
              onResponsive={(patch) =>
                update((current) => ({
                  ...current,
                  sections: current.sections.map((section) => (section.id === selectedSection.id ? { ...section, responsive: { ...section.responsive, ...patch } } : section)),
                }))
              }
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-slate-500">Select a section or a widget to edit its settings.</CardContent>
            </Card>
          )}
        </div>
      </div>

      <DragOverlay>
        {dragging ? (
          <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-lg">
            {dragging.startsWith("new:") ? `Add ${blockDefinition(dragging.slice(4))?.label ?? "widget"}` : "Move"}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function findBlockLocation(document: PageDocument, blockId: string) {
  for (const section of document.sections) {
    const index = section.blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) return { sectionId: section.id, column: section.blocks[index]!.column, index };
  }
  return null;
}

function moveBlock(document: PageDocument, blockId: string, targetSectionId: string, targetColumn: number, targetIndex: number): PageDocument {
  const source = findBlockLocation(document, blockId);
  if (!source) return document;
  const block = document.sections.find((section) => section.id === source.sectionId)!.blocks[source.index]!;

  const without = document.sections.map((section) => ({ ...section, blocks: section.blocks.filter((candidate) => candidate.id !== blockId) }));
  return {
    ...document,
    sections: without.map((section) => {
      if (section.id !== targetSectionId) return section;
      const blocks = [...section.blocks];
      const index = Math.min(targetIndex, blocks.length);
      blocks.splice(index, 0, { ...block, column: targetColumn });
      return { ...section, blocks };
    }),
  };
}

function PaletteItem({ type, label, description }: { type: string; label: string; description: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `new:${type}`, data: { type } });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      title={description}
      className={`cursor-grab rounded border px-2 py-1.5 text-left text-[11px] hover:border-indigo-400 hover:bg-indigo-50 ${isDragging ? "opacity-40" : ""}`}
    >
      {label}
    </button>
  );
}

function SortableSection({
  id,
  index,
  label,
  selected,
  onSelect,
  onRemove,
}: {
  id: string;
  index: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `section-drag:${id}` });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-1 rounded border px-2 py-1 ${selected ? "border-indigo-400 bg-indigo-50" : ""}`}>
      <span {...attributes} {...listeners} className="cursor-grab text-slate-400" aria-label={`Reorder ${label}`}>
        ⋮⋮
      </span>
      <button type="button" className="flex-1 text-left" onClick={onSelect}>
        {label}
      </button>
      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={onRemove} aria-label={`Remove section ${index + 1}`}>
        ✕
      </button>
    </li>
  );
}

function CanvasSection({
  section,
  index,
  selected,
  selectedBlockId,
  onSelectSection,
  onSelectBlock,
  onRemoveBlock,
  onDuplicateBlock,
}: {
  section: PageSection;
  index: number;
  selected: boolean;
  selectedBlockId: string | null;
  onSelectSection: () => void;
  onSelectBlock: (blockId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  onDuplicateBlock: (blockId: string) => void;
}) {
  const columns = Math.min(4, Math.max(1, section.layout.columns));
  return (
    <div
      className={`rounded-lg border-2 bg-white p-3 ${selected ? "border-indigo-400" : "border-transparent"}`}
      style={section.background.color ? { backgroundColor: section.background.color } : undefined}
      onClick={onSelectSection}
    >
      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>Section {index + 1}</span>
        <span>
          {columns} column{columns === 1 ? "" : "s"} · {section.blocks.length} block{section.blocks.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, column) => {
          const blocks = section.blocks.filter((block) => Math.min(columns - 1, block.column) === column);
          return (
            <DropColumn key={column} sectionId={section.id} column={column}>
              <SortableContext items={blocks.map((block) => `block-drag:${block.id}`)} strategy={verticalListSortingStrategy}>
                {blocks.map((block) => (
                  <CanvasBlock
                    key={block.id}
                    id={block.id}
                    type={block.type}
                    props={block.props}
                    selected={block.id === selectedBlockId}
                    onSelect={() => onSelectBlock(block.id)}
                    onRemove={() => onRemoveBlock(block.id)}
                    onDuplicate={() => onDuplicateBlock(block.id)}
                  />
                ))}
              </SortableContext>
              {blocks.length === 0 ? <p className="rounded border border-dashed border-slate-300 px-2 py-4 text-center text-[11px] text-slate-400">Drop a widget here</p> : null}
            </DropColumn>
          );
        })}
      </div>
    </div>
  );
}

function DropColumn({ sectionId, column, children }: { sectionId: string; column: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${sectionId}:${column}` });
  return (
    <div ref={setNodeRef} className={`space-y-2 rounded ${isOver ? "bg-indigo-50 ring-1 ring-indigo-300" : ""}`}>
      {children}
    </div>
  );
}

function CanvasBlock({
  id,
  type,
  props,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  id: string;
  type: string;
  props: Record<string, unknown>;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `block-drag:${id}` });
  const definition = blockDefinition(type);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      id={`block:${id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={`rounded border bg-white p-2 ${selected ? "border-indigo-500 ring-1 ring-indigo-300" : "border-slate-200"}`}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
        <span {...attributes} {...listeners} className="cursor-grab">
          {definition?.label ?? type}
        </span>
        <span className="flex gap-1">
          <button type="button" className="hover:text-slate-700" onClick={(event) => { event.stopPropagation(); onDuplicate(); }} aria-label="Duplicate widget">
            ⧉
          </button>
          <button type="button" className="hover:text-rose-600" onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label="Remove widget">
            ✕
          </button>
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-700">{previewText(type, props)}</div>
    </div>
  );
}

/** Deliberately simple canvas text — the trusted renderer draws the real thing. */
function previewText(type: string, props: Record<string, unknown>): string {
  switch (type) {
    case "heading":
    case "banner":
      return String(props.text ?? props.heading ?? "Heading");
    case "text":
      return String(props.text ?? "").slice(0, 120) || "Text block";
    case "image":
      return props.mediaId ? "Image selected" : "No image selected";
    case "button":
      return `${String(props.label ?? "Button")} → ${String(props.href ?? "")}`;
    case "productGrid":
      return `Product grid · ${String(props.source ?? "featured")} · ${String(props.limit ?? 4)} items`;
    case "featuredProduct":
      return props.productId ? "Featured product selected" : "Pick a product";
    case "categories":
      return `Categories · up to ${String(props.limit ?? 6)}`;
    case "reviews":
      return `Reviews · minimum ${String(props.minRating ?? 4)}★ · ${String(props.limit ?? 3)}`;
    case "contact":
      return String(props.heading ?? "Contact details");
    case "embed":
      return `${String(props.provider ?? "youtube")} video ${String(props.videoId ?? "")}`;
    case "spacer":
      return `Spacer (${String(props.height ?? "md")})`;
    case "divider":
      return "Divider";
    default:
      return type;
  }
}

function Field({
  spec,
  value,
  onChange,
  products,
  categories,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  products: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}) {
  const id = `field-${spec.name}`;

  if (spec.kind === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        {spec.label}
      </label>
    );
  }

  if (spec.kind === "media") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">{spec.label}</Label>
        <div className="flex items-center gap-2">
          <MediaPicker
            mimeGroup={spec.mimeGroup ?? "image"}
            trigger={<Button type="button" variant="outline" size="sm">{value ? "Change media" : "Choose media"}</Button>}
            onSelect={(asset) => onChange(asset.id)}
          />
          {value ? (
            <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => onChange(null)}>
              clear
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (spec.kind === "product") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        <NativeSelect id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">— none —</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    );
  }

  if (spec.kind === "category") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        <NativeSelect id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">— none —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    );
  }

  if (spec.kind === "select") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        <NativeSelect id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {spec.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        {spec.help ? <p className="text-[11px] text-slate-500">{spec.help}</p> : null}
      </div>
    );
  }

  if (spec.kind === "textarea") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        {spec.name === "text" ? <RichTextEditor id={id} value={String(value ?? "")} onChange={onChange} maxLength={4000} /> : <Textarea id={id} rows={4} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />}
        {spec.help ? <p className="text-[11px] text-slate-500">{spec.help}</p> : null}
      </div>
    );
  }

  if (spec.kind === "color") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={typeof value === "string" && value ? value : "#0f172a"}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 w-10 rounded border"
          />
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => onChange(undefined)}>
            inherit
          </button>
        </div>
      </div>
    );
  }

  if (spec.kind === "number") {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {spec.label}
        </Label>
        <Input
          id={id}
          type="number"
          min={spec.min}
          max={spec.max}
          value={Number(value ?? 0)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {spec.label}
      </Label>
      <Input id={id} value={String(value ?? "")} placeholder={spec.placeholder} onChange={(event) => onChange(event.target.value)} />
      {spec.help ? <p className="text-[11px] text-slate-500">{spec.help}</p> : null}
    </div>
  );
}

function ResponsiveControls({
  responsive,
  onChange,
}: {
  responsive: { hideOnMobile: boolean; hideOnTablet: boolean; hideOnDesktop: boolean; stackOnMobile: boolean };
  onChange: (patch: Partial<typeof responsive>) => void;
}) {
  return (
    <div className="space-y-1 border-t pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Responsive</p>
      {(
        [
          ["hideOnMobile", "Hide on mobile"],
          ["hideOnTablet", "Hide on tablet"],
          ["hideOnDesktop", "Hide on desktop"],
          ["stackOnMobile", "Stack columns on mobile"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={responsive[key]} onChange={(event) => onChange({ [key]: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
          {label}
        </label>
      ))}
    </div>
  );
}

function BlockInspector({
  blockId,
  type,
  props,
  responsive,
  products,
  categories,
  onChange,
  onResponsive,
  onColumn,
}: {
  blockId: string;
  type: string;
  props: Record<string, unknown>;
  responsive: { hideOnMobile: boolean; hideOnTablet: boolean; hideOnDesktop: boolean; stackOnMobile: boolean };
  products: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  onChange: (path: string, value: unknown) => void;
  onResponsive: (patch: Partial<typeof responsive>) => void;
  onColumn: (column: number) => void;
}) {
  const definition = blockDefinition(type);
  const fields = fieldsFor(type);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{definition?.label ?? type}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-slate-500">{definition?.description}</p>
        <p className="text-[11px] text-slate-400">id: {blockId}</p>
        {fields.map((spec) => (
          <Field key={spec.name} spec={spec} value={readPath(props, spec.name)} onChange={(value) => onChange(spec.name, value)} products={products} categories={categories} />
        ))}
        <div className="space-y-1 border-t pt-2">
          <Label className="text-xs">Column in this section</Label>
          <NativeSelect value={String((props.__column as number | undefined) ?? 0)} onChange={(event) => onColumn(Number(event.target.value))}>
            {[0, 1, 2, 3].map((column) => (
              <option key={column} value={column}>
                Column {column + 1}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ResponsiveControls responsive={responsive} onChange={onResponsive} />
      </CardContent>
    </Card>
  );
}

function SectionInspector({
  section,
  onChange,
  onResponsive,
}: {
  section: PageSection;
  onChange: (path: string, value: unknown) => void;
  onResponsive: (patch: Partial<PageSection["responsive"]>) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Section settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {SECTION_FIELDS.map((spec) => (
          <Field
            key={spec.name}
            spec={spec}
            value={readPath(section as unknown as Record<string, unknown>, spec.name)}
            onChange={(value) => onChange(spec.name, value)}
            products={[]}
            categories={[]}
          />
        ))}
        <ResponsiveControls responsive={section.responsive} onChange={onResponsive} />
      </CardContent>
    </Card>
  );
}

/** Small helper exported for the page list screen (kept here so the list stays a server component). */
export function VersionBadge({ status }: { status: string }) {
  return <Badge variant={status === "PUBLISHED" ? "success" : status === "DRAFT" ? "warning" : "neutral"}>{status.toLowerCase()}</Badge>;
}

export { BLOCK_DEFINITIONS };
