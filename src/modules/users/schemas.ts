import { z } from "zod";
import { zEmail } from "@/lib/validation";

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the user's full name").max(120),
  email: zEmail,
  phone: z.string().trim().max(24).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  roleIds: z.array(z.string().min(1)).min(1, "Assign at least one role"),
  sendInvite: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(24).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"]),
  roleIds: z.array(z.string().min(1)).min(1, "Assign at least one role"),
});

export const resetUserPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(10).max(200),
  confirmPassword: z.string().min(10).max(200),
  forceChange: z.boolean().default(true),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower case letters, numbers and dashes"),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().min(1)).default([]),
});

export const updateRoleSchema = createRoleSchema.partial().extend({
  roleId: z.string().min(1),
  permissions: z.array(z.string().min(1)),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
