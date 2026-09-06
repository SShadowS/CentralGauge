/**
 * T3 + T5 — persisted run identity for idempotent replay.
 *
 * `buildIngestMeta` mints ONE run UUID per variant at save time; the meta
 * is written into the results file as a top-level `ingest` key and read
 * back by BOTH immediate ingest (bench-command) and replay (ingest-command)
 * so a transient-failure replay reuses the same run_id (server idempotency
 * answers "exists" instead of double-counting the run).
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  buildIngestMeta,
  parseIngestMeta,
  todayPricingVersion,
  validateAttemptsForIngest,
} from "../../../cli/commands/bench/ingest-meta.ts";
import type { EnvironmentManifest } from "../../../src/ingest/capture.ts";

function fakeEnvironment(): EnvironmentManifest {
  return {
    bc_artifact: "https://bcartifacts/onprem/28.4/w1",
    container_image_digest: "sha256:abc",
    bcch_version: "6.1.14",
    test_runner: "soap",
    host_os: "windows-x86_64",
    centralgauge_sha: "deadbeef",
    dirty_tree: false,
    harness_fingerprint: "a".repeat(64),
    retry_path_version: "rp2-overlay-2026-09-01",
    prompt_policy_version: "pp1-diagnose-2026-08-23",
    prompt_template_digest: "b".repeat(64),
    culture: null,
    tenant: "default",
    company: "My Company",
    bcch_use_pssession_bc28: false,
    bcch_use_pwsh_bc24: true,
  };
}

Deno.test("todayPricingVersion is a UTC YYYY-MM-DD stamp", () => {
  const v = todayPricingVersion();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(v), `unexpected format: ${v}`);
  const now = new Date();
  const expected = `${now.getUTCFullYear()}-${
    String(now.getUTCMonth() + 1).padStart(2, "0")
  }-${String(now.getUTCDate()).padStart(2, "0")}`;
  assertEquals(v, expected);
});

Deno.test("buildIngestMeta mints one distinct run UUID per variant", () => {
  const meta = buildIngestMeta([
    { variantId: "anthropic/claude-sonnet-5" },
    { variantId: "openai/gpt-5.5" },
  ]);
  assertEquals(meta.schema, 1);
  assertEquals(meta.pricing_version, todayPricingVersion());
  assertEquals(Object.keys(meta.run_ids).length, 2);
  const a = meta.run_ids["anthropic/claude-sonnet-5"]!;
  const b = meta.run_ids["openai/gpt-5.5"]!;
  assertNotEquals(a, b);
  assert(/^[0-9a-f-]{36}$/.test(a), `not a UUID: ${a}`);
});

Deno.test("buildIngestMeta stamps schema 2 + task_set_hash when a hash is given", () => {
  const hash = "a".repeat(64);
  const meta = buildIngestMeta([{ variantId: "mock/mock-gpt-4" }], hash);
  assertEquals(meta.schema, 2);
  assertEquals(meta.task_set_hash, hash);
});

Deno.test("buildIngestMeta stamps schema 4 + environment/invocations when capture is given", () => {
  const hash = "a".repeat(64);
  const environment = fakeEnvironment();
  const invocations = {
    "mock/mock-gpt-4": { provider: "mock", requested_model: "mock-gpt-4" },
  };
  const meta = buildIngestMeta(
    [{ variantId: "mock/mock-gpt-4" }],
    hash,
    { environment, invocations },
  );
  assertEquals(meta.schema, 4);
  assertEquals(meta.task_set_hash, hash);
  assertEquals(meta.environment, environment);
  assertEquals(meta.invocations, invocations);
});

Deno.test("buildIngestMeta writes schema 4 with a capture and parseIngestMeta accepts it", () => {
  const meta = buildIngestMeta([{ variantId: "v" }], "h".repeat(64), {
    environment: {} as never,
    invocations: { v: { provider: "anthropic", mode: "sync" } },
  });
  assertEquals(meta.schema, 4);
  const parsed = parseIngestMeta({ ingest: { ...meta } });
  assertEquals(parsed?.schema, 4);
  assertEquals(parsed?.invocations?.["v"]?.["mode"], "sync");
});

Deno.test("buildIngestMeta omits environment/invocations entirely when capture is not given", () => {
  const meta = buildIngestMeta(
    [{ variantId: "mock/mock-gpt-4" }],
    "a".repeat(64),
  );
  assertEquals(meta.schema, 2);
  assertEquals("environment" in meta, false);
  assertEquals("invocations" in meta, false);
});

Deno.test("parseIngestMeta round-trips a schema-4 file carrying environment + invocations", () => {
  const environment = fakeEnvironment();
  const invocations = {
    "mock/mock-gpt-4": { provider: "mock", requested_model: "mock-gpt-4" },
  };
  const meta = buildIngestMeta(
    [{ variantId: "mock/mock-gpt-4" }],
    "b".repeat(64),
    { environment, invocations },
  );
  const saved = JSON.parse(JSON.stringify({ results: [], ingest: meta }));
  const parsed = parseIngestMeta(saved);
  assert(parsed !== undefined, "schema-4 meta must parse");
  assertEquals(parsed!.schema, 4);
  assertEquals(parsed!.environment, environment);
  assertEquals(parsed!.invocations, invocations);
  assertEquals(parsed, meta);
});

Deno.test("parseIngestMeta omits environment/invocations for a legacy file that never carried them", () => {
  const parsed = parseIngestMeta({
    ingest: {
      schema: 2,
      pricing_version: "2026-07-17",
      run_ids: { "mock/mock-gpt-4": "11111111-2222-3333-4444-555555555555" },
      task_set_hash: "c".repeat(64),
    },
  });
  assert(parsed !== undefined, "schema-2 meta must still parse");
  assertEquals("environment" in parsed!, false);
  assertEquals("invocations" in parsed!, false);
});

Deno.test("parseIngestMeta ignores a malformed environment/invocations shape rather than throwing", () => {
  const parsed = parseIngestMeta({
    ingest: {
      schema: 3,
      pricing_version: "2026-07-17",
      run_ids: { "mock/mock-gpt-4": "11111111-2222-3333-4444-555555555555" },
      environment: "not-an-object",
      invocations: { "mock/mock-gpt-4": "not-an-object-either" },
    },
  });
  assert(
    parsed !== undefined,
    "meta must still parse despite malformed capture fields",
  );
  assertEquals("environment" in parsed!, false);
  assertEquals("invocations" in parsed!, false);
});

Deno.test("parseIngestMeta round-trips through JSON save/load", () => {
  const meta = buildIngestMeta([{ variantId: "mock/mock-gpt-4" }]);
  const saved = JSON.parse(JSON.stringify({ results: [], ingest: meta }));
  const parsed = parseIngestMeta(saved);
  assert(parsed !== undefined, "persisted meta must parse");
  assertEquals(parsed, meta);
});

Deno.test("parseIngestMeta round-trips a schema-2 file carrying task_set_hash", () => {
  const meta = buildIngestMeta(
    [{ variantId: "mock/mock-gpt-4" }],
    "b".repeat(64),
  );
  const saved = JSON.parse(JSON.stringify({ results: [], ingest: meta }));
  const parsed = parseIngestMeta(saved);
  assert(parsed !== undefined, "schema-2 meta must parse");
  assertEquals(parsed!.schema, 2);
  assertEquals(parsed!.task_set_hash, "b".repeat(64));
  assertEquals(parsed, meta);
});

Deno.test("parseIngestMeta reads a legacy schema-1 file with no task_set_hash", () => {
  // Schema-1 files predate the persisted hash — they must still parse (run
  // identity preserved), just without a task_set_hash so ingest recomputes.
  const parsed = parseIngestMeta({
    ingest: {
      schema: 1,
      pricing_version: "2026-07-17",
      run_ids: { "mock/mock-gpt-4": "11111111-2222-3333-4444-555555555555" },
    },
  });
  assert(parsed !== undefined, "legacy schema-1 meta must parse");
  assertEquals(parsed!.schema, 1);
  assertEquals(parsed!.task_set_hash, undefined);
});

Deno.test("parseIngestMeta returns undefined for legacy files and malformed meta", () => {
  assertEquals(parseIngestMeta({ results: [] }), undefined);
  assertEquals(parseIngestMeta(null), undefined);
  assertEquals(parseIngestMeta({ ingest: { schema: 2 } }), undefined);
  assertEquals(
    parseIngestMeta({
      ingest: { schema: 1, pricing_version: "2026-07-17", run_ids: "nope" },
    }),
    undefined,
  );
  assertEquals(
    parseIngestMeta({
      ingest: {
        schema: 1,
        pricing_version: "2026-07-17",
        run_ids: { a: 42 },
      },
    }),
    undefined,
  );
});

Deno.test("validateAttemptsForIngest (T5): >2 attempts refused when ingest enabled", () => {
  const err = validateAttemptsForIngest(3, true);
  assert(err !== undefined, "attempts=3 with ingest must be refused");
  assert(
    err.includes("--no-ingest"),
    `message must point at --no-ingest: ${err}`,
  );

  assertEquals(validateAttemptsForIngest(3, false), undefined);
  assertEquals(validateAttemptsForIngest(2, true), undefined);
  assertEquals(validateAttemptsForIngest(1, true), undefined);
});
