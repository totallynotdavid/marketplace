import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env as WorkerEnv } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      MIGRATIONS: D1Migration[];
    }
  }
}
