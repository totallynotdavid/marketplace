import type { Context } from "hono";
import type { AppEnv } from "./env.ts";
import { Message } from "./views/pages.tsx";

type Ctx = Context<AppEnv>;

// A body that is not a form reads as an empty one, so validation reports the missing fields.
export async function formBody(c: Ctx): Promise<Record<string, unknown>> {
  try {
    return await c.req.parseBody();
  } catch {
    return {};
  }
}

export function tooMany(c: Ctx, retryAfter: number) {
  c.header("Retry-After", String(retryAfter));
  return c.html(
    <Message
      title="Too many attempts"
      text="Wait a while before trying again."
      user={c.get("user")}
    />,
    429,
  );
}

export function notFound(c: Ctx) {
  return c.html(
    <Message title="Not found" text="There is nothing here." user={c.get("user")} />,
    404,
  );
}

export function serverError(c: Ctx) {
  return c.html(
    <Message
      title="Something went wrong"
      text="Try again in a moment."
      user={c.get("user") ?? null}
    />,
    500,
  );
}

export function conflict(c: Ctx, text: string) {
  return c.html(<Message title="Not possible" text={text} user={c.get("user")} />, 409);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
