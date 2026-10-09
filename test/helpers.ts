import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index.ts";
import { digest } from "../src/auth/token.ts";

export const ORIGIN = "https://sentinel.test";
export const PASSWORD = "correct horse battery";

type CallOptions = {
  method?: string;
  form?: Record<string, string>;
  cookie?: string;
  ip?: string;
  origin?: string | null;
};

// Every request goes through the Worker's default export, as the runtime delivers it.
export async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const method = options.method ?? (options.form ? "POST" : "GET");
  const headers = new Headers();
  headers.set("CF-Connecting-IP", options.ip ?? "203.0.113.7");
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (method !== "GET" && options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
  let body: string | undefined;
  if (options.form) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(options.form).toString();
  }
  const ctx = createExecutionContext();
  return worker.fetch(
    new Request(ORIGIN + path, { method, headers, body, redirect: "manual" }),
    env,
    ctx,
  );
}

export function cookieOf(res: Response): string | null {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("__Host-sid="));
  if (!header) return null;
  const pair = header.split(";")[0]!;
  return pair === "__Host-sid=" ? null : pair;
}

let counter = 0;

export type Account = { email: string; id: string; cookie: string };

export async function register(role: "seller" | "funder", ip?: string): Promise<Account> {
  const email = `user${++counter}@example.com`;
  const res = await call("/register", { form: { email, password: PASSWORD, role }, ip });
  if (res.status !== 303) throw new Error(`register ${role} returned ${res.status}`);
  const cookie = cookieOf(res);
  if (!cookie) throw new Error("register set no session cookie");
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{
    id: string;
  }>();
  return { email, id: row!.id, cookie };
}

// The admin path in production is the create-admin script, so the test inserts the row the same way.
export async function makeAdmin(): Promise<Account> {
  const { hashPassword } = await import("../src/auth/password.ts");
  const email = `admin${++counter}@example.com`;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
  )
    .bind(id, email, await hashPassword(PASSWORD), Date.now())
    .run();
  const res = await call("/login", { form: { email, password: PASSWORD } });
  return { email, id, cookie: cookieOf(res)! };
}

export async function signIn(email: string, password = PASSWORD, ip?: string): Promise<Response> {
  return call("/login", { form: { email, password }, ip });
}

export async function createListing(
  seller: Account,
  fields: Partial<Record<string, string>> = {},
): Promise<string> {
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
  if (res.status !== 303) throw new Error(`create listing returned ${res.status}`);
  return res.headers.get("Location")!.split("/").pop()!;
}

export async function makeOffer(funder: Account, listingId: string, amount = "8500.00") {
  return call(`/listings/${listingId}/offers`, { cookie: funder.cookie, form: { amount } });
}

export async function offerId(listingId: string, funderId: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT id FROM offers WHERE listing_id = ? AND funder_id = ? AND status = 'pending'",
  )
    .bind(listingId, funderId)
    .first<{ id: string }>();
  return row!.id;
}

export async function sessionRow(cookie: string) {
  const token = cookie.split("=")[1]!;
  return env.DB.prepare("SELECT * FROM sessions WHERE token_digest = ?")
    .bind(await digest(token))
    .first<{ expires_at: number; last_seen_at: number; created_at: number }>();
}

export async function runScheduled() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: Date.now() }), env, ctx);
}
