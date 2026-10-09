import type { SessionUser } from "../env.ts";
import { CURRENCIES, formatMoney } from "../forms.ts";
import { Layout, PostButton, formatTime } from "./layout.tsx";

export type ListingRow = {
  id: string;
  seller_email?: string;
  debtor_name: string;
  currency: string;
  face_value: number;
  asking_price: number;
  due_date: string;
  status: string;
};

export type OfferRow = {
  id: string;
  funder_email?: string;
  listing_id?: string;
  debtor_name?: string;
  currency: string;
  amount: number;
  status: string;
  created_at: number;
};

export function ListingsPage(props: { user: SessionUser; listings: ListingRow[] }) {
  const { user, listings } = props;
  const title =
    user.role === "funder"
      ? "Open listings"
      : user.role === "seller"
        ? "My listings"
        : "All listings";
  return (
    <Layout title={title} user={user}>
      {listings.length === 0 ? (
        <p class="muted">
          Nothing here yet.{" "}
          {user.role === "seller" && <a href="/listings/new">Create a listing.</a>}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Debtor</th>
              {user.role === "admin" && <th>Seller</th>}
              <th>Face value</th>
              <th>Asking price</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr>
                <td>
                  <a href={`/listings/${l.id}`}>{l.debtor_name}</a>
                </td>
                {user.role === "admin" && <td>{l.seller_email}</td>}
                <td>{formatMoney(l.face_value, l.currency)}</td>
                <td>{formatMoney(l.asking_price, l.currency)}</td>
                <td>{l.due_date}</td>
                <td>{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}

export function ListingFormPage(props: { user: SessionUser; error?: string }) {
  return (
    <Layout title="New listing" user={props.user}>
      {props.error && <p class="error">{props.error}</p>}
      <form method="post" action="/listings">
        <label for="debtorName">Debtor</label>
        <input id="debtorName" name="debtorName" maxlength={200} required />
        <label for="currency">Currency</label>
        <select id="currency" name="currency">
          {CURRENCIES.map((c) => (
            <option value={c}>{c}</option>
          ))}
        </select>
        <label for="faceValue">Face value</label>
        <input
          id="faceValue"
          name="faceValue"
          inputmode="decimal"
          placeholder="10000.00"
          required
        />
        <label for="askingPrice">Asking price</label>
        <input
          id="askingPrice"
          name="askingPrice"
          inputmode="decimal"
          placeholder="9000.00"
          required
        />
        <label for="dueDate">Due date</label>
        <input id="dueDate" name="dueDate" type="date" required />
        <p>
          <button type="submit">Publish listing</button>
        </p>
      </form>
    </Layout>
  );
}

export function ListingDetailPage(props: {
  user: SessionUser;
  listing: ListingRow;
  offers: OfferRow[];
  error?: string;
}) {
  const { user, listing, offers } = props;
  const open = listing.status === "open";
  const canCancel = open && (user.role === "admin" || user.role === "seller");
  const hasPending = offers.some((o) => o.status === "pending");
  return (
    <Layout title={listing.debtor_name} user={user}>
      {props.error && <p class="error">{props.error}</p>}
      <table>
        <tbody>
          <tr>
            <th>Face value</th>
            <td>{formatMoney(listing.face_value, listing.currency)}</td>
          </tr>
          <tr>
            <th>Asking price</th>
            <td>{formatMoney(listing.asking_price, listing.currency)}</td>
          </tr>
          <tr>
            <th>Due</th>
            <td>{listing.due_date}</td>
          </tr>
          <tr>
            <th>Status</th>
            <td>{listing.status}</td>
          </tr>
          {listing.seller_email && user.role === "admin" && (
            <tr>
              <th>Seller</th>
              <td>{listing.seller_email}</td>
            </tr>
          )}
        </tbody>
      </table>
      {canCancel && (
        <p>
          <PostButton action={`/listings/${listing.id}/cancel`} label="Cancel listing" />
        </p>
      )}
      {user.role === "funder" && open && !hasPending && (
        <form method="post" action={`/listings/${listing.id}/offers`}>
          <label for="amount">Your offer ({listing.currency})</label>
          <input id="amount" name="amount" inputmode="decimal" required />
          <p>
            <button type="submit">Make offer</button>
          </p>
        </form>
      )}
      <h2>{user.role === "funder" ? "Your offers" : "Offers"}</h2>
      {offers.length === 0 ? (
        <p class="muted">No offers.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {user.role !== "funder" && <th>Funder</th>}
              <th>Amount</th>
              <th>Status</th>
              <th>Made</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr>
                {user.role !== "funder" && <td>{o.funder_email}</td>}
                <td>{formatMoney(o.amount, o.currency)}</td>
                <td>{o.status}</td>
                <td>{formatTime(o.created_at)}</td>
                <td>
                  {user.role === "seller" && o.status === "pending" && (
                    <>
                      <PostButton action={`/offers/${o.id}/accept`} label="Accept" />{" "}
                      <PostButton action={`/offers/${o.id}/reject`} label="Reject" />
                    </>
                  )}
                  {user.role === "funder" && o.status === "pending" && (
                    <PostButton action={`/offers/${o.id}/withdraw`} label="Withdraw" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}

export function OffersPage(props: { user: SessionUser; offers: OfferRow[] }) {
  return (
    <Layout title="My offers" user={props.user}>
      {props.offers.length === 0 ? (
        <p class="muted">
          You have made no offers. <a href="/listings">Browse open listings.</a>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Made</th>
            </tr>
          </thead>
          <tbody>
            {props.offers.map((o) => (
              <tr>
                <td>
                  <a href={`/listings/${o.listing_id}`}>{o.debtor_name}</a>
                </td>
                <td>{formatMoney(o.amount, o.currency)}</td>
                <td>{o.status}</td>
                <td>{formatTime(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
