import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { incrementReliabilityMetric } from "./reliability-metrics.js";
import { calculateRetryDelay } from "./retry-strategy.service.js";

export async function recoverExpiredJobs(batchSize: number): Promise<number> {
  const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM jobs
    WHERE lease_expires_at < NOW()
      AND status IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus")
    ORDER BY lease_expires_at ASC, id ASC
    LIMIT ${batchSize}
  `);
  let recovered = 0;
  for (const candidate of candidates) {
    if (await recoverExpiredJob(candidate.id)) recovered += 1;
  }
  return recovered;
}

export async function recoverExpiredJob(jobId: string): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const recovered = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${jobId}::text, 0))
      `);
      const job = await transaction.job.findFirst({
        where: {
          id: jobId,
          leaseExpiresAt: { lt: new Date() },
          status: { in: ["CLAIMED", "RUNNING"] }
        },
        include: {
          executions: { where: { status: "RUNNING" }, orderBy: { attempt: "desc" }, take: 1 }
        }
      });
      if (!job) return false;
      const execution = job.executions[0];
      if (execution) {
        await transaction.jobExecution.update({
          where: { id: execution.id },
          data: { status: "ABANDONED", completedAt: new Date(), error: "Lease expired" }
        });
        incrementReliabilityMetric("jobs_abandoned_total");
      }
      if (job.attemptCount < job.maxAttempts) {
        const delay = calculateRetryDelay(
          {
            strategy: job.retryStrategy ?? "FIXED",
            initialDelayMs: job.retryInitialDelayMs ?? 0,
            maxDelayMs: job.retryMaxDelayMs,
            jitterMs: job.retryJitterMs ?? 0
          },
          job.attemptCount
        );
        await transaction.job.update({
          where: { id: job.id },
          data: {
            status: "RETRYING",
            scheduledAt: new Date(Date.now() + delay),
            workerId: null,
            claimedAt: null,
            startedAt: null,
            leaseExpiresAt: null,
            lastError: "Lease expired",
            updatedAt: new Date()
          }
        });
        incrementReliabilityMetric("jobs_recovered_total");
      } else {
        await transaction.job.update({
          where: { id: job.id },
          data: {
            workerId: null,
            claimedAt: null,
            leaseExpiresAt: null,
            failedAt: new Date(),
            lastError: "Lease expired",
            updatedAt: new Date()
          }
        });
        await transaction.deadLetterJob.upsert({
          where: { jobId: job.id },
          update: {
            ...(execution ? { lastExecutionId: execution.id } : {}),
            reason: "Lease expired",
            attemptCount: job.attemptCount
          },
          create: {
            jobId: job.id,
            queueId: job.queueId,
            ...(execution ? { lastExecutionId: execution.id } : {}),
            reason: "Lease expired",
            attemptCount: job.attemptCount
          }
        });
        incrementReliabilityMetric("jobs_dlq_total");
      }
      return true;
    });
    if (recovered)
      console.info({ jobId, event: "job.recovered", recoveryLatency: Date.now() - startedAt });
    incrementReliabilityMetric("recovery_latency", Date.now() - startedAt);
    return recovered;
  } catch (error) {
    console.error({ jobId, event: "scheduler.error", error });
    return false;
  }
}
