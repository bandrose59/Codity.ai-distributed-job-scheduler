import type { FastifyInstance } from "fastify";

import { requireAuthentication, type AuthenticatedRequest } from "../auth/middleware.js";
import { prisma } from "@job-scheduler/database";

export function dashboardRoutes(app: FastifyInstance) {
  app.get("/api/v1/dashboard", { preHandler: requireAuthentication }, async (request) => {
    const userId = (request as AuthenticatedRequest).userId;

    const [activeWorkers, runningJobs, queuedJobs, failedLast24h, dlqJobs, recentJobs] = await Promise.all([
      prisma.worker.count({
        where: {
          status: "ACTIVE",
          jobs: { some: { queue: { project: { organization: { members: { some: { userId } } } } } } }
        }
      }),
      prisma.job.count({
        where: {
          status: "RUNNING",
          queue: { project: { organization: { members: { some: { userId } } } } }
        }
      }),
      prisma.job.count({
        where: {
          status: "QUEUED",
          queue: { project: { organization: { members: { some: { userId } } } } }
        }
      }),
      prisma.job.count({
        where: {
          status: "FAILED",
          failedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          queue: { project: { organization: { members: { some: { userId } } } } }
        }
      }),
      prisma.deadLetterJob.count({
        where: {
          queue: { project: { organization: { members: { some: { userId } } } } }
        }
      }),
      prisma.job.findMany({
        where: {
          queue: { project: { organization: { members: { some: { userId } } } } },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        select: { status: true, createdAt: true, completedAt: true, failedAt: true }
      })
    ]);

    const total = recentJobs.length;
    const completed = recentJobs.filter((job) => job.status === "COMPLETED").length;
    const successPercent = total > 0 ? (completed / total) * 100 : null;
    const trend = Array.from({ length: 6 }, (_, index) => {
      const bucketStart = new Date(Date.now() - (6 - index) * 4 * 60 * 60 * 1000);
      const bucketEnd = new Date(bucketStart.getTime() + 4 * 60 * 60 * 1000);
      const inBucket = recentJobs.filter((job) => {
        const timestamp = job.completedAt ?? job.failedAt ?? job.createdAt;
        return timestamp >= bucketStart && timestamp < bucketEnd;
      });

      return {
        time: bucketStart.toISOString().slice(11, 16),
        completed: inBucket.filter((job) => job.status === "COMPLETED").length,
        failed: inBucket.filter((job) => job.status === "FAILED").length
      };
    });

    return {
      metrics: {
        activeWorkers,
        runningJobs,
        queuedJobs,
        failedLast24h,
        dlqJobs,
        successRate: successPercent !== null ? Number(successPercent.toFixed(1)) : null,
        trend
      }
    };
  });

  app.get("/api/v1/dashboard/alerts", { preHandler: requireAuthentication }, async (request) => {
    const userId = (request as AuthenticatedRequest).userId;
    const failedJobs = await prisma.job.findMany({
      where: {
        status: "FAILED",
        failedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        queue: { project: { organization: { members: { some: { userId } } } } }
      },
      select: { id: true, failedAt: true, lastError: true, queue: { select: { name: true } } },
      orderBy: { failedAt: "desc" },
      take: 50
    });

    return {
      alerts: failedJobs.map((job) => ({
        id: `job-failure-${job.id}`,
        severity: "ERROR" as const,
        timestamp: (job.failedAt ?? new Date()).toISOString(),
        source: `queue:${job.queue.name}`,
        message: job.lastError ?? "Job failed without an error message",
        relatedJobId: job.id
      }))
    };
  });
}
