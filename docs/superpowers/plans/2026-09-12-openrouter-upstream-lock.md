# OpenRouter Upstream Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record which OpenRouter upstream served every attempt, pin it per model so it cannot drift, fail a run whose pin cannot be shown to have held, and make the pin part of the invocation profile with one upstream profile per model, set and mode on the site.

**Architecture:** Identity is extracted once by a pure mapper shared by the sync and batch OpenRouter paths and carried as five fields from `LLMResponse` through `ExecutionAttempt` to the ingest wire and D1. The pin is resolved from config and the endpoints listing at bench start, frozen into `prompt-inputs.json` for batch, threaded through `LLMConfig.upstreamPin`, and hashed into the settings profile under a new named schema. The site claims an `upstream_profiles` row atomically inside the ingest batch and stores a compromised run already excluded.

**Tech Stack:** Deno 2 + TypeScript (CLI and runner), Cliffy, zod (batch state only), SvelteKit Cloudflare Worker + D1 (site), vitest against the built bundle.

**Spec:** `docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md` (revision 3). Reviews: `.panel/upstream-lock-spec-review-gpt56sol.md`, `.panel/upstream-lock-spec-review-2-gpt56sol.md`.

## Global Constraints

- Work only in the worktree `U:/Git/CentralGauge/.worktrees/provider-lock` on branch `provider-lock`. The main checkout has live batch runs and must not be edited, tested or committed.
- No em dashes anywhere in code, comments, docs or commit messages. Use a period, colon, comma or hyphen.
- Commits: explicit `git add <paths>`, never `git add -A`; every commit ends with the trailer `Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK`.
- Deno side after every change: `deno check <changed files>`, `deno lint <changed dirs>`, `deno fmt <changed files>` (files you touched only; the repo has CRLF drift).
- Deno tests: `deno test --allow-all <file>` for a single file. Never run `tests/unit/container/` while a bench is live. Never `--parallel`.
- Site: `cd site && npm install` once in the worktree; `npm run build` BEFORE `npm run test:main` (vitest runs the built bundle); `npx prettier` is NOT configured in `site/` and must not be run there; match the surrounding quote style by hand (`site/src/lib/server/*.ts` uses double quotes, components and `metrics.ts`/`format.ts` use single). Never `deno fmt` under `site/`.
- Terminology: the backend OpenRouter routes to is the **upstream**. Fields are `requested_upstream`, `served_upstream`, `served_upstream_model`, `upstream_identity_source`, `upstream_verification`; the pin is `upstream_pin`. Never name any of these `provider`.
- Three schema versions are named distinctly: `IngestMeta.schema` (results-file metadata, bumps to 5), `settings_extras_schema` (on `CanonicalSettingsExtras`, new value 2), `invocation_schema` (on `InvocationRecord`, new value 2). Never reuse one for another.
- `upstream_verification` values, exactly: `not_applicable`, `unpinned`, `verified`, `mismatch`, `unverified`, `not_served`. D1 column is nullable with no default; null means the row predates capture.
- `upstream_identity_source` values, exactly: `provider_field`, `router_metadata`, `both`; null when no identity.
- Auto-exclusion codes, exactly: `upstream_mismatch`, `upstream_unverified`.
- The registry profile key for an unpinned run is the literal string `<unpinned>`.
- Legacy runs are never passed through the schema-2 `CanonicalSettingsExtras` type; a results file with `IngestMeta.schema` 4 or lower routes through `buildLegacyCanonicalSettings`, which must reproduce the existing fixture hashes byte for byte.
- No OpenRouter credit is spent except in Task 1 (two one-item probes) and the live verification in Task 15 (one 32-token request). Every other test uses fakes.
- Deploy order is out of scope for this plan and unchanged: migration `0023` before `npm run deploy`.

---

## File map

Created:
- `src/llm/upstream-pin.ts`: pin resolution, endpoints listing fetch, preflight.
- `src/llm/upstream-verification.ts`: pure classification of an attempt's five fields.
- `tests/unit/llm/upstream-pin.test.ts`, `tests/unit/llm/upstream-verification.test.ts`
- `tests/fixtures/batch-runs/pre-upstream/` : a trimmed real run directory from before this change (Task 2).
- `site/migrations/0023_results_upstream.sql`
- `site/src/routes/api/v1/admin/runs/upstream/+server.ts`: per-attempt backfill.
- `site/src/lib/server/upstream-profile.ts`: registry claim/release SQL helpers.
- `site/src/lib/server/upstream-summary.ts`: per-attempt and per-run upstream shapes for both run-detail routes.
- `site/src/lib/client/upstream-chip.ts`: leaderboard chip tone/label from a row's `upstream`.
- `cli/commands/bench/upstream-precheck.ts`: pin resolution shared by `bench` and `bench batch submit`.
- `src/ingest/upstream-backfill.ts`: read served upstreams from a batch run dir; post the admin backfill.
- `site/tests/api/admin-runs-upstream.test.ts`, `site/tests/api/runs-ingest-upstream.test.ts`, `site/tests/api/runs-detail-upstream.test.ts`, `site/tests/unit/upstream-chip.test.ts`
- `tests/unit/cli/bench/upstream-precheck.test.ts`, `tests/unit/ingest/upstream-backfill.test.ts`, `tests/unit/cli/runs-backfill-upstream.test.ts`
- `docs/batch-mode.md` section "Upstream pinning" (Task 16).

Modified (by task number):
- T3: `src/llm/types.ts`, `src/llm/mappers/openrouter.ts`
- T4: `src/llm/openrouter-adapter.ts`
- T5: `src/llm/batch/openrouter-batch.ts`, `src/batch/provider-wiring.ts`
- T6: `src/config/config.ts`
- T8: `src/tasks/interfaces.ts`, `src/parallel/types.ts`, `src/parallel/shared/attempt-context.ts`, `src/parallel/llm-work-pool.ts`, `src/parallel/shared/evaluate-attempt.ts`, `failed-attempt.ts`, `infra-attempt.ts`, `src/parallel/orchestrator.ts`
- T9: `src/parallel/shared/prompt-inputs.ts`, `src/batch/submit.ts`, `src/batch/evaluate.ts`, `src/batch/transitions.ts`, `cli/commands/bench-batch-command.ts`, `src/utils/harness-fingerprint.ts`
- T10: `shared/settings-hash.ts`, `shared/fixtures/settings-hash.fixture.json`, `src/ingest/capture.ts`, `src/batch/results.ts`
- T11: `cli/commands/bench/ingest-meta.ts`, `cli/commands/bench/ingest-assembly.ts`, `src/ingest/mod.ts`, `src/ingest/envelope.ts`, `cli/commands/bench/results-writer.ts`
- T12: `site/src/routes/api/v1/runs/+server.ts`, `site/src/lib/shared/types.ts`, `site/src/lib/server/audit.ts`
- T13: `site/src/routes/api/v1/admin/runs/exclude/+server.ts`
- T14: `site/src/routes/api/v1/runs/[id]/+server.ts`, `site/src/routes/api/v2/runs/[id]/+server.ts`, `site/src/lib/server/leaderboard.ts`, `site/src/lib/shared/api-types.ts`, `site/src/lib/components/domain/LeaderboardTable.svelte`, `LeaderboardRowDetail.svelte`, `site/src/routes/runs/[id]/+page.svelte`, `site/src/lib/server/cache-version.ts`
- T15: `cli/commands/models-command.ts`, `cli/commands/runs-command.ts`, `cli/commands/bench-command.ts`, `cli/commands/bench-batch-command.ts`, `cli/types/cli-types.ts`, `cli/commands/bench/parallel-executor.ts`
- T16: `docs/batch-mode.md`, `.claude/rules/batch-mode.md`, `CLAUDE.md`, `docs/guides/configuration.md`, `docs/cli/commands.md`

---

### Task 1: Live spike, Batch API error shape and per-item metadata header

**Files:**
- Create: `scripts/spikes/openrouter-batch-pin-spike.ts`
- Modify: `docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md` (section 4 D3 table only)

**Interfaces:**
- Produces: two recorded facts in the spec's D3 table, consumed by Task 5's classifier and Task 4's batch header decision.

This task spends OpenRouter credit (two one-item batches, a few cents). It answers the two questions the spec explicitly gates on: which shape a pinned-upstream outage takes on the Batch API, and whether `openrouter_metadata` can be obtained per batch item.

- [ ] **Step 1: Write the spike script**

```ts
// scripts/spikes/openrouter-batch-pin-spike.ts
//
// Two one-item batches against a cheap model. Batch A pins a slug that the
// endpoints listing marks unavailable (status !== 0) or that is currently
// rate-limited, with allow_fallbacks false. Batch B pins a live slug and sets
// X-OpenRouter-Metadata: enabled on the batch create request. Prints the
// batch status, request_counts, and each result entry verbatim so the D3
// table can be amended from observation rather than inference.
import { EnvLoader } from "../../src/utils/env-loader.ts";

await EnvLoader.loadEnvironment();
const key = Deno.env.get("OPENROUTER_API_KEY");
if (!key) throw new Error("OPENROUTER_API_KEY not set");
const MODEL = "z-ai/glm-5.3-flash";
const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const ep = await (await fetch(
  `https://openrouter.ai/api/v1/models/${MODEL}/endpoints`,
  { headers: H },
)).json() as { data?: { endpoints?: Array<{ tag: string; status?: number }> } };
const endpoints = ep.data?.endpoints ?? [];
const dead = endpoints.find((e) => (e.status ?? 0) !== 0)?.tag ?? "no-such-upstream/fp8";
const live = endpoints.find((e) => (e.status ?? 0) === 0)?.tag;
if (!live) throw new Error("no live upstream to pin");
console.log(`dead pin: ${dead}   live pin: ${live}`);

async function createBatch(label: string, pin: string, extra: Record<string, string>) {
  const body = {
    endpoint: "/v1/chat/completions",
    model: MODEL,
    requests: [{
      custom_id: `${label}-1`,
      body: {
        model: MODEL,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 32,
        provider: { order: [pin], allow_fallbacks: false },
      },
    }],
  };
  const r = await fetch("https://openrouter.ai/api/beta/batches", {
    method: "POST",
    headers: { ...H, ...extra },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(`\n== ${label} create: HTTP ${r.status}`);
  console.log(JSON.stringify(j).slice(0, 600));
  return (j.data ?? j).id as string | undefined;
}

async function pollBatch(label: string, id: string) {
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 15_000));
    const r = await fetch(`https://openrouter.ai/api/beta/batches/${id}`, { headers: H });
    const j = await r.json();
    const d = j.data ?? j;
    console.log(`${label} poll ${i}: status=${d.status} counts=${JSON.stringify(d.request_counts ?? {})}`);
    if (["completed", "failed", "expired", "cancelled"].includes(d.status)) {
      console.log(`\n== ${label} final record (results verbatim):`);
      console.log(JSON.stringify(d).slice(0, 4000));
      return;
    }
  }
  console.log(`${label}: still processing after 10 minutes; record that as the observation`);
}

const a = await createBatch("dead-pin", dead, {});
const b = await createBatch("live-pin-metadata", live, { "X-OpenRouter-Metadata": "enabled" });
if (a) await pollBatch("dead-pin", a);
if (b) await pollBatch("live-pin-metadata", b);
```

- [ ] **Step 2: Run it once and capture the output**

Run: `deno run --allow-all scripts/spikes/openrouter-batch-pin-spike.ts > .panel/openrouter-batch-pin-spike.log 2>&1`

Expected: the log shows, for the dead pin, exactly one of: create rejected with 404 (record the body), a batch that reaches `failed`/`expired` with `results: null`, a `completed` batch whose single result entry carries a non-200 `response.status_code` or an error-only entry (record the entry verbatim), or a batch still processing after ten minutes. For the live pin, the result entry's `response.body` either does or does not contain `openrouter_metadata`.

- [ ] **Step 3: Amend the spec's D3 table from the observation**

Edit `docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md`, section 4 D3: replace the sentence beginning "The plan includes a one-item **Batch API spike**" with a sentence stating the observed shape for a pinned-upstream outage on the Batch API (which of the table's rows occurred, quoting the `status`, `request_counts` and the entry's `status_code` or `error.code`), and add one sentence under D1's batch bullet stating whether `openrouter_metadata` was present in the batch result body with the header set. Do not change any other section.

- [ ] **Step 4: Commit**

```bash
git add scripts/spikes/openrouter-batch-pin-spike.ts .panel/openrouter-batch-pin-spike.log docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md
git commit -m "spike(openrouter): batch API shape for a pinned-upstream outage and per-item metadata

Two one-item batches against glm-5.3-flash. Records which error shape a
pinned but unavailable upstream produces through the Batch API and whether
X-OpenRouter-Metadata reaches batch result bodies, both of which the spec
had left as questions. The D3 table now states the observation.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 2: Pre-change batch run fixture

**Files:**
- Create: `tests/fixtures/batch-runs/pre-upstream/README.md`, `tests/fixtures/batch-runs/pre-upstream/state.json`, `prompt-inputs.json`, `items.jsonl`, `requests/<two items>.json`, `responses/<two items>.json`, `attempts/<two files>.json`, `benchmark-results.json`
- Create: `tests/utils/batch-fixture.ts`

**Interfaces:**
- Produces: `copyPreUpstreamFixture(): Promise<{ dir: string; resultsFile: string; cleanup: () => Promise<void> }>` in `tests/utils/batch-fixture.ts`, used by Tasks 9, 10 and 11 for legacy-path tests.

The fixture is a real finished OpenRouter run from before this change, trimmed to two tasks, so the D4 legacy tests exercise a file shape the code actually wrote rather than a hand-typed approximation.

- [ ] **Step 1: Copy and trim a finished run**

Source run: `U:/Git/CentralGauge/results/batch/1f99aac6-4b2f-4bc4-a04a-c1dd521d6fb6` (Gemini 3.8 Flash, finalized, unpinned, served by "Google") and its results file `U:/Git/CentralGauge/results/benchmark-results-1f99aac6-4b2f-4bc4-a04a-c1dd521d6fb6.json`. Write a one-off Deno script (do not commit it) that:

1. Reads `state.json`; keeps `tasks` for exactly two task ids: the first task id alphabetically that has both `attempt1` and `attempt2`, and the first that has only `attempt1`. Removes every other key from `tasks`, removes their item ids from `batches[*].itemIds`, and sets `frozen.taskIds` to those two ids.
2. Copies `prompt-inputs.json` verbatim.
3. Filters `items.jsonl` to lines whose `itemId` belongs to the two tasks.
4. Copies the `requests/`, `responses/` and `attempts/` files for those items only.
5. Reads the results file; keeps `results` entries for the two task ids; keeps `ingest` verbatim.
6. Writes everything under `tests/fixtures/batch-runs/pre-upstream/` with the results file named `benchmark-results.json`.

Confirm `prompt-inputs.json` has no `routing` key and `state.json`'s `frozen` has no upstream fields, and that the results file's `ingest.schema` is `4`: `jq '.ingest.schema' tests/fixtures/batch-runs/pre-upstream/benchmark-results.json` prints `4`.

- [ ] **Step 2: Write the README**

```markdown
# pre-upstream batch run fixture

A real OpenRouter batch run (Gemini 3.8 Flash, run 1f99aac6, finalized
2026-09-11) trimmed to two tasks, captured BEFORE the upstream-lock change.

Its `prompt-inputs.json` has no `routing` block, its results file is
`ingest.schema` 4 with no `canonical_settings`, and its invocation record has
no `invocation_schema`. Tests use it to prove that a run from before the
change still advances, finalizes, ingests and replays with the settings hash
it was frozen with, never recomputed through the schema-2 extras type.

Do not regenerate it from a newer run; its value is that it predates the
change.
```

- [ ] **Step 3: Write the copy helper**

```ts
// tests/utils/batch-fixture.ts
import { copy } from "@std/fs";
import { join } from "@std/path";
import { cleanupTempDir, createTempDir } from "./test-helpers.ts";

const FIXTURE = join(
  import.meta.dirname!,
  "..",
  "fixtures",
  "batch-runs",
  "pre-upstream",
);

/**
 * Copy the pre-upstream fixture run into a temp directory shaped like
 * `<output>/batch/<runId>/` so code under test can treat it as a real run.
 */
export async function copyPreUpstreamFixture(): Promise<{
  output: string;
  runId: string;
  dir: string;
  resultsFile: string;
  cleanup: () => Promise<void>;
}> {
  const output = await createTempDir("pre-upstream");
  const state = JSON.parse(
    await Deno.readTextFile(join(FIXTURE, "state.json")),
  ) as { runId: string };
  const dir = join(output, "batch", state.runId);
  await copy(FIXTURE, dir, { overwrite: true });
  const resultsFile = join(output, `benchmark-results-${state.runId}.json`);
  await Deno.copyFile(join(FIXTURE, "benchmark-results.json"), resultsFile);
  await Deno.remove(join(dir, "benchmark-results.json"));
  await Deno.remove(join(dir, "README.md"));
  return {
    output,
    runId: state.runId,
    dir,
    resultsFile,
    cleanup: () => cleanupTempDir(output),
  };
}
```

- [ ] **Step 4: Write a smoke test that the fixture loads**

```ts
// tests/unit/batch/fixture-pre-upstream.test.ts
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { loadState } from "../../../src/batch/state.ts";
import { copyPreUpstreamFixture } from "../../utils/batch-fixture.ts";

Deno.test("pre-upstream fixture parses as a finalized schema-4 run with no routing", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const state = await loadState(f.dir);
    assertEquals(state.phase, "finalized");
    assertEquals(Object.keys(state.tasks).length, 2);
    const inputs = JSON.parse(
      await Deno.readTextFile(join(f.dir, "prompt-inputs.json")),
    ) as Record<string, unknown>;
    assertEquals("routing" in inputs, false);
    const results = JSON.parse(await Deno.readTextFile(f.resultsFile)) as {
      ingest: { schema: number };
    };
    assertEquals(results.ingest.schema, 4);
    assertExists(inputs["settings"]);
  } finally {
    await f.cleanup();
  }
});
```

- [ ] **Step 5: Run the smoke test**

Run: `deno test --allow-all tests/unit/batch/fixture-pre-upstream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/batch-runs/pre-upstream tests/utils/batch-fixture.ts tests/unit/batch/fixture-pre-upstream.test.ts
git commit -m "test(batch): pre-upstream run fixture for legacy-path tests

A real Gemini 3.8 Flash batch run trimmed to two tasks, captured before the
upstream-lock change: no routing block, ingest schema 4, no invocation
schema. The D4 tests in later tasks prove such a run still advances,
finalizes and replays under the hash it was frozen with.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 3: Upstream identity on `LLMResponse` and a pure extractor

**Files:**
- Modify: `src/llm/types.ts:92-110` (LLMResponse)
- Modify: `src/llm/mappers/openrouter.ts` (add `extractUpstreamIdentity`, extend `assembleResponse`)
- Test: `tests/unit/llm/mappers-openrouter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/llm/types.ts
  export type UpstreamIdentitySource = "provider_field" | "router_metadata" | "both";
  export interface UpstreamIdentity {
    servedUpstream: string;
    servedUpstreamModel?: string | undefined;
    source: UpstreamIdentitySource;
  }
  // LLMResponse gains:
  //   servedUpstream?: string | undefined;
  //   servedUpstreamModel?: string | undefined;
  //   upstreamIdentitySource?: UpstreamIdentitySource | undefined;
  //   upstreamIdentityConflict?: boolean | undefined;   // provider field and metadata disagree
  // src/llm/mappers/openrouter.ts
  export type UpstreamExtraction =
    | UpstreamIdentity
    | { conflict: true; providerField: string; metadata: string };
  export function extractUpstreamIdentity(body: unknown): UpstreamExtraction | undefined;
  ```
  `assembleResponse` accepts `upstream?: UpstreamExtraction | undefined` and sets the four response fields.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/llm/mappers-openrouter.test.ts
import { assertEquals } from "@std/assert";
import {
  assembleResponse,
  extractUpstreamIdentity,
  mapFinishReason,
} from "../../../src/llm/mappers/openrouter.ts";

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

Deno.test("extractUpstreamIdentity reads the legacy provider field alone", () => {
  assertEquals(extractUpstreamIdentity({ provider: "Novita" }), {
    servedUpstream: "Novita",
    servedUpstreamModel: undefined,
    source: "provider_field",
  });
});

Deno.test("extractUpstreamIdentity reads router metadata alone, with the dated model", () => {
  assertEquals(
    extractUpstreamIdentity({
      openrouter_metadata: {
        endpoints: {
          available: [
            { provider: "Morph", model: "x-1", selected: false },
            { provider: "Novita", model: "z-ai/glm-5.3-flash-20260826", selected: true },
          ],
        },
      },
    }),
    {
      servedUpstream: "Novita",
      servedUpstreamModel: "z-ai/glm-5.3-flash-20260826",
      source: "router_metadata",
    },
  );
});

Deno.test("extractUpstreamIdentity reports both when the two sources agree", () => {
  const id = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: {
      endpoints: { available: [{ provider: "Novita", model: "m", selected: true }] },
    },
  });
  assertEquals(id, {
    servedUpstream: "Novita",
    servedUpstreamModel: "m",
    source: "both",
  });
});

Deno.test("extractUpstreamIdentity reports a conflict when the two sources disagree", () => {
  assertEquals(
    extractUpstreamIdentity({
      provider: "Novita",
      openrouter_metadata: {
        endpoints: { available: [{ provider: "Together", model: "m", selected: true }] },
      },
    }),
    { conflict: true, providerField: "Novita", metadata: "Together" },
  );
});

Deno.test("extractUpstreamIdentity ignores metadata with zero or several selected entries", () => {
  const none = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: { endpoints: { available: [{ provider: "A", model: "m", selected: false }] } },
  });
  assertEquals(none, { servedUpstream: "Novita", servedUpstreamModel: undefined, source: "provider_field" });
  const many = extractUpstreamIdentity({
    provider: "Novita",
    openrouter_metadata: {
      endpoints: {
        available: [
          { provider: "A", model: "m", selected: true },
          { provider: "B", model: "m", selected: true },
        ],
      },
    },
  });
  assertEquals(many, { servedUpstream: "Novita", servedUpstreamModel: undefined, source: "provider_field" });
});

Deno.test("extractUpstreamIdentity returns undefined when neither source is present", () => {
  assertEquals(extractUpstreamIdentity({}), undefined);
  assertEquals(extractUpstreamIdentity(null), undefined);
  assertEquals(extractUpstreamIdentity({ provider: "" }), undefined);
});

Deno.test("assembleResponse carries identity onto the response, and marks a conflict", () => {
  const ok = assembleResponse({
    content: "x",
    model: "m",
    usage,
    duration: 1,
    finish: mapFinishReason("stop"),
    upstream: { servedUpstream: "Novita", servedUpstreamModel: "v", source: "both" },
  });
  assertEquals(ok.servedUpstream, "Novita");
  assertEquals(ok.servedUpstreamModel, "v");
  assertEquals(ok.upstreamIdentitySource, "both");
  assertEquals(ok.upstreamIdentityConflict, undefined);

  const bad = assembleResponse({
    content: "x",
    model: "m",
    usage,
    duration: 1,
    finish: mapFinishReason("stop"),
    upstream: { conflict: true, providerField: "Novita", metadata: "Together" },
  });
  assertEquals(bad.servedUpstream, "Novita");
  assertEquals(bad.upstreamIdentityConflict, true);
  assertEquals(bad.upstreamIdentitySource, "both");

  const none = assembleResponse({ content: "x", model: "m", usage, duration: 1, finish: mapFinishReason("stop") });
  assertEquals(none.servedUpstream, undefined);
  assertEquals("upstreamIdentitySource" in none, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/mappers-openrouter.test.ts`
Expected: FAIL, `extractUpstreamIdentity` is not exported.

- [ ] **Step 3: Add the types**

In `src/llm/types.ts`, directly above `export interface LLMResponse {`:

```ts
/** Where an OpenRouter response's upstream identity was read from. */
export type UpstreamIdentitySource =
  | "provider_field"
  | "router_metadata"
  | "both";

/**
 * The upstream OpenRouter routed a request to, as observed on the response.
 * `servedUpstream` is the upstream's DISPLAY NAME ("Novita"), never its slug;
 * OpenRouter returns no slug or quantization on any response (spec section
 * 2). `servedUpstreamModel` is the upstream's dated model variant from
 * router metadata when the metadata header was honoured.
 */
export interface UpstreamIdentity {
  servedUpstream: string;
  servedUpstreamModel?: string | undefined;
  source: UpstreamIdentitySource;
}
```

Inside `LLMResponse`, after the `refusal` field:

```ts
  /** OpenRouter only: display name of the upstream that served this response. See {@link UpstreamIdentity}. */
  servedUpstream?: string | undefined;
  /** OpenRouter only: the upstream's dated model variant from router metadata, when present. Diagnostic, not identity. */
  servedUpstreamModel?: string | undefined;
  /** OpenRouter only: which response field(s) `servedUpstream` came from. */
  upstreamIdentitySource?: UpstreamIdentitySource | undefined;
  /**
   * OpenRouter only: true when the legacy `provider` field and router
   * metadata named DIFFERENT upstreams. The verification unit treats this as
   * a mismatch regardless of the pin.
   */
  upstreamIdentityConflict?: boolean | undefined;
```

- [ ] **Step 4: Add the extractor and extend the assembler**

In `src/llm/mappers/openrouter.ts`, import `UpstreamIdentity` from `../types.ts`, then add:

```ts
export type UpstreamExtraction =
  | UpstreamIdentity
  | { conflict: true; providerField: string; metadata: string };

/**
 * Read the serving upstream off an OpenRouter chat-completion body.
 *
 * Two sources exist (spec section 2): the legacy top-level `provider`
 * display name, present on every successful response we have observed, and
 * `openrouter_metadata.endpoints.available[]` when the request carried
 * `X-OpenRouter-Metadata: enabled`, which also names the upstream's dated
 * model variant. Exactly one `selected: true` entry is trusted; zero or
 * several are ignored in favour of the provider field. When both sources
 * are present and disagree the result is a conflict, which the caller
 * records as a mismatch.
 */
export function extractUpstreamIdentity(
  body: unknown,
): UpstreamExtraction | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as {
    provider?: unknown;
    openrouter_metadata?: {
      endpoints?: {
        available?: Array<{ provider?: unknown; model?: unknown; selected?: unknown }>;
      };
    };
  };
  const providerField = typeof b.provider === "string" && b.provider.length > 0
    ? b.provider
    : undefined;
  const selected = (b.openrouter_metadata?.endpoints?.available ?? []).filter(
    (e) =>
      e && e.selected === true && typeof e.provider === "string" &&
      (e.provider as string).length > 0,
  );
  const meta = selected.length === 1 ? selected[0]! : undefined;
  const metaName = meta ? (meta.provider as string) : undefined;
  const metaModel = meta && typeof meta.model === "string" ? meta.model : undefined;

  if (providerField !== undefined && metaName !== undefined) {
    if (providerField !== metaName) {
      return { conflict: true, providerField, metadata: metaName };
    }
    return { servedUpstream: providerField, servedUpstreamModel: metaModel, source: "both" };
  }
  if (providerField !== undefined) {
    return { servedUpstream: providerField, servedUpstreamModel: undefined, source: "provider_field" };
  }
  if (metaName !== undefined) {
    return { servedUpstream: metaName, servedUpstreamModel: metaModel, source: "router_metadata" };
  }
  return undefined;
}
```

Extend `assembleResponse`'s parameter type with `upstream?: UpstreamExtraction | undefined;` and compute the fields before the `return`:

```ts
  const { content, model, usage, duration, finish, servedModel, refusal, upstream } = parts;
  const upstreamFields: Partial<LLMResponse> = {};
  if (upstream !== undefined) {
    if ("conflict" in upstream) {
      upstreamFields.servedUpstream = upstream.providerField;
      upstreamFields.upstreamIdentitySource = "both";
      upstreamFields.upstreamIdentityConflict = true;
    } else {
      upstreamFields.servedUpstream = upstream.servedUpstream;
      if (upstream.servedUpstreamModel !== undefined) {
        upstreamFields.servedUpstreamModel = upstream.servedUpstreamModel;
      }
      upstreamFields.upstreamIdentitySource = upstream.source;
    }
  }
```

and spread `...upstreamFields` into the returned object after `refusal`.

- [ ] **Step 5: Run the tests**

Run: `deno test --allow-all tests/unit/llm/mappers-openrouter.test.ts && deno check src/llm/types.ts src/llm/mappers/openrouter.ts && deno lint src/llm && deno fmt src/llm/types.ts src/llm/mappers/openrouter.ts tests/unit/llm/mappers-openrouter.test.ts`
Expected: all PASS, no type or lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/llm/types.ts src/llm/mappers/openrouter.ts tests/unit/llm/mappers-openrouter.test.ts
git commit -m "feat(llm): upstream identity on LLMResponse with a pure OpenRouter extractor

OpenRouter names the serving upstream in two places: a legacy top-level
provider display name and, with the metadata header, a selected router
metadata entry that also carries the upstream's dated model variant. One
pure function reads both, reports the source, and flags a conflict when
they disagree, so the sync and batch paths cannot drift apart.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 4: Sync adapter, metadata header, routing block, streaming identity

**Files:**
- Modify: `src/llm/types.ts:1-28` (LLMConfig)
- Modify: `src/llm/openrouter-adapter.ts:130-140` (configure), `:246-274` (callProvider), `:277-347` (streamProvider), `:405-431` (buildRequestParams)
- Modify: `src/llm/mappers/openrouter.ts` (add `reduceStreamUpstream`)
- Test: `tests/unit/llm/openrouter-adapter.test.ts` (extend), `tests/unit/llm/mappers-openrouter.test.ts` (extend)

**Interfaces:**
- Consumes: `extractUpstreamIdentity`, `UpstreamExtraction`, `assembleResponse` from Task 3.
- Produces:
  ```ts
  // LLMConfig gains
  //   upstreamPin?: string | undefined;   // OpenRouter upstream slug, sent as provider.order
  // OpenRouterAdapter.buildRequestParams(request, stream?) includes
  //   provider: { order: [pin], allow_fallbacks: false }   when config.upstreamPin is set
  // mappers/openrouter.ts
  export function reduceStreamUpstream(
    acc: UpstreamExtraction | undefined,
    chunk: unknown,
  ): UpstreamExtraction | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/llm/openrouter-adapter.test.ts`:

```ts
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";

Deno.test("buildRequestParams adds the routing block only when a pin is configured", () => {
  const unpinned = new OpenRouterAdapter({
    provider: "openrouter",
    model: "z-ai/glm-5.3",
    apiKey: "k",
  });
  const p1 = unpinned.buildRequestParams({ prompt: "hi", taskId: "t", attempt: 1 } as never) as Record<string, unknown>;
  assertEquals("provider" in p1, false);

  const pinned = new OpenRouterAdapter({
    provider: "openrouter",
    model: "z-ai/glm-5.3",
    apiKey: "k",
    upstreamPin: "novita/fp8",
  });
  const p2 = pinned.buildRequestParams({ prompt: "hi", taskId: "t", attempt: 1 } as never) as Record<string, unknown>;
  assertEquals(p2["provider"], { order: ["novita/fp8"], allow_fallbacks: false });
});
```

Append to `tests/unit/llm/mappers-openrouter.test.ts`:

```ts
import { reduceStreamUpstream } from "../../../src/llm/mappers/openrouter.ts";

Deno.test("reduceStreamUpstream keeps the first identity and flags a later different one", () => {
  const a = reduceStreamUpstream(undefined, { provider: "Novita", choices: [] });
  assertEquals(a, { servedUpstream: "Novita", servedUpstreamModel: undefined, source: "provider_field" });
  const same = reduceStreamUpstream(a, { provider: "Novita", choices: [] });
  assertEquals(same, a);
  const noId = reduceStreamUpstream(a, { choices: [{ delta: { content: "x" } }] });
  assertEquals(noId, a);
  const diff = reduceStreamUpstream(a, { provider: "Together", choices: [] });
  assertEquals(diff, { conflict: true, providerField: "Novita", metadata: "Together" });
  const stays = reduceStreamUpstream(diff, { provider: "Novita", choices: [] });
  assertEquals(stays, diff);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/openrouter-adapter.test.ts tests/unit/llm/mappers-openrouter.test.ts`
Expected: FAIL on the new tests (`provider` absent; `reduceStreamUpstream` not exported).

- [ ] **Step 3: Add `upstreamPin` to LLMConfig**

In `src/llm/types.ts`, inside `LLMConfig` after `siteName`:

```ts
  /**
   * OpenRouter only: the upstream slug to pin (`novita/fp8`,
   * `google-vertex/global`), sent as `provider.order` with
   * `allow_fallbacks: false`. Resolved by `src/llm/upstream-pin.ts` from
   * `openrouter.upstream` config; never set by hand at a call site.
   */
  upstreamPin?: string | undefined;
```

- [ ] **Step 4: Routing block and metadata header in the adapter**

In `src/llm/openrouter-adapter.ts` `configure`, add a default header so every request asks for router metadata:

```ts
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
        timeout: config.timeout,
        // Ask OpenRouter to name the upstream it routed to (spec section 2).
        // Cheap, and the only documented way to get the upstream's dated
        // model variant. The legacy top-level `provider` field arrives with
        // or without it.
        defaultHeaders: { "X-OpenRouter-Metadata": "enabled" },
```

Keep whatever other headers the constructor already sets (merge into the same `defaultHeaders` object if one exists). In `buildRequestParams`, after `...(request.stop ? { stop: request.stop } : {}),`:

```ts
      // Upstream lock (spec D2): a one-element order with fallbacks off
      // provably confines routing to that slug, precision variant included.
      ...(this.config.upstreamPin
        ? {
          provider: {
            order: [this.config.upstreamPin],
            allow_fallbacks: false,
          },
        }
        : {}),
```

The OpenAI SDK's param type does not declare `provider`; the existing `as OpenAI.Chat.ChatCompletionCreateParams...` casts already cover the extra key. If `deno check` objects, cast through `unknown` first.

- [ ] **Step 5: Identity in the non-streaming path**

In `callProvider`, pass the identity into `assembleResponse`:

```ts
      response: assembleResponse({
        content: mapContent(choice?.message?.content),
        model: this.config.model,
        usage,
        duration,
        finish: mapFinishReason(choice?.finish_reason),
        upstream: extractUpstreamIdentity(completion),
      }),
```

Import `extractUpstreamIdentity` and `reduceStreamUpstream` from `./mappers/openrouter.ts`.

- [ ] **Step 6: Identity in the streaming path**

Add the reducer to `src/llm/mappers/openrouter.ts`:

```ts
/**
 * Fold the upstream identity across streamed chunks. The first identity seen
 * wins; a later chunk naming a different upstream turns the accumulator into
 * a conflict, and a conflict is sticky. Chunks without identity leave it
 * unchanged.
 */
export function reduceStreamUpstream(
  acc: UpstreamExtraction | undefined,
  chunk: unknown,
): UpstreamExtraction | undefined {
  if (acc !== undefined && "conflict" in acc) return acc;
  const next = extractUpstreamIdentity(chunk);
  if (next === undefined) return acc;
  if (acc === undefined) return next;
  if ("conflict" in next) return next;
  if (next.servedUpstream !== acc.servedUpstream) {
    return { conflict: true, providerField: acc.servedUpstream, metadata: next.servedUpstream };
  }
  if (acc.servedUpstreamModel === undefined && next.servedUpstreamModel !== undefined) {
    return { ...acc, servedUpstreamModel: next.servedUpstreamModel, source: "both" };
  }
  return acc;
}
```

In `streamProvider`, declare `let upstream: UpstreamExtraction | undefined;` beside `finalUsage`, and as the first statement inside `for await (const chunk of stream) {` add `upstream = reduceStreamUpstream(upstream, chunk);`. After `finalizeStream` returns and the `providerFinishReason` mirror, set the identity the same way:

```ts
      if (upstream !== undefined) {
        if ("conflict" in upstream) {
          result.response.servedUpstream = upstream.providerField;
          result.response.upstreamIdentitySource = "both";
          result.response.upstreamIdentityConflict = true;
        } else {
          result.response.servedUpstream = upstream.servedUpstream;
          if (upstream.servedUpstreamModel !== undefined) {
            result.response.servedUpstreamModel = upstream.servedUpstreamModel;
          }
          result.response.upstreamIdentitySource = upstream.source;
        }
      }
```

- [ ] **Step 7: Run the tests and checks**

Run: `deno test --allow-all tests/unit/llm/openrouter-adapter.test.ts tests/unit/llm/mappers-openrouter.test.ts && deno check src/llm/openrouter-adapter.ts src/llm/types.ts src/llm/mappers/openrouter.ts && deno lint src/llm && deno fmt src/llm/openrouter-adapter.ts src/llm/types.ts src/llm/mappers/openrouter.ts tests/unit/llm/openrouter-adapter.test.ts tests/unit/llm/mappers-openrouter.test.ts`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/llm/types.ts src/llm/openrouter-adapter.ts src/llm/mappers/openrouter.ts tests/unit/llm/openrouter-adapter.test.ts tests/unit/llm/mappers-openrouter.test.ts
git commit -m "feat(openrouter): send the upstream pin as routing and read identity on sync and stream

A configured upstreamPin becomes provider.order with allow_fallbacks false,
which the spike showed confines routing to that slug. Every request asks
for router metadata. The non-streaming path reads identity off the
completion; the streaming path folds it across chunks, keeping the first
and flagging a later different one.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 5: Batch adapter identity, error-only items, classifier table

**Files:**
- Modify: `src/llm/batch/openrouter-batch.ts:100-106` (result entry type), `:190-235` (`classifyStatusCode`, `mapResultLine`)
- Modify: `src/batch/provider-wiring.ts:213-226` (openrouter `mapRaw`)
- Test: `tests/unit/llm/batch/openrouter-batch.test.ts` (extend), `tests/unit/batch/provider-wiring.test.ts` (create if absent)

**Interfaces:**
- Consumes: `extractUpstreamIdentity`, `assembleResponse` (openrouter mappers) from Task 3; the Task 1 observation for the batch-level outage shape.
- Produces: `mapRaw` for `openrouter` sets `servedUpstream`, `servedUpstreamModel`, `upstreamIdentitySource`, `upstreamIdentityConflict` on the mapped `LLMResponse`; an error-only entry (no `response.status_code`, `error.code` present) classifies by that code instead of collapsing to `unknown`.

- [ ] **Step 1: Write the failing batch tests**

Append to `tests/unit/llm/batch/openrouter-batch.test.ts`, reusing its `makeFetch`/`jsonResponse` helpers:

```ts
Deno.test("OpenRouterBatchProvider.collect classifies an error-only entry by error.code, numeric or string", async () => {
  const batch = {
    id: "b2",
    model: "m",
    status: "completed",
    created_at: 0,
    results: [
      { custom_id: "num", response: null, error: { message: "upstream rate-limited", code: 429 } },
      { custom_id: "str", response: null, error: { message: "upstream rate-limited", code: "429" } },
      { custom_id: "four", response: null, error: { message: "No endpoints found", code: 404 } },
      { custom_id: "none", response: null, error: { message: "something" } },
    ],
  };
  const { fetch } = makeFetch(() => jsonResponse(batch));
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });
  const byId = new Map((await provider.collect({ provider: "openrouter", batchId: "b2" })).map((r) => [r.itemId, r]));

  for (const id of ["num", "str"]) {
    const r = byId.get(id);
    if (!r || r.ok) throw new Error(`${id}: expected an error`);
    assertEquals(r.error.kind, "rate_limited");
    assertEquals(r.error.retryable, true);
  }
  const four = byId.get("four");
  if (!four || four.ok) throw new Error("expected an error");
  assertEquals(four.error.kind, "invalid_request");
  assertEquals(four.error.retryable, false);
  const none = byId.get("none");
  if (!none || none.ok) throw new Error("expected an error");
  assertEquals(none.error.kind, "unknown");
  assertEquals(none.error.retryable, false);
});
```

Create `tests/unit/batch/provider-wiring.test.ts` (or append if it exists):

```ts
import { assertEquals } from "@std/assert";
import { wireProvider } from "../../../src/batch/provider-wiring.ts";

Deno.test("openrouter mapRaw carries the upstream identity from the inline result body", () => {
  const wiring = wireProvider("openrouter", { apiModelId: "z-ai/glm-5.3", variantConfig: null }, "k");
  const body = {
    id: "gen-1",
    provider: "Fireworks",
    choices: [{ message: { content: "codeunit 1 X {}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const r = wiring.mapRaw(body, "item-1");
  assertEquals(r.servedUpstream, "Fireworks");
  assertEquals(r.upstreamIdentitySource, "provider_field");
  assertEquals(r.upstreamIdentityConflict, undefined);

  const conflict = wiring.mapRaw({
    ...body,
    openrouter_metadata: { endpoints: { available: [{ provider: "Together", model: "m", selected: true }] } },
  }, "item-2");
  assertEquals(conflict.servedUpstream, "Fireworks");
  assertEquals(conflict.upstreamIdentityConflict, true);

  const none = wiring.mapRaw({ ...body, provider: undefined }, "item-3");
  assertEquals(none.servedUpstream, undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/batch/openrouter-batch.test.ts tests/unit/batch/provider-wiring.test.ts`
Expected: FAIL: `num`/`str` classify as `unknown`; `servedUpstream` undefined.

- [ ] **Step 3: Classify error-only entries by `error.code`**

In `src/llm/batch/openrouter-batch.ts`, replace the final `return` of `mapResultLine` (the `kind: "unknown"` branch) with:

```ts
  // Error-only entry: no HTTP status on the entry, but OpenRouter still
  // names the failure in `error.code`, numeric or string (spec D3 table).
  // Collapsing these to `unknown` used to make a rate-limited pinned
  // upstream non-retryable.
  const rawCode = entry.error?.code;
  const numericCode = typeof rawCode === "number"
    ? rawCode
    : typeof rawCode === "string" && /^\d{3}$/.test(rawCode)
    ? Number(rawCode)
    : undefined;
  if (numericCode !== undefined) {
    const { kind, retryable } = classifyStatusCode(numericCode);
    return {
      itemId,
      ok: false,
      error: {
        kind,
        message: entry.error?.message ?? `error ${numericCode}`,
        retryable,
      },
    };
  }
  return {
    itemId,
    ok: false,
    error: {
      kind: "unknown",
      message: entry.error?.message ?? "unknown batch error",
      retryable: false,
    },
  };
```

Then amend the file's doc comment on `mapResultLine` with the D3 table rows as amended by Task 1 (which shape a pinned outage took), so the classifier's contract is written where it is implemented.

- [ ] **Step 4: Identity in the openrouter `mapRaw`**

In `src/batch/provider-wiring.ts`, the openrouter case: import `assembleResponse as assembleOpenRouterResponse` and `extractUpstreamIdentity` from `../llm/mappers/openrouter.ts`, and change `mapRaw` to:

```ts
        mapRaw: (raw, _itemId) => {
          const body = raw as OpenAIBatchChatCompletionBody;
          const choice = body.choices?.[0];
          return assembleOpenRouterResponse({
            content: mapOpenAIContent(choice?.message?.content),
            model: model.apiModelId,
            usage: mapOpenAIUsage(body.usage ?? {}),
            duration: 0,
            finish: mapOpenAIFinishReason(choice?.finish_reason),
            // The inline batch body carries the same identity fields as a
            // sync response (spec D1, observed compatibility path).
            upstream: extractUpstreamIdentity(raw),
          });
        },
```

`mapOpenAIFinishReason` and the openrouter `mapFinishReason` return the same shape; if `deno check` disagrees, use the openrouter mapper's `mapFinishReason` for this case.

- [ ] **Step 5: Run tests and checks**

Run: `deno test --allow-all tests/unit/llm/batch/openrouter-batch.test.ts tests/unit/batch/provider-wiring.test.ts && deno check src/llm/batch/openrouter-batch.ts src/batch/provider-wiring.ts && deno lint src/llm/batch src/batch && deno fmt src/llm/batch/openrouter-batch.ts src/batch/provider-wiring.ts tests/unit/llm/batch/openrouter-batch.test.ts tests/unit/batch/provider-wiring.test.ts`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/llm/batch/openrouter-batch.ts src/batch/provider-wiring.ts tests/unit/llm/batch/openrouter-batch.test.ts tests/unit/batch/provider-wiring.test.ts
git commit -m "feat(batch): OpenRouter identity on collected items; classify error-only entries by code

The batch path maps inline result bodies through the same extractor the
sync adapter uses, so served upstream and any source conflict reach the
attempt record. An error-only entry now classifies by its error.code,
numeric or string, instead of collapsing to unknown and non-retryable,
which had made a rate-limited pinned upstream terminal.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 6: `openrouter.upstream` config section

**Files:**
- Modify: `src/config/config.ts:67-120` (interface), `:396-432` (validators), `:994-1015` (merge)
- Test: `tests/unit/config/openrouter-config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OpenRouterConfig {
    /** api_model_id -> upstream slug, e.g. { "z-ai/glm-5.3": "fireworks" }. */
    upstream?: Record<string, string>;
  }
  // CentralGaugeConfig gains `openrouter?: OpenRouterConfig;` (top level, beside `batch`)
  export const UPSTREAM_SLUG_RE = /^[a-z0-9-]+(\/[a-z0-9.-]+)*$/;
  export function validateOpenRouterConfig(config: OpenRouterConfig | undefined): OpenRouterConfig | undefined;
  export function upstreamPinFor(config: CentralGaugeConfig, provider: string, apiModelId: string): string | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/config/openrouter-config.test.ts
import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  ConfigManager,
  upstreamPinFor,
  validateOpenRouterConfig,
} from "../../../src/config/config.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import { cleanupTempDir, createTempDir, MockEnv } from "../../utils/test-helpers.ts";

Deno.test("validateOpenRouterConfig accepts a slug map and rejects malformed entries", () => {
  assertEquals(validateOpenRouterConfig(undefined), undefined);
  const ok = { upstream: { "z-ai/glm-5.3": "fireworks", "google/gemini-3.8-flash": "google-vertex/global" } };
  assertEquals(validateOpenRouterConfig(ok), ok);

  assertThrows(() => validateOpenRouterConfig({ upstream: { "z-ai/glm-5.3": "" } }), ConfigurationError, "non-empty");
  assertThrows(() => validateOpenRouterConfig({ upstream: { "z-ai/glm-5.3": "Fireworks FP8" } }), ConfigurationError, "slug");
  assertThrows(() => validateOpenRouterConfig({ upstream: "fireworks" } as never), ConfigurationError, "object");
  assertThrows(() => validateOpenRouterConfig({ upstream: {}, other: 1 } as never), ConfigurationError, "unknown key");
});

Deno.test("upstreamPinFor answers only for openrouter models", () => {
  const cfg = { openrouter: { upstream: { "z-ai/glm-5.3": "fireworks" } } };
  assertEquals(upstreamPinFor(cfg, "openrouter", "z-ai/glm-5.3"), "fireworks");
  assertEquals(upstreamPinFor(cfg, "openrouter", "z-ai/glm-5.2"), undefined);
  assertEquals(upstreamPinFor(cfg, "anthropic", "z-ai/glm-5.3"), undefined);
  assertEquals(upstreamPinFor({}, "openrouter", "z-ai/glm-5.3"), undefined);
});

Deno.test("openrouter.upstream merges per key: project overrides home, disjoint keys survive", async () => {
  const home = await createTempDir("home");
  const cwd = await createTempDir("cwd");
  const env = new MockEnv();
  try {
    await Deno.writeTextFile(
      join(home, ".centralgauge.yml"),
      "openrouter:\n  upstream:\n    \"z-ai/glm-5.3\": fireworks\n    \"minimax/minimax-m3\": novita/fp8\n",
    );
    await Deno.writeTextFile(
      join(cwd, ".centralgauge.yml"),
      "openrouter:\n  upstream:\n    \"z-ai/glm-5.3\": novita/fp8\n",
    );
    env.set("HOME", home);
    env.set("USERPROFILE", home);
    const cfg = await ConfigManager.loadConfigFrom({ cwd, home });
    assertEquals(cfg.openrouter?.upstream, {
      "z-ai/glm-5.3": "novita/fp8",
      "minimax/minimax-m3": "novita/fp8",
    });
  } finally {
    env.restore();
    await cleanupTempDir(home);
    await cleanupTempDir(cwd);
  }
});
```

If `ConfigManager.loadConfigFrom` does not exist, use whatever entry point `tests/unit/config/loader.test.ts` uses to load from explicit directories, and adjust the test to that call.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/config/openrouter-config.test.ts`
Expected: FAIL, exports missing.

- [ ] **Step 3: Interface, validator, merge, lookup**

In `src/config/config.ts`, after the `batch?: BatchConfig;` field:

```ts
  /**
   * OpenRouter routing settings shared by sync and batch runs (spec
   * 2026-09-11 upstream lock, D2). `upstream` maps an OpenRouter
   * api_model_id (the part after `openrouter/` in a slug) to the upstream
   * slug to pin, as listed by `centralgauge models <slug> --upstreams`.
   * Top level, not under `batch`, because a pin applies to both modes.
   */
  openrouter?: OpenRouterConfig;
```

Beside `BatchConfig`:

```ts
export interface OpenRouterConfig {
  upstream?: Record<string, string>;
}

/** The slug grammar OpenRouter's endpoints listing uses for `tag`. */
export const UPSTREAM_SLUG_RE = /^[a-z0-9-]+(\/[a-z0-9.-]+)*$/;

/**
 * Validates the `openrouter` section when present: `upstream` must be an
 * object of api_model_id to non-empty slug, slugs must match
 * {@link UPSTREAM_SLUG_RE}, and no other key is allowed under `openrouter`.
 * Returns `config` unchanged. Throws `ConfigurationError` on a bad value.
 */
export function validateOpenRouterConfig(
  config: OpenRouterConfig | undefined,
): OpenRouterConfig | undefined {
  if (config === undefined) return undefined;
  for (const key of Object.keys(config)) {
    if (key !== "upstream") {
      throw new ConfigurationError(`openrouter: unknown key "${key}" (only "upstream" is allowed)`);
    }
  }
  const up = config.upstream;
  if (up === undefined) return config;
  if (!up || typeof up !== "object" || Array.isArray(up)) {
    throw new ConfigurationError(`openrouter.upstream must be an object of api_model_id to upstream slug`);
  }
  for (const [model, slug] of Object.entries(up)) {
    if (typeof slug !== "string" || slug.trim() === "") {
      throw new ConfigurationError(`openrouter.upstream["${model}"] must be a non-empty upstream slug`);
    }
    if (!UPSTREAM_SLUG_RE.test(slug)) {
      throw new ConfigurationError(
        `openrouter.upstream["${model}"] is not an upstream slug: got ${JSON.stringify(slug)}, expected e.g. "fireworks" or "novita/fp8"`,
      );
    }
  }
  return config;
}

/** The configured upstream pin for an OpenRouter model, or undefined. Never answers for another provider. */
export function upstreamPinFor(
  config: Pick<CentralGaugeConfig, "openrouter">,
  provider: string,
  apiModelId: string,
): string | undefined {
  if (provider !== "openrouter") return undefined;
  return config.openrouter?.upstream?.[apiModelId];
}
```

In `loadConfig`, after the `validateBatchConfig` block:

```ts
    const validatedOpenRouter = validateOpenRouterConfig(config.openrouter);
    if (validatedOpenRouter !== undefined) {
      config.openrouter = validatedOpenRouter;
    }
```

In `mergeConfigs`, after the `override.batch` block:

```ts
    if (override.openrouter) {
      // Per-key replacement, the same shallow semantics the rest of the
      // config uses: a project pin for one model replaces the home pin for
      // that model and leaves every other model's pin alone.
      result.openrouter = {
        ...result.openrouter,
        ...override.openrouter,
        upstream: {
          ...result.openrouter?.upstream,
          ...override.openrouter.upstream,
        },
      };
    }
```

Add the section to the commented examples in `.centralgauge.yml` next to the `batch:` example:

```yaml
# OpenRouter upstream pins (sync and batch). Keyed by the api_model_id after
# "openrouter/"; the value is a slug from `centralgauge models <slug> --upstreams`.
# openrouter:
#   upstream:
#     "z-ai/glm-5.3": fireworks
#     "google/gemini-3.8-flash": google-vertex/global
```

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/config/openrouter-config.test.ts tests/unit/config/ && deno check src/config/config.ts && deno lint src/config && deno fmt src/config/config.ts tests/unit/config/openrouter-config.test.ts`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/config.ts .centralgauge.yml tests/unit/config/openrouter-config.test.ts
git commit -m "feat(config): openrouter.upstream pin map with a manual validator and per-key merge

Top level rather than under batch because a pin applies to sync and batch
alike. The validator rejects empty values, non-slug strings and unknown
keys; the merge replaces per model so a project pin overrides a home pin
without discarding the others.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 7: Pin resolution and preflight

**Files:**
- Create: `src/llm/upstream-pin.ts`
- Test: `tests/unit/llm/upstream-pin.test.ts`

**Interfaces:**
- Consumes: `upstreamPinFor` (Task 6).
- Produces:
  ```ts
  export interface UpstreamEndpoint {
    slug: string;               // endpoints `tag`
    providerName: string;       // endpoints `provider_name`, what responses echo
    quantization: string | null;
    contextLength: number | null;
    maxCompletionTokens: number | null;
    outputPerMtoken: number | null;
    status: number | null;
  }
  export interface ResolvedUpstreamPin {
    upstreamPin: string;
    providerName: string;
    quantization: string | null;
    preflight: "passed" | "skipped";
  }
  export interface UpstreamPinDeps {
    fetchFn?: typeof fetch;
    apiKey: string;
    sleep?: (ms: number) => Promise<void>;
  }
  export async function fetchUpstreams(apiModelId: string, deps: UpstreamPinDeps): Promise<UpstreamEndpoint[]>;
  export async function resolveUpstreamPin(input: {
    apiModelId: string;
    pin: string;
    maxTokens: number;          // the run's output cap
    longestPromptTokens: number;// best estimate of the longest rendered prompt
    skipPreflight: boolean;
  }, deps: UpstreamPinDeps): Promise<ResolvedUpstreamPin>;
  export class UpstreamPinError extends CentralGaugeError { code: "UPSTREAM_PIN_UNKNOWN" | "UPSTREAM_PIN_CAPABILITY" | "UPSTREAM_PIN_UNAVAILABLE" | "UPSTREAM_PIN_MISMATCH" }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/llm/upstream-pin.test.ts
import { assertEquals, assertRejects } from "@std/assert";
import {
  fetchUpstreams,
  resolveUpstreamPin,
  UpstreamPinError,
} from "../../../src/llm/upstream-pin.ts";

const LISTING = {
  data: {
    endpoints: [
      { tag: "novita/fp8", provider_name: "Novita", quantization: "fp8", context_length: 1048576, max_completion_tokens: 943718, pricing: { completion: "0.0000022" }, status: 0 },
      { tag: "fireworks", provider_name: "Fireworks", quantization: null, context_length: 1048576, max_completion_tokens: 8192, pricing: { completion: "0.0000044" }, status: 0 },
    ],
  },
};

function fakeFetch(plan: Array<{ status: number; body: unknown }>): { fetchFn: typeof fetch; calls: Array<{ url: string; body?: unknown }> } {
  const calls: Array<{ url: string; body?: unknown }> = [];
  let i = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const step = plan[Math.min(i++, plan.length - 1)]!;
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("fetchUpstreams maps the endpoints listing", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const eps = await fetchUpstreams("z-ai/glm-5.3", { fetchFn, apiKey: "k" });
  assertEquals(eps[0], {
    slug: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    contextLength: 1048576,
    maxCompletionTokens: 943718,
    outputPerMtoken: 2.2,
    status: 0,
  });
});

Deno.test("resolveUpstreamPin fails on an unknown slug with the listing named", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const err = await assertRejects(
    () => resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "together", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: true }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
    "novita/fp8",
  );
  assertEquals(err.code, "UPSTREAM_PIN_UNKNOWN");
});

Deno.test("resolveUpstreamPin fails when the endpoint cannot hold the run's output cap", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const err = await assertRejects(
    () => resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "fireworks", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: true }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
    "max_completion_tokens 8192",
  );
  assertEquals(err.code, "UPSTREAM_PIN_CAPABILITY");
});

Deno.test("resolveUpstreamPin preflights with a 32-token pinned request and requires the resolved name back", async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 200, body: LISTING },
    { status: 200, body: { provider: "Novita", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } },
  ]);
  const r = await resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "novita/fp8", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: false }, { fetchFn, apiKey: "k" });
  assertEquals(r, { upstreamPin: "novita/fp8", providerName: "Novita", quantization: "fp8", preflight: "passed" });
  const probe = calls[1]!.body as Record<string, unknown>;
  assertEquals(probe["max_tokens"], 32);
  assertEquals(probe["provider"], { order: ["novita/fp8"], allow_fallbacks: false });
});

Deno.test("resolveUpstreamPin retries a 429 three times then fails as unavailable", async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 200, body: LISTING },
    { status: 429, body: { error: { message: "rate-limited", metadata: { provider_name: "Novita" } } } },
  ]);
  const err = await assertRejects(
    () => resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "novita/fp8", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: false }, { fetchFn, apiKey: "k", sleep: () => Promise.resolve() }),
    UpstreamPinError,
    "rate-limited",
  );
  assertEquals(err.code, "UPSTREAM_PIN_UNAVAILABLE");
  assertEquals(calls.length, 1 + 4); // listing + first try + three retries
});

Deno.test("resolveUpstreamPin fails as mismatch when the probe is served by a different name", async () => {
  const { fetchFn } = fakeFetch([
    { status: 200, body: LISTING },
    { status: 200, body: { provider: "Together", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } },
  ]);
  const err = await assertRejects(
    () => resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "novita/fp8", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: false }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
  );
  assertEquals(err.code, "UPSTREAM_PIN_MISMATCH");
});

Deno.test("resolveUpstreamPin records a skipped preflight", async () => {
  const { fetchFn, calls } = fakeFetch([{ status: 200, body: LISTING }]);
  const r = await resolveUpstreamPin({ apiModelId: "z-ai/glm-5.3", pin: "novita/fp8", maxTokens: 64000, longestPromptTokens: 4000, skipPreflight: true }, { fetchFn, apiKey: "k" });
  assertEquals(r.preflight, "skipped");
  assertEquals(calls.length, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/upstream-pin.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/llm/upstream-pin.ts
//
// Resolve and preflight an OpenRouter upstream pin (spec 2026-09-11 upstream
// lock, D2). The pin is the `tag` from the endpoints listing; OpenRouter's
// `provider.order` accepts exactly that string and, with fallbacks off,
// confines routing to it. Responses echo the upstream's display name, not
// the tag, so the resolved `providerName` is what verification compares.
import { CentralGaugeError } from "../errors.ts";
import { extractUpstreamIdentity } from "./mappers/openrouter.ts";

export interface UpstreamEndpoint {
  slug: string;
  providerName: string;
  quantization: string | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  outputPerMtoken: number | null;
  status: number | null;
}

export interface ResolvedUpstreamPin {
  upstreamPin: string;
  providerName: string;
  quantization: string | null;
  preflight: "passed" | "skipped";
}

export interface UpstreamPinDeps {
  fetchFn?: typeof fetch;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
}

export type UpstreamPinErrorCode =
  | "UPSTREAM_PIN_UNKNOWN"
  | "UPSTREAM_PIN_CAPABILITY"
  | "UPSTREAM_PIN_UNAVAILABLE"
  | "UPSTREAM_PIN_MISMATCH";

export class UpstreamPinError extends CentralGaugeError {
  override readonly code: UpstreamPinErrorCode;
  constructor(message: string, code: UpstreamPinErrorCode, context?: Record<string, unknown>) {
    super(message, code, context);
    this.code = code;
    this.name = "UpstreamPinError";
  }
}

const BASE = "https://openrouter.ai/api/v1";
/** Above OpenRouter's documented 16-token minimum on some upstreams. */
const PREFLIGHT_MAX_TOKENS = 32;
const PREFLIGHT_RETRIES = 3;
const PREFLIGHT_BACKOFF_MS = [5_000, 15_000, 40_000];

export async function fetchUpstreams(
  apiModelId: string,
  deps: UpstreamPinDeps,
): Promise<UpstreamEndpoint[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const r = await fetchFn(`${BASE}/models/${apiModelId}/endpoints`, {
    headers: { Authorization: `Bearer ${deps.apiKey}` },
  });
  if (!r.ok) {
    throw new UpstreamPinError(
      `endpoints listing for ${apiModelId} failed: HTTP ${r.status}`,
      "UPSTREAM_PIN_UNKNOWN",
      { apiModelId, status: r.status },
    );
  }
  const j = await r.json() as {
    data?: {
      endpoints?: Array<{
        tag?: unknown;
        provider_name?: unknown;
        quantization?: unknown;
        context_length?: unknown;
        max_completion_tokens?: unknown;
        pricing?: { completion?: unknown };
        status?: unknown;
      }>;
    };
  };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return (j.data?.endpoints ?? [])
    .filter((e) => typeof e.tag === "string" && typeof e.provider_name === "string")
    .map((e) => ({
      slug: e.tag as string,
      providerName: e.provider_name as string,
      quantization: typeof e.quantization === "string" && e.quantization !== "unknown"
        ? e.quantization
        : null,
      contextLength: num(e.context_length),
      maxCompletionTokens: num(e.max_completion_tokens),
      outputPerMtoken: typeof e.pricing?.completion === "string"
        ? Math.round(Number(e.pricing.completion) * 1e6 * 1e6) / 1e6
        : null,
      status: num(e.status),
    }));
}

export async function resolveUpstreamPin(
  input: {
    apiModelId: string;
    pin: string;
    maxTokens: number;
    longestPromptTokens: number;
    skipPreflight: boolean;
  },
  deps: UpstreamPinDeps,
): Promise<ResolvedUpstreamPin> {
  const endpoints = await fetchUpstreams(input.apiModelId, deps);
  const ep = endpoints.find((e) => e.slug === input.pin);
  if (!ep) {
    const listing = endpoints.map((e) => `${e.slug} (${e.providerName}, ${e.quantization ?? "?"})`).join(", ");
    throw new UpstreamPinError(
      `upstream pin "${input.pin}" is not an endpoint of ${input.apiModelId}. Available: ${listing}`,
      "UPSTREAM_PIN_UNKNOWN",
      { apiModelId: input.apiModelId, pin: input.pin, available: endpoints.map((e) => e.slug) },
    );
  }
  if (ep.maxCompletionTokens !== null && ep.maxCompletionTokens < input.maxTokens) {
    throw new UpstreamPinError(
      `upstream ${ep.slug} allows max_completion_tokens ${ep.maxCompletionTokens}, below the run's cap of ${input.maxTokens}`,
      "UPSTREAM_PIN_CAPABILITY",
      { pin: ep.slug, maxCompletionTokens: ep.maxCompletionTokens, maxTokens: input.maxTokens },
    );
  }
  const need = input.longestPromptTokens + input.maxTokens;
  if (ep.contextLength !== null && ep.contextLength < need) {
    throw new UpstreamPinError(
      `upstream ${ep.slug} context_length ${ep.contextLength} is below prompt plus cap (${need})`,
      "UPSTREAM_PIN_CAPABILITY",
      { pin: ep.slug, contextLength: ep.contextLength, need },
    );
  }

  const base = { upstreamPin: ep.slug, providerName: ep.providerName, quantization: ep.quantization };
  if (input.skipPreflight) return { ...base, preflight: "skipped" };

  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastMessage = "";
  for (let attempt = 0; attempt <= PREFLIGHT_RETRIES; attempt++) {
    const r = await fetchFn(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model: input.apiModelId,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: PREFLIGHT_MAX_TOKENS,
        provider: { order: [ep.slug], allow_fallbacks: false },
      }),
    });
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } };
    if (r.status === 200) {
      const id = extractUpstreamIdentity(body);
      const served = id === undefined ? undefined : "conflict" in id ? id.providerField : id.servedUpstream;
      if (served !== ep.providerName) {
        throw new UpstreamPinError(
          `preflight for ${ep.slug} was served by ${served ?? "an unidentified upstream"}, expected ${ep.providerName}`,
          "UPSTREAM_PIN_MISMATCH",
          { pin: ep.slug, expected: ep.providerName, served: served ?? null },
        );
      }
      return { ...base, preflight: "passed" };
    }
    if (r.status === 404) {
      throw new UpstreamPinError(
        `preflight for ${ep.slug}: OpenRouter found no endpoint (${body.error?.message ?? "404"})`,
        "UPSTREAM_PIN_UNKNOWN",
        { pin: ep.slug, status: 404 },
      );
    }
    lastMessage = body.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 429 || r.status >= 500) {
      if (attempt < PREFLIGHT_RETRIES) await sleep(PREFLIGHT_BACKOFF_MS[attempt]!);
      continue;
    }
    break;
  }
  throw new UpstreamPinError(
    `preflight for ${ep.slug} did not succeed: ${lastMessage}. The pinned upstream is unavailable right now; retry later or pass --skip-upstream-preflight for a known transient outage.`,
    "UPSTREAM_PIN_UNAVAILABLE",
    { pin: ep.slug, lastMessage },
  );
}
```

Check `src/errors.ts` for `CentralGaugeError`'s constructor signature `(message, code, context?)` and match it; if `code` is declared `readonly code: string` there, drop the `override` narrowing and keep a separate `readonly pinCode` field with the same value, adjusting the tests to read that.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/llm/upstream-pin.test.ts && deno check src/llm/upstream-pin.ts && deno lint src/llm && deno fmt src/llm/upstream-pin.ts tests/unit/llm/upstream-pin.test.ts`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/llm/upstream-pin.ts tests/unit/llm/upstream-pin.test.ts
git commit -m "feat(openrouter): resolve an upstream pin from the endpoints listing and preflight it

Resolves the pinned slug to the display name responses will echo and the
declared quantization, checks the endpoint can hold the run's output cap
and prompt, then sends one 32-token pinned request. A 404 is a bad slug, a
429 or 5xx retries three times with backoff before failing as unavailable,
and a different display name back is a mismatch. All fail before any real
spend; an operator can skip the probe for a known transient outage.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 8: Verification classification, attempt fields, sync threading and terminal disposition

**Files:**
- Create: `src/llm/upstream-verification.ts`
- Modify: `src/tasks/interfaces.ts:352-370` (ExecutionAttempt), `:205-212` and `:530-540` (both context interfaces)
- Modify: `src/parallel/types.ts:154-190` (LLMWorkResult)
- Modify: `src/parallel/shared/attempt-context.ts:33-48`, `src/parallel/llm-work-pool.ts:420-435`
- Modify: `src/parallel/shared/evaluate-attempt.ts:159-185`, `failed-attempt.ts:22-66`, `infra-attempt.ts:55-80`
- Modify: `src/parallel/orchestrator.ts:884-905`
- Test: `tests/unit/llm/upstream-verification.test.ts`, `tests/unit/parallel/shared/evaluate-attempt.test.ts` (extend), `tests/unit/parallel/shared/infra-attempt.test.ts` (extend)

**Interfaces:**
- Consumes: `LLMResponse` fields from Task 3; `LLMConfig.upstreamPin` from Task 4.
- Produces:
  ```ts
  // src/llm/upstream-verification.ts
  export type UpstreamVerification =
    | "not_applicable" | "unpinned" | "verified" | "mismatch" | "unverified" | "not_served";
  export interface UpstreamFields {
    requestedUpstream: string | null;
    servedUpstream: string | null;
    servedUpstreamModel: string | null;
    upstreamIdentitySource: UpstreamIdentitySource | null;
    upstreamVerification: UpstreamVerification;
  }
  export function classifyUpstream(input: {
    provider: string;
    requestedUpstream: string | null;        // the pinned slug
    expectedProviderName: string | null;     // resolved display name for the pin
    response: Pick<LLMResponse, "servedUpstream" | "servedUpstreamModel" | "upstreamIdentitySource" | "upstreamIdentityConflict"> | undefined;
  }): UpstreamFields;
  export function isUpstreamCompromised(v: UpstreamVerification): boolean;   // mismatch or unverified
  // ExecutionAttempt gains the five fields of UpstreamFields (same names, camelCase) plus
  //   terminal?: "upstream_compromised" | undefined;
  // TaskExecutionContext (both interfaces) gains
  //   upstreamPin?: string | undefined;
  //   upstreamProviderName?: string | undefined;
  // LLMWorkResult gains
  //   requestedUpstream?: string | undefined;
  //   upstreamProviderName?: string | undefined;
  ```

- [ ] **Step 1: Write the failing classification tests**

```ts
// tests/unit/llm/upstream-verification.test.ts
import { assertEquals } from "@std/assert";
import { classifyUpstream, isUpstreamCompromised } from "../../../src/llm/upstream-verification.ts";

const served = (name: string, extra: Record<string, unknown> = {}) => ({
  servedUpstream: name,
  servedUpstreamModel: undefined,
  upstreamIdentitySource: "provider_field" as const,
  upstreamIdentityConflict: undefined,
  ...extra,
});

Deno.test("classifyUpstream: not_applicable for any provider but openrouter", () => {
  const f = classifyUpstream({ provider: "anthropic", requestedUpstream: null, expectedProviderName: null, response: served("x") });
  assertEquals(f, {
    requestedUpstream: null, servedUpstream: null, servedUpstreamModel: null,
    upstreamIdentitySource: null, upstreamVerification: "not_applicable",
  });
});

Deno.test("classifyUpstream: unpinned records identity without verifying", () => {
  const f = classifyUpstream({ provider: "openrouter", requestedUpstream: null, expectedProviderName: null, response: served("Google", { servedUpstreamModel: "g-1", upstreamIdentitySource: "both" }) });
  assertEquals(f.upstreamVerification, "unpinned");
  assertEquals(f.servedUpstream, "Google");
  assertEquals(f.servedUpstreamModel, "g-1");
  assertEquals(f.upstreamIdentitySource, "both");
  assertEquals(f.requestedUpstream, null);
});

Deno.test("classifyUpstream: pinned outcomes", () => {
  const base = { provider: "openrouter", requestedUpstream: "novita/fp8", expectedProviderName: "Novita" };
  assertEquals(classifyUpstream({ ...base, response: served("Novita") }).upstreamVerification, "verified");
  assertEquals(classifyUpstream({ ...base, response: served("Together") }).upstreamVerification, "mismatch");
  assertEquals(classifyUpstream({ ...base, response: served("Novita", { upstreamIdentityConflict: true }) }).upstreamVerification, "mismatch");
  assertEquals(classifyUpstream({ ...base, response: { servedUpstream: undefined, servedUpstreamModel: undefined, upstreamIdentitySource: undefined, upstreamIdentityConflict: undefined } }).upstreamVerification, "unverified");
  const ns = classifyUpstream({ ...base, response: undefined });
  assertEquals(ns.upstreamVerification, "not_served");
  assertEquals(ns.requestedUpstream, "novita/fp8");
  assertEquals(ns.servedUpstream, null);
});

Deno.test("isUpstreamCompromised is true only for mismatch and unverified", () => {
  assertEquals(isUpstreamCompromised("mismatch"), true);
  assertEquals(isUpstreamCompromised("unverified"), true);
  for (const v of ["not_applicable", "unpinned", "verified", "not_served"] as const) {
    assertEquals(isUpstreamCompromised(v), false);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/upstream-verification.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the classifier**

```ts
// src/llm/upstream-verification.ts
//
// Per-attempt verification of the OpenRouter upstream (spec 2026-09-11
// upstream lock, D1 and D3). Pure: the caller supplies what was requested,
// what the resolved pin should echo, and what the response said.
import type { LLMResponse, UpstreamIdentitySource } from "./types.ts";

export type UpstreamVerification =
  | "not_applicable"
  | "unpinned"
  | "verified"
  | "mismatch"
  | "unverified"
  | "not_served";

export interface UpstreamFields {
  requestedUpstream: string | null;
  servedUpstream: string | null;
  servedUpstreamModel: string | null;
  upstreamIdentitySource: UpstreamIdentitySource | null;
  upstreamVerification: UpstreamVerification;
}

type ResponseIdentity = Pick<
  LLMResponse,
  "servedUpstream" | "servedUpstreamModel" | "upstreamIdentitySource" | "upstreamIdentityConflict"
>;

export function classifyUpstream(input: {
  provider: string;
  requestedUpstream: string | null;
  expectedProviderName: string | null;
  response: ResponseIdentity | undefined;
}): UpstreamFields {
  if (input.provider !== "openrouter") {
    return {
      requestedUpstream: null,
      servedUpstream: null,
      servedUpstreamModel: null,
      upstreamIdentitySource: null,
      upstreamVerification: "not_applicable",
    };
  }
  const r = input.response;
  const served = r?.servedUpstream ?? null;
  const base = {
    requestedUpstream: input.requestedUpstream,
    servedUpstream: served,
    servedUpstreamModel: r?.servedUpstreamModel ?? null,
    upstreamIdentitySource: r?.upstreamIdentitySource ?? null,
  };
  if (input.requestedUpstream === null) {
    return { ...base, upstreamVerification: "unpinned" };
  }
  if (r === undefined) return { ...base, upstreamVerification: "not_served" };
  if (served === null) return { ...base, upstreamVerification: "unverified" };
  if (r.upstreamIdentityConflict === true) {
    return { ...base, upstreamVerification: "mismatch" };
  }
  return {
    ...base,
    upstreamVerification: served === input.expectedProviderName ? "verified" : "mismatch",
  };
}

/** A pinned run cannot be shown to have held its pin: excluded atomically at ingest (spec D3). */
export function isUpstreamCompromised(v: UpstreamVerification): boolean {
  return v === "mismatch" || v === "unverified";
}
```

- [ ] **Step 4: Fields on the attempt, the contexts and the work result**

In `src/tasks/interfaces.ts`, inside `ExecutionAttempt` after `providerRequestId`:

```ts
  /**
   * OpenRouter upstream lock (spec 2026-09-11). `requestedUpstream` is the
   * pinned slug sent in `provider.order` (null when unpinned or not
   * OpenRouter); `servedUpstream` the display name observed on the response;
   * `upstreamVerification` the per-attempt verdict. See
   * `src/llm/upstream-verification.ts` for the values and their meaning.
   */
  requestedUpstream?: string | null | undefined;
  servedUpstream?: string | null | undefined;
  servedUpstreamModel?: string | null | undefined;
  upstreamIdentitySource?: "provider_field" | "router_metadata" | "both" | null | undefined;
  upstreamVerification?:
    | "not_applicable" | "unpinned" | "verified" | "mismatch" | "unverified" | "not_served"
    | undefined;
  /**
   * Set when this attempt ends the task early for a non-model reason. The
   * sync executor and the batch wave-2 predicate both stop at it.
   */
  terminal?: "upstream_compromised" | undefined;
```

In both context interfaces (the resolved one near line 209 and the request one near line 535), after `variantConfig`:

```ts
  /** OpenRouter upstream pin resolved for this variant, or undefined. Spec 2026-09-11 D2. */
  upstreamPin?: string | undefined;
  /** The display name the pinned upstream echoes; what verification compares against. */
  upstreamProviderName?: string | undefined;
```

In `src/tasks/transformer.ts` `createExecutionContext`, beside `variantConfig: request.variantConfig,` add `upstreamPin: request.upstreamPin, upstreamProviderName: request.upstreamProviderName,`.

In `src/parallel/types.ts` `LLMWorkResult`, after `providerErrorCode`:

```ts
  /** The upstream pin the request was sent with (OpenRouter only). Present on success AND failure so a 429/404 still records what was asked for. */
  requestedUpstream?: string;
  /** The display name the pin resolves to, for verification. */
  upstreamProviderName?: string;
```

- [ ] **Step 5: Thread the pin through the sync path**

`src/parallel/shared/attempt-context.ts`: the `buildAttemptContext` signature gains an optional third field on `options` read as `options.upstreamPins?.get(variant.variantId)`; simpler and explicit: add to `ParallelBenchmarkOptions` (in `src/parallel/orchestrator.ts`):

```ts
  /** Resolved OpenRouter upstream pins per variantId (spec 2026-09-11 D2). Absent when no model is pinned. */
  upstreamPins?: ReadonlyMap<string, { upstreamPin: string; providerName: string }>;
```

and in `attempt-context.ts` pass through:

```ts
    variantConfig: variant.hasVariant ? variant.config : undefined,
    ...(options.upstreamPins?.get(variant.variantId)
      ? {
        upstreamPin: options.upstreamPins.get(variant.variantId)!.upstreamPin,
        upstreamProviderName: options.upstreamPins.get(variant.variantId)!.providerName,
      }
      : {}),
```

`src/parallel/llm-work-pool.ts` `getAdapter`: add `...(item.context.upstreamPin !== undefined && { upstreamPin: item.context.upstreamPin }),` to the `LLMAdapterRegistry.create` config. Where the pool builds its `LLMWorkResult` (both the success and the failure branches; find them with `grep -n "workItemId: item.id" src/parallel/llm-work-pool.ts`), add `...(item.context.upstreamPin !== undefined ? { requestedUpstream: item.context.upstreamPin, upstreamProviderName: item.context.upstreamProviderName } : {}),`.

- [ ] **Step 6: Populate the fields in the three attempt units**

Add a shared helper at the top of `src/parallel/shared/evaluate-attempt.ts` and export it for the other two:

```ts
import { classifyUpstream } from "../../llm/upstream-verification.ts";
import type { LLMWorkResult } from "../types.ts";

/** The five upstream fields for an attempt built from `llmResult` (spec D1). */
export function upstreamFieldsFor(
  provider: string,
  llmResult: LLMWorkResult | undefined,
): Pick<ExecutionAttempt, "requestedUpstream" | "servedUpstream" | "servedUpstreamModel" | "upstreamIdentitySource" | "upstreamVerification"> {
  const f = classifyUpstream({
    provider,
    requestedUpstream: llmResult?.requestedUpstream ?? null,
    expectedProviderName: llmResult?.upstreamProviderName ?? null,
    response: llmResult?.llmResponse,
  });
  return {
    requestedUpstream: f.requestedUpstream,
    servedUpstream: f.servedUpstream,
    servedUpstreamModel: f.servedUpstreamModel,
    upstreamIdentitySource: f.upstreamIdentitySource,
    upstreamVerification: f.upstreamVerification,
  };
}
```

`evaluateAttempt` already receives `context`; spread `...upstreamFieldsFor(context.llmProvider, llmResult),` into the attempt object after `providerFinishReason`. `createFailedAttempt(attemptNumber, llmResult, now?)` gains a fourth optional parameter `provider = "unknown"` and spreads `...upstreamFieldsFor(provider, llmResult)`; update its callers (`orchestrator.ts` `createFailedAttempt`, `src/batch/evaluate.ts`) to pass the provider. `synthesizeInfraAttempt` takes `input.request`/`input.llmResponse`; add `provider?: string` and `requestedUpstream?: string` / `upstreamProviderName?: string` to its input and spread `...upstreamFieldsFor(input.provider ?? "unknown", { workItemId: "", success: false, duration: 0, readyForCompile: false, llmResponse: input.llmResponse, requestedUpstream: input.requestedUpstream, upstreamProviderName: input.upstreamProviderName })`.

- [ ] **Step 7: Terminal disposition in the sync executor**

In `src/parallel/orchestrator.ts` `processTaskForVariant`, after `attempts.push(attempt);` (the compiled path) and after the failed-attempt push, add:

```ts
      // Upstream lock (spec D3): a pinned attempt whose upstream cannot be
      // shown to have held ends the task here. No second attempt; the run
      // is ingested already excluded by ingest-assembly.
      const last = attempts[attempts.length - 1]!;
      if (
        last.upstreamVerification === "mismatch" ||
        last.upstreamVerification === "unverified"
      ) {
        last.terminal = "upstream_compromised";
        break;
      }
```

- [ ] **Step 8: Extend the attempt-unit tests**

Append to `tests/unit/parallel/shared/evaluate-attempt.test.ts` (mirror its existing fixture construction):

```ts
Deno.test("evaluateAttempt stamps the upstream fields from the work result", () => {
  const llmResult = makeLlmResult({
    requestedUpstream: "novita/fp8",
    upstreamProviderName: "Novita",
    llmResponse: { ...okResponse, servedUpstream: "Novita", upstreamIdentitySource: "provider_field" },
  });
  const attempt = evaluateAttempt({ attemptNumber: 1, llmResult, compileResult: okCompile, context: { ...ctx, llmProvider: "openrouter" } });
  assertEquals(attempt.requestedUpstream, "novita/fp8");
  assertEquals(attempt.servedUpstream, "Novita");
  assertEquals(attempt.upstreamVerification, "verified");

  const nonOr = evaluateAttempt({ attemptNumber: 1, llmResult, compileResult: okCompile, context: { ...ctx, llmProvider: "anthropic" } });
  assertEquals(nonOr.upstreamVerification, "not_applicable");
  assertEquals(nonOr.requestedUpstream, null);
});
```

Append to `tests/unit/parallel/shared/infra-attempt.test.ts`:

```ts
Deno.test("synthesizeInfraAttempt records the requested pin with not_served when no response exists", () => {
  const attempt = synthesizeInfraAttempt({
    ...baseInput,
    provider: "openrouter",
    requestedUpstream: "novita/fp8",
    upstreamProviderName: "Novita",
    llmResponse: undefined,
  });
  assertEquals(attempt.requestedUpstream, "novita/fp8");
  assertEquals(attempt.upstreamVerification, "not_served");
});
```

Use the fixture names those files already define (`makeLlmResult`, `okResponse`, `okCompile`, `ctx`, `baseInput` are placeholders for whatever the files call them; read the file and reuse its helpers rather than inventing new ones).

- [ ] **Step 9: Run tests and checks**

Run: `deno test --allow-all tests/unit/llm/upstream-verification.test.ts tests/unit/parallel/shared/ tests/unit/parallel/ && deno check src/llm/upstream-verification.ts src/tasks/interfaces.ts src/tasks/transformer.ts src/parallel/types.ts src/parallel/shared/attempt-context.ts src/parallel/llm-work-pool.ts src/parallel/shared/evaluate-attempt.ts src/parallel/shared/failed-attempt.ts src/parallel/shared/infra-attempt.ts src/parallel/orchestrator.ts && deno lint src/llm src/tasks src/parallel && deno fmt <the same files and tests>`
Expected: PASS, clean. `tests/unit/parallel/` includes orchestrator tests; if any asserts a third attempt after a failed LLM call, it is unaffected because the break only fires on a compromised verification.

- [ ] **Step 10: Commit**

```bash
git add src/llm/upstream-verification.ts src/tasks/interfaces.ts src/tasks/transformer.ts src/parallel/types.ts src/parallel/orchestrator.ts src/parallel/shared/attempt-context.ts src/parallel/llm-work-pool.ts src/parallel/shared/evaluate-attempt.ts src/parallel/shared/failed-attempt.ts src/parallel/shared/infra-attempt.ts tests/unit/llm/upstream-verification.test.ts tests/unit/parallel/shared/evaluate-attempt.test.ts tests/unit/parallel/shared/infra-attempt.test.ts
git commit -m "feat(attempt): upstream verification per attempt; sync executor stops on a compromised pin

A pure classifier turns the pin, its resolved display name and the
response identity into one of six verification states. The requested pin
rides on the work result so a 404 or 429 still records what was asked for
as not_served. The sync executor breaks after a mismatch or unverified
attempt instead of retrying.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 9: Batch freeze, wiring, evaluate, wave-2 predicate, harness inputs

**Files:**
- Modify: `src/parallel/shared/prompt-inputs.ts:36-40` (FrozenPromptInputs)
- Modify: `src/batch/submit.ts:98-105` (SubmitDeps), `:318-365` (extras/inputs), the run loop around `:370-420`
- Modify: `src/batch/provider-wiring.ts:100-104` (wireProvider signature), `:186-200` (openrouter adapter config)
- Modify: `cli/commands/bench-batch-command.ts:252-330` (buildAdvanceDeps), `:450-475` (submit deps)
- Modify: `src/batch/evaluate.ts:117-150` and `:190-215` and `:265-285` (requested pin on work results)
- Modify: `src/batch/transitions.ts:180-186`
- Modify: `src/utils/harness-fingerprint.ts:29-37`
- Test: `tests/unit/batch/transitions.test.ts` (extend), `tests/unit/batch/submit.test.ts` (extend), `tests/unit/batch/provider-wiring.test.ts` (extend), `tests/unit/utils/harness-fingerprint.test.ts` (extend), `tests/unit/batch/fixture-pre-upstream.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveUpstreamPin`, `ResolvedUpstreamPin` (Task 7); `upstreamPinFor` (Task 6); `LLMConfig.upstreamPin` (Task 4); `isUpstreamCompromised` (Task 8).
- Produces:
  ```ts
  // FrozenPromptInputs gains
  //   routing?: { upstreamPin: string; providerName: string; quantization: string | null; preflight: "passed" | "skipped" };
  // wireProvider(name, model, apiKey, routing?: FrozenPromptInputs["routing"])
  // SubmitDeps gains
  //   resolveUpstream: (apiModelId: string, pin: string, maxTokens: number) => Promise<ResolvedUpstreamPin>;
  //   skipUpstreamPreflight: boolean;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/batch/transitions.test.ts`, using its `minimalState`, `task`, `attempt` helpers:

```ts
Deno.test("nextStep does not mint wave 2 for a compromised attempt", () => {
  const compromised = { ...attempt(false), upstreamVerification: "mismatch" as const, terminal: "upstream_compromised" as const };
  const state = minimalState({
    phase: "attempt-1-collected",
    tasks: { A: task("evaluated"), B: task("evaluated") },
  });
  const step = nextStep(
    state,
    false,
    new Map<string, ExecutionAttempt>([["A", compromised], ["B", attempt(false)]]),
    2,
  );
  assertEquals(step, { kind: "submit-wave-2", taskIds: ["B"] });
});
```

Adjust the expected `submit-wave-2` shape to whatever the file's existing wave-2 assertion returns (read it; the point is that `A` is absent from the task list).

Append to `tests/unit/batch/provider-wiring.test.ts`:

```ts
Deno.test("wireProvider threads a frozen routing pin into the openrouter request body", () => {
  const routing = { upstreamPin: "novita/fp8", providerName: "Novita", quantization: "fp8", preflight: "passed" as const };
  const wiring = wireProvider("openrouter", { apiModelId: "z-ai/glm-5.3", variantConfig: null }, "k", routing);
  const body = wiring.buildBody({ prompt: "hi", taskId: "t", attempt: 1 } as never) as Record<string, unknown>;
  assertEquals(body["provider"], { order: ["novita/fp8"], allow_fallbacks: false });
  const unpinned = wireProvider("openrouter", { apiModelId: "z-ai/glm-5.3", variantConfig: null }, "k");
  assertEquals("provider" in (unpinned.buildBody({ prompt: "hi", taskId: "t", attempt: 1 } as never) as Record<string, unknown>), false);
});
```

Append to `tests/unit/utils/harness-fingerprint.test.ts`:

```ts
Deno.test("HARNESS_INPUTS covers the OpenRouter routing implementation", () => {
  for (const p of ["src/llm/openrouter-adapter.ts", "src/batch/provider-wiring.ts", "src/config/config.ts"]) {
    assert(HARNESS_INPUTS.includes(p as never), `${p} must be a harness input`);
  }
});
```

Append to `tests/unit/batch/submit.test.ts` (mirror its existing `submitRuns` fake-deps test):

```ts
Deno.test("submit freezes the resolved routing into prompt-inputs.json when the model is pinned", async () => {
  // Use the file's existing fake deps builder; add:
  //   resolveUpstream: () => Promise.resolve({ upstreamPin: "novita/fp8", providerName: "Novita", quantization: "fp8", preflight: "passed" }),
  //   skipUpstreamPreflight: false,
  // and a config whose openrouter.upstream maps the test model to "novita/fp8".
  // Assert after submit:
  const inputs = JSON.parse(await Deno.readTextFile(join(dir, "prompt-inputs.json")));
  assertEquals(inputs.routing, { upstreamPin: "novita/fp8", providerName: "Novita", quantization: "fp8", preflight: "passed" });
});

Deno.test("submit refuses with exit 4 when the pin cannot be resolved, before any provider call", async () => {
  // resolveUpstream rejects with UpstreamPinError("...", "UPSTREAM_PIN_UNKNOWN");
  // assert result.exit === 4, the fake provider's submit was never called, and no run directory holds a batch.
});
```

Write those two as real tests against the file's helpers; the comments describe the arrangement, not placeholders to leave in.

Append to `tests/unit/batch/fixture-pre-upstream.test.ts`:

```ts
Deno.test("buildAdvanceDeps on a pre-upstream run wires no routing", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const deps = await buildAdvanceDeps(f.dir);
    const body = deps.buildBody({ prompt: "hi", taskId: "t", attempt: 1 } as never) as Record<string, unknown>;
    assertEquals("provider" in body, false);
  } finally {
    await f.cleanup();
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/batch/transitions.test.ts tests/unit/batch/provider-wiring.test.ts tests/unit/utils/harness-fingerprint.test.ts tests/unit/batch/submit.test.ts tests/unit/batch/fixture-pre-upstream.test.ts`
Expected: FAIL on each new test.

- [ ] **Step 3: Freeze routing in `FrozenPromptInputs`**

In `src/parallel/shared/prompt-inputs.ts`:

```ts
export interface FrozenRouting {
  upstreamPin: string;
  providerName: string;
  quantization: string | null;
  preflight: "passed" | "skipped";
}

export interface FrozenPromptInputs extends RenderInputs {
  settings: CanonicalSettings;
  /**
   * OpenRouter upstream lock (spec 2026-09-11 D2), frozen at submit. Every
   * later step reads routing from HERE, never from live config, so wave 2
   * cannot route differently from wave 1. Absent on unpinned runs and on
   * every run from before this field existed.
   */
  routing?: FrozenRouting;
}
```

- [ ] **Step 4: Resolve and freeze at submit**

In `src/batch/submit.ts`, extend `SubmitDeps`:

```ts
  resolveUpstream: (
    apiModelId: string,
    pin: string,
    maxTokens: number,
  ) => Promise<import("../llm/upstream-pin.ts").ResolvedUpstreamPin>;
  skipUpstreamPreflight: boolean;
```

After `await deps.precheck();` succeeds and before `extras` is built, resolve the pin:

```ts
  const configuredPin = upstreamPinFor(await ConfigManager.loadConfig(), provider, variant.model);
  let routing: FrozenRouting | undefined;
  if (configuredPin !== undefined) {
    try {
      const resolved = await deps.resolveUpstream(variant.model, configuredPin, parallelOptions.maxTokens);
      routing = {
        upstreamPin: resolved.upstreamPin,
        providerName: resolved.providerName,
        quantization: resolved.quantization,
        preflight: resolved.preflight,
      };
    } catch (err) {
      deps.log(`${colors.red("[FAIL]")} batch submit: upstream pin: ${err instanceof Error ? err.message : String(err)}`);
      return { runIds: [], exit: 4 };
    }
  }
```

(`submit.ts` already calls `ConfigManager.loadConfig()` at its top, line 197; reuse that `config` local instead of loading twice.) Add `...(routing ? { routing } : {})` to the `inputs: FrozenPromptInputs` literal. The `upstream_pin` extras key is Task 10's job; do not add it here.

`cli/commands/bench-batch-command.ts` submit command: add `.option("--skip-upstream-preflight", "Skip the one-request upstream pin probe; for a known transient outage only. Recorded on the run.")` and, in `deps`:

```ts
        resolveUpstream: (apiModelId, pin, maxTokens) =>
          resolveUpstreamPin(
            // 16_000 is a conservative bound on the longest rendered prompt in
            // the suite; Task 15 moves it to a shared PROMPT_TOKENS_BOUND.
            { apiModelId, pin, maxTokens, longestPromptTokens: 16_000, skipPreflight: opts.skipUpstreamPreflight === true },
            { apiKey: apiKeyForBatchProvider("openrouter") ?? "" },
          ),
        skipUpstreamPreflight: opts.skipUpstreamPreflight === true,
```

(the action's options parameter is named `opts` in this command). Task 15 replaces this inline closure with the shared `submitResolver` helper; keep the constant identical until then.

- [ ] **Step 5: Wiring consumes only the frozen routing**

`src/batch/provider-wiring.ts`: `wireProvider(name, model, apiKey, routing?: FrozenRouting)`; in the openrouter case pass `...(routing ? { upstreamPin: routing.upstreamPin } : {})` into `new OpenRouterAdapter({...})`. Anthropic and OpenAI cases ignore `routing`.

`cli/commands/bench-batch-command.ts` `buildAdvanceDeps`: read `inputs.routing` and pass it as the fourth argument to all three `wireProvider(...)` calls. Never consult `config.openrouter` here; add a comment saying so and why (spec D2, frozen routing).

- [ ] **Step 6: Requested pin on batch work results**

In `src/batch/evaluate.ts`, `EvaluateDeps` gains `routing?: FrozenRouting` (buildAdvanceDeps passes `inputs.routing`). In `evaluateResponded`, both `LLMWorkResult` literals (the not-ready-for-compile one and the compile one) gain:

```ts
      ...(deps.routing
        ? { requestedUpstream: deps.routing.upstreamPin, upstreamProviderName: deps.routing.providerName }
        : {}),
```

and so does the failed one in `evaluateErrored`. Pass `deps.provider` into `createFailedAttempt(attemptNumber, llmResult, undefined, deps.provider)` at both call sites, and `provider: deps.provider, requestedUpstream: deps.routing?.upstreamPin, upstreamProviderName: deps.routing?.providerName` into `synthesizeInfraAttempt`. After `evaluateAttempt`/`createFailedAttempt` returns in the responded path, stamp the terminal marker:

```ts
    if (attempt.upstreamVerification === "mismatch" || attempt.upstreamVerification === "unverified") {
      attempt.terminal = "upstream_compromised";
    }
```

- [ ] **Step 7: Wave-2 predicate**

In `src/batch/transitions.ts`, the `eligible` filter becomes:

```ts
    return a !== undefined && !a.success && !a.infraSynthesized &&
      a.terminal !== "upstream_compromised";
```

with a comment: a compromised attempt is excluded at ingest, so a second attempt would be paid for and never counted.

- [ ] **Step 8: Harness inputs**

In `src/utils/harness-fingerprint.ts` `HARNESS_INPUTS`, append `"src/llm/openrouter-adapter.ts", "src/batch/provider-wiring.ts", "src/config/config.ts",` with a comment: these decide which upstream a request reaches, so a change to them must show as drift on an in-flight run (spec D2). Run `deno run --allow-all scripts/gold-ci.ts --check`; if it reports the harness fingerprint changed with no tracked file changed, follow the documented `--adopt-harness` step so gold-ci re-baselines.

- [ ] **Step 9: Run tests and checks**

Run: `deno test --allow-all tests/unit/batch/ tests/unit/utils/harness-fingerprint.test.ts && deno check src/parallel/shared/prompt-inputs.ts src/batch/submit.ts src/batch/provider-wiring.ts src/batch/evaluate.ts src/batch/transitions.ts cli/commands/bench-batch-command.ts src/utils/harness-fingerprint.ts && deno lint src/batch src/parallel cli src/utils && deno fmt <those files and the tests>`
Expected: PASS, clean.

- [ ] **Step 10: Commit**

```bash
git add src/parallel/shared/prompt-inputs.ts src/batch/submit.ts src/batch/provider-wiring.ts src/batch/evaluate.ts src/batch/transitions.ts cli/commands/bench-batch-command.ts src/utils/harness-fingerprint.ts tests/unit/batch/transitions.test.ts tests/unit/batch/submit.test.ts tests/unit/batch/provider-wiring.test.ts tests/unit/utils/harness-fingerprint.test.ts tests/unit/batch/fixture-pre-upstream.test.ts
git commit -m "feat(batch): resolve the upstream pin at submit, freeze it, and route every later step from the frozen value

Submit resolves and preflights the configured pin before any provider
call, refusing with exit 4 on failure, and writes the resolved routing into
prompt-inputs.json. wireProvider and buildAdvanceDeps consume only that
frozen value, so wave 2 cannot route differently from wave 1, and drift
already covers the file. Work results carry the requested pin so provider
errors record it, and a compromised attempt gets no wave 2. The routing
implementation files join the harness fingerprint.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 10: Settings extras schema 2, invocation schema 2, legacy builder

**Files:**
- Modify: `shared/settings-hash.ts:6-16` (extras), add `buildLegacyCanonicalSettings`
- Modify: `shared/fixtures/settings-hash.fixture.json` (three new cases)
- Modify: `src/ingest/capture.ts:266-290` (InvocationRecord), `:299-347` (invocationSnapshot), `:357-375` (isInvocationRecord)
- Modify: `src/batch/submit.ts:324-334` (extras), `src/batch/results.ts:284-300` (readFrozenExtras), `:376-408` (invocation from frozen)
- Modify: the sync capture site that builds extras for `invocationSnapshot` (find with `grep -rn "prompt_profile_digest:" cli/commands/bench src/parallel --include="*.ts"`; it is the sync counterpart of `submit.ts:324`)
- Test: `tests/unit/shared/settings-hash.test.ts` (extend), `site/tests/settings-hash-parity.test.ts` (fixture-driven, no edit needed), `tests/unit/ingest/capture.test.ts` (extend or create), `tests/unit/batch/results.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // shared/settings-hash.ts
  export interface CanonicalSettingsExtras {
    settings_extras_schema: 2;
    upstream_pin: string | null;
    ...existing nine keys...
  }
  export interface LegacyCanonicalSettingsExtras { ...the existing nine keys, no schema, no upstream_pin }
  export function buildLegacyCanonicalSettings(base: SettingsBase, extras: LegacyCanonicalSettingsExtras): CanonicalSettings;
  export function isLegacyExtras(v: unknown): v is LegacyCanonicalSettingsExtras;   // no settings_extras_schema key
  // src/ingest/capture.ts
  // InvocationRecord gains
  //   invocation_schema: 2;
  //   upstream_pin: string | null;
  //   upstream_resolved: { provider_name: string; quantization: string | null; preflight: "passed" | "skipped" } | null;
  // invocationSnapshot(cfg) accepts upstreamPin?: string, upstreamResolved?: {...}
  // isInvocationRecord(v) is true for schema-1 and schema-2 records; new
  export function invocationSchemaOf(v: InvocationRecord): 1 | 2;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/shared/settings-hash.test.ts`:

```ts
import {
  buildLegacyCanonicalSettings,
  isLegacyExtras,
} from "../../../shared/settings-hash.ts";

const legacyExtras = { ...extras };   // the file's existing nine-key extras object

const extras2: CanonicalSettingsExtras = {
  ...legacyExtras,
  settings_extras_schema: 2,
  upstream_pin: null,
};

Deno.test("schema-2 extras hash differently from the same legacy extras", async () => {
  const legacy = await settingsHashOf(buildLegacyCanonicalSettings({ temperature: 0, max_attempts: 2, max_tokens: 64000 }, legacyExtras));
  const v2 = await settingsHashOf(buildCanonicalSettings({ temperature: 0, max_attempts: 2, max_tokens: 64000 }, extras2));
  assert(legacy !== v2);
});

Deno.test("buildLegacyCanonicalSettings reproduces the committed batch-profile fixture hash byte for byte", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("shared/fixtures/settings-hash.fixture.json")) as {
    cases: Array<{ name: string; settings: Record<string, unknown>; hash: string }>;
  };
  const c = fixture.cases.find((x) => x.name === "batch profile")!;
  const parsed = JSON.parse(c.settings["extra_json"] as string);
  assertEquals(isLegacyExtras(parsed), true);
  const rebuilt = buildLegacyCanonicalSettings(
    { temperature: 0, max_attempts: 2, max_tokens: 64000, prompt_version: null, bc_version: null },
    parsed,
  );
  assertEquals(rebuilt.extra_json, c.settings["extra_json"]);
  assertEquals(await settingsHashOf(rebuilt), c.hash);
});

Deno.test("isLegacyExtras is false once settings_extras_schema is present", () => {
  assertEquals(isLegacyExtras(extras2), false);
  assertEquals(isLegacyExtras({ ...extras2, settings_extras_schema: 2, upstream_pin: "novita/fp8" }), false);
});
```

Add three cases to `shared/fixtures/settings-hash.fixture.json`, computing each `hash` with a one-off `deno eval` against `settingsHashOf` AFTER Step 3 and pasting the value (the parity test on both runtimes then pins it):

- `"schema-2 unpinned"`: the batch-profile settings with `extra_json` = canonical JSON of `extras2` (`settings_extras_schema: 2`, `upstream_pin: null`, plus the nine keys).
- `"schema-2 pinned"`: same, `upstream_pin: "novita/fp8"`, `provider_route: "openrouter:z-ai/glm-5.3"`, `endpoint: "/v1/chat/completions"`.
- `"schema-1 legacy unchanged"`: a copy of the existing `"batch profile"` case under a new name, asserting the legacy hash is stable across this change.

Create or extend `tests/unit/ingest/capture.test.ts`:

```ts
Deno.test("invocationSnapshot emits invocation_schema 2 with the pin and resolution", () => {
  const rec = invocationSnapshot({
    ...baseCfg,   // reuse the file's base config if present; otherwise build the minimal cfg the function requires
    provider: "openrouter",
    apiModelId: "z-ai/glm-5.3",
    upstreamPin: "novita/fp8",
    upstreamResolved: { provider_name: "Novita", quantization: "fp8", preflight: "passed" },
  });
  assertEquals(rec.invocation_schema, 2);
  assertEquals(rec.upstream_pin, "novita/fp8");
  assertEquals(rec.upstream_resolved, { provider_name: "Novita", quantization: "fp8", preflight: "passed" });
  const bare = invocationSnapshot({ ...baseCfg, provider: "anthropic", apiModelId: "claude-opus-5" });
  assertEquals(bare.upstream_pin, null);
  assertEquals(bare.upstream_resolved, null);
});

Deno.test("isInvocationRecord accepts a schema-1 record and invocationSchemaOf reports 1", () => {
  const legacy = { ...invocationSnapshot({ ...baseCfg, provider: "anthropic", apiModelId: "m" }) } as Record<string, unknown>;
  delete legacy["invocation_schema"]; delete legacy["upstream_pin"]; delete legacy["upstream_resolved"];
  assertEquals(isInvocationRecord(legacy), true);
  assertEquals(invocationSchemaOf(legacy as InvocationRecord), 1);
});
```

Append to `tests/unit/batch/results.test.ts` (reusing its finalize fixture pattern) and to `tests/unit/batch/fixture-pre-upstream.test.ts`:

```ts
Deno.test("finalizeRun on a pre-upstream run keeps the frozen settings hash and emits a schema-1 invocation", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const state = await loadState(f.dir);
    // Force a rebuild of the results file through the current finalize code.
    await Deno.remove(f.resultsFile);
    const deps = await buildAdvanceDeps(f.dir);
    await advanceRun(f.dir, deps);   // one step: finalizing -> finalized, --no-ingest via state.ingest=false set below
    const results = JSON.parse(await Deno.readTextFile(f.resultsFile)) as {
      ingest: { schema: number; invocations: Record<string, Record<string, unknown>> };
    };
    const inv = Object.values(results.ingest.invocations)[0]!;
    assertEquals("invocation_schema" in inv, false);
    assertEquals("upstream_pin" in inv, false);
    // The settings hash the run was frozen with must be what assembly would send (Task 11 asserts the send).
    assertEquals(results.ingest.schema, 5);
  } finally {
    await f.cleanup();
  }
});
```

Before calling `advanceRun`, set `state.ingest = false` and rewrite `state.json` so the test never posts. If `finalizeRun` cannot rebuild without live containers, drive `finalizeRun` directly with the fixture's own `FinalizeDeps` as `tests/unit/batch/results.test.ts` already does, and keep the assertions.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/shared/settings-hash.test.ts tests/unit/ingest/capture.test.ts tests/unit/batch/results.test.ts tests/unit/batch/fixture-pre-upstream.test.ts`
Expected: FAIL (`buildLegacyCanonicalSettings` missing, `invocation_schema` undefined).

- [ ] **Step 3: Extras schema and legacy builder**

In `shared/settings-hash.ts`:

```ts
/**
 * The extras shape from before the upstream lock (schema 1): nine keys, no
 * schema marker. Kept as a distinct type so a legacy run can be rebuilt
 * with exactly its old key set and hash. See `buildLegacyCanonicalSettings`.
 */
export interface LegacyCanonicalSettingsExtras {
  invocation_mode: InvocationMode;
  continuation: { enabled: boolean; max: number };
  empty_retry: { enabled: boolean; max: number };
  fallback_policy: FallbackPolicy;
  provider_route: string;
  endpoint: string;
  thinking_budget: number | string | null;
  prompt_profile_digest: string;
  infra_retries_per_attempt: number;
}

export interface CanonicalSettingsExtras extends LegacyCanonicalSettingsExtras {
  /** Named distinctly from IngestMeta.schema and invocation_schema. 2 = carries upstream_pin. */
  settings_extras_schema: 2;
  /** OpenRouter upstream slug the run was pinned to, or null (spec 2026-09-11 D4). */
  upstream_pin: string | null;
}

export function isLegacyExtras(v: unknown): v is LegacyCanonicalSettingsExtras {
  return !!v && typeof v === "object" &&
    !("settings_extras_schema" in (v as Record<string, unknown>)) &&
    typeof (v as Record<string, unknown>)["provider_route"] === "string";
}

/** Byte-identical to what schema-1 runs hashed. Never feed a legacy record through `buildCanonicalSettings`. */
export function buildLegacyCanonicalSettings(
  base: SettingsBase,
  extras: LegacyCanonicalSettingsExtras,
): CanonicalSettings {
  const nine: LegacyCanonicalSettingsExtras = {
    invocation_mode: extras.invocation_mode,
    continuation: extras.continuation,
    empty_retry: extras.empty_retry,
    fallback_policy: extras.fallback_policy,
    provider_route: extras.provider_route,
    endpoint: extras.endpoint,
    thinking_budget: extras.thinking_budget,
    prompt_profile_digest: extras.prompt_profile_digest,
    infra_retries_per_attempt: extras.infra_retries_per_attempt,
  };
  return {
    temperature: base.temperature ?? null,
    max_attempts: base.max_attempts ?? null,
    max_tokens: base.max_tokens ?? null,
    prompt_version: base.prompt_version ?? null,
    bc_version: base.bc_version ?? null,
    extra_json: canonicalJSON(nine),
  };
}
```

`extrasJson` and `buildCanonicalSettings` keep their signatures and now require the schema-2 type. Every existing caller constructing `CanonicalSettingsExtras` (`src/batch/submit.ts`, the sync capture site, `cli/commands/bench/ingest-assembly.ts` line 182 area, tests) must add `settings_extras_schema: 2` and `upstream_pin`; `deno check` lists them.

- [ ] **Step 4: Invocation schema 2**

In `src/ingest/capture.ts` `InvocationRecord`, after `prompt_profile_digest`:

```ts
  /** 2 = carries upstream_pin/upstream_resolved. A record without this key is schema 1. */
  invocation_schema: 2;
  upstream_pin: string | null;
  upstream_resolved: {
    provider_name: string;
    quantization: string | null;
    preflight: "passed" | "skipped";
  } | null;
```

`invocationSnapshot(cfg)` gains `upstreamPin?: string; upstreamResolved?: { provider_name: string; quantization: string | null; preflight: "passed" | "skipped" };` and emits `invocation_schema: 2, upstream_pin: cfg.upstreamPin ?? null, upstream_resolved: cfg.upstreamResolved ?? null`. `isInvocationRecord` is unchanged in what it checks (a schema-1 record still passes). Add:

```ts
/** 1 for a record written before the upstream lock, 2 after. Never normalise a missing pin to null on a schema-1 record. */
export function invocationSchemaOf(v: InvocationRecord | Record<string, unknown>): 1 | 2 {
  return (v as Record<string, unknown>)["invocation_schema"] === 2 ? 2 : 1;
}
```

- [ ] **Step 5: Submit and sync capture emit the pin**

`src/batch/submit.ts` extras: add `settings_extras_schema: 2, upstream_pin: routing?.upstreamPin ?? null,`. The sync capture site does the same from `options.upstreamPins?.get(variant.variantId)?.upstreamPin ?? null`, and passes `upstreamPin`/`upstreamResolved` into `invocationSnapshot`.

- [ ] **Step 6: Finalize reads frozen extras by schema**

In `src/batch/results.ts` `readFrozenExtras`, return `{ inputs, extras: LegacyCanonicalSettingsExtras | CanonicalSettingsExtras }` and let the caller branch:

```ts
    const { inputs: promptInputs, extras } = await readFrozenExtras(dir);
    const pin = isLegacyExtras(extras) ? undefined : (extras.upstream_pin ?? undefined);
    const invocationRecord: InvocationRecord = {
      ...invocationSnapshot({
        ...existing fields...,
        ...(pin !== undefined ? { upstreamPin: pin } : {}),
        ...(promptInputs.routing
          ? { upstreamResolved: { provider_name: promptInputs.routing.providerName, quantization: promptInputs.routing.quantization, preflight: promptInputs.routing.preflight } }
          : {}),
      }),
      batch: buildBatchInvocationSummary(next),
    };
```

Then, for a legacy run, strip the schema-2 keys so the persisted record is honestly schema 1:

```ts
    if (isLegacyExtras(extras)) {
      const r = invocationRecord as unknown as Record<string, unknown>;
      delete r["invocation_schema"]; delete r["upstream_pin"]; delete r["upstream_resolved"];
    }
```

The existing endpoint/provider_route disagreement check is unchanged.

- [ ] **Step 7: Run tests and checks**

Run: `deno test --allow-all tests/unit/shared/ tests/unit/ingest/ tests/unit/batch/ && cd site && npm run build && npx vitest run tests/settings-hash-parity.test.ts && cd .. && deno check shared/settings-hash.ts src/ingest/capture.ts src/batch/submit.ts src/batch/results.ts && deno lint shared src/ingest src/batch && deno fmt <touched files>`
Expected: PASS on both runtimes, all three new fixture cases pinned.

- [ ] **Step 8: Commit**

```bash
git add shared/settings-hash.ts shared/fixtures/settings-hash.fixture.json src/ingest/capture.ts src/batch/submit.ts src/batch/results.ts <sync capture file> tests/unit/shared/settings-hash.test.ts tests/unit/ingest/capture.test.ts tests/unit/batch/results.test.ts tests/unit/batch/fixture-pre-upstream.test.ts
git commit -m "feat(profile): upstream_pin in settings extras schema 2 and invocation schema 2, with a legacy builder

The pin joins the hashed extras under a named schema so every future run
gets a new settings hash, pinned or not, as invocation_mode did. Records
from before the change are schema 1 and are rebuilt through a dedicated
legacy builder that reproduces their old key set and hash byte for byte;
the fixture pins both the legacy hash and the two new profiles on both
runtimes.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 11: IngestMeta schema 5, assembly, wire types, `# Upstream` block

**Files:**
- Modify: `cli/commands/bench/ingest-meta.ts:28-68`, `:95-150`
- Modify: `cli/commands/bench/ingest-assembly.ts:116-160`, `:171-225`, `:253-300`
- Modify: `src/ingest/mod.ts:14-112`, `:170-200`; `src/ingest/envelope.ts:4-60`
- Modify: `cli/commands/bench/results-writer.ts` (add `renderUpstreamBlock`, call it beside the fallback block; `saveResultsJson` writes `canonical_settings`)
- Modify: `src/batch/results.ts:427-445` (ingest meta at finalize)
- Test: `tests/unit/ingest/ingest-assembly-upstream.test.ts`, `tests/unit/cli/bench/ingest-meta.test.ts` (extend or create), `tests/unit/cli/bench/results-writer.test.ts` (extend)

**Interfaces:**
- Consumes: Task 8 attempt fields; Task 10 `buildLegacyCanonicalSettings`, `isLegacyExtras`, `invocationSchemaOf`.
- Produces:
  ```ts
  // IngestMeta.schema: 1 | 2 | 3 | 4 | 5; schema 5 adds
  //   canonical_settings?: Record<variantId, CanonicalSettings>;
  //   settings_hashes?: Record<variantId, string>;
  // BenchResultItem gains
  //   requested_upstream: string | null; served_upstream: string | null; served_upstream_model: string | null;
  //   upstream_identity_source: "provider_field" | "router_metadata" | "both" | null;
  //   upstream_verification: "not_applicable" | "unpinned" | "verified" | "mismatch" | "unverified" | "not_served";
  // BenchResults / BuildPayloadInput gain
  //   excluded?: { code: "upstream_mismatch" | "upstream_unverified"; reason: string; attempts: Array<{ task_id: string; attempt: 1 | 2 }> };
  // buildPayload emits `excluded` verbatim and ResultInput gets the five fields.
  // results-writer.ts
  export function renderUpstreamBlock(results: TaskExecutionResult[], provider: string, pin?: { upstreamPin: string; providerName: string; quantization: string | null }): string[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/ingest/ingest-assembly-upstream.test.ts
// Mirror tests/unit/ingest/ingest-assembly-infra.test.ts: same VARIANT/makeResult/writeResultsFile helpers, copied in.
Deno.test("assembly emits the five upstream fields per item", async () => {
  const dir = await createTempDir("asm-up");
  try {
    const a = createMockExecutionAttempt({
      success: true, score: 100,
      requestedUpstream: "novita/fp8", servedUpstream: "Novita", servedUpstreamModel: "v",
      upstreamIdentitySource: "both", upstreamVerification: "verified",
    });
    const path = await writeResultsFile(dir, [makeResult("t1", [a])]);
    const out = await assembleBenchResultsForVariant(path, VARIANT, ASSEMBLE_OPTS);
    assert(out.kind === "assembled");
    const item = out.benchResults.results[0]!;
    assertEquals(item.requested_upstream, "novita/fp8");
    assertEquals(item.served_upstream, "Novita");
    assertEquals(item.served_upstream_model, "v");
    assertEquals(item.upstream_identity_source, "both");
    assertEquals(item.upstream_verification, "verified");
    assertEquals(out.benchResults.excluded, undefined);
  } finally { await cleanupTempDir(dir); }
});

Deno.test("assembly marks the run excluded when any attempt is compromised, naming the attempts", async () => {
  const dir = await createTempDir("asm-up2");
  try {
    const good = createMockExecutionAttempt({ success: true, score: 100, attemptNumber: 1, requestedUpstream: "novita/fp8", servedUpstream: "Novita", upstreamVerification: "verified", upstreamIdentitySource: "provider_field" });
    const bad = createMockExecutionAttempt({ success: false, score: 0, attemptNumber: 1, requestedUpstream: "novita/fp8", servedUpstream: "Together", upstreamVerification: "mismatch", upstreamIdentitySource: "provider_field", terminal: "upstream_compromised" });
    const path = await writeResultsFile(dir, [makeResult("t1", [good]), makeResult("t2", [bad])]);
    const out = await assembleBenchResultsForVariant(path, VARIANT, ASSEMBLE_OPTS);
    assert(out.kind === "assembled");
    assertEquals(out.benchResults.excluded, {
      code: "upstream_mismatch",
      reason: "upstream mismatch on 1 attempt: pinned novita/fp8, served Together (t2 a1)",
      attempts: [{ task_id: "t2", attempt: 1 }],
    });
    // The compromised attempt is still in the payload with its real outcome.
    assertEquals(out.benchResults.results.length, 2);
  } finally { await cleanupTempDir(dir); }
});

Deno.test("assembly reports upstream_unverified when that is the only compromise, mismatch when both occur", async () => {
  // two tasks: one unverified, one mismatch -> code "upstream_mismatch", attempts lists both;
  // one task unverified only -> code "upstream_unverified".
});

Deno.test("assembly prefers persisted canonical_settings verbatim and never rebuilds them", async () => {
  // Write a results file whose `ingest` is schema 5 with canonical_settings[variantId] = a fixed object
  // and settings_hashes[variantId] = "deadbeef"; call assembly with opts.canonicalSettings from parseIngestMeta;
  // assert benchResults.settings deep-equals the fixed object.
});

Deno.test("assembly rebuilds a schema-4 file through the legacy builder", async () => {
  const f = await copyPreUpstreamFixture();
  try {
    const meta = parseIngestMeta(JSON.parse(await Deno.readTextFile(f.resultsFile)))!;
    const variantId = Object.keys(meta.run_ids)[0]!;
    const inv = meta.invocations![variantId]!;
    const out = await assembleBenchResultsForVariant(f.resultsFile, reconstructVariantFromFixture(f), { pricingVersion: meta.pricing_version, runId: meta.run_ids[variantId], invocation: inv });
    assert(out.kind === "assembled");
    // The legacy hash: recompute from the fixture's frozen prompt-inputs.json settings and compare.
    const frozen = JSON.parse(await Deno.readTextFile(join(f.dir, "prompt-inputs.json"))) as { settings: Record<string, unknown> };
    assertEquals(await settingsHashOf(out.benchResults.settings as never), await settingsHashOf(frozen.settings as never));
    assertEquals("settings_extras_schema" in JSON.parse(String(out.benchResults.settings["extra_json"])), false);
  } finally { await f.cleanup(); }
});
```

Write the two comment-described tests out fully; `reconstructVariantFromFixture` builds a `ModelVariant` from the fixture's `state.json` `model` block (provider `openrouter`, model = `apiModelId`, `hasVariant: false`, `config: {}`).

Append to the results-writer tests:

```ts
Deno.test("renderUpstreamBlock summarises pin, served names, model versions and verification counts", () => {
  const lines = renderUpstreamBlock(results, "openrouter", { upstreamPin: "novita/fp8", providerName: "Novita", quantization: "fp8" });
  assertEquals(lines[0], "# Upstream");
  assert(lines.includes("pin: novita/fp8 (Novita, fp8)"));
  assert(lines.some((l) => /^served: Novita=\d+/.test(l)));
  assert(lines.some((l) => /^verification: verified=\d+/.test(l)));
  assertEquals(renderUpstreamBlock(results, "anthropic"), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/ingest/ingest-assembly-upstream.test.ts tests/unit/cli/bench/`
Expected: FAIL.

- [ ] **Step 3: IngestMeta schema 5**

In `cli/commands/bench/ingest-meta.ts`: `schema: 1 | 2 | 3 | 4 | 5;` with a doc line `5 = also carries canonical_settings/settings_hashes per variant, the exact six hashed keys the run was ingested or frozen with (spec 2026-09-11 D4); assembly sends them verbatim.` Add the two optional fields. `buildIngestMeta` gains an optional `settings?: Record<string, { canonical: CanonicalSettings; hash: string }>` argument; when present the schema is 5 and both maps are filled. `parseIngestMeta` accepts 5 and reads both maps when well-formed (an object of objects with the six keys; a string map).

- [ ] **Step 4: Assembly sends frozen settings verbatim, legacy through the legacy builder**

In `ingest-assembly.ts`, `AssembleOptions` gains `canonicalSettings?: CanonicalSettings; settingsHash?: string;`. The settings branch becomes:

```ts
  let settings: Record<string, unknown>;
  let invocationMode: InvocationMode = "sync";
  if (opts.canonicalSettings) {
    // Schema-5 file: the exact object the run hashed under. Never rebuilt.
    settings = { ...opts.canonicalSettings };
    if (opts.invocation && isInvocationRecord(opts.invocation)) invocationMode = opts.invocation.mode;
  } else if (opts.invocation && isInvocationRecord(opts.invocation)) {
    const inv = opts.invocation;
    invocationMode = inv.mode;
    const base = { temperature: variant.config.temperature ?? null, max_attempts: inv.max_attempts, max_tokens: variant.config.maxTokens ?? null, prompt_version: null, bc_version: null };
    const nine = {
      invocation_mode: inv.mode, continuation: inv.continuation, empty_retry: inv.empty_retry,
      fallback_policy: inv.fallback_policy, provider_route: inv.provider_route, endpoint: inv.endpoint,
      thinking_budget: variant.config.thinkingBudget ?? null, prompt_profile_digest: inv.prompt_profile_digest,
      infra_retries_per_attempt: inv.infra_retries_per_attempt,
    };
    settings = invocationSchemaOf(inv) === 2
      ? { ...buildCanonicalSettings(base, { ...nine, settings_extras_schema: 2, upstream_pin: inv.upstream_pin }) }
      // Schema-1 invocation from a pre-upstream file: the old nine keys, the old hash.
      : { ...buildLegacyCanonicalSettings(base, nine) };
  } else {
    ...existing three-key fallback unchanged...
  }
```

Callers that have a parsed `IngestMeta` (the bench's immediate ingest, `centralgauge ingest <file>` replay, and `finalizeRun`) pass `canonicalSettings: meta.canonical_settings?.[variantId]` and `settingsHash: meta.settings_hashes?.[variantId]`.

`attemptToItem` gains the five fields:

```ts
    requested_upstream: a.requestedUpstream ?? null,
    served_upstream: a.servedUpstream ?? null,
    served_upstream_model: a.servedUpstreamModel ?? null,
    upstream_identity_source: a.upstreamIdentitySource ?? null,
    upstream_verification: a.upstreamVerification ?? "not_applicable",
```

After the items loop, compute the run-level exclusion:

```ts
  const compromised = items.filter((i) => i.upstream_verification === "mismatch" || i.upstream_verification === "unverified");
  if (compromised.length > 0) {
    const anyMismatch = compromised.some((i) => i.upstream_verification === "mismatch");
    const code = anyMismatch ? "upstream_mismatch" : "upstream_unverified";
    const first = compromised[0]!;
    const detail = anyMismatch
      ? `pinned ${first.requested_upstream}, served ${compromised.find((i) => i.upstream_verification === "mismatch")!.served_upstream}`
      : `pinned ${first.requested_upstream}, no identity in the response`;
    const where = compromised.map((i) => `${i.task_id} a${i.attempt}`).join(", ");
    br.excluded = {
      code,
      reason: `upstream ${anyMismatch ? "mismatch" : "unverified"} on ${compromised.length} attempt${compromised.length === 1 ? "" : "s"}: ${detail} (${where})`,
      attempts: compromised.map((i) => ({ task_id: i.task_id, attempt: i.attempt })),
    };
  }
```

(Build `br` first, then attach; adjust ordering in the function accordingly.) Bound `reason` to 500 characters by truncating `where` with `...`.

- [ ] **Step 5: Wire types and payload**

`src/ingest/mod.ts` `BenchResultItem`: add the five fields (non-optional, nulls allowed as typed above). `BenchResults` and `src/ingest/envelope.ts` `BuildPayloadInput`: add `excluded?: { code: "upstream_mismatch" | "upstream_unverified"; reason: string; attempts: Array<{ task_id: string; attempt: 1 | 2 }> }`. In the `ResultInput` mapping (`mod.ts:170-200`) copy the five fields; in `buildPayload` add `if (input.excluded) p["excluded"] = input.excluded;`. `site/src/lib/shared/types.ts` `ResultInput` gains the five optional fields and `SignedRunPayload.payload` gains `excluded?`, both documented as absent on CLIs predating this change (Task 12 validates them server-side).

- [ ] **Step 6: `# Upstream` block and `canonical_settings` at save time**

`cli/commands/bench/results-writer.ts`: add

```ts
/** `# Upstream` scores-file block (spec 2026-09-11 D1). Empty unless the provider is openrouter. */
export function renderUpstreamBlock(
  results: TaskExecutionResult[],
  provider: string,
  pin?: { upstreamPin: string; providerName: string; quantization: string | null },
): string[] {
  if (provider !== "openrouter") return [];
  const served = new Map<string, number>();
  const versions = new Map<string, number>();
  const verification = new Map<string, number>();
  for (const r of results) {
    for (const a of r.attempts ?? []) {
      if (a.servedUpstream) served.set(a.servedUpstream, (served.get(a.servedUpstream) ?? 0) + 1);
      if (a.servedUpstreamModel) versions.set(a.servedUpstreamModel, (versions.get(a.servedUpstreamModel) ?? 0) + 1);
      const v = a.upstreamVerification ?? "unpinned";
      verification.set(v, (verification.get(v) ?? 0) + 1);
    }
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].sort().map(([k, n]) => `${k}=${n}`).join(" ");
  const lines = [`# Upstream`];
  lines.push(pin ? `pin: ${pin.upstreamPin} (${pin.providerName}, ${pin.quantization ?? "quantization undeclared"})` : `pin: none`);
  lines.push(`served: ${fmt(served) || "none"}`);
  lines.push(`served_model: ${fmt(versions) || "none"}`);
  lines.push(`verification: ${fmt(verification)}`);
  return lines;
}
```

Call it in `buildScoreLines` right after the fallback block, with the provider and pin taken from the per-model input (`input.provider`, and the frozen routing when the caller has it; the sync bench passes `options.upstreamPins?.get(variantId)`). `saveResultsJson` receives the per-variant `{ canonical, hash }` from its caller and passes it to `buildIngestMeta` so new files are schema 5; `src/batch/results.ts` passes `{ [variantId]: { canonical: promptInputs.settings, hash: next.frozen.settingsHash } }`.

- [ ] **Step 7: Run tests and checks**

Run: `deno test --allow-all tests/unit/ingest/ tests/unit/cli/ tests/unit/batch/ && deno check cli/commands/bench/ingest-meta.ts cli/commands/bench/ingest-assembly.ts src/ingest/mod.ts src/ingest/envelope.ts cli/commands/bench/results-writer.ts src/batch/results.ts && deno lint cli src/ingest src/batch && deno fmt <touched files>`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add cli/commands/bench/ingest-meta.ts cli/commands/bench/ingest-assembly.ts src/ingest/mod.ts src/ingest/envelope.ts cli/commands/bench/results-writer.ts src/batch/results.ts site/src/lib/shared/types.ts tests/unit/ingest/ingest-assembly-upstream.test.ts tests/unit/cli/bench/
git commit -m "feat(ingest): five upstream fields per result, run-level exclusion, frozen settings in IngestMeta schema 5

Assembly carries the per-attempt upstream fields onto the wire and marks
a run excluded, with a code and the attempts that caused it, when any
attempt is compromised. Results files now persist the exact canonical
settings and hash the run used, and assembly sends them verbatim; a
schema-4 file is rebuilt through the legacy builder so its hash never
moves. The scores file gains a # Upstream block.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 12: Migration 0023, ingest validation, atomic profile claim and auto-exclusion

**Files:**
- Create: `site/migrations/0023_results_upstream.sql`, `site/src/lib/server/upstream-profile.ts`
- Modify: `site/src/lib/server/audit.ts` (add `appendAuditStmt`), `site/src/routes/api/v1/runs/+server.ts:311-385` (run insert), `:417-556` (result validation), `:555-620` (result insert, batch, response)
- Test: `site/tests/migrations.test.ts` (extend), `site/tests/api/runs-ingest-upstream.test.ts`

**Interfaces:**
- Consumes: wire fields from Task 11.
- Produces:
  ```ts
  // site/src/lib/server/upstream-profile.ts
  export const UNPINNED_PROFILE = "<unpinned>";
  export function profileKeyOf(upstreamPin: string | null | undefined): string;
  export function claimProfileStmt(db, args: { modelId: number; taskSetHash: string; mode: "sync" | "batch"; key: string }): D1PreparedStatement;   // INSERT ... ON CONFLICT DO NOTHING
  export function guardedRunInsertSql(baseInsertSql: string): string;   // wraps `INSERT INTO runs(...) VALUES (...)` as INSERT ... SELECT ... WHERE the registry key for the triple equals ?
  export async function readProfile(db, triple): Promise<{ key: string } | null>;
  export async function conflictingRunIds(db, triple, excludingRunId): Promise<string[]>;
  export function releaseProfileIfEmptyStmt(db, triple): D1PreparedStatement;   // DELETE when no non-excluded run remains
  // audit.ts
  export function appendAuditStmt(db, e): D1PreparedStatement;   // same row as appendAudit, as a statement for db.batch
  ```

- [ ] **Step 1: Write the migration**

```sql
-- 0023_results_upstream.sql
-- OpenRouter upstream lock (spec docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md).
--
-- Five per-result columns, all nullable, NO default: a NULL upstream_verification
-- means the row predates capture and is honestly unknown, never "not applicable".
-- New ingests set not_applicable explicitly for non-OpenRouter providers.
ALTER TABLE results ADD COLUMN requested_upstream TEXT;
ALTER TABLE results ADD COLUMN served_upstream TEXT;
ALTER TABLE results ADD COLUMN served_upstream_model TEXT;
ALTER TABLE results ADD COLUMN upstream_identity_source TEXT;
ALTER TABLE results ADD COLUMN upstream_verification TEXT;

-- A stable machine-readable exclusion code beside the free-text reason
-- (0022). NULL for a manual operator exclusion; upstream_mismatch or
-- upstream_unverified when ingest excluded the run itself.
ALTER TABLE runs ADD COLUMN excluded_code TEXT;

-- One upstream profile per (model, task set, mode). Claimed atomically in the
-- ingest batch; `<unpinned>` is a profile like any other. Released by exclude
-- when the last non-excluded run of the profile is gone; re-claimed by include.
CREATE TABLE upstream_profiles (
  model_id        INTEGER NOT NULL REFERENCES models(id),
  task_set_hash   TEXT    NOT NULL REFERENCES task_sets(hash),
  invocation_mode TEXT    NOT NULL CHECK (invocation_mode IN ('sync','batch')),
  profile_key     TEXT    NOT NULL,
  claimed_at      TEXT    NOT NULL,
  PRIMARY KEY (model_id, task_set_hash, invocation_mode)
);

-- v_results_with_cost expands r.* at CREATE VIEW time, so columns added by
-- ALTER TABLE are invisible through it until it is recreated (0021 did the
-- same). Same formula as 0021, verbatim.
DROP VIEW IF EXISTS v_results_with_cost;
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    (r.tokens_in          * cs.input_per_mtoken +
     r.tokens_out         * cs.output_per_mtoken +
     r.tokens_cache_read  * COALESCE(cs.cache_read_per_mtoken, 0) +
     r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0))
    / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;

CREATE INDEX IF NOT EXISTS idx_results_upstream_verification ON results(upstream_verification);
```

- [ ] **Step 2: Write the failing tests**

Append to `site/tests/migrations.test.ts`:

```ts
describe("migration 0023 upstream lock", () => {
  it("adds five nullable no-default result columns, runs.excluded_code, and the profile registry", async () => {
    const cols = (await env.DB.prepare(`PRAGMA table_info(results)`).all()).results as { name: string; notnull: number; dflt_value: string | null }[];
    for (const name of ["requested_upstream", "served_upstream", "served_upstream_model", "upstream_identity_source", "upstream_verification"]) {
      const c = cols.find((x) => x.name === name);
      expect(c, `results.${name}`).toBeDefined();
      expect(c?.notnull).toBe(0);
      expect(c?.dflt_value).toBe(null);
    }
    const runCols = (await env.DB.prepare(`PRAGMA table_info(runs)`).all()).results as { name: string }[];
    expect(runCols.some((c) => c.name === "excluded_code")).toBe(true);
    const reg = (await env.DB.prepare(`PRAGMA table_info(upstream_profiles)`).all()).results as { name: string; pk: number }[];
    expect(reg.filter((c) => c.pk > 0).map((c) => c.name).sort()).toEqual(["invocation_mode", "model_id", "task_set_hash"]);
    const viewCols = (await env.DB.prepare(`PRAGMA table_info(v_results_with_cost)`).all()).results as { name: string }[];
    expect(viewCols.some((c) => c.name === "served_upstream")).toBe(true);
  });
});
```

Create `site/tests/api/runs-ingest-upstream.test.ts` using `makeRunPayload`, `registerIngestKey`, `seedMinimalRefData`, `createSignedPayload` exactly as `runs-ingest.test.ts` does, with a `post(payload, runId)` helper:

```ts
const orResult = (over: Record<string, unknown> = {}) => ({
  ...makeRunPayload().results[0]!,
  requested_upstream: "novita/fp8",
  served_upstream: "Novita",
  served_upstream_model: "v1",
  upstream_identity_source: "both",
  upstream_verification: "verified",
  ...over,
});
const orPayload = (over: Record<string, unknown> = {}) =>
  makeRunPayload({
    invocation_mode: "batch",
    invocation: { upstream_pin: "novita/fp8", invocation_schema: 2 },
    results: [orResult()],
    ...over,
  });

describe("POST /api/v1/runs upstream lock", () => {
  it("stores the five fields and claims an <upstream slug> profile", async () => {
    const res = await post(orPayload(), "r-up-1");
    expect(res.status).toBe(202);
    const row = await env.DB.prepare(`SELECT requested_upstream, served_upstream, served_upstream_model, upstream_identity_source, upstream_verification FROM results WHERE run_id = ?`).bind("r-up-1").first();
    expect(row).toMatchObject({ requested_upstream: "novita/fp8", served_upstream: "Novita", served_upstream_model: "v1", upstream_identity_source: "both", upstream_verification: "verified" });
    const prof = await env.DB.prepare(`SELECT profile_key FROM upstream_profiles`).first<{ profile_key: string }>();
    expect(prof?.profile_key).toBe("novita/fp8");
  });

  it("claims <unpinned> for a payload without a pin and stamps not_applicable rows explicitly", async () => {
    const res = await post(makeRunPayload({ results: [{ ...makeRunPayload().results[0]!, upstream_verification: "not_applicable" }] }), "r-up-2");
    expect(res.status).toBe(202);
    const prof = await env.DB.prepare(`SELECT profile_key FROM upstream_profiles`).first<{ profile_key: string }>();
    expect(prof?.profile_key).toBe("<unpinned>");
    const v = await env.DB.prepare(`SELECT upstream_verification FROM results WHERE run_id = ?`).bind("r-up-2").first<{ upstream_verification: string }>();
    expect(v?.upstream_verification).toBe("not_applicable");
  });

  it("refuses a second profile for the same model, set and mode with 409 naming the runs", async () => {
    expect((await post(orPayload(), "r-a")).status).toBe(202);
    const res = await post(orPayload({ invocation: { upstream_pin: "together", invocation_schema: 2 }, results: [orResult({ requested_upstream: "together", served_upstream: "Together" })] }), "r-b");
    expect(res.status).toBe(409);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe("upstream_profile_conflict");
    expect(body.error).toContain("novita/fp8");
    expect(body.error).toContain("r-a");
    const gone = await env.DB.prepare(`SELECT id FROM runs WHERE id = ?`).bind("r-b").first();
    expect(gone).toBeNull();
    const orphans = await env.DB.prepare(`SELECT COUNT(*) AS n FROM results WHERE run_id = ?`).bind("r-b").first<{ n: number }>();
    expect(Number(orphans?.n)).toBe(0);
  });

  it("answers a replayed run id before any profile logic", async () => {
    expect((await post(orPayload(), "r-rep")).status).toBe(202);
    const again = await post(orPayload({ invocation: { upstream_pin: "together", invocation_schema: 2 } }), "r-rep");
    expect(again.status).toBe(200);
    expect((await again.json<{ status: string }>()).status).toBe("exists");
  });

  it("stores a compromised run already excluded, with code, reason and audit, in one batch", async () => {
    const res = await post(orPayload({
      results: [orResult(), orResult({ task_id: "easy/task-2", served_upstream: "Together", upstream_verification: "mismatch", passed: false, score: 0 })],
      excluded: { code: "upstream_mismatch", reason: "upstream mismatch on 1 attempt", attempts: [{ task_id: "easy/task-2", attempt: 1 }] },
    }), "r-comp");
    expect(res.status).toBe(202);
    const run = await env.DB.prepare(`SELECT excluded_at, excluded_code, excluded_reason FROM runs WHERE id = ?`).bind("r-comp").first<{ excluded_at: string | null; excluded_code: string | null; excluded_reason: string | null }>();
    expect(run?.excluded_at).toBeTruthy();
    expect(run?.excluded_code).toBe("upstream_mismatch");
    const audit = await env.DB.prepare(`SELECT event, details_json FROM admin_audit WHERE event = 'run.auto_excluded' ORDER BY id DESC LIMIT 1`).first<{ event: string; details_json: string }>();
    expect(JSON.parse(audit!.details_json)).toMatchObject({ run_id: "r-comp", code: "upstream_mismatch", attempts: [{ task_id: "easy/task-2", attempt: 1 }] });
    // An excluded run does not hold the profile.
    const prof = await env.DB.prepare(`SELECT profile_key FROM upstream_profiles`).first();
    expect(prof).toBeNull();
  });

  it("rejects an exclusion whose named attempt is not compromised in the payload", async () => {
    const res = await post(orPayload({ excluded: { code: "upstream_mismatch", reason: "x", attempts: [{ task_id: "easy/task-1", attempt: 1 }] } }), "r-badx");
    expect(res.status).toBe(400);
    expect((await res.json<{ code: string }>()).code).toBe("invalid_exclusion");
  });

  it("rejects relational violations", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ requested_upstream: null, upstream_verification: "verified" }, "verified requires a requested_upstream"],
      [{ upstream_verification: "unpinned" }, "unpinned requires a null requested_upstream"],
      [{ served_upstream: null, upstream_verification: "verified" }, "verified requires a served_upstream"],
      [{ upstream_verification: "bogus" }, "upstream_verification must be one of"],
      [{ requested_upstream: "together" }, "must equal the run's upstream_pin"],
    ];
    for (const [over, msg] of cases) {
      const res = await post(orPayload({ results: [orResult(over)] }), `r-rel-${Math.random()}`);
      expect(res.status, msg).toBe(400);
      const body = await res.json<{ code: string; error: string }>();
      expect(body.code).toBe("invalid_upstream");
      expect(body.error).toContain(msg.split(" ")[0]!);
    }
  });

  it("two concurrent first ingests with different pins leave exactly one profile and one run", async () => {
    const [a, b] = await Promise.all([
      post(orPayload(), "r-race-a"),
      post(orPayload({ invocation: { upstream_pin: "together", invocation_schema: 2 }, results: [orResult({ requested_upstream: "together", served_upstream: "Together" })] }), "r-race-b"),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM upstream_profiles`).first<{ n: number }>();
    expect(Number(n?.n)).toBe(1);
    const runs = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs`).first<{ n: number }>();
    expect(Number(runs?.n)).toBe(1);
  });
});
```

`invocation.upstream_pin` is where the endpoint reads the run's pin; it must agree with every non-null `requested_upstream`.

- [ ] **Step 3: Run to verify failure**

`cd site && npm run build && npx vitest run tests/migrations.test.ts tests/api/runs-ingest-upstream.test.ts`
Expected: FAIL (migration absent; 202 for the conflict case; no `excluded_code`).

- [ ] **Step 4: Registry helpers and audit statement**

```ts
// site/src/lib/server/upstream-profile.ts
export const UNPINNED_PROFILE = "<unpinned>";

export interface ProfileTriple {
  modelId: number;
  taskSetHash: string;
  mode: "sync" | "batch";
}

export function profileKeyOf(upstreamPin: string | null | undefined): string {
  return upstreamPin && upstreamPin.length > 0 ? upstreamPin : UNPINNED_PROFILE;
}

/** INSERT ... ON CONFLICT DO NOTHING: the first claimant wins, later ones are no-ops. */
export function claimProfileStmt(db: D1Database, t: ProfileTriple & { key: string; now: string }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO upstream_profiles(model_id, task_set_hash, invocation_mode, profile_key, claimed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(model_id, task_set_hash, invocation_mode) DO NOTHING`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode, t.key, t.now);
}

/**
 * The subquery that yields the stored profile key for a triple, used to
 * guard the run and result inserts so a losing claimant inserts nothing.
 */
export const STORED_KEY_SUBQUERY =
  `(SELECT profile_key FROM upstream_profiles WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?)`;

export async function readProfile(db: D1Database, t: ProfileTriple): Promise<{ key: string } | null> {
  const row = await db
    .prepare(`SELECT profile_key AS key FROM upstream_profiles WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?`)
    .bind(t.modelId, t.taskSetHash, t.mode)
    .first<{ key: string }>();
  return row ?? null;
}

export async function conflictingRunIds(db: D1Database, t: ProfileTriple, excludingRunId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT id FROM runs WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ? AND excluded_at IS NULL AND id <> ? ORDER BY started_at`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode, excludingRunId)
    .all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id);
}

/** Release the registry row when no non-excluded run of the triple remains. */
export function releaseProfileIfEmptyStmt(db: D1Database, t: ProfileTriple): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM upstream_profiles
       WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ?
         AND NOT EXISTS (SELECT 1 FROM runs WHERE model_id = ? AND task_set_hash = ? AND invocation_mode = ? AND excluded_at IS NULL)`,
    )
    .bind(t.modelId, t.taskSetHash, t.mode, t.modelId, t.taskSetHash, t.mode);
}
```

In `site/src/lib/server/audit.ts`, factor the statement out of `appendAudit`:

```ts
export function appendAuditStmt(db: D1Database, e: Parameters<typeof appendAudit>[1]): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_audit(event, actor_key_id, actor_machine, request_id, task_set_hash, before_digest, after_digest, details_json, ts)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      e.event, e.actor?.key_id ?? null, e.actor?.machine_id ?? null, e.requestId ?? null,
      e.taskSetHash ?? null, e.before ?? null, e.after ?? null,
      e.details === undefined ? null : JSON.stringify(e.details), new Date().toISOString(),
    );
}
export async function appendAudit(db: D1Database, e: ...): Promise<void> {
  await appendAuditStmt(db, e).run();
}
```

- [ ] **Step 5: Ingest endpoint**

In `site/src/routes/api/v1/runs/+server.ts`:

1. Constants near `TERMINATION_KINDS`:

```ts
const UPSTREAM_VERIFICATIONS = new Set(["not_applicable", "unpinned", "verified", "mismatch", "unverified", "not_served"]);
const UPSTREAM_SOURCES = new Set(["provider_field", "router_metadata", "both"]);
const EXCLUSION_CODES = new Set(["upstream_mismatch", "upstream_unverified"]);
```

2. After the invocation-mode validation, derive the run pin and profile key:

```ts
    const runPin = typeof (payload.invocation as Record<string, unknown> | undefined)?.["upstream_pin"] === "string"
      ? ((payload.invocation as Record<string, unknown>)["upstream_pin"] as string)
      : null;
    const profileKey = profileKeyOf(runPin);
    const triple = { modelId: model.id, taskSetHash: payload.task_set_hash, mode: invocationMode };
```

The idempotency check stays where it is (before this block is fine, it must precede the claim).

3. Validate `payload.excluded` (optional): object with `code` in `EXCLUSION_CODES`, `reason` a non-empty string of at most 500 characters, `attempts` an array of `{ task_id: string, attempt: 1 | 2 }`; otherwise `400 invalid_exclusion`. Each named attempt must exist in `payload.results` with `upstream_verification` equal to `mismatch` or `unverified`, else `400 invalid_exclusion`.

4. In the per-result loop, before the `statements.push`:

```ts
      const str = (v: unknown, name: string): string | null => {
        if (v === undefined || v === null) return null;
        if (typeof v !== "string" || v.length === 0 || v.length > 128) {
          throw new ApiError(400, "invalid_upstream", `${name} must be a non-empty string of at most 128 characters or null (task ${r.task_id} attempt ${r.attempt})`);
        }
        return v;
      };
      const requestedUpstream = str(r.requested_upstream, "requested_upstream");
      const servedUpstream = str(r.served_upstream, "served_upstream");
      const servedUpstreamModel = str(r.served_upstream_model, "served_upstream_model");
      const identitySource = str(r.upstream_identity_source, "upstream_identity_source");
      if (identitySource !== null && !UPSTREAM_SOURCES.has(identitySource)) {
        throw new ApiError(400, "invalid_upstream", `upstream_identity_source must be one of ${[...UPSTREAM_SOURCES].join(", ")} (task ${r.task_id} attempt ${r.attempt})`);
      }
      const verification = r.upstream_verification === undefined ? null : r.upstream_verification;
      if (verification !== null && !UPSTREAM_VERIFICATIONS.has(verification)) {
        throw new ApiError(400, "invalid_upstream", `upstream_verification must be one of ${[...UPSTREAM_VERIFICATIONS].join(", ")} (task ${r.task_id} attempt ${r.attempt})`);
      }
      // Relational rules (spec D1).
      const pinnedStates = new Set(["verified", "mismatch", "unverified", "not_served"]);
      if (verification !== null && pinnedStates.has(verification) && requestedUpstream === null) {
        throw new ApiError(400, "invalid_upstream", `${verification} requires a requested_upstream (task ${r.task_id} attempt ${r.attempt})`);
      }
      if ((verification === "unpinned" || verification === "not_applicable") && requestedUpstream !== null) {
        throw new ApiError(400, "invalid_upstream", `${verification} requires a null requested_upstream (task ${r.task_id} attempt ${r.attempt})`);
      }
      if ((verification === "verified" || verification === "mismatch") && (servedUpstream === null || identitySource === null)) {
        throw new ApiError(400, "invalid_upstream", `${verification} requires a served_upstream and an identity source (task ${r.task_id} attempt ${r.attempt})`);
      }
      if (requestedUpstream !== null && requestedUpstream !== runPin) {
        throw new ApiError(400, "invalid_upstream", `requested_upstream ${requestedUpstream} must equal the run's upstream_pin ${runPin ?? "(none)"} (task ${r.task_id} attempt ${r.attempt})`);
      }
```

Add the five columns to the results `INSERT` (after `candidate_digest`... place them at the end before the three `null` placeholders, keeping the positional order and the `?` count in sync) and bind the five values. Guard the results insert the same way as the run insert (next step).

5. Atomic claim and guarded inserts. Replace the plain `INSERT INTO runs(...) VALUES (...)` with `INSERT INTO runs(...) SELECT ?,?,... WHERE ${STORED_KEY_SUBQUERY} = ?` binding the same values, then the three triple params and `profileKey`; prepend `claimProfileStmt(db, { ...triple, key: profileKey, now })` as the first statement (after the settings-profile insert). Guard each results insert with `... SELECT ... WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?)` binding `signed.run_id`. When `payload.excluded` is present, bind `excluded_at = now`, `excluded_code`, `excluded_reason` in the run insert (three more columns), and push `appendAuditStmt(db, { event: "run.auto_excluded", details: { run_id: signed.run_id, code, reason, attempts } })`; an excluded run must NOT hold the profile, so for that case skip the claim statement and change the run-insert guard to `WHERE 1 = 1`.

6. After `await db.batch(statements)`, verify the run landed:

```ts
    const landed = await db.prepare(`SELECT id FROM runs WHERE id = ?`).bind(signed.run_id).first();
    if (!landed) {
      const stored = await readProfile(db, triple);
      const holders = await conflictingRunIds(db, triple, signed.run_id);
      throw new ApiError(
        409,
        "upstream_profile_conflict",
        `model ${payload.model.slug} on this task set and mode already has upstream profile ${stored?.key ?? "?"} (runs: ${holders.join(", ") || "none"}); this run carries ${profileKey}. Exclude the stored cohort first, or re-ingest with the same pin.`,
      );
    }
```

- [ ] **Step 6: Run the worker tests**

`cd site && npm run build && npx vitest run tests/migrations.test.ts tests/api/runs-ingest-upstream.test.ts tests/api/runs-ingest.test.ts && npm run check`
Expected: PASS, `svelte-check` clean. If `npm run check` flags the five new `ResultInput` fields as unknown in an existing test, the Task 11 type change did not reach `site/src/lib/shared/types.ts`; fix there.

- [ ] **Step 7: Commit**

```bash
git add site/migrations/0023_results_upstream.sql site/src/lib/server/upstream-profile.ts site/src/lib/server/audit.ts site/src/routes/api/v1/runs/+server.ts site/tests/migrations.test.ts site/tests/api/runs-ingest-upstream.test.ts
git commit -m "feat(site): migration 0023 upstream columns, profile registry claimed in the ingest batch, atomic auto-exclusion

Five nullable per-result columns with no default so historical rows read
as unknown, a run-level excluded_code, and an upstream_profiles registry
keyed on model, set and mode. Ingest claims the profile with an insert
that does nothing on conflict, then inserts the run and results only where
the stored key equals its own, so a losing concurrent claimant inserts
nothing and is answered 409 naming the holders. A compromised run is
stored already excluded, with its audit event, in the same batch.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 13: Exclude and include maintain the registry; per-attempt admin backfill

**Files:**
- Modify: `site/src/routes/api/v1/admin/runs/exclude/+server.ts:88-160`
- Create: `site/src/routes/api/v1/admin/runs/upstream/+server.ts`
- Test: `site/tests/api/admin-run-exclude.test.ts` (extend), `site/tests/api/admin-runs-upstream.test.ts`

**Interfaces:**
- Consumes: `releaseProfileIfEmptyStmt`, `claimProfileStmt`, `readProfile`, `conflictingRunIds`, `profileKeyOf` (Task 12).
- Produces: `POST /api/v1/admin/runs/upstream` with body `{ run_id: string; results: Array<{ task_id: string; attempt: 1 | 2; served_upstream: string }> }`; response `{ ok: true, run_id, updated: number }`; errors `404 run_not_found`, `400 duplicate_attempt`, `409 already_set` (naming the first conflicting row).

- [ ] **Step 1: Write the failing tests**

Append to `site/tests/api/admin-run-exclude.test.ts` (its `beforeEach` seeds run `r1` on set `ts`, model 1; add `invocation_mode` to that insert if the column is not defaulted, and seed a registry row):

```ts
  it("excluding the last run of a profile releases the registry row; including re-claims it", async () => {
    await env.DB.prepare(`INSERT INTO upstream_profiles(model_id,task_set_hash,invocation_mode,profile_key,claimed_at) VALUES (1,'ts','sync','<unpinned>','2026-01-01T00:00:00Z')`).run();
    expect((await post({ run_id: "r1", reason: REASON, exclude: true })).status).toBe(200);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM upstream_profiles`).first<{ n: number }>().then((r) => Number(r?.n))).toBe(0);
    expect((await post({ run_id: "r1", reason: "", exclude: false })).status).toBe(200);
    const prof = await env.DB.prepare(`SELECT profile_key FROM upstream_profiles`).first<{ profile_key: string }>();
    expect(prof?.profile_key).toBe("<unpinned>");
  });

  it("including a run that would reintroduce a conflicting profile is refused with 409", async () => {
    // r1 is unpinned. Seed a pinned run r2 on the same triple that currently holds the profile.
    await env.DB.batch([
      env.DB.prepare(`UPDATE runs SET excluded_at='2026-01-02T00:00:00Z', excluded_reason='old' WHERE id='r1'`),
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_json) VALUES ('r2','ts',1,'s','rig','2026-01-03T00:00:00Z','completed','claimed','v1','sig','2026-01-03T00:00:00Z',?, '{}', '{"upstream_pin":"novita/fp8"}')`).bind(keyId),
      env.DB.prepare(`INSERT INTO upstream_profiles(model_id,task_set_hash,invocation_mode,profile_key,claimed_at) VALUES (1,'ts','sync','novita/fp8','2026-01-03T00:00:00Z')`),
    ]);
    const res = await post({ run_id: "r1", reason: "", exclude: false });
    expect(res.status).toBe(409);
    expect((await res.json<{ code: string }>()).code).toBe("upstream_profile_conflict");
    const still = await runRow("r1");
    expect(still?.excluded_at).toBeTruthy();
  });
```

The run's own profile key is read from `runs.invocation_json` (`upstream_pin`), `<unpinned>` when absent.

Create `site/tests/api/admin-runs-upstream.test.ts` mirroring the exclude test's setup, plus two seeded result rows for `r1` (task `t1` attempts 1 and 2, `served_upstream` NULL):

```ts
  it("sets served_upstream per attempt, marks rows unpinned from the provider field, audits and bumps", async () => {
    const res = await post({ run_id: "r1", results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }, { task_id: "t1", attempt: 2, served_upstream: "Google" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, run_id: "r1", updated: 2 });
    const rows = (await env.DB.prepare(`SELECT attempt, served_upstream, upstream_identity_source, upstream_verification, requested_upstream FROM results WHERE run_id='r1' ORDER BY attempt`).all()).results;
    expect(rows).toEqual([
      { attempt: 1, served_upstream: "Google", upstream_identity_source: "provider_field", upstream_verification: "unpinned", requested_upstream: null },
      { attempt: 2, served_upstream: "Google", upstream_identity_source: "provider_field", upstream_verification: "unpinned", requested_upstream: null },
    ]);
    const audit = await env.DB.prepare(`SELECT event FROM admin_audit ORDER BY id DESC LIMIT 1`).first<{ event: string }>();
    expect(audit?.event).toBe("run.upstream_backfilled");
  });

  it("refuses duplicates in one request and a row that already holds a different value", async () => {
    const dup = await post({ run_id: "r1", results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }, { task_id: "t1", attempt: 1, served_upstream: "Google" }] });
    expect(dup.status).toBe(400);
    expect((await dup.json<{ code: string }>()).code).toBe("duplicate_attempt");
    await env.DB.prepare(`UPDATE results SET served_upstream='Fireworks' WHERE run_id='r1' AND attempt=1`).run();
    const conflict = await post({ run_id: "r1", results: [{ task_id: "t1", attempt: 1, served_upstream: "Google" }] });
    expect(conflict.status).toBe(409);
    expect((await conflict.json<{ code: string; error: string }>()).error).toContain("Fireworks");
  });

  it("404s an unknown run", async () => {
    expect((await post({ run_id: "nope", results: [] })).status).toBe(404);
  });
```

- [ ] **Step 2: Run to verify failure**

`cd site && npm run build && npx vitest run tests/api/admin-run-exclude.test.ts tests/api/admin-runs-upstream.test.ts`
Expected: FAIL.

- [ ] **Step 3: Registry maintenance in exclude/include**

In `exclude/+server.ts`, after loading `existing`, also select `runs.model_id, runs.task_set_hash, runs.invocation_mode, runs.invocation_json`, derive `triple` and `key = profileKeyOf(JSON.parse(invocation_json ?? "{}").upstream_pin ?? null)`. For exclude: batch `[update, releaseProfileIfEmptyStmt(db, triple), forceBumpDataEpochStmt(db)]` and keep the audit call. For include: first `readProfile(db, triple)`; if a row exists with a different key, throw `409 upstream_profile_conflict` naming the stored key and `conflictingRunIds`; otherwise batch `[update, claimProfileStmt(db, { ...triple, key, now }), forceBumpDataEpochStmt(db)]`.

- [ ] **Step 4: Backfill endpoint**

```ts
// site/src/routes/api/v1/admin/runs/upstream/+server.ts
import type { RequestHandler } from "./$types";
import { forceBumpDataEpochStmt } from "$lib/server/data-epoch";
import { type SignedAdminRequest, verifySignedRequest } from "$lib/server/signature";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import { appendAuditStmt } from "$lib/server/audit";

interface Entry { task_id: string; attempt: 1 | 2; served_upstream: string }
interface Payload { run_id: string; results: Entry[] }

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, "no_platform", "platform env missing"));
  const db = platform.env.DB;
  try {
    const body = (await request.json()) as { version: number; signature: unknown; payload: Payload };
    if (body.version !== 1) throw new ApiError(400, "bad_version", "only version 1 supported");
    const verified = await verifySignedRequest(db, body as unknown as SignedAdminRequest, "admin");
    const p = body.payload;
    if (!p || typeof p.run_id !== "string" || p.run_id === "") throw new ApiError(400, "missing_field", "run_id required");
    if (!Array.isArray(p.results)) throw new ApiError(400, "missing_field", "results must be an array");
    const seen = new Set<string>();
    for (const e of p.results) {
      if (!e || typeof e.task_id !== "string" || (e.attempt !== 1 && e.attempt !== 2) || typeof e.served_upstream !== "string" || e.served_upstream.length === 0 || e.served_upstream.length > 128) {
        throw new ApiError(400, "invalid_entry", "each entry needs task_id, attempt 1|2 and a served_upstream of 1..128 chars");
      }
      const k = `${e.task_id}#${e.attempt}`;
      if (seen.has(k)) throw new ApiError(400, "duplicate_attempt", `duplicate (${e.task_id}, ${e.attempt}) in request`);
      seen.add(k);
    }
    const run = await db.prepare(`SELECT id FROM runs WHERE id = ?`).bind(p.run_id).first();
    if (!run) throw new ApiError(404, "run_not_found", `run ${p.run_id} not found`);

    for (const e of p.results) {
      const row = await db.prepare(`SELECT served_upstream FROM results WHERE run_id = ? AND task_id = ? AND attempt = ?`).bind(p.run_id, e.task_id, e.attempt).first<{ served_upstream: string | null }>();
      if (row && row.served_upstream !== null && row.served_upstream !== e.served_upstream) {
        throw new ApiError(409, "already_set", `(${e.task_id}, ${e.attempt}) already holds served_upstream ${row.served_upstream}`);
      }
    }
    const stmts = p.results.map((e) =>
      db.prepare(
        `UPDATE results SET served_upstream = ?, upstream_identity_source = 'provider_field', upstream_verification = 'unpinned', requested_upstream = NULL
         WHERE run_id = ? AND task_id = ? AND attempt = ?`,
      ).bind(e.served_upstream, p.run_id, e.task_id, e.attempt)
    );
    stmts.push(appendAuditStmt(db, { event: "run.upstream_backfilled", actor: verified, details: { run_id: p.run_id, count: p.results.length } }));
    stmts.push(forceBumpDataEpochStmt(db));
    await db.batch(stmts);
    return jsonResponse({ ok: true, run_id: p.run_id, updated: p.results.length }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Run the worker tests**

`cd site && npm run build && npx vitest run tests/api/admin-run-exclude.test.ts tests/api/admin-runs-upstream.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/admin/runs/exclude/+server.ts site/src/routes/api/v1/admin/runs/upstream/+server.ts site/tests/api/admin-run-exclude.test.ts site/tests/api/admin-runs-upstream.test.ts
git commit -m "feat(site): exclude and include maintain the upstream profile registry; per-attempt backfill endpoint

Excluding the last non-excluded run of a profile releases the registry row
so a replacement cohort can claim the triple; include re-claims it and is
refused with 409 when that would reintroduce a conflict. The backfill
endpoint sets served_upstream per (task, attempt), marks the rows
unpinned, refuses duplicates and conflicting values, and never writes one
value across a run.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 14: Site read paths: run detail (v1 + v2), leaderboard `upstream`, chips, cache bump

**Files:**
- Modify: `site/src/routes/api/v1/runs/[id]/+server.ts:33-75` (row + attempt types), `:100-140` (queries), `:270-300` (body)
- Modify: `site/src/routes/api/v2/runs/[id]/+server.ts:31-45` (row type), `:95-140` (query + map)
- Modify: `site/src/lib/shared/api-types.ts:459-520` (`PerTaskResult`, `RunDetail`), `:85-215` (`LeaderboardRow`), `:1170-1210` (`RunV2Detail`)
- Modify: `site/src/lib/server/leaderboard.ts:513-600` (add the upstream merge query beside the fallback one), `:640-670` (row map)
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte:155-190`, `site/src/lib/components/domain/LeaderboardRowDetail.svelte:28-36`, `site/src/routes/runs/[id]/+page.svelte:120-150`
- Create: `site/src/lib/client/upstream-chip.ts`
- Modify: `site/src/lib/server/cache-version.ts:52`
- Test: `site/tests/api/runs-detail-upstream.test.ts` (new), `site/tests/api/leaderboard.test.ts` (extend the shape assertion at ~line 192), `site/tests/unit/upstream-chip.test.ts` (new, vitest unit config)

**Interfaces:**
- Consumes: columns from Task 12 (`results.requested_upstream`, `served_upstream`, `served_upstream_model`, `upstream_identity_source`, `upstream_verification`, `runs.excluded_code`, `runs.invocation_json.upstream_pin`).
- Produces (wire shapes, `site/src/lib/shared/api-types.ts`):
  ```ts
  export type UpstreamVerification = "not_applicable" | "unpinned" | "verified" | "mismatch" | "unverified" | "not_served";
  export interface AttemptUpstream {
    requested: string | null;
    served: string | null;
    served_model: string | null;
    identity_source: "provider_field" | "router_metadata" | "both" | null;
    verification: UpstreamVerification | null;   // null = row predates capture
  }
  export interface RunUpstreamSummary {
    pin: string | null;
    served: string[];                 // distinct non-null served_upstream, sorted
    served_model: string[];           // distinct non-null served_upstream_model, sorted
    verification: Partial<Record<UpstreamVerification | "unrecorded", number>>;
    excluded_code: string | null;
  }
  export interface LeaderboardUpstream {
    pin: string | null;               // the registry profile key, null for <unpinned>
    served: string[];
    verification: Partial<Record<UpstreamVerification | "unrecorded", number>>;
  }
  // PerTaskResult.attempts[i].upstream: AttemptUpstream
  // RunDetail.upstream: RunUpstreamSummary; RunDetail.excluded_code: string | null
  // RunV2Detail.results[i].upstream: AttemptUpstream; RunV2Detail.upstream: RunUpstreamSummary
  // LeaderboardRow.upstream: LeaderboardUpstream
  ```
- Produces (`site/src/lib/client/upstream-chip.ts`):
  ```ts
  export type ChipTone = "verified" | "unpinned" | "warn" | "mixed" | "unrecorded";
  export interface UpstreamChip { tone: ChipTone; label: string; title: string }
  export function upstreamChip(u: LeaderboardUpstream): UpstreamChip | null;   // null = nothing to show (non-OpenRouter)
  ```

- [ ] **Step 1: Write the failing worker tests**

`site/tests/api/runs-detail-upstream.test.ts`. Copy the `seedRunRefData` function and the `beforeEach` from `site/tests/api/v2-runs.test.ts` verbatim (it resets the db, seeds a model, seeds the taxonomy set `HASH` and applies a revision, which the v2 route needs), then insert the run and results directly with a registered key id:

```ts
import { HASH } from "../fixtures/taxonomy-v2";
import { registerIngestKey } from "../fixtures/ingest-helpers";

describe("run detail upstream fields", () => {
  beforeEach(async () => {
    const { keyId } = await registerIngestKey();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,invocation_json,excluded_at,excluded_code,excluded_reason)
                      VALUES ('r-up',?,1,'s','rig','2026-09-10T00:00:00Z','completed','verified','v1','sig','2026-09-10T00:00:00Z',?,'{}','batch','{"upstream_pin":"novita/fp8"}','2026-09-10T01:00:00Z','upstream_mismatch','upstream mismatch on 1 attempt')`).bind(HASH, keyId),
      env.DB.prepare(`INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,requested_upstream,served_upstream,served_upstream_model,upstream_identity_source,upstream_verification)
                      VALUES ('r-up','easy/t1',1,1,100,1,'[]',1,1,10,10,0,0,'novita/fp8','Novita','v1','both','verified')`),
      env.DB.prepare(`INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,requested_upstream,served_upstream,served_upstream_model,upstream_identity_source,upstream_verification)
                      VALUES ('r-up','easy/t2',1,0,0,1,'[]',1,0,10,10,0,0,'novita/fp8','Together','v2','provider_field','mismatch')`),
      env.DB.prepare(`INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write)
                      VALUES ('r-up','easy/t3',1,0,0,1,'[]',1,0,10,10,0,0)`),
    ]);
  });

  it("v1 carries per-attempt upstream and a run summary with excluded_code", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r-up");
    expect(res.status).toBe(200);
    const body = await res.json<RunDetail>();
    expect(body.excluded_code).toBe("upstream_mismatch");
    expect(body.upstream).toEqual({
      pin: "novita/fp8",
      served: ["Novita", "Together"],
      served_model: ["v1", "v2"],
      verification: { verified: 1, mismatch: 1, unrecorded: 1 },
      excluded_code: "upstream_mismatch",
    });
    const t1 = body.results.find((r) => r.task_id === "easy/t1")!;
    expect(t1.attempts[0]!.upstream).toEqual({ requested: "novita/fp8", served: "Novita", served_model: "v1", identity_source: "both", verification: "verified" });
    const t3 = body.results.find((r) => r.task_id === "easy/t3")!;
    expect(t3.attempts[0]!.upstream).toEqual({ requested: null, served: null, served_model: null, identity_source: null, verification: null });
  });

  it("v2 carries the same fields", async () => {
    const res = await SELF.fetch("https://x/api/v2/runs/r-up");
    expect(res.status).toBe(200);
    const body = await res.json<RunV2Detail>();
    expect(body.upstream.pin).toBe("novita/fp8");
    expect(body.upstream.verification).toEqual({ verified: 1, mismatch: 1, unrecorded: 1 });
    expect(body.results.find((r) => r.task_id === "easy/t2")!.upstream.verification).toBe("mismatch");
  });
});
```

The `easy/t1` .. `easy/t3` task ids need no `tasks` rows for these assertions (the v1 route LEFT JOINs `tasks` for difficulty).

In `site/tests/api/leaderboard.test.ts`, at the row-shape assertion near line 192, add `"upstream"` to the expected key list, and add one test:

```ts
  it("reports the model's upstream profile and served set per row", async () => {
    // Seed helper from this file; then stamp the model's runs with a pin and its results with served upstreams.
    await env.DB.prepare(`UPDATE runs SET invocation_json = '{"upstream_pin":"novita/fp8"}' WHERE model_id = 1`).run();
    await env.DB.prepare(`UPDATE results SET requested_upstream='novita/fp8', served_upstream='Novita', served_upstream_model='v1', upstream_identity_source='both', upstream_verification='verified' WHERE run_id IN (SELECT id FROM runs WHERE model_id = 1)`).run();
    await env.DB.prepare(`INSERT INTO upstream_profiles(model_id,task_set_hash,invocation_mode,profile_key,claimed_at) VALUES (1,?, 'sync','novita/fp8','2026-09-10T00:00:00Z')`).bind(TS_HASH).run();
    const res = await SELF.fetch(`https://x/api/v1/leaderboard?set=${TS_HASH}&mode=sync`);
    const body = await res.json<{ data: LeaderboardRow[] }>();
    const row = body.data.find((r) => r.model.slug === MODEL_1_SLUG)!;
    expect(row.upstream.pin).toBe("novita/fp8");
    expect(row.upstream.served).toEqual(["Novita"]);
    expect(row.upstream.verification.verified).toBeGreaterThan(0);
    expect(row.upstream.verification.unrecorded).toBeUndefined();
  });
```

Use the constants that file already defines for the seeded hash and slug (read the top of the file; the names above are placeholders for those constants, not new ones).

`site/tests/unit/upstream-chip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { upstreamChip } from "../../src/lib/client/upstream-chip";

describe("upstreamChip", () => {
  it("hides the chip when nothing was ever recorded and there is no pin", () => {
    expect(upstreamChip({ pin: null, served: [], verification: {} })).toBeNull();
    expect(upstreamChip({ pin: null, served: [], verification: { not_applicable: 400 } })).toBeNull();
  });
  it("green for a pin whose rows are all verified", () => {
    const c = upstreamChip({ pin: "novita/fp8", served: ["Novita"], verification: { verified: 400 } })!;
    expect(c.tone).toBe("verified");
    expect(c.label).toBe("novita/fp8");
  });
  it("neutral for unpinned rows, naming the served set", () => {
    const c = upstreamChip({ pin: null, served: ["Google"], verification: { unpinned: 400 } })!;
    expect(c.tone).toBe("unpinned");
    expect(c.label).toBe("unpinned · Google");
  });
  it("red mixed when more than one upstream served", () => {
    const c = upstreamChip({ pin: null, served: ["Google", "Vertex"], verification: { unpinned: 400 } })!;
    expect(c.tone).toBe("mixed");
    expect(c.label).toBe("mixed · Google, Vertex");
  });
  it("amber when any row is unverified, not_served or mismatch", () => {
    for (const k of ["unverified", "not_served", "mismatch"] as const) {
      const c = upstreamChip({ pin: "p", served: ["P"], verification: { verified: 10, [k]: 1 } })!;
      expect(c.tone, k).toBe("warn");
    }
  });
  it("grey unrecorded when every row predates capture", () => {
    const c = upstreamChip({ pin: null, served: [], verification: { unrecorded: 400 } })!;
    expect(c.tone).toBe("unrecorded");
    expect(c.label).toBe("upstream unrecorded");
  });
});
```

- [ ] **Step 2: Run to verify failure**

`cd site && npm run build && npx vitest run tests/api/runs-detail-upstream.test.ts tests/api/leaderboard.test.ts && npx vitest run --config vitest.unit.config.ts tests/unit/upstream-chip.test.ts`
Expected: FAIL (fields absent; module not found).

- [ ] **Step 3: Types**

In `site/src/lib/shared/api-types.ts` add the types from the Interfaces block above (place them just before `PerTaskResult`). Add `upstream: AttemptUpstream` to `PerTaskResult.attempts[]`, `upstream: RunUpstreamSummary` and `excluded_code: string | null` to `RunDetail`, `upstream: AttemptUpstream` to `RunV2Detail.results[]` and `upstream: RunUpstreamSummary` to `RunV2Detail`, and `upstream: LeaderboardUpstream` to `LeaderboardRow` with this doc comment:

```ts
  /**
   * OpenRouter upstream lock (migration 0023). `pin` is the profile every
   * in-scope run of this model was ingested under (`null` when the cohort is
   * unpinned); `served` is every distinct upstream that actually answered;
   * `verification` counts result rows per state, with `unrecorded` for rows
   * that predate capture. Same scope as `fallback_count`: the task set and
   * mode, not the row's other filters.
   */
```

- [ ] **Step 4: A shared summariser**

Create `site/src/lib/server/upstream-summary.ts`:

```ts
import type { AttemptUpstream, RunUpstreamSummary, UpstreamVerification } from "$lib/shared/api-types";

export interface UpstreamRow {
  requested_upstream: string | null;
  served_upstream: string | null;
  served_upstream_model: string | null;
  upstream_identity_source: string | null;
  upstream_verification: string | null;
}

export function attemptUpstream(r: UpstreamRow): AttemptUpstream {
  return {
    requested: r.requested_upstream ?? null,
    served: r.served_upstream ?? null,
    served_model: r.served_upstream_model ?? null,
    identity_source: (r.upstream_identity_source ?? null) as AttemptUpstream["identity_source"],
    verification: (r.upstream_verification ?? null) as UpstreamVerification | null,
  };
}

export function pinFromInvocationJson(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    const v = (JSON.parse(json) as { upstream_pin?: unknown }).upstream_pin;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function summariseUpstream(rows: UpstreamRow[], pin: string | null, excludedCode: string | null): RunUpstreamSummary {
  const served = new Set<string>();
  const servedModel = new Set<string>();
  const verification: RunUpstreamSummary["verification"] = {};
  for (const r of rows) {
    if (r.served_upstream) served.add(r.served_upstream);
    if (r.served_upstream_model) servedModel.add(r.served_upstream_model);
    const k = (r.upstream_verification ?? "unrecorded") as keyof RunUpstreamSummary["verification"];
    verification[k] = (verification[k] ?? 0) + 1;
  }
  return {
    pin,
    served: [...served].sort(),
    served_model: [...servedModel].sort(),
    verification,
    excluded_code: excludedCode,
  };
}
```

- [ ] **Step 5: v1 and v2 run detail**

v1 (`site/src/routes/api/v1/runs/[id]/+server.ts`): add `excluded_code: string | null` and `invocation_json: string | null` to `RunRow` and to the run `SELECT`; add the five `UpstreamRow` fields to `ResultRow` and select `v.requested_upstream, v.served_upstream, v.served_upstream_model, v.upstream_identity_source, v.upstream_verification` (the view exposes them after 0023); add `upstream: AttemptUpstream` to `AttemptOut`, filled with `attemptUpstream(r)` in the grouping loop; in the response body add `excluded_code: run.excluded_code ?? null` and `upstream: summariseUpstream(results, pinFromInvocationJson(run.invocation_json), run.excluded_code ?? null)`.

v2 (`site/src/routes/api/v2/runs/[id]/+server.ts`): add the five fields to `ResultV2Row` and the `SELECT`; add `runs.excluded_code` to the run `SELECT` and `RunV2DetailRow`; map `upstream: attemptUpstream(r)` per result and `upstream: summariseUpstream(resultRows, pinFromInvocationJson(run.invocation_json), run.excluded_code ?? null)` on the body.

- [ ] **Step 6: Leaderboard merge query**

In `site/src/lib/server/leaderboard.ts`, directly after the fallback/refusal block (before `const mapped`), add a second merge query with the same scope rules (mode predicate, excluded predicate, `taskSetWhere`, `modelIds`), and a registry read:

```ts
  // upstream (spec 2026-09-11 D5): the profile every in-scope run of the model
  // was ingested under, the distinct upstreams that actually served, and the
  // verification-state histogram. Same scope caveat as fallback_count.
  const upstreamByModel = new Map<number, LeaderboardUpstream>();
  if (modelIds.length > 0) {
    const upWheres = [modePredicate("runs"), excludedPredicate("runs")];
    const upParams: Array<string | number> = [q.mode];
    if (taskSetWhere) {
      upWheres.push(taskSetWhere);
      upParams.push(...taskSetWhereParams);
    }
    upWheres.push(`runs.model_id IN (${modelIds.map(() => "?").join(",")})`);
    upParams.push(...modelIds);
    const upSql = `
      SELECT runs.model_id AS model_id,
             results.served_upstream AS served,
             COALESCE(results.upstream_verification, 'unrecorded') AS state,
             COUNT(*) AS n
      FROM results
      JOIN runs ON runs.id = results.run_id
      WHERE ${upWheres.join(" AND ")}
      GROUP BY runs.model_id, results.served_upstream, COALESCE(results.upstream_verification, 'unrecorded')
    `;
    type UpRow = { model_id: number; served: string | null; state: string; n: number };
    const upRows = await getAll<UpRow>(db, upSql, upParams);
    for (const r of upRows) {
      const id = Number(r.model_id);
      const cur = upstreamByModel.get(id) ?? { pin: null, served: [], verification: {} };
      if (r.served && !cur.served.includes(r.served)) cur.served.push(r.served);
      const k = r.state as keyof LeaderboardUpstream["verification"];
      cur.verification[k] = (cur.verification[k] ?? 0) + Number(r.n);
      upstreamByModel.set(id, cur);
    }
    for (const u of upstreamByModel.values()) u.served.sort();
    // The pin comes from the registry, keyed on the concrete set + mode. Under
    // `set=current` the hash was resolved above; use that resolved value.
    if (resolvedTaskSetHash) {
      const pinRows = await getAll<{ model_id: number; profile_key: string }>(
        db,
        `SELECT model_id, profile_key FROM upstream_profiles WHERE task_set_hash = ? AND invocation_mode = ? AND model_id IN (${modelIds.map(() => "?").join(",")})`,
        [resolvedTaskSetHash, q.mode, ...modelIds],
      );
      for (const p of pinRows) {
        const cur = upstreamByModel.get(Number(p.model_id)) ?? { pin: null, served: [], verification: {} };
        cur.pin = p.profile_key === "<unpinned>" ? null : p.profile_key;
        upstreamByModel.set(Number(p.model_id), cur);
      }
    }
  }
```

`resolvedTaskSetHash` is whatever local the ranked query already uses for the concrete hash (the same value `getTierMap` receives); read the function to find its name and use that. In the row map add `upstream: upstreamByModel.get(r.model_id) ?? { pin: null, served: [], verification: {} }`.

- [ ] **Step 7: Chip helper and Svelte**

`site/src/lib/client/upstream-chip.ts`:

```ts
import type { LeaderboardUpstream } from "$lib/shared/api-types";

export type ChipTone = "verified" | "unpinned" | "warn" | "mixed" | "unrecorded";
export interface UpstreamChip { tone: ChipTone; label: string; title: string }

const WARN_STATES = ["unverified", "not_served", "mismatch"] as const;

/** Null when the model never went through OpenRouter (nothing to say). */
export function upstreamChip(u: LeaderboardUpstream): UpstreamChip | null {
  const v = u.verification;
  const total = Object.values(v).reduce((a, b) => a + (b ?? 0), 0);
  const na = v.not_applicable ?? 0;
  if (u.pin === null && total - na === 0) return null;
  const unrecorded = v.unrecorded ?? 0;
  if (u.pin === null && unrecorded === total - na) {
    return { tone: "unrecorded", label: "upstream unrecorded", title: "These runs predate upstream capture; which OpenRouter upstream served them is unknown." };
  }
  const warn = WARN_STATES.reduce((n, k) => n + (v[k] ?? 0), 0);
  if (u.served.length > 1) {
    return { tone: "mixed", label: `mixed · ${u.served.join(", ")}`, title: `More than one upstream served this cohort (${u.served.join(", ")}). Precision may differ between them.` };
  }
  if (warn > 0) {
    return { tone: "warn", label: u.pin ?? u.served[0] ?? "upstream", title: `${warn} of ${total} result rows could not be verified against the pin (unverified, not served, or mismatched).` };
  }
  if (u.pin !== null) {
    return { tone: "verified", label: u.pin, title: `Every result was served by the pinned upstream ${u.pin}${u.served[0] ? ` (${u.served[0]})` : ""}.` };
  }
  return { tone: "unpinned", label: `unpinned · ${u.served[0] ?? "unknown"}`, title: `No upstream was pinned; OpenRouter routed to ${u.served[0] ?? "an unrecorded upstream"} on every recorded result.` };
}
```

`LeaderboardTable.svelte`: import `upstreamChip`; inside the `headline` span after the refusal badge:

```svelte
              {@const chip = upstreamChip(row.upstream)}
              {#if chip}
                <span class="upstream-chip upstream-{chip.tone}" data-test="upstream-chip" title={chip.title} aria-label={chip.title}>{chip.label}</span>
              {/if}
```

(`{@const}` must sit directly inside a block; if the surrounding markup is not a block, compute `const chips = $derived(rows.map((r) => upstreamChip(r.upstream)))` in the script and index by row position.) Styles beside `.fallback-badge`: one class per tone using existing tokens (`--ok`, `--warn`, `--danger`, `--muted`), `font-size: 0.7rem`, pill radius, `margin-left: 0.35rem`.

`LeaderboardRowDetail.svelte`: after the refusal `<dt>`, add

```svelte
      {#if row.upstream.pin !== null || row.upstream.served.length > 0}
        <div><dt>Upstream</dt><dd>{row.upstream.pin ?? "unpinned"}{#if row.upstream.served.length > 0} · served by {row.upstream.served.join(", ")}{/if}</dd></div>
      {/if}
```

`routes/runs/[id]/+page.svelte`: in `.meta` after `machine:`, add `{#if r.upstream.pin !== null || r.upstream.served.length > 0}· served by: <code class="text-mono">{r.upstream.served.join(", ") || "unrecorded"}</code>{#if r.upstream.pin}(pinned {r.upstream.pin}){/if}{/if}`; in the excluded note, when `r.excluded_code` is set, prefix the reason with `[{r.excluded_code}]`.

- [ ] **Step 8: Cache version**

`site/src/lib/server/cache-version.ts`: append to the comment block

```
 * v15: OpenRouter upstream lock (migration 0023). Leaderboard rows gained
 *   `upstream`; run detail gained per-attempt `upstream`, a run summary and
 *   `excluded_code`. Shape change, so no v14 entry may be served on.
```

and set `CACHE_VERSION = "v15"`. If the worktree's constant is already above v14 when this task runs (the p95 work in the main tree also bumps it), take the next number and keep both notes.

- [ ] **Step 9: Run the worker tests**

`cd site && npm run build && npm run test:main && npm run check`
Expected: PASS, `svelte-check` 0 errors. Hand-format any touched `.svelte`/`.ts` under `site/` (no prettier; single quotes are NOT the site convention, keep the file's existing style).

- [ ] **Step 10: Commit**

```bash
git add site/src/lib/shared/api-types.ts site/src/lib/server/upstream-summary.ts site/src/lib/server/leaderboard.ts site/src/lib/client/upstream-chip.ts site/src/lib/server/cache-version.ts "site/src/routes/api/v1/runs/[id]/+server.ts" "site/src/routes/api/v2/runs/[id]/+server.ts" "site/src/routes/runs/[id]/+page.svelte" site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardRowDetail.svelte site/tests/api/runs-detail-upstream.test.ts site/tests/api/leaderboard.test.ts site/tests/unit/upstream-chip.test.ts
git commit -m "feat(site): surface upstream identity on run detail and the leaderboard

Per-attempt upstream fields and a run-level summary on both run detail
routes, an upstream profile and served set per leaderboard row from a
merge query scoped like fallback_count, and a chip whose tone says
verified, unpinned, mixed, warn or unrecorded. Cache version bumped for
the shape change.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---
### Task 15: CLI: `models --upstreams`, `runs backfill-upstream`, pin resolution in both prechecks, `--skip-upstream-preflight`, live verification

**Files:**
- Create: `cli/commands/bench/upstream-precheck.ts`, `src/ingest/upstream-backfill.ts`
- Modify: `cli/commands/models-command.ts:626-700` (new `--upstreams` and `--pin` options and branch), `cli/commands/runs-command.ts:190-260` (new subcommand), `cli/commands/bench-command.ts` (option + precheck wiring near line 568, options plumbing near 684), `cli/commands/bench-batch-command.ts:440-480` (submit deps), `cli/types/cli-types.ts:14` (`ExtendedBenchmarkOptions`), `cli/commands/bench/parallel-executor.ts:1295-1340` (`buildParallelOptions`)
- Test: `tests/unit/cli/bench/upstream-precheck.test.ts`, `tests/unit/ingest/upstream-backfill.test.ts`, `tests/unit/cli/runs-backfill-upstream.test.ts`

**Interfaces:**
- Consumes: `fetchUpstreams`, `resolveUpstreamPin`, `ResolvedUpstreamPin`, `UpstreamPinError`, `UpstreamPinDeps` (Task 7, `src/llm/upstream-pin.ts`); `upstreamPinFor` (Task 6, `src/config/openrouter.ts`); `ParallelBenchmarkOptions.upstreamPins` (Task 8); `SubmitDeps.resolveUpstream` / `SubmitDeps.skipUpstreamPreflight` (Task 9); the admin endpoint `POST /api/v1/admin/runs/upstream` (Task 13); `loadAdminConfig`, `readPrivateKey`, `signPayload`, `postWithRetry` (existing, used the same way by `postRunExclusion` in `src/ingest/run-exclusion.ts:259-304`).
- Produces:
  ```ts
  // cli/commands/bench/upstream-precheck.ts
  export const PROMPT_TOKENS_BOUND = 16_000;
  export type UpstreamPinMap = Map<string, { upstreamPin: string; providerName: string }>;   // keyed by ModelVariant.variantId
  export async function resolveUpstreamPins(input: {
    variants: ModelVariant[];
    config: CentralGaugeConfig;
    maxTokens: number;
    skipPreflight: boolean;
    apiKey: string;
    log: (line: string) => void;
    deps?: Partial<UpstreamPinDeps>;
  }): Promise<UpstreamPinMap>;                       // throws UpstreamPinError
  export function submitResolver(input: { skipPreflight: boolean; apiKey: string; deps?: Partial<UpstreamPinDeps> }):
    (apiModelId: string, pin: string, maxTokens: number) => Promise<ResolvedUpstreamPin>;
  // src/ingest/upstream-backfill.ts
  export interface UpstreamBackfillEntry { task_id: string; attempt: 1 | 2; served_upstream: string }
  export async function collectBatchServedUpstreams(runDir: string): Promise<{ entries: UpstreamBackfillEntry[]; skipped: Array<{ task_id: string; attempt: 1 | 2; why: string }> }>;
  export async function postUpstreamBackfill(config: Pick<AdminConfig, "url" | "adminKeyId">, adminPrivateKey: Uint8Array, req: { runId: string; results: UpstreamBackfillEntry[] }, opts?: { fetchFn?: RetryOptions["fetchFn"] }): Promise<{ status: number; ok: boolean; code?: string; message?: string; updated?: number }>;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/unit/cli/bench/upstream-precheck.test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import type { ModelVariant } from "../../../../src/llm/variant-types.ts";
import { UpstreamPinError } from "../../../../src/llm/upstream-pin.ts";
import { PROMPT_TOKENS_BOUND, resolveUpstreamPins, submitResolver } from "../../../../cli/commands/bench/upstream-precheck.ts";

const variant = (provider: string, model: string): ModelVariant => ({
  originalSpec: `${provider}/${model}`,
  baseModel: `${provider}/${model}`,
  provider,
  model,
  config: {},
  variantId: `${provider}/${model}`,
  hasVariant: false,
} as ModelVariant);

const endpointsJson = {
  data: {
    endpoints: [
      { tag: "novita/fp8", provider_name: "Novita", quantization: "fp8", context_length: 200000, max_completion_tokens: 128000, pricing: { completion: "0.0000022" }, status: 0 },
    ],
  },
};
const fetchFn = ((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/endpoints")) return Promise.resolve(new Response(JSON.stringify(endpointsJson), { status: 200 }));
  return Promise.resolve(new Response(JSON.stringify({ provider: "Novita", choices: [{ message: { content: "ok" } }] }), { status: 200 }));
}) as typeof fetch;

Deno.test("resolveUpstreamPins resolves only openrouter variants that have a pin", async () => {
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "novita/fp8" } } };
  const map = await resolveUpstreamPins({
    variants: [variant("openrouter", "z-ai/glm-5.3"), variant("openrouter", "google/gemini-3.8-flash"), variant("anthropic", "claude-opus-5")],
    config,
    maxTokens: 64000,
    skipPreflight: true,
    apiKey: "k",
    log: () => {},
    deps: { fetchFn },
  });
  assertEquals([...map.keys()], ["openrouter/z-ai/glm-5.3"]);
  assertEquals(map.get("openrouter/z-ai/glm-5.3"), { upstreamPin: "novita/fp8", providerName: "Novita" });
});

Deno.test("resolveUpstreamPins surfaces UpstreamPinError untouched", async () => {
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "together" } } };
  await assertRejects(
    () => resolveUpstreamPins({ variants: [variant("openrouter", "z-ai/glm-5.3")], config, maxTokens: 64000, skipPreflight: true, apiKey: "k", log: () => {}, deps: { fetchFn } }),
    UpstreamPinError,
    "together",
  );
});

Deno.test("submitResolver passes the prompt bound and the skip flag through", async () => {
  const r = await submitResolver({ skipPreflight: true, apiKey: "k", deps: { fetchFn } })("z-ai/glm-5.3", "novita/fp8", 64000);
  assertEquals(r.preflight, "skipped");
  assertEquals(PROMPT_TOKENS_BOUND, 16_000);
});
```

`tests/unit/ingest/upstream-backfill.test.ts` (build a fake batch run dir in a temp directory: `state.json` with two tasks, `responses/<itemId>.json` files whose `result.raw.provider` is set on one and missing on another):

```ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { collectBatchServedUpstreams, postUpstreamBackfill } from "../../../src/ingest/upstream-backfill.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("collectBatchServedUpstreams reads result.raw.provider per attempt and reports what it skipped", async () => {
  const dir = await createTempDir("backfill");
  try {
    await Deno.mkdir(join(dir, "responses"));
    await Deno.writeTextFile(join(dir, "state.json"), JSON.stringify({
      tasks: {
        "easy/t1": { attempt1: { itemId: "i1", state: "evaluated" }, attempt2: { itemId: "i2", state: "evaluated" } },
        "easy/t2": { attempt1: { itemId: "i3", state: "errored" } },
      },
    }));
    await Deno.writeTextFile(join(dir, "responses", "i1.json"), JSON.stringify({ result: { itemId: "i1", ok: true, raw: { provider: "Google", choices: [] }, httpStatus: 200 } }));
    await Deno.writeTextFile(join(dir, "responses", "i2.json"), JSON.stringify({ result: { itemId: "i2", ok: true, raw: { choices: [] }, httpStatus: 200 } }));
    const out = await collectBatchServedUpstreams(dir);
    assertEquals(out.entries, [{ task_id: "easy/t1", attempt: 1, served_upstream: "Google" }]);
    assertEquals(out.skipped.map((s) => `${s.task_id}#${s.attempt}:${s.why}`), ["easy/t1#2:no provider field", "easy/t2#1:no response file"]);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("postUpstreamBackfill signs and posts to the admin endpoint", async () => {
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    return Promise.resolve(new Response(JSON.stringify({ ok: true, run_id: "r1", updated: 1 }), { status: 200 }));
  }) as typeof fetch;
  const priv = new Uint8Array(32);
  const res = await postUpstreamBackfill({ url: "https://x", adminKeyId: 7 }, priv, { runId: "r1", results: [{ task_id: "easy/t1", attempt: 1, served_upstream: "Google" }] }, { fetchFn });
  assertEquals(res.ok, true);
  assertEquals(res.updated, 1);
  assertEquals(seen!.url, "https://x/api/v1/admin/runs/upstream");
  assertEquals((seen!.body["payload"] as Record<string, unknown>)["run_id"], "r1");
});
```

If `signPayload` refuses an all-zero key, generate one the way `tests/unit/ingest/run-exclusion.test.ts` does and reuse that helper.

`tests/unit/cli/runs-backfill-upstream.test.ts`: the command is exercised through its handler, exported as `handleBackfillUpstream(runId, options, deps)` with injectable `deps: { collect, post, loadConfig, readKey }`; assert it prints `[OK] run r1: 1 attempt updated, 2 skipped` and exits 0 for the fixture above, prints `[FAIL]` and exits 1 when the batch dir is missing (`No batch run directory at <path>; sync runs have no stored responses to backfill from`), and passes `--dry-run` through without calling `post` (prints the entries instead).

- [ ] **Step 2: Run to verify failure**

`deno test --allow-all tests/unit/cli/bench/upstream-precheck.test.ts tests/unit/ingest/upstream-backfill.test.ts tests/unit/cli/runs-backfill-upstream.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Precheck helper**

```ts
// cli/commands/bench/upstream-precheck.ts
/**
 * Resolves configured OpenRouter upstream pins for a bench's variants
 * (spec 2026-09-11 D2), shared by the sync bench and `bench batch submit`.
 */
import * as colors from "@std/fmt/colors";
import type { CentralGaugeConfig } from "../../../src/config/types.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import { upstreamPinFor } from "../../../src/config/openrouter.ts";
import {
  type ResolvedUpstreamPin,
  resolveUpstreamPin,
  type UpstreamPinDeps,
} from "../../../src/llm/upstream-pin.ts";

/**
 * Conservative bound on the longest rendered prompt in the suite, used for
 * the context-length capability check before any prompt is rendered. Raise
 * it if a template grows past it; the check is `context >= bound + maxTokens`.
 */
export const PROMPT_TOKENS_BOUND = 16_000;

export type UpstreamPinMap = Map<string, { upstreamPin: string; providerName: string }>;

export async function resolveUpstreamPins(input: {
  variants: ModelVariant[];
  config: CentralGaugeConfig;
  maxTokens: number;
  skipPreflight: boolean;
  apiKey: string;
  log: (line: string) => void;
  deps?: Partial<UpstreamPinDeps>;
}): Promise<UpstreamPinMap> {
  const out: UpstreamPinMap = new Map();
  for (const v of input.variants) {
    if (v.provider !== "openrouter") continue;
    const pin = upstreamPinFor(input.config, v.provider, v.model);
    if (pin === undefined) continue;
    const resolved = await resolveUpstreamPin(
      { apiModelId: v.model, pin, maxTokens: input.maxTokens, longestPromptTokens: PROMPT_TOKENS_BOUND, skipPreflight: input.skipPreflight },
      { apiKey: input.apiKey, ...input.deps },
    );
    out.set(v.variantId, { upstreamPin: resolved.upstreamPin, providerName: resolved.providerName });
    input.log(
      `${colors.cyan("[upstream]")} ${v.variantId} pinned to ${resolved.upstreamPin} (${resolved.providerName}` +
        `${resolved.quantization ? `, ${resolved.quantization}` : ""}), preflight ${resolved.preflight}`,
    );
  }
  return out;
}

export function submitResolver(input: { skipPreflight: boolean; apiKey: string; deps?: Partial<UpstreamPinDeps> }) {
  return (apiModelId: string, pin: string, maxTokens: number): Promise<ResolvedUpstreamPin> =>
    resolveUpstreamPin(
      { apiModelId, pin, maxTokens, longestPromptTokens: PROMPT_TOKENS_BOUND, skipPreflight: input.skipPreflight },
      { apiKey: input.apiKey, ...input.deps },
    );
}
```

- [ ] **Step 4: Wire the sync bench**

`cli/types/cli-types.ts`: add to `ExtendedBenchmarkOptions`

```ts
  /** OpenRouter upstream pins resolved at precheck, keyed by variantId (spec 2026-09-11 D2). */
  upstreamPins?: Map<string, { upstreamPin: string; providerName: string }>;
```

`cli/commands/bench/parallel-executor.ts` `buildParallelOptions`: after `promptOverrides`, `if (options.upstreamPins) parallelOptions.upstreamPins = options.upstreamPins;`.

`cli/commands/bench-command.ts`: add `.option("--skip-upstream-preflight", "Skip the 32-token OpenRouter upstream preflight (the pin is still enforced per request)")`. Inside the precheck block, after the doctor report passes (and also when `CENTRALGAUGE_BENCH_PRECHECK=0` or `--no-ingest`, because the pin is about routing, not ingest), resolve pins:

```ts
      // Upstream pins are resolved whether or not ingest is on: they decide
      // where every request goes, so a bench that skips ingest still pins.
      {
        const appConfig = await ConfigManager.loadConfig();
        const variants = ModelPresetRegistry.resolveWithVariants(benchOptions.llms, appConfig);
        try {
          const pins = await resolveUpstreamPins({
            variants,
            config: appConfig,
            maxTokens: benchOptions.maxTokens || DEFAULT_MAX_TOKENS,
            skipPreflight: options.skipUpstreamPreflight === true,
            apiKey: getApiKeyForProvider("openrouter") ?? "",
            log: (line) => console.log(line),
          });
          if (pins.size > 0) benchOptions.upstreamPins = pins;
        } catch (err) {
          if (err instanceof UpstreamPinError) {
            console.error(colors.red("[FAIL]") + ` upstream pin: ${err.message}`);
            console.error(colors.gray("       Run `centralgauge models <slug> --upstreams` to list the valid tags."));
            Deno.exit(1);
          }
          throw err;
        }
      }
```

`DEFAULT_MAX_TOKENS` and `getApiKeyForProvider` are already imported where `buildParallelOptions` and `models-command.ts` use them; import from the same modules.

- [ ] **Step 5: Wire batch submit**

`cli/commands/bench-batch-command.ts` submit command already has `--skip-upstream-preflight` and an inline `resolveUpstream` closure from Task 9. Replace that closure (keep the option) with:

```ts
        resolveUpstream: submitResolver({ skipPreflight: opts.skipUpstreamPreflight === true, apiKey }),
        skipUpstreamPreflight: opts.skipUpstreamPreflight === true,
```

and drop the now-unused `resolveUpstreamPin` import from that file.

(`apiKey` here is the batch provider key; for a non-OpenRouter provider `submitRuns` never calls the resolver.)

- [ ] **Step 6: `models --upstreams`**

In `cli/commands/models-command.ts` add options `--upstreams` ("List OpenRouter upstream endpoints (tag, provider, quantization, context, output price, status) for openrouter/* slugs") and `--pin <tag:string>` ("With --upstreams: resolve and preflight this tag against the first slug, one 32-token request"). Branch before `--check`:

```ts
      if (options.upstreams) {
        await EnvLoader.loadEnvironment();
        const apiKey = getApiKeyForProvider("openrouter") ?? "";
        for (const spec of specs) {
          if (!spec.startsWith("openrouter/")) {
            console.log(`${colors.yellow("[SKIP]")} ${spec}: --upstreams applies to openrouter/* slugs only`);
            continue;
          }
          const apiModelId = spec.slice("openrouter/".length);
          const endpoints = await fetchUpstreams(apiModelId, { apiKey });
          console.log(`${colors.cyan("[Upstreams]")} ${spec}: ${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`);
          console.log("  tag                            provider           quant   ctx        max_out   $/M out   status");
          for (const e of endpoints) {
            console.log(
              `  ${e.slug.padEnd(30)} ${e.providerName.padEnd(18)} ${(e.quantization ?? "-").padEnd(7)} ` +
                `${String(e.contextLength ?? "-").padEnd(10)} ${String(e.maxCompletionTokens ?? "-").padEnd(9)} ` +
                `${e.outputPerMtoken === null ? "-" : e.outputPerMtoken.toFixed(2).padEnd(9)} ${e.status ?? "-"}`,
            );
          }
          if (options.pin) {
            const r = await resolveUpstreamPin(
              { apiModelId, pin: options.pin, maxTokens: DEFAULT_MAX_TOKENS, longestPromptTokens: PROMPT_TOKENS_BOUND, skipPreflight: false },
              { apiKey },
            );
            console.log(`${colors.green("[OK]")} ${options.pin} resolved to ${r.providerName}${r.quantization ? ` (${r.quantization})` : ""}, preflight ${r.preflight}`);
            break;
          }
        }
        return;
      }
```

Let an `UpstreamPinError` propagate to the CLI's top-level error printer (it prints `[FAIL]` + message and exits 1).

- [ ] **Step 7: Backfill module and command**

```ts
// src/ingest/upstream-backfill.ts
import { join } from "@std/path";
import type { AdminConfig } from "./config.ts";
import type { RetryOptions } from "./http.ts";
import { postWithRetry } from "./http.ts";
import { signPayload } from "./signer.ts";

export interface UpstreamBackfillEntry { task_id: string; attempt: 1 | 2; served_upstream: string }

interface StateShape {
  tasks: Record<string, { attempt1: { itemId: string }; attempt2?: { itemId: string } }>;
}

async function providerFromResponse(path: string): Promise<{ provider?: string; missing: boolean }> {
  try {
    const text = await Deno.readTextFile(path);
    const raw = (JSON.parse(text) as { result?: { raw?: { provider?: unknown } } }).result?.raw;
    const p = raw && typeof raw === "object" ? (raw as { provider?: unknown }).provider : undefined;
    return { provider: typeof p === "string" && p.length > 0 ? p : undefined, missing: false };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return { missing: true };
    throw err;
  }
}

/**
 * Reads `result.raw.provider` from every `responses/<itemId>.json` of a batch
 * run directory, one entry per (task, attempt). Sync runs keep no raw
 * response on disk, so there is nothing to collect for them.
 */
export async function collectBatchServedUpstreams(runDir: string) {
  const state = JSON.parse(await Deno.readTextFile(join(runDir, "state.json"))) as StateShape;
  const entries: UpstreamBackfillEntry[] = [];
  const skipped: Array<{ task_id: string; attempt: 1 | 2; why: string }> = [];
  for (const [taskId, t] of Object.entries(state.tasks)) {
    const attempts: Array<[1 | 2, { itemId: string } | undefined]> = [[1, t.attempt1], [2, t.attempt2]];
    for (const [attempt, summary] of attempts) {
      if (!summary) continue;
      const r = await providerFromResponse(join(runDir, "responses", `${summary.itemId}.json`));
      if (r.missing) skipped.push({ task_id: taskId, attempt, why: "no response file" });
      else if (!r.provider) skipped.push({ task_id: taskId, attempt, why: "no provider field" });
      else entries.push({ task_id: taskId, attempt, served_upstream: r.provider });
    }
  }
  return { entries, skipped };
}

export async function postUpstreamBackfill(
  config: Pick<AdminConfig, "url" | "adminKeyId">,
  adminPrivateKey: Uint8Array,
  req: { runId: string; results: UpstreamBackfillEntry[] },
  opts: { fetchFn?: RetryOptions["fetchFn"] } = {},
) {
  const payload: Record<string, unknown> = { run_id: req.runId, results: req.results };
  const signature = await signPayload(payload, adminPrivateKey, config.adminKeyId);
  const url = `${config.url.replace(/\/+$/, "")}/api/v1/admin/runs/upstream`;
  const resp = await postWithRetry(url, { version: 1, signature, payload }, { ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}), maxAttempts: 3 });
  let body: Record<string, unknown> | null = null;
  let text = "";
  try {
    text = await resp.text();
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  const out: { status: number; ok: boolean; code?: string; message?: string; updated?: number } = { status: resp.status, ok: resp.ok };
  if (body) {
    if (typeof body["code"] === "string") out.code = body["code"];
    if (typeof body["error"] === "string") out.message = body["error"];
    if (typeof body["updated"] === "number") out.updated = body["updated"];
  } else if (text) out.message = text;
  return out;
}
```

Match the real import paths for `postWithRetry`/`signPayload`/`RetryOptions` to what `src/ingest/run-exclusion.ts` imports.

In `cli/commands/runs-command.ts` add the handler and subcommand:

```ts
export interface BackfillDeps {
  collect: typeof collectBatchServedUpstreams;
  post: typeof postUpstreamBackfill;
  loadConfig: typeof loadAdminConfig;
  readKey: typeof readPrivateKey;
}

export async function handleBackfillUpstream(
  runId: string,
  options: RunsCommandOptions & { dryRun?: boolean },
  deps: BackfillDeps = { collect: collectBatchServedUpstreams, post: postUpstreamBackfill, loadConfig: loadAdminConfig, readKey: readPrivateKey },
): Promise<void> {
  const runDir = join(options.resultsDir, "batch", runId);
  try {
    await Deno.stat(join(runDir, "state.json"));
  } catch {
    console.error(colors.red("[FAIL]") + ` No batch run directory at ${runDir}; sync runs have no stored responses to backfill from`);
    Deno.exit(1);
  }
  const { entries, skipped } = await deps.collect(runDir);
  for (const s of skipped) console.log(colors.gray(`       skip ${s.task_id} attempt ${s.attempt}: ${s.why}`));
  if (options.dryRun) {
    for (const e of entries) console.log(`       ${e.task_id} attempt ${e.attempt}: ${e.served_upstream}`);
    console.log(colors.cyan("[DRY-RUN]") + ` ${entries.length} attempt${entries.length === 1 ? "" : "s"} would be posted, ${skipped.length} skipped`);
    return;
  }
  const config = await deps.loadConfig(Deno.cwd(), flagsFrom(options));
  const adminPriv = await deps.readKey(config.adminKeyPath);
  const res = await deps.post(config, adminPriv, { runId, results: entries });
  if (!res.ok) {
    console.error(colors.red("[FAIL]") + ` backfill-upstream ${runId}: ${res.status}` + (res.code ? ` ${res.code}` : "") + (res.message ? ` - ${res.message}` : ""));
    Deno.exit(1);
  }
  console.log(colors.green("[OK]") + ` run ${runId}: ${res.updated ?? entries.length} attempt${(res.updated ?? entries.length) === 1 ? "" : "s"} updated, ${skipped.length} skipped`);
}
```

Register `backfill-upstream <runId:string>` with the same option set as `exclude` minus `--reason`, plus `--dry-run` ("Print what would be posted without posting"), and an example: `centralgauge runs backfill-upstream 4b623ade-... --dry-run`. Module doc comment: add a paragraph that this subcommand records which OpenRouter upstream served each attempt of a finished batch run from the responses kept on disk, marks those rows `unpinned`, and never writes one value across a run (spec 2026-09-11 D6).

- [ ] **Step 8: Run the tests, check, lint, fmt**

```
deno test --allow-all tests/unit/cli/ tests/unit/ingest/ tests/unit/batch/
deno check cli/commands/bench/upstream-precheck.ts src/ingest/upstream-backfill.ts cli/commands/models-command.ts cli/commands/runs-command.ts cli/commands/bench-command.ts cli/commands/bench-batch-command.ts cli/types/cli-types.ts cli/commands/bench/parallel-executor.ts
deno lint cli src/ingest
deno fmt <touched files>
```
Expected: PASS.

- [ ] **Step 9: Live verification (one 32-token request, the plan's only paid call after Task 1)**

```
deno task start models openrouter/z-ai/glm-5.3 --upstreams
deno task start models openrouter/z-ai/glm-5.3 --upstreams --pin <a tag from the listing>
```
Expected: a table with at least one endpoint; `[OK] <tag> resolved to <provider>, preflight passed`. Record the tag and provider name in the commit message. If the listing is empty or the preflight fails for a reason other than the tag being wrong, stop and report; do not retry in a loop.

- [ ] **Step 10: Commit**

```bash
git add cli/commands/bench/upstream-precheck.ts src/ingest/upstream-backfill.ts cli/commands/models-command.ts cli/commands/runs-command.ts cli/commands/bench-command.ts cli/commands/bench-batch-command.ts cli/types/cli-types.ts cli/commands/bench/parallel-executor.ts tests/unit/cli/bench/upstream-precheck.test.ts tests/unit/ingest/upstream-backfill.test.ts tests/unit/cli/runs-backfill-upstream.test.ts
git commit -m "feat(cli): resolve upstream pins at bench and batch precheck; models --upstreams; runs backfill-upstream

Both prechecks resolve every configured OpenRouter pin through the shared
helper and abort with the pin error before any LLM call. models
--upstreams lists a model's endpoint tags and --pin preflights one.
runs backfill-upstream reads result.raw.provider from a finished batch
run's stored responses and posts one entry per attempt. Verified live:
<tag> resolved to <provider>.

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 16: Documentation

**Files:**
- Modify: `docs/batch-mode.md` (new section "Upstream pinning" before "## Cost comparison"), `.claude/rules/batch-mode.md` (new section after "## Provider notes"), `CLAUDE.md` (one bullet after the "Batch mode" bullet in "## Memory"), `docs/guides/configuration.md` ("Full Configuration Reference" block), `docs/cli/commands.md` ("## models" and the `runs` subsection)
- Test: none (docs); `deno fmt` is not run on markdown here.

**Interfaces:** none.

- [ ] **Step 1: `docs/batch-mode.md`**

Insert before `## Cost comparison`:

````markdown
## Upstream pinning

OpenRouter routes each request to one of several upstream providers, and they
do not all serve the same weights at the same precision. A cohort whose runs
were served by different upstreams is not one model. The lock has three parts:
a pin in config, a per-request routing block plus identity capture, and a
verification state on every result row (design:
`docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md`).

### Configure a pin

```yaml
openrouter:
  upstream:
    z-ai/glm-5.3: novita/fp8        # an endpoints `tag`, see below
    google/gemini-3.8-flash: google-vertex
```

List a model's tags with `centralgauge models openrouter/<author>/<slug>
--upstreams`; add `--pin <tag>` to resolve and preflight one (a single
32-token request). A pin is a tag from that listing, nothing else.

### What submit does

`bench batch submit` (and the sync `bench`) resolves every configured pin
before the first provider call: the tag must exist for that model, the
endpoint must accept the run's `max_tokens` and context, and a 32-token
preflight must come back from that upstream. Any failure is exit 4 with the
tag, the model and the reason; `--skip-upstream-preflight` skips only the
probe. The resolved pin is frozen into `prompt-inputs.json` under `routing`
and every request body carries `provider.order: [<tag>]` with
`allow_fallbacks: false`, so OpenRouter answers 429 rather than routing
elsewhere.

### Verification and what a compromised run looks like

Every attempt records `requestedUpstream`, `servedUpstream`,
`servedUpstreamModel`, `upstreamIdentitySource` and `upstreamVerification`:

| state | meaning |
| --- | --- |
| `not_applicable` | not an OpenRouter run |
| `unpinned` | OpenRouter, no pin; served upstream recorded when present |
| `verified` | served upstream matches the pin |
| `mismatch` | served upstream differs from the pin |
| `unverified` | pinned, response carried no identity |
| `not_served` | pinned, the provider returned an error (no identity possible) |

A run with any `mismatch` or `unverified` attempt is compromised: wave 2 is
not submitted, the sync bench stops, and at finalize the run is ingested
already excluded (`excluded_code = upstream_mismatch` or
`upstream_unverified`, reason and attempt list in the audit row). The scores
file gets an `# Upstream` block. Abandon it and submit again once the pin is
right.

### One profile per model, set and mode

The site keeps one upstream profile per (model, task set, mode). The first
ingest claims it (`<unpinned>` counts as a profile); a later run with a
different pin is refused with `409 upstream_profile_conflict` naming the
runs that hold the profile. Exclude those runs first, or re-run under the
same pin. Excluding the last run of a profile releases it; including a run
re-claims it and is refused if that would conflict.

### Backfilling finished runs

For a finished batch run from before pinning existed,
`centralgauge runs backfill-upstream <runId> [--dry-run]` reads the provider
name from each stored `responses/<itemId>.json` and posts one entry per
attempt (rows become `unpinned` with `served_upstream` set). It never writes
one value across a run: an attempt with no stored provider is skipped and
listed. Sync runs keep no raw response and cannot be backfilled.
````

- [ ] **Step 2: `.claude/rules/batch-mode.md`**

After "## Provider notes":

```markdown
## Upstream pinning (OpenRouter)

- Pins live under `openrouter.upstream.<author>/<slug>: <tag>`; a tag comes
  from `models openrouter/<author>/<slug> --upstreams`, never from a response's
  `provider` display name.
- `submit` resolves and preflights every pin before any provider call and
  exits 4 on failure; `--skip-upstream-preflight` skips only the 32-token
  probe. The resolved routing is frozen in `prompt-inputs.json.routing`.
- A `mismatch` or `unverified` attempt makes the run compromised: no wave 2,
  ingested already excluded with `excluded_code`. Never repair `state.json` to
  un-compromise a run; abandon and resubmit.
- One profile per (model, task set, mode) on the site; a different pin is a
  409 until the holding runs are excluded.
- `runs backfill-upstream <runId>` is per-attempt from stored responses only;
  it never writes one value across a run.
```

- [ ] **Step 3: `CLAUDE.md`**

After the "Batch mode" bullet in "## Memory":

```markdown
- **OpenRouter upstream lock (spec 2026-09-11, D1 to D6).** `openrouter.upstream.<author>/<slug>: <endpoints tag>` pins the upstream; both prechecks resolve and preflight it (`--skip-upstream-preflight` skips the probe), requests carry `provider.order` + `allow_fallbacks:false`, every attempt records five upstream fields with a verification state, and a `mismatch`/`unverified` attempt compromises the run (no wave 2, sync stops, ingested already excluded with `runs.excluded_code`). D1 `upstream_profiles` holds one profile per (model, set, mode), claimed in the ingest batch; a different pin is `409 upstream_profile_conflict`. Migration `0023` (five nullable result columns, `runs.excluded_code`, registry, view recreate) applies BEFORE the worker deploy. `models <slug> --upstreams [--pin <tag>]` lists/preflights; `runs backfill-upstream <runId>` records served upstreams per attempt for finished batch runs. Settings extras schema 2 and invocation schema 2 carry `upstream_pin`; legacy fixtures keep schema-1 hashes. Docs: `docs/batch-mode.md` "Upstream pinning".
```

- [ ] **Step 4: `docs/guides/configuration.md` and `docs/cli/commands.md`**

In the "Full Configuration Reference" YAML block add, at top level:

```yaml
# OpenRouter upstream pins (tags from `models <slug> --upstreams`).
openrouter:
  upstream:
    z-ai/glm-5.3: novita/fp8
```

In `docs/cli/commands.md` under "## models" document `--upstreams` and `--pin <tag>` with the two example invocations from Task 15 Step 9; in the `runs` subsection document `backfill-upstream <runId> [--dry-run]` with the sentence "Batch runs only; sync runs keep no raw response."

- [ ] **Step 5: Commit**

```bash
git add docs/batch-mode.md .claude/rules/batch-mode.md CLAUDE.md docs/guides/configuration.md docs/cli/commands.md
git commit -m "docs: upstream pinning for OpenRouter (operator guide, rule, CLAUDE.md, config and CLI reference)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```
