import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createListing, makeAdmin, makeOffer, offerId, register } from "./helpers.ts";

async function statusOf(table: "listings" | "offers", id: string): Promise<string> {
  const row = await env.DB.prepare(`SELECT status FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  return row!.status;
}

describe("listings", () => {
  it("stores money as integers in the minor unit", async () => {
    const seller = await register("seller");
    const id = await createListing(seller, { faceValue: "10000.50", askingPrice: "9000.05" });
    const row = await env.DB.prepare(
      "SELECT face_value, asking_price, status FROM listings WHERE id = ?",
    )
      .bind(id)
      .first();
    expect(row).toEqual({ face_value: 1000050, asking_price: 900005, status: "open" });
  });

  it.each([
    ["an asking price above the face value", { askingPrice: "10000.01" }],
    ["a zero face value", { faceValue: "0", askingPrice: "0" }],
    ["a negative price", { askingPrice: "-5" }],
    ["three decimals", { askingPrice: "9000.001" }],
    ["text for a price", { askingPrice: "lots" }],
    ["an unknown currency", { currency: "XYZ" }],
    ["a malformed date", { dueDate: "tomorrow" }],
    ["an impossible date", { dueDate: "2027-02-30" }],
    ["a blank debtor", { debtorName: "   " }],
  ])("refuses %s", async (_name, fields) => {
    const seller = await register("seller");
    const res = await call("/listings", {
      cookie: seller.cookie,
      form: {
        debtorName: "Acme SAC",
        currency: "USD",
        faceValue: "10000.00",
        askingPrice: "9000.00",
        dueDate: "2027-03-01",
        ...fields,
      },
    });
    expect(res.status).toBe(400);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM listings").first<{ n: number }>())!.n,
    ).toBe(0);
  });

  it("escapes the debtor name in pages", async () => {
    const seller = await register("seller");
    const id = await createListing(seller, { debtorName: "<script>alert(1)</script>" });
    const html = await (await call(`/listings/${id}`, { cookie: seller.cookie })).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows funders open listings and a seller only their own", async () => {
    const sellerA = await register("seller");
    const sellerB = await register("seller");
    const funder = await register("funder");
    await createListing(sellerA, { debtorName: "Debtor of A" });
    await createListing(sellerB, { debtorName: "Debtor of B" });
    const asFunder = await (await call("/listings", { cookie: funder.cookie })).text();
    expect(asFunder).toContain("Debtor of A");
    expect(asFunder).toContain("Debtor of B");
    const asA = await (await call("/listings", { cookie: sellerA.cookie })).text();
    expect(asA).toContain("Debtor of A");
    expect(asA).not.toContain("Debtor of B");
  });

  it("answers 404 when a seller opens another seller's listing", async () => {
    const owner = await register("seller");
    const other = await register("seller");
    const id = await createListing(owner);
    expect((await call(`/listings/${id}`, { cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/listings/${id}`, { cookie: other.cookie })).status).toBe(404);
  });

  it("hides a sold listing from a funder who made no offer on it", async () => {
    const seller = await register("seller");
    const bidder = await register("funder");
    const bystander = await register("funder");
    const id = await createListing(seller);
    await makeOffer(bidder, id);
    await call(`/offers/${await offerId(id, bidder.id)}/accept`, {
      form: {},
      cookie: seller.cookie,
    });
    expect((await call(`/listings/${id}`, { cookie: bidder.cookie })).status).toBe(200);
    expect((await call(`/listings/${id}`, { cookie: bystander.cookie })).status).toBe(404);
  });

  it("lets a seller cancel an open listing and rejects its pending offers", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await makeOffer(funder, id);
    const res = await call(`/listings/${id}/cancel`, { form: {}, cookie: seller.cookie });
    expect(res.status).toBe(303);
    expect(await statusOf("listings", id)).toBe("cancelled");
    const offer = await env.DB.prepare("SELECT status FROM offers").first<{ status: string }>();
    expect(offer!.status).toBe("rejected");
  });

  it("answers 404 when a seller cancels another seller's listing", async () => {
    const owner = await register("seller");
    const other = await register("seller");
    const id = await createListing(owner);
    const res = await call(`/listings/${id}/cancel`, { form: {}, cookie: other.cookie });
    expect(res.status).toBe(404);
    expect(await statusOf("listings", id)).toBe("open");
  });

  it("answers 409 when cancelling a listing that is not open", async () => {
    const seller = await register("seller");
    const id = await createListing(seller);
    await call(`/listings/${id}/cancel`, { form: {}, cookie: seller.cookie });
    const again = await call(`/listings/${id}/cancel`, { form: {}, cookie: seller.cookie });
    expect(again.status).toBe(409);
  });

  it("lets an admin cancel any open listing and audits it", async () => {
    const admin = await makeAdmin();
    const seller = await register("seller");
    const id = await createListing(seller);
    const res = await call(`/listings/${id}/cancel`, { form: {}, cookie: admin.cookie });
    expect(res.status).toBe(303);
    expect(await statusOf("listings", id)).toBe("cancelled");
    const log = await env.DB.prepare("SELECT admin_id, action, target FROM audit_log").first();
    expect(log).toEqual({ admin_id: admin.id, action: "cancel-listing", target: id });
  });

  it("writes no audit row when the admin's cancel finds the listing already closed", async () => {
    const admin = await makeAdmin();
    const seller = await register("seller");
    const id = await createListing(seller);
    await call(`/listings/${id}/cancel`, { form: {}, cookie: seller.cookie });
    const res = await call(`/listings/${id}/cancel`, { form: {}, cookie: admin.cookie });
    expect(res.status).toBe(409);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n,
    ).toBe(0);
  });
});

describe("offers", () => {
  it("records a pending offer from a funder", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    const res = await makeOffer(funder, id, "8500.50");
    expect(res.status).toBe(303);
    const row = await env.DB.prepare("SELECT amount, status, funder_id FROM offers").first();
    expect(row).toEqual({ amount: 850050, status: "pending", funder_id: funder.id });
  });

  it.each([["0"], ["-1"], ["abc"], ["10000.01"], ["1.234"]])(
    "refuses an amount of %s",
    async (amount) => {
      const seller = await register("seller");
      const funder = await register("funder");
      const id = await createListing(seller);
      expect((await makeOffer(funder, id, amount)).status).toBe(400);
    },
  );

  it("allows one pending offer per funder per listing", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    expect((await makeOffer(funder, id)).status).toBe(303);
    expect((await makeOffer(funder, id, "8600.00")).status).toBe(409);
  });

  it("lets a funder withdraw and offer again", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await makeOffer(funder, id);
    const first = await offerId(id, funder.id);
    expect(
      (await call(`/offers/${first}/withdraw`, { form: {}, cookie: funder.cookie })).status,
    ).toBe(303);
    expect(await statusOf("offers", first)).toBe("withdrawn");
    expect((await makeOffer(funder, id, "8700.00")).status).toBe(303);
  });

  it("refuses an offer on a listing that is not open or does not exist", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await call(`/listings/${id}/cancel`, { form: {}, cookie: seller.cookie });
    expect((await makeOffer(funder, id)).status).toBe(409);
    expect((await makeOffer(funder, "missing")).status).toBe(404);
  });

  it("answers 404 when a funder withdraws another funder's offer", async () => {
    const seller = await register("seller");
    const owner = await register("funder");
    const other = await register("funder");
    const id = await createListing(seller);
    await makeOffer(owner, id);
    const offer = await offerId(id, owner.id);
    expect(
      (await call(`/offers/${offer}/withdraw`, { form: {}, cookie: other.cookie })).status,
    ).toBe(404);
    expect(await statusOf("offers", offer)).toBe("pending");
  });

  it("shows a funder only their own offers, and a seller every offer on their listing", async () => {
    const seller = await register("seller");
    const first = await register("funder");
    const second = await register("funder");
    const id = await createListing(seller);
    await makeOffer(first, id, "8100.00");
    await makeOffer(second, id, "8200.00");

    const asFirst = await (await call(`/listings/${id}`, { cookie: first.cookie })).text();
    expect(asFirst).toContain("8,100.00");
    expect(asFirst).not.toContain("8,200.00");
    expect(await (await call("/offers", { cookie: first.cookie })).text()).not.toContain(
      "8,200.00",
    );

    const asSeller = await (await call(`/listings/${id}`, { cookie: seller.cookie })).text();
    expect(asSeller).toContain("8,100.00");
    expect(asSeller).toContain("8,200.00");
  });

  it("lets only the listing's seller accept or reject", async () => {
    const owner = await register("seller");
    const other = await register("seller");
    const funder = await register("funder");
    const id = await createListing(owner);
    await makeOffer(funder, id);
    const offer = await offerId(id, funder.id);
    expect((await call(`/offers/${offer}/accept`, { form: {}, cookie: other.cookie })).status).toBe(
      404,
    );
    expect((await call(`/offers/${offer}/reject`, { form: {}, cookie: other.cookie })).status).toBe(
      404,
    );
    expect(await statusOf("offers", offer)).toBe("pending");
    expect((await call(`/offers/${offer}/reject`, { form: {}, cookie: owner.cookie })).status).toBe(
      303,
    );
    expect(await statusOf("offers", offer)).toBe("rejected");
    expect(await statusOf("listings", id)).toBe("open");
  });

  it("sells the listing and rejects the other pending offers in one step", async () => {
    const seller = await register("seller");
    const winner = await register("funder");
    const loser = await register("funder");
    const id = await createListing(seller);
    await makeOffer(winner, id, "8800.00");
    await makeOffer(loser, id, "8700.00");
    const res = await call(`/offers/${await offerId(id, winner.id)}/accept`, {
      form: {},
      cookie: seller.cookie,
    });
    expect(res.status).toBe(303);
    expect(await statusOf("listings", id)).toBe("sold");
    const rows = await env.DB.prepare("SELECT funder_id, status FROM offers").all<{
      funder_id: string;
      status: string;
    }>();
    const byFunder = Object.fromEntries(rows.results.map((r) => [r.funder_id, r.status]));
    expect(byFunder).toEqual({ [winner.id]: "accepted", [loser.id]: "rejected" });
  });

  it("lets exactly one of two concurrent accepts win", async () => {
    const seller = await register("seller");
    const first = await register("funder");
    const second = await register("funder");
    const id = await createListing(seller);
    await makeOffer(first, id, "8800.00");
    await makeOffer(second, id, "8700.00");
    const offers = [await offerId(id, first.id), await offerId(id, second.id)];
    const results = await Promise.all(
      offers.map((offer) => call(`/offers/${offer}/accept`, { form: {}, cookie: seller.cookie })),
    );
    expect(results.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([303, 409]);
    const accepted = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM offers WHERE status = 'accepted'",
    ).first<{
      n: number;
    }>();
    expect(accepted!.n).toBe(1);
  });

  it("answers 409 for an offer that already left pending", async () => {
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await makeOffer(funder, id);
    const offer = await offerId(id, funder.id);
    await call(`/offers/${offer}/withdraw`, { form: {}, cookie: funder.cookie });
    expect(
      (await call(`/offers/${offer}/accept`, { form: {}, cookie: seller.cookie })).status,
    ).toBe(409);
    expect(await statusOf("listings", id)).toBe("open");
  });
});

describe("deactivation", () => {
  it("withdraws a deactivated funder's pending offers", async () => {
    const admin = await makeAdmin();
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await makeOffer(funder, id);
    await call(`/admin/users/${funder.id}/deactivate`, { form: {}, cookie: admin.cookie });
    expect(
      await statusOf(
        "offers",
        (await env.DB.prepare("SELECT id FROM offers").first<{ id: string }>())!.id,
      ),
    ).toBe("withdrawn");
  });

  it("cancels a deactivated seller's open listings and rejects their offers", async () => {
    const admin = await makeAdmin();
    const seller = await register("seller");
    const funder = await register("funder");
    const id = await createListing(seller);
    await makeOffer(funder, id);
    await call(`/admin/users/${seller.id}/deactivate`, { form: {}, cookie: admin.cookie });
    expect(await statusOf("listings", id)).toBe("cancelled");
    const offer = await env.DB.prepare("SELECT status FROM offers").first<{ status: string }>();
    expect(offer!.status).toBe("rejected");
  });
});

describe("public pages", () => {
  it("answers the landing page and the health check without a session", async () => {
    expect((await call("/")).status).toBe(200);
    const health = await call("/healthz");
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
  });

  it("answers 404 for an unknown path when signed in", async () => {
    const seller = await register("seller");
    expect((await call("/nope", { cookie: seller.cookie })).status).toBe(404);
  });
});
