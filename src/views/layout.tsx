import type { Child } from "hono/jsx";
import type { SessionUser } from "../env.ts";

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
body { margin: 0 auto; max-width: 56rem; padding: 0 1rem 4rem; }
header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; padding: 1rem 0; border-bottom: 1px solid #8884; }
header nav { display: flex; gap: 1rem; flex: 1; }
header form { margin: 0; }
a { color: inherit; }
h1 { font-size: 1.5rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8884; vertical-align: top; }
label { display: block; margin: .75rem 0 .25rem; }
input, select { font: inherit; padding: .4rem; width: 100%; max-width: 24rem; box-sizing: border-box; }
button { font: inherit; padding: .4rem .9rem; cursor: pointer; }
.error { color: #b00020; }
.muted { opacity: .7; }
.inline { display: inline; margin: 0; }
code { word-break: break-all; }
`;

export function Layout(props: { title: string; user: SessionUser | null; children?: Child }) {
  const { title, user, children } = props;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · Sentinel</title>
        <style>{STYLE}</style>
      </head>
      <body>
        <header>
          <strong>
            <a href="/">Sentinel</a>
          </strong>
          {user ? (
            <>
              <nav>
                <a href="/listings">Listings</a>
                {user.role === "seller" && <a href="/listings/new">New listing</a>}
                {user.role === "funder" && <a href="/offers">My offers</a>}
                {user.role === "admin" && <a href="/admin/users">Users</a>}
                {user.role === "admin" && <a href="/admin/audit">Audit</a>}
              </nav>
              <span class="muted">
                {user.email} ({user.role})
              </span>
              <form method="post" action="/logout">
                <button type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <nav>
              <a href="/login">Sign in</a>
              <a href="/register">Register</a>
            </nav>
          )}
        </header>
        <main>
          <h1>{title}</h1>
          {children}
        </main>
      </body>
    </html>
  );
}

export function PostButton(props: { action: string; label: string }) {
  return (
    <form method="post" action={props.action} class="inline">
      <button type="submit">{props.label}</button>
    </form>
  );
}

export function formatTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
