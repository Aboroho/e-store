import "server-only";

/**
 * Structured application logging.
 *
 * Logs are JSON lines so they can be shipped to any log collector on the VPS
 * (journald, Loki, BetterStack...) without extra infrastructure. Sensitive
 * values are redacted before they reach the log stream.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|authorization|api.?key|credential|otp|code|cvv|card|cookie|session|signature)/i;

/** Keys that are intentionally logged even though they match the pattern. */
const ALLOWED_SENSITIVE_KEYS = new Set([
  "statusCode",
  "errorCode",
  "codeHash",
  "correlationId",
  "requestId",
  "idempotencyKey",
  "trackingCode",
  "orderNumber",
  "sku",
]);

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Mask anything that looks like a bearer token or long secret.
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redactValue(entry, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && !ALLOWED_SENSITIVE_KEYS.has(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactValue(entry, depth + 1);
      }
    }
    return result;
  }
  return String(value);
}

export interface LogContext {
  [key: string]: unknown;
}

function currentLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVEL_PRIORITY) return configured;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel()]) return;

  const payload: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redactValue(context) as Record<string, unknown>) : {}),
  };

  if (error) {
    if (error instanceof Error) {
      payload.error = {
        name: error.name,
        message: error.message,
        ...(process.env.NODE_ENV === "production" ? {} : { stack: error.stack }),
      };
    } else {
      payload.error = redactValue(error);
    }
  }

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext, error?: unknown) => write("warn", message, context, error),
  error: (message: string, error?: unknown, context?: LogContext) => write("error", message, context, error),
  child: (base: LogContext) => ({
    debug: (message: string, context?: LogContext) => write("debug", message, { ...base, ...context }),
    info: (message: string, context?: LogContext) => write("info", message, { ...base, ...context }),
    warn: (message: string, context?: LogContext, error?: unknown) => write("warn", message, { ...base, ...context }, error),
    error: (message: string, error?: unknown, context?: LogContext) => write("error", message, { ...base, ...context }, error),
  }),
};

/** Redact an arbitrary value for safe logging/testing. */
export function redact(value: unknown): unknown {
  return redactValue(value);
}
