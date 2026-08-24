/*
  Warnings:

  - A unique constraint covering the columns `[queue_id,idempotency_key]` on the table `jobs` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[queue_id,idempotency_key]` on the table `scheduled_jobs` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "scheduled_jobs" ADD COLUMN     "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "jobs_queue_id_idempotency_key_key" ON "jobs"("queue_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_queue_id_idempotency_key_key" ON "scheduled_jobs"("queue_id", "idempotency_key");
