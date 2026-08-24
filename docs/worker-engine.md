# Worker Execution Engine

Phase 5 uses PostgreSQL as the source of truth for worker and job state. Redis and Kafka are not
used for claiming or execution coordination.

## Lifecycle

Each process registers one `Worker` row by its unique `workerIdentifier`. A restart updates that
row to `ACTIVE` rather than creating an unbounded process record. Normal shutdown transitions the
worker through `DRAINING` to `STOPPED`; draining stops new claims while active executions finish
until `SHUTDOWN_TIMEOUT_MS`.

The worker sends periodic heartbeats. Each heartbeat updates `lastHeartbeatAt` and extends leases
only for jobs owned by that worker that are already `RUNNING`. A late heartbeat is not itself a
dead-worker decision; crash classification and expired-lease recovery are deferred.

## Polling and Atomic Claims

The poller claims only due `QUEUED` jobs from active, non-archived queues. A short PostgreSQL
transaction locks an eligible queue row and then selects one job with `FOR UPDATE SKIP LOCKED`,
ordered by `priority DESC`, `createdAt ASC`, and `id ASC`. The transaction conditionally changes
the job to `CLAIMED`, assigns the worker UUID, and sets `leaseExpiresAt`. It commits before any
executor runs.

Locking the queue row serializes capacity checks for that queue across workers. The check counts
`CLAIMED` and `RUNNING` jobs, so the database-enforced decision cannot oversubscribe
`concurrencyLimit`. A worker also stops claiming when its local in-flight count reaches
`WORKER_CONCURRENCY`.

```mermaid
sequenceDiagram
  participant W as Worker
  participant P as PostgreSQL
  W->>P: BEGIN; lock eligible queue; SELECT job FOR UPDATE SKIP LOCKED
  P-->>W: CLAIMED job and lease
  W->>P: COMMIT
  W->>W: Resolve safe executor and run outside transaction
  W->>P: Record execution completion/failure and update job
```

Paused queues remain intact and are skipped by the claim query. No new claim is made for a paused
queue, while already running jobs are not modified.

## State and Execution History

The state machine permits `QUEUED -> CLAIMED -> RUNNING -> COMPLETED` or `RUNNING -> FAILED`.
Cancellation, retry scheduling, and crash recovery are outside this phase. One
`JobExecution` row represents one actual attempt. Attempts are one-based, so the initial attempt
is `1`, created when the job enters `RUNNING`, not when it is merely claimed.

Execution records contain start/completion timestamps, duration, worker, status, and failure text.
An executor failure is isolated to its job and results in `JobExecution = FAILED` and `Job = FAILED`;
the worker continues processing other jobs.

The executor registry deliberately supports only controlled application executors. The development
executor can simulate a delay or deterministic failure from structured payload fields. It never
executes arbitrary shell commands or JavaScript.

## Leases and Delivery Semantics

Claims set `leaseExpiresAt` to `JOB_LEASE_MS` in the future. Heartbeats extend leases only where the
worker identifier owns a running job. Complete expired-lease recovery and reclamation are deferred
to the recovery/retry phase.

The engine provides at-least-once execution semantics, not exactly-once execution. A process crash
after claiming or during external work can require later recovery and application-level idempotency.

## Deferred Work

Phase 5 intentionally does not implement automatic retry scheduling, DLQ processing, expired-lease
recovery, scheduler polling, Kafka dispatch, or Redis coordination. Those concerns belong to later
phases.
