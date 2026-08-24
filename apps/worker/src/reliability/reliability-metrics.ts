export type ReliabilityMetric =
  | "jobs_retried_total"
  | "jobs_dlq_total"
  | "jobs_recovered_total"
  | "jobs_abandoned_total"
  | "retry_delay"
  | "recovery_latency";

const counters = new Map<ReliabilityMetric, number>();

export function incrementReliabilityMetric(metric: ReliabilityMetric, value = 1): void {
  counters.set(metric, (counters.get(metric) ?? 0) + value);
}

export function getReliabilityMetrics(): Record<ReliabilityMetric, number> {
  return Object.fromEntries(
    [
      "jobs_retried_total",
      "jobs_dlq_total",
      "jobs_recovered_total",
      "jobs_abandoned_total",
      "retry_delay",
      "recovery_latency"
    ].map((metric) => [metric, counters.get(metric as ReliabilityMetric) ?? 0])
  ) as Record<ReliabilityMetric, number>;
}
