# Implementation status

## Implemented

- Student, recruiter, and administrator role-protected workflows.
- Account registration, email verification, login, persisted revocable cookie sessions, logout, password reset, and account suspension checks.
- Public job search with validated filters, newest/oldest ordering, and pagination.
- Recruiter listing ownership checks, applicant filtering/pagination, and resume access restricted to applicants for the recruiter's own jobs.
- Draft-only recruiter listing deletion; closed listings can be reopened without removing application history.
- Duplicate application prevention and explicit application status/withdrawal rules.
- Resume extension/MIME/signature checks, a 5 MiB limit, authenticated retrieval, private S3-compatible production adapter, and replacement/deletion that preserves application snapshots.
- Redis-backed shared rate limiting when configured; production requires Redis and fails closed if its store is unavailable.
- Transactional audit records for administrator moderation and user status changes.
- PostgreSQL schema constraints, migrations, synthetic seed data, responsive layouts, and loading/error/empty states in major views.
- Backend PostgreSQL integration tests, frontend component tests, Playwright role workflows, and an automated axe scan on the public landing page.
- Local-development and production Compose definitions, API/client/migration images, readiness health check, and scheduled cleanup command for expired auth records.
- The auth cleanup command was exercised with expired and active test records; expired/old records were removed while active records remained.

## Current verification evidence

At the latest local verification:

- Backend/frontend type checks and lint passed.
- All backend integration and frontend component tests passed with local PostgreSQL and Redis configured.
- All 6 Chromium end-to-end tests passed; the landing-page axe scan reported no automated WCAG 2.1 A/AA violations.
- Production build, Prisma schema validation/migration status, both Compose config checks, full and production-only npm audits, and all three production Docker image builds passed.

These checks do not prove that hosted deployment, production database, email delivery, cloud storage policies, ingress, backups, restore, or external monitoring work.

## Remaining release work

The repository is not yet verified for public production deployment. High-priority residuals include production deployment/external-service configuration not being tested, and lack of full resume parsing/malware scanning. Medium/low items include operational backup/restore/monitoring, automated cleanup scheduling, MFA requirements, comprehensive role-specific accessibility/responsive review, and deeper end-to-end coverage. See [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).
