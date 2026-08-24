import { z } from "zod";

export const retryPolicySchema = z
  .object({
    strategy: z.enum(["FIXED", "LINEAR", "EXPONENTIAL"]),
    maxAttempts: z.number().int().positive(),
    initialDelayMs: z.number().int().nonnegative(),
    maxDelayMs: z.number().int().nonnegative().optional()
  })
  .refine(
    (value) => value.maxDelayMs === undefined || value.maxDelayMs >= value.initialDelayMs,
    "maxDelayMs must be greater than or equal to initialDelayMs"
  );

export const queueCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  priority: z.number().int().nonnegative().default(0),
  concurrencyLimit: z.number().int().positive().default(1),
  retryPolicy: retryPolicySchema.optional()
});

export const queueUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priority: z.number().int().nonnegative().optional(),
    concurrencyLimit: z.number().int().positive().optional(),
    retryPolicy: retryPolicySchema.nullable().optional()
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "At least one field is required"
  );
