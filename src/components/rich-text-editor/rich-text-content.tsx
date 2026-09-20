import * as React from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "./internal/format";
import { isExternalHref, safeHref, safeSrc } from "./internal/url";
import { isInlineVideoMimeType } from "@/lib/rich-text-document";
import { isRichTextEmpty } from "./serialization";
import type { RichTextContentProps, RichTextMark, RichTextNode } from "./types";
import "./rich-text-editor.css";

/**
 * Read-only renderer for `RichTextDocument`s.
 *
 * Like the page builder, it never injects markup: every node type is mapped to a React
 * element here and everything else is skipped. It has no dependency on the editor
 * library, so it is cheap to use in server components (storefront pages, emails, …).
 *
 * Adding a block to the editor means adding a case here as well.
 */

function attr<T extends string | number | boolean>(attrs: Record<string, unknown> | undefined, key: string, type: "string" | "number" | "boolean"): T | undefined {
  const value = attrs?.[key];
  return typeof value === type ? (value as T) : undefined;
}

function renderMarks(children: React.ReactNode, marks: RichTextMark[] | undefined): React.ReactNode {
  if (!marks || marks.length === 0) return children;
  return marks.reduceRight<React.ReactNode>((inner, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{inner}</strong>;
      case "italic":
        return <em>{inner}</em>;
      case "underline":
        return <u>{inner}</u>;
      case "strike":
        return <s>{inner}</s>;
      case "code":
        return <code>{inner}</code>;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        if (!href) return inner;
        const external = isExternalHref(href);
        return (
          <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer nofollow" : undefined}>
            {inner}
          </a>
        );
      }
      default:
        return inner;
    }
  }, children);
}

function renderChildren(nodes: RichTextNode[] | undefined): React.ReactNode {
  if (!nodes || nodes.length === 0) return null;
  return nodes.map((node, index) => <React.Fragment key={index}>{renderNode(node)}</React.Fragment>);
}

function renderNode(node: RichTextNode): React.ReactNode {
  switch (node.type) {
    case "text":
      return renderMarks(node.text ?? "", node.marks);
    case "hardBreak":
      return <br />;
    case "paragraph":
      // Empty paragraphs keep their line height, exactly as in the editor.
      return <p>{node.content && node.content.length > 0 ? renderChildren(node.content) : <br />}</p>;
    case "heading": {
      const level = attr<number>(node.attrs, "level", "number") ?? 2;
      const Tag = (`h${Math.min(6, Math.max(1, level))}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag>{renderChildren(node.content)}</Tag>;
    }
    case "bulletList":
      return <ul>{renderChildren(node.content)}</ul>;
    case "orderedList": {
      const start = attr<number>(node.attrs, "start", "number");
      return <ol start={start && start !== 1 ? start : undefined}>{renderChildren(node.content)}</ol>;
    }
    case "listItem":
      return <li>{renderChildren(node.content)}</li>;
    case "taskList":
      return <ul data-type="taskList">{renderChildren(node.content)}</ul>;
    case "taskItem": {
      const checked = attr<boolean>(node.attrs, "checked", "boolean") ?? false;
      return (
        <li data-type="taskItem" data-checked={checked ? "true" : "false"}>
          <label>
            <input type="checkbox" checked={checked} disabled readOnly aria-label={checked ? "Completed" : "Not completed"} />
            <span />
          </label>
          <div>{renderChildren(node.content)}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote>{renderChildren(node.content)}</blockquote>;
    case "codeBlock": {
      const language = attr<string>(node.attrs, "language", "string");
      return (
        <pre>
          <code className={language ? `language-${language}` : undefined}>{renderChildren(node.content)}</code>
        </pre>
      );
    }
    case "horizontalRule":
      return <hr />;
    case "image": {
      const src = safeSrc(node.attrs?.src);
      if (!src) return null;
      const width = attr<number>(node.attrs, "width", "number");
      const height = attr<number>(node.attrs, "height", "number");
      return (
        <figure data-type="image">
          {/* eslint-disable-next-line @next/next/no-img-element -- user content from arbitrary storage; next/image would need a per-host allowlist. */}
          <img src={src} alt={attr<string>(node.attrs, "alt", "string") ?? ""} title={attr<string>(node.attrs, "title", "string")} width={width} height={height} loading="lazy" />
        </figure>
      );
    }
    case "fileAttachment": {
      const href = safeSrc(node.attrs?.href);
      if (!href) return null;
      const name = attr<string>(node.attrs, "name", "string") || "Download file";
      const size = attr<number>(node.attrs, "size", "number");
      const mimeType = attr<string>(node.attrs, "mimeType", "string") ?? "";
      if (isInlineVideoMimeType(mimeType)) {
        return (
          <span className="rte-file" data-type="fileAttachment">
            <video src={href} controls preload="metadata" className="w-full rounded-lg" />
            <span className="rte-file-meta">{name}</span>
          </span>
        );
      }
      return (
        <a data-type="fileAttachment" href={href} target="_blank" rel="noopener noreferrer nofollow" download>
          <span className="rte-file-icon" aria-hidden="true">
            <FileText className="h-4 w-4" />
          </span>
          <span className="rte-file-name">{name}</span>
          {size ? <span className="rte-file-meta">{formatBytes(size)}</span> : null}
        </a>
      );
    }
    case "table":
      return (
        <div className="tableWrapper">
          <table>
            <tbody>{renderChildren(node.content)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{renderChildren(node.content)}</tr>;
    case "tableHeader":
    case "tableCell": {
      const Cell = node.type === "tableHeader" ? "th" : "td";
      const colspan = attr<number>(node.attrs, "colspan", "number");
      const rowspan = attr<number>(node.attrs, "rowspan", "number");
      return (
        <Cell colSpan={colspan && colspan > 1 ? colspan : undefined} rowSpan={rowspan && rowspan > 1 ? rowspan : undefined}>
          {renderChildren(node.content)}
        </Cell>
      );
    }
    default:
      // Unknown block (for example one added by a newer editor version): keep its text.
      return node.content ? <div>{renderChildren(node.content)}</div> : null;
  }
}

export function RichTextContent({ value, className }: RichTextContentProps) {
  if (!value || isRichTextEmpty(value)) return null;
  return <div className={cn("rte-content", className)}>{renderChildren(value.content)}</div>;
}
