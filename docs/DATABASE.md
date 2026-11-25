# Database

The Prisma schema is the source of truth. Core entities are `User`, `StudentProfile`, `RecruiterProfile`, `Job`, `Application`, `SavedJob`, `Notification`, and `AuditLog`.

Important constraints:

- User email is unique.
- A student can apply once per job through the unique `(jobId, studentId)` constraint.
- A student can save a job once through the unique `(studentId, jobId)` constraint.
- Profile, job, application, saved job, notification, and audit relations use referential integrity.

Run migrations with `npx prisma migrate dev` locally or `npx prisma migrate deploy` in deployment.
