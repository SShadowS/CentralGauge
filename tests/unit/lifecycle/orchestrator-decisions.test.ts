import { assertEquals } from "@std/assert";
import { decideStep } from "../../../src/lifecycle/orchestrator.ts";

// The canonical envelope is an object; decideStep takes Record<string, unknown>.
const env = {
  deno: "1.46.3",
  wrangler: "3.114.0",
  claude_code: "0.4.0",
  bc_compiler: "27.0",
  git_sha: "abc",
  settings_hash: "h",
};

Deno.test("decideStep run when no prior events", () => {
  const d = decideStep("bench", {}, false, env, 1000);
  assertEquals(d.kind, "run");
  assertEquals(d.reason, "no_prior_events");
});

Deno.test("decideStep skip when prior completed + envelope match", () => {
  const d = decideStep(
    "bench",
    {
      completed: { id: 1, ts: 100, payload: {}, envelope: env },
    },
    false,
    env,
    1000,
  );
  assertEquals(d.kind, "skip");
  assertEquals(d.reason, "envelope_unchanged");
});

Deno.test("decideStep run when prior completed + envelope mismatch", () => {
  const oldEnv = {
    deno: "1.44",
    wrangler: "3.0",
    claude_code: "0.4",
    bc_compiler: "27.0",
    git_sha: "old",
    settings_hash: "h",
  };
  const d = decideStep(
    "bench",
    {
      completed: { id: 1, ts: 100, payload: {}, envelope: oldEnv },
    },
    false,
    env,
    1000,
  );
  assertEquals(d.kind, "run");
  assertEquals(d.reason, "envelope_changed_since_last_completed");
});

Deno.test("decideStep retry when prior failed", () => {
  const d = decideStep(
    "bench",
    {
      failed: { id: 1, ts: 100, payload: {} },
    },
    false,
    env,
    1000,
  );
  assertEquals(d.kind, "retry");
  assertEquals(d.reason, "prior_failure");
});

Deno.test("decideStep skip-within-ttl when prior started recently", () => {
  // Step TTL is 60 min — 30 min ago is within window.
  const d = decideStep(
    "bench",
    {
      started: { id: 1, ts: 1_000_000 - 30 * 60 * 1000 },
    },
    false,
    env,
    1_000_000,
  );
  assertEquals(d.kind, "skip");
  assertEquals(d.reason, "started_within_ttl");
});

Deno.test("decideStep retry-after-ttl when started long ago", () => {
  // 90 min ago > 60 min TTL.
  const d = decideStep(
    "bench",
    {
      started: { id: 1, ts: 1_000_000 - 90 * 60 * 1000 },
    },
    false,
    env,
    1_000_000,
  );
  assertEquals(d.kind, "retry");
  assertEquals(d.reason, "started_event_ttl_expired");
});

Deno.test("decideStep retry when prior.failed is NEWER than prior.completed (I2)", () => {
  // Scenario: bench.completed (id=5) succeeded, then a later attempt
  // emitted bench.failed (id=10). The most-recent action was a failure;
  // the operator expects 'retry'. Pre-fix the decision was 'skip'
  // (envelope_unchanged) because completed was checked first and
  // ordering was ignored.
  const d = decideStep(
    "bench",
    {
      completed: { id: 5, ts: 100, payload: {}, envelope: env },
      failed: { id: 10, ts: 200, payload: {} },
    },
    false,
    env,
    1000,
  );
  assertEquals(d.kind, "retry");
  assertEquals(d.reason, "prior_failure");
});

Deno.test("decideStep skip when prior.completed is NEWER than prior.failed", () => {
  // Inverse of the above: failed (id=5) then completed (id=10) → the
  // most-recent action was the success → skip-on-envelope-unchanged
  // applies.
  const d = decideStep(
    "bench",
    {
      completed: { id: 10, ts: 200, payload: {}, envelope: env },
      failed: { id: 5, ts: 100, payload: {} },
    },
    false,
    env,
    1000,
  );
  assertEquals(d.kind, "skip");
  assertEquals(d.reason, "envelope_unchanged");
});

Deno.test("decideStep run on force_rerun regardless of completed", () => {
  const d = decideStep(
    "bench",
    {
      completed: { id: 1, ts: 100, payload: {}, envelope: env },
    },
    true,
    env,
    1000,
  );
  assertEquals(d.kind, "run");
  assertEquals(d.reason, "force_rerun_flag");
});
