export interface WorkerSettings {
  workerId: string;
  queueId?: string;
  concurrency: number;
  heartbeatIntervalMs: number;
  jobLeaseMs: number;
  pollIntervalMs: number;
  shutdownTimeoutMs: number;
}
