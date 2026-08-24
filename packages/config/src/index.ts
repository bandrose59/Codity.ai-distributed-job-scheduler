import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().min(1).default("1h"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  KAFKA_BROKERS: z.string().min(1, "KAFKA_BROKERS is required"),
  WORKER_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).optional()
  ),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  JOB_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SCHEDULER_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).optional()
  ),
  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().positive().max(1_000).default(100),
  SCHEDULER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SCHEDULER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000)
  ,API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  JOB_CREATE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  BATCH_CREATE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().positive().max(10_000_000).default(1_000_000),
  API_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().email().optional()
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

export function getKafkaBrokers(source: Pick<AppEnv, "KAFKA_BROKERS">): string[] {
  return source.KAFKA_BROKERS.split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);
}

export const env = loadEnv();
