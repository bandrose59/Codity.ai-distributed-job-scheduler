# API Reference

Base URL: `http://localhost:3000`. Protected routes require `Authorization: Bearer <token>`.
Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.

## Health and metrics

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Basic health response |
| GET | `/health/live` | No | Liveness check |
| GET | `/health/ready` | No | PostgreSQL, Redis, Kafka readiness |
| GET | `/health/details` | No | Dependency status and latency |
| GET | `/metrics` | No | In-process HTTP and runtime metrics |

## Authentication

| Method | Route | Auth | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | No | Create user, default organization, and owner membership |
| POST | `/api/v1/auth/login` | No | Return JWT and user summary |
| GET | `/api/v1/auth/me` | Yes | Return current user |

Registration requires `name`, `email`, and an 8-200 character `password`. Duplicate email returns
`409`. Invalid credentials or tokens return `401`.

## Projects and queues

- `GET /api/v1/organizations` lists accessible organizations.
- `GET /api/v1/projects` lists tenant-visible projects.
- `POST /api/v1/projects` creates a project with `organizationId`, `name`, and optional `description`.
- `GET /api/v1/projects/:id` reads one accessible project.
- `PATCH /api/v1/projects/:id` updates owner/admin project fields.
- `DELETE /api/v1/projects/:id` archives a project.
- `GET /api/v1/projects/:projectId/queues` lists queues.
- `POST /api/v1/projects/:projectId/queues` creates a queue.
- `GET /api/v1/queues/:id` reads a queue.
- `PATCH /api/v1/queues/:id` updates queue configuration.
- `DELETE /api/v1/queues/:id` archives a queue.
- `POST /api/v1/queues/:id/pause` and `/resume` change queue state.
- `GET /api/v1/queues/:id/stats` returns persisted queue counters.

Queue changes require owner/admin access; reads require project membership. Archived queues cannot
accept jobs. Invalid IDs return `400`; inaccessible resources return `404`.

## Jobs

- `POST /api/v1/jobs` creates an immediate, delayed, scheduled, or CRON job.
- `POST /api/v1/jobs/batch` creates up to 100 jobs transactionally.
- `GET /api/v1/jobs` lists jobs with bounded filters, `limit` 1-100, and cursor pagination.
- `GET /api/v1/jobs/:id` returns job, execution history, bounded logs, and execution output.
- `POST /api/v1/jobs/:id/cancel` cancels queued/scheduled jobs.
- `POST /api/v1/jobs/:id/retry` retries failed or DLQ jobs for owner/admin users.

Payloads are JSON and limited to 900 KB. Immediate jobs start as `QUEUED`; delayed/scheduled jobs
require a future `scheduledAt`; CRON jobs require a valid `cronExpression`. Errors include
`VALIDATION_ERROR`, `INVALID_SCHEDULE`, `JOB_NOT_FOUND`, and state-specific conflict codes.

## Workers, dashboard, and DLQ

- `GET /api/v1/workers` and `GET /api/v1/workers/:id` return tenant-visible worker data.
- `GET /api/v1/dashboard` returns authenticated metrics and trend data.
- `GET /api/v1/dashboard/alerts` returns recent authenticated job failures.
- `GET /api/v1/dlq` and `GET /api/v1/dlq/:id` return dead-letter records.
- `POST /api/v1/dlq/:id/retry` requeues a DLQ job for owner/admin users.

All routes enforce tenant membership through organization, project, queue, or job relationships.
Rate-limit responses are `429` with `Retry-After: 60`.
