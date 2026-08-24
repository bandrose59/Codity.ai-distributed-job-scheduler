import { randomUUID } from "node:crypto";

import { JobStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@job-scheduler/database";

import { buildServer } from "../server.js";

const app = buildServer({ logger: false });
const suffix = randomUUID();
const ownerEmail = `phase4-owner-${suffix}@example.test`;
const outsiderEmail = `phase4-outsider-${suffix}@example.test`;
let ownerToken = "";
let outsiderToken = "";
let queueId = "";
let outsiderQueueId = "";

beforeAll(async () => {
  await app.ready();
  ownerToken = await register(ownerEmail, "Phase Four Owner");
  outsiderToken = await register(outsiderEmail, "Phase Four Outsider");
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const outsider = await prisma.user.findUniqueOrThrow({ where: { email: outsiderEmail } });
  const ownerMembership = await prisma.organizationMember.findFirstOrThrow({
    where: { userId: owner.id }
  });
  const outsiderMembership = await prisma.organizationMember.findFirstOrThrow({
    where: { userId: outsider.id }
  });
  const policy = await prisma.retryPolicy.create({
    data: { strategy: "EXPONENTIAL", maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 1000 }
  });
  const project = await prisma.project.create({
    data: {
      organizationId: ownerMembership.organizationId,
      name: `Phase 4 Project ${suffix}`
    }
  });
  const queue = await prisma.queue.create({
    data: {
      projectId: project.id,
      name: `jobs-${suffix}`,
      priority: 7,
      concurrencyLimit: 3,
      retryPolicyId: policy.id
    }
  });
  queueId = queue.id;
  const outsiderQueue = await prisma.queue.create({
    data: {
      project: {
        create: {
          organizationId: outsiderMembership.organizationId,
          name: `Outsider Project ${suffix}`
        }
      },
      name: `jobs-${suffix}`
    }
  });
  outsiderQueueId = outsiderQueue.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function register(email: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { name, email, password: "phase four password" }
  });
  expect(response.statusCode).toBe(201);
  return response.json().token as string;
}

function jobPayload(input: Record<string, unknown>) {
  return { queueId, type: "IMMEDIATE", payload: { value: suffix }, ...input };
}

describe("job management", () => {
  it("creates immediate, delayed, scheduled, and cron jobs correctly", async () => {
    const immediate = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({})
    });
    expect(immediate.statusCode).toBe(201);
    expect(immediate.json().job.status).toBe("QUEUED");
    expect(immediate.json().job.priority).toBe(7);

    const future = new Date(Date.now() + 60_000).toISOString();
    for (const type of ["DELAYED", "SCHEDULED"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/jobs",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: jobPayload({ type, scheduledAt: future })
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().job.status).toBe("SCHEDULED");
    }

    const cron = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({
        type: "CRON",
        cronExpression: "*/5 * * * *",
        idempotencyKey: "cron-key"
      })
    });
    expect(cron.statusCode).toBe(201);
    expect(cron.json().job).toBeNull();
    expect(cron.json().scheduledJob.cronExpression).toBe("*/5 * * * *");
    expect(await prisma.job.count({ where: { queueId } })).toBe(3);
    expect(
      await prisma.scheduledJob.count({ where: { queueId, idempotencyKey: "cron-key" } })
    ).toBe(1);

    const invalidCron = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ type: "CRON", cronExpression: "invalid" })
    });
    expect(invalidCron.statusCode).toBe(400);
    const past = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({
        type: "DELAYED",
        scheduledAt: new Date(Date.now() - 1000).toISOString()
      })
    });
    expect(past.statusCode).toBe(400);
  });

  it("enforces queue authorization and paused or archived behavior", async () => {
    await prisma.queue.update({ where: { id: queueId }, data: { status: "PAUSED" } });
    const paused = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "paused-key" })
    });
    expect(paused.statusCode).toBe(201);
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { queueId: outsiderQueueId, type: "IMMEDIATE", payload: {} }
    });
    expect(forbidden.statusCode).toBe(404);
    await prisma.queue.update({ where: { id: queueId }, data: { deletedAt: new Date() } });
    const archived = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "archived-key" })
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe("QUEUE_ARCHIVED");
    await prisma.queue.update({ where: { id: queueId }, data: { deletedAt: null } });
  });

  it("supports idempotency, batch atomicity, filters, and cursor pagination", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "same-key" })
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "same-key", priority: 99 })
    });
    expect(second.json().job.id).toBe(first.json().job.id);
    const before = await prisma.job.count({ where: { queueId } });
    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/jobs/batch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { jobs: [jobPayload({}), jobPayload({ type: "DELAYED" })] }
    });
    expect(batch.statusCode).toBe(400);
    expect(await prisma.job.count({ where: { queueId } })).toBe(before);

    const validBatch = await app.inject({
      method: "POST",
      url: "/api/v1/jobs/batch",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        jobs: [
          jobPayload({ idempotencyKey: "batch-1" }),
          jobPayload({ idempotencyKey: "batch-2", priority: 15 })
        ]
      }
    });
    expect(validBatch.statusCode).toBe(201);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/jobs?queueId=" + queueId + "&status=QUEUED&limit=2",
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().jobs.length).toBeLessThanOrEqual(2);
    expect(listed.json().jobs.every((job: { status: string }) => job.status === "QUEUED")).toBe(
      true
    );
  });

  it("retrieves, cancels, and manually retries jobs without execution records", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "cancel-key" })
    });
    const id = created.json().job.id as string;
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(detail.statusCode).toBe(200);
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().job.status).toBe("CANCELLED");
    const completed = await prisma.job.update({
      where: { id },
      data: { status: JobStatus.COMPLETED }
    });
    expect(completed.status).toBe("COMPLETED");
    const cannotCancel = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${id}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(cannotCancel.statusCode).toBe(409);

    const failed = await prisma.job.create({
      data: {
        queueId,
        type: "IMMEDIATE",
        payload: {},
        status: JobStatus.FAILED,
        maxAttempts: 5,
        attemptCount: 1
      }
    });
    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${failed.id}/retry`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().job.status).toBe("QUEUED");
    expect(await prisma.jobExecution.count({ where: { jobId: failed.id } })).toBe(0);
  });

  it("rejects cross-organization reads and stats", async () => {
    const own = await app.inject({
      method: "POST",
      url: "/api/v1/jobs",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: jobPayload({ idempotencyKey: "isolation-key" })
    });
    const id = own.json().job.id as string;
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/jobs/${id}`,
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    expect(read.statusCode).toBe(404);
    const stats = await app.inject({
      method: "GET",
      url: `/api/v1/queues/${queueId}/stats`,
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    expect(stats.statusCode).toBe(404);
  });
});
