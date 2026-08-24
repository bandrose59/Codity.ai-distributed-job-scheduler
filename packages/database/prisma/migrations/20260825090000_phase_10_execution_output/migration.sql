ALTER TABLE "job_executions"
ADD COLUMN "output" JSONB,
ADD COLUMN "stdout" TEXT,
ADD COLUMN "stderr" TEXT,
ADD COLUMN "exit_code" INTEGER,
ADD COLUMN "metadata" JSONB;