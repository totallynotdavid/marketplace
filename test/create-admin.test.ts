import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adminInsert } from "../src/bootstrap.ts";
import { PASSWORD, call, cookieOf, register, signIn } from "./helpers.ts";

async function run(email: string, password: string) {
  const { sql, params } = await adminInsert(email, password);
  return env.DB.prepare(sql)
    .bind(...params)
    .run();
}

describe("create-admin statement", () => {
  it("creates an admin who can sign in and open the admin pages", async () => {
    const result = await run("Boss@Example.com", PASSWORD);
    expect(result.meta.changes).toBe(1);
    const res = await signIn("boss@example.com");
    expect(res.status).toBe(303);
    expect((await call("/admin/users", { cookie: cookieOf(res)! })).status).toBe(200);
  });

  it("refuses to create a second admin", async () => {
    await run("boss@example.com", PASSWORD);
    const second = await run("other@example.com", PASSWORD);
    expect(second.meta.changes).toBe(0);
    const admins = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'",
    ).first<{
      n: number;
    }>();
    expect(admins!.n).toBe(1);
  });

  it("fails on an email a seller already holds, and leaves that user a seller", async () => {
    const seller = await register("seller");
    await expect(run(seller.email, PASSWORD)).rejects.toThrow();
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(seller.id).first<{
      role: string;
    }>();
    expect(row!.role).toBe("seller");
  });

  it("rejects a password under the minimum length", async () => {
    await expect(adminInsert("boss@example.com", "short")).rejects.toThrow(/at least 10/);
  });
});
