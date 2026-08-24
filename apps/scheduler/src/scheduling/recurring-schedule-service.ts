import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

import { nextCronOccurrence } from "./cron-calculator.js";

interface DueSchedule {
  id: string;
  queue_id: string;
  cron_expression: string;
  timezone: string | null;
  next_run_at: Date;
  payload: Prisma.JsonValue;
  job_type: "CRON";
  queue_priority: number;
  max_attempts: number | null;
}

export async function promoteRecurringSchedules(
  batchSize: number,
  queueId?: string
): Promise<number> {
  const schedules = queueId
    ? await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM scheduled_jobs
        WHERE queue_id = ${queueId}::uuid AND enabled = true AND next_run_at <= NOW()
        ORDER BY next_run_at ASC, id ASC LIMIT ${batchSize}
      `)
    : await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM scheduled_jobs
        WHERE enabled = true AND next_run_at <= NOW()
        ORDER BY next_run_at ASC, id ASC LIMIT ${batchSize}
      `);
  let processed = 0;
  for (const schedule of schedules) {
    if (await processRecurringSchedule(schedule.id)) processed += 1;
  }
  return processed;
}

export async function processRecurringSchedule(scheduleId: string): Promise<boolean> {
  try {
    console.log(`[${scheduleId}] 1. transaction start`);

    return await prisma.$transaction(async (transaction) => {
      console.log(`[${scheduleId}] 2. acquiring advisory lock`);

      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${scheduleId}, 0))
      `);

      console.log(`[${scheduleId}] 3. advisory lock acquired`);

      const rows = await transaction.$queryRaw<DueSchedule[]>(Prisma.sql`
        SELECT s.id, s.queue_id, s.cron_expression, s.timezone, s.next_run_at,
          s.payload, s.job_type, q.priority AS queue_priority,
          rp.max_attempts
        FROM scheduled_jobs s
        INNER JOIN queues q ON q.id = s.queue_id
        LEFT JOIN retry_policies rp ON rp.id = q.retry_policy_id
        WHERE s.id = ${scheduleId}::uuid
          AND s.enabled = true
          AND q.deleted_at IS NULL
          AND s.next_run_at <= NOW()
        FOR UPDATE OF s
      `);

      console.log(`[${scheduleId}] 4. schedule query complete`);

      const schedule = rows[0];

      if (!schedule) {
        console.log(`[${scheduleId}] 5. schedule not due`);
        return false;
      }

      const occurrence = schedule.next_run_at;
      const nextRunAt = nextCronOccurrence(
        schedule.cron_expression,
        schedule.timezone,
        occurrence > new Date() ? occurrence : new Date()
      );

      const occurrenceKey = `${schedule.id}:${occurrence.toISOString()}`;

      const payload =
        schedule.payload === null ? Prisma.JsonNull : (schedule.payload as Prisma.InputJsonValue);

      console.log(`[${scheduleId}] 6. before update`);

      const reserved = await transaction.scheduledJob.updateMany({
        where: {
          id: schedule.id,
          enabled: true,
          nextRunAt: occurrence
        },
        data: {
          lastRunAt: occurrence,
          nextRunAt
        }
      });

      console.log(`[${scheduleId}] 7. update complete count=${reserved.count}`);

      if (reserved.count !== 1) {
        return false;
      }

      console.log(`[${scheduleId}] 8. before job create`);

      const concreteJob = await transaction.job.create({
        data: {
          queueId: schedule.queue_id,
          type: schedule.job_type,
          payload,
          priority: schedule.queue_priority,
          status: "QUEUED",
          attemptCount: 0,
          maxAttempts: schedule.max_attempts ?? 1,
          scheduledAt: occurrence,
          idempotencyKey: occurrenceKey
        }
      });

      console.log(`[${scheduleId}] 9. job created`);
      await transaction.outboxEvent.create({
        data: {
          eventType: "JOB_READY",
          aggregateType: "Job",
          aggregateId: concreteJob.id,
          payload: { eventId: concreteJob.id, eventType: "JOB_READY", jobId: concreteJob.id, queueId: schedule.queue_id, createdAt: occurrence.toISOString() }
        }
      });

      return true;
    });
  } catch (error) {
    console.error({
      scheduledJobId: scheduleId,
      event: "scheduler.error",
      error
    });

    return false;
  }
}

