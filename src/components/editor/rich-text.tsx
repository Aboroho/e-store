import { Fragment } from "react";
import { richTextParts } from "@/modules/media/rich-text";

export function RichText({ value }: { value: string }) {
  return (
    <div className="space-y-3 whitespace-pre-wrap">
      {richTextParts(value).map((part, index) =>
        part.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={`/api/v1/media/${part.mediaId}`}
            alt={part.alt}
            loading="lazy"
            className="max-h-96 max-w-full rounded object-contain"
          />
        ) : (
          <Fragment key={index}>
            {part.text
              .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
              .map((text, i) =>
                text.startsWith("**") && text.endsWith("**") ? (
                  <strong key={i}>{text.slice(2, -2)}</strong>
                ) : text.startsWith("*") && text.endsWith("*") ? (
                  <em key={i}>{text.slice(1, -1)}</em>
                ) : (
                  <Fragment key={i}>{text}</Fragment>
                ),
              )}
          </Fragment>
        ),
      )}
    </div>
  );
}
