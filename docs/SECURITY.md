# Security

SkillBridge implements bcrypt password hashing, signed JWT authentication, role guards, resource ownership checks, Zod validation, Helmet headers, CORS allowlists, JSON size limits, rate limiting, parameterized Prisma queries, and PDF resume restrictions.

No password hashes or internal stack traces are returned. The public registration endpoint accepts only `STUDENT` and `RECRUITER`. Administrative status and moderation operations create audit records.

Configure `JWT_SECRET`, `DATABASE_URL`, CORS origins, and seed credentials using environment variables. Replace development resume disk storage with private object storage before public production use.
