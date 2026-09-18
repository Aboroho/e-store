/**
 * Vitest setup.
 *
 * Loads `.env` (like the application does) and fills in safe defaults for the
 * few variables the code requires, so unit tests never depend on a developer's
 * local secrets. Integration tests that talk to PostgreSQL use the same
 * DATABASE_URL as development unless TESTS_DATABASE_URL is provided.
 */
import "dotenv/config";

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://postgres@127.0.0.1:5432/estore?schema=public";
process.env.APP_URL ??= "http://localhost:3000";
process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef";
process.env.APP_ENCRYPTION_KEY ??= "test-encryption-key-0123456789abcdef";
process.env.LOG_LEVEL ??= "error";
