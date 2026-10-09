import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

const N = 2 ** 14;
const R = 8;
const P = 5;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// Node's default 32 MiB cap is below the 128*N*R*P bytes these parameters need.
const MAX_MEMORY = 128 * N * R * P + 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

// The stored form is `scrypt$N$r$p$salt$hash`, so the parameters can change without a migration.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY };
  const key = await derive(password, Buffer.from(salt, "base64"), options);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummyHash: Promise<string> | undefined;

// A sign-in for an unknown email verifies against this so it costs the same as a known one.
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash.then((hash) => verifyPassword(password, hash));
}
