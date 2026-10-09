import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.MIGRATIONS);

const TABLES = [
  "audit_log",
  "offers",
  "listings",
  "rate_limits",
  "password_resets",
  "sessions",
  "users",
];

beforeEach(async () => {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});
