# Architecture

SkillBridge uses a React SPA and a REST API with PostgreSQL persistence.

- The browser communicates through `/api` routes.
- JWT identity is verified by authentication middleware.
- Role middleware and resource ownership checks authorize domain operations.
- TanStack Query owns server-state caches.
- Prisma owns database access and migration history.
- Zod validates API request bodies.
- Multer performs PDF resume validation and size limiting.
