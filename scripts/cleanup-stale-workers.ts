import { prisma } from "../packages/database/src/index.js";

const staleAfterMs = readNumberFlag("--stale-after-ms", 60 * 60 * 1000);
const dryRun = process.argv.includes("--dry-run");
const cutoff = new Date(Date.now() - staleAfterMs);

const staleWorkers = await prisma.worker.findMany({
  where: {
    status: { in: ["ACTIVE", "STARTING"] },
    OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null }]
  },
  select: { id: true, workerIdentifier: true, status: true, lastHeartbeatAt: true }
});

if (!dryRun && staleWorkers.length > 0) {
  await prisma.worker.updateMany({
    where: { id: { in: staleWorkers.map((worker) => worker.id) } },
    data: { status: "DEAD", stoppedAt: new Date() }
  });
}

console.log(JSON.stringify({
  dryRun,
  cutoff: cutoff.toISOString(),
  staleWorkers: staleWorkers.map(({ id, workerIdentifier, status, lastHeartbeatAt }) => ({ id, workerIdentifier, status, lastHeartbeatAt })),
  markedDead: dryRun ? 0 : staleWorkers.length
}, null, 2));

await prisma.$disconnect();

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}