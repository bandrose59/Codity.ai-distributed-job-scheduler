import { randomUUID } from "node:crypto";

import { JobStatus, WorkerStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@job-scheduler/database";

import { DefaultExecutorRegistry } from "./execution/executor-registry.js";
import type { ExecutorRegistry, JobExecutor } from "./execution/job-executor.js";
import { claimNextJob } from "./claiming/job-claim.service.js";
import { WorkerService } from "./worker/worker.service.js";
import type { WorkerSettings } from "./worker/worker.types.js";

const suffix = randomUUID();
const workers: WorkerService[] = [];
let queueId = "";

class TrackingExecutorRegistry implements ExecutorRegistry {
  private readonly registry = new DefaultExecutorRegistry();
  active = 0;
  maxActive = 0;

  resolve(job: Parameters<ExecutorRegistry["resolve"]>[0]): JobExecutor {
    const executor = this.registry.resolve(job);
    return {
      execute: async (currentJob) => {
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
        try {
          await executor.execute(currentJob);
        } finally {
          this.active -= 1;
        }
      }
    };
  }
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Phase 5 Organization ${suffix}` }
  });
  const project = await prisma.project.create({
    data: { organizationId: organization.id, name: `Phase 5 Project ${suffix}` }
  });
  const queue = await prisma.queue.create({
    data: { projectId: project.id, name: `phase5-${suffix}`, priority: 1, concurrencyLimit: 2 }
  });
  queueId = queue.id;
});

afterAll(async () => {
  for (const worker of workers) await worker.shutdown();
  await prisma.$disconnect();
});

function settings(workerId: string, concurrency = 5): WorkerSettings {
  return {
    workerId,
    queueId,
    concurrency,
    heartbeatIntervalMs: 20,
    jobLeaseMs: 500,
    pollIntervalMs: 10,
    shutdownTimeoutMs: 2_000
  };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for worker state");
}

async function createJobs(count: number, priority = 1) {
  await prisma.job.createMany({
    data: Array.from({ length: count }, () => ({
      queueId,
      type: "IMMEDIATE",
      payload: { delayMs: 40 },
      priority,
      status: JobStatus.QUEUED,
      maxAttempts: 1
    }))
  });
}

describe("worker execution engine", () => {
  it("atomically claims and completes jobs across multiple workers", async () => {
    await createJobs(20);
    const tracker = new TrackingExecutorRegistry();
    const first = new WorkerService(settings(`worker-a-${suffix}`), tracker);
    const second = new WorkerService(settings(`worker-b-${suffix}`), tracker);
    workers.push(first, second);
    await Promise.all([first.start(), second.start()]);
    await waitFor(
      async () =>
        (await prisma.job.count({ where: { queueId, status: JobStatus.COMPLETED } })) === 20
    );
    expect(await prisma.jobExecution.count({ where: { job: { queueId } } })).toBe(20);
    expect(
      await prisma.jobExecution.groupBy({
        by: ["jobId"],
        where: { job: { queueId } },
        _count: { _all: true }
      })
    ).toHaveLength(20);
    expect(Math.max(first.activeCount, second.activeCount)).toBeLessThanOrEqual(5);
    expect(tracker.maxActive).toBeLessThanOrEqual(2);
    expect(
      await prisma.job.count({ where: { queueId, status: { not: JobStatus.COMPLETED } } })
    ).toBe(0);
    await Promise.all([first.shutdown(), second.shutdown()]);
  });

  it("enforces queue concurrency across workers and preserves priority order", async () => {
    const priorityJobs = await prisma.job.createManyAndReturn({
      data: [
        {
          queueId,
          type: "IMMEDIATE",
          payload: {},
          priority: 1,
          status: JobStatus.QUEUED,
          maxAttempts: 1
        },
        {
          queueId,
          type: "IMMEDIATE",
          payload: {},
          priority: 10,
          status: JobStatus.QUEUED,
          maxAttempts: 1
        },
        {
          queueId,
          type: "IMMEDIATE",
          payload: {},
          priority: 5,
          status: JobStatus.QUEUED,
          maxAttempts: 1
        }
      ],
      select: { id: true, priority: true }
    });
    const workerId = `worker-priority-${suffix}`;
    await prisma.worker.create({
      data: { workerIdentifier: workerId, status: WorkerStatus.ACTIVE, lastHeartbeatAt: new Date() }
    });
    const first = await claimNextJob(workerId, 1_000, queueId);
    expect(first?.priority).toBe(10);
    const second = await claimNextJob(workerId, 1_000, queueId);
    expect(second?.priority).toBe(5);
    expect(priorityJobs).toHaveLength(3);
    await prisma.job.updateMany({
      where: { id: { in: [first!.id, second!.id] } },
      data: { status: JobStatus.CANCELLED }
    });
  });

  it("does not claim paused queues and extends only owned leases", async () => {
    await prisma.queue.update({ where: { id: queueId }, data: { status: "PAUSED" } });
    await createJobs(1);
    const workerId = `worker-paused-${suffix}`;
    await prisma.worker.create({
      data: { workerIdentifier: workerId, status: WorkerStatus.ACTIVE, lastHeartbeatAt: new Date() }
    });
    expect(await claimNextJob(workerId, 1_000, queueId)).toBeNull();
    await prisma.queue.update({ where: { id: queueId }, data: { status: "ACTIVE" } });
  });

  it("records executor failures without stopping the worker", async () => {
    const failing = await prisma.job.create({
      data: {
        queueId,
        type: "IMMEDIATE",
        payload: { behavior: "fail" },
        status: JobStatus.QUEUED,
        maxAttempts: 1
      }
    });
    const succeeding = await prisma.job.create({
      data: { queueId, type: "IMMEDIATE", payload: {}, status: JobStatus.QUEUED, maxAttempts: 1 }
    });
    const worker = new WorkerService(settings(`worker-failure-${suffix}`, 2));
    workers.push(worker);
    await worker.start();
    await waitFor(
      async () =>
        (await prisma.job.findUniqueOrThrow({ where: { id: succeeding.id } })).status ===
        JobStatus.COMPLETED
    );
    expect((await prisma.job.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe(
      JobStatus.FAILED
    );
    expect(await prisma.jobExecution.count({ where: { jobId: failing.id } })).toBe(1);
    await worker.shutdown();
  });

  it("registers workers, heartbeats, leases, and drains gracefully", async () => {
    const workerId = `worker-lifecycle-${suffix}`;
    const worker = new WorkerService(settings(workerId, 1));
    workers.push(worker);
    await worker.start();
    await waitFor(
      async () =>
        (await prisma.worker.findUniqueOrThrow({ where: { workerIdentifier: workerId } }))
          .lastHeartbeatAt !== null
    );
    const record = await prisma.worker.findUniqueOrThrow({ where: { workerIdentifier: workerId } });
    expect(record.status).toBe(WorkerStatus.ACTIVE);
    const claimed = await prisma.job.create({
      data: { queueId, type: "IMMEDIATE", payload: {}, status: JobStatus.QUEUED, maxAttempts: 1 }
    });
    await waitFor(
      async () =>
        (await prisma.job.findUniqueOrThrow({ where: { id: claimed.id } })).status !==
        JobStatus.QUEUED
    );
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: claimed.id } })).leaseExpiresAt
    ).not.toBeNull();
    await worker.shutdown();
    expect(
      (await prisma.worker.findUniqueOrThrow({ where: { workerIdentifier: workerId } })).status
    ).toBe(WorkerStatus.STOPPED);
  });
});
