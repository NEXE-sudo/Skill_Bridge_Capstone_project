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
npm test
npm run build
npm run db:migrate
npm run db:seed
docker compose up -d
docker compose down
```

## Deployment

Deploy PostgreSQL with a managed provider, apply migrations using `npx prisma migrate deploy`, deploy the Express server as a Node service, and deploy `client/dist` on Vercel. Set `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, and `CLIENT_ORIGIN` in hosted environment settings. Do not deploy or expose `.env`.

Resume uploads use private server storage in the local implementation. Production deployments should replace this adapter with encrypted object storage and provide short-lived signed download URLs.
