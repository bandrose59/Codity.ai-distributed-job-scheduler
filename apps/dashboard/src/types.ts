export type JobStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "CLAIMED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING"
  | "CANCELLED";

export type JobType = "IMMEDIATE" | "DELAYED" | "SCHEDULED" | "CRON" | "BATCH";

export type QueueStatus = "ACTIVE" | "PAUSED";

export type WorkerStatus = "STARTING" | "ACTIVE" | "DRAINING" | "STOPPED" | "DEAD";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RetryPolicy {
  id: string;
  strategy: "FIXED" | "LINEAR" | "EXPONENTIAL";
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueSummary {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  priority: number;
  concurrencyLimit: number;
  status: QueueStatus;
  retryPolicy: RetryPolicy | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobExecutionSummary {
  id: string;
  attempt: number;
  workerId: string | null;
  status: "CLAIMED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "ABANDONED";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  output?: unknown;
  stdout?: string | null;
  stderr?: string | null;
  exitCode?: number | null;
  metadata?: unknown;
  logs?: JobLogSummary[];
}

export interface JobLogSummary {
  id: string;
  level: string;
  message: string;
  metadata: unknown;
  createdAt: string;
  executionId: string | null;
}

export interface JobSummary {
  id: string;
  queueId: string;
  queue?: {
    id: string;
    name: string;
    project?: { id: string; name: string };
  };
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown> | null;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  executions?: JobExecutionSummary[];
}

export interface WorkerSummary {
  id: string;
  workerIdentifier: string;
  hostname: string | null;
  processId: number | null;
  status: WorkerStatus;
  lastHeartbeatAt: string | null;
  startedAt: string;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  queueId: string;
  jobs: {
    QUEUED: number;
    CLAIMED: number;
    RUNNING: number;
    COMPLETED: number;
    FAILED: number;
    RETRYING: number;
  };
  deadLetterJobs: number;
}

export interface DashboardMetrics {
  activeWorkers: number;
  runningJobs: number;
  queuedJobs: number;
  failedLast24h: number;
  dlqJobs: number;
  successRate: number | null;
  trend: { time: string; completed: number; failed: number }[];
}

export interface AlertItem {
  id: string;
  severity: "INFO" | "WARN" | "ERROR";
  timestamp: string;
  source: string;
  message: string;
  relatedJobId?: string | null;
  relatedWorkerId?: string | null;
}
