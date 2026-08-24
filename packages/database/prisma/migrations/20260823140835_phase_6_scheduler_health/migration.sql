-- CreateEnum
CREATE TYPE "SchedulerStatus" AS ENUM ('STARTING', 'ACTIVE', 'DRAINING', 'STOPPED');

-- CreateTable
CREATE TABLE "schedulers" (
    "id" UUID NOT NULL,
    "scheduler_identifier" TEXT NOT NULL,
    "status" "SchedulerStatus" NOT NULL DEFAULT 'STARTING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "last_heartbeat_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedulers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedulers_scheduler_identifier_key" ON "schedulers"("scheduler_identifier");

-- CreateIndex
CREATE INDEX "schedulers_last_heartbeat_at_idx" ON "schedulers"("last_heartbeat_at");

-- CreateIndex
CREATE INDEX "schedulers_status_idx" ON "schedulers"("status");
