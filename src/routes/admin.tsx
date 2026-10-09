import { Hono } from "hono";
import { RESET_TTL_MS, type AppEnv } from "../env.ts";
import { digest, newToken } from "../auth/token.ts";
import { conflict, notFound } from "../http.tsx";
import { allow } from "../middleware.tsx";
import {
  AuditPage,
  ResetLinkPage,
  UsersPage,
  type AuditRow,
  type UserRow,
} from "../views/admin.tsx";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("/admin/*", allow("admin"));

adminRoutes.get("/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, role, active, created_at FROM users ORDER BY created_at DESC LIMIT 500",
  ).all<UserRow>();
  return c.html(<UsersPage user={c.get("user")!} users={results} />);
});

adminRoutes.get("/admin/audit", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, u.email AS admin_email, a.action, a.target, a.created_at
     FROM audit_log a JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 200`,
  ).all<AuditRow>();
  return c.html(<AuditPage user={c.get("user")!} rows={results} />);
});

// Each action writes its audit row in the same batch as the change it records.
function audit(db: D1Database, adminId: string, action: string, target: string, now: number) {
  return db
    .prepare("INSERT INTO audit_log (admin_id, action, target, created_at) VALUES (?, ?, ?, ?)")
    .bind(adminId, action, target, now);
}

adminRoutes.post("/admin/users/:id/deactivate", async (c) => {
  const db = c.env.DB;
  const admin = c.get("user")!;
  const id = c.req.param("id");
  const target = await db
    .prepare("SELECT role FROM users WHERE id = ?")
    .bind(id)
    .first<{ role: string }>();
  if (!target) return notFound(c);
  if (target.role === "admin") return conflict(c, "An admin cannot be deactivated.");

  // Pending offers must not outlive the user's listing or bid: the accept path relies on every
  // pending offer sitting on an open listing. The offers on the seller's listings are rejected
  // before the listings are cancelled, because the subquery selects the still-open ones.
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(id),
    db
      .prepare(
        "UPDATE offers SET status = 'withdrawn', updated_at = ? WHERE funder_id = ? AND status = 'pending'",
      )
      .bind(now, id),
    db
      .prepare(
        `UPDATE offers SET status = 'rejected', updated_at = ?1
         WHERE status = 'pending'
           AND listing_id IN (SELECT id FROM listings WHERE seller_id = ?2 AND status = 'open')`,
      )
      .bind(now, id),
    db
      .prepare(
        "UPDATE listings SET status = 'cancelled', updated_at = ? WHERE seller_id = ? AND status = 'open'",
      )
      .bind(now, id),
    audit(db, admin.id, "deactivate", id, now),
  ]);
  return c.redirect("/admin/users", 303);
});

adminRoutes.post("/admin/users/:id/reactivate", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  if (!(await db.prepare("SELECT 1 AS found FROM users WHERE id = ?").bind(id).first()))
    return notFound(c);
  await db.batch([
    db.prepare("UPDATE users SET active = 1 WHERE id = ?").bind(id),
    audit(db, c.get("user")!.id, "reactivate", id, Date.now()),
  ]);
  return c.redirect("/admin/users", 303);
});

// The link is shown once, in this response. Only its digest is stored, and a new link replaces
// the previous one.
adminRoutes.post("/admin/users/:id/reset", async (c) => {
  const db = c.env.DB;
  const admin = c.get("user")!;
  const id = c.req.param("id");
  const target = await db
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(id)
    .first<{ email: string }>();
  if (!target) return notFound(c);

  const token = newToken();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO password_resets (user_id, token_digest, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET
           token_digest = excluded.token_digest, expires_at = excluded.expires_at`,
      )
      .bind(id, await digest(token), now + RESET_TTL_MS),
    audit(db, admin.id, "reset", id, now),
  ]);
  const url = `${new URL(c.req.url).origin}/reset/${token}`;
  return c.html(<ResetLinkPage user={admin} email={target.email} url={url} />);
});
