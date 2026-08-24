import { randomUUID } from "node:crypto";

import { JobStatus, SchedulerStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@job-scheduler/database";

import { promoteDueJobs } from "./scheduling/delayed-job-scheduler.js";

import {
  processRecurringSchedule,
  promoteRecurringSchedules
} from "./scheduling/recurring-schedule-service.js";
import { SchedulerService, type OutboxPublisherLike } from "./scheduler/scheduler.service.js";
import type { SchedulerSettings } from "./scheduler/scheduler.types.js";

const suffix = randomUUID();
let queueId = "";
let projectId = "";
const createdJobIds: string[] = [];

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Phase 6 Organization ${suffix}` }
  });
  const project = await prisma.project.create({
    data: { organizationId: organization.id, name: `Phase 6 Project ${suffix}` }
  });
  projectId = project.id;
  const queue = await prisma.queue.create({
    data: { projectId, name: `phase6-${suffix}`, priority: 4, concurrencyLimit: 2 }
  });
  queueId = queue.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function scheduleSettings(id: string): SchedulerSettings {
  return {
    schedulerId: id,
    pollIntervalMs: 100,
    batchSize: 2,
    shutdownTimeoutMs: 2_000,
    heartbeatIntervalMs: 100
  };
}

async function createScheduledJob(nextRunAt: Date, overrides: Record<string, unknown> = {}) {
  return prisma.scheduledJob.create({
    data: {
      queueId,
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
      nextRunAt,
      payload: { value: suffix },
      jobType: "CRON",
      ...overrides
    }
  });
}

describe("scheduler engine", () => {
  it("promotes due one-time jobs but leaves future jobs scheduled", async () => {
    const due = await prisma.job.create({
      data: {
        queueId,
        type: "DELAYED",
        payload: {},
        status: JobStatus.SCHEDULED,
        maxAttempts: 1,
        scheduledAt: new Date(Date.now() - 1_000)
      }
    });
    const future = await prisma.job.create({
      data: {
        queueId,
        type: "SCHEDULED",
        payload: {},
        status: JobStatus.SCHEDULED,
        maxAttempts: 1,
        scheduledAt: new Date(Date.now() + 60_000)
      }
    });
    createdJobIds.push(due.id, future.id);
    expect(await promoteDueJobs(1_000, queueId)).toBeGreaterThanOrEqual(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: due.id } })).status).toBe(
      JobStatus.QUEUED
    );
    expect((await prisma.job.findUniqueOrThrow({ where: { id: future.id } })).status).toBe(
      JobStatus.SCHEDULED
    );
  });

  it("creates only one concrete occurrence with two concurrent schedulers", async () => {
    const schedule = await createScheduledJob(new Date(Date.now() - 60_000));

    const [first, second] = await Promise.all([
      processRecurringSchedule(schedule.id),
      processRecurringSchedule(schedule.id)
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);

    const jobs = await prisma.job.findMany({
      where: {
        idempotencyKey: {
          startsWith: `${schedule.id}:`
        }
      }
    });

    expect(jobs).toHaveLength(1);

    const updated = await prisma.scheduledJob.findUniqueOrThrow({
      where: { id: schedule.id }
    });

    expect(updated.lastRunAt).not.toBeNull();
    expect(updated.nextRunAt.getTime()).toBeGreaterThan(updated.lastRunAt!.getTime());
    expect(updated.enabled).toBe(true);

    createdJobIds.push(jobs[0]!.id);
  });

  it("advances overdue recurring schedules once and processes bounded batches", async () => {
    const schedules = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createScheduledJob(new Date(Date.now() - 1_000 - index * 10))
      )
    );
    expect(await promoteRecurringSchedules(2, queueId)).toBe(2);
    const firstPass = await prisma.scheduledJob.count({
      where: { id: { in: schedules.map((schedule) => schedule.id) }, lastRunAt: { not: null } }
    });
    expect(firstPass).toBe(2);
    expect(await promoteRecurringSchedules(10, queueId)).toBe(3);
    const updatedSchedules = await prisma.scheduledJob.findMany({
      where: { id: { in: schedules.map((schedule) => schedule.id) } }
    });
    expect(updatedSchedules.every((schedule) => schedule.nextRunAt > new Date())).toBe(true);
  });

  it("does not execute disabled schedules and promotes jobs for paused queues", async () => {
    const disabled = await createScheduledJob(new Date(Date.now() - 60_000), { enabled: false });
    expect(await processRecurringSchedule(disabled.id)).toBe(false);
    expect(
      await prisma.job.count({ where: { idempotencyKey: { startsWith: `${disabled.id}:` } } })
    ).toBe(0);
    await prisma.queue.update({ where: { id: queueId }, data: { status: "PAUSED" } });
    const pausedJob = await prisma.job.create({
      data: {
        queueId,
        type: "DELAYED",
        payload: {},
        status: JobStatus.SCHEDULED,
        maxAttempts: 1,
        scheduledAt: new Date(Date.now() - 1_000)
      }
    });
    createdJobIds.push(pausedJob.id);
    await promoteDueJobs(1_000, queueId);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: pausedJob.id } })).status).toBe(
      JobStatus.QUEUED
    );
    await prisma.queue.update({ where: { id: queueId }, data: { status: "ACTIVE" } });
  });

  it("registers, heartbeats, ticks, and shuts down gracefully", async () => {
    const service = new SchedulerService(scheduleSettings(`scheduler-${suffix}`));
    await service.start();
    const active = await prisma.scheduler.findUniqueOrThrow({
      where: { schedulerIdentifier: `scheduler-${suffix}` }
    });
    expect(active.status).toBe(SchedulerStatus.ACTIVE);
    expect(active.lastHeartbeatAt).not.toBeNull();
    await service.shutdown();
    const stopped = await prisma.scheduler.findUniqueOrThrow({
      where: { schedulerIdentifier: `scheduler-${suffix}` }
    });
    expect(stopped.status).toBe(SchedulerStatus.STOPPED);
  });

  it("connects and disconnects the outbox publisher during the scheduler lifecycle", async () => {
    const publisher = {
      connect: vi.fn(async () => undefined),
      publishBatch: vi.fn(async () => 0),
      disconnect: vi.fn(async () => undefined)
    };

    const service = new SchedulerService(scheduleSettings(`publisher-${suffix}`), publisher as OutboxPublisherLike);
    await service.start();
    expect(publisher.connect).toHaveBeenCalledTimes(1);

    await service.shutdown();
    expect(publisher.disconnect).toHaveBeenCalledTimes(1);
  });
});
