import type { Job } from "@prisma/client";

export interface ExecutionResult {
  output?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  metadata?: Record<string, unknown>;
  retryable?: boolean;
}

export interface JobExecutor {
  execute(job: Job): Promise<ExecutionResult | void>;
}

export interface ExecutorRegistry {
  resolve(job: Job): JobExecutor;
}
