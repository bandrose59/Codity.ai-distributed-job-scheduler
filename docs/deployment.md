# Deployment

## Local

Requirements: Node.js 22+, pnpm 10+, and Docker Desktop.

```cmd
pnpm install
copy .env.example .env
pnpm docker:up
set "DATABASE_URL=postgresql://scheduler:scheduler@localhost:15432/job_scheduler?schema=public"
pnpm --filter @job-scheduler/database exec prisma migrate deploy --schema prisma/schema.prisma
pnpm dev
```

The dashboard runs at `http://localhost:5173`; the API runs at `http://localhost:3000`.

## Production principles

- Use managed PostgreSQL, Redis, and Kafka or equivalent private services.
- Store `DATABASE_URL`, `JWT_SECRET`, SMTP credentials, and broker credentials in a secret manager.
- Run `prisma migrate deploy` during an explicit deployment step. Never run `migrate reset` in production.
- Build packages with `pnpm build` and run API, scheduler, and worker `start` scripts separately.
- Serve the dashboard as static Vite output behind a TLS-enabled reverse proxy.
- Restrict CORS to the deployed dashboard origin; do not use wildcard origins with credentials.
- Keep PostgreSQL authoritative. Redis loss must not lose jobs; Kafka loss is covered by the outbox.
- Monitor `/health/live`, `/health/ready`, `/health/details`, and `/metrics` without exposing secrets.

## Scaling and safety

API instances are stateless and can scale horizontally behind a load balancer. Worker count and queue
concurrency must be sized against PostgreSQL connection capacity and executor limits. The current
repository does not contain measured production capacity or a complete automated multi-service failure
matrix; use the benchmark and submission checklist before choosing limits.

Uploaded scripts are not executed. A production script executor requires isolated containers/processes,
resource limits, restricted filesystem/network, and a secret-free environment.
