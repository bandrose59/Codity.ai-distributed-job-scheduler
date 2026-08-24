export interface SchedulerSettings {
  schedulerId: string;
  pollIntervalMs: number;
  batchSize: number;
  shutdownTimeoutMs: number;
  heartbeatIntervalMs: number;
}
