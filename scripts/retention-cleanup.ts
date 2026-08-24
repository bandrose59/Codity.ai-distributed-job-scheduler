import { prisma } from "../packages/database/src/index.js";

const days = readDays();
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  const [logs, heartbeats, outbox] = await Promise.all([
    prisma.jobLog.count({ where: { createdAt: { lt: cutoff } } }),
    prisma.workerHeartbeat.count({ where: { recordedAt: { lt: cutoff } } }),
    prisma.outboxEvent.count({ where: { publishedAt: { not: null, lt: cutoff } } })
  ]);
  console.log(JSON.stringify({ dryRun, cutoff: cutoff.toISOString(), logs, heartbeats, publishedOutbox: outbox }, null, 2));
} else {
  const [logs, heartbeats, outbox] = await prisma.$transaction([
    prisma.jobLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.workerHeartbeat.deleteMany({ where: { recordedAt: { lt: cutoff } } }),
    prisma.outboxEvent.deleteMany({ where: { publishedAt: { not: null, lt: cutoff } } })
  ]);
  console.log(JSON.stringify({ dryRun, cutoff: cutoff.toISOString(), logs: logs.count, heartbeats: heartbeats.count, publishedOutbox: outbox.count }, null, 2));
}
await prisma.$disconnect();

function readDays(): number {
  const index = process.argv.indexOf("--days");
  const value = Number(index === -1 ? 30 : process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : 30;
}