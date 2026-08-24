# Submission Checklist

## Verified locally

- [x] Source builds
- [x] Workspace typecheck passes
- [x] Workspace lint passes
- [x] Unit/service tests pass
- [x] PostgreSQL, Redis, and Kafka Docker services run locally
- [x] Prisma migrations deploy and schema is current
- [x] API health, readiness, and metrics endpoints respond
- [x] API authentication and tenant authorization tests pass
- [x] Worker atomic claim and concurrency tests pass
- [x] Scheduler duplicate-safe promotion tests pass
- [x] Retry and DLQ service tests pass
- [x] Dashboard production build passes
- [x] Stale-worker dry-run and retention dry-run commands work
- [x] Architecture, design decisions, reliability, and performance documentation exist

## Requires dedicated distributed environment

- [ ] True API -> outbox -> Kafka -> worker E2E run with service restarts
- [ ] 1,000+ job multi-worker throughput test
- [ ] 10/50/100 worker scaling test
- [ ] Kafka outage and recovery test
- [ ] Redis outage and recovery test
- [ ] Worker crash recovery test with process termination
- [ ] Playwright browser E2E
- [ ] SMTP mocked integration test
- [ ] Sandboxed script executor security test
- [ ] OpenTelemetry trace export verification
- [ ] PostgreSQL pool/lock and Kafka lag measurement
- [ ] Reproducible high-load capacity test

## Submission status

**NOT READY for a claim of complete final distributed E2E verification.** The local code quality gates
are green, but the distributed failure matrix and capacity evidence above still require execution in a
repeatable integration environment.
