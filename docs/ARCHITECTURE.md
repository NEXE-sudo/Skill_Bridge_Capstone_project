# Architecture

SkillBridge consists of a React single-page application, an Express REST API, PostgreSQL, Redis, and external email and object-storage providers.

- The browser calls same-origin `/api` endpoints through the Nginx client container in the production Compose template.
- Authentication uses a signed JWT in an `HttpOnly` cookie, a separate CSRF cookie/header, and a persisted revocable session ID. Every authenticated request checks the session and current account/role state.
- Role middleware and ownership checks authorize domain operations, including recruiter listing, applicant, and resume access.
- TanStack Query owns browser server-state caches.
- Prisma 7 and its PostgreSQL adapter own persistence and migration history. Zod validates API bodies and query filters.
- Redis provides shared rate-limit state when configured; production startup requires Redis. Store errors fail closed with HTTP 503. Local development may use the in-process limiter when Redis is not configured.
- Multer applies extension, MIME, and size checks to resume uploads; the API additionally checks the PDF signature. Downloads remain authenticated and are authorized against the relevant student or recruiter relationship.
- The production resume adapter stores objects in S3-compatible private storage with server-side encryption configured. Local disk storage is for development/tests only.
- Account verification and password-reset tokens are random, hashed before persistence, single-use, and time-limited. SMTP delivery is provided through a configurable adapter; development captures messages in the API console.
- Administrative user and listing changes are committed with audit records in database transactions.
- The API exposes liveness (`/api/health`) and dependency readiness (`/api/ready`) endpoints.

## Deployment topology

`docker-compose.production.yml` provides PostgreSQL and Redis on a private data network, a migration job, an API, and a web container exposed on loopback by default. It is a deployment template, not an external ingress, cloud resource, or hosted deployment. A TLS-terminating ingress must sanitize forwarded headers; the configured Express trusted-proxy hop count must match the real chain.

The S3 endpoint, IAM/bucket policy, SMTP service, TLS ingress, secret manager, backups, and monitoring are external dependencies. The repository does not verify their live configuration.
