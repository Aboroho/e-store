import "server-only";
import { prisma } from "@/lib/db/client";
import { getIntegrationSecrets } from "@/modules/integrations/secrets";
import type { BkashCredentials } from "@/modules/payments/providers/bkash";
import type { SslcommerzCredentials } from "@/modules/payments/providers/sslcommerz";

/**
 * Payment provider registry.
 *
 * Credentials are read from the encrypted `Integration` row for the business, so
 * a provider that has not been configured reports a clear setup error instead of
 * silently failing. `testMode` decides sandbox vs live endpoints.
 */

export type PaymentProviderCode = "BKASH" | "SSLCOMMERZ";

export interface PaymentProviderConfig {
  code: PaymentProviderCode;
  name: string;
  enabled: boolean;
  sandbox: boolean;
  integrationId: string | null;
}

const PROVIDERS: Record<PaymentProviderCode, { name: string; credentialKeys: string[] }> = {
  BKASH: { name: "bKash", credentialKeys: ["app_key", "app_secret", "username", "password"] },
  SSLCOMMERZ: { name: "SSLCommerz", credentialKeys: ["store_id", "store_passwd", "hash_secret"] },
};

export function providerName(code: PaymentProviderCode): string {
  return PROVIDERS[code].name;
}

export function providerCredentialKeys(code: PaymentProviderCode): string[] {
  return PROVIDERS[code].credentialKeys;
}

export async function getPaymentProviderConfig(businessId: string, code: PaymentProviderCode): Promise<PaymentProviderConfig> {
  const integration = await prisma.integration.findFirst({
    where: { businessId, kind: "PAYMENT", provider: code.toLowerCase() },
    orderBy: { createdAt: "asc" },
  });

  return {
    code,
    name: PROVIDERS[code].name,
    enabled: Boolean(integration?.isEnabled),
    sandbox: integration?.testMode ?? true,
    integrationId: integration?.id ?? null,
  };
}

export async function listPaymentProviderConfigs(businessId: string) {
  const codes: PaymentProviderCode[] = ["BKASH", "SSLCOMMERZ"];
  return Promise.all(codes.map((code) => getPaymentProviderConfig(businessId, code)));
}

/** Decrypted bKash credentials for a business (server-only). */
export async function getBkashCredentials(businessId: string): Promise<{ credentials: BkashCredentials; sandbox: boolean; integrationId: string | null }> {
  const config = await getPaymentProviderConfig(businessId, "BKASH");
  if (!config.integrationId) return { credentials: {}, sandbox: true, integrationId: null };
  const secrets = await getIntegrationSecrets({ integrationId: config.integrationId });
  return {
    credentials: {
      app_key: secrets.app_key,
      app_secret: secrets.app_secret,
      username: secrets.username,
      password: secrets.password,
    },
    sandbox: config.sandbox,
    integrationId: config.integrationId,
  };
}

/** Decrypted SSLCommerz credentials for a business (server-only). */
export async function getSslcommerzCredentials(
  businessId: string,
): Promise<{ credentials: SslcommerzCredentials; sandbox: boolean; integrationId: string | null }> {
  const config = await getPaymentProviderConfig(businessId, "SSLCOMMERZ");
  if (!config.integrationId) return { credentials: {}, sandbox: true, integrationId: null };
  const secrets = await getIntegrationSecrets({ integrationId: config.integrationId });
  return {
    credentials: {
      store_id: secrets.store_id,
      store_passwd: secrets.store_passwd,
      hash_secret: secrets.hash_secret,
    },
    sandbox: config.sandbox,
    integrationId: config.integrationId,
  };
}
