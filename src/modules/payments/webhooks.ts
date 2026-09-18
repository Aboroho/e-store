import "server-only";
import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import { processProviderEvent } from "@/modules/payments/service";
import { getBkashCredentials, getSslcommerzCredentials } from "@/modules/payments/providers";
import { verifyBkashCallback } from "@/modules/payments/providers/bkash";
import { mapSslcommerzStatus, querySslcommerzTransaction, validateSslcommerzPayment, verifySslcommerzHash } from "@/modules/payments/providers/sslcommerz";

/**
 * Provider callback handling.
 *
 * Nothing here trusts the posted payload: bKash callbacks are confirmed with a
 * server-side payment query, SSLCommerz callbacks with `validate` plus the
 * merchant-transaction query and the payload hash. Only then does the payment
 * service mark an order paid — and always exactly once.
 */

export interface WebhookOutcome {
  outcome: "processed" | "duplicate" | "ignored" | "failed";
  message: string;
  orderId?: string | null;
}

/** bKash: called from our return URL and from the IPN endpoint. */
export async function handleBkashCallback(input: {
  businessId?: string;
  payload: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<WebhookOutcome> {
  const paymentId = str(input.payload.paymentID ?? input.payload.paymentId);
  const status = str(input.payload.status ?? input.payload.transactionStatus);
  if (!paymentId) throw AppError.validation("The callback does not include a paymentID");

  const attempt = await prisma.paymentAttempt.findFirst({
    where: { providerPaymentId: paymentId },
    orderBy: { createdAt: "desc" },
  });

  const businessId = input.businessId ?? attempt?.businessId;
  if (!businessId) throw AppError.notFound("No payment attempt matches this bKash payment");

  const { credentials, sandbox } = await getBkashCredentials(businessId);
  const expectedAmount = attempt?.amountPaisa ?? 0;

  // The browser can say anything; ask bKash directly.
  const verification = await verifyBkashCallback({ credentials, sandbox, paymentId, expectedAmountPaisa: expectedAmount });
  const succeeded = verification.succeeded || (status === "success" && verification.rawStatus === "Completed" && verification.amountPaisa === expectedAmount);

  const result = await processProviderEvent({
    businessId,
    providerName: "bKash",
    eventType: succeeded ? "payment.completed" : "payment.failed",
    providerEventId: verification.transactionId ?? paymentId,
    signatureValid: true,
    payload: { callback: input.payload, verification: verification.raw } as never,
    ipAddress: input.ipAddress ?? null,
    clientReference: attempt?.clientReference ?? null,
    providerPaymentId: paymentId,
    providerTransactionId: verification.transactionId,
    amountPaisa: verification.amountPaisa ?? expectedAmount,
    succeeded,
    failureReason: succeeded ? null : `bKash reported ${verification.rawStatus ?? status ?? "unknown"}`,
    rawStatus: verification.rawStatus ?? status ?? null,
  });

  logger.info("payment.bkash_callback", { paymentId, succeeded, applied: result.applied });
  return {
    outcome: result.applied ? "processed" : result.reason === "duplicate" ? "duplicate" : "ignored",
    message: succeeded ? "Payment verified" : "Payment not completed",
    orderId: "order" in result && result.order ? result.order.id : attempt?.orderId ?? null,
  };
}

/** SSLCommerz: IPN and the success/fail/cancel redirects all land here. */
export async function handleSslcommerzCallback(input: {
  businessId?: string;
  payload: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<WebhookOutcome> {
  const tranId = str(input.payload.tran_id ?? input.payload.tranId);
  const valId = str(input.payload.val_id);
  const status = mapSslcommerzStatus(str(input.payload.status));

  const attempt = tranId
    ? await prisma.paymentAttempt.findFirst({ where: { clientReference: tranId }, orderBy: { createdAt: "desc" } })
    : null;

  const businessId = input.businessId ?? attempt?.businessId;
  if (!businessId) throw AppError.notFound("No payment attempt matches this SSLCommerz transaction");

  const { credentials, sandbox } = await getSslcommerzCredentials(businessId);
  const hashSecret = credentials.hash_secret ?? credentials.store_passwd ?? "";
  const hashValid = hashSecret ? verifySslcommerzHash(input.payload, hashSecret) : false;

  // Ask SSLCommerz directly; the posted status is only a hint.
  const verification = valId
    ? await validateSslcommerzPayment({ credentials, sandbox, valId })
    : await querySslcommerzTransaction({ credentials, sandbox, tranId: tranId ?? "" });

  const verifiedStatus = mapSslcommerzStatus(str(verification.status));
  const verifiedAmount =
    typeof verification.amount === "string" || typeof verification.amount === "number" ? Math.round(Number(verification.amount) * 100) : null;
  const expectedAmount = attempt?.amountPaisa ?? 0;
  const succeeded = verifiedStatus === "VALIDATED" && verifiedAmount === expectedAmount;

  const result = await processProviderEvent({
    businessId,
    providerName: "SSLCommerz",
    eventType: succeeded ? "payment.completed" : "payment.not_completed",
    providerEventId: str(verification.bank_tran_id) ?? valId ?? tranId,
    signatureValid: hashValid || Boolean(valId),
    payload: { callback: input.payload, verification } as never,
    ipAddress: input.ipAddress ?? null,
    clientReference: attempt?.clientReference ?? null,
    providerPaymentId: str(verification.bank_tran_id),
    providerTransactionId: str(verification.bank_tran_id) ?? valId,
    amountPaisa: verifiedAmount ?? expectedAmount,
    succeeded,
    failureReason: succeeded ? null : `SSLCommerz reported ${str(verification.status) ?? status ?? "unknown"}`,
    rawStatus: str(verification.status),
  });

  logger.info("payment.sslcommerz_callback", { tranId, status, succeeded, applied: result.applied });
  return {
    outcome: result.applied ? "processed" : result.reason === "duplicate" ? "duplicate" : "ignored",
    message: succeeded ? "Payment verified" : "Payment not completed",
    orderId: "order" in result && result.order ? result.order.id : attempt?.orderId ?? null,
  };
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}
