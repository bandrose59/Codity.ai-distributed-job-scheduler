# Distributed Job Scheduler

Production-inspired distributed job scheduler assignment.

The project includes authentication, tenant authorization, queue processing, workers, retries,
scheduling, and an operational dashboard. PostgreSQL is the source of truth for jobs and execution
state; Redis and Kafka support coordination and transport.

## Architecture Overview

This repository is a pnpm TypeScript monorepo with:

- `apps/api`: Fastify API service with authentication, organization, and project APIs
- `apps/worker`: worker process skeleton
- `apps/scheduler`: scheduler process skeleton
- `apps/dashboard`: React + Vite operational dashboard
- `packages/database`: Prisma client setup for PostgreSQL
- `packages/config`: shared environment validation with Zod
- `packages/shared`: placeholder for shared types and utilities
- `docker-compose.yml`: PostgreSQL, Redis, and Kafka for local development

Redis rate-limit failure follows the configured fail-open policy; Kafka outages are handled by the
transactional outbox.

## Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- Docker Desktop

## Installation

```sh
pnpm install
```

## Environment Setup

```sh
cp .env.example .env
```

Default local values:

- PostgreSQL: `postgresql://scheduler:scheduler@localhost:15432/job_scheduler?schema=public`
- Redis: `redis://localhost:6379`
- Kafka: `localhost:9092`
- API: `http://localhost:3000`

## Start Infrastructure

```sh
pnpm docker:up
```

Apply database migrations from Windows Command Prompt:

```cmd
set "DATABASE_URL=postgresql://scheduler:scheduler@localhost:15432/job_scheduler?schema=public"
pnpm --filter @job-scheduler/database exec prisma migrate deploy --schema prisma/schema.prisma
```

PowerShell uses a different environment variable syntax:

```powershell
$env:DATABASE_URL="postgresql://scheduler:scheduler@localhost:15432/job_scheduler?schema=public"
pnpm --filter @job-scheduler/database exec prisma migrate deploy --schema prisma/schema.prisma
```

Stop infrastructure:

```sh
pnpm docker:down
```

## Start Applications

Run all development services:

```sh
pnpm dev
```

Run one service:

```sh
pnpm --filter @job-scheduler/api dev
pnpm --filter @job-scheduler/worker dev
pnpm --filter @job-scheduler/scheduler dev
pnpm --filter @job-scheduler/dashboard dev
```

## Health Check

```sh
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## API Workflow

Start the API with `pnpm --filter @job-scheduler/api dev`. Registration creates a user, a default
organization, and an OWNER membership in one transaction:

```sh
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "content-type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"correct horse battery staple"}'
```

Login returns a JWT. Send it as `Authorization: Bearer <token>` to call
`GET /api/v1/auth/me`, `GET /api/v1/organizations`, and the project endpoints.

```sh
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"ada@example.com","password":"correct horse battery staple"}'

curl http://localhost:3000/api/v1/projects \
  -H "authorization: Bearer <token>"
```

Project creation requires an accessible `organizationId`:

```sh
curl -X POST http://localhost:3000/api/v1/projects \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  -d '{"organizationId":"<organization-id>","name":"My Scheduler","description":"Background job processing"}'
```

Project reads are tenant-isolated in the database query. OWNER and ADMIN members may update or
archive projects; MEMBER members are read-only. `DELETE /api/v1/projects/:id` archives by setting
`deletedAt` and does not remove historical data.

## Queue API

Queues are scoped to projects and require an authenticated project member. OWNER and ADMIN members
can create, update, archive, pause, and resume queues. MEMBER members can read queues only.

```sh
curl -X POST http://localhost:3000/api/v1/projects/<project-id>/queues \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  -d '{"name":"email","description":"Email processing","priority":10,"concurrencyLimit":20,"retryPolicy":{"strategy":"EXPONENTIAL","maxAttempts":5,"initialDelayMs":1000,"maxDelayMs":30000}}'

curl http://localhost:3000/api/v1/projects/<project-id>/queues \
  -H "authorization: Bearer <token>"
curl http://localhost:3000/api/v1/queues/<queue-id> \
  -H "authorization: Bearer <token>"
curl http://localhost:3000/api/v1/queues/<queue-id>/stats \
  -H "authorization: Bearer <token>"
```

`PATCH /api/v1/queues/:id` updates queue configuration and can create or clear its retry policy.
`POST /api/v1/queues/:id/pause` and `/resume` are idempotent. `DELETE /api/v1/queues/:id` archives
the queue using `deletedAt`; archived queues are excluded from normal lists and cannot be changed.
Queue statistics count persisted job states and dead-letter records, returning zero for empty queues.

## Job API

Jobs require an authenticated member of the queue's project. Immediate jobs enter `QUEUED`;
delayed and scheduled jobs require a future `scheduledAt` and enter `SCHEDULED`. A paused queue
still accepts jobs, while an archived queue rejects new jobs.

```sh
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "content-type: application/json" \
  -H "authorization: Bearer <token>" \
  -d '{"queueId":"<queue-id>","type":"IMMEDIATE","payload":{"recipient":"ada@example.com"},"priority":10,"idempotencyKey":"email-123"}'

curl "http://localhost:3000/api/v1/jobs?queueId=<queue-id>&status=QUEUED&limit=50" \
  -H "authorization: Bearer <token>"
curl -X POST http://localhost:3000/api/v1/jobs/<job-id>/cancel \
  -H "authorization: Bearer <token>"
curl -X POST http://localhost:3000/api/v1/jobs/<job-id>/retry \
  -H "authorization: Bearer <token>"
```

`POST /api/v1/jobs/batch` accepts `{ "jobs": [...] }` and creates all entries in one transaction;
validation or persistence failure rolls the entire batch back. The optional `idempotencyKey` is
unique within a queue and returns the original result on repetition, including concurrent requests.
This provides idempotent submission, not exactly-once execution.

`CRON` requests create one `ScheduledJob` definition. Immediate, delayed, and scheduled jobs flow
through the scheduler, outbox, Kafka, worker, executor, and persisted execution history. Manual retry
is restricted to failed or dead-lettered jobs. Delivery is at-least-once; exactly-once side effects
are not claimed.

## Common Commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:load
pnpm test:stress
pnpm db:cleanup:stale-workers -- --dry-run --stale-after-ms 3600000
pnpm db:cleanup:retention -- --dry-run --days 30
```

`pnpm test` runs the current unit and service tests. `test:integration` and `test:e2e` currently map
to that suite and are placeholders until a repeatable Testcontainers/Playwright environment is added.
`test:load` reports measured throughput and latency but does not claim sustainable capacity.

## Environment And Production Safety

`.env` is ignored by Git. Copy `.env.example` for local development. SMTP variables are optional and
are read only by the worker. Never commit `DATABASE_URL`, JWT secrets, SMTP passwords, or broker
credentials. Production should use secret management and `prisma migrate deploy`, never `prisma migrate reset`.

## Known Limitations

- No measured sustainable 50k RPS result exists; the performance report records only observed local runs.
- Full multi-service failure-matrix E2E and Playwright tests require a dedicated integration environment.
- Uploaded scripts are stored as payload data and are not executed; a Docker sandbox is not yet implemented.
- OpenTelemetry exporters, Prometheus exposition, Kafka lag, DB pool/lock gauges, and partitioning are deferred.
- Dashboard updates use bounded polling rather than WebSockets or SSE.

## Documentation

- [Architecture](docs/architecture.md)
- [Database design and ER diagram](docs/database-design.md)
- [API reference](docs/api.md)
- [Deployment](docs/deployment.md)
- [Performance report](docs/performance-report.md)
- [Submission checklist](docs/submission-checklist.md)
