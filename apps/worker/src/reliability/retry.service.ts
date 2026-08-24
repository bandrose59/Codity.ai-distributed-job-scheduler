import { JobExecutionStatus, JobStatus } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { incrementReliabilityMetric } from "./reliability-metrics.js";
import { calculateRetryDelay } from "./retry-strategy.service.js";

export interface ClassifiedFailure {
  message: string;
  retryable: boolean;
}

export async function recordExecutionFailure(
  jobId: string,
  executionId: string,
  workerId: string,
  failure: ClassifiedFailure,
  failedAt = new Date()
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const job = await transaction.job.findUniqueOrThrow({ where: { id: jobId } });
    const execution = await transaction.jobExecution.findUniqueOrThrow({
      where: { id: executionId }
    });
    if (execution.status !== JobExecutionStatus.RUNNING || job.status !== JobStatus.RUNNING) return;
    await transaction.jobExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        completedAt: failedAt,
        durationMs: failedAt.getTime() - execution.startedAt.getTime(),
        error: failure.message
      }
    });
    if (failure.retryable && job.attemptCount < job.maxAttempts) {
      const delay = calculateRetryDelay(
        {
          strategy: job.retryStrategy ?? "FIXED",
          initialDelayMs: job.retryInitialDelayMs ?? 0,
          maxDelayMs: job.retryMaxDelayMs,
          jitterMs: job.retryJitterMs ?? 0
        },
        job.attemptCount
      );
      const retryAt = new Date(failedAt.getTime() + delay);
      const updated = await transaction.job.updateMany({
        where: {
          id: jobId,
          workerId: (
            await transaction.worker.findUniqueOrThrow({
              where: { workerIdentifier: workerId },
              select: { id: true }
            })
          ).id,
          status: "RUNNING"
        },
        data: {
          status: "RETRYING",
          scheduledAt: retryAt,
          workerId: null,
          claimedAt: null,
          startedAt: null,
          leaseExpiresAt: null,
          failedAt,
          lastError: failure.message,
          updatedAt: failedAt
        }
      });
      if (updated.count === 1) incrementReliabilityMetric("jobs_retried_total");
      return;
    }
    await transaction.job.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "FAILED",
        failedAt,
        lastError: failure.message,
        leaseExpiresAt: null,
        updatedAt: failedAt
      }
    });
    await transaction.deadLetterJob.upsert({
      where: { jobId },
      update: {
        lastExecutionId: executionId,
        reason: failure.message,
        attemptCount: job.attemptCount
      },
      create: {
        jobId,
        queueId: job.queueId,
        lastExecutionId: executionId,
        reason: failure.message,
        attemptCount: job.attemptCount
      }
    });
    incrementReliabilityMetric("jobs_dlq_total");
  });
}
