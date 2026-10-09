import * as v from "valibot";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from "./auth/password.ts";
import { emailField } from "./forms.ts";

// The only way an admin comes to exist. The statement inserts nothing when an admin is already
// there, and fails on an email that belongs to another user, so a seller is never promoted.
export async function adminInsert(
  email: string,
  password: string,
): Promise<{ sql: string; params: (string | number)[] }> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`The password must have at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  return {
    sql: `INSERT INTO users (id, email, password_hash, role, created_at)
          SELECT ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
    params: [
      crypto.randomUUID(),
      v.parse(emailField, email),
      await hashPassword(password),
      Date.now(),
    ],
  };
}
