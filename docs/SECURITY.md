# Security

## Implemented controls

SkillBridge uses bcrypt password hashing; JWT sessions with persisted revocation; `HttpOnly` session cookies; a CSRF cookie/header check for state-changing requests; active-account and role checks; resource ownership authorization; Zod input validation; Helmet headers; CORS allowlists; JSON request-size limits; shared Redis rate limiting when configured; parameterized Prisma queries; and resume extension, MIME, size, and PDF-signature checks.

Registration permits only `STUDENT` and `RECRUITER`. Email verification and password-reset tokens are random, hashed at rest, time-limited, and consumed once. Password reset revokes the user's existing sessions. Admin user/listing operations write audit records transactionally. Error responses do not return password hashes or internal stack traces.

## Configuration requirements

Use an externally managed random `JWT_SECRET` of at least 32 characters, a production `DATABASE_URL`, exact browser `CLIENT_ORIGIN`, production Redis, SMTP credentials, and S3-compatible storage credentials/IAM. Production requires Redis and S3 storage; local filesystem storage is rejected in production. S3-compatible endpoints must use HTTPS. Configure the bucket for blocked public access and grant the API only required object and encryption-key actions.

Set `TRUST_PROXY` to the actual trusted proxy-hop count, not a copied default. The production Compose template assumes two trusted hops (external ingress and Nginx); the ingress must sanitize forwarded headers. Use `AUTH_COOKIE_SAME_SITE=none` only when cross-site cookies are required and HTTPS is enforced. Keep deployment secrets out of source control and use the platform's secret mechanism where available.

## Known residual risks and unverified controls

- Resume validation is not full PDF parsing, content disarm/reconstruction, or malware scanning. Treat uploaded content as untrusted; add a scanning/quarantine process before accepting sensitive production uploads.
- S3 bucket privacy, IAM policy, KMS configuration, object lifecycle/versioning, and backup/recovery have not been tested against a live provider. A configuration value alone does not establish that objects are private.
- SMTP delivery, sender-domain authentication, rate limiting at the email provider, and abuse handling have not been tested against a live provider.
- No production HTTPS ingress, trusted-forwarded-header chain, or hosted security-header policy was validated.
- No production penetration test, backup/restore test, monitoring/alerting validation, or incident-response exercise was performed.
- MFA is not implemented. The API and browser tests do not amount to exhaustive route-by-route fuzzing or screen-reader testing.

See [the production-readiness checklist](./PRODUCTION_READINESS.md) for priorities and evidence boundaries.
