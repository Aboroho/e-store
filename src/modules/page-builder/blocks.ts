import { z } from "zod";

/**
 * Page builder block catalogue.
 *
 * A page document is **validated JSON** describing sections and blocks. The renderer
 * never evaluates anything from the database: it looks the block type up in this
 * registry, validates its props with the schema defined here, and renders the matching
 * React component. An unknown type is rejected on save (and skipped on render).
 *
 * Adding a widget therefore means adding a schema + a renderer entry — never allowing
 * markup, JSX or JavaScript to be stored as content.
 */

export const SPACING = ["none", "xs", "sm", "md", "lg", "xl"] as const;
export const ALIGNMENTS = ["left", "center", "right"] as const;
export const MAX_SECTIONS = 40;
export const MAX_BLOCKS_PER_SECTION = 24;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #0f172a");
const optionalHexColor = hexColor.optional();
const linkHref = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || value.startsWith("/") || /^https?:\/\//.test(value) || /^(mailto|tel):/.test(value), {
    message: "Links must start with /, http(s)://, mailto: or tel:",
  });

/** Responsive overrides available to every block and section. */
export const responsiveSchema = z
  .object({
    hideOnMobile: z.boolean().default(false),
    hideOnTablet: z.boolean().default(false),
    hideOnDesktop: z.boolean().default(false),
    stackOnMobile: z.boolean().default(true),
  })
  .default({ hideOnMobile: false, hideOnTablet: false, hideOnDesktop: false, stackOnMobile: true });

export type Responsive = z.infer<typeof responsiveSchema>;

/** Per-widget definitions. `props` is validated with `propsSchema`. */
export interface BlockDefinition {
  type: string;
  label: string;
  category: "Basic" | "Media" | "Commerce" | "Layout" | "Social";
  description: string;
  /** What the builder canvas shows without running the real renderer. */
  preview: "heading" | "text" | "richtext" | "image" | "button" | "banner" | "products" | "product" | "categories" | "reviews" | "embed" | "spacer" | "divider" | "contact";
  propsSchema: z.ZodTypeAny;
  defaultProps: Record<string, unknown>;
  /** Blocks that need a media asset (kept so the builder can require a picker). */
  mediaFields?: string[];
}

const headingProps = z.object({
  text: z.string().trim().min(1).max(200),
  level: z.enum(["h1", "h2", "h3", "h4"]).default("h2"),
  align: z.enum(ALIGNMENTS).default("left"),
  color: optionalHexColor,
  size: z.enum(["sm", "md", "lg", "xl"]).default("md"),
});

const textProps = z.object({
  text: z.string().trim().max(4000),
  align: z.enum(ALIGNMENTS).default("left"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  color: optionalHexColor,
});

/** Rich text authored with the shared editor; images are media references rendered server-side. */
const richTextProps = z.object({
  content: z.string().trim().max(8000).default(""),
  align: z.enum(ALIGNMENTS).default("left"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  color: optionalHexColor,
});

const imageProps = z.object({
  mediaId: z.string().uuid().nullable().default(null),
  alt: z.string().trim().max(300).default(""),
  href: linkHref.default(""),
  width: z.enum(["full", "half", "third", "auto"]).default("full"),
  rounded: z.enum(["none", "md", "lg", "full"]).default("md"),
});

const buttonProps = z.object({
  label: z.string().trim().min(1).max(60),
  href: linkHref.default("/products"),
  style: z.enum(["primary", "secondary", "outline", "ghost"]).default("primary"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  align: z.enum(ALIGNMENTS).default("left"),
  openInNewTab: z.boolean().default(false),
});

const bannerProps = z.object({
  mediaId: z.string().uuid().nullable().default(null),
  heading: z.string().trim().min(1).max(140),
  subheading: z.string().trim().max(240).default(""),
  ctaLabel: z.string().trim().max(40).default(""),
  ctaHref: linkHref.default("/products"),
  overlay: z.coerce.number().min(0).max(90).default(35),
  textAlign: z.enum(ALIGNMENTS).default("left"),
  textColor: optionalHexColor,
  height: z.enum(["sm", "md", "lg"]).default("md"),
});

const productGridProps = z.object({
  source: z.enum(["featured", "newest", "category", "search"]).default("featured"),
  categoryId: z.string().uuid().nullable().default(null),
  search: z.string().trim().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(12).default(4),
  columns: z.coerce.number().int().min(1).max(4).default(4),
  showPrice: z.boolean().default(true),
  showRating: z.boolean().default(true),
});

const featuredProductProps = z.object({
  productId: z.string().uuid().nullable().default(null),
  layout: z.enum(["image-left", "image-right", "stacked"]).default("image-left"),
  showPrice: z.boolean().default(true),
  ctaLabel: z.string().trim().max(40).default("View product"),
});

const categoriesProps = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
  columns: z.coerce.number().int().min(1).max(4).default(3),
  showCount: z.boolean().default(true),
});

const reviewsProps = z.object({
  productId: z.string().uuid().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(9).default(3),
  minRating: z.coerce.number().int().min(1).max(5).default(4),
});

const embedProps = z.object({
  /** Only YouTube and Vimeo are accepted; the src is rebuilt server-side. */
  provider: z.enum(["youtube", "vimeo"]).default("youtube"),
  videoId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{6,20}$/, "Enter the video id (not the full URL)"),
  title: z.string().trim().max(120).default("Video"),
  aspect: z.enum(["16:9", "4:3", "1:1"]).default("16:9"),
});

const spacerProps = z.object({
  height: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
});

const dividerProps = z.object({
  style: z.enum(["solid", "dashed", "dotted"]).default("solid"),
  color: optionalHexColor,
  width: z.enum(["full", "half", "content"]).default("full"),
});

const contactProps = z.object({
  heading: z.string().trim().max(120).default("Contact us"),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(120).default(""),
  address: z.string().trim().max(240).default(""),
  showHours: z.boolean().default(false),
  hours: z.string().trim().max(120).default(""),
});

export const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    type: "heading",
    label: "Heading",
    category: "Basic",
    description: "Section title or headline.",
    preview: "heading",
    propsSchema: headingProps,
    defaultProps: { text: "New heading", level: "h2", align: "left", size: "md" },
  },
  {
    type: "text",
    label: "Text",
    category: "Basic",
    description: "Paragraphs of plain text (no HTML is stored or rendered).",
    preview: "text",
    propsSchema: textProps,
    defaultProps: { text: "Write something your customers should read.", align: "left", size: "md" },
  },
  {
    type: "richText",
    label: "Rich text",
    category: "Basic",
    description: "Formatted text with images from the shared media library.",
    preview: "richtext",
    propsSchema: richTextProps,
    defaultProps: { content: "", align: "left", size: "md" },
  },
  {
    type: "image",
    label: "Image",
    category: "Media",
    description: "A single image from the media library.",
    preview: "image",
    propsSchema: imageProps,
    defaultProps: { mediaId: null, width: "full", rounded: "md" },
    mediaFields: ["mediaId"],
  },
  {
    type: "banner",
    label: "Banner",
    category: "Media",
    description: "Full-width hero with heading, text and a call to action.",
    preview: "banner",
    propsSchema: bannerProps,
    defaultProps: { heading: "Big news", subheading: "", overlay: 35, textAlign: "left", height: "md", ctaLabel: "", ctaHref: "/products" },
    mediaFields: ["mediaId"],
  },
  {
    type: "button",
    label: "Button",
    category: "Basic",
    description: "Link styled as a button.",
    preview: "button",
    propsSchema: buttonProps,
    defaultProps: { label: "Shop now", href: "/products", style: "primary", size: "md", align: "left" },
  },
  {
    type: "productGrid",
    label: "Product grid",
    category: "Commerce",
    description: "A grid of live products (featured, newest or by category).",
    preview: "products",
    propsSchema: productGridProps,
    defaultProps: { source: "featured", limit: 4, columns: 4, showPrice: true, showRating: true },
  },
  {
    type: "featuredProduct",
    label: "Featured product",
    category: "Commerce",
    description: "One product shown large with its price.",
    preview: "product",
    propsSchema: featuredProductProps,
    defaultProps: { productId: null, layout: "image-left", showPrice: true, ctaLabel: "View product" },
  },
  {
    type: "categories",
    label: "Categories",
    category: "Commerce",
    description: "Category tiles linking into the catalogue.",
    preview: "categories",
    propsSchema: categoriesProps,
    defaultProps: { limit: 6, columns: 3, showCount: true },
  },
  {
    type: "reviews",
    label: "Reviews",
    category: "Social",
    description: "Recent published customer reviews.",
    preview: "reviews",
    propsSchema: reviewsProps,
    defaultProps: { limit: 3, minRating: 4 },
  },
  {
    type: "contact",
    label: "Contact details",
    category: "Social",
    description: "Phone, email and address from your storefront settings.",
    preview: "contact",
    propsSchema: contactProps,
    defaultProps: { heading: "Contact us", showHours: false },
  },
  {
    type: "embed",
    label: "Video",
    category: "Media",
    description: "YouTube or Vimeo video, embedded from the validated provider and id.",
    preview: "embed",
    propsSchema: embedProps,
    defaultProps: { provider: "youtube", videoId: "dQw4w9WgXcQ", title: "Video", aspect: "16:9" },
  },
  { type: "spacer", label: "Spacer", category: "Layout", description: "Vertical space between blocks.", preview: "spacer", propsSchema: spacerProps, defaultProps: { height: "md" } },
  { type: "divider", label: "Divider", category: "Layout", description: "Horizontal rule.", preview: "divider", propsSchema: dividerProps, defaultProps: { style: "solid", width: "full" } },
];

export const BLOCK_TYPES = BLOCK_DEFINITIONS.map((definition) => definition.type);

export function blockDefinition(type: string): BlockDefinition | undefined {
  return BLOCK_DEFINITIONS.find((definition) => definition.type === type);
}

/** Block list grouped for the builder palette. */
export function blocksByCategory(): Array<{ category: string; blocks: BlockDefinition[] }> {
  const groups = new Map<string, BlockDefinition[]>();
  for (const definition of BLOCK_DEFINITIONS) {
    const bucket = groups.get(definition.category) ?? [];
    bucket.push(definition);
    groups.set(definition.category, bucket);
  }
  return [...groups.entries()].map(([category, blocks]) => ({ category, blocks }));
}
