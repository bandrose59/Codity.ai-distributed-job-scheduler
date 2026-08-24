import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuthentication, type AuthenticatedRequest } from "../auth/middleware.js";
import { ApiError } from "../common/errors.js";
import { serializeWorker } from "../common/serializers.js";
import { prisma } from "@job-scheduler/database";

const idSchema = z.uuid();

export function workerRoutes(app: FastifyInstance) {
  app.get("/api/v1/workers", { preHandler: requireAuthentication }, async (request) => {
    const userId = (request as AuthenticatedRequest).userId;
    const workers = await prisma.worker.findMany({
      where: {
        OR: [
          { jobs: { some: { queue: { project: { organization: { members: { some: { userId } } } } } } } },
          { executions: { some: { job: { queue: { project: { organization: { members: { some: { userId } } } } } } } } }
        ]
      },
      orderBy: [{ lastHeartbeatAt: "desc" }, { startedAt: "desc" }]
    });
    return { workers: workers.map(serializeWorker) };
  });

  app.get("/api/v1/workers/:id", { preHandler: requireAuthentication }, async (request) => {
    const id = idSchema.safeParse((request.params as { id: string }).id);
    if (!id.success) throw new ApiError(400, "INVALID_ID", "Identifier is invalid");

    const worker = await prisma.worker.findFirst({
      where: {
        id: id.data,
        OR: [
          { jobs: { some: { queue: { project: { organization: { members: { some: { userId: (request as AuthenticatedRequest).userId } } } } } } } },
          { executions: { some: { job: { queue: { project: { organization: { members: { some: { userId: (request as AuthenticatedRequest).userId } } } } } } } } }
        ]
      }
    });

    if (!worker) throw new ApiError(404, "WORKER_NOT_FOUND", "Worker not found");
    return { worker: serializeWorker(worker) };
  });
}
