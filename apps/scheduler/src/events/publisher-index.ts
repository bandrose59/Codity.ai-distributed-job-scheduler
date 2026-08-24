import { env } from "@job-scheduler/config";
import { prisma } from "@job-scheduler/database";

import { OutboxPublisher } from "./outbox-publisher.js";

const publisher = new OutboxPublisher({ clientId: `outbox-${process.pid}` });
let stopping = false;

async function tick() {
  if (!stopping) await publisher.publishBatch();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await publisher.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await publisher.connect();
await tick();
const timer = setInterval(() => void tick(), env.SCHEDULER_POLL_INTERVAL_MS);
