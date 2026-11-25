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
- `POST/DELETE /api/users/me/resume`
- `GET/POST/DELETE /api/saved-jobs`
- `POST /api/jobs/:id/applications`
- `GET /api/applications/me`
- `PATCH /api/applications/:id/withdraw`
- `GET /api/student/dashboard`

Recruiter and admin routes are documented by role in the implementation and enforce JWT role checks plus resource ownership.
