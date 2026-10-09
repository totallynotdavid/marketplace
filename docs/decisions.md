# Decisions

The product, its users, its feature set and its auth design.

## What the product is for

Sentinel is a marketplace for contract factoring. A seller holds a receivable: a
contract or invoice a debtor owes, due on a future date. The seller wants cash
now. A funder buys the receivable below face value and collects from the debtor
at maturity. Sentinel is where the seller lists the receivable and funders bid
for it.

Sentinel records the listing, the offers and the winning offer. It does not move
money. Payment between seller and funder happens outside it.

## Who uses it

| Role     | Does                                                                                                  | Created by                              |
| -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `seller` | Lists receivables. Sees the offers on their own listings. Accepts or rejects them. Cancels a listing. | Self-registration                       |
| `funder` | Browses open listings. Offers a price. Withdraws their own pending offer.                             | Self-registration                       |
| `admin`  | Deactivates and reactivates users. Issues password-reset links. Cancels any open listing.             | The `create-admin` script, nowhere else |

The role is fixed at creation. Nothing in the product changes it. The debtor is
not a user. The debtor is a name on the listing.

## Minimal feature set

- Register as seller or funder. Sign in. Sign out.
- Seller: create a listing (debtor name, currency, face value, asking price, due
  date), see own listings and their offers, accept or reject an offer, cancel an
  open listing.
- Funder: list open listings, offer a price on one, see own offers, withdraw a
  pending offer.
- Admin: list users, deactivate or reactivate one, issue a password-reset link,
  cancel an open listing, read the audit log.
- Password reset: an admin issues a single-use link and hands it to the user.

### Visibility

- A seller sees their own listings and every offer on them.
- A funder sees open listings, and any listing they have offered on, with only
  their own offers. A funder never sees another funder's offer.
- An admin sees everything.
- A listing or offer the user may not see answers 404, the same as one that does
  not exist.

### Listing and offer states

| Listing     | Moves to    | Moved by                                      |
| ----------- | ----------- | --------------------------------------------- |
| `open`      | `sold`      | The seller accepting an offer.                |
| `open`      | `cancelled` | The seller on their own listing, or an admin. |
| `sold`      | none        |                                               |
| `cancelled` | none        |                                               |

| Offer     | Moves to    | Moved by                                                                                                       |
| --------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `pending` | `accepted`  | The listing's seller.                                                                                          |
| `pending` | `rejected`  | The listing's seller, or the system when another offer on the listing is accepted or the listing is cancelled. |
| `pending` | `withdrawn` | The offering funder, or the system when an admin deactivates the funder.                                       |

- A funder has at most one pending offer per listing. An offer is a positive
  amount no higher than the listing's face value.
- Every path that closes a listing settles its pending offers in the same batch,
  so a pending offer always sits on an open listing. Accepting an offer changes
  it from `pending` to `accepted`, marks the listing `sold` and rejects the
  other pending offers in one batch. Of two concurrent accepts the second finds
  its offer no longer pending and changes nothing. A unique index allows one
  accepted offer per listing.
- Deactivating a seller cancels their open listings and rejects the offers on
  them. Deactivating a funder withdraws their pending offers.

## Auth design

Auth is built in the application, on the same database as everything else. No
third-party identity service: a session check that needs an external service
cannot be tested through the real entry point, and the product does not need
one.

### Sessions

- A session is a row. The cookie `__Host-sid` holds a random 32-byte token. The
  table stores only its SHA-256 digest, so a leaked database does not leak live
  sessions.
- The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, with no
  `Domain`. The `__Host-` prefix makes the browser enforce the last three.
- A session has an absolute lifetime of 7 days and an idle timeout of 24 hours.
  Every request checks both against the clock. A daily scheduled sweep deletes
  expired rows, but a request never depends on the sweep having run.
- Every request re-reads the user. A deactivated user's request deletes the
  session and returns 401, the same as a bad password.
- Sign-out deletes that session row and no other.
- Deactivating a user and redeeming a reset link each delete every session of
  the user.

### Passwords

- Hashed with scrypt (N=2^14, r=8, p=5) and a per-password random salt. The
  stored string carries its parameters, so they can change. Verification uses a
  constant-time compare and rejects an unknown prefix.
- Minimum length 10, maximum 128. No composition rules.
- Sign-in for an unknown email runs a hash against a dummy value, so the
  response time does not reveal whether the email exists. Unknown email, wrong
  password and deactivated user return the same status and the same page.
- One hash costs about 160 ms of CPU. The Workers Free plan allows 10 ms of CPU
  per request, so Sentinel needs the Workers Paid plan.

### Roles

- `users.role` is the single source of truth: `seller`, `funder` or `admin`.
- The routes that need no sign-in are listed in `src/routes/auth.tsx`. Every
  route registered after them requires a session, so a route added later is
  closed by default. A route for one role declares it with the `allow`
  middleware, not with a test inside the handler.
- A test walks the router and asserts that every route outside the public list
  answers a signed-out request with 401. Another asserts, for each role-specific
  route, that every other role gets 403.
- Registration accepts only `seller` and `funder`. The `create-admin` script is
  the only writer of `admin`. It inserts nothing when an admin already exists,
  fails when the email belongs to another user, and is not exposed as a route.
- An admin cannot be deactivated, so the last admin cannot lock themselves out.

### Rate limits

- Counters live in the database. Sign-in is limited to 5 attempts per email and
  20 per client IP in a 15-minute window. Every attempt counts before the
  password is checked, so the 6th attempt returns 429 with `Retry-After`, and a
  correct password does not bypass it. The limit applies whether or not the
  email exists.
- A counter increments in one statement, so concurrent attempts cannot all slip
  under the limit.
- A successful sign-in clears the email counter and not the IP counter.
- Reset-link redemption is limited to 20 attempts per client IP in 15 minutes.
  Registration is limited to 10 per client IP per hour.
- Someone who knows an email can lock that email out of sign-in for the rest of
  a 15-minute window by failing five times. The limit trades that for a bound on
  password guessing.

### Password reset

- An admin issues the link. The token is random, stored as a digest, single-use,
  and valid for 1 hour. A new link replaces the previous one for that user. The
  link is shown once, in the response that issues it.
- Redeeming a link sets the password, deletes the link and deletes all the
  user's sessions in one batch. Of two concurrent redemptions, one succeeds.
- No email is sent. The product has no mail provider, and a reset flow that
  silently fails without one is worse than one an admin hands over.

### Request safety

- Every request other than GET and HEAD must carry an `Origin` header equal to
  the request's own origin. This closes cross-site form posts that
  `SameSite=Lax` allows on top-level navigation.
- Every response carries `Cache-Control: private, no-store`, a
  `Content-Security-Policy` that allows no script and no external resource,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- Every form is parsed against a schema before use. Amounts are integers in the
  currency's minor unit.
- Every admin action writes an audit row in the same batch as the action. An
  action that changes nothing writes no row.

### Lessons applied

Each rule above answers a defect found in earlier products:

| Defect                                                                             | Rule                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A role stored in two places drifted apart, and a user signed in as the wrong role. | One `users.role` column. No membership table, no second copy.                 |
| A framework endpoint let an owner promote a member past the app's own check.       | No auth plugin with its own endpoints. A test lists the routes that exist.    |
| A user was created, the follow-up step failed, and the error was swallowed.        | The user and the session are written in one batch. No error is swallowed.     |
| A deactivated user kept a working session.                                         | Every request re-reads the user.                                              |
| Reset tokens were kept in plaintext on the user row and leaked in `/me`.           | Digest-only storage in its own table. No page selects it.                     |
| A password change left other sessions alive.                                       | Redeeming a reset deletes all sessions of the user.                           |
| An expired-row sweep was written and never scheduled.                              | Expiry is checked on read. The sweep is housekeeping, and has a test.         |
| An audited write could skip its audit row.                                         | The audit row is in the same batch as the action.                             |
| A duplicate-user error returned 500 instead of 409.                                | Registration answers a duplicate email with 409, and a test checks it.        |
| A transition was undocumented, so reviewers could not check it.                    | The state tables in this file list every transition and who moves it.         |
| Nothing limited password guessing.                                                 | Counters per email and per IP, counted before the check, tested concurrently. |

## Stack

- Runtime: a Cloudflare Worker with the Hono framework, server-rendered HTML, no
  client framework. Every page is a form or a link.
- Database: Cloudflare D1. One migration, `migrations/0001_init.sql`, defines
  the whole schema, and is the schema's only description. A schema change edits
  that file, and the database is dropped and rebuilt.
- Tests: Vitest in the Workers runtime with a real D1 database. Tests call the
  Worker's `fetch` the way a browser does: they register, sign in with the
  returned cookie, and move a session's stored timestamps to expire it.

There is no wallet, ledger or balance table. Sentinel holds no money.

## What was cut

| Cut                                                                         | Why                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent` (Google ADK, LiteLLM, credit scoring, matching)                | It does not earn its place. The web app reaches it through a proxy to a fixed Cloud Run URL, and the only caller is the chat widget. Scores and "factor" profiles live in tables nothing else reads.                                                                                                                                     |
| `apps/chain` (Solana vault program) and all wallet code                     | Funds held on chain and mirrored in a database balance need a custodian, a reconciliation job and a legal basis. The product does not need any of them to match a seller and a funder. The deposit route also credits the balance from a client-supplied transaction signature with no uniqueness check, so one deposit can be replayed. |
| Docker compose, Makefile, devcontainer                                      | The database is D1. `cf dev` runs the Worker and a local D1.                                                                                                                                                                                                                                                                             |
| Clerk                                                                       | An external identity service cannot be driven by a test, and it left users with an empty email and no role.                                                                                                                                                                                                                              |
| Next.js, Tailwind, React, SWR and the Solana client libraries               | The product is forms and tables. A server-rendered Worker is smaller and deploys on one runtime.                                                                                                                                                                                                                                         |
| Counter-offers and offer expiry                                             | A counter adds a state machine for a feature no one asked for. A funder who wants a different price withdraws and offers again. Offers carry an expiry date today, but `expireOffer` in `apps/web/src/lib/db/queries/offers.ts` has no caller, so no offer ever expires.                                                                 |
| Risk category, document link, negotiation deadline                          | The seller picks the risk category from a menu and nothing verifies it, so it tells a funder nothing. No form or route sets the document link. The negotiation deadline is set when the first offer arrives and no code reads it.                                                                                                        |
| `documentos`, `credit_scores`, `cedentes`, `factores`, `intenciones` tables | Defined in the web schema and queried only by the agent.                                                                                                                                                                                                                                                                                 |
| PostgreSQL schema and `migrations/0000_*.sql`                               | Databases are disposable. The new schema has no relation to the old one.                                                                                                                                                                                                                                                                 |
