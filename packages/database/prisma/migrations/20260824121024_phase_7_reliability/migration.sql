-- AlterEnum
ALTER TYPE "JobExecutionStatus" ADD VALUE 'ABANDONED';

-- AlterTable
ALTER TABLE "dead_letter_jobs" ADD COLUMN     "retry_reason" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "retry_initial_delay_ms" INTEGER,
ADD COLUMN     "retry_jitter_ms" INTEGER,
ADD COLUMN     "retry_max_delay_ms" INTEGER,
ADD COLUMN     "retry_strategy" "RetryStrategy";
