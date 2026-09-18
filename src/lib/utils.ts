import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** URL friendly slug. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Normalise a Bangladeshi phone number to the local 11 digit form (01XXXXXXXXX). */
export function normalizeBdPhone(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  let local = digits;
  if (local.startsWith("880")) local = `0${local.slice(3)}`;
  else if (local.startsWith("88") && local.length > 11) local = `0${local.slice(2)}`;
  else if (local.length === 10 && local.startsWith("1")) local = `0${local}`;
  if (!/^01[3-9]\d{8}$/.test(local)) return null;
  return local;
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = normalizeBdPhone(value);
  if (!normalized) return value;
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(value: string, length = 80): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function formatDateTime(value: Date | string | null | undefined, locale = "en-GB"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(date);
}

export function formatDate(value: Date | string | null | undefined, locale = "en-GB"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Dhaka" }).format(date);
}

export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return formatDate(date);
}

export function toNumber(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toggleInArray<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/** Group array entries by a key. */
export function groupBy<T, K extends string | number>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

/** Simple, dependency-free percent helper for report displays. */
export function percent(part: number, total: number, fractionDigits = 1): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(fractionDigits)}%`;
}
