import { JobStatus, WorkerStatus } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { assertTransition } from "../state/job-state-machine.js";
import type { ExecutorRegistry } from "../execution/job-executor.js";
import { DefaultExecutorRegistry } from "../execution/executor-registry.js";
import { claimNextJob, type ClaimedJob } from "../claiming/job-claim.service.js";
import type { WorkerSettings } from "./worker.types.js";
import { recordExecutionFailure, type ClassifiedFailure } from "../reliability/retry.service.js";
import { recoverExpiredJobs } from "../reliability/recovery.service.js";

export class WorkerService {
  private readonly activeJobs = new Map<string, Promise<void>>();
  private pollTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private acceptingClaims = true;
  private polling = false;
  private started = false;

  constructor(
    private readonly settings: WorkerSettings,
    private readonly executorRegistry: ExecutorRegistry = new DefaultExecutorRegistry()
  ) {}

  get activeCount(): number {
    return this.activeJobs.size;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const now = new Date();
    await prisma.worker.upsert({
      where: { workerIdentifier: this.settings.workerId },
      update: {
        status: WorkerStatus.ACTIVE,
        startedAt: now,
        stoppedAt: null,
        lastHeartbeatAt: now
      },
      create: {
        workerIdentifier: this.settings.workerId,
        status: WorkerStatus.ACTIVE,
        startedAt: now,
        lastHeartbeatAt: now
      }
    });
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      this.settings.heartbeatIntervalMs
    );
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.settings.pollIntervalMs);
    console.info({ workerId: this.settings.workerId, event: "worker.started" });
  }

  async poll(): Promise<void> {
    if (!this.acceptingClaims || this.polling) return;
    this.polling = true;
    try {
      await recoverExpiredJobs(Math.max(1, this.settings.concurrency));
      while (this.acceptingClaims && this.activeJobs.size < this.settings.concurrency) {
        const claimed = await claimNextJob(
          this.settings.workerId,
          this.settings.jobLeaseMs,
          this.settings.queueId
        );
        if (!claimed) return;
        if (!this.acceptingClaims) return;
        const execution = this.execute(claimed);
        this.activeJobs.set(claimed.id, execution);
        void execution.finally(() => this.activeJobs.delete(claimed.id));
      }
    } finally {
      this.polling = false;
    }
  }

  async processReadyJob(jobId: string, queueId: string): Promise<void> {
    if (!this.acceptingClaims || this.activeJobs.size >= this.settings.concurrency) return;
    const claimed = await claimNextJob(
      this.settings.workerId,
      this.settings.jobLeaseMs,
      queueId,
      jobId
    );
    if (!claimed) return;
    const execution = this.execute(claimed);
    this.activeJobs.set(claimed.id, execution);
    void execution.finally(() => this.activeJobs.delete(claimed.id));
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.acceptingClaims = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await prisma.worker.update({
      where: { workerIdentifier: this.settings.workerId },
      data: { status: WorkerStatus.DRAINING }
    });
    console.info({
      workerId: this.settings.workerId,
      event: "worker.draining",
      activeJobs: this.activeJobs.size
    });
    const deadline = Date.now() + this.settings.shutdownTimeoutMs;
    while (this.activeJobs.size > 0 && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled(this.activeJobs.values()),
        new Promise((resolve) => setTimeout(resolve, 25))
      ]);
    }
    if (this.activeJobs.size > 0)
      console.warn({
        workerId: this.settings.workerId,
        event: "worker.shutdown_timeout",
        jobs: [...this.activeJobs.keys()]
      });
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await prisma.worker.update({
      where: { workerIdentifier: this.settings.workerId },
      data: { status: WorkerStatus.STOPPED, stoppedAt: new Date() }
    });
    console.info({ workerId: this.settings.workerId, event: "worker.stopped" });
    this.started = false;
  }

  private async heartbeat(): Promise<void> {
    const now = new Date();
    await prisma.$transaction([
      prisma.worker.update({
        where: { workerIdentifier: this.settings.workerId },
        data: { lastHeartbeatAt: now, status: WorkerStatus.ACTIVE }
      }),
      prisma.job.updateMany({
        where: { worker: { workerIdentifier: this.settings.workerId }, status: JobStatus.RUNNING },
        data: { leaseExpiresAt: new Date(now.getTime() + this.settings.jobLeaseMs), updatedAt: now }
      })
    ]);
    console.info({ workerId: this.settings.workerId, event: "worker.heartbeat" });
  }

  private async execute(claimed: ClaimedJob): Promise<void> {
    const startedAt = new Date();
    let executionId: string | undefined;
    try {
      const running = await prisma.$transaction(async (transaction) => {
        const job = await transaction.job.findUniqueOrThrow({ where: { id: claimed.id } });
        assertTransition(job.status, JobStatus.RUNNING);
        const attempt = job.attemptCount + 1;
        const execution = await transaction.jobExecution.create({
          data: {
            jobId: job.id,
            workerId: (
              await transaction.worker.findUniqueOrThrow({
                where: { workerIdentifier: this.settings.workerId }
              })
            ).id,
            attempt,
            status: JobStatus.RUNNING,
            startedAt
          }
        });
        executionId = execution.id;
        return transaction.job.update({
          where: { id: job.id },
          data: {
            status: JobStatus.RUNNING,
            attemptCount: attempt,
            startedAt,
            updatedAt: startedAt
          }
        });
      });
      console.info({
        workerId: this.settings.workerId,
        jobId: running.id,
        queueId: running.queueId,
        executionId,
        attempt: running.attemptCount,
        event: "job.started"
      });
      if (!executionId) throw new Error("Execution record was not created");
      const currentExecutionId = executionId;
      await this.appendLog(claimed.id, currentExecutionId, "INFO", "Executor started", {
        workerId: this.settings.workerId,
        attempt: running.attemptCount
      });
      const result = (await this.executorRegistry.resolve(running).execute(running)) ?? {};
      const completedAt = new Date();
      await prisma.$transaction(async (transaction) => {
        if (!executionId) throw new Error("Execution record was not created");
        const job = await transaction.job.findUniqueOrThrow({ where: { id: claimed.id } });
        assertTransition(job.status, JobStatus.COMPLETED);
        await transaction.jobExecution.update({
          where: { id: executionId },
          data: {
            status: "COMPLETED",
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            ...(result.output !== undefined ? { output: result.output as never } : {}),
            ...(result.stdout !== undefined ? { stdout: limitOutput(result.stdout) } : {}),
            ...(result.stderr !== undefined ? { stderr: limitOutput(result.stderr) } : {}),
            ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
            ...(result.metadata !== undefined ? { metadata: result.metadata as never } : {})
          }
        });
        await transaction.jobLog.create({
          data: {
            jobId: claimed.id,
            executionId: currentExecutionId,
            level: "INFO",
            message: "Executor completed",
            ...(result.output === undefined ? {} : { metadata: result.output as never })
          }
        });
        await transaction.job.updateMany({
          where: {
            id: claimed.id,
            worker: { workerIdentifier: this.settings.workerId },
            status: "RUNNING"
          },
          data: { status: "COMPLETED", completedAt, leaseExpiresAt: null, updatedAt: completedAt }
        });
      });
      console.info({
        workerId: this.settings.workerId,
        jobId: claimed.id,
        executionId,
        event: "job.completed"
      });
    } catch (error) {
      const completedAt = new Date();
      const message = error instanceof Error ? error.message : "Unknown executor failure";
      if (executionId) {
        const classified: ClassifiedFailure = {
          message,
          retryable:
            error instanceof Error && "retryable" in error ? error.retryable !== false : true
        };
        await recordExecutionFailure(
          claimed.id,
          executionId,
          this.settings.workerId,
          classified,
          completedAt
        );
        await this.appendLog(claimed.id, executionId, "ERROR", message);
      } else {
        console.error({
          workerId: this.settings.workerId,
          jobId: claimed.id,
          event: "job.claim_failure",
          error: message
        });
      }
      console.error({
        workerId: this.settings.workerId,
        jobId: claimed.id,
        executionId,
        event: "job.failed",
        error: message
      });
    }
  }

  private async appendLog(jobId: string, executionId: string, level: "INFO" | "ERROR", message: string, metadata?: Record<string, unknown>): Promise<void> {
    await prisma.jobLog.create({
      data: { jobId, executionId, level, message, ...(metadata ? { metadata: metadata as never } : {}) }
    });
  }
}

function limitOutput(value: string): string {
  return value.slice(0, 64_000);
}
