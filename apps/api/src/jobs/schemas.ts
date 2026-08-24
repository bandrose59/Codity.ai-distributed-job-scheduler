import { z } from "zod";

export const jobTypeSchema = z.enum(["IMMEDIATE", "DELAYED", "SCHEDULED", "CRON", "BATCH"]);

const baseJobSchema = z.object({
  queueId: z.uuid(),
  type: jobTypeSchema,
  payload: z.json(),
  priority: z.number().int().nonnegative().optional(),
  scheduledAt: z.iso.datetime().optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(255).optional().nullable(),
  cronExpression: z.string().trim().min(1).max(255).optional(),
  timezone: z.string().trim().min(1).max(100).optional()
}).superRefine((value, context) => {
  if (Buffer.byteLength(JSON.stringify(value.payload), "utf8") > 900_000) {
    context.addIssue({ code: "custom", path: ["payload"], message: "payload exceeds the 900 KB limit" });
  }
});

export const jobCreateSchema = baseJobSchema.superRefine((value, context) => {
  if ((value.type === "DELAYED" || value.type === "SCHEDULED") && !value.scheduledAt) {
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "scheduledAt is required" });
  }
  if (value.type === "CRON" && !value.cronExpression) {
    context.addIssue({
      code: "custom",
      path: ["cronExpression"],
      message: "cronExpression is required"
    });
  }
  if (value.type !== "CRON" && value.cronExpression !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["cronExpression"],
      message: "cronExpression is only valid for CRON jobs"
    });
  }
});

export const batchSchema = z.object({ jobs: z.array(jobCreateSchema).min(1).max(100) });

export const jobListQuerySchema = z.object({
  queueId: z.uuid().optional(),
  status: z
    .enum([
      "SCHEDULED",
      "QUEUED",
      "CLAIMED",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "RETRYING",
      "CANCELLED"
    ])
    .optional(),
  type: jobTypeSchema.optional(),
  priority: z.coerce.number().int().nonnegative().optional(),
  workerId: z.uuid().optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional()
});
