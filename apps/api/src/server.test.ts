import { randomUUID } from "node:crypto";

import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { OrganizationRole } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { prisma } from "@job-scheduler/database";
import { env } from "@job-scheduler/config";

import { buildServer } from "./server.js";

const app = buildServer();
const suffix = randomUUID();
const ownerEmail = `phase2-owner-${suffix}@example.test`;
const memberEmail = `phase2-member-${suffix}@example.test`;

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Phase 2 API", () => {
  it("exposes liveness, metrics, and dependency readiness endpoints", async () => {
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/metrics" })).json().process).toBeDefined();
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect([200, 503]).toContain(ready.statusCode);
    expect(ready.json().checks.postgresql).toBeDefined();
  });

  it("registers atomically and stores an Argon2id hash", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        name: "Phase Two Owner",
        email: ownerEmail.toUpperCase(),
        password: "correct horse battery staple"
      }
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe(ownerEmail);
    expect(response.json().user.passwordHash).toBeUndefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    expect(user.passwordHash).not.toBe("correct horse battery staple");
    expect(await argon2.verify(user.passwordHash, "correct horse battery staple")).toBe(true);
    expect(
      await prisma.organizationMember.count({
        where: { userId: user.id, role: OrganizationRole.OWNER }
      })
    ).toBe(1);
  });

  it("rejects duplicate email and invalid credentials", async () => {
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { name: "Duplicate", email: ownerEmail, password: "another password" }
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ownerEmail, password: "wrong password" }
    });
    expect(login.statusCode).toBe(401);
  });

  it("protects identity and organization routes with JWT", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(missing.statusCode).toBe(401);
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer invalid" }
    });
    expect(invalid.statusCode).toBe(401);
    const expired = jwt.sign({ sub: randomUUID() }, env.JWT_SECRET, { expiresIn: -1 });
    const expiredResponse = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${expired}` }
    });
    expect(expiredResponse.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ownerEmail, password: "correct horse battery staple" }
    });
    const token = login.json().token as string;
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(ownerEmail);

    const organizations = await app.inject({
      method: "GET",
      url: "/api/v1/organizations",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(organizations.statusCode).toBe(200);
    expect(organizations.json().organizations).toHaveLength(1);
  });

  it("enforces project tenant isolation, roles, and archive behavior", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const membership = await prisma.organizationMember.findFirstOrThrow({
      where: { userId: owner.id }
    });
    const memberResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { name: "Phase Two Member", email: memberEmail, password: "member password" }
    });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const memberOrganization = await prisma.organizationMember.findFirstOrThrow({
      where: { userId: member.id }
    });
    await prisma.organizationMember.create({
      data: {
        userId: member.id,
        organizationId: membership.organizationId,
        role: OrganizationRole.MEMBER
      }
    });

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${memberResponse.json().token}` },
      payload: { organizationId: membership.organizationId, name: "Member Project" }
    });
    expect(projectResponse.statusCode).toBe(201);
    const projectId = projectResponse.json().project.id as string;

    const privateProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${memberResponse.json().token}` },
      payload: { organizationId: memberOrganization.organizationId, name: "Private Project" }
    });
    expect(privateProjectResponse.statusCode).toBe(201);
    const privateProjectId = privateProjectResponse.json().project.id as string;

    const ownerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: ownerEmail, password: "correct horse battery staple" }
    });
    const ownerToken = ownerLogin.json().token as string;
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${memberResponse.json().token}` },
      payload: { name: "Nope" }
    });
    expect(forbidden.statusCode).toBe(403);
    const crossOrganization = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${privateProjectId}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(crossOrganization.statusCode).toBe(404);
    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}`,
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(archived.statusCode).toBe(200);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(listed.json().projects.some((project: { id: string }) => project.id === projectId)).toBe(
      false
    );
  });
});
