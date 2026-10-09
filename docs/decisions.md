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

Auth is built in the application and uses the same database as the marketplace.
The request path and the tests use the Worker's real entry point.

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

### Password reset

- An admin issues the link. The token is random, stored as a digest, single-use,
  and valid for 1 hour. A new link replaces the previous one for that user. The
  link is shown once, in the response that issues it.
- Redeeming a link sets the password, deletes the link and deletes all the
  user's sessions in one batch. Of two concurrent redemptions, one succeeds.
- The reset link is returned to the admin. No email is sent.

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

## Stack

- Runtime: a Cloudflare Worker with the Hono framework, server-rendered HTML, no
  client framework. Every page is a form or a link.
- Database: Cloudflare D1. One migration, `migrations/0001_init.sql`, defines
  the whole schema, and is the schema's only description. A schema change edits
  that file, and the database is dropped and rebuilt.
- Tests: Vitest in the Workers runtime with a real D1 database. Tests call the
  Worker's `fetch` the way a browser does: they register, sign in with the
  returned cookie, and move a session's stored timestamps to expire it.
