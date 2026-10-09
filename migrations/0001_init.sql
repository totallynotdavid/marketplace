-- Times are Unix epoch milliseconds. Money is an integer in the currency's minor unit.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('seller', 'funder', 'admin')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_digest TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE password_resets (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  expires_at   INTEGER NOT NULL
) STRICT;

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
) STRICT;

CREATE TABLE listings (
  id           TEXT PRIMARY KEY,
  seller_id    TEXT NOT NULL REFERENCES users (id),
  debtor_name  TEXT NOT NULL,
  currency     TEXT NOT NULL CHECK (currency IN ('USD', 'PEN')),
  face_value   INTEGER NOT NULL CHECK (face_value > 0),
  asking_price INTEGER NOT NULL CHECK (asking_price > 0 AND asking_price <= face_value),
  due_date     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX listings_seller_id ON listings (seller_id);
CREATE INDEX listings_status ON listings (status, created_at);

CREATE TABLE offers (
  id         TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings (id),
  funder_id  TEXT NOT NULL REFERENCES users (id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX offers_listing_id ON offers (listing_id);
CREATE INDEX offers_funder_id ON offers (funder_id);
CREATE UNIQUE INDEX offers_one_pending ON offers (listing_id, funder_id) WHERE status = 'pending';
CREATE UNIQUE INDEX offers_one_accepted ON offers (listing_id) WHERE status = 'accepted';

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   TEXT NOT NULL REFERENCES users (id),
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
