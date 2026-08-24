# Phase 11 Performance Report

This report records measured results only. No sustainable capacity number is claimed until the
workload, threshold, and resource configuration are recorded together.

## Thresholds

Default acceptance threshold for a future benchmark run:

- p95 latency: less than 500 ms
- HTTP error rate: less than 1%
- no lost jobs, duplicate first attempts, or queue concurrency violations

## Environment

- Date:
- OS and hardware:
- Node.js and pnpm versions:
- Docker resource limits:
- PostgreSQL configuration and pool sizes:
- Redis configuration:
- Kafka configuration:
- API, scheduler, publisher, and worker counts:

## API results

| Scenario | Concurrency/RPS | Requests/sec | p50 | p95 | p99 | Error rate | CPU | Memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Not yet recorded | - | - | - | - | - | - | - | - |

The repeatable local command is:

```cmd
pnpm test:load
node scripts/load-test.mjs --target /health --duration-ms 10000 --concurrency 100
```

The current configured API rate limit is 600 requests per minute. Runs above that rate must either
be explicitly intended as rate-limit tests or use a documented test configuration; they are not
capacity claims.

## Job throughput results

| Jobs | Workers | Queue concurrency | Job duration | Jobs/sec | Claim p95 | Completion p95 | Lost | Duplicate attempts |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Not yet recorded | - | - | - | - | - | - | - | - |

## Findings

- Observed baseline: 840 attempted requests/sec at concurrency 5 for `/health`, p50 2.83 ms,
	p95 6.16 ms, p99 20.36 ms, and 28.8% errors under the configured 600 requests/minute rate
	limiter. This is a rate-limit observation, not sustainable capacity.
- Earlier observation: 1,120 attempted requests/sec at concurrency 20 with 76.1% errors under
	the same rate limiter.
- Sustainable throughput: not established.
- Saturation point: not established.
- Primary bottleneck: not established.
- Safe operating limit: not established.
- 50k RPS reached: no evidence recorded.

No before/after optimization claim is made yet. Phase 12 safety changes must be benchmarked with
the same workload and a documented rate-limit configuration before their performance impact can
be attributed.

Phase 12 adds safety controls and audit/retention tooling. No post-optimization capacity result has
been recorded, so the Phase 11 measurements remain the only measured baseline.

## Phase 12 candidates

- OpenTelemetry SDK/exporter integration and trace propagation.
- Prometheus-compatible metric export and DB/Kafka/Redis pool gauges.
- Multi-service job throughput benchmark with five or more workers.
- Failure and restart matrix tests.
- Playwright and Testcontainers E2E environment.
