import { Hono } from "hono";
import {
  LOGIN_EMAIL_LIMIT,
  LOGIN_IP_LIMIT,
  RATE_WINDOW_MS,
  REGISTER_IP_LIMIT,
  REGISTER_WINDOW_MS,
  RESET_IP_LIMIT,
  type AppEnv,
} from "../env.ts";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/password.ts";
import { clear, hit } from "../auth/rate-limit.ts";
import {
  clearSessionCookie,
  endSession,
  newSession,
  sessionToken,
  setSessionCookie,
} from "../auth/session.ts";
import { digest } from "../auth/token.ts";
import { loginForm, parseForm, registerForm, resetForm } from "../forms.ts";
import { formBody, tooMany } from "../http.tsx";
import { clientIp } from "../middleware.tsx";
import { Landing, LoginPage, Message, RegisterPage, ResetPage } from "../views/pages.tsx";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/", (c) => c.html(<Landing user={c.get("user")} />));

authRoutes.get("/healthz", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.text("ok");
});

authRoutes.get("/register", (c) =>
  c.get("user") ? c.redirect("/listings", 303) : c.html(<RegisterPage email="" />),
);

authRoutes.post("/register", async (c) => {
  const db = c.env.DB;
  const limit = await hit(db, `register:ip:${clientIp(c)}`, REGISTER_IP_LIMIT, REGISTER_WINDOW_MS);
  if (!limit.allowed) return tooMany(c, limit.retryAfter);

  const body = await formBody(c);
  const form = parseForm(registerForm, body);
  if (!form.ok) {
    const typed = typeof body.email === "string" ? body.email : "";
    return c.html(<RegisterPage error={form.message} email={typed} />, 400);
  }

  const { email, password, role } = form.value;
  const id = crypto.randomUUID();
  const now = Date.now();
  const session = await newSession(db, id, now);
  // The session statement inserts nothing when the user insert was skipped as a duplicate.
  const [created] = await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (email) DO NOTHING`,
      )
      .bind(id, email, await hashPassword(password), role, now),
    session.statement,
  ]);
  if (created?.meta.changes !== 1) {
    return c.html(<RegisterPage error="That email is already registered." email={email} />, 409);
  }
  setSessionCookie(c, session.token);
  return c.redirect("/listings", 303);
});

authRoutes.get("/login", (c) =>
  c.get("user") ? c.redirect("/listings", 303) : c.html(<LoginPage />),
);

// Every failure after the form is read returns this page with status 401, so the response
// does not say whether the email exists, the password was wrong, or the account is deactivated.
const SIGN_IN_FAILED = "Wrong email or password.";

authRoutes.post("/login", async (c) => {
  const db = c.env.DB;
  const byIp = await hit(db, `login:ip:${clientIp(c)}`, LOGIN_IP_LIMIT, RATE_WINDOW_MS);
  if (!byIp.allowed) return tooMany(c, byIp.retryAfter);

  const form = parseForm(loginForm, await formBody(c));
  if (!form.ok) return c.html(<LoginPage error={SIGN_IN_FAILED} />, 401);
  const { email, password } = form.value;

  // The attempt is counted before the password is checked, so a correct guess after the limit
  // is still refused.
  const emailKey = `login:email:${email}`;
  const byEmail = await hit(db, emailKey, LOGIN_EMAIL_LIMIT, RATE_WINDOW_MS);
  if (!byEmail.allowed) return tooMany(c, byEmail.retryAfter);

  const user = await db
    .prepare("SELECT id, password_hash, active FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string; active: number }>();
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyAgainstDummy(password);
  if (!user || !valid || user.active !== 1)
    return c.html(<LoginPage error={SIGN_IN_FAILED} />, 401);

  const session = await newSession(db, user.id);
  await db.batch([clear(db, emailKey), session.statement]);
  setSessionCookie(c, session.token);
  return c.redirect("/listings", 303);
});

authRoutes.post("/logout", async (c) => {
  const token = sessionToken(c);
  if (token) await endSession(c.env.DB, token);
  clearSessionCookie(c);
  return c.redirect("/", 303);
});

authRoutes.get("/reset/:token", (c) => c.html(<ResetPage token={c.req.param("token")} />));

const RESET_INVALID = (
  <Message
    title="Link not valid"
    text="This reset link is invalid, expired or already used. Ask an admin for a new one."
    user={null}
  />
);

authRoutes.post("/reset/:token", async (c) => {
  const db = c.env.DB;
  const token = c.req.param("token");
  const limit = await hit(db, `reset:ip:${clientIp(c)}`, RESET_IP_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooMany(c, limit.retryAfter);

  const form = parseForm(resetForm, await formBody(c));
  if (!form.ok) return c.html(<ResetPage token={token} error={form.message} />, 400);

  const tokenDigest = await digest(token);
  const now = Date.now();
  const live = await db
    .prepare("SELECT 1 AS live FROM password_resets WHERE token_digest = ? AND expires_at > ?")
    .bind(tokenDigest, now)
    .first();
  if (!live) return c.html(RESET_INVALID, 400);

  // One batch is one transaction. Of two concurrent redemptions the second finds no row, so its
  // update changes nothing.
  const owner = "(SELECT user_id FROM password_resets WHERE token_digest = ?1 AND expires_at > ?2)";
  const [updated] = await db.batch([
    db
      .prepare(`UPDATE users SET password_hash = ?3 WHERE id = ${owner}`)
      .bind(tokenDigest, now, await hashPassword(form.value.password)),
    db.prepare(`DELETE FROM sessions WHERE user_id = ${owner}`).bind(tokenDigest, now),
    db.prepare("DELETE FROM password_resets WHERE token_digest = ?").bind(tokenDigest),
  ]);
  if (updated?.meta.changes !== 1) return c.html(RESET_INVALID, 400);
  return c.redirect("/login", 303);
});
