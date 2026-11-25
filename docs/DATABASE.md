# Database

The Prisma schema is the source of truth. Core entities are `User`, `AccountToken`, `SessionToken`, `StudentProfile`, `RecruiterProfile`, `Job`, `Application`, `SavedJob`, `Notification`, and `AuditLog`.

Important constraints and indexes:

- User email, account-token hash, and session JWT ID are unique.
- A student can apply once per job through unique `(jobId, studentId)` and save a job once through unique `(studentId, jobId)` constraints.
- Account-action and session records relate to users and cascade when a user is deleted; token expiry, consumption, session expiry, and revocation are tracked.
- Student profiles store resume object metadata. Each application snapshots the referenced resume key and filename so replacing or deleting the current resume does not invalidate historical applications.
- Job status/deadline, recruiter, application status/creation, notification, and audit lookup indexes support the main listing and pagination paths.
- Profile, job, application, saved-job, notification, and audit relations use referential integrity.

Prisma 7 loads database configuration from `prisma.config.ts`. Generate the client and apply migrations locally with `npx prisma generate` and `npx prisma migrate dev`; use `npx prisma migrate deploy` in an explicitly managed deployment/migration step. Check migration state with `npx prisma migrate status`.

Expired session and account-action token rows are removed by `npm run db:cleanup-auth`. This is a maintenance command, not an automatically scheduled task; configure and monitor its schedule in the deployment environment. Take and verify backups before production migrations. The repository has not run a production backup or restore drill.
