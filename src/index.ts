import { app } from "./app.ts";
import { REGISTER_WINDOW_MS, SESSION_IDLE_MS, type Env } from "./env.ts";

// Expiry is enforced when a row is read. The sweep removes rows nobody reads again.
async function sweep(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at <= ?1 - ?2")
      .bind(now, SESSION_IDLE_MS),
    db.prepare("DELETE FROM password_resets WHERE expires_at <= ?").bind(now),
    // The longest rate-limit window is the registration one.
    db.prepare("DELETE FROM rate_limits WHERE window_start <= ? - ?").bind(now, REGISTER_WINDOW_MS),
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await sweep(env.DB);
  },
} satisfies ExportedHandler<Env>;
