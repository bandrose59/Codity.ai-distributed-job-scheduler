# Phase 10 Integration

## Execution output

Each worker attempt stores bounded structured `output`, `stdout`, `stderr`, `exitCode`, and
`metadata` on `JobExecution`. The job detail API includes at most 200 logs for an attempt. Text
output is capped at 64 KB to avoid loading unbounded history into the browser.

## Executors

`ExecutorRegistry` selects the deterministic test executor by default and the SMTP email executor
when the job payload contains `executor: "email"`. Test payloads support `mode: "SUCCESS"`,
`SLEEP`, `FAIL_RETRYABLE`, `FAIL_NON_RETRYABLE`, and `FAIL_ONCE_THEN_SUCCEED`. The worker retains
responsibility for claims, lifecycle transitions, retries, and DLQ state.

Email payload example:

```json
{
  "executor": "email",
  "to": "user@example.com",
  "subject": "Test email",
  "text": "Hello from the scheduler"
}
```

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`
in `.env`. SMTP secrets are never sent to the dashboard or stored in job payloads.

## Operational UI

The dashboard provides job detail at `/jobs/:id`, queue controls at `/queues`, and DLQ inspection
and retry at `/dlq`. Queue operations call the backend and refresh authoritative state. Job detail
polls every five seconds; workers and queue statistics poll every five seconds; dashboard overview
polls every fifteen seconds.

## Script uploads

Uploaded files are currently stored as job payload data. The worker does not execute arbitrary
uploaded code. A future sandbox implementation must use a separate isolated process/container,
strict timeout and resource limits, restricted filesystem, no application secrets, and disabled
network by default.

## Database and cleanup

Apply migrations with `prisma migrate deploy`. Development cleanup should be explicit and must
never run automatically from API startup. Stale workers should be marked `DEAD` after a controlled
heartbeat reconciliation; historical executions and logs should be retained.

## Remaining work

Full SMTP mocked tests, container sandbox execution, scheduler health metrics, stale-worker cleanup
commands, and Playwright multi-service E2E scenarios remain follow-up work. The current unit and
service tests validate the existing worker, scheduler, API, and dashboard slices without requiring
an external email provider.