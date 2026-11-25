# SkillBridge

SkillBridge is a full-stack career portal for students, recruiters, and administrators. It provides job discovery, saved opportunities, application tracking, listing management, applicant review, and moderated administration.

## Stack

- React 19, TypeScript, Vite, React Router, TanStack Query
- Express 5, TypeScript, Zod, JWT, bcrypt
- PostgreSQL, Prisma
- Docker Compose
- Vitest
- GitHub Actions

## Repository structure

- `client/` — React application
- `server/` — REST API
- `prisma/` — schema, migrations, and seed
- `docs/` — architecture and operations documentation
- `.github/workflows/` — CI

## Prerequisites

- Node.js 22+
- Docker Desktop or a managed PostgreSQL database
- npm 11+

## Local setup

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Health: http://localhost:4000/api/health

Set `JWT_SECRET` and `ADMIN_SEED_PASSWORD` before running local seed or authentication. The seed fails instead of creating an account when the admin password is missing.

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

These accounts are synthetic development data only.

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run db:migrate
npm run db:seed
docker compose up -d
docker compose down
```

## Deployment

The checked-in Compose file starts PostgreSQL for local development; it is not a full-stack or production Compose deployment. The API image can be built with `docker build -f server/Dockerfile -t skillbridge-api .`; provide `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, `CLIENT_ORIGIN`, and any proxy configuration at runtime. Apply migrations with `npx prisma migrate deploy` before serving traffic. The client is built separately with `npm run build -w client` and its `dist/` directory can be deployed to a static host. No hosted deployment URL or production deployment has been verified.

Resume uploads currently use local disk storage. This is not durable or shared storage for replicated/ephemeral production deployments; replace it with private encrypted object storage and malware scanning before production. See [the production-readiness checklist](./docs/PRODUCTION_READINESS.md) for verified scope and remaining release blockers.
