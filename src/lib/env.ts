import "server-only";
import { z } from "zod";

/**
 * Environment configuration.
 *
 * Required secrets are validated the first time configuration is read so that
 * a misconfigured deployment fails fast and loudly, while local development and
 * tests get safe, non-production defaults.
 */

const developmentDefaults: Record<string, string> = {
  SESSION_SECRET: "dev-only-session-secret-change-me-0123456789",
  APP_ENCRYPTION_KEY: "dev-only-encryption-key-change-me-0123456789",
  APP_URL: "http://localhost:3000",
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("E-Store"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SHADOW_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY must be at least 32 characters"),

  /**
   * `s3` uses an S3-compatible bucket with presigned URLs. `local` keeps objects on
   * disk under LOCAL_STORAGE_DIR and serves them through signed, expiring URLs issued
   * by the application itself (test/development only; production requires S3).
   * `disabled` refuses every upload with a clear message instead of failing silently.
   */
  STORAGE_DRIVER: z.enum(["s3", "local", "disabled"]).default("disabled"),
  LOCAL_STORAGE_DIR: z.string().default(".cache/uploads"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
  MEDIA_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(15),

  PATHAO_BASE_URL: z.string().default("https://api-hermes.pathao.com"),
  STEADFAST_BASE_URL: z.string().default("https://portal.packzy.com/api/v1"),
  CARRYBEE_BASE_URL: z.string().default("https://api.carrybee.com"),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_POLL_MS: z.coerce.number().int().min(200).default(2000),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const source: Record<string, string | undefined> = { ...process.env };

  if (source.NODE_ENV !== "production") {
    for (const [key, value] of Object.entries(developmentDefaults)) {
      if (!source[key]) source[key] = value;
    }
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  if (parsed.data.NODE_ENV === "production") {
    const problems: string[] = [];
    if (parsed.data.SESSION_SECRET.startsWith("dev-only")) problems.push("SESSION_SECRET must be set in production");
    if (parsed.data.APP_ENCRYPTION_KEY.startsWith("dev-only"))
      problems.push("APP_ENCRYPTION_KEY must be set in production");
    if (parsed.data.STORAGE_DRIVER === "local") problems.push("Production media requires S3-compatible storage; local is test/development only");
    if (parsed.data.STORAGE_DRIVER === "s3" && !parsed.data.S3_BUCKET) problems.push("S3_BUCKET is required when STORAGE_DRIVER=s3");
    if (problems.length > 0) throw new Error(`Invalid production environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }

  return parsed.data;
}

let cached: Env | null = null;

/** Validated environment configuration (cached per process). */
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** True when running in production mode with validated configuration. */
export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}

export function isTest(): boolean {
  return env().NODE_ENV === "test";
}

/** Whether object storage is configured and usable. */
export function storageEnabled(): boolean {
  const config = env();
  if (config.STORAGE_DRIVER === "s3") return Boolean(config.S3_BUCKET);
  return config.STORAGE_DRIVER === "local";
}

/** The configured storage driver name. */
export function storageDriver(): "s3" | "local" | "disabled" {
  return env().STORAGE_DRIVER;
}
