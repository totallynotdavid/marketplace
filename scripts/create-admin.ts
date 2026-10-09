// Creates the first admin in a deployed D1 database. It refuses when an admin already exists.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... bun run create-admin <database-id>
import { spawnSync } from "node:child_process";
import { adminInsert } from "../src/bootstrap.ts";

function changesIn(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = changesIn(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  if ("changes" in value && typeof value.changes === "number") return value.changes;
  for (const child of Object.values(value)) {
    const found = changesIn(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

const [databaseId] = process.argv.slice(2);
const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
if (!databaseId || !email || !password) {
  console.error("Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run create-admin <database-id>");
  process.exit(1);
}

const statement = await adminInsert(email, password).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
const { sql, params } = statement;
const run = spawnSync(
  "cf",
  ["d1", "query", databaseId, "--body", JSON.stringify({ sql, params })],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
if (run.status !== 0) process.exit(run.status ?? 1);

let changes: number | undefined;
try {
  changes = changesIn(JSON.parse(run.stdout));
} catch {
  // Keep the raw output when the CLI result has an unknown shape.
}
if (changes === undefined) {
  console.error(`cf d1 query printed a result this script cannot read:\n${run.stdout}`);
  process.exit(2);
}
if (changes === 0) {
  console.error("An admin already exists. Nothing was created.");
  process.exit(1);
}
console.log(`Created admin ${email}.`);
