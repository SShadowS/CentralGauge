#!/usr/bin/env tsx
/**
 * Tail wrangler logs during a smoke run, alert if any KV.put is observed
 * against the CACHE namespace. Used in the canary-review runbook
 * (docs/site/operations.md) to verify no production code path silently
 * regressed to KV writes.
 *
 * Usage:
 *   wrangler tail --format=json --search="kv.put" | tsx scripts/check-kv-writes.ts
 *
 * Exits non-zero on first observed put. Intended for ops runbook, not
 * CI gating (vitest test above covers CI gating).
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

let observed = 0;

rl.on("line", (line) => {
  try {
    const ev = JSON.parse(line);
    if (typeof ev?.message === "string" && /kv\.put/i.test(ev.message)) {
      console.error("[kv-writes] OBSERVED PUT:", line);
      observed += 1;
    }
  } catch {
    // not JSON — ignore
  }
});

rl.on("close", () => {
  if (observed > 0) {
    console.error(`Total observed KV puts: ${observed}`);
    process.exit(1);
  }
  console.log("No KV puts observed.");
});
