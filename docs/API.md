# API overview

The API is served under `/api`. The frontend sends cookie credentials; authenticated state is not stored as a bearer token in browser local storage.

## Authentication and account lifecycle

- `POST /api/auth/register` — creates a student or recruiter account and sends a verification email; it does not start a session.
- `POST /api/auth/verify-email` — consumes a one-time email-verification token.
- `POST /api/auth/email-verification/resend` — requests another verification message.
- `POST /api/auth/login` — starts a persisted session for a verified active account and sets session/CSRF cookies.
- `POST /api/auth/logout` — revokes the current session and clears cookies.
- `GET /api/auth/me` — returns the current authenticated user.
- `POST /api/auth/password-reset/request` — requests a reset message with a non-enumerating response.
- `POST /api/auth/password-reset/confirm` — consumes a one-time reset token and changes the password, revoking existing sessions.

State-changing requests authenticated by cookies must send the matching CSRF cookie value in the `X-CSRF-Token` header. The API returns generic validation/error responses without exposing stack traces or credentials. Verification and reset links contain temporary bearer tokens: use the real TLS-protected application origin and avoid logging or sharing those URLs.

## Public and operational endpoints

- `GET /api/jobs`
- `GET /api/jobs/:id`
- `GET /api/health` — liveness only.
- `GET /api/ready` — checks PostgreSQL and configured Redis availability.

## Student

- `GET/PATCH /api/users/me/profile`
- `POST/GET/DELETE /api/users/me/resume`
- `GET/POST/DELETE /api/saved-jobs`
- `POST /api/jobs/:id/applications`
- `GET /api/applications/me`
- `PATCH /api/applications/:id/withdraw`
- `GET /api/student/dashboard`

## Recruiter

- `GET /api/recruiter/dashboard`
- `GET /api/recruiter/jobs` (status, title search, pagination)
- `GET /api/recruiter/applicants` (status, name/title search, pagination)
- `GET /api/recruiter/jobs/:id/applications`
- `GET /api/recruiter/applications/:id/resume`
- `PATCH /api/applications/:id/status`

## Administration

- `GET /api/admin/dashboard`
- `GET /api/admin/users` (role/search filters and pagination)
- `PATCH /api/admin/users/:id/status`
- `GET /api/admin/jobs` (status/search filters and pagination)
- `PATCH /api/admin/jobs/:id/moderation`
- `GET /api/admin/audit-logs` (pagination)

`GET /api/jobs` supports text, location, job type, work arrangement, experience level, newest/oldest sort, and pagination. Paginated endpoints return `items` and `pagination` (`page`, `pageSize`, `total`, `totalPages`). Invalid enum, search, or pagination values return HTTP 400. All non-public domain routes enforce session validity, active-account status, role checks, and resource ownership where applicable.
