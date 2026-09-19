import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Entry point used by `npm run db:seed` (and by `prisma db seed`).
 *
 * The real seeding logic lives in `prisma/seed/index.ts` and is executed with
 * `tsx` so that TypeScript path aliases and ESM imports behave exactly like the
 * application runtime.
 */
const script = path.join(import.meta.dirname, "seed", "index.ts");
const result = spawnSync("npx", ["tsx", script], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
