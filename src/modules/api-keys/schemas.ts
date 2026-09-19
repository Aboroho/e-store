import { z } from "zod";
import { SCOPE_KEYS, WEBHOOK_EVENTS } from "./scopes";

/** Validation for API keys and webhook subscriptions. */

export const createApiKeySchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  scopes: z.array(z.enum(SCOPE_KEYS as [string, ...string[]])).min(1, "Choose at least one scope"),
  expiresAt: z
    .union([z.literal(""), z.coerce.date()])
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  rateLimitPerMinute: z.coerce.number().int().min(10).max(6000).default(120),
  allowedIpAddresses: z.array(z.string().trim().min(7).max(45)).max(20).default([]),
});

export const revokeApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export const rotateApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  /** The old key is revoked after this many seconds so clients can roll over. */
  gracePeriodSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
});

export const createWebhookSchema = z.object({
  name: z.string().trim().min(3).max(80),
  url: z
    .string()
    .trim()
    .url("Enter a valid https URL")
    .refine((value) => value.startsWith("https://") || process.env.NODE_ENV !== "production", {
      message: "Webhook endpoints must use https in production",
    }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event"),
  apiKeyId: z.string().uuid().optional(),
});

export const updateWebhookSchema = z.object({
  webhookId: z.string().uuid(),
  isActive: z.coerce.boolean().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).optional(),
  url: z.string().trim().url().optional(),
});

export const rotateWebhookSecretSchema = z.object({
  webhookId: z.string().uuid(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
