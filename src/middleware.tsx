import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Role } from "./env.ts";
import { readSession, sessionToken } from "./auth/session.ts";
import { Message, SignInRequired } from "./views/pages.tsx";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

// SameSite=Lax still sends the cookie on a cross-site top-level form post, so every
// state-changing request must come from this origin.
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    if (c.req.header("Origin") !== new URL(c.req.url).origin) {
      return c.html(
        <Message title="Request refused" text="Cross-site request." user={null} />,
        403,
      );
    }
  }
  return next();
});

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
});

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = sessionToken(c);
  c.set("user", token ? await readSession(c.env.DB, token) : null);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.html(<SignInRequired />, 401);
  return next();
});

export function allow(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return c.html(<SignInRequired />, 401);
    if (!roles.includes(user.role)) {
      return c.html(
        <Message title="Not allowed" text="Your role cannot do this." user={user} />,
        403,
      );
    }
    return next();
  });
}

// Cloudflare sets this header at the edge and drops any value a client sends.
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}
