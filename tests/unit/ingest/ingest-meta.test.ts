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
