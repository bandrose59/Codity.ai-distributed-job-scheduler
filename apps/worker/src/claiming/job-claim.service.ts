import { Prisma } from "@prisma/client";

import { prisma } from "@job-scheduler/database";

export interface ClaimedJob {
  id: string;
  queue_id: string;
  type: string;
  payload: Prisma.JsonValue;
  priority: number;
  status: string;
  attempt_count: number;
  max_attempts: number;
  scheduled_at: Date | null;
  created_at: Date;
  claimed_at: Date;
  lease_expires_at: Date;
}

export async function claimNextJob(
  workerId: string,
  leaseMs: number,
  queueId?: string,
  jobId?: string
): Promise<ClaimedJob | null> {
  const rows = await prisma.$transaction(async (transaction) => {
    const worker = await transaction.worker.findUniqueOrThrow({
      where: { workerIdentifier: workerId },
      select: { id: true }
    });
    const candidateQueues = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT q.id
      FROM queues q
      WHERE q.status = 'ACTIVE'::"QueueStatus"
        AND q.deleted_at IS NULL
        AND (${queueId ?? null}::uuid IS NULL OR q.id = ${queueId ?? null}::uuid)
        AND (${jobId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM jobs targeted WHERE targeted.id = ${jobId ?? null}::uuid AND targeted.queue_id = q.id))
        AND EXISTS (
          SELECT 1 FROM jobs eligible
          WHERE eligible.queue_id = q.id
            AND eligible.status = 'QUEUED'::"JobStatus"
            AND (eligible.scheduled_at IS NULL OR eligible.scheduled_at <= NOW())
            AND (${jobId ?? null}::uuid IS NULL OR eligible.id = ${jobId ?? null}::uuid)
        )
      ORDER BY q.id
      LIMIT 100
    `);
    for (const candidateQueue of candidateQueues) {
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${candidateQueue.id}::text, 0))
      `);
      const lockedQueues = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT q.id
        FROM queues q
        WHERE q.id = ${candidateQueue.id}::uuid
          AND q.status = 'ACTIVE'::"QueueStatus"
          AND q.deleted_at IS NULL
        FOR UPDATE
      `);
      const queue = lockedQueues[0];
      if (!queue) continue;
      const result = await transaction.$queryRaw<ClaimedJob[]>(Prisma.sql`
    WITH candidate_job AS (
      SELECT j.id
      FROM jobs j
      INNER JOIN queues q ON q.id = j.queue_id
      WHERE j.queue_id = ${queue.id}::uuid
        AND (${jobId ?? null}::uuid IS NULL OR j.id = ${jobId ?? null}::uuid)
        AND q.status = 'ACTIVE'::"QueueStatus"
        AND q.deleted_at IS NULL
        AND j.status = 'QUEUED'::"JobStatus"
        AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
        AND (
          SELECT COUNT(*) FROM jobs active
          WHERE active.queue_id = j.queue_id
            AND active.status IN ('CLAIMED'::"JobStatus", 'RUNNING'::"JobStatus")
        ) < q.concurrency_limit
      ORDER BY j.priority DESC, j.created_at ASC, j.id ASC
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs j
    SET status = 'CLAIMED'::"JobStatus",
        worker_id = ${worker.id}::uuid,
        claimed_at = NOW(),
        lease_expires_at = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
        updated_at = NOW()
    FROM candidate_job c
    WHERE j.id = c.id
    RETURNING j.id, j.queue_id, j.type, j.payload, j.priority, j.status,
      j.attempt_count, j.max_attempts, j.scheduled_at, j.created_at,
      j.claimed_at, j.lease_expires_at
      `);
      if (result.length > 0) return result;
    }
    return [];
  });
  return rows[0] ?? null;
}
