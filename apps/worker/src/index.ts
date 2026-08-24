import { randomUUID } from "node:crypto";
import os from "node:os";

import { env } from "@job-scheduler/config";
import { prisma } from "@job-scheduler/database";

import { WorkerService } from "./worker/worker.service.js";
import type { WorkerSettings } from "./worker/worker.types.js";
import { JobReadyConsumer } from "./events/job-ready-consumer.js";

const settings: WorkerSettings = {
  workerId: env.WORKER_ID ?? `${os.hostname()}-${process.pid}-${randomUUID()}`,
  concurrency: env.WORKER_CONCURRENCY,
  heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  jobLeaseMs: env.JOB_LEASE_MS,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS
};
const worker = new WorkerService(settings);
const consumer = new JobReadyConsumer(worker, settings.workerId);

async function shutdown(signal: NodeJS.Signals) {
  console.info({ workerId: settings.workerId, signal, event: "worker.shutdown_requested" });
  await worker.shutdown();
  await consumer.disconnect().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await worker.start().catch(async (error: unknown) => {
  console.error({ workerId: settings.workerId, error }, "Worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});

await consumer.connect().catch((error: unknown) => {
  console.error({ workerId: settings.workerId, event: "kafka.consumer_unavailable", error });
});
