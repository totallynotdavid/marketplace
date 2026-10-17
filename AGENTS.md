# project guidelines

## always

- use repo-local facts before assumptions
- run `cf` commands under Node
- follow existing architecture; keep changes minimal and task-local
- fix root causes, not symptoms
- state what was verified vs inferred

## commands

- run commands as mise tasks; `mise tasks` lists them
- run `mise run check` before you finish

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
- format markdown with `mise run fix`
