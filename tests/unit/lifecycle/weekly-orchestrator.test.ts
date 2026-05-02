/**
 * Unit tests for the weekly cycle orchestrator's pure functions.
 *
 * The orchestrator script (`scripts/weekly-cycle.ts`) is half I/O
 * (subprocesses + filesystem) and half logic (which models are stale).
 * The logic half lives in pure exported functions tested here; the I/O
 * half is exercised by the (gated) integration test at the bottom.
 *
 * @module tests/unit/lifecycle/weekly-orchestrator
 */
import { assertEquals } from "@std/assert";
import { selectStaleModels } from "../../../scripts/weekly-cycle.ts";
import { PRE_P6_TASK_SET_SENTINEL } from "../../../src/lifecycle/types.ts";

const NOW = Date.UTC(2026, 4, 5, 6, 0, 0);
const DAY = 86_400_000;

Deno.test("selectStaleModels — picks models with no analysis under current task_set", () => {
  const status = {
    rows: [
      // opus-4-7: analysed 3 days ago — fresh.
      {
        model_slug: "anthropic/claude-opus-4-7",
        task_set_hash: "ts-current",
        step: "analyze" as const,
        last_ts: NOW - 3 * DAY,
        last_event_id: 1,
        last_event_type: "analysis.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
      // opus-4-6: analysed 14 days ago — stale.
      {
        model_slug: "anthropic/claude-opus-4-6",
        task_set_hash: "ts-current",
        step: "analyze" as const,
        last_ts: NOW - 14 * DAY,
        last_event_id: 2,
        last_event_type: "analysis.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
      // gpt-5.5: never analysed (only bench), so absent from analyze rows.
      {
        model_slug: "openai/gpt-5.5",
        task_set_hash: "ts-current",
        step: "bench" as const,
        last_ts: NOW - DAY,
        last_event_id: 3,
        last_event_type: "bench.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
    ],
    legacy_rows: [],
    error_rows: [],
    hints: [],
    as_of_ts: NOW,
  };

  const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
  assertEquals(stale.sort(), ["anthropic/claude-opus-4-6", "openai/gpt-5.5"]);
});

Deno.test("selectStaleModels — skips legacy task_set entries (PRE_P6 sentinel)", () => {
  const status = {
    rows: [
      {
        model_slug: "anthropic/claude-sonnet-4-6",
        task_set_hash: PRE_P6_TASK_SET_SENTINEL,
        step: "analyze" as const,
        last_ts: NOW - 30 * DAY,
        last_event_id: 1,
        last_event_type: "analysis.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
    ],
    legacy_rows: [],
    error_rows: [],
    hints: [],
    as_of_ts: NOW,
  };
  const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
  assertEquals(stale.length, 0);
});

Deno.test("selectStaleModels — never-analysed model present in any other step is stale", () => {
  // A model that has bench.completed but no analyze row should be considered
  // stale — the orchestrator's job is to push it through analyze + publish.
  const status = {
    rows: [
      {
        model_slug: "openai/gpt-5.5",
        task_set_hash: "ts-current",
        step: "bench" as const,
        last_ts: NOW,
        last_event_id: 1,
        last_event_type: "bench.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
    ],
    legacy_rows: [],
    error_rows: [],
    hints: [],
    as_of_ts: NOW,
  };
  const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
  assertEquals(stale, ["openai/gpt-5.5"]);
});

Deno.test("selectStaleModels — error_rows are reported as stale (operator triages)", () => {
  // A model whose status fetch failed (transient 429, etc.) is included as
  // stale so the orchestrator attempts a cycle. If the underlying issue
  // is genuine the cycle will surface its own failure event.
  const status = {
    rows: [],
    legacy_rows: [],
    error_rows: [
      {
        model_slug: "openrouter/x-ai-grok-4",
        error_message: "HTTP 429 Too Many Requests",
      },
    ],
    hints: [],
    as_of_ts: NOW,
  };
  const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
  assertEquals(stale, ["openrouter/x-ai-grok-4"]);
});

Deno.test("selectStaleModels — fully-current models are excluded", () => {
  // analyse + publish both fresh.
  const status = {
    rows: [
      {
        model_slug: "anthropic/claude-opus-4-7",
        task_set_hash: "ts-current",
        step: "analyze" as const,
        last_ts: NOW - DAY,
        last_event_id: 1,
        last_event_type: "analysis.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
      {
        model_slug: "anthropic/claude-opus-4-7",
        task_set_hash: "ts-current",
        step: "publish" as const,
        last_ts: NOW - DAY + 60_000,
        last_event_id: 2,
        last_event_type: "publish.completed",
        last_payload_hash: null,
        last_envelope_json: null,
      },
    ],
    legacy_rows: [],
    error_rows: [],
    hints: [],
    as_of_ts: NOW,
  };
  const stale = selectStaleModels(status, { now: NOW, staleAfterMs: 7 * DAY });
  assertEquals(stale, []);
});
