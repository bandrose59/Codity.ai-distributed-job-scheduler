import { Prisma, QueueStatus } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@job-scheduler/database";

import { ApiError, notFound } from "../common/errors.js";
import { requireProjectAccess, requireProjectRole } from "../authorization.js";
import { queueCreateSchema, queueUpdateSchema, retryPolicySchema } from "./schemas.js";

const queueInclude = { retryPolicy: true } as const;

function handleQueueConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ApiError(409, "QUEUE_NAME_CONFLICT", "A queue with this name already exists");
  }
  throw error;
}

function retryPolicyData(policy: z.infer<typeof retryPolicySchema>) {
  return {
    strategy: policy.strategy,
    maxAttempts: policy.maxAttempts,
    initialDelayMs: policy.initialDelayMs,
    ...(policy.maxDelayMs !== undefined ? { maxDelayMs: policy.maxDelayMs } : {})
  };
}

export async function listQueues(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);
  return prisma.queue.findMany({
    where: { projectId, deletedAt: null },
    include: queueInclude,
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }]
  });
}

export async function getQueue(userId: string, queueId: string) {
  const queue = await prisma.queue.findFirst({
    where: {
      id: queueId,
      deletedAt: null,
      project: { organization: { members: { some: { userId } } } }
    },
    include: queueInclude
  });
  if (!queue) throw notFound("QUEUE_NOT_FOUND", "Queue not found");
  return queue;
}

export async function createQueue(
  userId: string,
  projectId: string,
  input: z.infer<typeof queueCreateSchema>
) {
  await requireProjectRole(userId, projectId);
  try {
    return await prisma.$transaction(async (transaction) => {
      const retryPolicy = input.retryPolicy
        ? await transaction.retryPolicy.create({ data: retryPolicyData(input.retryPolicy) })
        : null;
      return transaction.queue.create({
        data: {
          projectId,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
          priority: input.priority,
          concurrencyLimit: input.concurrencyLimit,
          ...(retryPolicy ? { retryPolicyId: retryPolicy.id } : {})
        },
        include: queueInclude
      });
    });
  } catch (error) {
    return handleQueueConflict(error);
  }
}

export async function updateQueue(
  userId: string,
  queueId: string,
  input: z.infer<typeof queueUpdateSchema>
) {
  const queue = await requireQueueRole(userId, queueId);
  try {
    return await prisma.$transaction(async (transaction) => {
      let retryPolicyId: string | null | undefined;
      if (input.retryPolicy !== undefined) {
        retryPolicyId = input.retryPolicy
          ? (await transaction.retryPolicy.create({ data: retryPolicyData(input.retryPolicy) })).id
          : null;
      }
      return transaction.queue.update({
        where: { id: queue.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.concurrencyLimit !== undefined
            ? { concurrencyLimit: input.concurrencyLimit }
            : {}),
          ...(retryPolicyId !== undefined ? { retryPolicyId } : {})
        },
        include: queueInclude
      });
    });
  } catch (error) {
    return handleQueueConflict(error);
  }
}

export async function requireQueueRole(userId: string, queueId: string) {
  const queue = await prisma.queue.findFirst({
    where: {
      id: queueId,
      deletedAt: null,
      project: { organization: { members: { some: { userId } } } }
    }
  });
  if (!queue) throw notFound("QUEUE_NOT_FOUND", "Queue not found");
  await requireProjectRole(userId, queue.projectId);
  return queue;
}

export async function archiveQueue(userId: string, queueId: string) {
  const queue = await requireQueueRole(userId, queueId);
  return prisma.queue.update({
    where: { id: queue.id },
    data: { deletedAt: new Date() },
    include: queueInclude
  });
}

export async function setQueueStatus(userId: string, queueId: string, status: QueueStatus) {
  const queue = await requireQueueRole(userId, queueId);
  return prisma.queue.update({ where: { id: queue.id }, data: { status }, include: queueInclude });
}

export async function queueStats(userId: string, queueId: string) {
  const queue = await getQueue(userId, queueId);
  const grouped = await prisma.job.groupBy({
    by: ["status"],
    where: { queueId: queue.id },
    _count: { _all: true }
  });
  const counts = Object.fromEntries(grouped.map((entry) => [entry.status, entry._count._all]));
  const deadLetterCount = await prisma.deadLetterJob.count({ where: { queueId: queue.id } });
  return {
    queueId: queue.id,
    jobs: {
      QUEUED: counts.QUEUED ?? 0,
      CLAIMED: counts.CLAIMED ?? 0,
      RUNNING: counts.RUNNING ?? 0,
      COMPLETED: counts.COMPLETED ?? 0,
      FAILED: counts.FAILED ?? 0,
      RETRYING: counts.RETRYING ?? 0
    },
    deadLetterJobs: deadLetterCount
  };
}
