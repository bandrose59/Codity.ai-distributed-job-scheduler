import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

export async function promoteDueJobs(batchSize: number, queueId?: string): Promise<number> {
  const promoted = await prisma.$transaction(async (transaction) => {
    const rows = queueId
      ? transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH candidates AS (
        SELECT j.id FROM jobs j
        INNER JOIN queues q ON q.id = j.queue_id
        WHERE j.queue_id = ${queueId}::uuid
          AND j.status IN ('SCHEDULED'::"JobStatus", 'RETRYING'::"JobStatus")
          AND j.scheduled_at <= NOW()
          AND q.deleted_at IS NULL
        ORDER BY j.scheduled_at ASC, j.id ASC
        FOR UPDATE OF j SKIP LOCKED LIMIT ${batchSize}
      )
      UPDATE jobs j SET status = 'QUEUED'::"JobStatus", updated_at = NOW()
      FROM candidates c
      WHERE j.id = c.id AND j.status IN ('SCHEDULED'::"JobStatus", 'RETRYING'::"JobStatus")
      RETURNING j.id
    `)
      : transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH candidates AS (
        SELECT j.id
        FROM jobs j
        INNER JOIN queues q ON q.id = j.queue_id
        WHERE j.status IN ('SCHEDULED'::"JobStatus", 'RETRYING'::"JobStatus")
          AND j.scheduled_at <= NOW()
          AND q.deleted_at IS NULL
        ORDER BY j.scheduled_at ASC, j.id ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE jobs j
      SET status = 'QUEUED'::"JobStatus", updated_at = NOW()
      FROM candidates c
      WHERE j.id = c.id AND j.status IN ('SCHEDULED'::"JobStatus", 'RETRYING'::"JobStatus")
      RETURNING j.id
    `);
    const result = await rows;
    for (const row of result) {
      await transaction.outboxEvent.create({
        data: {
          eventType: "JOB_READY",
          aggregateType: "Job",
          aggregateId: row.id,
          payload: { eventId: row.id, eventType: "JOB_READY", jobId: row.id, createdAt: new Date().toISOString() }
        }
      });
    }
    return result;
  });
  return promoted.length;
}
