import { prisma } from "@job-scheduler/database";

import { ApiError, notFound } from "../common/errors.js";
import { requireProjectRole } from "../authorization.js";

const include = {
  job: {
    include: {
      queue: { include: { project: true } },
      executions: { orderBy: { attempt: "asc" as const } }
    }
  },
  lastExecution: true
} as const;
const jobInclude = {
  queue: { include: { project: true } },
  executions: { orderBy: { attempt: "asc" as const } }
} as const;

export async function listDeadLetters(userId: string, limit: number, cursor?: string) {
  const rows = await prisma.deadLetterJob.findMany({
    where: { queue: { project: { organization: { members: { some: { userId } } } } } },
    include,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { rows, nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null };
}

export async function getDeadLetter(userId: string, id: string) {
  const record = await prisma.deadLetterJob.findFirst({
    where: { id, queue: { project: { organization: { members: { some: { userId } } } } } },
    include
  });
  if (!record) throw notFound("DLQ_NOT_FOUND", "Dead-letter job not found");
  return record;
}

export async function retryDeadLetter(userId: string, id: string) {
  const record = await getDeadLetter(userId, id);
  await requireProjectRole(userId, record.job.queue.projectId);
  const updated = await prisma.$transaction(async (transaction) => {
    const current = await transaction.deadLetterJob.findUnique({
      where: { id },
      include: { job: true }
    });
    if (!current || current.retriedAt)
      throw new ApiError(409, "DLQ_ALREADY_RETRIED", "Dead-letter job was already retried");
    await transaction.deadLetterJob.update({ where: { id }, data: { retriedAt: new Date() } });
    return transaction.job.update({
      where: { id: current.jobId },
      data: {
        status: "QUEUED",
        workerId: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: new Date()
      },
      include: jobInclude
    });
  });
  return updated;
}
