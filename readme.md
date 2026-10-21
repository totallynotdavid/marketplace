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

- [mise](https://mise.jdx.dev). `mise install` sets up Bun and Node at the
  versions in `mise.toml`. The `cf` CLI runs under Node.
- A Cloudflare account on the Workers Paid plan to deploy. Hashing a password
  takes about 160 ms of CPU, and the Free plan allows 10 ms per request.

## Run locally

```bash
mise install
bun install --frozen-lockfile
bun run db:migrate:local
bun run dev
```

`bun run dev` starts the Worker with a local D1 database at the address it
prints. `bun run db:migrate:local` creates the tables from
`migrations/0001_init.sql` in the local D1 state.

## Commands

Run each with `bun run <script>`. The scripts live in `package.json`.

| Script             | Does                                               |
| ------------------ | -------------------------------------------------- |
| `db:migrate:local` | Applies D1 migrations to the local database.       |
| `dev`              | Starts the Worker with a local D1 database.        |
| `lint`             | Runs type-aware oxlint and `oxfmt --check`.        |
| `fix`              | Applies safe oxlint fixes and formats with oxfmt.  |
| `typecheck`        | Runs `tsc --noEmit`.                               |
| `test`             | Runs the tests against a real D1 database.         |
| `build`            | Builds the Worker into `.cloudflare/output`.       |
| `check`            | Runs lint, typecheck, test and build.              |
| `deploy`           | Builds and deploys with `cf deploy`.               |
| `create-admin`     | Creates the first admin in a deployed D1 database. |

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
else. [.env.example](.env.example) lists them, and Bun loads a `.env` copy. The
first admin is the only one that command creates, so run it once after the
migration.

## Layout

- `src/index.ts`: Worker entry: `fetch` and the daily `scheduled` sweep.
- `src/app.ts`: middleware order and route mounting.
- `src/routes/`: public, listing, offer and admin routes.
- `src/auth/`: passwords, tokens, sessions and rate limits.
- `migrations/0001_init.sql`: the schema.
- `test/`: tests that call the Worker's `fetch`.
