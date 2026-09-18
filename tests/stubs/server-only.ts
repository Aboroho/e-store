/**
 * Test stub for the `server-only` package.
 *
 * `server-only` throws when imported outside a React Server Component build.
 * Tests import server modules directly, so the alias in vitest.config.ts points
 * here. The application build still uses the real package, which guarantees the
 * modules can never be pulled into a client bundle.
 */
export {};
