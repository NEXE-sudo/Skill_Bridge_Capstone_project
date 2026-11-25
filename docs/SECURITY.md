# Security

SkillBridge implements bcrypt password hashing, signed JWT authentication with persisted revocation, per-request account/role checks, resource ownership checks, Zod validation, Helmet headers, CORS allowlists, JSON size limits, rate limiting, parameterized Prisma queries, and PDF resume restrictions.

No password hashes or internal stack traces are returned. The public registration endpoint accepts only `STUDENT` and `RECRUITER`. Administrative status and moderation operations create audit records.

Configure `JWT_SECRET`, `DATABASE_URL`, `CLIENT_ORIGIN`, `TRUST_PROXY`, and seed credentials using environment variables. Enable `TRUST_PROXY` only when the API is behind the expected single trusted reverse proxy; the default is disabled.

Known production limitations: JWTs are stored in browser `localStorage` (so XSS can expose them); rate limiting is process-local; resume files are local disk files with extension/MIME/signature checks but no malware scanning; and expired session-row retention is manual. Use private shared storage with malware scanning, a shared rate-limit backend, automated session cleanup, and a reviewed cookie/XSS strategy before public production deployment.
