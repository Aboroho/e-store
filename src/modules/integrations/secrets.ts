import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

/**
 * Integration credentials.
 *
 * Secrets live in `IntegrationSecret` encrypted with the app encryption key and
 * are only ever decrypted on the server, immediately before an outbound call.
 * They are never returned by an API route, never logged and never sent to a
 * browser.
 */

export interface SecretScope {
  integrationId?: string | null;
  courierProviderId?: string | null;
}

type Client = Prisma.TransactionClient | typeof prisma;

export async function getIntegrationSecrets(scope: SecretScope, client: Client = prisma): Promise<Record<string, string>> {
  if (!scope.integrationId && !scope.courierProviderId) return {};
  const rows = await client.integrationSecret.findMany({
    where: {
      ...(scope.integrationId ? { integrationId: scope.integrationId } : {}),
      ...(scope.courierProviderId ? { courierProviderId: scope.courierProviderId } : {}),
    },
  });

  const secrets: Record<string, string> = {};
  for (const row of rows) {
    try {
      secrets[row.key] = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    } catch {
      throw AppError.internal(`The stored credential "${row.key}" could not be decrypted`);
    }
  }
  return secrets;
}

export async function setIntegrationSecret(
  input: SecretScope & { key: string; plaintext: string; description?: string | null; updatedByUserId?: string | null },
  client: Client = prisma,
): Promise<void> {
  if (!input.integrationId && !input.courierProviderId) {
    throw AppError.validation("A credential must belong to an integration or a courier provider");
  }

  const value = encryptSecret(input.plaintext);
  const existing = await client.integrationSecret.findFirst({
    where: {
      key: input.key,
      integrationId: input.integrationId ?? null,
      courierProviderId: input.courierProviderId ?? null,
    },
    select: { id: true, description: true },
  });

  if (existing) {
    await client.integrationSecret.update({
      where: { id: existing.id },
      data: {
        ciphertext: value.ciphertext,
        iv: value.iv,
        authTag: value.authTag,
        description: input.description ?? existing.description,
        updatedByUserId: input.updatedByUserId ?? null,
        lastRotatedAt: new Date(),
      },
    });
    return;
  }

  await client.integrationSecret.create({
    data: {
      integrationId: input.integrationId ?? null,
      courierProviderId: input.courierProviderId ?? null,
      key: input.key,
      ciphertext: value.ciphertext,
      iv: value.iv,
      authTag: value.authTag,
      description: input.description ?? null,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });
}

/** Keys present for a scope, with masked values — safe for admin screens. */
export async function listSecretKeys(scope: SecretScope, client: Client = prisma) {
  const rows = await client.integrationSecret.findMany({
    where: {
      ...(scope.integrationId ? { integrationId: scope.integrationId } : {}),
      ...(scope.courierProviderId ? { courierProviderId: scope.courierProviderId } : {}),
    },
    select: { id: true, key: true, description: true, lastRotatedAt: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  return rows;
}
