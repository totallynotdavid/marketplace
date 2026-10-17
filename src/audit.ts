// Place this statement directly after the one it records: `changes()` reads that statement.
export function audit(
  db: D1Database,
  adminId: string,
  action: string,
  target: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (admin_id, action, target, created_at)
       SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0`,
    )
    .bind(adminId, action, target, now);
}
