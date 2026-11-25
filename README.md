# SkillBridge

SkillBridge is a full-stack career portal for students, recruiters, and administrators. It provides job discovery, saved opportunities, application tracking, listing management, applicant review, and moderated administration.

## Stack

- React 19, TypeScript, Vite, React Router, TanStack Query
- Express 5, TypeScript, Zod, JWT session cookies, bcrypt
- PostgreSQL, Prisma 7, Redis
- S3-compatible private resume storage and SMTP account email
- Docker Compose, Vitest, Playwright, GitHub Actions

## Repository structure

- `client/` — React application, browser tests, and Nginx container
- `server/` — REST API, integration tests, email and resume-storage adapters
- `prisma/` — schema, migrations, seed, and auth-record cleanup command
- `docs/` — API, architecture, development, security, database, and readiness documentation
- `.github/workflows/` — CI checks and production image builds

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop or compatible Docker Engine with Compose

## Local setup

```bash
cp .env.example .env
docker compose up -d
npm ci
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

The local Compose file starts PostgreSQL and Redis. The API and web development server run through npm:

- Web app: http://localhost:5173
- API: http://localhost:4000
- Liveness: http://localhost:4000/api/health
- Readiness (database and configured Redis): http://localhost:4000/api/ready

Set a local random `JWT_SECRET` of at least 32 characters and a strong `ADMIN_SEED_PASSWORD` before seeding. In development, email messages are written to the API console; they are not delivered to a mailbox. The example uses local resume storage only. Do not use the development `.env` values in production.

The synthetic seed is disabled in production and refuses to run if the database already contains users. It resets all application data when explicitly enabled; use `ALLOW_DESTRUCTIVE_SEED_RESET=true npm run db:seed` only for a disposable local database.

## Demo accounts

Local seed credentials:

| Role | Email | Password |
|---|---|---|
| Student | student1@skillbridge.local | Student123! |
| Student | student2@skillbridge.local | Student123! |
| Student | student3@skillbridge.local | Student123! |
| Recruiter | recruiter1@skillbridge.local | Recruiter123! |
| Recruiter | recruiter2@skillbridge.local | Recruiter123! |
| Admin | value of `ADMIN_SEED_EMAIL` | value of `ADMIN_SEED_PASSWORD` |

These are synthetic development accounts. Never deploy the seed credentials or expose seeded data publicly.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run db:migrate
npm run db:seed
npm run db:cleanup-auth
```

The auth cleanup command removes expired session and account-action token records; run it only against the intended database under an operational retention schedule. See [development guidance](./docs/DEVELOPMENT.md) for testing and [database notes](./docs/DATABASE.md) for migrations.

## Production deployment template

`docker-compose.production.yml` is a host-neutral template with private PostgreSQL and Redis services, a one-shot migration service, an API container, and an Nginx-served client. It builds successfully but is **not a hosted deployment**. It expects a TLS-terminating ingress, a private S3-compatible bucket, a reachable SMTP provider, and production secrets supplied outside version control.

1. Copy `.env.production.example` to a protected location, replace every placeholder, and supply it through a secret manager or a tightly permissioned host file. Do not commit the resulting file.
2. Configure the bucket for blocked public access and least-privilege API access. Configure the SMTP sender and test delivery outside this repository.
3. Configure the ingress to sanitize forwarded headers and send HTTPS traffic to the loopback-bound web container. Review `TRUST_PROXY` for the actual proxy chain.
4. Apply migrations after taking a database backup, then start the services:

   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
   ```

5. Verify `/api/ready`, sign-in/verification email, resume upload and authorized retrieval, backups, logs, alerts, and restore procedures in the actual target environment.

The Compose file and images were validated locally; bucket policies, SMTP delivery, TLS ingress, secrets handling, backups, restore, monitoring, and hosted behavior were not. Review [the production-readiness checklist](./docs/PRODUCTION_READINESS.md) before treating this template as deployable.
