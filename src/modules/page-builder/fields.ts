import { BLOCK_DEFINITIONS } from "./blocks";

/**
 * Inspector field descriptors.
 *
 * The builder needs to render a form for each block's props. Rather than reflecting
 * over Zod (which would let a schema change silently alter the UI), each block declares
 * its controls here: the field list is explicit, typed and safe to send to the client.
 */

export type FieldKind = "text" | "textarea" | "richtext" | "number" | "select" | "checkbox" | "color" | "media" | "product" | "category" | "link";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  help?: string;
  placeholder?: string;
}

const align = (): FieldSpec => ({
  name: "align",
  label: "Alignment",
  kind: "select",
  options: [
    { value: "left", label: "Left" },
    { value: "center", label: "Centre" },
    { value: "right", label: "Right" },
  ],
});

export const BLOCK_FIELDS: Record<string, FieldSpec[]> = {
  heading: [
    { name: "text", label: "Text", kind: "text" },
    {
      name: "level",
      label: "Heading level",
      kind: "select",
      options: [
        { value: "h1", label: "H1 (page title)" },
        { value: "h2", label: "H2" },
        { value: "h3", label: "H3" },
        { value: "h4", label: "H4" },
      ],
      help: "Use one H1 per page for search engines.",
    },
    {
      name: "size",
      label: "Size",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
        { value: "xl", label: "Extra large" },
      ],
    },
    align(),
    { name: "color", label: "Colour", kind: "color" },
  ],
  richText: [
    { name: "content", label: "Content", kind: "richtext", help: "Formatting and images from the shared media library." },
    {
      name: "size",
      label: "Size",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    align(),
    { name: "color", label: "Colour", kind: "color" },
  ],
  text: [
    { name: "text", label: "Text", kind: "textarea", help: "Blank lines create paragraphs. HTML is not rendered." },
    {
      name: "size",
      label: "Size",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    align(),
    { name: "color", label: "Colour", kind: "color" },
  ],
  image: [
    { name: "mediaId", label: "Image", kind: "media" },
    { name: "alt", label: "Alt text", kind: "text", help: "Describe the image for screen readers." },
    { name: "href", label: "Link (optional)", kind: "link" },
    {
      name: "width",
      label: "Width",
      kind: "select",
      options: [
        { value: "full", label: "Full" },
        { value: "half", label: "Half" },
        { value: "third", label: "One third" },
        { value: "auto", label: "Natural size" },
      ],
    },
    {
      name: "rounded",
      label: "Corners",
      kind: "select",
      options: [
        { value: "none", label: "Square" },
        { value: "md", label: "Rounded" },
        { value: "lg", label: "Extra rounded" },
        { value: "full", label: "Circle" },
      ],
    },
  ],
  banner: [
    { name: "mediaId", label: "Background image", kind: "media" },
    { name: "heading", label: "Heading", kind: "text" },
    { name: "subheading", label: "Subheading", kind: "text" },
    { name: "ctaLabel", label: "Button label", kind: "text" },
    { name: "ctaHref", label: "Button link", kind: "link" },
    { name: "overlay", label: "Dark overlay (%)", kind: "number", min: 0, max: 90 },
    {
      name: "height",
      label: "Height",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    { name: "textAlign", label: "Text alignment", kind: "select", options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Centre" },
      { value: "right", label: "Right" },
    ] },
    { name: "textColor", label: "Text colour", kind: "color" },
  ],
  button: [
    { name: "label", label: "Label", kind: "text" },
    { name: "href", label: "Link", kind: "link" },
    {
      name: "style",
      label: "Style",
      kind: "select",
      options: [
        { value: "primary", label: "Primary" },
        { value: "secondary", label: "Dark" },
        { value: "outline", label: "Outline" },
        { value: "ghost", label: "Text only" },
      ],
    },
    {
      name: "size",
      label: "Size",
      kind: "select",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
    },
    align(),
    { name: "openInNewTab", label: "Open in a new tab", kind: "checkbox" },
  ],
  productGrid: [
    {
      name: "source",
      label: "Products from",
      kind: "select",
      options: [
        { value: "featured", label: "Featured products" },
        { value: "newest", label: "Newest products" },
        { value: "category", label: "A category" },
        { value: "search", label: "A search term" },
      ],
    },
    { name: "categoryId", label: "Category", kind: "category" },
    { name: "search", label: "Search term", kind: "text" },
    { name: "limit", label: "How many", kind: "number", min: 1, max: 12 },
    { name: "columns", label: "Columns", kind: "number", min: 1, max: 4 },
    { name: "showPrice", label: "Show price", kind: "checkbox" },
    { name: "showRating", label: "Show rating", kind: "checkbox" },
  ],
  featuredProduct: [
    { name: "productId", label: "Product", kind: "product" },
    {
      name: "layout",
      label: "Layout",
      kind: "select",
      options: [
        { value: "image-left", label: "Image left" },
        { value: "image-right", label: "Image right" },
        { value: "stacked", label: "Stacked" },
      ],
    },
    { name: "ctaLabel", label: "Button label", kind: "text" },
    { name: "showPrice", label: "Show price", kind: "checkbox" },
  ],
  categories: [
    { name: "limit", label: "How many", kind: "number", min: 1, max: 12 },
    { name: "columns", label: "Columns", kind: "number", min: 1, max: 4 },
    { name: "showCount", label: "Show product count", kind: "checkbox" },
  ],
  reviews: [
    { name: "productId", label: "Specific product (optional)", kind: "product" },
    { name: "minRating", label: "Minimum rating", kind: "number", min: 1, max: 5 },
    { name: "limit", label: "How many", kind: "number", min: 1, max: 9 },
  ],
  contact: [
    { name: "heading", label: "Heading", kind: "text" },
    { name: "phone", label: "Phone", kind: "text" },
    { name: "email", label: "Email", kind: "text" },
    { name: "address", label: "Address", kind: "text" },
    { name: "showHours", label: "Show opening hours", kind: "checkbox" },
    { name: "hours", label: "Opening hours", kind: "text" },
  ],
  embed: [
    {
      name: "provider",
      label: "Provider",
      kind: "select",
      options: [
        { value: "youtube", label: "YouTube" },
        { value: "vimeo", label: "Vimeo" },
      ],
      help: "Only the video id is stored; the embed URL is built by the server.",
    },
    { name: "videoId", label: "Video id", kind: "text", placeholder: "dQw4w9WgXcQ" },
    { name: "title", label: "Title", kind: "text" },
    {
      name: "aspect",
      label: "Aspect ratio",
      kind: "select",
      options: [
        { value: "16:9", label: "16:9" },
        { value: "4:3", label: "4:3" },
        { value: "1:1", label: "1:1" },
      ],
    },
  ],
  spacer: [
    {
      name: "height",
      label: "Height",
      kind: "select",
      options: [
        { value: "xs", label: "Extra small" },
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
        { value: "xl", label: "Extra large" },
      ],
    },
  ],
  divider: [
    {
      name: "style",
      label: "Style",
      kind: "select",
      options: [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
      ],
    },
    {
      name: "width",
      label: "Width",
      kind: "select",
      options: [
        { value: "full", label: "Full" },
        { value: "half", label: "Half" },
        { value: "content", label: "Content" },
      ],
    },
    { name: "color", label: "Colour", kind: "color" },
  ],
};

/** Guard: every registered block must declare its fields. */
export function fieldsFor(type: string): FieldSpec[] {
  return BLOCK_FIELDS[type] ?? [];
}

export function missingFieldDefinitions(): string[] {
  return BLOCK_DEFINITIONS.filter((definition) => !BLOCK_FIELDS[definition.type]).map((definition) => definition.type);
}

export const SECTION_FIELDS: FieldSpec[] = [
  { name: "layout.columns", label: "Columns", kind: "number", min: 1, max: 4 },
  {
    name: "layout.gap",
    label: "Gap",
    kind: "select",
    options: [
      { value: "none", label: "None" },
      { value: "sm", label: "Small" },
      { value: "md", label: "Medium" },
      { value: "lg", label: "Large" },
    ],
  },
  {
    name: "container",
    label: "Width",
    kind: "select",
    options: [
      { value: "boxed", label: "Boxed" },
      { value: "narrow", label: "Narrow" },
      { value: "full", label: "Full width" },
    ],
  },
  {
    name: "background.color",
    label: "Background colour",
    kind: "color",
  },
  { name: "background.mediaId", label: "Background image", kind: "media" },
  { name: "background.overlay", label: "Background overlay (%)", kind: "number", min: 0, max: 95 },
  {
    name: "padding.top",
    label: "Space above",
    kind: "select",
    options: [
      { value: "none", label: "None" },
      { value: "sm", label: "Small" },
      { value: "md", label: "Medium" },
      { value: "lg", label: "Large" },
      { value: "xl", label: "Extra large" },
    ],
  },
  {
    name: "padding.bottom",
    label: "Space below",
    kind: "select",
    options: [
      { value: "none", label: "None" },
      { value: "sm", label: "Small" },
      { value: "md", label: "Medium" },
      { value: "lg", label: "Large" },
      { value: "xl", label: "Extra large" },
    ],
  },
  {
    name: "padding.horizontal",
    label: "Side padding",
    kind: "select",
    options: [
      { value: "none", label: "None" },
      { value: "sm", label: "Small" },
      { value: "md", label: "Medium" },
      { value: "lg", label: "Large" },
    ],
  },
];
