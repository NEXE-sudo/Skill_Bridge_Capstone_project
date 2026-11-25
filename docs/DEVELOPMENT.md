# Development

The local application is run through the root npm workspace. Copy `.env.example` to `.env`, use non-production values, and start local PostgreSQL and Redis:

```bash
docker compose up -d
npm ci
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

The API runs on port 4000 and Vite on port 5173. Development email is captured in API output rather than sent. Resume objects use the local adapter unless configured otherwise. The synthetic seed refuses to run against a database with users unless `ALLOW_DESTRUCTIVE_SEED_RESET=true` is explicitly supplied; when enabled, it deletes all application data and is only suitable for a disposable local database. For integration tests, use a dedicated PostgreSQL database; the backend integration suite creates and removes namespaced synthetic users/jobs. The rate-limit-store outage test is skipped when `REDIS_URL` is unset; CI configures Redis and runs this case.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npx prisma validate
npx prisma migrate status
docker compose config --quiet
docker compose --env-file .env.production.example -f docker-compose.production.yml config --quiet
```

Docker image builds are part of CI. Production Compose configuration checks and image builds validate buildability, not the live external services or a deployed stack.

`npm run db:cleanup-auth` deletes expired session and account-action-token rows from its configured database. Do not run it against an unintended database; schedule it only with an explicit retention policy and operational monitoring.
