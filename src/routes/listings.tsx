import { Hono } from "hono";
import type { AppEnv, SessionUser } from "../env.ts";
import { offerForm, parseForm, listingForm } from "../forms.ts";
import { conflict, formBody, isUniqueViolation, notFound } from "../http.tsx";
import { allow } from "../middleware.tsx";
import {
  ListingDetailPage,
  ListingFormPage,
  ListingsPage,
  type ListingRow,
  type OfferRow,
} from "../views/market.tsx";

export const listingRoutes = new Hono<AppEnv>();

const LISTING_COLUMNS = `l.id, l.seller_id, l.debtor_name, l.currency, l.face_value, l.asking_price,
  l.due_date, l.status, u.email AS seller_email`;

type StoredListing = ListingRow & { seller_id: string };

// Returns null when the listing does not exist or the user may not see it, so both look the same.
// A seller sees their own listings. A funder sees open listings and any listing they made an
// offer on. An admin sees all.
async function loadListing(
  db: D1Database,
  user: SessionUser,
  id: string,
): Promise<{ listing: StoredListing; offers: OfferRow[] } | null> {
  const listing = await db
    .prepare(
      `SELECT ${LISTING_COLUMNS} FROM listings l JOIN users u ON u.id = l.seller_id WHERE l.id = ?`,
    )
    .bind(id)
    .first<StoredListing>();
  if (!listing) return null;
  if (user.role === "seller" && listing.seller_id !== user.id) return null;

  const ownOffersOnly = user.role === "funder";
  const { results: offers } = await db
    .prepare(
      `SELECT o.id, f.email AS funder_email, o.amount, o.status, o.created_at, l.currency
       FROM offers o JOIN users f ON f.id = o.funder_id JOIN listings l ON l.id = o.listing_id
       WHERE o.listing_id = ?1 ${ownOffersOnly ? "AND o.funder_id = ?2" : ""}
       ORDER BY o.created_at DESC`,
    )
    .bind(...(ownOffersOnly ? [id, user.id] : [id]))
    .all<OfferRow>();

  if (ownOffersOnly && listing.status !== "open" && offers.length === 0) return null;
  return { listing, offers };
}

listingRoutes.get("/listings", async (c) => {
  const user = c.get("user")!;
  const filter =
    user.role === "seller"
      ? "WHERE l.seller_id = ?"
      : user.role === "funder"
        ? "WHERE l.status = 'open'"
        : "";
  const { results } = await c.env.DB.prepare(
    `SELECT ${LISTING_COLUMNS} FROM listings l JOIN users u ON u.id = l.seller_id
     ${filter} ORDER BY l.created_at DESC LIMIT 200`,
  )
    .bind(...(user.role === "seller" ? [user.id] : []))
    .all<ListingRow>();
  return c.html(<ListingsPage user={user} listings={results} />);
});

listingRoutes.get("/listings/new", allow("seller"), (c) =>
  c.html(<ListingFormPage user={c.get("user")!} />),
);

listingRoutes.post("/listings", allow("seller"), async (c) => {
  const user = c.get("user")!;
  const form = parseForm(listingForm, await formBody(c));
  if (!form.ok) return c.html(<ListingFormPage user={user} error={form.message} />, 400);

  const { debtorName, currency, faceValue, askingPrice, dueDate } = form.value;
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO listings
       (id, seller_id, debtor_name, currency, face_value, asking_price, due_date, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
  )
    .bind(id, user.id, debtorName, currency, faceValue, askingPrice, dueDate, now)
    .run();
  return c.redirect(`/listings/${id}`, 303);
});

listingRoutes.get("/listings/:id", async (c) => {
  const user = c.get("user")!;
  const found = await loadListing(c.env.DB, user, c.req.param("id"));
  if (!found) return notFound(c);
  return c.html(<ListingDetailPage user={user} {...found} />);
});

// A seller cancels their own listing and an admin cancels any. The offers are rejected in the
// same batch. Each statement re-checks that the listing is still open, so a concurrent accept
// or cancel leaves this one with nothing to change.
listingRoutes.post("/listings/:id/cancel", allow("seller", "admin"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const listing = await db
    .prepare("SELECT seller_id, status FROM listings WHERE id = ?")
    .bind(id)
    .first<{ seller_id: string; status: string }>();
  if (!listing || (user.role === "seller" && listing.seller_id !== user.id)) return notFound(c);
  if (listing.status !== "open") return conflict(c, "Only an open listing can be cancelled.");

  const now = Date.now();
  const stillOpen = "EXISTS (SELECT 1 FROM listings WHERE id = ?1 AND status = 'open')";
  const statements = [
    db
      .prepare(
        `UPDATE offers SET status = 'rejected', updated_at = ?2
         WHERE listing_id = ?1 AND status = 'pending' AND ${stillOpen}`,
      )
      .bind(id, now),
  ];
  if (user.role === "admin") {
    statements.unshift(
      db
        .prepare(
          `INSERT INTO audit_log (admin_id, action, target, created_at)
           SELECT ?2, 'cancel-listing', ?1, ?3 WHERE ${stillOpen}`,
        )
        .bind(id, user.id, now),
    );
  }
  statements.push(
    db
      .prepare(
        "UPDATE listings SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status = 'open'",
      )
      .bind(id, now),
  );
  const results = await db.batch(statements);
  if (results.at(-1)?.meta.changes !== 1)
    return conflict(c, "Only an open listing can be cancelled.");
  return c.redirect(`/listings/${id}`, 303);
});

listingRoutes.post("/listings/:id/offers", allow("funder"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const listing = await db
    .prepare("SELECT status, face_value FROM listings WHERE id = ?")
    .bind(id)
    .first<{ status: string; face_value: number }>();
  if (!listing) return notFound(c);
  if (listing.status !== "open") return conflict(c, "This listing is no longer open.");

  const form = parseForm(offerForm, await formBody(c));
  const message = !form.ok
    ? form.message
    : form.value.amount > listing.face_value
      ? "The offer cannot exceed the face value."
      : null;
  if (message || !form.ok) {
    const found = await loadListing(db, user, id);
    if (!found) return notFound(c);
    return c.html(<ListingDetailPage user={user} {...found} error={message ?? undefined} />, 400);
  }

  const now = Date.now();
  try {
    const inserted = await db
      .prepare(
        `INSERT INTO offers (id, listing_id, funder_id, amount, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE EXISTS (SELECT 1 FROM listings WHERE id = ?2 AND status = 'open')`,
      )
      .bind(crypto.randomUUID(), id, user.id, form.value.amount, now)
      .run();
    if (inserted.meta.changes !== 1) return conflict(c, "This listing is no longer open.");
  } catch (error) {
    if (isUniqueViolation(error))
      return conflict(c, "You already have a pending offer on this listing.");
    throw error;
  }
  return c.redirect(`/listings/${id}`, 303);
});
