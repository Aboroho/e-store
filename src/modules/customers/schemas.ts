import { z } from "zod";

/** Customer identity, verification and account-claim inputs. */

export const customerIdentitySchema = z.object({
  name: z.string().trim().min(2, "Enter the customer name").max(120),
  phone: z.string().trim().min(6, "Enter a phone number").max(24),
  email: z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")),
  districtCode: z.string().trim().length(2).optional(),
  addressLine: z.string().trim().max(300).optional(),
  area: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});
export type CustomerIdentityInput = z.infer<typeof customerIdentitySchema>;

export const verificationRequestSchema = z.object({
  phone: z.string().trim().min(6, "Enter the phone number").max(24),
  purpose: z.enum(["LOGIN", "ACCOUNT_CLAIM", "PHONE_VERIFY", "ORDER_LOOKUP"]).default("LOGIN"),
});
export type VerificationRequestInput = z.infer<typeof verificationRequestSchema>;

export const verificationConfirmSchema = z.object({
  phone: z.string().trim().min(6).max(24),
  code: z.string().trim().regex(/^\d{4,8}$/, "Enter the numeric code"),
  purpose: z.enum(["LOGIN", "ACCOUNT_CLAIM", "PHONE_VERIFY", "ORDER_LOOKUP"]).default("LOGIN"),
});
export type VerificationConfirmInput = z.infer<typeof verificationConfirmSchema>;

export const customerAddressSchema = z.object({
  customerId: z.string().uuid(),
  label: z.string().trim().max(40).optional(),
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(24),
  districtCode: z.string().trim().length(2).optional(),
  addressLine: z.string().trim().min(4).max(300),
  area: z.string().trim().max(120).optional(),
  postcode: z.string().trim().max(12).optional(),
  isDefault: z.boolean().default(false),
});
export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;

export const customerNoteSchema = z.object({
  customerId: z.string().uuid(),
  body: z.string().trim().min(2).max(1000),
  isPinned: z.boolean().default(false),
});
export type CustomerNoteInput = z.infer<typeof customerNoteSchema>;

export const customerStatusSchema = z.object({
  customerId: z.string().uuid(),
  status: z.enum(["ACTIVE", "BLOCKED"]),
  reason: z.string().trim().max(300).optional(),
});
export type CustomerStatusInput = z.infer<typeof customerStatusSchema>;
