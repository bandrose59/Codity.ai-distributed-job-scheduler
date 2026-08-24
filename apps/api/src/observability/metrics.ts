import { monitorEventLoopDelay, performance } from "node:perf_hooks";

type RequestMetric = { count: number; errors: number; durations: number[] };

const requests = new Map<string, RequestMetric>();
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

export function recordRequest(route: string, statusCode: number, durationMs: number): void {
  const metric = requests.get(route) ?? { count: 0, errors: 0, durations: [] };
  metric.count += 1;
  if (statusCode >= 400) metric.errors += 1;
  metric.durations.push(durationMs);
  if (metric.durations.length > 2_000) metric.durations.shift();
  requests.set(route, metric);
}

export function metricsSnapshot() {
  const routeMetrics = Object.fromEntries(
    [...requests.entries()].map(([route, metric]) => [route, {
      requestsTotal: metric.count,
      errorsTotal: metric.errors,
      errorRate: metric.count ? metric.errors / metric.count : 0,
      p50Ms: percentile(metric.durations, 0.5),
      p95Ms: percentile(metric.durations, 0.95),
      p99Ms: percentile(metric.durations, 0.99)
    }])
  );
  const memory = process.memoryUsage();
  return {
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      rssBytes: memory.rss,
      cpuUserMicros: process.cpuUsage().user,
      cpuSystemMicros: process.cpuUsage().system,
      eventLoopDelayMs: Number(eventLoopHistogram.mean) / 1e6,
      eventLoopP99Ms: Number(eventLoopHistogram.percentile(99)) / 1e6
    },
    http: { routes: routeMetrics }
  };
}

export function requestTimer(): number {
  return performance.now();
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0).toFixed(2));
}