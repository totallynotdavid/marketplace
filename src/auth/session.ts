import {
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_TOUCH_MS,
  type Role,
  type SessionUser,
} from "../env.ts";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { digest, newToken } from "./token.ts";

// Returns the cookie value and the statement that stores its session, so the caller can batch
// the statement with the write that authenticated the user.
export async function newSession(
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<{ token: string; statement: D1PreparedStatement }> {
  const token = newToken();
  const statement = db
    .prepare(
      `INSERT INTO sessions (token_digest, user_id, created_at, last_seen_at, expires_at)
       SELECT ?1, id, ?2, ?2, ?3 FROM users WHERE id = ?4`,
    )
    .bind(await digest(token), now, now + SESSION_MAX_AGE_MS, userId);
  return { token, statement };
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { prefix: "host", secure: true, path: "/" });
}

export function sessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE, "host");
}

type Row = {
  user_id: string;
  email: string;
  role: Role;
  active: number;
  last_seen_at: number;
  expires_at: number;
};

// Expiry and the user's active flag are checked on every read.
export async function readSession(
  db: D1Database,
  token: string,
  now = Date.now(),
): Promise<SessionUser | null> {
  const tokenDigest = await digest(token);
  const row = await db
    .prepare(
      `SELECT s.user_id, s.last_seen_at, s.expires_at, u.email, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_digest = ?`,
    )
    .bind(tokenDigest)
    .first<Row>();
  if (!row) return null;

  const expired = now >= row.expires_at || now - row.last_seen_at >= SESSION_IDLE_MS;
  if (expired || row.active !== 1) {
    await db.prepare("DELETE FROM sessions WHERE token_digest = ?").bind(tokenDigest).run();
    return null;
  }
  if (now - row.last_seen_at >= SESSION_TOUCH_MS) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_digest = ?")
      .bind(now, tokenDigest)
      .run();
  }
  return { id: row.user_id, email: row.email, role: row.role };
}

export async function endSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE token_digest = ?")
    .bind(await digest(token))
    .run();
}
