import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@job-scheduler/database";

import { ApiError } from "./common/errors.js";
import { serializeOrganization, serializeProject, serializeUser } from "./common/serializers.js";
import { requireAuthentication, type AuthenticatedRequest } from "./auth/middleware.js";
import { loginSchema, registerSchema } from "./auth/schemas.js";
import { loginUser, registerUser } from "./auth/service.js";
import {
  requireOrganizationMember,
  requireProjectAccess,
  requireProjectRole
} from "./authorization.js";
import { z } from "zod";
import { queueRoutes } from "./queues/routes.js";
import { dlqRoutes } from "./dlq/routes.js";
import { jobRoutes } from "./jobs/routes.js";
import { workerRoutes } from "./workers/routes.js";
import { dashboardRoutes } from "./dashboard/routes.js";
import { env } from "@job-scheduler/config";
import { allowRequest } from "./common/rate-limiter.js";
import { Kafka } from "kafkajs";
import { Redis } from "ioredis";
import { metricsSnapshot, recordRequest, requestTimer } from "./observability/metrics.js";

const idSchema = z.uuid();
const projectCreateSchema = z.object({
  organizationId: idSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional()
});
const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional()
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    "At least one field is required"
  );

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request data is invalid");
  }
  return result.data;
}

function parseId(value: string): string {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "INVALID_ID", "Identifier is invalid");
  }
  return result.data;
}

export function buildServer(options?: { logger?: boolean }) {
  const app = Fastify({
    logger: options?.logger ?? true,
    bodyLimit: env.API_BODY_LIMIT_BYTES,
    requestTimeout: env.API_REQUEST_TIMEOUT_MS
  });
  const requestStarts = new WeakMap<object, number>();

  app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"]
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id }
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id
      }
    });
  });

  app.addHook("onRequest", async (request, reply) => {
    requestStarts.set(request, requestTimer());
    const category = rateLimitCategory(request.method, request.url);
    const limit = category === "auth" ? env.AUTH_RATE_LIMIT_PER_MINUTE : category === "job-create" ? env.JOB_CREATE_RATE_LIMIT_PER_MINUTE : category === "batch-create" ? env.BATCH_CREATE_RATE_LIMIT_PER_MINUTE : env.API_RATE_LIMIT_PER_MINUTE;
    if (!(await allowRequest(`${request.ip}:${category}`, limit))) {
      reply.header("Retry-After", "60");
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Rate limit exceeded; retry after 60 seconds", requestId: request.id }
      });
    }
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  });

  app.addHook("onResponse", async (request, reply) => {
    const started = requestStarts.get(request);
    if (started !== undefined) recordRequest(request.routeOptions.url ?? request.url, reply.statusCode, requestTimer() - started);
  });

  app.get("/metrics", async () => metricsSnapshot());
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const checks = await dependencyChecks();
    const ready = checks.postgresql.status === "ok" && checks.redis.status === "ok" && checks.kafka.status === "ok";
    return reply.status(ready ? 200 : 503).send({ status: ready ? "ok" : "degraded", checks });
  });
  app.get("/health/details", async () => ({ status: "ok", checks: await dependencyChecks() }));

  app.post("/api/v1/auth/register", async (request, reply) => {
    const result = await registerUser(parseBody(registerSchema, request.body));
    return reply.status(201).send({ user: serializeUser(result.user), token: result.token });
  });

  app.post("/api/v1/auth/login", async (request) => {
    const result = await loginUser(parseBody(loginSchema, request.body));
    return { user: serializeUser(result.user), token: result.token };
  });

  app.get("/api/v1/auth/me", { preHandler: requireAuthentication }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: (request as AuthenticatedRequest).userId }
    });
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    return { user: serializeUser(user) };
  });

  app.get("/api/v1/organizations", { preHandler: requireAuthentication }, async (request) => {
    const organizations = await prisma.organization.findMany({
      where: { members: { some: { userId: (request as AuthenticatedRequest).userId } } },
      orderBy: { createdAt: "asc" }
    });
    return { organizations: organizations.map(serializeOrganization) };
  });

  app.get("/api/v1/organizations/:id", { preHandler: requireAuthentication }, async (request) => {
    const organizationId = parseId((request.params as { id: string }).id);
    await requireOrganizationMember((request as AuthenticatedRequest).userId, organizationId);
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
    return { organization: serializeOrganization(organization) };
  });

  app.post("/api/v1/projects", { preHandler: requireAuthentication }, async (request, reply) => {
    const input = parseBody(projectCreateSchema, request.body);
    await requireOrganizationMember((request as AuthenticatedRequest).userId, input.organizationId);
    const project = await prisma.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {})
      }
    });
    return reply.status(201).send({ project: serializeProject(project) });
  });

  app.get("/api/v1/projects", { preHandler: requireAuthentication }, async (request) => {
    const userId = (request as AuthenticatedRequest).userId;
    const projects = await prisma.project.findMany({
      where: { deletedAt: null, organization: { members: { some: { userId } } } },
      orderBy: { createdAt: "asc" }
    });
    return { projects: projects.map(serializeProject) };
  });

  app.get("/api/v1/projects/:id", { preHandler: requireAuthentication }, async (request) => {
    const project = await requireProjectAccess(
      (request as AuthenticatedRequest).userId,
      parseId((request.params as { id: string }).id)
    );
    return { project: serializeProject(project) };
  });

  app.patch("/api/v1/projects/:id", { preHandler: requireAuthentication }, async (request) => {
    const projectId = parseId((request.params as { id: string }).id);
    const input = parseBody(projectUpdateSchema, request.body);
    await requireProjectRole((request as AuthenticatedRequest).userId, projectId);
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      }
    });
    return { project: serializeProject(project) };
  });

  app.delete("/api/v1/projects/:id", { preHandler: requireAuthentication }, async (request) => {
    const projectId = parseId((request.params as { id: string }).id);
    await requireProjectRole((request as AuthenticatedRequest).userId, projectId);
    const project = await prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() }
    });
    return { project: serializeProject(project) };
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  queueRoutes(app);
  dlqRoutes(app);
  jobRoutes(app);
  workerRoutes(app);
  dashboardRoutes(app);

  return app;
}

function rateLimitCategory(method: string, url: string): string {
  const path = url.split("?", 1)[0];
  if (path === "/api/v1/auth/login" || path === "/api/v1/auth/register") return "auth";
  if (method === "POST" && path === "/api/v1/jobs/batch") return "batch-create";
  if (method === "POST" && path === "/api/v1/jobs") return "job-create";
  return "general";
}

async function dependencyChecks() {
  const postgresql = await checkDependency("postgresql", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  const redis = await checkDependency("redis", async () => {
    const client = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0 });
    try {
      await client.connect();
      await client.ping();
    } finally {
      await client.quit().catch(() => undefined);
    }
  });
  const kafka = await checkDependency("kafka", async () => {
    const kafkaClient = new Kafka({ clientId: `health-${process.pid}`, brokers: env.KAFKA_BROKERS.split(",") });
    const admin = kafkaClient.admin();
    try {
      await admin.connect();
      await admin.fetchTopicMetadata({ topics: ["jobs.ready"] });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  });
  return { postgresql, redis, kafka };
}

async function checkDependency(name: string, operation: () => Promise<void>) {
  const started = requestTimer();
  try {
    await operation();
    return { name, status: "ok", latencyMs: Number((requestTimer() - started).toFixed(2)), checkedAt: new Date().toISOString() };
  } catch (error) {
    return { name, status: "error", latencyMs: Number((requestTimer() - started).toFixed(2)), checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "dependency check failed" };
  }
}
