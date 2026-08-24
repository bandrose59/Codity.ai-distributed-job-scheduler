# Phase 12 Security and Performance

## API safety

The API uses Redis-backed fixed-window buckets keyed by client IP and request category. Authentication,
job creation, batch creation, and general API traffic have separate configurable limits. Exceeding a
bucket returns `429` and `Retry-After: 60`. Redis failure follows the current documented fail-open
policy for availability; PostgreSQL remains the source of truth for jobs.

Fastify rejects request bodies above `API_BODY_LIMIT_BYTES` (1 MB by default) and applies
`API_REQUEST_TIMEOUT_MS` (30 seconds by default). Job and batch schemas cap pagination and batch
size independently. API responses add `X-Content-Type-Options`, `Referrer-Policy`, and a restrictive
Content Security Policy.

## Explicit stale-worker cleanup

Cleanup never runs during API startup and never deletes execution history:

```cmd
pnpm db:cleanup:stale-workers -- --dry-run --stale-after-ms 3600000
pnpm db:cleanup:stale-workers -- --stale-after-ms 3600000
```

The command marks workers with expired heartbeats as `DEAD`. It is intentionally explicit and should
be run only against the intended development database.

## Audit and retention

Queue archive/pause/resume, job retry/cancel, and DLQ retry actions write actor, action, target, and
timestamp records to `audit_logs`. Retention cleanup supports a dry run before deleting old job logs,
worker heartbeat history, and published outbox events:

```cmd
pnpm db:cleanup:retention -- --dry-run --days 30
pnpm db:cleanup:retention -- --days 30
```

It never deletes active jobs, executions, or pending outbox events.

## Benchmark discipline

Phase 11 measured the local `/health` endpoint at 840 attempted requests/sec at concurrency 5,
with 28.8% errors, because the configured rate limit was 600 requests/minute. Phase 12 does not
claim an optimization or capacity increase from this result. Re-run the benchmark with a documented
limit and record p50/p95/p99, errors, CPU, memory, database connections, and dependency latency.

The benchmark command is cross-platform:

```cmd
node scripts/load-test.mjs --target /health --duration-ms 10000 --concurrency 100
```

## Deferred production work

OpenTelemetry exporters, Prometheus format, database pool/lock gauges, Kafka lag, Redis operation
metrics, partitioning, sandbox hardening, and true multi-service 1,000+ job / 10-50k RPS tests require
a dedicated integration environment. They are not represented by fake metrics.