# Production readiness checklist

This checklist records what was inspected and verified in the repository. A checked item means the corresponding implementation or local test was observed; it does not imply a deployed environment was exercised.

## Release status

**Not ready for public production deployment.** No critical exploitable defect was confirmed during this repository audit, but high-priority deployment and dependency risks remain. A full third-party penetration test and hosted-production verification were not performed.

## Verified implementation and local checks

- [x] Student, recruiter, and administrator routes are protected by role checks.
- [x] JWT session IDs are persisted, checked on authenticated requests, expired/revoked on logout, and invalidated by account suspension.
- [x] Recruiters can only manage their own listings and access applicants/resumes connected to their own listings.
- [x] Applications have a database uniqueness constraint and duplicate submissions return a conflict response.
- [x] Recruiters may delete draft listings only; closed listings can be reopened without deleting their application history.
- [x] Recruiter application status transitions are constrained; recruiters cannot mark applications withdrawn; students can withdraw only eligible applications.
- [x] Resume uploads enforce PDF extension/MIME, file-size limits, and PDF signature; retrieval is authenticated. Replacement/deletion preserve resume files referenced by submitted applications.
- [x] Admin user suspension/reactivation and listing moderation write audit records within database transactions; audit access is admin-only and paginated.
- [x] Job discovery validates enum, search, and pagination inputs; company-name search and newest/oldest sorting are implemented.
- [x] Paginated application, recruiter listing/applicant, admin user/listing, and audit-log views expose pagination metadata.
- [x] Prisma schema contains unique email, unique `(jobId, studentId)`, unique `(studentId, jobId)`, foreign-key, and session constraints.
- [x] Locally run: type checks, lint, test suite (11 PostgreSQL-backed API tests and 3 frontend workflow tests), and production builds.
- [x] Locally run: Prisma migration status (up to date), Compose configuration validation, API Docker image build, and a temporary container health smoke test.
- [ ] Hosted deployment, production database, HTTPS, backup/restore, scaling, and operational alerts were not tested.

## Critical priority

- No critical-severity issue was confirmed in the inspected code. This is not a security certification or penetration-test result.

## High priority — resolve before public launch

- [ ] **Dependency advisories:** `npm audit --omit=dev` reported four high-severity findings in the Prisma dependency chain, including `deepmerge-ts` and `effect` through `@prisma/config`/`prisma`. The suggested automatic remediation would make a breaking Prisma downgrade; no unverified override or downgrade was applied. Upgrade to a vendor-supported patched dependency set and rerun migration, build, and integration tests.
- [ ] **Resume durability and privacy:** uploads are stored on local container disk. Ephemeral filesystems and multiple API replicas can lose or fail to share files. Move storage to a private, encrypted object store, keep downloads authorization-checked or short-lived signed, and add malware scanning and retention controls.
- [ ] **Rate-limit scaling:** the current Express rate limiter uses in-process memory. It does not provide a shared limit across replicas and resets on process restart. Use a shared store and configure limits from observed production traffic.
- [ ] **Deployment coverage:** Docker Compose starts PostgreSQL only. The API image builds but no complete production stack, client container, deployment pipeline, deployed URL, or hosted production smoke test is present. Define and test the actual hosting topology, secrets, database migration process, HTTPS termination, backups, and rollback procedure before launch.

## Medium priority — address before broad release

- [ ] **Browser token storage:** JWTs are kept in `localStorage`, so an XSS defect could expose active tokens. Review an `HttpOnly`, `Secure`, `SameSite` cookie design and CSRF implications, or document and mitigate the accepted risk.
- [ ] **Validation and security regression coverage:** the expanded tests cover core role, ownership, application, resume, and admin flows. CORS allow/deny behavior, rate-limit thresholds, security headers, malformed inputs across every route, and concurrent resume replacement/application races are not comprehensively tested.
- [ ] **End-to-end and accessibility:** current frontend tests cover login/logout and unauthenticated route protection. Add full role workflows, browser-level tests, keyboard/screen-reader checks, and automated accessibility scanning. Responsive styling exists but was not manually verified across device/browser combinations in this audit.
- [ ] **Large-data paths:** recruiter per-listing applicant retrieval and notifications are capped/unpaginated; recruiter dashboard aggregation loads all owned listings/applications. Profile these and add pagination/aggregation for expected production volume.
- [ ] **Operations:** expired `SessionToken` rows are not automatically purged. Define retention and cleanup; configure database backups/restore tests, monitoring, log retention, and incident response.
- [ ] **Account lifecycle:** email verification, password reset, and MFA are not implemented. Decide whether they are required for the intended production audience and add abuse-resistant flows if so.
- [ ] **File validation:** PDF extension, declared MIME type, size, and magic bytes are checked, but content is not fully parsed or scanned. Treat uploads as untrusted until the storage/scanning controls above are delivered.

## Low priority — improve quality and maintainability

- [ ] Move Prisma's deprecated `package.json#prisma` seed configuration to the supported Prisma config format before upgrading to Prisma 7.
- [ ] Expand frontend component tests beyond the current authentication/protected-route coverage and assert loading, empty, error, and mutation states across each dashboard.
- [ ] Manually review contrast, focus visibility, labels, table semantics, and narrow-screen layout in all roles.
- [ ] The current Compose PostgreSQL credentials and published port are development defaults only; do not reuse them in production.

## Deployment and configuration notes

- `docker-compose.yml` provisions only a local PostgreSQL database; it is not a production deployment definition.
- `server/Dockerfile` is buildable, runs as a non-root user, and has a process-level API health check (it does not verify database readiness). It requires externally supplied environment variables and does not apply migrations automatically.
- Apply reviewed migrations with `npx prisma migrate deploy` before routing API traffic.
- Set a random `JWT_SECRET` of at least 32 characters, `DATABASE_URL`, `CLIENT_ORIGIN`, and `TRUST_PROXY` only when operating behind the expected single trusted proxy.
- Do not deploy the example environment values or local seed credentials.
- No production URL, cloud resource, deployment result, or production test result is asserted here.

## Verification commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx prisma migrate status
docker compose config --quiet
docker build -f server/Dockerfile -t skillbridge-api .
npm audit --omit=dev
```
