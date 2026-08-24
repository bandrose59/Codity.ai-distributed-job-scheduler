-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "RetryStrategy" AS ENUM ('FIXED', 'LINEAR', 'EXPONENTIAL');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('IMMEDIATE', 'DELAYED', 'SCHEDULED', 'CRON', 'BATCH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobExecutionStatus" AS ENUM ('CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('STARTING', 'ACTIVE', 'DRAINING', 'STOPPED', 'DEAD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retry_policies" (
    "id" UUID NOT NULL,
    "strategy" "RetryStrategy" NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "initial_delay_ms" INTEGER NOT NULL,
    "max_delay_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retry_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "concurrency_limit" INTEGER NOT NULL DEFAULT 1,
    "status" "QueueStatus" NOT NULL DEFAULT 'ACTIVE',
    "retry_policy_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "worker_identifier" TEXT NOT NULL,
    "hostname" TEXT,
    "process_id" INTEGER,
    "status" "WorkerStatus" NOT NULL DEFAULT 'STARTING',
    "last_heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "queue_id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "worker_id" UUID,
    "last_error" TEXT,
    "idempotency_key" TEXT,
    "lease_expires_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_executions" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "worker_id" UUID,
    "attempt" INTEGER NOT NULL,
    "status" "JobExecutionStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_logs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "execution_id" UUID,
    "level" "JobLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" UUID NOT NULL,
    "queue_id" UUID NOT NULL,
    "cron_expression" TEXT,
    "timezone" TEXT,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "job_type" "JobType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letter_jobs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "queue_id" UUID NOT NULL,
    "last_execution_id" UUID,
    "reason" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retried_at" TIMESTAMP(3),

    CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");
CREATE UNIQUE INDEX "organization_members_user_id_organization_id_key" ON "organization_members"("user_id", "organization_id");
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");
CREATE INDEX "projects_deleted_at_idx" ON "projects"("deleted_at");
CREATE INDEX "queues_project_id_idx" ON "queues"("project_id");
CREATE INDEX "queues_retry_policy_id_idx" ON "queues"("retry_policy_id");
CREATE INDEX "queues_status_idx" ON "queues"("status");
CREATE INDEX "queues_deleted_at_idx" ON "queues"("deleted_at");
CREATE UNIQUE INDEX "queues_project_id_name_key" ON "queues"("project_id", "name");
CREATE INDEX "jobs_queue_id_status_priority_created_at_idx" ON "jobs"("queue_id", "status", "priority", "created_at");
CREATE INDEX "jobs_status_scheduled_at_idx" ON "jobs"("status", "scheduled_at");
CREATE INDEX "jobs_worker_id_idx" ON "jobs"("worker_id");
CREATE INDEX "jobs_idempotency_key_idx" ON "jobs"("idempotency_key");
CREATE INDEX "jobs_lease_expires_at_idx" ON "jobs"("lease_expires_at");
CREATE INDEX "job_executions_job_id_created_at_idx" ON "job_executions"("job_id", "created_at");
CREATE INDEX "job_executions_worker_id_created_at_idx" ON "job_executions"("worker_id", "created_at");
CREATE UNIQUE INDEX "job_executions_job_id_attempt_key" ON "job_executions"("job_id", "attempt");
CREATE INDEX "job_logs_job_id_created_at_idx" ON "job_logs"("job_id", "created_at");
CREATE INDEX "job_logs_execution_id_created_at_idx" ON "job_logs"("execution_id", "created_at");
CREATE INDEX "scheduled_jobs_queue_id_idx" ON "scheduled_jobs"("queue_id");
CREATE INDEX "scheduled_jobs_enabled_next_run_at_idx" ON "scheduled_jobs"("enabled", "next_run_at");
CREATE UNIQUE INDEX "workers_worker_identifier_key" ON "workers"("worker_identifier");
CREATE INDEX "workers_last_heartbeat_at_idx" ON "workers"("last_heartbeat_at");
CREATE INDEX "workers_status_idx" ON "workers"("status");
CREATE INDEX "worker_heartbeats_worker_id_recorded_at_idx" ON "worker_heartbeats"("worker_id", "recorded_at");
CREATE UNIQUE INDEX "dead_letter_jobs_job_id_key" ON "dead_letter_jobs"("job_id");
CREATE UNIQUE INDEX "dead_letter_jobs_last_execution_id_key" ON "dead_letter_jobs"("last_execution_id");
CREATE INDEX "dead_letter_jobs_queue_id_created_at_idx" ON "dead_letter_jobs"("queue_id", "created_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queues" ADD CONSTRAINT "queues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queues" ADD CONSTRAINT "queues_retry_policy_id_fkey" FOREIGN KEY ("retry_policy_id") REFERENCES "retry_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "job_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_heartbeats" ADD CONSTRAINT "worker_heartbeats_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_last_execution_id_fkey" FOREIGN KEY ("last_execution_id") REFERENCES "job_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check constraints
ALTER TABLE "queues" ADD CONSTRAINT "queues_priority_check" CHECK ("priority" >= 0);
ALTER TABLE "queues" ADD CONSTRAINT "queues_concurrency_limit_check" CHECK ("concurrency_limit" > 0);
ALTER TABLE "retry_policies" ADD CONSTRAINT "retry_policies_max_attempts_check" CHECK ("max_attempts" > 0);
ALTER TABLE "retry_policies" ADD CONSTRAINT "retry_policies_initial_delay_ms_check" CHECK ("initial_delay_ms" >= 0);
ALTER TABLE "retry_policies" ADD CONSTRAINT "retry_policies_max_delay_ms_check" CHECK ("max_delay_ms" IS NULL OR "max_delay_ms" >= "initial_delay_ms");
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_priority_check" CHECK ("priority" >= 0);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempt_count_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_max_attempts_check" CHECK ("max_attempts" > 0);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempt_count_max_attempts_check" CHECK ("attempt_count" <= "max_attempts");
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_attempt_check" CHECK ("attempt" > 0);
ALTER TABLE "job_executions" ADD CONSTRAINT "job_executions_duration_ms_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
ALTER TABLE "dead_letter_jobs" ADD CONSTRAINT "dead_letter_jobs_attempt_count_check" CHECK ("attempt_count" > 0);
