/**
 * Stable application error codes and the error type used across API routes,
 * server actions and domain services.
 *
 * Codes are part of the public API contract (documented in docs/API.md) and
 * must remain stable so that clients can react programmatically.
 */

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  INVALID_STATE: "INVALID_STATE",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  UNPROCESSABLE: "UNPROCESSABLE",
  INTEGRATION_ERROR: "INTEGRATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const defaultStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE: 409,
  INSUFFICIENT_STOCK: 409,
  PAYMENT_REQUIRED: 402,
  UNPROCESSABLE: 422,
  INTEGRATION_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  status?: number;
  details?: unknown;
  /** Safe, user-facing hint (never contains internal data). */
  hint?: string;
  cause?: unknown;
  /** Allow the caller to react to a specific business situation. */
  meta?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly hint?: string;
  readonly meta?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status ?? defaultStatus[options.code];
    this.details = options.details;
    this.hint = options.hint;
    this.meta = options.meta;
    if (options.cause) this.cause = options.cause;
  }

  static validation(message = "The submitted data is invalid", details?: unknown): AppError {
    return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message, details });
  }

  static unauthenticated(message = "Authentication is required"): AppError {
    return new AppError({ code: ErrorCodes.UNAUTHENTICATED, message });
  }

  static forbidden(message = "You do not have permission to perform this action"): AppError {
    return new AppError({ code: ErrorCodes.FORBIDDEN, message });
  }

  static notFound(message = "The requested resource was not found"): AppError {
    return new AppError({ code: ErrorCodes.NOT_FOUND, message });
  }

  static conflict(message = "The request conflicts with the current state"): AppError {
    return new AppError({ code: ErrorCodes.CONFLICT, message });
  }

  static rateLimited(message = "Too many requests, please try again later", details?: unknown): AppError {
    return new AppError({ code: ErrorCodes.RATE_LIMITED, message, details });
  }

  static invalidState(message: string, meta?: Record<string, unknown>): AppError {
    return new AppError({ code: ErrorCodes.INVALID_STATE, message, meta });
  }

  static insufficientStock(message = "Not enough stock available"): AppError {
    return new AppError({ code: ErrorCodes.INSUFFICIENT_STOCK, message });
  }

  static integration(message: string, details?: unknown): AppError {
    return new AppError({ code: ErrorCodes.INTEGRATION_ERROR, message, details });
  }

  static internal(message = "An unexpected error occurred", cause?: unknown): AppError {
    return new AppError({ code: ErrorCodes.INTERNAL_ERROR, message, cause });
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** Convert any thrown value into a safe API representation. */
export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: { code: ErrorCode; message: string; details?: unknown; hint?: string } };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          ...(error.hint ? { hint: error.hint } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: { error: { code: ErrorCodes.INTERNAL_ERROR, message: "An unexpected error occurred" } },
  };
}

/** True when a value is a Prisma "record not found" style error. */
export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  const candidate = error as { code?: string; meta?: { target?: string[] | string } } | null;
  if (!candidate || candidate.code !== "P2002") return false;
  if (!field) return true;
  const target = candidate.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return fields.some((entry) => entry.includes(field));
}

export function isForeignKeyError(error: unknown): boolean {
  const candidate = error as { code?: string } | null;
  return candidate?.code === "P2003";
}

export function isNotFoundError(error: unknown): boolean {
  const candidate = error as { code?: string } | null;
  return candidate?.code === "P2025";
}
