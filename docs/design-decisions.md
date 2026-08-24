# Design Decisions

- PostgreSQL remains the source of truth for users, queues, jobs, executions, logs, workers, schedules,
  outbox events, audits, and DLQ records.
- Atomic claims use short PostgreSQL transactions with row locks and `SKIP LOCKED`; execution never
  occurs inside the claim transaction.
- Delivery is at-least-once. Idempotency keys and conditional state transitions prevent duplicate
  logical jobs, but exactly-once side effects are not claimed.
- Kafka transports ready events; the transactional outbox preserves jobs when Kafka is unavailable.
- Redis is ephemeral coordination for rate limits. Job correctness does not depend on Redis.
- Scheduler and worker processes are separate so scheduling, claiming, execution, and recovery scale
  independently.
- Leases allow another worker to recover work after a crash. Running executions become `ABANDONED`.
- Retry strategies are snapshotted onto jobs and support fixed, linear, exponential, capped, and jittered
  delay calculations. Exhausted failures go to one DLQ record.
- CRON definitions store the next occurrence rather than infinite future jobs. Missed schedules create a
  bounded catch-up occurrence and advance to the next future run.
- Executors implement a shared result contract. The deterministic test executor is safe for integration
  scenarios; the SMTP executor owns email delivery; uploaded scripts are not executed.
- API instances are stateless. Authentication is JWT based, and tenant checks are performed in database
  queries and authorization services.
- Dashboard live state uses bounded TanStack Query polling because no reliable event stream is required
  for current local operation.
- OpenTelemetry exporters, Prometheus exposition, a Docker script sandbox, and multi-region operation
  are intentionally deferred until an integration environment and measured requirements exist.
