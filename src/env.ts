export type Role = "seller" | "funder" | "admin";

export type Env = {
  DB: D1Database;
};

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null };
};

export const SESSION_COOKIE = "sid";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 1000;

export const RESET_TTL_MS = 60 * 60 * 1000;

export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_EMAIL_LIMIT = 5;
export const LOGIN_IP_LIMIT = 20;
export const RESET_IP_LIMIT = 20;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_IP_LIMIT = 10;
