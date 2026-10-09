# Sentinel

A marketplace for contract factoring. A seller lists a receivable a debtor owes.
Funders offer a price below its face value. The seller accepts one offer.
Sentinel records the listing and the offers; payment happens between the two
parties.

It is a Cloudflare Worker (Hono, server-rendered HTML) on a D1 database. Roles
are `seller`, `funder` and `admin`. See [docs/decisions.md](docs/decisions.md)
for the feature set and the auth design.

Live deployment: <https://sentinel.caefisica.workers.dev>

## Requirements

- Bun 1.3 and Node 22.18 or later (`mise install` sets both up). The `cf` CLI
  runs under Node.
- A Cloudflare account on the Workers Paid plan to deploy. Hashing a password
  takes about 160 ms of CPU, and the Free plan allows 10 ms per request.

## Run locally

```bash
bun install
bun run db:migrate:local
bun run dev
```

`bun run dev` starts the Worker with a local D1 database at the address it
prints. `bun run db:migrate:local` creates the tables from
`migrations/0001_init.sql` in the local D1 state.

## Commands

| Command                    | Does                                               |
| -------------------------- | -------------------------------------------------- |
| `bun run db:migrate:local` | Applies D1 migrations to the local database.       |
| `bun run test`             | Runs the tests against a real D1 database.         |
| `bun run lint`             | Runs oxlint with type-aware rules.                 |
| `bun run typecheck`        | Runs `tsc --noEmit`.                               |
| `bun run format`           | Formats the code with oxfmt.                       |
| `bun run build`            | Builds the Worker into `.cloudflare/output`.       |
| `bun run deploy`           | Builds and deploys with `cf deploy`.               |
| `bun run create-admin`     | Creates the first admin in a deployed D1 database. |

## Deploy

```bash
cf auth login --no-browser
cf d1 create --name sentinel
cf d1 migrations apply <database-id>
cf deploy
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... bun run create-admin <database-id>
```

`<database-id>` is the `id` that `cf d1 create` prints. A database change edits
`migrations/0001_init.sql`; drop the database and run the steps again.

The Worker takes no environment variables; its only binding is the D1 database
`DB`. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are read by `create-admin` and nowhere
else. The first admin is the only one that command creates, so run it once after
the migration.

## Layout

- `src/index.ts`: Worker entry: `fetch` and the daily `scheduled` sweep.
- `src/app.ts`: middleware order and route mounting.
- `src/routes/`: public, listing, offer and admin routes.
- `src/auth/`: passwords, tokens, sessions and rate limits.
- `migrations/0001_init.sql`: the schema.
- `test/`: tests that call the Worker's `fetch`.
