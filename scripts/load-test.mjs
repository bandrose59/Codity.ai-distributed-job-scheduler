const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const args = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (!value.startsWith("--")) return pairs;
  pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const target = args.get("target") ?? process.env.TARGET ?? "/health";
const concurrency = Number(args.get("concurrency") ?? process.env.CONCURRENCY ?? 100);
const durationMs = Number(args.get("duration-ms") ?? process.env.DURATION_MS ?? 10_000);
const samples = [];
let errors = 0;
let completed = 0;

async function request() {
  const started = globalThis.performance.now();
  try {
    const response = await globalThis.fetch(`${baseUrl}${target}`);
    if (!response.ok) errors += 1;
  } catch {
    errors += 1;
  } finally {
    samples.push(globalThis.performance.now() - started);
    completed += 1;
  }
}

const deadline = Date.now() + durationMs;
while (Date.now() < deadline) {
  await Promise.all(Array.from({ length: concurrency }, request));
}

samples.sort((a, b) => a - b);
const percentile = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
console.log(JSON.stringify({
  baseUrl,
  target,
  concurrency,
  durationMs,
  requests: completed,
  requestsPerSecond: completed / (durationMs / 1000),
  errors,
  errorRate: completed ? errors / completed : 0,
  p50Ms: Number(percentile(0.5).toFixed(2)),
  p95Ms: Number(percentile(0.95).toFixed(2)),
  p99Ms: Number(percentile(0.99).toFixed(2))
}, null, 2));