import { NextResponse, type NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { verifyPayloadSignature } from "@/lib/crypto";
import { prisma } from "@/lib/db/client";
import { getIntegrationSecrets } from "@/modules/integrations/secrets";
import { getCourierAdapter } from "@/modules/couriers/providers";
import { processCourierWebhook } from "@/modules/couriers/service";

/**
 * Courier status webhooks.
 *
 * The provider is taken from the URL, the secret from the encrypted provider
 * credentials, and the signature is verified over the raw body before anything
 * is stored. Delivery is idempotent: the event row is unique per provider event.
 */

const SUPPORTED = ["PATHAO", "STEADFAST", "CARRYBEE"] as const;
type ProviderCode = (typeof SUPPORTED)[number];

function parseSignatureHeader(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  return trimmed.startsWith("sha256=") ? trimmed.slice(7) : trimmed;
}

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const providerCode = provider.toUpperCase() as ProviderCode;
  if (!SUPPORTED.includes(providerCode)) return apiError(AppError.notFound("Unknown courier provider"));

  const adapter = getCourierAdapter(providerCode);
  if (!adapter) return apiError(AppError.notFound("Unknown courier provider"));

  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    return apiError(AppError.validation("The webhook body is not valid JSON"));
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const providerRow = await prisma.courierProvider.findFirst({
      where: { code: providerCode },
      orderBy: { createdAt: "asc" },
    });

    if (!providerRow) {
      logger.warn("courier.webhook_unknown_provider", { providerCode, ipAddress });
      return apiSuccess({ received: true, processed: false, reason: "Provider is not configured" }, { status: 202 });
    }

    const secrets = await getIntegrationSecrets({ courierProviderId: providerRow.id });
    const signature = parseSignatureHeader(request.headers.get(adapter.webhookSignatureHeader));
    const secret = secrets.webhook_secret;
    // Providers authenticate differently: most sign the body, Steadfast sends the
    // token configured in its portal as `Authorization: Bearer <token>`.
    const signatureValid = adapter.verifyWebhook
      ? adapter.verifyWebhook({
          rawBody,
          headers: Object.fromEntries(request.headers.entries()),
          secret: secret ?? "",
        })
      : Boolean(secret && signature && verifyPayloadSignature(rawBody, secret, signature));

    if (!secret) {
      logger.warn("courier.webhook_no_secret", { providerCode, providerId: providerRow.id });
      return apiError(AppError.integration(`${adapter.label} has no webhook secret configured`));
    }
    if (!signatureValid) {
      return apiError(AppError.forbidden("The webhook signature could not be verified"));
    }

    const result = await processCourierWebhook({
      providerCode,
      payload,
      headers: Object.fromEntries(request.headers.entries()),
      signatureValid,
      ipAddress,
    });

    return apiSuccess({ received: true, processed: result.status === "PROCESSED", duplicate: result.duplicate, message: result.message });
  } catch (error) {
    logger.error("courier.webhook_failed", error);
    return apiError(error);
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Send courier webhooks as POST requests" } },
    { status: 405 },
  );
}
