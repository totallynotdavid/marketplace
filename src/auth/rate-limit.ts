export type Verdict = { allowed: boolean; retryAfter: number };

// Counts the attempt before anything else runs, in one statement, so concurrent attempts
// cannot all read a count under the limit. A stale window restarts at 1.
export async function hit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<Verdict> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
       RETURNING count, window_start`,
    )
    .bind(key, now, windowMs)
    .first<{ count: number; window_start: number }>();
  if (!row) throw new Error("rate limit upsert returned no row");
  const retryAfter = Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000));
  return { allowed: row.count <= limit, retryAfter };
}

export function clear(db: D1Database, key: string): D1PreparedStatement {
  return db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key);
}
