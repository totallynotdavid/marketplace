import type { SessionUser } from "../env.ts";
import { MIN_PASSWORD_LENGTH } from "../auth/password.ts";
import { Layout } from "./layout.tsx";

export function Message(props: { title: string; text: string; user: SessionUser | null }) {
  return (
    <Layout title={props.title} user={props.user}>
      <p>{props.text}</p>
    </Layout>
  );
}

export function Landing(props: { user: SessionUser | null }) {
  return (
    <Layout title="Sell and fund receivables" user={props.user}>
      <p>
        Sentinel is a marketplace for contract factoring. A seller lists a receivable a debtor owes.
        Funders offer a price below its face value. The seller accepts one offer.
      </p>
      <p>Sentinel records the listing and the offers. Payment happens between the two parties.</p>
      {props.user ? (
        <p>
          <a href="/listings">Open the marketplace</a>
        </p>
      ) : (
        <p>
          <a href="/register">Register</a> or <a href="/login">sign in</a>.
        </p>
      )}
    </Layout>
  );
}

export function SignInRequired() {
  return <LoginPage error="Sign in to continue." />;
}

// The failure page does not echo the email, so a wrong password and an unknown email return the
// same bytes.
export function LoginPage(props: { error?: string }) {
  return (
    <Layout title="Sign in" user={null}>
      {props.error && <p class="error">{props.error}</p>}
      <form method="post" action="/login">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
        <p>
          <button type="submit">Sign in</button>
        </p>
      </form>
      <p class="muted">Forgot your password? Ask an admin for a reset link.</p>
    </Layout>
  );
}

export function RegisterPage(props: { error?: string; email: string }) {
  return (
    <Layout title="Register" user={null}>
      {props.error && <p class="error">{props.error}</p>}
      <form method="post" action="/register">
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="username"
          required
          value={props.email}
        />
        <label for="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength={MIN_PASSWORD_LENGTH}
          required
        />
        <label for="role">I want to</label>
        <select id="role" name="role" required>
          <option value="seller">sell receivables</option>
          <option value="funder">fund receivables</option>
        </select>
        <p>
          <button type="submit">Create account</button>
        </p>
      </form>
    </Layout>
  );
}

export function ResetPage(props: { token: string; error?: string }) {
  return (
    <Layout title="Set a new password" user={null}>
      {props.error && <p class="error">{props.error}</p>}
      <form method="post" action={`/reset/${props.token}`}>
        <label for="password">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength={MIN_PASSWORD_LENGTH}
          required
        />
        <p>
          <button type="submit">Set password</button>
        </p>
      </form>
    </Layout>
  );
}
