import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthentication, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiError } from "../common/errors.js";
import { serializeJob, serializeScheduledJob } from "./serializers.js";
import { batchSchema, jobCreateSchema, jobListQuerySchema } from "./schemas.js";
import { cancelJob, createBatch, createJob, getJob, listJobs, retryJob } from "./service.js";
import { recordAudit } from "../common/audit.js";

function id(value: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new ApiError(400, "INVALID_ID", "Identifier is invalid");
  return result.data;
}
function body<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "VALIDATION_ERROR", "Request data is invalid");
  return result.data;
}

export function jobRoutes(app: FastifyInstance) {
  app.post("/api/v1/jobs", { preHandler: requireAuthentication }, async (request, reply) => {
    const result = await createJob(
      (request as AuthenticatedRequest).userId,
      body(jobCreateSchema, request.body)
    );
    return reply.status(result.job ? 201 : 201).send({
      job: result.job ? serializeJob(result.job) : null,
      scheduledJob: result.scheduledJob ? serializeScheduledJob(result.scheduledJob) : null
    });
  });

  app.post("/api/v1/jobs/batch", { preHandler: requireAuthentication }, async (request, reply) => {
    const input = body(batchSchema, request.body);
    const results = await createBatch((request as AuthenticatedRequest).userId, input.jobs);
    return reply.status(201).send({
      jobs: results.map((result) => (result.job ? serializeJob(result.job) : null)),
      scheduledJobs: results.flatMap((result) =>
        result.scheduledJob ? [serializeScheduledJob(result.scheduledJob)] : []
      )
    });
  });

  app.get("/api/v1/jobs", { preHandler: requireAuthentication }, async (request) => {
    const query = body(jobListQuerySchema, request.query);
    const result = await listJobs((request as AuthenticatedRequest).userId, query);
    return { jobs: result.jobs.map(serializeJob), nextCursor: result.nextCursor };
  });

  app.get("/api/v1/jobs/:id", { preHandler: requireAuthentication }, async (request) => {
    const job = await getJob(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    return { job: serializeJob(job) };
  });

  app.post("/api/v1/jobs/:id/cancel", { preHandler: requireAuthentication }, async (request) => {
    const job = await cancelJob(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    await recordAudit((request as AuthenticatedRequest).userId, "job.cancel", "Job", job.id);
    return { job: serializeJob(job) };
  });

  app.post("/api/v1/jobs/:id/retry", { preHandler: requireAuthentication }, async (request) => {
    const job = await retryJob(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    await recordAudit((request as AuthenticatedRequest).userId, "job.retry", "Job", job.id);
    return { job: serializeJob(job) };
  });
}
