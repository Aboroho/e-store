import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Single Prisma client per process, connected through the PostgreSQL driver
 * adapter (Prisma 7 uses driver adapters + the WASM query compiler instead of
 * a native query engine binary).
 */
/** Dev hot-reload safe singleton (a new client per reload exhausts connections). */
const globalForPrisma = globalThis as unknown as { __eStorePrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env().DATABASE_URL,
    max: env().DATABASE_POOL_SIZE,
    application_name: "e-store",
  });
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.__eStorePrisma ?? createClient();

if (env().NODE_ENV !== "production") {
  globalForPrisma.__eStorePrisma = prisma;
}

export type TransactionClient = Prisma.TransactionClient;

/**
 * Run a function inside a database transaction.
 *
 * Use this for every workflow that must update several related records
 * atomically (order creation, stock movements, payments, settlements, payouts).
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: options.isolationLevel,
    timeout: options.timeoutMs ?? 20_000,
    maxWait: 10_000,
  });
}

export { Prisma };
export type { PrismaClient };
