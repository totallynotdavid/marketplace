import { Hono, type Context } from "hono";
import type { AppEnv } from "../env.ts";
import { conflict, notFound } from "../http.tsx";
import { allow } from "../middleware.tsx";
import { OffersPage, type OfferRow } from "../views/market.tsx";

export const offerRoutes = new Hono<AppEnv>();

offerRoutes.get("/offers", allow("funder"), async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.listing_id, l.debtor_name, l.currency, o.amount, o.status, o.created_at
     FROM offers o JOIN listings l ON l.id = o.listing_id
     WHERE o.funder_id = ? ORDER BY o.created_at DESC LIMIT 200`,
  )
    .bind(user.id)
    .all<OfferRow>();
  return c.html(<OffersPage user={user} offers={results} />);
});

offerRoutes.post("/offers/:id/withdraw", allow("funder"), async (c) => {
  const db = c.env.DB;
  const user = c.get("user")!;
  const id = c.req.param("id");
  const changed = await db
    .prepare(
      `UPDATE offers SET status = 'withdrawn', updated_at = ?3
       WHERE id = ?1 AND funder_id = ?2 AND status = 'pending'`,
    )
    .bind(id, user.id, Date.now())
    .run();
  if (changed.meta.changes === 1) return c.redirect("/offers", 303);

  const own = await db
    .prepare("SELECT 1 AS own FROM offers WHERE id = ? AND funder_id = ?")
    .bind(id, user.id)
    .first();
  return own ? conflict(c, "Only a pending offer can be withdrawn.") : notFound(c);
});

// Only the seller of the offer's listing may decide it. Any other seller gets the same 404 as a
// missing offer.
async function ownedOffer(c: Context<AppEnv>, id: string) {
  return c.env.DB.prepare(
    `SELECT o.listing_id FROM offers o JOIN listings l ON l.id = o.listing_id
     WHERE o.id = ? AND l.seller_id = ?`,
  )
    .bind(id, c.get("user")!.id)
    .first<{ listing_id: string }>();
}

offerRoutes.post("/offers/:id/reject", allow("seller"), async (c) => {
  const id = c.req.param("id");
  const offer = await ownedOffer(c, id);
  if (!offer) return notFound(c);
  const changed = await c.env.DB.prepare(
    "UPDATE offers SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(Date.now(), id)
    .run();
  if (changed.meta.changes !== 1) return conflict(c, "Only a pending offer can be rejected.");
  return c.redirect(`/listings/${offer.listing_id}`, 303);
});

// A pending offer always sits on an open listing, because every path that closes a listing
// settles its pending offers in the same batch. Accepting the offer is therefore the one check
// that decides a race: of two concurrent accepts, the second finds its offer already rejected
// and its other two statements change nothing.
offerRoutes.post("/offers/:id/accept", allow("seller"), async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const offer = await ownedOffer(c, id);
  if (!offer) return notFound(c);

  const now = Date.now();
  const accepted = "EXISTS (SELECT 1 FROM offers WHERE id = ?1 AND status = 'accepted')";
  const [first] = await db.batch([
    db
      .prepare(
        "UPDATE offers SET status = 'accepted', updated_at = ?2 WHERE id = ?1 AND status = 'pending'",
      )
      .bind(id, now),
    db
      .prepare(`UPDATE listings SET status = 'sold', updated_at = ?3 WHERE id = ?2 AND ${accepted}`)
      .bind(id, offer.listing_id, now),
    db
      .prepare(
        `UPDATE offers SET status = 'rejected', updated_at = ?3
         WHERE listing_id = ?2 AND status = 'pending' AND ${accepted}`,
      )
      .bind(id, offer.listing_id, now),
  ]);
  if (first?.meta.changes !== 1) return conflict(c, "Only a pending offer can be accepted.");
  return c.redirect(`/listings/${offer.listing_id}`, 303);
});
