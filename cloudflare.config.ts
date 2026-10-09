import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "sentinel",
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    env: {
      DB: bindings.d1({ name: "sentinel" }),
    },
    triggers: [triggers.scheduled({ schedule: "17 3 * * *" })],
  },
});
