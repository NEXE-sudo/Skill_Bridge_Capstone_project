# Production readiness checklist

This checklist records implementation and verification evidence from this repository. A checked item means code or a local test was observed; it does not mean a hosted environment or external provider was exercised.

## Release status

**Not verified for public production deployment.** No critical-severity defect was confirmed in the checks described here, but high-priority deployment and file-safety risks remain. This is not a penetration-test result or a production launch approval.

## Verified implementation and local checks

- [x] Student, recruiter, and administrator API routes enforce role checks and current account status.
- [x] Registration restricts roles, requires email verification before login, and does not issue a session at signup. Login, logout, expiry/revocation, password reset, and suspended-account behavior have integration coverage.
- [x] JWT session IDs are persisted, checked on authenticated requests, expired/revoked on logout, and invalidated by account suspension and password reset.
- [x] Recruiters can only manage their own listings and access applicants/resumes connected to their own listings.
- [x] Applications have a database uniqueness constraint and duplicate submissions return a conflict response.
- [x] Recruiters may delete draft listings only; closed listings can be reopened without deleting their application history.
- [x] Recruiter application status transitions are constrained; recruiters cannot mark applications withdrawn; students can withdraw only eligible applications.
- [x] Resume uploads enforce PDF extension/MIME, file-size limits, and PDF signature; retrieval is authenticated. Replacement/deletion preserve resume files referenced by submitted applications.
- [x] Admin user suspension/reactivation and listing moderation write audit records transactionally; audit access is admin-only and paginated.
- [x] Job discovery validates enum, search, and pagination inputs; company-name search and newest/oldest sorting are implemented.
- [x] Paginated application, recruiter listing/applicant, admin user/listing, and audit-log views expose pagination metadata.
- [x] Prisma schema contains unique email, unique `(jobId, studentId)`, unique `(studentId, jobId)`, foreign-key, token, and session constraints.
- [x] Auth tokens are hashed at rest, single-use, and expiring; a regression test covers expired reset-token rejection.
- [x] The auth cleanup command was exercised with expired and active test records; it removed expired/old records and preserved active records.
- [x] CORS allow/deny behavior, baseline security headers, readiness, Redis-store failure behavior, application ownership, and admin audit behavior have integration coverage.
- [x] Frontend API requests use cookies and CSRF headers rather than local-storage bearer tokens; Playwright checks student login/logout, recruiter listing status changes, admin navigation, registration verification messaging, and reset-request privacy.
- [x] Automated axe scan on the public landing page found no WCAG 2.1 A/AA violations. This does not substitute for manual screen-reader, keyboard, or all-route review.
- [x] Local checks passed: typecheck, lint, backend integration/frontend component tests, 6 Chromium E2E tests, production build, Prisma validation and migration status, all/production npm audits (zero advisories), development and production Compose validation, and API runtime, migration, and web image builds.

## Critical priority

- No critical-severity issue was confirmed in the checks performed. This is not a security certification or penetration test.

## High priority — resolve before public launch

- [ ] **Hosted deployment and external integrations are unverified.** Production Compose and images build, but no hosted deployment, TLS ingress, production PostgreSQL/Redis, S3-compatible provider, SMTP delivery, production secrets mechanism, or live readiness workflow was exercised. Validate the actual hosting topology, forwarded-header trust, email links, private bucket/IAM/KMS policy, object lifecycle, and backups before launch.
- [ ] **Resume content safety.** Upload checks cover extension, declared MIME, size, and PDF signature, but do not parse the full document or scan for malware. Add quarantine and malware scanning/content validation before exposing uploads in a public deployment.
- [ ] **Operational recovery is unverified.** No production backup/restore drill, data-retention validation, alerting/monitoring, incident-response procedure, or production load test has been performed.

## Medium priority — address before broad release

- [ ] **Auth cleanup scheduling.** `npm run db:cleanup-auth` removes expired session and account-action-token rows, but deployment does not schedule or monitor it. Define retention and run it using a controlled operations job.
- [ ] **Resume object lifecycle and reconciliation.** Configure provider-side lifecycle/versioning and a reconciliation process for orphaned objects; the external bucket has not been tested.
- [ ] **MFA and abuse controls.** MFA is not implemented. Review threat model and abuse controls for account recovery, registration, and provider-level email sending before broad release.
- [ ] **Coverage expansion.** Current tests exercise important authentication, ownership, application, resume, admin, Redis, and browser paths, but do not exhaustively traverse every UI state and API input combination.

## Low priority — quality and verification follow-up

- [ ] Manually test all role screens at supported narrow/wide viewport sizes, with keyboard-only navigation and a screen reader. Automated axe coverage is currently limited to the public landing page.
- [ ] Review production static-host/ingress security headers, caching, CSP, log retention, and privacy/retention policy for the real deployment.
- [ ] Review pagination limits and database query plans against production-like data volumes.

## Deployment and configuration notes

- `docker-compose.yml` provisions local PostgreSQL and Redis; `docker-compose.production.yml` is a template, not a hosted deployment.
- The production template keeps PostgreSQL/Redis on a private network and exposes only the web container on loopback by default. An external TLS ingress is required; sanitize forwarded headers and set `TRUST_PROXY` to match the real proxy chain.
- Production requires Redis and S3-compatible resume storage. S3 endpoint TLS is validated when a custom endpoint is configured; provider bucket privacy and IAM policy remain operator responsibilities.
- The API image runs as a non-root user and has a dependency readiness health check in production Compose. Database migrations run through a one-shot container before the API starts.
- Use a secret manager or protected deployment secret mechanism; do not commit `.env.production` or deploy example values and local seed credentials.
- Take and verify a database backup before migrations. Configure backups for both relational data and resume objects, then perform restore drills.
- No production URL, cloud resource, deployment result, or production service test result is asserted here.

## Verification commands

```bash
npm run typecheck
npm run lint
REDIS_URL=redis://localhost:6379 npm test
npm run test:e2e
npm run build
npm audit
npm audit --omit=dev
npx prisma validate
npx prisma migrate status
docker compose config --quiet
docker compose --env-file .env.production.example -f docker-compose.production.yml config --quiet
docker build -f server/Dockerfile --target runtime -t skillbridge-api .
docker build -f server/Dockerfile --target migrate -t skillbridge-migrate .
docker build -f client/Dockerfile -t skillbridge-web .
```
