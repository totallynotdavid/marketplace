# project guidelines

## always

- use repo-local facts before assumptions
- use `bun` for JS workflows; run `cf` commands under Node
- follow existing architecture; keep changes minimal and task-local
- fix root causes, not symptoms
- state what was verified vs inferred

## commands

- `bun install`
- `bun run dev`: Worker with a local D1
- `bun run test`: Vitest in the Workers runtime, real D1
- `bun run lint`
- `bun run typecheck`
- `bun run format`
- `bun run build`
- `bun run deploy`
- `bun run create-admin <database-id>`: needs `ADMIN_EMAIL` and `ADMIN_PASSWORD`

## coding rules

- file and directory naming: kebab-case
- the schema lives only in `migrations/0001_init.sql`; change it there
- a route that needs no session goes in `src/routes/auth.tsx`; every route
  registered after `requireUser` in `src/app.ts` needs one
- a route for one role uses `allow(...)`; a new route gets a test through
  `worker.fetch`, including the roles that must be refused
- tests change stored timestamps to expire things; they do not mock the clock or
  the database

## documentation rules

- use lowercase `readme.md` for readme files
- use sentence-case headings
- keep docs operational: setup, commands, env vars, troubleshooting
- avoid filler and process narrative
- format markdown with
  `bunx prettier --print-width 80 --prose-wrap always --write '**/*.md'`
