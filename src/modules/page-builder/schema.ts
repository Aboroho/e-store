import { z } from "zod";
import { BLOCK_TYPES, MAX_BLOCKS_PER_SECTION, MAX_SECTIONS, SPACING, ALIGNMENTS, blockDefinition, responsiveSchema } from "./blocks";
import { extractRichTextMediaIds } from "@/modules/media/rich-text-shared";

/**
 * Page document schema.
 *
 * The document is the only thing stored for a page version. It is validated on save,
 * on publish and again on render, so a hand-edited database row still cannot smuggle
 * an unknown block or an unexpected prop into the renderer.
 */

const blockSchema = z
  .object({
    id: z.string().min(1).max(60),
    type: z.enum(BLOCK_TYPES as [string, ...string[]]),
    props: z.record(z.string(), z.unknown()).default({}),
    responsive: responsiveSchema,
    /** Column index inside the section layout (0-based). */
    column: z.coerce.number().int().min(0).max(3).default(0),
  })
  .superRefine((block, ctx) => {
    const definition = blockDefinition(block.type);
    if (!definition) {
      ctx.addIssue({ code: "custom", path: ["type"], message: `"${block.type}" is not a registered block` });
      return;
    }
    const parsed = definition.propsSchema.safeParse(block.props);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", path: ["props", ...issue.path], message: issue.message });
      }
      return;
    }
    // Store the coerced/defaulted props so renderers never have to guess.
    block.props = parsed.data as Record<string, unknown>;
  });

const sectionSchema = z.object({
  id: z.string().min(1).max(60),
  layout: z
    .object({
      columns: z.coerce.number().int().min(1).max(4).default(1),
      gap: z.enum(["none", "sm", "md", "lg"]).default("md"),
    })
    .default({ columns: 1, gap: "md" }),
  padding: z
    .object({
      top: z.enum(SPACING).default("md"),
      bottom: z.enum(SPACING).default("md"),
      horizontal: z.enum(SPACING).default("md"),
    })
    .default({ top: "md", bottom: "md", horizontal: "md" }),
  background: z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      mediaId: z.string().uuid().nullable().default(null),
      overlay: z.coerce.number().min(0).max(95).default(0),
    })
    .default({ mediaId: null, overlay: 0 }),
  align: z.enum(ALIGNMENTS).default("left"),
  container: z.enum(["full", "boxed", "narrow"]).default("boxed"),
  responsive: responsiveSchema,
  blocks: z.array(blockSchema).max(MAX_BLOCKS_PER_SECTION).default([]),
});

export const pageDocumentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Optional per-page theme overrides; validated, never free-form CSS. */
  theme: z
    .object({
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      textColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      backgroundColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
    })
    .default({}),
  sections: z.array(sectionSchema).max(MAX_SECTIONS).default([]),
});

export type PageDocument = z.infer<typeof pageDocumentSchema>;
export type PageSection = z.infer<typeof sectionSchema>;
export type PageBlock = z.infer<typeof blockSchema>;

export const emptyDocument = (): PageDocument => pageDocumentSchema.parse({ sections: [] });

/** Parse (and reject) an arbitrary value as a page document. */
export function parsePageDocument(input: unknown): PageDocument {
  return pageDocumentSchema.parse(input);
}

/** Safe variant used by the renderer: never throws, drops what it cannot trust. */
export function safePageDocument(input: unknown): PageDocument {
  const parsed = pageDocumentSchema.safeParse(input);
  return parsed.success ? parsed.data : emptyDocument();
}

/** Every media id referenced anywhere in a document (used for validation + usage rows). */
export function documentMediaIds(document: PageDocument): string[] {
  const ids = new Set<string>();
  for (const section of document.sections) {
    if (section.background.mediaId) ids.add(section.background.mediaId);
    for (const block of section.blocks) {
      for (const [key, value] of Object.entries(block.props)) {
        if (typeof value === "string" && /mediaid$/i.test(key) && /^[0-9a-f-]{36}$/i.test(value)) ids.add(value);
      }
      // Rich-text blocks embed image references inside their HTML content.
      if (block.type === "richText" && typeof block.props.content === "string") {
        for (const id of extractRichTextMediaIds(block.props.content)) ids.add(id);
      }
    }
  }
  return [...ids];
}

/** Count of blocks, stored on the version row for quick listing. */
export function documentBlockCount(document: PageDocument): number {
  return document.sections.reduce((total, section) => total + section.blocks.length, 0);
}
