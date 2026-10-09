export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

// The database stores only this digest, so a leaked row cannot be replayed as a cookie or link.
export async function digest(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(bytes).toString("hex");
}
