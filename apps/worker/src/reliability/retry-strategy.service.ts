import type { RetryStrategy } from "@prisma/client";

export interface RetryConfiguration {
  strategy: RetryStrategy;
  initialDelayMs: number;
  maxDelayMs: number | null;
  jitterMs?: number;
}

export function calculateRetryDelay(
  configuration: RetryConfiguration,
  attempt: number,
  random = Math.random
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base =
    configuration.strategy === "FIXED"
      ? configuration.initialDelayMs
      : configuration.strategy === "LINEAR"
        ? configuration.initialDelayMs * safeAttempt
        : configuration.initialDelayMs * 2 ** (safeAttempt - 1);
  const bounded = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, base));
  const capped =
    configuration.maxDelayMs === null || configuration.maxDelayMs === undefined
      ? bounded
      : Math.min(bounded, Math.max(0, configuration.maxDelayMs));
  const jitter =
    configuration.jitterMs && configuration.jitterMs > 0
      ? Math.floor(random() * (configuration.jitterMs + 1))
      : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, capped + jitter);
}
