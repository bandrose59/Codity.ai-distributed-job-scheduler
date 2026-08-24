import { CronExpressionParser } from "cron-parser";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@job-scheduler/database";

import { ApiError, notFound } from "../common/errors.js";
import { requireProjectRole } from "../authorization.js";
import { jobCreateSchema, jobListQuerySchema } from "./schemas.js";

const jobInclude = {
  queue: { include: { project: true } },
  executions: {
    orderBy: { attempt: "asc" as const },
    include: { logs: { orderBy: { createdAt: "desc" as const }, take: 200 } }
  }
} as const;

type JobInput = z.infer<typeof jobCreateSchema>;

function validateSchedule(input: JobInput): Date | null {
  if (!input.scheduledAt) return null;
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    throw new ApiError(400, "INVALID_SCHEDULE", "scheduledAt must be a future timestamp");
  }
  return scheduledAt;
}

function validateCron(input: JobInput): Date {
  try {
    const parser = CronExpressionParser.parse(
      input.cronExpression!,
      input.timezone ? { tz: input.timezone } : undefined
    );
    return parser.next().toDate();
  } catch {
    throw new ApiError(400, "INVALID_CRON_EXPRESSION", "cronExpression is invalid");
  }
}

async function authorizedQueue(userId: string, queueId: string) {
  const queue = await prisma.queue.findFirst({
    where: {
      id: queueId,
      project: { organization: { members: { some: { userId } } } }
    },
    include: { retryPolicy: true }
  });
  if (!queue) throw notFound("QUEUE_NOT_FOUND", "Queue not found");
  if (queue.deletedAt)
    throw new ApiError(409, "QUEUE_ARCHIVED", "Archived queues cannot accept jobs");
  return queue;
}

function jobData(
  input: JobInput,
  queue: {
    id: string;
    priority: number;
    retryPolicy: {
      strategy: "FIXED" | "LINEAR" | "EXPONENTIAL";
      maxAttempts: number;
      initialDelayMs: number;
      maxDelayMs: number | null;
    } | null;
  },
  scheduledAt: Date | null
) {
  const status: JobStatus =
    input.type === "IMMEDIATE" || input.type === "BATCH" ? "QUEUED" : "SCHEDULED";
  return {
    queueId: queue.id,
    type: input.type as JobType,
    payload: input.payload === null ? Prisma.JsonNull : (input.payload as Prisma.InputJsonValue),
    priority: input.priority ?? queue.priority,
    status,
    attemptCount: 0,
    maxAttempts: queue.retryPolicy?.maxAttempts ?? 1,
    ...(queue.retryPolicy
      ? {
          retryStrategy: queue.retryPolicy.strategy,
          retryInitialDelayMs: queue.retryPolicy.initialDelayMs,
          retryMaxDelayMs: queue.retryPolicy.maxDelayMs
        }
      : {}),
    retryJitterMs: 0,
    scheduledAt,
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {})
  };
}

async function createOne(
  transaction: Prisma.TransactionClient,
  input: JobInput,
  queue: Awaited<ReturnType<typeof authorizedQueue>>
) {
  const scheduledAt = input.type === "CRON" ? null : validateSchedule(input);
  if (input.type === "IMMEDIATE" && input.scheduledAt) {
    throw new ApiError(400, "INVALID_SCHEDULE", "Immediate jobs cannot have scheduledAt");
  }
  if ((input.type === "DELAYED" || input.type === "SCHEDULED") && !scheduledAt) {
    throw new ApiError(400, "INVALID_SCHEDULE", "scheduledAt is required");
  }
  if (input.type === "CRON") {
    const nextRunAt = validateCron(input);
    return {
      job: null,
      scheduledJob: await transaction.scheduledJob.create({
        data: {
          queueId: queue.id,
          ...(input.cronExpression !== undefined ? { cronExpression: input.cronExpression } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          nextRunAt,
          payload:
            input.payload === null ? Prisma.JsonNull : (input.payload as Prisma.InputJsonValue),
          jobType: "CRON",
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {})
        }
      })
    };
  }
  const job = await transaction.job.create({
      data: jobData(input, queue, scheduledAt),
      include: jobInclude
    });
  await transaction.outboxEvent.create({
    data: {
      eventType: "JOB_READY",
      aggregateType: "Job",
      aggregateId: job.id,
      payload: { eventId: job.id, eventType: "JOB_READY", jobId: job.id, queueId: job.queueId, createdAt: job.createdAt.toISOString() }
    }
  });
  return { job, scheduledJob: null };
}

export async function createJob(userId: string, input: JobInput) {
  const queue = await authorizedQueue(userId, input.queueId);
  if (input.idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: {
        queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: input.idempotencyKey }
      },
      include: jobInclude
    });
    if (existing) return { job: existing, scheduledJob: null };
    const existingSchedule = await prisma.scheduledJob.findUnique({
      where: { queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: input.idempotencyKey } }
    });
    if (existingSchedule) return { job: null, scheduledJob: existingSchedule };
  }
  try {
    return await prisma.$transaction((transaction) => createOne(transaction, input, queue));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      input.idempotencyKey
    ) {
      const existing = await prisma.job.findUnique({
        where: {
          queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: input.idempotencyKey }
        },
        include: jobInclude
      });
      if (existing) return { job: existing, scheduledJob: null };
      const existingSchedule = await prisma.scheduledJob.findUnique({
        where: {
          queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: input.idempotencyKey }
        }
      });
      if (existingSchedule) return { job: null, scheduledJob: existingSchedule };
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key conflicts with another request"
      );
    }
    throw error;
  }
}

export async function createBatch(userId: string, inputs: JobInput[]) {
  const queues = new Map<string, Awaited<ReturnType<typeof authorizedQueue>>>();
  for (const input of inputs)
    queues.set(input.queueId, await authorizedQueue(userId, input.queueId));
  return prisma.$transaction(async (transaction) => {
    const results = [];
    for (const input of inputs) {
      const queue = queues.get(input.queueId)!;
      if (input.idempotencyKey) {
        const existing = await transaction.job.findUnique({
          where: {
            queueId_idempotencyKey: { queueId: queue.id, idempotencyKey: input.idempotencyKey }
          },
          include: jobInclude
        });
        if (existing) {
          results.push({ job: existing, scheduledJob: null });
          continue;
        }
      }
      results.push(await createOne(transaction, input, queue));
    }
    return results;
  });
}

export async function getJob(userId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, queue: { project: { organization: { members: { some: { userId } } } } } },
    include: jobInclude
  });
  if (!job) throw notFound("JOB_NOT_FOUND", "Job not found");
  return job;
}

export async function listJobs(userId: string, query: z.infer<typeof jobListQuerySchema>) {
  const where: Prisma.JobWhereInput = {
    queue: {
      deletedAt: null,
      ...(query.queueId ? { id: query.queueId } : {}),
      project: { organization: { members: { some: { userId } } } }
    },
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.priority !== undefined ? { priority: query.priority } : {}),
    ...(query.workerId ? { workerId: query.workerId } : {}),
    ...(query.createdFrom || query.createdTo
      ? {
          createdAt: {
            ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
            ...(query.createdTo ? { lte: new Date(query.createdTo) } : {})
          }
        }
      : {})
  };
  const jobs = await prisma.job.findMany({
    where,
    include: jobInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
  });
  const hasMore = jobs.length > query.limit;
  if (hasMore) jobs.pop();
  return { jobs, nextCursor: hasMore ? (jobs.at(-1)?.id ?? null) : null };
}

export async function cancelJob(userId: string, jobId: string) {
  const job = await getJob(userId, jobId);
  if (job.status === "COMPLETED")
    throw new ApiError(409, "JOB_ALREADY_COMPLETED", "Completed jobs cannot be cancelled");
  if (job.status === "RUNNING")
    throw new ApiError(409, "JOB_ALREADY_RUNNING", "Running jobs cannot be force-cancelled");
  if (job.status !== "QUEUED" && job.status !== "SCHEDULED")
    throw new ApiError(409, "JOB_NOT_CANCELLABLE", "Job cannot be cancelled in its current state");
  return prisma.job.update({
    where: { id: job.id },
    data: { status: "CANCELLED", updatedAt: new Date() },
    include: jobInclude
  });
}

export async function retryJob(userId: string, jobId: string) {
  const job = await getJob(userId, jobId);
  await requireProjectRole(userId, job.queue.projectId);
  const deadLetter = await prisma.deadLetterJob.findUnique({ where: { jobId: job.id } });
  if (job.status !== "FAILED" && !deadLetter)
    throw new ApiError(
      409,
      "JOB_NOT_RETRYABLE",
      "Only failed or dead-lettered jobs can be manually retried"
    );
  return prisma.job.update({
    where: { id: job.id },
    data: {
      status: "QUEUED",
      workerId: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      leaseExpiresAt: null,
      lastError: null
    },
    include: jobInclude
  });
}
