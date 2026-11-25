# Architecture

SkillBridge uses a React SPA and a REST API with PostgreSQL persistence.

- The browser communicates through `/api` routes.
- JWT identity is verified by authentication middleware.
- JWTs include a unique token ID persisted as a revocable session; each authenticated request checks the session and current account/role state.
- Role middleware and resource ownership checks authorize domain operations, including recruiter listing and applicant access.
- TanStack Query owns server-state caches.
- Prisma owns database access and migration history.
- Zod validates API bodies and query filters.
- Multer applies extension, MIME, and size checks to resume uploads; the API additionally checks the PDF signature and serves resumes through authenticated routes.
- Administrative user and listing changes are committed with audit records in database transactions.

The current resume adapter writes to a local `uploads/` directory. It must be replaced with durable, private object storage before horizontal scaling or deployment on ephemeral container filesystems.
