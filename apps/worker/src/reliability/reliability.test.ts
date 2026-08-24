import { randomUUID } from "node:crypto";

import { JobStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@job-scheduler/database";

import { recoverExpiredJob } from "./recovery.service.js";
import { recordExecutionFailure } from "./retry.service.js";
import { calculateRetryDelay } from "./retry-strategy.service.js";

const suffix = randomUUID();
let queueId = "";
const workerId = `phase7-worker-${suffix}`;
let workerUuid = "";

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Phase 7 Organization ${suffix}` }
  });
  const project = await prisma.project.create({
    data: { organizationId: organization.id, name: `Phase 7 Project ${suffix}` }
  });
  const policy = await prisma.retryPolicy.create({
    data: { strategy: "FIXED", maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 500 }
  });
  const queue = await prisma.queue.create({
    data: {
      projectId: project.id,
      name: `phase7-${suffix}`,
      retryPolicyId: policy.id
    }
  });
  queueId = queue.id;
  const worker = await prisma.worker.create({
    data: { workerIdentifier: workerId, status: "ACTIVE", lastHeartbeatAt: new Date() }
  });
  workerUuid = worker.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retry reliability", () => {
  it("calculates fixed, linear, exponential, capped, and jittered delays", () => {
    expect(
      calculateRetryDelay({ strategy: "FIXED", initialDelayMs: 100, maxDelayMs: null }, 3)
    ).toBe(100);
    expect(
      calculateRetryDelay({ strategy: "LINEAR", initialDelayMs: 100, maxDelayMs: null }, 3)
    ).toBe(300);
    expect(
      calculateRetryDelay({ strategy: "EXPONENTIAL", initialDelayMs: 100, maxDelayMs: 250 }, 4)
    ).toBe(250);
    expect(
      calculateRetryDelay(
        { strategy: "FIXED", initialDelayMs: 100, maxDelayMs: null, jitterMs: 20 },
        1,
        () => 0.5
      )
    ).toBe(110);
  });

  it("schedules retry atomically and preserves execution history", async () => {
    const job = await prisma.job.create({
      data: {
        queueId,
        type: "IMMEDIATE",
        payload: {},
        status: JobStatus.RUNNING,
        maxAttempts: 3,
        attemptCount: 1,
        retryStrategy: "FIXED",
        retryInitialDelayMs: 50,
        retryMaxDelayMs: 500,
        retryJitterMs: 0,
        workerId: workerUuid
      }
    });
    const execution = await prisma.jobExecution.create({
      data: {
        jobId: job.id,
        workerId: workerUuid,
        attempt: 1,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 10)
      }
    });
    await recordExecutionFailure(job.id, execution.id, workerId, {
      message: "temporary outage",
      retryable: true
    });
    const updated = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updated.status).toBe(JobStatus.RETRYING);
    expect(updated.scheduledAt!.getTime()).toBeGreaterThan(Date.now() - 100);
    expect(
      (await prisma.jobExecution.findUniqueOrThrow({ where: { id: execution.id } })).status
    ).toBe("FAILED");
  });

  it("sends non-retryable and exhausted jobs to one DLQ row", async () => {
    const job = await prisma.job.create({
      data: {
        queueId,
        type: "IMMEDIATE",
        payload: {},
        status: JobStatus.RUNNING,
        maxAttempts: 1,
        attemptCount: 1,
        workerId: workerUuid
      }
    });
    const execution = await prisma.jobExecution.create({
      data: {
        jobId: job.id,
        workerId: workerUuid,
        attempt: 1,
        status: "RUNNING",
        startedAt: new Date()
      }
    });
    await recordExecutionFailure(job.id, execution.id, workerId, {
      message: "invalid payload",
      retryable: false
    });
    expect(await prisma.deadLetterJob.count({ where: { jobId: job.id } })).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      JobStatus.FAILED
    );
  });

  it("marks an expired running execution abandoned and schedules recovery once", async () => {
    const job = await prisma.job.create({
      data: {
        queueId,
        type: "IMMEDIATE",
        payload: {},
        status: JobStatus.RUNNING,
        maxAttempts: 2,
        attemptCount: 1,
        retryStrategy: "FIXED",
        retryInitialDelayMs: 0,
        retryJitterMs: 0,
        workerId: workerUuid,
        leaseExpiresAt: new Date(Date.now() - 1000)
      }
    });
    const execution = await prisma.jobExecution.create({
      data: {
        jobId: job.id,
        workerId: workerUuid,
        attempt: 1,
        status: "RUNNING",
        startedAt: new Date(Date.now() - 1000)
      }
    });
    expect(await recoverExpiredJob(job.id)).toBe(true);
    expect(await recoverExpiredJob(job.id)).toBe(false);
    expect(
      (await prisma.jobExecution.findUniqueOrThrow({ where: { id: execution.id } })).status
    ).toBe("ABANDONED");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      JobStatus.RETRYING
    );
  });
});
