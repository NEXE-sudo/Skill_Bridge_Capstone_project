# Development

The local application is run through the root npm workspace.

```bash
docker compose up -d postgres
npm run dev
```

Use separate browser sessions or clear local storage when testing multiple roles. API integration tests should use a dedicated test database.

Build and verify:

```bash
npm run typecheck
npm test
npm run build
```
