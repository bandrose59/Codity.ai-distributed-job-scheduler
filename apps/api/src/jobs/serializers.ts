import type { Job, JobExecution, Project, Queue, ScheduledJob } from "@prisma/client";

export function serializeJob(job: Job & { queue?: Queue & { project?: Project }; executions?: Array<JobExecution & { logs?: Array<{ id: string; level: string; message: string; metadata: unknown; createdAt: Date; executionId: string | null }> }> }) {
  return {
    id: job.id,
    queue: job.queue
      ? {
          id: job.queue.id,
          name: job.queue.name,
          project: job.queue.project
            ? { id: job.queue.project.id, name: job.queue.project.name }
            : undefined
        }
      : undefined,
    queueId: job.queueId,
    type: job.type,
    status: job.status,
    priority: job.priority,
    payload: job.payload,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    scheduledAt: job.scheduledAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    claimedAt: job.claimedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
    lastError: job.lastError,
    executions: job.executions?.map((execution) => ({
      id: execution.id,
      attempt: execution.attempt,
      workerId: execution.workerId,
      status: execution.status,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
      durationMs: execution.durationMs,
      error: execution.error,
      createdAt: execution.createdAt.toISOString(),
      output: execution.output,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      metadata: execution.metadata,
      logs: execution.logs?.map((log) => ({
        id: log.id,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
        executionId: log.executionId
      }))
    }))
  };
}

export function serializeScheduledJob(schedule: ScheduledJob) {
  return {
    id: schedule.id,
    queueId: schedule.queueId,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    enabled: schedule.enabled,
    payload: schedule.payload,
    jobType: schedule.jobType,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString()
  };
}
