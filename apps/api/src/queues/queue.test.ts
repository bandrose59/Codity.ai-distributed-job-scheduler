import { randomUUID } from "node:crypto";

import { OrganizationRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@job-scheduler/database";

import { buildServer } from "../server.js";

const app = buildServer({ logger: false });
const suffix = randomUUID();
const ownerEmail = `phase3-owner-${suffix}@example.test`;
const memberEmail = `phase3-member-${suffix}@example.test`;
const outsiderEmail = `phase3-outsider-${suffix}@example.test`;
let ownerToken = "";
let memberToken = "";
let outsiderToken = "";
let projectId = "";
let queueId = "";
let outsiderProjectId = "";

beforeAll(async () => {
  await app.ready();
  const owner = await register(ownerEmail, "Phase Three Owner");
  ownerToken = owner.token;
  const member = await register(memberEmail, "Phase Three Member");
  memberToken = member.token;
  const outsider = await register(outsiderEmail, "Phase Three Outsider");
  outsiderToken = outsider.token;

  const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
  const ownerMembership = await prisma.organizationMember.findFirstOrThrow({
    where: { userId: ownerUser.id }
  });
  const memberMembership = await prisma.organizationMember.findFirstOrThrow({
    where: { userId: memberUser.id }
  });
  const project = await prisma.project.create({
    data: { organizationId: ownerMembership.organizationId, name: `Phase 3 Project ${suffix}` }
  });
  projectId = project.id;
  await prisma.organizationMember.create({
    data: {
      userId: memberUser.id,
      organizationId: ownerMembership.organizationId,
      role: OrganizationRole.MEMBER
    }
  });
  const outsiderProject = await prisma.project.create({
    data: { organizationId: memberMembership.organizationId, name: `Outsider Project ${suffix}` }
  });
  outsiderProjectId = outsiderProject.id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function register(email: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { name, email, password: "phase three password" }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { token: string };
}

describe("queue management", () => {
  it("creates, reads, and lists a queue with a retry policy", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: " email ",
        description: "Email processing",
        priority: 10,
        concurrencyLimit: 20,
        retryPolicy: {
          strategy: "EXPONENTIAL",
          maxAttempts: 5,
          initialDelayMs: 1000,
          maxDelayMs: 30000
        }
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().queue.name).toBe("email");
    expect(response.json().queue.retryPolicy.strategy).toBe("EXPONENTIAL");
    queueId = response.json().queue.id;

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().queues).toHaveLength(1);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(get.statusCode).toBe(200);
  });

  it("validates configuration and maps duplicate names to 409", async () => {
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "email" }
    });
    expect(duplicate.statusCode).toBe(409);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "bad",
        priority: -1,
        concurrencyLimit: 0,
        retryPolicy: { strategy: "FIXED", maxAttempts: 0, initialDelayMs: 2, maxDelayMs: 1 }
      }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("allows member reads but protects mutations and isolates organizations", async () => {
    const read = await app.inject({
      method: "GET",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${memberToken}` }
    });
    expect(read.statusCode).toBe(200);
    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { priority: 20 }
    });
    expect(update.statusCode).toBe(403);
    const outsider = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${outsiderToken}` }
    });
    expect(outsider.statusCode).toBe(404);
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${outsiderProjectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "forbidden" }
    });
    expect(create.statusCode).toBe(404);
  });

  it("supports idempotent pause/resume, stats, update, and archive", async () => {
    for (const action of ["pause", "pause", "resume", "resume"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/queues/${queueId}/${action}`,
        headers: { authorization: `Bearer ${ownerToken}` }
      });
      expect(response.statusCode).toBe(200);
    }
    const stats = await app.inject({
      method: "GET",
      url: `/api/v1/queues/${queueId}/stats`,
      headers: { authorization: `Bearer ${memberToken}` }
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().stats.jobs.QUEUED).toBe(0);
    expect(stats.json().stats.deadLetterJobs).toBe(0);
    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { description: "Updated" }
    });
    expect(update.statusCode).toBe(200);
    const archive = await app.inject({
      method: "DELETE",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(archive.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/queues`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(list.json().queues).toHaveLength(0);
    const archivedUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/queues/${queueId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { priority: 4 }
    });
    expect(archivedUpdate.statusCode).toBe(404);
  });
});
