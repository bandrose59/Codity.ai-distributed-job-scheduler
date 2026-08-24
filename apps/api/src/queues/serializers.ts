import type { Queue, RetryPolicy } from "@prisma/client";

export function serializeRetryPolicy(policy: RetryPolicy | null) {
  if (!policy) return null;
  return {
    id: policy.id,
    strategy: policy.strategy,
    maxAttempts: policy.maxAttempts,
    initialDelayMs: policy.initialDelayMs,
    maxDelayMs: policy.maxDelayMs,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

export function serializeQueue(queue: Queue & { retryPolicy?: RetryPolicy | null }) {
  return {
    id: queue.id,
    projectId: queue.projectId,
    name: queue.name,
    description: queue.description,
    priority: queue.priority,
    concurrencyLimit: queue.concurrencyLimit,
    status: queue.status,
    retryPolicy: serializeRetryPolicy(queue.retryPolicy ?? null),
    createdAt: queue.createdAt.toISOString(),
    updatedAt: queue.updatedAt.toISOString()
  };
}
