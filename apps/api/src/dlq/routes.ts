import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthentication, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiError } from "../common/errors.js";
import { serializeJob } from "../jobs/serializers.js";
import { getDeadLetter, listDeadLetters, retryDeadLetter } from "./service.js";
import { recordAudit } from "../common/audit.js";

function id(value: string) {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw new ApiError(400, "INVALID_ID", "Identifier is invalid");
  return result.data;
}

export function dlqRoutes(app: FastifyInstance) {
  app.get("/api/v1/dlq", { preHandler: requireAuthentication }, async (request) => {
    const query = request.query as { limit?: string; cursor?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));
    const result = await listDeadLetters(
      (request as AuthenticatedRequest).userId,
      limit,
      query.cursor ? id(query.cursor) : undefined
    );
    return {
      deadLetters: result.rows.map((row) => ({
        id: row.id,
        job: serializeJob(row.job),
        queueId: row.queueId,
        reason: row.reason,
        attemptCount: row.attemptCount,
        lastExecutionId: row.lastExecutionId,
        createdAt: row.createdAt.toISOString(),
        retriedAt: row.retriedAt?.toISOString() ?? null
      })),
      nextCursor: result.nextCursor
    };
  });

  app.get("/api/v1/dlq/:id", { preHandler: requireAuthentication }, async (request) => {
    const row = await getDeadLetter(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    return {
      deadLetter: {
        id: row.id,
        job: serializeJob(row.job),
        queueId: row.queueId,
        reason: row.reason,
        attemptCount: row.attemptCount,
        lastExecutionId: row.lastExecutionId,
        createdAt: row.createdAt.toISOString(),
        retriedAt: row.retriedAt?.toISOString() ?? null
      }
    };
  });

  app.post("/api/v1/dlq/:id/retry", { preHandler: requireAuthentication }, async (request) => {
    const job = await retryDeadLetter(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    await recordAudit((request as AuthenticatedRequest).userId, "dlq.retry", "DeadLetterJob", id((request.params as { id: string }).id));
    return { job: serializeJob(job) };
  });
}
