import type { FastifyInstance } from "fastify";

import { requireAuthentication, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiError } from "../common/errors.js";
import { serializeQueue } from "./serializers.js";
import { queueCreateSchema, queueUpdateSchema } from "./schemas.js";
import {
  archiveQueue,
  createQueue,
  getQueue,
  listQueues,
  queueStats,
  setQueueStatus,
  updateQueue
} from "./service.js";
import { z } from "zod";
import { recordAudit } from "../common/audit.js";

const idSchema = z.uuid();
function id(value: string) {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new ApiError(400, "INVALID_ID", "Identifier is invalid");
  return result.data;
}
function body<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, "INVALID_QUEUE_CONFIGURATION", "Queue configuration is invalid");
  return result.data;
}

export function queueRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/projects/:projectId/queues",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const projectId = id((request.params as { projectId: string }).projectId);
      const queue = await createQueue(
        (request as AuthenticatedRequest).userId,
        projectId,
        body(queueCreateSchema, request.body)
      );
      return reply.status(201).send({ queue: serializeQueue(queue) });
    }
  );

  app.get(
    "/api/v1/projects/:projectId/queues",
    { preHandler: requireAuthentication },
    async (request) => {
      const queues = await listQueues(
        (request as AuthenticatedRequest).userId,
        id((request.params as { projectId: string }).projectId)
      );
      return { queues: queues.map(serializeQueue) };
    }
  );

  app.get("/api/v1/queues/:id", { preHandler: requireAuthentication }, async (request) => {
    const queue = await getQueue(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    return { queue: serializeQueue(queue) };
  });

  app.patch("/api/v1/queues/:id", { preHandler: requireAuthentication }, async (request) => {
    const queue = await updateQueue(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id),
      body(queueUpdateSchema, request.body)
    );
    return { queue: serializeQueue(queue) };
  });

  app.delete("/api/v1/queues/:id", { preHandler: requireAuthentication }, async (request) => {
    const queue = await archiveQueue(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id)
    );
    await recordAudit((request as AuthenticatedRequest).userId, "queue.archive", "Queue", queue.id);
    return { queue: serializeQueue(queue) };
  });

  app.post("/api/v1/queues/:id/pause", { preHandler: requireAuthentication }, async (request) => {
    const queue = await setQueueStatus(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id),
      "PAUSED"
    );
    await recordAudit((request as AuthenticatedRequest).userId, "queue.pause", "Queue", queue.id);
    return { queue: serializeQueue(queue) };
  });

  app.post("/api/v1/queues/:id/resume", { preHandler: requireAuthentication }, async (request) => {
    const queue = await setQueueStatus(
      (request as AuthenticatedRequest).userId,
      id((request.params as { id: string }).id),
      "ACTIVE"
    );
    await recordAudit((request as AuthenticatedRequest).userId, "queue.resume", "Queue", queue.id);
    return { queue: serializeQueue(queue) };
  });

  app.get("/api/v1/queues/:id/stats", { preHandler: requireAuthentication }, async (request) => {
    return {
      stats: await queueStats(
        (request as AuthenticatedRequest).userId,
        id((request.params as { id: string }).id)
      )
    };
  });
}
