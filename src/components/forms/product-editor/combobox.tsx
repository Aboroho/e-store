"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui/primitives";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Searchable single/multi select used by the product form (brand, unit label,
 * categories, attributes). It is deliberately dependency free: a text input plus a
 * listbox, fully keyboard reachable (↑/↓ to move, Enter to pick, Esc to close) and
 * plain enough to work with hundreds of options or one.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  /** Optional swatch (attribute colours) or thumbnail. */
  swatch?: string | null;
  imageUrl?: string | null;
  selected?: boolean;
  disabled?: boolean;
}

interface BaseProps {
  label: string;
  tooltip?: React.ReactNode;
  help?: React.ReactNode;
  placeholder?: string;
  emptyMessage?: string;
  error?: string | string[];
  required?: boolean;
  disabled?: boolean;
  /** Rendered at the bottom of the list, e.g. "+ Create brand". */
  footer?: React.ReactNode;
  /** Extra content under the trigger (selected chips, previews). */
  children?: React.ReactNode;
  id?: string;
  className?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Allow clearing the selection. */
  clearable?: boolean;
  loading?: boolean;
}

interface MultiProps extends BaseProps {
  multiple: true;
  options: ComboboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
  loading?: boolean;
}

export type ComboboxProps = SingleProps | MultiProps;

export function Combobox(props: ComboboxProps) {
  const { label, tooltip, help, placeholder = "Search…", emptyMessage = "Nothing matches that search.", error, required, disabled, footer, children, id, className } = props;
  const errorText = Array.isArray(error) ? error[0] : error;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const generatedId = React.useId();
  const listId = `${id ?? generatedId}-listbox`;

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.options;
    return props.options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(needle));
  }, [props.options, query]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const isSelected = (option: ComboboxOption) =>
    props.multiple ? props.value.includes(option.value) : props.value === option.value;

  const select = (option: ComboboxOption) => {
    if (option.disabled) return;
    if (props.multiple) {
      const next = isSelected(option) ? props.value.filter((value) => value !== option.value) : [...props.value, option.value];
      props.onChange(props.max ? next.slice(0, props.max) : next);
      return;
    }
    props.onChange(option.value);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    if (props.multiple) props.onChange([]);
    else props.onChange(null);
  };

  return (
    <div className={cn("space-y-1.5", className)} ref={containerRef}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-slate-800">
          {label}
          {required ? (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
        {tooltip ? <InfoTip>{tooltip}</InfoTip> : null}
      </div>

      <div className="relative">
        <div
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500",
            disabled && "cursor-not-allowed bg-slate-50 opacity-70",
            errorText && "border-red-400",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            id={id}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => {
              setOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (open) setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
                else {
                  setOpen(true);
                  setActiveIndex(0);
                }
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                if (open && filtered[activeIndex]) {
                  event.preventDefault();
                  select(filtered[activeIndex]!);
                }
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {props.multiple ? (
            props.value.length > 0 ? (
              <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={clear} disabled={disabled}>
                Clear
              </button>
            ) : null
          ) : props.value ? (
            props.clearable !== false ? (
              <button type="button" aria-label={`Clear ${label}`} className="text-slate-400 hover:text-slate-600" onClick={clear} disabled={disabled}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null
          ) : null}
          {props.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" /> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={open ? `Close ${label} list` : `Open ${label} list`}
            disabled={disabled}
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next) setActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>

        {open ? (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            <ul id={listId} role="listbox" aria-multiselectable={props.multiple || undefined} className="space-y-0.5">
              {filtered.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">{emptyMessage}</li> : null}
              {filtered.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected(option)}
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(option)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                      index === activeIndex ? "bg-slate-100" : "bg-transparent",
                      isSelected(option) && "font-medium text-brand-700",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {props.multiple ? (
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          isSelected(option) ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300",
                        )}
                        aria-hidden="true"
                      >
                        {isSelected(option) ? <Check className="h-3 w-3" /> : null}
                      </span>
                    ) : null}
                    {option.swatch ? (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: option.swatch }} aria-hidden="true" />
                    ) : null}
                    {option.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- thumbnail from the media library
                      <img src={option.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint ? <span className="shrink-0 text-xs text-slate-400">{option.hint}</span> : null}
                    {!props.multiple && isSelected(option) ? <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /> : null}
                  </button>
                </li>
              ))}
            </ul>
            {footer ? <div className="mt-1 border-t border-slate-100 pt-1">{footer}</div> : null}
          </div>
        ) : null}
      </div>

      {children}
      {help && !errorText ? <p className="text-xs text-slate-500">{help}</p> : null}
      {errorText ? (
        <p className="flex items-start gap-1 text-xs text-red-600" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorText}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Small labelled numeric/text input with a tooltip; used across the price and stock fields. */
export function FieldWithTip({
  id,
  label,
  tooltip,
  help,
  error,
  children,
  required,
  className,
}: {
  id?: string;
  label: string;
  tooltip?: React.ReactNode;
  help?: React.ReactNode;
  error?: string | string[];
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  const errorText = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id} className="text-slate-800">
          {label}
          {required ? (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
        {tooltip ? <InfoTip>{tooltip}</InfoTip> : null}
      </div>
      {children}
      {help && !errorText ? <p className="text-xs text-slate-500">{help}</p> : null}
      {errorText ? (
        <p className="flex items-start gap-1 text-xs text-red-600" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{errorText}</span>
        </p>
      ) : null}
    </div>
  );
}

export { Input };
