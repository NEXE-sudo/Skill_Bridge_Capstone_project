# API overview

Authentication:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Public:

- `GET /api/jobs`
- `GET /api/jobs/:id`

Student:
- `GET/PATCH /api/users/me/profile`
- `POST/GET/DELETE /api/users/me/resume`
- `GET/POST/DELETE /api/saved-jobs`
- `POST /api/jobs/:id/applications`
- `GET /api/applications/me`
- `PATCH /api/applications/:id/withdraw`
- `GET /api/student/dashboard`

Recruiter:
- `GET /api/recruiter/dashboard`
- `GET /api/recruiter/jobs` (supports status, title search, and pagination)
- `GET /api/recruiter/applicants` (supports status, name/title search, and pagination)
- `GET /api/recruiter/jobs/:id/applications`
- `GET /api/recruiter/applications/:id/resume`
- `PATCH /api/applications/:id/status`

Administration:
- `GET /api/admin/dashboard`
- `GET /api/admin/users` (role/search filters and pagination)
- `PATCH /api/admin/users/:id/status`
- `GET /api/admin/jobs` (status/search filters and pagination)
- `PATCH /api/admin/jobs/:id/moderation`
- `GET /api/admin/audit-logs` (pagination)

`GET /api/jobs` supports text, location, job type, work arrangement, experience level, newest/oldest sort, and pagination. Paginated endpoints return `items` and `pagination` (`page`, `pageSize`, `total`, `totalPages`). Invalid enum, search, or pagination values return HTTP 400. All non-public routes enforce JWT session validity, active-account status, role checks, and resource ownership where applicable.
