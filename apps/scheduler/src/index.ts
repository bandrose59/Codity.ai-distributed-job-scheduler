import { randomUUID } from "node:crypto";
import os from "node:os";

import { env } from "@job-scheduler/config";
import { prisma } from "@job-scheduler/database";

import { SchedulerService } from "./scheduler/scheduler.service.js";
import type { SchedulerSettings } from "./scheduler/scheduler.types.js";

const settings: SchedulerSettings = {
  schedulerId: env.SCHEDULER_ID ?? `${os.hostname()}-${process.pid}-${randomUUID()}`,
  pollIntervalMs: env.SCHEDULER_POLL_INTERVAL_MS,
  batchSize: env.SCHEDULER_BATCH_SIZE,
  shutdownTimeoutMs: env.SCHEDULER_SHUTDOWN_TIMEOUT_MS,
  heartbeatIntervalMs: env.SCHEDULER_HEARTBEAT_INTERVAL_MS
};
const scheduler = new SchedulerService(settings);

async function shutdown(signal: NodeJS.Signals) {
  console.info({
    schedulerId: settings.schedulerId,
    signal,
    event: "scheduler.shutdown_requested"
  });
  await scheduler.shutdown();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await scheduler.start().catch(async (error: unknown) => {
  console.error({ schedulerId: settings.schedulerId, error }, "Scheduler failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
