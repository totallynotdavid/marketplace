import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.ts";
import { digest } from "../src/auth/token.ts";
import {
  PASSWORD,
  call,
  cookieOf,
  makeAdmin,
  register,
  runScheduled,
  sessionRow,
  signIn,
} from "./helpers.ts";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

async function issueLink(adminCookie: string, userId: string): Promise<string> {
  const res = await call(`/admin/users/${userId}/reset`, { form: {}, cookie: adminCookie });
  expect(res.status).toBe(200);
  const match = (await res.text()).match(/\/reset\/([A-Za-z0-9_-]{20,})/);
  expect(match).not.toBeNull();
  return match![1]!;
}

const byText = (a: string, b: string) => a.localeCompare(b);
const byNumber = (a: number, b: number) => a - b;

describe("registration", () => {
  it("creates a seller and signs them in", async () => {
    const res = await call("/register", {
      form: { email: "Ana@Example.com ", password: PASSWORD, role: "seller" },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/listings");
    expect(cookieOf(res)).not.toBeNull();
    const user = await env.DB.prepare("SELECT email, role, active FROM users").first();
    expect(user).toEqual({ email: "ana@example.com", role: "seller", active: 1 });
  });

  it.each(["admin", "root", ""])("refuses the role %j", async (role) => {
    const res = await call("/register", {
      form: { email: "x@example.com", password: PASSWORD, role },
    });
    expect(res.status).toBe(400);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())!.n,
    ).toBe(0);
  });

  it("answers 409 for a duplicate email, whatever its case", async () => {
    await register("seller");
    const first = await env.DB.prepare("SELECT email FROM users").first<{ email: string }>();
    const res = await call("/register", {
      form: { email: first!.email.toUpperCase(), password: PASSWORD, role: "funder" },
    });
    expect(res.status).toBe(409);
  });

  it.each(["short", "x".repeat(129)])("refuses a password of length %#", async (password) => {
    const res = await call("/register", {
      form: { email: "a@example.com", password, role: "funder" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a malformed email", async () => {
    const res = await call("/register", {
      form: { email: "not-an-email", password: PASSWORD, role: "funder" },
    });
    expect(res.status).toBe(400);
  });

  it("stores a scrypt hash, never the password", async () => {
    await register("seller");
    const row = await env.DB.prepare("SELECT password_hash FROM users").first<{
      password_hash: string;
    }>();
    expect(row!.password_hash).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(row!.password_hash).not.toContain(PASSWORD);
  });

  it("limits registrations per client IP", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await call("/register", {
        form: { email: `bulk${i}@example.com`, password: PASSWORD, role: "funder" },
        ip: "198.51.100.9",
      });
      expect(res.status).toBe(303);
    }
    const blocked = await call("/register", {
      form: { email: "bulk-extra@example.com", password: PASSWORD, role: "funder" },
      ip: "198.51.100.9",
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    const other = await call("/register", {
      form: { email: "elsewhere@example.com", password: PASSWORD, role: "funder" },
      ip: "198.51.100.10",
    });
    expect(other.status).toBe(303);
  }, 60_000);
});

describe("login", () => {
  it("signs in with the right password and lands on the listings", async () => {
    const account = await register("funder");
    const res = await signIn(account.email);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/listings");
    const page = await call("/listings", { cookie: cookieOf(res)! });
    expect(page.status).toBe(200);
  });

  it("treats a wrong password and an unknown email the same", async () => {
    const account = await register("funder");
    const wrong = await signIn(account.email, "not the password");
    const unknown = await signIn("nobody@example.com");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
    expect(cookieOf(wrong)).toBeNull();
    expect(cookieOf(unknown)).toBeNull();
  });

  it("treats a deactivated user like a wrong password", async () => {
    const account = await register("funder");
    await env.DB.prepare("UPDATE users SET active = 0").run();
    const res = await signIn(account.email);
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toBeNull();
  });

  it("matches the email without regard to case", async () => {
    const account = await register("seller");
    const res = await signIn(account.email.toUpperCase());
    expect(res.status).toBe(303);
  });
});

describe("session", () => {
  it("sets a host-prefixed HttpOnly Secure SameSite=Lax cookie", async () => {
    const account = await register("seller");
    const res = await signIn(account.email);
    const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-sid="))!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Domain");
    expect(header).toMatch(/Max-Age=604800/);
  });

  it("stores only the digest of the token", async () => {
    const account = await register("seller");
    const token = account.cookie.split("=")[1]!;
    const rows = await env.DB.prepare("SELECT token_digest FROM sessions").all<{
      token_digest: string;
    }>();
    expect(rows.results).toEqual([{ token_digest: await digest(token) }]);
    expect(rows.results[0]!.token_digest).not.toBe(token);
  });

  it("answers 401 for a cookie that names no session", async () => {
    const res = await call("/listings", { cookie: "__Host-sid=forged" });
    expect(res.status).toBe(401);
  });

  it("ends a session past its absolute expiry and deletes the row", async () => {
    const account = await register("seller");
    await env.DB.prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const res = await call("/listings", { cookie: account.cookie });
    expect(res.status).toBe(401);
    expect(await sessionRow(account.cookie)).toBeNull();
  });

  it("ends a session idle for more than 24 hours", async () => {
    const account = await register("seller");
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?")
      .bind(Date.now() - 25 * HOUR)
      .run();
    const res = await call("/listings", { cookie: account.cookie });
    expect(res.status).toBe(401);
    expect(await sessionRow(account.cookie)).toBeNull();
  });

  it("keeps a session idle for less than 24 hours and records the visit", async () => {
    const account = await register("seller");
    const stale = Date.now() - 23 * HOUR;
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?").bind(stale).run();
    const res = await call("/listings", { cookie: account.cookie });
    expect(res.status).toBe(200);
    expect((await sessionRow(account.cookie))!.last_seen_at).toBeGreaterThan(stale + HOUR);
  });

  it("gives each sign-in its own session and sign-out removes only that one", async () => {
    const account = await register("seller");
    const second = cookieOf(await signIn(account.email))!;
    expect(second).not.toBe(account.cookie);
    const out = await call("/logout", { form: {}, cookie: second });
    expect(out.status).toBe(303);
    expect((await call("/listings", { cookie: second })).status).toBe(401);
    expect((await call("/listings", { cookie: account.cookie })).status).toBe(200);
  });

  it("ends the session of a user an admin deactivated", async () => {
    const admin = await makeAdmin();
    const victim = await register("funder");
    expect((await call("/offers", { cookie: victim.cookie })).status).toBe(200);
    const res = await call(`/admin/users/${victim.id}/deactivate`, {
      form: {},
      cookie: admin.cookie,
    });
    expect(res.status).toBe(303);
    expect((await call("/offers", { cookie: victim.cookie })).status).toBe(401);
    expect(await sessionRow(victim.cookie)).toBeNull();
  });

  it("ends the session of a user deactivated directly in the database", async () => {
    const victim = await register("funder");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(victim.id).run();
    expect((await call("/offers", { cookie: victim.cookie })).status).toBe(401);
    expect(await sessionRow(victim.cookie)).toBeNull();
  });

  it("marks session-dependent responses private and uncacheable", async () => {
    const account = await register("seller");
    const res = await call("/listings", { cookie: account.cookie });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("removes expired sessions, resets and rate rows in the scheduled sweep", async () => {
    const account = await register("seller");
    const admin = await makeAdmin();
    await call(`/admin/users/${account.id}/reset`, { form: {}, cookie: admin.cookie });
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").bind(
        Date.now() - 1,
        account.id,
      ),
      env.DB.prepare("UPDATE password_resets SET expires_at = ?").bind(Date.now() - 1),
      env.DB.prepare("UPDATE rate_limits SET window_start = ?").bind(Date.now() - 2 * HOUR),
    ]);
    await runScheduled();
    expect(await sessionRow(account.cookie)).toBeNull();
    expect(await count("sessions")).toBe(1);
    expect(await count("password_resets")).toBe(0);
    expect(await count("rate_limits")).toBe(0);
  });
});

describe("roles", () => {
  const PUBLIC = new Set([
    "GET /",
    "GET /healthz",
    "GET /login",
    "POST /login",
    "GET /register",
    "POST /register",
    "POST /logout",
    "GET /reset/:token",
    "POST /reset/:token",
  ]);

  it("answers 401 on every route outside the public list when signed out", async () => {
    const routes = app.routes.filter((r) => r.method !== "ALL");
    const publicSeen = new Set<string>();
    expect(routes.length).toBeGreaterThan(PUBLIC.size);
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (PUBLIC.has(key)) {
        publicSeen.add(key);
        continue;
      }
      const res = await call(route.path.replace(/:\w+/g, "x"), {
        method: route.method,
        form: route.method === "GET" ? undefined : {},
      });
      expect(res.status, key).toBe(401);
    }
    expect([...publicSeen].toSorted(byText)).toEqual([...PUBLIC].toSorted(byText));
  });

  const matrix: [string, string, string[]][] = [
    ["GET", "/listings/new", ["seller"]],
    ["POST", "/listings", ["seller"]],
    ["POST", "/listings/x/offers", ["funder"]],
    ["GET", "/offers", ["funder"]],
    ["POST", "/offers/x/withdraw", ["funder"]],
    ["POST", "/offers/x/accept", ["seller"]],
    ["POST", "/offers/x/reject", ["seller"]],
    ["POST", "/listings/x/cancel", ["seller", "admin"]],
    ["GET", "/admin/users", ["admin"]],
    ["GET", "/admin/audit", ["admin"]],
    ["POST", "/admin/users/x/deactivate", ["admin"]],
    ["POST", "/admin/users/x/reactivate", ["admin"]],
    ["POST", "/admin/users/x/reset", ["admin"]],
  ];

  it.each(matrix)("%s %s admits only %j", async (method, path, allowed) => {
    const accounts = {
      seller: await register("seller"),
      funder: await register("funder"),
      admin: await makeAdmin(),
    };
    for (const [role, account] of Object.entries(accounts)) {
      if (allowed.includes(role)) continue;
      const res = await call(path, {
        method,
        form: method === "GET" ? undefined : {},
        cookie: account.cookie,
      });
      expect(res.status, `${role} on ${method} ${path}`).toBe(403);
    }
  });

  it("cannot make anyone an admin through registration, login or any form field", async () => {
    const res = await call("/register", {
      form: {
        email: "sneaky@example.com",
        password: PASSWORD,
        role: "funder",
        admin: "1",
        active: "1",
      },
    });
    expect(res.status).toBe(303);
    const row = await env.DB.prepare("SELECT role FROM users").first<{ role: string }>();
    expect(row!.role).toBe("funder");
  });
});

describe("request origin", () => {
  it.each([
    ["a foreign origin", "https://evil.test"],
    ["no origin", null],
  ])("refuses a state-changing request with %s", async (_name, origin) => {
    const account = await register("seller");
    const res = await call("/logout", { form: {}, cookie: account.cookie, origin });
    expect(res.status).toBe(403);
    expect(await sessionRow(account.cookie)).not.toBeNull();
  });

  it("refuses a sign-in posted from another site", async () => {
    const account = await register("seller");
    const res = await call("/login", {
      form: { email: account.email, password: PASSWORD },
      origin: "https://evil.test",
    });
    expect(res.status).toBe(403);
  });
});

describe("sign-in rate limit", () => {
  it("answers 429 with Retry-After on the sixth attempt for one email", async () => {
    const account = await register("seller");
    for (let i = 0; i < 5; i++) {
      expect((await signIn(account.email, "wrong password")).status).toBe(401);
    }
    const blocked = await signIn(account.email, "wrong password");
    expect(blocked.status).toBe(429);
    const wait = Number(blocked.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(15 * 60);
  });

  it("does not let the correct password through once the limit is hit", async () => {
    const account = await register("seller");
    for (let i = 0; i < 5; i++) await signIn(account.email, "wrong password");
    const res = await signIn(account.email);
    expect(res.status).toBe(429);
    expect(cookieOf(res)).toBeNull();
  });

  it("limits an unknown email the same way", async () => {
    for (let i = 0; i < 5; i++) expect((await signIn("ghost@example.com")).status).toBe(401);
    expect((await signIn("ghost@example.com")).status).toBe(429);
  });

  it("counts concurrent attempts exactly", async () => {
    const account = await register("seller");
    const results = await Promise.all(
      Array.from({ length: 9 }, () => signIn(account.email, "wrong password")),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  });

  it("clears the email counter on a successful sign-in", async () => {
    const account = await register("seller");
    for (let i = 0; i < 4; i++) await signIn(account.email, "wrong password");
    expect((await signIn(account.email)).status).toBe(303);
    for (let i = 0; i < 5; i++) {
      expect((await signIn(account.email, "wrong password")).status).toBe(401);
    }
    expect((await signIn(account.email, "wrong password")).status).toBe(429);
  });

  it("opens the window again after 15 minutes", async () => {
    const account = await register("seller");
    for (let i = 0; i < 6; i++) await signIn(account.email, "wrong password");
    expect((await signIn(account.email)).status).toBe(429);
    await env.DB.prepare("UPDATE rate_limits SET window_start = window_start - ?")
      .bind(16 * MINUTE)
      .run();
    expect((await signIn(account.email)).status).toBe(303);
  });

  it("limits one client IP across many emails, and not other IPs", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await signIn(`ghost${i}@example.com`, PASSWORD, "192.0.2.50")).status).toBe(401);
    }
    expect((await signIn("ghost-last@example.com", PASSWORD, "192.0.2.50")).status).toBe(429);
    expect((await signIn("ghost-last@example.com", PASSWORD, "192.0.2.51")).status).toBe(401);
  }, 60_000);

  it("keeps one user's failures from locking out another", async () => {
    const victim = await register("seller", "198.51.100.1");
    const other = await register("seller", "198.51.100.2");
    for (let i = 0; i < 6; i++) await signIn(victim.email, "wrong password", "198.51.100.1");
    expect((await signIn(other.email, PASSWORD, "198.51.100.2")).status).toBe(303);
  });
});

describe("password reset", () => {
  it("lets the user set a new password once, and ends all their sessions", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const second = cookieOf(await signIn(user.email))!;
    const token = await issueLink(admin.cookie, user.id);

    const res = await call(`/reset/${token}`, { form: { password: "a brand new password" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/login");

    expect((await call("/listings", { cookie: user.cookie })).status).toBe(401);
    expect((await call("/listings", { cookie: second })).status).toBe(401);
    expect((await signIn(user.email, PASSWORD)).status).toBe(401);
    expect((await signIn(user.email, "a brand new password")).status).toBe(303);

    const again = await call(`/reset/${token}`, { form: { password: "yet another password" } });
    expect(again.status).toBe(400);
    expect((await signIn(user.email, "yet another password")).status).toBe(401);
  });

  it("stores only the digest of the link token", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const token = await issueLink(admin.cookie, user.id);
    const row = await env.DB.prepare("SELECT token_digest, expires_at FROM password_resets").first<{
      token_digest: string;
      expires_at: number;
    }>();
    expect(row!.token_digest).toBe(await digest(token));
    expect(row!.expires_at - Date.now()).toBeLessThanOrEqual(HOUR);
  });

  it("refuses an expired link and keeps the old password", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const token = await issueLink(admin.cookie, user.id);
    await env.DB.prepare("UPDATE password_resets SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const res = await call(`/reset/${token}`, { form: { password: "a brand new password" } });
    expect(res.status).toBe(400);
    expect((await signIn(user.email)).status).toBe(303);
  });

  it("replaces the previous link when a new one is issued", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const first = await issueLink(admin.cookie, user.id);
    const second = await issueLink(admin.cookie, user.id);
    expect(
      (await call(`/reset/${first}`, { form: { password: "a brand new password" } })).status,
    ).toBe(400);
    expect(
      (await call(`/reset/${second}`, { form: { password: "a brand new password" } })).status,
    ).toBe(303);
  });

  it("accepts only one of two concurrent redemptions", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const token = await issueLink(admin.cookie, user.id);
    const results = await Promise.all(
      ["first password here", "second password here"].map((password) =>
        call(`/reset/${token}`, { form: { password } }),
      ),
    );
    expect(results.map((r) => r.status).toSorted(byNumber)).toEqual([303, 400]);
  });

  it("enforces the password length on redemption", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const token = await issueLink(admin.cookie, user.id);
    expect((await call(`/reset/${token}`, { form: { password: "short" } })).status).toBe(400);
    expect(
      (await call(`/reset/${token}`, { form: { password: "a brand new password" } })).status,
    ).toBe(303);
  });

  it("limits redemption attempts per client IP", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await call("/reset/guess", {
        form: { password: "a brand new password" },
        ip: "192.0.2.80",
      });
      expect(res.status).toBe(400);
    }
    const blocked = await call("/reset/guess", {
      form: { password: "a brand new password" },
      ip: "192.0.2.80",
    });
    expect(blocked.status).toBe(429);
  });

  it("never exposes the token or its digest in the account pages", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    const token = await issueLink(admin.cookie, user.id);
    const users = await (await call("/admin/users", { cookie: admin.cookie })).text();
    expect(users).not.toContain(token);
    expect(users).not.toContain(await digest(token));
  });

  it("records the issue in the audit log", async () => {
    const admin = await makeAdmin();
    const user = await register("seller");
    await issueLink(admin.cookie, user.id);
    const row = await env.DB.prepare("SELECT admin_id, action, target FROM audit_log").first();
    expect(row).toEqual({ admin_id: admin.id, action: "reset", target: user.id });
  });
});

describe("admin actions", () => {
  it("deactivates and reactivates a user and audits both", async () => {
    const admin = await makeAdmin();
    const user = await register("funder");
    await call(`/admin/users/${user.id}/deactivate`, { form: {}, cookie: admin.cookie });
    expect((await signIn(user.email)).status).toBe(401);
    await call(`/admin/users/${user.id}/reactivate`, { form: {}, cookie: admin.cookie });
    expect((await signIn(user.email)).status).toBe(303);
    const log = await env.DB.prepare("SELECT action FROM audit_log ORDER BY id").all<{
      action: string;
    }>();
    expect(log.results.map((r) => r.action)).toEqual(["deactivate", "reactivate"]);
  });

  it("writes no audit row when deactivation or reactivation changes nothing", async () => {
    const admin = await makeAdmin();
    const user = await register("funder");
    const deactivations = await Promise.all(
      [1, 2].map(() =>
        call(`/admin/users/${user.id}/deactivate`, { form: {}, cookie: admin.cookie }),
      ),
    );
    expect(deactivations.map((res) => res.status).toSorted(byNumber)).toEqual([303, 303]);

    const reactivations = await Promise.all(
      [1, 2].map(() =>
        call(`/admin/users/${user.id}/reactivate`, { form: {}, cookie: admin.cookie }),
      ),
    );
    expect(reactivations.map((res) => res.status).toSorted(byNumber)).toEqual([303, 303]);

    const log = await env.DB.prepare("SELECT action FROM audit_log ORDER BY id").all<{
      action: string;
    }>();
    expect(log.results.map((r) => r.action)).toEqual(["deactivate", "reactivate"]);
  });

  it("will not deactivate an admin, itself included", async () => {
    const admin = await makeAdmin();
    const other = await makeAdmin();
    for (const id of [admin.id, other.id]) {
      const res = await call(`/admin/users/${id}/deactivate`, { form: {}, cookie: admin.cookie });
      expect(res.status).toBe(409);
    }
    expect((await call("/admin/users", { cookie: admin.cookie })).status).toBe(200);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n,
    ).toBe(0);
  });

  it("answers 404 for a user that does not exist, and writes no audit row", async () => {
    const admin = await makeAdmin();
    const res = await call("/admin/users/missing/deactivate", { form: {}, cookie: admin.cookie });
    expect(res.status).toBe(404);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first<{ n: number }>())!.n,
    ).toBe(0);
  });
});
