# Batch Mode Plan A: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land everything the batch runner will stand on (spec section 14, steps 1 and 2) plus the three section-11 spikes, so that Plan B can build the state machine and the three batch adapters on shared, already-green code.

**Architecture:** The synchronous bench keeps working throughout. Each task extracts one unit out of `ParallelBenchmarkOrchestrator` / `LLMWorkPool` into `src/parallel/shared/` and re-points the sync path in the same commit, or adds one field end to end (client type, results file, ingest payload, D1 column, query predicate). The bench lock becomes exclusive. The settings hash gains a canonical `extra_json` that carries the invocation mode, so batch runs become a distinct profile the site refuses to pool with sync runs.

**Tech Stack:** Deno 2 / TypeScript (strict, `exactOptionalPropertyTypes`), `@std/assert` + `@std/testing/bdd`, SvelteKit Cloudflare Worker (D1, vitest against the built bundle), `@anthropic-ai/sdk@0.115.0`, `@openai/openai`, OpenRouter over `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-06-batch-mode-design.md` (revision 4, approved). Read sections 3, 4.2, 6, 10, 11, 12 and 14 before any task. Plan B (`2026-09-06-batch-mode-plan-b-runner.md`, written after this plan) implements sections 4, 5, 7, 8 and 9 on top of this one.

## Global Constraints

- Order of work: Task 1 (spikes) first per the owner's instruction, then the spec's rollout step 1 (Tasks 2 to 10) and step 2 (Tasks 11 to 16). Do not reorder across those groups.
- After every code change: `deno check <changed files>`, `deno lint <changed dirs>`, `deno fmt <changed files>` (scope fmt to touched files; the repo has CRLF drift). Never `deno fmt` under `site/`; prettier owns it.
- Run Deno tests as `deno test --allow-all <file>`; never bare `deno test`, never `--parallel`. A bench may be live on this machine: never run `tests/unit/container/`, and never run the whole `deno task test:unit` while `results/.bench-running.json` is fresher than 2 minutes.
- Site tests run against the built bundle: `cd site && npm run build && npm run test:main` after editing anything under `site/src`. Add a migration test to `site/tests/migrations.test.ts` for every migration.
- `exactOptionalPropertyTypes` is ON: optional fields are set with conditional spreads, never `field: undefined`.
- Import order: `@std/...`, then type imports from project modules, then implementation imports, then relative imports.
- No em dashes anywhere in authored text or code comments. Console output uses `@std/fmt/colors` `[Tag]` prefixes, never emoji.
- The six settings-hash keys are `temperature, max_attempts, max_tokens, prompt_version, bc_version, extra_json`; `extra_json` is a STRING bound into D1 TEXT. Never add a seventh key and never change how legacy `null` or string values hash (spec section 10).
- Every ranking query on the site selects exactly one `invocation_mode`; `mode=all` returns `400 invalid_mode_for_metric`; the default mode comes from the selected task set, never from another set or the globally newest run (spec D4).
- Costs come from explicit `cost_snapshots` columns; a batch run whose snapshot lacks batch rates prices as NULL on the site and throws in `priceUsage` (spec D5).
- Item ids, run ids, state files and everything under `src/batch/` belong to Plan B. Do not start them here.
- Deploy order for the site is fixed: `wrangler d1 migrations apply centralgauge --remote`, then `centralgauge sync-catalog --apply`, then bump `CACHE_VERSION`, then `cd site && npm run deploy`. Deploy is an outward-facing action: stop and ask the owner before running it (Task 16).
- Commit after every task. Commit messages end with the trailer line `Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK`.
- Spikes in Task 1 spend real API money (well under $2 total). Use the cheapest model named in each spike, never a frontier model, and never add prompts designed to be harmful; an unobserved refusal is a recorded finding, not a failure.

---

### Task 1: Section 11 spikes

**Files:**
- Create: `scripts/spikes/batch/anthropic-refusal.ts`
- Create: `scripts/spikes/batch/openai-endpoint.ts`
- Create: `scripts/spikes/batch/openrouter-shape.ts`
- Create: `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md`
- Modify: `.gitignore` (the `scripts/*` allowlist block at lines 98-114; add `!scripts/spikes/` and `!scripts/spikes/**`)

**Interfaces:**
- Consumes: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` from the environment (`source .env` in Git Bash first; never print or grep the file).
- Produces: the findings document, which Plan B's adapter tasks read for `ENDPOINT`, the Anthropic result-envelope shape, and the OpenRouter limits.

- [ ] **Step 1: Un-ignore the spike directory**

Append to the allowlist block in `.gitignore` (after the existing `!scripts/...` lines):

```
!scripts/spikes/
!scripts/spikes/**
```

Verify: `git check-ignore -v scripts/spikes/batch/x.ts` prints nothing.

- [ ] **Step 2: Write the Anthropic spike**

`scripts/spikes/batch/anthropic-refusal.ts`:

```ts
/**
 * Spike 1 (spec section 11): what a Message Batches result looks like for a
 * normal answer, a max_tokens stop, an invalid request, and (if the operator
 * supplies one) a prompt the API refuses. Prints every result envelope raw.
 *
 *   source .env
 *   deno run --allow-net --allow-env --allow-read scripts/spikes/batch/anthropic-refusal.ts [prompt-file]
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const refusalPrompt = Deno.args[0]
  ? await Deno.readTextFile(Deno.args[0])
  : "Reply with the single word OK.";

const batch = await client.messages.batches.create({
  requests: [
    {
      custom_id: "b-ok",
      params: {
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: "Reply with the single word OK." }],
      },
    },
    {
      custom_id: "b-max-tokens",
      params: {
        model: MODEL,
        max_tokens: 5,
        messages: [{ role: "user", content: "Count from one to fifty in words." }],
      },
    },
    {
      custom_id: "b-invalid",
      params: {
        model: "claude-model-that-does-not-exist",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    {
      custom_id: "b-refusal-candidate",
      params: {
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: refusalPrompt }],
      },
    },
  ],
});
console.log("created", batch.id, batch.processing_status, batch.request_counts);

let status = batch;
while (status.processing_status !== "ended") {
  await new Promise((r) => setTimeout(r, 5_000));
  status = await client.messages.batches.retrieve(batch.id);
  console.log("poll", status.processing_status, JSON.stringify(status.request_counts));
}

const listed = await client.messages.batches.list({ limit: 5 });
console.log("list entry fields", Object.keys(listed.data[0] ?? {}));

for await (const result of await client.messages.batches.results(batch.id)) {
  console.log("RESULT", result.custom_id, JSON.stringify(result.result));
}
```

- [ ] **Step 3: Write the OpenAI spike**

`scripts/spikes/batch/openai-endpoint.ts`:

```ts
/**
 * Spike 2 (spec section 11): which endpoint GPT-6 Astra accepts in the Batch
 * API. Uploads one JSONL per (model, endpoint) pair and prints the raw output
 * and error lines.
 *
 *   source .env
 *   deno run --allow-net --allow-env --allow-read --allow-write scripts/spikes/batch/openai-endpoint.ts
 */
import OpenAI from "@openai/openai";

const client = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
const MODELS = ["gpt-5-mini", "gpt-6-astra"];
const ENDPOINTS = ["/v1/chat/completions", "/v1/responses"] as const;

function line(model: string, endpoint: string, id: string): string {
  const body = endpoint === "/v1/chat/completions"
    ? {
      model,
      max_completion_tokens: 64,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    }
    : { model, max_output_tokens: 64, input: "Reply with the single word OK." };
  return JSON.stringify({ custom_id: id, method: "POST", url: endpoint, body });
}

for (const endpoint of ENDPOINTS) {
  const nonce = crypto.randomUUID();
  const jsonl = MODELS.map((m, i) => line(m, endpoint, `b-${i}`)).join("\n") + "\n";
  const file = await client.files.create({
    file: new File([jsonl], `spike-${nonce}.jsonl`),
    purpose: "batch",
  });
  const batch = await client.batches.create({
    input_file_id: file.id,
    endpoint,
    completion_window: "24h",
    metadata: { nonce, runId: "spike" },
  });
  console.log("created", endpoint, batch.id, batch.status);
  let status = batch;
  while (!["completed", "failed", "expired", "cancelled"].includes(status.status)) {
    await new Promise((r) => setTimeout(r, 10_000));
    status = await client.batches.retrieve(batch.id);
    console.log("poll", endpoint, status.status, JSON.stringify(status.request_counts));
  }
  console.log("errors field", JSON.stringify(status.errors));
  for (const key of [status.output_file_id, status.error_file_id]) {
    if (!key) continue;
    const text = await (await client.files.content(key)).text();
    console.log(`FILE ${key} (${key === status.output_file_id ? "output" : "error"})`);
    console.log(text);
  }
  const listed = await client.batches.list({ limit: 3 });
  console.log("listed nonce", listed.data.map((b) => b.metadata?.["nonce"]));
  await client.files.delete(file.id);
}
```

- [ ] **Step 4: Write the OpenRouter spike**

`scripts/spikes/batch/openrouter-shape.ts`:

```ts
/**
 * Spike 3 (spec section 11): OpenRouter beta batch shape and a measured
 * item/byte ceiling. Phase A submits a 3-item batch on a cheap model and one
 * Gemini 3.8 Flash item with reasoning params; phase B doubles item count
 * until the API rejects the submission, then doubles body size the same way.
 *
 *   source .env
 *   deno run --allow-net --allow-env scripts/spikes/batch/openrouter-shape.ts
 */
const KEY = Deno.env.get("OPENROUTER_API_KEY");
const BASE = "https://openrouter.ai/api/beta/batches";
const CHEAP = "openai/gpt-5-mini";

function request(customId: string, model: string, content: string, extra: Record<string, unknown> = {}) {
  return { custom_id: customId, body: { model, max_tokens: 64, messages: [{ role: "user", content }], ...extra } };
}

async function submit(model: string, requests: unknown[]): Promise<Response> {
  // Key order matters to the beta API: endpoint, model, requests.
  const body = JSON.stringify({ endpoint: "/v1/chat/completions", model, requests });
  console.log("submit", model, requests.length, "items", body.length, "bytes");
  return await fetch(BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body,
  });
}

async function poll(id: string): Promise<Record<string, unknown>> {
  for (;;) {
    const res = await fetch(`${BASE}/${id}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const json = await res.json() as Record<string, unknown>;
    const status = String((json["data"] as Record<string, unknown> | undefined)?.["status"] ?? json["status"]);
    console.log("poll", id, status);
    if (["completed", "failed", "expired", "cancelled"].includes(status)) return json;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

// Phase A: shape.
const a = await submit(CHEAP, [
  request("b-1", CHEAP, "Reply with the single word OK."),
  request("b-2", CHEAP, "Reply with the single word YES."),
  request("b-3", CHEAP, "Reply with the single word NO."),
]);
console.log("create status", a.status);
const created = await a.json() as Record<string, unknown>;
console.log("create body", JSON.stringify(created));
const id = String((created["data"] as Record<string, unknown> | undefined)?.["id"] ?? created["id"]);
const done = await poll(id);
console.log("FINAL", JSON.stringify(done));

const g = await submit("google/gemini-3.8-flash", [
  request("g-1", "google/gemini-3.8-flash", "Reply with the single word OK.", { reasoning: { effort: "low" } }),
]);
console.log("gemini create", g.status, await g.text());

const since = new Date(Date.now() - 600_000).toISOString();
const listed = await fetch(`${BASE}?created_after=${encodeURIComponent(since)}`, { headers: { Authorization: `Bearer ${KEY}` } });
console.log("list", listed.status, await listed.text());

// Phase B: ceilings. Doubling item count with a tiny body, then doubling body size with one item.
for (let n = 8; n <= 4096; n *= 2) {
  const res = await submit(CHEAP, Array.from({ length: n }, (_, i) => request(`c-${i}`, CHEAP, "OK")));
  console.log("items", n, "->", res.status, (await res.text()).slice(0, 300));
  if (res.status >= 400) break;
}
for (let kb = 64; kb <= 65536; kb *= 2) {
  const res = await submit(CHEAP, [request("s-1", CHEAP, "x".repeat(kb * 1024))]);
  console.log("bytes", kb, "KiB ->", res.status, (await res.text()).slice(0, 300));
  if (res.status >= 400) break;
}
```

Phase B creates real batches that OpenRouter will process (each item is a 2-token request on gpt-5-mini); the cost is cents. Cancel none; there is no documented cancel.

- [ ] **Step 5: Run all three and capture output**

```bash
source .env
mkdir -p "$TMP/spikes"   # use the session scratchpad directory
deno run --allow-net --allow-env --allow-read scripts/spikes/batch/anthropic-refusal.ts | tee "$TMP/spikes/anthropic.log"
deno run --allow-net --allow-env --allow-read --allow-write scripts/spikes/batch/openai-endpoint.ts | tee "$TMP/spikes/openai.log"
deno run --allow-net --allow-env scripts/spikes/batch/openrouter-shape.ts | tee "$TMP/spikes/openrouter.log"
```

Expected: each script ends with printed result envelopes. Anthropic batches usually end within minutes; OpenAI and OpenRouter can take up to an hour. Run them in the background and poll the logs rather than blocking.

- [ ] **Step 6: Write the findings document**

`docs/superpowers/specs/2026-09-06-batch-spikes-findings.md` with exactly these headings and every field filled from the logs (write "not observed" where a shape did not occur, never a guess):

```markdown
# Batch spikes findings (2026-09-06)

## 1. Anthropic Message Batches
- `result.type` values observed: (list)
- `b-ok`: `stop_reason` = ..., usage keys = ...
- `b-max-tokens`: `stop_reason` = ...
- `b-invalid`: `result.type` = errored, `error.type` = ...
- `b-refusal-candidate`: observed `stop_reason` = ... | not observed (documented shape: succeeded + `stop_reason: refusal`, mapped exactly like the sync path's unrescued refusal)
- list entry fields: (list) ; confirms no item ids and no metadata on the list surface
- Plan B mapper rule: succeeded -> mapContent/mapUsage/mapFinishReason over `result.message`; errored -> BatchItemResult error kind from `error.type`; expired/canceled -> those kinds

## 2. OpenAI Batch endpoint for GPT-6 Astra
- gpt-5-mini on /v1/chat/completions: ok | error text
- gpt-6-astra on /v1/chat/completions: ok | error text
- gpt-5-mini on /v1/responses: ok | error text
- gpt-6-astra on /v1/responses: ok | error text
- ENDPOINT for the OpenAI adapter: "/v1/chat/completions" | "/v1/responses"
- Responses builder/mapper needed in Plan B: yes | no
- output line shape: `{ id, custom_id, response: { status_code, request_id, body }, error }` (confirm)
- `metadata.nonce` visible on list: yes | no

## 3. OpenRouter beta batches
- create response shape: (keys)
- key order `{endpoint, model, requests}` accepted: yes | no (and what a different order returned)
- results inline on `completed`: yes | no ; `results` on non-completed: null | (shape)
- batch-level `usage.cost`: value observed
- Gemini 3.8 Flash `reasoning` param accepted: yes | no (form that worked)
- `created_after` list filter honoured: yes | no
- ceiling: first rejection at N items (status, message) ; first rejection at M KiB (status, message)
- initial adapter limits: maxItems = floor(N/2), maxBytes = floor(M KiB/2) * 1024
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore scripts/spikes/batch docs/superpowers/specs/2026-09-06-batch-spikes-findings.md
git commit -m "spike(batch): measure Anthropic, OpenAI and OpenRouter batch shapes and limits

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 2: D14 exclusive bench lock

**Files:**
- Modify: `src/utils/bench-lock.ts` (whole file rewritten; keep every exported name)
- Modify: `src/utils/mod.ts:51-60` (add `BenchLockHeldError`, `tryAcquireBenchLock` exports)
- Modify: `cli/commands/bench-command.ts:662-664`
- Create: `tests/fixtures/bench-lock-race-child.ts`
- Test: `tests/unit/utils/bench-lock.test.ts`

**Interfaces:**
- Produces: `tryAcquireBenchLock(dir, options): { acquired: true; release: () => Promise<void>; token: string } | { acquired: false; holder: BenchLockInfo | null }`, `acquireBenchLock(dir, options): () => Promise<void>` (throws `BenchLockHeldError`), `class BenchLockHeldError extends Error { holder: BenchLockInfo | null; path: string }`, `BenchLockInfo` gains `token: string`. `isBenchRunning`, `readBenchLock`, `benchLockPath` and the constants keep their signatures (the PreToolUse hook and `src/dashboard/bench-gate.ts` depend on them). Plan B's `advance` holds this lock for the compile phase.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/utils/bench-lock.test.ts` inside the existing `Deno.test("bench-lock", ...)` block (add `BenchLockHeldError`, `tryAcquireBenchLock` and `assertThrows` to the imports):

```ts
  await t.step("second acquire fails with BenchLockHeldError naming the holder", async () => {
    const dir = await createTempDir("bench-lock-exclusive");
    try {
      const release = acquireBenchLock(dir, { command: "bench --llms a" });
      const err = assertThrows(
        () => acquireBenchLock(dir, { command: "bench --llms b" }),
        BenchLockHeldError,
      );
      assertEquals(err.holder?.pid, Deno.pid);
      assertEquals(err.holder?.command, "bench --llms a");
      const second = tryAcquireBenchLock(dir);
      assertEquals(second.acquired, false);
      await release();
      const third = tryAcquireBenchLock(dir);
      assert(third.acquired, "lock is free again after release");
      await third.release();
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("a stale lock is reclaimed by the next acquirer", async () => {
    const dir = await createTempDir("bench-lock-stale");
    try {
      const path = benchLockPath(dir);
      Deno.writeTextFileSync(
        path,
        JSON.stringify({ pid: 1, startedAt: "x", command: "dead", token: "dead-token" }),
      );
      const past = new Date(Date.now() - 10 * 60_000);
      Deno.utimeSync(path, past, past);
      const got = tryAcquireBenchLock(dir, { command: "reclaimer" });
      assert(got.acquired, "stale lock must be reclaimable");
      assertEquals(readBenchLock(dir)?.pid, Deno.pid);
      assertEquals(readBenchLock(dir)?.token, got.token);
      await got.release();
      assertFalse(isBenchRunning(dir));
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("release leaves a lock it does not own in place", async () => {
    const dir = await createTempDir("bench-lock-owner");
    try {
      const release = acquireBenchLock(dir, { command: "mine" });
      const path = benchLockPath(dir);
      Deno.writeTextFileSync(
        path,
        JSON.stringify({ pid: 99, startedAt: "y", command: "theirs", token: "other-token" }),
      );
      await release();
      assertEquals(readBenchLock(dir)?.token, "other-token");
      Deno.removeSync(path);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  await t.step("six processes race; exactly one acquires", async () => {
    const dir = await createTempDir("bench-lock-race");
    try {
      const children = Array.from({ length: 6 }, () =>
        new Deno.Command(Deno.execPath(), {
          args: ["run", "--allow-all", "tests/fixtures/bench-lock-race-child.ts", dir],
          stdout: "piped",
          stderr: "piped",
        }).output());
      const outputs = await Promise.all(children);
      const verdicts = outputs.map((o) => new TextDecoder().decode(o.stdout).trim());
      assertEquals(verdicts.filter((v) => v === "acquired").length, 1, verdicts.join(","));
      assertEquals(verdicts.filter((v) => v === "held").length, 5, verdicts.join(","));
    } finally {
      await cleanupTempDir(dir);
    }
  });
```

Create `tests/fixtures/bench-lock-race-child.ts`:

```ts
// Child process for the multi-process lock race test. Never releases: the
// parent deletes the temp dir, and a held lock is what the losers must see.
import { tryAcquireBenchLock } from "../../src/utils/bench-lock.ts";

const dir = Deno.args[0];
if (!dir) throw new Error("dir argument required");
const result = tryAcquireBenchLock(dir, { command: "race-child" });
console.log(result.acquired ? "acquired" : "held");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/utils/bench-lock.test.ts`
Expected: FAIL, `BenchLockHeldError` and `tryAcquireBenchLock` are not exported.

- [ ] **Step 3: Rewrite `src/utils/bench-lock.ts`**

Replace the file body from `export interface BenchLockInfo` to the end with:

```ts
/** Metadata written into the marker. Liveness still comes from the file's mtime. */
export interface BenchLockInfo {
  /** Pid of the bench process that wrote the marker. */
  pid: number;
  /** ISO timestamp of when the bench acquired the lock. */
  startedAt: string;
  /** ISO timestamp of the most recent heartbeat (the file's mtime). */
  heartbeatAt: string;
  /** Human-readable description of the run, e.g. `bench --llms sonnet`. */
  command: string;
  /** Owner token; release only removes a marker carrying this token. */
  token: string;
}

export interface AcquireBenchLockOptions {
  /** Description of the run, stored for diagnostics. */
  command?: string;
  /** Heartbeat interval; defaults to {@link DEFAULT_HEARTBEAT_MS}. */
  heartbeatMs?: number;
  /** Age past which an existing marker may be reclaimed; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
}

export interface IsBenchRunningOptions {
  /** Age past which the marker is ignored; defaults to {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export type TryAcquireResult =
  | { acquired: true; release: () => Promise<void>; token: string }
  | { acquired: false; holder: BenchLockInfo | null };

/** Thrown by {@link acquireBenchLock} when a live marker is held by someone else. */
export class BenchLockHeldError extends Error {
  constructor(
    public readonly holder: BenchLockInfo | null,
    public readonly path: string,
  ) {
    super(
      holder
        ? `bench lock is held by pid ${holder.pid} since ${holder.startedAt} (${
          holder.command || "unknown command"
        }); marker: ${path}`
        : `bench lock is held; marker: ${path}`,
    );
    this.name = "BenchLockHeldError";
  }
}

/** Absolute-or-relative path of the marker inside `dir`. */
export function benchLockPath(dir: string = DEFAULT_BENCH_LOCK_DIR): string {
  return join(dir, BENCH_LOCK_FILENAME);
}

export function isBenchRunning(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: IsBenchRunningOptions = {},
): boolean {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const now = options.now ?? Date.now();
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(benchLockPath(dir));
  } catch {
    return false;
  }
  const mtimeMs = stat.mtime?.getTime();
  if (mtimeMs === undefined) return true;
  return now - mtimeMs <= staleAfterMs;
}

/** Parsed marker metadata, or `null` when absent or unreadable. Not for liveness. */
export function readBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
): BenchLockInfo | null {
  const path = benchLockPath(dir);
  try {
    const raw = Deno.readTextFileSync(path);
    const parsed = JSON.parse(raw) as Partial<BenchLockInfo>;
    if (typeof parsed.pid !== "number") return null;
    let heartbeatAt = parsed.heartbeatAt ?? "";
    try {
      const mtime = Deno.statSync(path).mtime;
      if (mtime) heartbeatAt = mtime.toISOString();
    } catch {
      // keep the stored value
    }
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? "",
      heartbeatAt,
      command: parsed.command ?? "",
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return null;
  }
}

/** Create the marker only if it does not exist. Returns false on AlreadyExists. */
function createExclusive(path: string, body: string): boolean {
  let file: Deno.FsFile;
  try {
    file = Deno.openSync(path, { write: true, createNew: true });
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) return false;
    throw err;
  }
  try {
    file.writeSync(new TextEncoder().encode(body));
    file.syncSync();
  } finally {
    file.close();
  }
  return true;
}

/**
 * Move a stale marker out of the way. Rename is atomic, so when two processes
 * both see a stale marker only one rename succeeds; the other sees NotFound
 * and simply retries the exclusive create.
 */
function reclaimStale(
  path: string,
  staleAfterMs: number,
): "reclaimed" | "live" | "gone" {
  let stat: Deno.FileInfo;
  try {
    stat = Deno.statSync(path);
  } catch {
    return "gone";
  }
  const mtimeMs = stat.mtime?.getTime();
  if (mtimeMs === undefined || Date.now() - mtimeMs <= staleAfterMs) {
    return "live";
  }
  const tomb = `${path}.stale-${crypto.randomUUID()}`;
  try {
    Deno.renameSync(path, tomb);
  } catch (err) {
    return err instanceof Deno.errors.NotFound ? "gone" : "live";
  }
  try {
    Deno.removeSync(tomb);
  } catch {
    // best effort
  }
  return "reclaimed";
}

/**
 * Try to take the exclusive bench lock. Exactly one process can hold a live
 * marker: creation is `createNew`, a stale marker is reclaimed by atomic
 * rename, the heartbeat only touches a marker that still carries our token,
 * and release only removes a marker that still carries our token.
 */
export function tryAcquireBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: AcquireBenchLockOptions = {},
): TryAcquireResult {
  const path = benchLockPath(dir);
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const token = crypto.randomUUID();
  const info: BenchLockInfo = {
    pid: Deno.pid,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    command: options.command ?? "",
    token,
  };
  Deno.mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(info, null, 2)}\n`;

  let created = false;
  for (let i = 0; i < 3 && !created; i++) {
    created = createExclusive(path, body);
    if (created) break;
    const state = reclaimStale(path, staleAfterMs);
    if (state === "live") return { acquired: false, holder: readBenchLock(dir) };
  }
  if (!created) return { acquired: false, holder: readBenchLock(dir) };

  let lost = false;
  const heartbeat = () => {
    if (lost) return;
    const current = readBenchLock(dir);
    if (current?.token !== token) {
      lost = true;
      return;
    }
    try {
      const now = new Date();
      Deno.utimeSync(path, now, now);
    } catch {
      // best effort; the next tick tries again
    }
  };
  const timer = setInterval(heartbeat, heartbeatMs);
  Deno.unrefTimer(timer);

  let released = false;
  const release = () => {
    if (released) return Promise.resolve();
    released = true;
    clearInterval(timer);
    if (!lost && readBenchLock(dir)?.token === token) {
      try {
        Deno.removeSync(path);
      } catch {
        // already gone
      }
    }
    return Promise.resolve();
  };
  return { acquired: true, release, token };
}

/**
 * Take the exclusive bench lock or throw {@link BenchLockHeldError}. Returns
 * the release function; call it from a `finally`.
 */
export function acquireBenchLock(
  dir: string = DEFAULT_BENCH_LOCK_DIR,
  options: AcquireBenchLockOptions = {},
): () => Promise<void> {
  const result = tryAcquireBenchLock(dir, options);
  if (!result.acquired) {
    throw new BenchLockHeldError(result.holder, benchLockPath(dir));
  }
  return result.release;
}
```

Update the file's header comment: replace the "Liveness is mtime-only on purpose" paragraph's first sentence with "The marker is an exclusive lock (spec D14): creation is atomic, the owner token guards heartbeat and release, and a stale marker is reclaimed by atomic rename. Liveness for READERS is still mtime-only:" and keep the two bullets.

- [ ] **Step 4: Export from `src/utils/mod.ts` and handle the held case in the CLI**

In `src/utils/mod.ts` add `BenchLockHeldError`, `tryAcquireBenchLock` to the value exports and `TryAcquireResult` to the type exports next to the existing bench-lock lines.

In `cli/commands/bench-command.ts` replace lines 662-664:

```ts
      let releaseBenchLock: () => Promise<void>;
      try {
        releaseBenchLock = acquireBenchLock(outputDir, {
          command: `bench ${Deno.args.slice(1).join(" ")}`.trim(),
        });
      } catch (err) {
        if (err instanceof BenchLockHeldError) {
          console.error(colors.red("[FAIL] ") + err.message);
          console.error(
            "  Wait for that bench to finish. A marker older than 2 minutes is reclaimed automatically.",
          );
          Deno.exit(1);
        }
        throw err;
      }
```

and extend the import on line 55 to `import { acquireBenchLock, BenchLockHeldError } from "../../src/utils/bench-lock.ts";`.

- [ ] **Step 5: Run the tests and the checks**

Run: `deno test --allow-all tests/unit/utils/bench-lock.test.ts tests/unit/dashboard/` (the bench-gate tests live there; if the directory does not exist, run `deno test --allow-all tests/unit/utils/bench-lock.test.ts` only)
Expected: PASS.

Run: `deno check src/utils/bench-lock.ts src/utils/mod.ts cli/commands/bench-command.ts tests/fixtures/bench-lock-race-child.ts && deno lint src/utils cli/commands && deno fmt src/utils/bench-lock.ts tests/unit/utils/bench-lock.test.ts tests/fixtures/bench-lock-race-child.ts`

- [ ] **Step 6: Commit**

```bash
git add src/utils/bench-lock.ts src/utils/mod.ts cli/commands/bench-command.ts tests/unit/utils/bench-lock.test.ts tests/fixtures/bench-lock-race-child.ts
git commit -m "feat(bench-lock): exclusive lock with owner token and race-safe stale reclamation (D14)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 3: Carry the rendered `LLMRequest` through success and failure (D11)

**Files:**
- Modify: `src/parallel/types.ts:145-190` (`LLMWorkResult`)
- Modify: `src/parallel/llm-work-pool.ts:251-372` (`executeWork`), `:414-436` (`generateCodeWithContinuation`)
- Modify: `src/parallel/orchestrator.ts:1168` (`createAttempt` prompt), `:1215-1257` (`createFailedAttempt` prompt)
- Modify: `src/llm/mock-adapter.ts:188-210` (a model name that throws)
- Test: `tests/unit/parallel/llm-work-pool-request-capture.test.ts` (new), `tests/unit/parallel/empty-response-field.test.ts` (extend)

**Interfaces:**
- Produces: `LLMWorkResult.request?: LLMRequest` populated on every result that got as far as rendering a prompt; `ExecutionAttempt.prompt` is the rendered prompt text on success AND failure (it was `context.instructions` on success and `""` on failure). Task 4 adds `providerErrorCode` beside it; Task 10 moves the rendering itself into `renderLLMRequest`.

- [ ] **Step 1: Write the failing pool test**

`tests/unit/parallel/llm-work-pool-request-capture.test.ts`:

```ts
import { assert, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import type { ParallelExecutionConfig } from "../../../src/parallel/types.ts";
import { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import { ProviderRateLimiter } from "../../../src/parallel/rate-limiter.ts";
import {
  createMockLLMWorkItem,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

function pool(): LLMWorkPool {
  const limits = new Map([["mock", { concurrent: 2, rpm: 1000, tpm: 1_000_000 }]]);
  const config: ParallelExecutionConfig = {
    maxGlobalConcurrency: 2,
    providerConcurrency: limits,
    compileQueueSize: 10,
    resultBufferSize: 10,
    streamResults: false,
    compileQueueTimeout: 10_000,
    taskConcurrency: 1,
    templateDir: "templates",
  };
  return new LLMWorkPool(config, new ProviderRateLimiter(limits));
}

function item(model: string) {
  const manifest = createMockTaskManifest({
    id: "CG-AL-E001",
    description: "Create a codeunit named Ping.",
  });
  return createMockLLMWorkItem({
    llmProvider: "mock",
    llmModel: model,
    taskManifest: manifest,
    context: createMockTaskExecutionContext({ instructions: manifest.description }),
  });
}

describe({ name: "LLMWorkResult.request", sanitizeOps: false, sanitizeResources: false }, () => {
  it("carries the rendered request on a successful result", async () => {
    const work = item("mock-gpt-4");
    const result = await pool().submit(work);
    assertExists(result.request, "request must be captured");
    assert(result.request.prompt.includes("Create a codeunit named Ping."));
    assertEquals(result.request.maxTokens, work.context.maxTokens);
  });

  it("carries the rendered request when the adapter throws", async () => {
    const result = await pool().submit(item("mock-throws"));
    assertEquals(result.success, false);
    assertExists(result.request, "request must be captured on failure too");
    assert(result.request.prompt.includes("Create a codeunit named Ping."));
  });
});
```

In `src/llm/mock-adapter.ts`, at the top of both `generateCodeStream` (line 188) and `generateFixStream` (line 199), before the first `yield`, add:

```ts
    if (this.config.model === "mock-throws") {
      throw new Error("mock adapter failure (model mock-throws)");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all tests/unit/parallel/llm-work-pool-request-capture.test.ts`
Expected: FAIL, `result.request` is undefined.

- [ ] **Step 3: Add the field and hoist the request out of `generateCodeWithContinuation`**

In `src/parallel/types.ts`, inside `LLMWorkResult` after `llmResponse?`:

```ts
  /**
   * The rendered request that was (or would have been) sent. Present on every
   * result that got as far as rendering, success or failure (spec D11), so the
   * attempt record can carry the prompt actually sent.
   */
  request?: LLMRequest;
```

`LLMRequest` is imported from `../llm/types.ts` in that file already for `LLMResponse`; if only `LLMResponse` is imported, extend that type import.

In `src/parallel/llm-work-pool.ts`, split `generateCodeWithContinuation` (lines 414-436) into two methods:

```ts
  /** Render the prompt for an item. Pure apart from template and starter reads. */
  private async prepareGeneration(
    item: LLMWorkItem,
  ): Promise<{ context: GenerationContext; request: LLMRequest }> {
    const context: GenerationContext = {
      taskId: item.taskManifest.id,
      attempt: item.attemptNumber,
      description: item.taskManifest.description,
    };
    if (item.previousAttempts.length > 0) {
      const lastAttempt = item.previousAttempts[item.previousAttempts.length - 1];
      if (lastAttempt) {
        context.previousCode = retrySourceFor(lastAttempt);
        context.errors = lastAttempt.failureReasons;
      }
    }
    const request = await this.buildRequest(item, context);
    return { context, request };
  }

  private generateCodeWithContinuation(
    item: LLMWorkItem,
    adapter: LLMAdapter,
    prepared: { context: GenerationContext; request: LLMRequest },
  ): Promise<ContinuationResult> {
    if (!isStreamingAdapter(adapter)) {
      // keep the existing LLMProviderError and its message text verbatim
      throw new LLMProviderError(STREAMING_REQUIRED_MESSAGE(adapter.name), adapter.name, false);
    }
    return this.generateCodeWithStreaming(item, adapter, prepared.request, prepared.context);
  }
```

Keep the existing streaming-required error text exactly as it is today (inline it; `STREAMING_REQUIRED_MESSAGE` above only marks where it goes). `generateCodeWithStreaming` keeps its signature; pass `prepared.request` and `prepared.context` in the positions it already takes.

In `executeWork`, declare `let prepared: { context: GenerationContext; request: LLMRequest } | undefined;` before the `try`. Inside the `try`, after `const adapter = this.getAdapter(item);`, add:

```ts
      prepared = await this.prepareGeneration(item);
      const ready = prepared;
```

and change the `withEmptyRetry` producer to `() => this.generateCodeWithContinuation(item, adapter, ready)`. Add `request: ready.request,` to the success `result` literal. In the final `return` of the `catch` block add `...(prepared ? { request: prepared.request } : {}),`. The recursive transient retry (`return this.executeWork(item, retryCount + 1, abandoned)`) is unchanged: it re-renders, which is deterministic.

- [ ] **Step 4: Use the request for the attempt prompt**

`src/parallel/orchestrator.ts` line 1168 (`createAttempt`): `prompt: llmResult.request?.prompt ?? context.instructions,`.

Line 1225 (`createFailedAttempt`): `prompt: llmResult?.request?.prompt ?? "",`.

Extend `tests/unit/parallel/empty-response-field.test.ts` in the block that drives `createFailedAttempt` (search the file for `createFailedAttempt(`; copy the orchestrator construction it already uses) with:

```ts
  it("carries the rendered prompt on a failed attempt", () => {
    const attempt = orchestrator.createFailedAttempt(1, {
      workItemId: "w",
      success: false,
      error: "boom",
      duration: 10,
      readyForCompile: false,
      request: { prompt: "RENDERED PROMPT", maxTokens: 100 },
    });
    assertEquals(attempt.prompt, "RENDERED PROMPT");
  });
```

- [ ] **Step 5: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/llm-work-pool-request-capture.test.ts tests/unit/parallel/empty-response-field.test.ts tests/unit/parallel/llm-work-pool.test.ts tests/unit/parallel/orchestrator.test.ts`
Expected: PASS. Note for the reviewer: `attemptToItem` in `cli/commands/bench/ingest-assembly.ts:213` builds the transcript from `a.prompt`, so transcripts now contain the full rendered prompt (up to the 400,000-character fix-prompt cap). That is the intended D11 behaviour, not a regression.

Run: `deno check src/parallel/types.ts src/parallel/llm-work-pool.ts src/parallel/orchestrator.ts src/llm/mock-adapter.ts && deno lint src/parallel src/llm && deno fmt src/parallel/types.ts src/parallel/llm-work-pool.ts src/parallel/orchestrator.ts src/llm/mock-adapter.ts tests/unit/parallel/llm-work-pool-request-capture.test.ts tests/unit/parallel/empty-response-field.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/parallel/types.ts src/parallel/llm-work-pool.ts src/parallel/orchestrator.ts src/llm/mock-adapter.ts tests/unit/parallel/llm-work-pool-request-capture.test.ts tests/unit/parallel/empty-response-field.test.ts
git commit -m "feat(parallel): carry the rendered LLMRequest on every work result and attempt (D11)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 4: `providerFinishReason` and `providerErrorCode` end to end

**Files:**
- Modify: `src/llm/types.ts:92-100` (`LLMResponse`)
- Create: `src/llm/provider-error-code.ts`
- Modify: `src/llm/anthropic-adapter.ts:458,497`, `src/llm/openai-adapter.ts:222,276,326,424`, `src/llm/openrouter-adapter.ts:272,340` (raw finish reason capture)
- Modify: `src/parallel/types.ts` (`LLMWorkResult.providerErrorCode?`), `src/parallel/llm-work-pool.ts` (`executeWork` catch block)
- Modify: `src/tasks/interfaces.ts:346-427` (`ExecutionAttempt`)
- Modify: `src/parallel/orchestrator.ts` (`createAttempt`, `createFailedAttempt`)
- Modify: `cli/commands/bench/ingest-assembly.ts:247-248`, `src/ingest/mod.ts:78` and `:185-190`, `site/src/lib/shared/types.ts` (`ResultInput`), `site/src/routes/api/v1/runs/+server.ts:540-541`
- Test: `tests/unit/llm/provider-error-code.test.ts` (new), `tests/unit/ingest/result-item-mapper.test.ts` (extend), `site/tests/api/v2-runs.test.ts` (extend)

**Interfaces:**
- Produces: `LLMResponse.providerFinishReason?: string` (the provider's raw stop reason: `end_turn`, `max_tokens`, `refusal`, `length`, `incomplete:max_output_tokens`, ...); `ExecutionAttempt.providerFinishReason?`, `providerErrorCode?`, `providerRequestId?` (all `string | undefined`); `providerErrorCode(error: unknown): string | undefined`; `BenchResultItem.provider_error_code?: string | null`; `ResultInput.provider_error_code?: string | null`; the server binds it (the D1 columns exist since migration 0018).

- [ ] **Step 1: Write the failing tests**

`tests/unit/llm/provider-error-code.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { providerErrorCode } from "../../../src/llm/provider-error-code.ts";

Deno.test("providerErrorCode reads SDK-style status and error type", () => {
  const sdkError = Object.assign(new Error("Bad Request"), {
    status: 400,
    error: { type: "invalid_request_error", message: "x" },
  });
  assertEquals(providerErrorCode(sdkError), "http_400:invalid_request_error");
  assertEquals(
    providerErrorCode(Object.assign(new Error("x"), { status: 529 })),
    "http_529",
  );
  assertEquals(
    providerErrorCode(
      Object.assign(new Error("x"), { error: { code: "rate_limit_exceeded" } }),
    ),
    "rate_limit_exceeded",
  );
});

Deno.test("providerErrorCode walks the cause chain and returns undefined when nothing is structured", () => {
  const inner = Object.assign(new Error("inner"), { status: 503 });
  const wrapped = new Error("wrapped", { cause: inner });
  assertEquals(providerErrorCode(wrapped), "http_503");
  assertEquals(providerErrorCode(new Error("plain")), undefined);
  assertEquals(providerErrorCode("string"), undefined);
  assertEquals(providerErrorCode(undefined), undefined);
});
```

In `tests/unit/ingest/result-item-mapper.test.ts` add, next to the existing `provider_finish_reason` assertion (the mapper under test is the `BenchResultItem` to `ResultInput` function in `src/ingest/mod.ts`; reuse the file's fixture builder and import):

```ts
Deno.test("mapper forwards provider_error_code", () => {
  const out = mapOne({ provider_finish_reason: "max_tokens", provider_error_code: "http_400:invalid_request_error" });
  assertEquals(out.provider_finish_reason, "max_tokens");
  assertEquals(out.provider_error_code, "http_400:invalid_request_error");
});
```

(`mapOne` stands for whatever helper the file already uses to build one item and map it; name it after the file's convention.)

In `site/tests/api/v2-runs.test.ts`, in the full-capture case, add `provider_finish_reason: "overloaded"` and `provider_error_code: "http_529"` to the first result and assert both come back from `/api/v2/runs/:id` beside the existing capture-field assertions.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/provider-error-code.test.ts tests/unit/ingest/result-item-mapper.test.ts`
Expected: FAIL (module missing; field dropped by the mapper).

- [ ] **Step 3: Implement**

`src/llm/provider-error-code.ts`:

```ts
/**
 * Best-effort structured error code from a provider SDK error, for the
 * attempt record's `providerErrorCode` (spec section 10). Walks `cause` up
 * to three levels. Returns undefined when nothing structured is present;
 * never invents a code.
 */
export function providerErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 4 && current !== null && typeof current === "object";
    depth++
  ) {
    const e = current as {
      status?: unknown;
      error?: { type?: unknown; code?: unknown } | null;
      context?: Record<string, unknown>;
      cause?: unknown;
    };
    const type = typeof e.error?.type === "string"
      ? e.error.type
      : typeof e.error?.code === "string"
      ? e.error.code
      : undefined;
    const status = typeof e.status === "number"
      ? e.status
      : typeof e.context?.["status"] === "number"
      ? (e.context["status"] as number)
      : undefined;
    if (type !== undefined && status !== undefined) {
      return `http_${status}:${type}`;
    }
    if (type !== undefined) return type;
    if (status !== undefined) return `http_${status}`;
    current = e.cause;
  }
  return undefined;
}
```

`src/llm/types.ts`, in `LLMResponse` after `finishReason`:

```ts
  /** Provider's raw stop reason before mapping to `finishReason`. */
  providerFinishReason?: string | undefined;
```

Adapters, at each listed line, add the raw value with a conditional spread beside the existing `finishReason:` property:
- Anthropic 458: `...(message.stop_reason ? { providerFinishReason: message.stop_reason } : {}),`; 497: the same with `finalMessage.stop_reason`.
- OpenAI 222: `...(choice?.finish_reason ? { providerFinishReason: choice.finish_reason } : {}),`; 276 and 424 (Responses API, use the local variable names at each site): `providerFinishReason: response.status === "incomplete" ? "incomplete:" + (response.incomplete_details?.reason ?? "unknown") : String(response.status),`; 326: `...(streamFinishReason ? { providerFinishReason: streamFinishReason } : {}),`.
- OpenRouter 272 and 340: same as OpenAI 222 and 326.

`src/parallel/types.ts` `LLMWorkResult`: add `providerErrorCode?: string;` after `error?`. In `src/parallel/llm-work-pool.ts` `executeWork` catch, before the final `return`: `const errorCode = providerErrorCode(error);` and add `...(errorCode !== undefined ? { providerErrorCode: errorCode } : {}),` to the returned literal (import from `../llm/provider-error-code.ts`).

`src/tasks/interfaces.ts` `ExecutionAttempt`, after `codeLanguage`:

```ts
  /** Provider's raw stop reason (`end_turn`, `max_tokens`, `refusal`, `length`, ...). */
  providerFinishReason?: string | undefined;
  /** Structured provider error code when the LLM call failed (`http_529`, `http_400:invalid_request_error`). */
  providerErrorCode?: string | undefined;
  /** Provider request id when the SDK exposes one. Local only; never ingested. */
  providerRequestId?: string | undefined;
```

`src/parallel/orchestrator.ts`: in `createAttempt` after `codeLanguage: "al",` add `...(llmResult.llmResponse?.providerFinishReason !== undefined ? { providerFinishReason: llmResult.llmResponse.providerFinishReason } : {}),`. In `createFailedAttempt` after the `failureKind` assignment add:

```ts
    if (llmResult?.llmResponse?.providerFinishReason !== undefined) {
      attempt.providerFinishReason = llmResult.llmResponse.providerFinishReason;
    }
    if (llmResult?.providerErrorCode !== undefined) {
      attempt.providerErrorCode = llmResult.providerErrorCode;
    }
```

Ingest: `cli/commands/bench/ingest-assembly.ts:248` becomes `provider_finish_reason: a.providerFinishReason ?? a.llmResponse.finishReason,` and add `provider_error_code: a.providerErrorCode ?? null,` below it. `src/ingest/mod.ts:78`: add `provider_error_code?: string | null;` to `BenchResultItem`; in the mapper at `:185-190` add `if (r.provider_error_code !== undefined) out.provider_error_code = r.provider_error_code;`. `site/src/lib/shared/types.ts` `ResultInput`: add `provider_error_code?: string | null;` beside `termination_kind`. `site/src/routes/api/v1/runs/+server.ts`: in the per-result validation block add

```ts
      if (
        r.provider_error_code !== undefined &&
        r.provider_error_code !== null &&
        typeof r.provider_error_code !== "string"
      ) {
        throw new ApiError(
          400,
          "invalid_capture_field",
          `provider_error_code must be a string or null (task ${r.task_id} attempt ${r.attempt})`,
        );
      }
```

and replace line 541 (`null, // provider_error_code: not yet produced by any client`) with `r.provider_error_code ?? null,`.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/llm/provider-error-code.test.ts tests/unit/ingest/ tests/unit/parallel/empty-response-field.test.ts tests/unit/parallel/orchestrator.test.ts tests/unit/llm/`
Expected: PASS.

Run: `cd site && npm run build && npx vitest run tests/api/v2-runs.test.ts && cd ..`
Expected: PASS.

Run `deno check`, `deno lint` and `deno fmt` over the Deno files listed under **Files**.

- [ ] **Step 5: Commit**

```bash
git add src/llm src/parallel src/tasks/interfaces.ts cli/commands/bench/ingest-assembly.ts src/ingest/mod.ts site/src/lib/shared/types.ts site/src/routes/api/v1/runs/+server.ts tests/unit/llm/provider-error-code.test.ts tests/unit/ingest/result-item-mapper.test.ts site/tests/api/v2-runs.test.ts
git commit -m "feat(capture): providerFinishReason and providerErrorCode from adapter to D1

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 5: Attempt-level infra record in both modes (`synthesizeInfraAttempt`)

**Files:**
- Create: `src/parallel/shared/infra-attempt.ts`
- Modify: `src/health/terminal-record.ts:62-140` (`synthesizeInfraFailureResult` builds its attempt through the new unit and accepts prior attempts)
- Modify: `src/parallel/orchestrator.ts:895-960` (attempt loop wraps `executeCompilation`), `:580-700` (`processTask` catch unwraps the loop abort)
- Test: `tests/unit/parallel/shared/infra-attempt.test.ts` (new), `tests/unit/health/terminal-record.test.ts` (extend), `tests/unit/parallel/orchestrator-infra-exhaustion.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export interface SynthesizeInfraAttemptInput {
  attemptNumber: number;
  startTime: Date;
  error: unknown;
  classification: { fingerprint: string; signature?: { label?: string } | undefined };
  infraRetries?: InfraRetryRecord[];
  infraRetryExhausted?: boolean;
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
  containerName?: string;
}
export function synthesizeInfraAttempt(input: SynthesizeInfraAttemptInput): ExecutionAttempt;
export class AttemptLoopAbort extends Error {
  constructor(public readonly cause: Error, public readonly partial: {
    attempts: ExecutionAttempt[]; attemptNumber: number; attemptStart: Date;
    executionId: string; context: TaskExecutionContext; startTime: number;
    request?: LLMRequest; llmResponse?: LLMResponse;
  });
}
```

`synthesizeInfraFailureResult` (kept for its other callers) gains optional `priorAttempts?: ExecutionAttempt[]`, `attemptNumber?: number`, `request?: LLMRequest`, `llmResponse?: LLMResponse`, `executionId?: string` in `SynthInput`. Plan B's evaluate step calls `synthesizeInfraAttempt` directly for a compile-phase infra exhaustion and then terminates the task (D10).

- [ ] **Step 1: Write the failing tests**

`tests/unit/parallel/shared/infra-attempt.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { ContainerError } from "../../../../src/errors.ts";
import { synthesizeInfraAttempt } from "../../../../src/parallel/shared/infra-attempt.ts";
import { isInfraInvalidatedAttempt } from "../../../../src/health/infra-invalidation.ts";

Deno.test("synthesizeInfraAttempt keeps the attempt number, prompt and billed usage", () => {
  const err = new ContainerError("Boom", "Cronus281", "test", { exitCode: 1 });
  const startTime = new Date(Date.now() - 5_000);
  const a = synthesizeInfraAttempt({
    attemptNumber: 2,
    startTime,
    error: err,
    classification: { fingerprint: "test:abc", signature: { label: "SQL down" } },
    request: { prompt: "RENDERED", maxTokens: 10 },
    llmResponse: {
      content: "some code",
      model: "m",
      duration: 100,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, estimatedCost: 0.01 },
    },
    infraRetryExhausted: true,
    infraRetryExhaustionReason: "budget_exhausted",
  });
  assertEquals(a.attemptNumber, 2);
  assertEquals(a.prompt, "RENDERED");
  assertEquals(a.tokensUsed, 15);
  assertEquals(a.cost, 0.01);
  assertEquals(a.containerName, "Cronus281");
  assertEquals(a.success, false);
  assertEquals(a.infraSynthesized, true);
  assertEquals(a.infraRetryExhausted, true);
  assert(a.failureReasons[0]?.startsWith("Infra error: Boom"));
  assert(a.failureReasons.some((r) => r === "Signature: SQL down"));
  assert(isInfraInvalidatedAttempt(a));
  assert(a.duration >= 5_000);
});

Deno.test("synthesizeInfraAttempt without an LLM response zeroes usage and prompt", () => {
  const a = synthesizeInfraAttempt({
    attemptNumber: 1,
    startTime: new Date(),
    error: new Error("plain"),
    classification: { fingerprint: "x" },
  });
  assertEquals(a.prompt, "");
  assertEquals(a.tokensUsed, 0);
  assertEquals(a.cost, 0);
  assertEquals(a.containerName, undefined);
  assert(a.failureReasons.some((r) => r === "Signature: (unclassified)"));
});
```

Extend `tests/unit/health/terminal-record.test.ts` with:

```ts
Deno.test("synthesized result appends to prior attempts and numbers the infra attempt", () => {
  const err = new ContainerError("Boom", "Cronus281", "test", { exitCode: 1 });
  const prior = {
    attemptNumber: 1, startTime: new Date(), endTime: new Date(), prompt: "p",
    llmResponse: { content: "", model: "m", duration: 1, finishReason: "stop" as const, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
    extractedCode: "", codeLanguage: "al" as const, success: false, score: 0,
    failureReasons: ["Compilation failed"], tokensUsed: 2, cost: 0.5, duration: 1,
  };
  const r = synthesizeInfraFailureResult({
    manifestId: "CG-AL-H024",
    context: ctx,            // the fixture context already used in this file
    error: err,
    classification: { fingerprint: "test:abc" },
    startTime: new Date(),
    priorAttempts: [prior],
    attemptNumber: 2,
  });
  assertEquals(r.attempts.length, 2);
  assertEquals(r.attempts[1]?.attemptNumber, 2);
  assertEquals(r.attempts[1]?.infraSynthesized, true);
  assertEquals(r.totalCost, 0.5);
  assertEquals(r.totalTokensUsed, 2);
});
```

Extend `tests/unit/parallel/orchestrator-infra-exhaustion.test.ts` (reuse `buildLLMPool`, `buildVariants`, `QuarantiningMockCompileQueue`, `createMockContainerProvider` and the orchestrator construction its first test uses; if the file's LLM pool returns success on every call, the second attempt also reaches compile):

```ts
Deno.test("compile-phase infra exhaustion on attempt 2 keeps attempt 1 and records attempt 2 as infra", async () => {
  // Same wiring as the first test in this file, but the queue succeeds once
  // (attempt 1 fails tests normally) and quarantines from the second call on.
  class SecondCallQuarantines extends MultiContainerMockCompileQueue {
    calls = 0;
    override async enqueue(item: CompileWorkItem, options?: CompileEnqueueOptions) {
      const result = await super.enqueue(item, options);
      this.calls++;
      if (this.calls === 1) {
        result.testResult = { success: false, totalTests: 1, passedTests: 0, failedTests: 1, duration: 1, results: [{ name: "T", passed: false, error: "nope" }] } as CompileWorkResult["testResult"];
        return result;
      }
      result.quarantined = { quarantined: true, forcedByAlertId: "alert-1", originContainer: CONTAINER, classificationReason: "container_quarantined" };
      return result;
    }
  }
  const orchestrator = /* construct exactly as the first test does, with new SecondCallQuarantines([CONTAINER]) */;
  const manifest = createMockTaskManifest({ id: "CG-AL-X001", expected: { testApp: true } });
  const results = await orchestrator.runParallel([manifest], buildVariants(), /* the same options object the first test passes, with attemptLimit: 2 */);
  const task = results.tasks[0]!.modelResults.get("mock/mock-gpt-4")!;
  assertEquals(task.attempts.length, 2);
  assertEquals(task.attempts[0]?.attemptNumber, 1);
  assertEquals(task.attempts[0]?.infraSynthesized, undefined);
  assertEquals(task.attempts[1]?.attemptNumber, 2);
  assertEquals(task.attempts[1]?.infraSynthesized, true);
  assert(task.attempts[1]?.failureReasons[0]?.startsWith("Infra error:"));
});
```

Replace the two `/* ... */` comments with the literal construction and options copied from the file's first test (they are the same values; the comment only marks where they go). Adjust the fake `testResult` literal to the `TestResult` shape in `src/container/types.ts` if a field name differs.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/parallel/shared/infra-attempt.test.ts tests/unit/health/terminal-record.test.ts tests/unit/parallel/orchestrator-infra-exhaustion.test.ts`
Expected: FAIL (module missing; result has one attempt).

- [ ] **Step 3: Implement the unit**

`src/parallel/shared/infra-attempt.ts`:

```ts
import type { LLMRequest, LLMResponse } from "../../llm/types.ts";
import type {
  ExecutionAttempt,
  InfraRetryExhaustionReason,
  InfraRetryRecord,
  TaskExecutionContext,
} from "../../tasks/interfaces.ts";
import { ContainerError } from "../../errors.ts";

export interface SynthesizeInfraAttemptInput {
  attemptNumber: number;
  startTime: Date;
  error: unknown;
  classification: {
    fingerprint: string;
    signature?: { label?: string } | undefined;
  };
  infraRetries?: InfraRetryRecord[];
  infraRetryExhausted?: boolean;
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
  containerName?: string;
}

const EMPTY_RESPONSE: LLMResponse = {
  content: "",
  model: "",
  duration: 0,
  finishReason: "stop",
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

/**
 * One attempt record for a compile/test infra failure that exhausted its
 * retries (spec section 6, D10). Used by the sync orchestrator and by the
 * batch evaluate step. Marks `infraSynthesized` unconditionally: callers only
 * reach this after classifying the failure as infra.
 */
export function synthesizeInfraAttempt(
  input: SynthesizeInfraAttemptInput,
): ExecutionAttempt {
  const endTime = new Date();
  const err = input.error;
  const message = err instanceof Error ? err.message : String(err);
  const containerName = err instanceof ContainerError
    ? err.containerName
    : input.containerName;
  const operation = err instanceof ContainerError ? err.operation : "unknown";
  const sigLabel = input.classification.signature?.label ?? "(unclassified)";
  const response = input.llmResponse ?? EMPTY_RESPONSE;

  const attempt: ExecutionAttempt = {
    attemptNumber: input.attemptNumber,
    startTime: input.startTime,
    endTime,
    prompt: input.request?.prompt ?? "",
    llmResponse: response,
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: [
      `Infra error: ${message}`,
      `Container: ${containerName ?? "unknown"}, Operation: ${operation}`,
      `Signature: ${sigLabel}`,
      `Fingerprint: ${input.classification.fingerprint}`,
    ],
    tokensUsed: response.usage.totalTokens,
    cost: response.usage.estimatedCost ?? 0,
    duration: endTime.getTime() - input.startTime.getTime(),
    infraSynthesized: true,
  };
  if (containerName !== undefined) attempt.containerName = containerName;
  if (response.providerFinishReason !== undefined) {
    attempt.providerFinishReason = response.providerFinishReason;
  }
  if (input.infraRetries && input.infraRetries.length > 0) {
    attempt.infraRetries = input.infraRetries;
  }
  if (input.infraRetryExhausted) attempt.infraRetryExhausted = true;
  if (input.infraRetryExhaustionReason !== undefined) {
    attempt.infraRetryExhaustionReason = input.infraRetryExhaustionReason;
  }
  return attempt;
}

/** What the sync attempt loop had built when a compile-phase error escaped it. */
export interface AttemptLoopPartial {
  attempts: ExecutionAttempt[];
  attemptNumber: number;
  attemptStart: Date;
  executionId: string;
  context: TaskExecutionContext;
  startTime: number;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
}

/**
 * Wraps an error thrown out of the attempt loop together with the attempts
 * finished before it, so the orchestrator's classification catch can append
 * an attempt-level infra record instead of replacing the task result.
 */
export class AttemptLoopAbort extends Error {
  override readonly cause: Error;
  constructor(cause: Error, public readonly partial: AttemptLoopPartial) {
    super(cause.message);
    this.name = "AttemptLoopAbort";
    this.cause = cause;
  }
}
```

Check that `ExecutionAttempt.infraSynthesized` is declared in `src/tasks/interfaces.ts` (it is read by `infra-invalidation.ts:32`); if it is only assigned dynamically today, declare it as `infraSynthesized?: boolean | undefined;` beside `infraRetryExhausted`.

- [ ] **Step 4: Re-point `synthesizeInfraFailureResult`**

In `src/health/terminal-record.ts`, add to `SynthInput`:

```ts
  priorAttempts?: ExecutionAttempt[];
  attemptNumber?: number;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
  executionId?: string;
```

Replace the hand-built `attempt` block (from `const reasons = [` through the `infraRetryExhaustionReason` assignment) with:

```ts
  const attempt = synthesizeInfraAttempt({
    attemptNumber: input.attemptNumber ?? (input.priorAttempts?.length ?? 0) + 1,
    startTime: input.startTime,
    error: err,
    classification: input.classification,
    ...(input.infraRetries ? { infraRetries: input.infraRetries } : {}),
    ...(input.infraRetryExhausted ? { infraRetryExhausted: true } : {}),
    ...(input.infraRetryExhaustionReason !== undefined
      ? { infraRetryExhaustionReason: input.infraRetryExhaustionReason }
      : {}),
    ...(input.request ? { request: input.request } : {}),
    ...(input.llmResponse ? { llmResponse: input.llmResponse } : {}),
    ...(input.context.containerName ? { containerName: input.context.containerName } : {}),
  });
  const attempts = [...(input.priorAttempts ?? []), attempt];
```

and in the returned result use `attempts`, `executionId: input.executionId ?? <the existing generated id>`, `totalTokensUsed: attempts.reduce((s, a) => s + a.tokensUsed, 0)`, `totalCost: attempts.reduce((s, a) => s + a.cost, 0)`, `totalDuration: attempts.reduce((s, a) => s + a.duration, 0)`. Keep every other field of the result as it is. The variables `containerName`, `operation`, `sigLabel`, `reasons` in the old block are no longer needed; delete them.

- [ ] **Step 5: Wrap the attempt loop and unwrap in the catch**

`src/parallel/orchestrator.ts`, in `processTaskForVariant`, replace the `executeCompilation` call (the `const { compileResult, infraRetries } = await this.executeCompilation(...)` statement) with:

```ts
      const attemptStart = new Date(Date.now() - llmResult.duration);
      let compiled: { compileResult: CompileWorkResult; infraRetries: InfraRetryRecord[] };
      try {
        compiled = await this.executeCompilation(
          manifest, variant, context, executionId, attemptNumber, llmResult, workItemId, options,
          attempts[attempts.length - 1]?.candidateCode,
        );
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new AttemptLoopAbort(cause, {
          attempts,
          attemptNumber,
          attemptStart,
          executionId,
          context,
          startTime,
          ...(llmResult.request ? { request: llmResult.request } : {}),
          ...(llmResult.llmResponse ? { llmResponse: llmResult.llmResponse } : {}),
        });
      }
      const { compileResult, infraRetries } = compiled;
```

In `processTask`'s catch (line 582 onward), first thing after `let err = ...`:

```ts
        let partial: AttemptLoopPartial | undefined;
        if (err instanceof AttemptLoopAbort) {
          partial = err.partial;
          err = err.cause;
        }
```

(the existing `InfraRetriesExhaustedError` unwrap stays right after it). In the `synthesizeInfraFailureResult({...})` call add:

```ts
              ...(partial
                ? {
                  priorAttempts: partial.attempts,
                  attemptNumber: partial.attemptNumber,
                  executionId: partial.executionId,
                  ...(partial.request ? { request: partial.request } : {}),
                  ...(partial.llmResponse ? { llmResponse: partial.llmResponse } : {}),
                }
                : {}),
```

and pass `startTime: partial?.attemptStart ?? new Date()` and `context: (partial?.context ?? await this.buildContext(manifest, variant, options)) as unknown as SynthContext` (so a loop abort reuses the loop's context instead of rebuilding it). Import `AttemptLoopAbort`, `AttemptLoopPartial` from `./shared/infra-attempt.ts`.

- [ ] **Step 6: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/shared/infra-attempt.test.ts tests/unit/health/ tests/unit/parallel/orchestrator-infra-exhaustion.test.ts tests/unit/parallel/orchestrator.test.ts tests/unit/ingest/ingest-assembly-infra.test.ts`
Expected: PASS. `ingest-assembly-infra` still excludes the synthesized attempt (`isInfraInvalidatedAttempt` reads `infraSynthesized`), and now keeps attempt 1 of the same task in the payload.

Run `deno check`, `deno lint src/parallel src/health`, `deno fmt` over the files listed under **Files**.

- [ ] **Step 7: Commit**

```bash
git add src/parallel/shared/infra-attempt.ts src/health/terminal-record.ts src/parallel/orchestrator.ts src/tasks/interfaces.ts tests/unit/parallel/shared/infra-attempt.test.ts tests/unit/health/terminal-record.test.ts tests/unit/parallel/orchestrator-infra-exhaustion.test.ts
git commit -m "feat(parallel): attempt-level infra record that preserves prior attempts (D10)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 6: Pure shared units: `evaluateAttempt`, `createFailedAttempt`, `finalizeTaskResult`, `buildCompileWorkItem`

**Files:**
- Create: `src/parallel/shared/evaluate-attempt.ts`, `src/parallel/shared/failed-attempt.ts`, `src/parallel/shared/finalize-task.ts`, `src/parallel/shared/compile-work-item.ts`, `src/parallel/shared/mod.ts`
- Modify: `src/parallel/orchestrator.ts` (`createAttempt` 1084-1210, `createFailedAttempt` 1215-1257, `calculateScore` 1260-1312, `calculateFinalScore` 1313-1324, `calculateAttemptMetrics` 975-990, `buildTaskResult` 996-1046, the `compileItem` literal in `executeCompilation` 800-808)
- Modify: `src/parallel/mod.ts` (re-export the shared barrel)
- Test: `tests/unit/parallel/shared/evaluate-attempt.test.ts`, `tests/unit/parallel/shared/finalize-task.test.ts`, `tests/unit/parallel/shared/compile-work-item.test.ts` (all new)

**Interfaces:**
- Produces (all pure, all exported from `src/parallel/shared/mod.ts`):

```ts
// evaluate-attempt.ts
export interface EvaluateAttemptInput {
  attemptNumber: number;
  llmResult: LLMWorkResult;          // success path: code + llmResponse present
  compileResult: CompileWorkResult;
  context: TaskExecutionContext;
  now?: Date;                        // injectable clock; default new Date()
}
export function evaluateAttempt(input: EvaluateAttemptInput): ExecutionAttempt;
export function calculateAttemptScore(compilationResult: CompilationResult, testResult: TestResult | undefined, code: string, context: TaskExecutionContext): number;

// failed-attempt.ts
export function createFailedAttempt(attemptNumber: number, llmResult: LLMWorkResult | undefined, now?: Date): ExecutionAttempt;

// finalize-task.ts
export function calculateFinalScore(attemptScore: number, attemptNumber: number): number;
export function calculateAttemptMetrics(attempts: ExecutionAttempt[], success: boolean, currentScore: number): { finalScore: number; totalTokensUsed: number; totalCost: number };
export interface FinalizeTaskInput {
  taskId: string; executionId: string; context: TaskExecutionContext;
  attempts: ExecutionAttempt[]; success: boolean; passedAttemptNumber: number;
  finalCode: string | undefined; totalDuration: number; executedBy: string; executedAt?: Date;
}
export function finalizeTaskResult(input: FinalizeTaskInput): TaskExecutionResult;

// compile-work-item.ts
export interface BuildCompileWorkItemInput {
  executionId: string; attemptNumber: number; workItemId: string;
  context: TaskExecutionContext; code: string; llmResponse: LLMResponse;
  overlayBase?: string; createdAt?: Date;
}
export function buildCompileWorkItem(input: BuildCompileWorkItemInput): CompileWorkItem;
```

The orchestrator's methods of the same names become one-line delegations (the public `createFailedAttempt` method stays for `empty-response-field.test.ts`). `finalizeTaskResult` computes `finalScore` itself: `calculateFinalScore(passing attempt's score, passedAttemptNumber)` when `success`, else the 50% penalty from `calculateAttemptMetrics`; the sync loop passes `totalDuration: Date.now() - startTime`, batch passes the sum of attempt durations (spec section 6).

- [ ] **Step 1: Write the failing tests**

`tests/unit/parallel/shared/evaluate-attempt.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { evaluateAttempt } from "../../../../src/parallel/shared/evaluate-attempt.ts";
import {
  createMockCompilationError,
  createMockCompilationResult,
  createMockLLMResponse,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createMockTestCaseResult,
  createMockTestResult,
} from "../../../utils/test-helpers.ts";

const code = 'codeunit 70001 "Ping" { procedure Ping(): Text begin exit(\'pong\'); end; }';

function llmResult(overrides: Partial<{ prompt: string }> = {}) {
  return {
    workItemId: "w",
    success: true,
    code,
    llmResponse: createMockLLMResponse({
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.02 },
      providerFinishReason: "end_turn",
    }),
    duration: 1_000,
    readyForCompile: true,
    request: { prompt: overrides.prompt ?? "RENDERED", maxTokens: 10 },
  };
}

Deno.test("evaluateAttempt: compile + tests + patterns pass", () => {
  const manifest = createMockTaskManifest({ expected: { testApp: true, mustContain: ["Ping"] } });
  const context = createMockTaskExecutionContext({ manifest });
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({ success: true }),
      testResult: createMockTestResult({ success: true, passed: 2, failed: 0 }),
      duration: 500,
      compileDuration: 300,
      testDuration: 200,
      candidateCode: code,
    },
    context,
  });
  assertEquals(a.success, true);
  assertEquals(a.prompt, "RENDERED");
  assertEquals(a.providerFinishReason, "end_turn");
  assertEquals(a.containerName, "Cronus28");
  assertEquals(a.tokensUsed, 150);
  assertEquals(a.cost, 0.02);
  assertEquals(a.duration, 1_500);
  assertEquals(a.llmDuration, 1_000);
  assertEquals(a.compileDuration, 300);
  assertEquals(a.testDuration, 200);
  assertEquals(a.candidateCode, code);
  assertEquals(a.failureReasons, []);
});

Deno.test("evaluateAttempt: failed tests and a missing pattern produce ordered failure reasons", () => {
  const manifest = createMockTaskManifest({ expected: { testApp: true, mustContain: ["SetAutoCalcFields"] } });
  const context = createMockTaskExecutionContext({ manifest });
  const a = evaluateAttempt({
    attemptNumber: 2,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({ success: true }),
      testResult: createMockTestResult({
        success: false,
        passed: 0,
        failed: 1,
        testCases: [createMockTestCaseResult({ name: "TestPing", passed: false, error: "boom" })],
      }),
      duration: 10,
      compileDuration: 5,
    },
    context,
  });
  assertEquals(a.success, false);
  assertEquals(a.failureReasons[0], "Tests failed");
  assert(a.failureReasons[1]?.includes("TestPing"));
  assert(a.failureReasons.some((r) => r.startsWith("Missing required patterns: SetAutoCalcFields")));
});

Deno.test("evaluateAttempt: compile errors are listed file:line: message", () => {
  const context = createMockTaskExecutionContext({ manifest: createMockTaskManifest({ expected: { testApp: false } }) });
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({
        success: false,
        errors: [createMockCompilationError({ file: "X.al", line: 3, message: "AL0118 nope" })],
      }),
      duration: 10,
      compileDuration: 10,
    },
    context,
  });
  assertEquals(a.success, false);
  assertEquals(a.failureReasons[0], "Compilation failed");
  assertEquals(a.failureReasons[1], "  X.al:3: AL0118 nope");
  assertEquals(a.score, 0);
});
```

(If the mock factories reject a field name used above, match the factory's real field names from `tests/utils/test-helpers.ts` and `tests/utils/mock-container-provider.ts`; the assertions are what matter.)

`tests/unit/parallel/shared/finalize-task.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import {
  calculateAttemptMetrics,
  calculateFinalScore,
  finalizeTaskResult,
} from "../../../../src/parallel/shared/finalize-task.ts";
import { createMockExecutionAttempt, createMockTaskExecutionContext } from "../../../utils/test-helpers.ts";

Deno.test("calculateFinalScore keeps the orchestrator's attempt weighting", () => {
  assertEquals(calculateFinalScore(1, 1), 1);
  assertEquals(calculateFinalScore(1, 2) < 1, true);
});

Deno.test("calculateAttemptMetrics halves the best score when nothing passed", () => {
  const attempts = [
    createMockExecutionAttempt({ attemptNumber: 1, success: false, score: 0.4, tokensUsed: 10, cost: 1 }),
    createMockExecutionAttempt({ attemptNumber: 2, success: false, score: 0.6, tokensUsed: 20, cost: 2 }),
  ];
  assertEquals(calculateAttemptMetrics(attempts, false, 0), { finalScore: 0.3, totalTokensUsed: 30, totalCost: 3 });
});

Deno.test("finalizeTaskResult sums usage, uses the given duration and marks the passing attempt", () => {
  const attempts = [
    createMockExecutionAttempt({ attemptNumber: 1, success: false, score: 0, tokensUsed: 10, cost: 1, duration: 100 }),
    createMockExecutionAttempt({ attemptNumber: 2, success: true, score: 1, tokensUsed: 20, cost: 2, duration: 200 }),
  ];
  const r = finalizeTaskResult({
    taskId: "CG-AL-E001",
    executionId: "e1",
    context: createMockTaskExecutionContext(),
    attempts,
    success: true,
    passedAttemptNumber: 2,
    finalCode: "code",
    totalDuration: 300,
    executedBy: "batch-runner",
  });
  assertEquals(r.success, true);
  assertEquals(r.passedAttemptNumber, 2);
  assertEquals(r.successRate, 0.5);
  assertEquals(r.totalTokensUsed, 30);
  assertEquals(r.totalCost, 3);
  assertEquals(r.totalDuration, 300);
  assertEquals(r.finalCode, "code");
  assertEquals(r.finalScore, calculateFinalScore(1, 2));
  assertEquals(r.executedBy, "batch-runner");
  assertEquals(r.environment.os, Deno.build.os);
});
```

`tests/unit/parallel/shared/compile-work-item.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { buildCompileWorkItem } from "../../../../src/parallel/shared/compile-work-item.ts";
import { createMockLLMResponse, createMockTaskExecutionContext } from "../../../utils/test-helpers.ts";

Deno.test("buildCompileWorkItem derives the id and carries overlayBase only when given", () => {
  const context = createMockTaskExecutionContext();
  const response = createMockLLMResponse();
  const createdAt = new Date("2026-09-06T00:00:00Z");
  const item = buildCompileWorkItem({
    executionId: "ex", attemptNumber: 2, workItemId: "w", context, code: "code", llmResponse: response, createdAt,
  });
  assertEquals(item.id, "compile_ex_2");
  assertEquals(item.llmWorkItemId, "w");
  assertEquals(item.attemptNumber, 2);
  assertEquals(item.code, "code");
  assertEquals(item.createdAt, createdAt);
  assertEquals("overlayBase" in item, false);
  const withOverlay = buildCompileWorkItem({
    executionId: "ex", attemptNumber: 2, workItemId: "w", context, code: "code", llmResponse: response, overlayBase: "base",
  });
  assertEquals(withOverlay.overlayBase, "base");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/parallel/shared/`
Expected: FAIL, modules missing.

- [ ] **Step 3: Create the units by moving the orchestrator bodies**

`src/parallel/shared/evaluate-attempt.ts`: move `calculateScore` (orchestrator lines 1260-1312) verbatim as exported `calculateAttemptScore(compilationResult, testResult, code, context)` (it does not use `this`; if it references a private helper, move that helper too). Then `evaluateAttempt` is the body of `createAttempt` (lines 1084-1210) with these substitutions: `const now = input.now ?? new Date();`, `startTime = new Date(now.getTime() - llmResult.duration - compileResult.duration)`, `endTime = now`, `this.calculateScore(` becomes `calculateAttemptScore(`, `prompt: llmResult.request?.prompt ?? context.instructions`, and the `providerFinishReason` spread from Task 4. Keep every other line, including the `abandonedGenerations`, `testResult`, `testDuration`, `quarantined` blocks.

`src/parallel/shared/failed-attempt.ts`: the body of the orchestrator's `createFailedAttempt` after Tasks 3 and 4, with `const now = nowArg ?? new Date();`.

`src/parallel/shared/finalize-task.ts`: `calculateFinalScore` (1313-1324) and `calculateAttemptMetrics` (975-990) verbatim; `finalizeTaskResult` is `buildTaskResult` (996-1046) taking `totalDuration`, `executedBy` and optional `executedAt` from its input instead of computing them, with the metrics computed inside:

```ts
  const passing = input.success
    ? input.attempts.find((a) => a.attemptNumber === input.passedAttemptNumber)
    : undefined;
  const currentScore = passing
    ? calculateFinalScore(passing.score, input.passedAttemptNumber)
    : 0;
  const metrics = calculateAttemptMetrics(input.attempts, input.success, currentScore);
```

then the result literal exactly as `buildTaskResult` builds it, with `totalDuration: input.totalDuration`, `executedAt: input.executedAt ?? new Date()`, `executedBy: input.executedBy`.

`src/parallel/shared/compile-work-item.ts`: the `compileItem` literal from `executeCompilation` (lines 800-808) with `id: \`compile_${input.executionId}_${input.attemptNumber}\``, `createdAt: input.createdAt ?? new Date()`, `...(input.overlayBase !== undefined ? { overlayBase: input.overlayBase } : {})`.

`src/parallel/shared/mod.ts`:

```ts
export type { EvaluateAttemptInput } from "./evaluate-attempt.ts";
export type { FinalizeTaskInput } from "./finalize-task.ts";
export type { BuildCompileWorkItemInput } from "./compile-work-item.ts";
export type { AttemptLoopPartial, SynthesizeInfraAttemptInput } from "./infra-attempt.ts";

export { calculateAttemptScore, evaluateAttempt } from "./evaluate-attempt.ts";
export { createFailedAttempt } from "./failed-attempt.ts";
export { calculateAttemptMetrics, calculateFinalScore, finalizeTaskResult } from "./finalize-task.ts";
export { buildCompileWorkItem } from "./compile-work-item.ts";
export { AttemptLoopAbort, synthesizeInfraAttempt } from "./infra-attempt.ts";
```

Add `export * from "./shared/mod.ts";` to `src/parallel/mod.ts`.

- [ ] **Step 4: Re-point the orchestrator**

- `createAttempt(attemptNumber, llmResult, compileResult, context)` body becomes `return evaluateAttempt({ attemptNumber, llmResult, compileResult, context });`.
- `createFailedAttempt(attemptNumber, llmResult)` body becomes `return createFailedAttemptShared(attemptNumber, llmResult);` (import with an alias).
- Delete the private `calculateScore`, `calculateFinalScore`, `calculateAttemptMetrics`, `buildTaskResult`; in `processTaskForVariant` replace the tail (`const metrics = ...` through `return this.buildTaskResult({...})`) with:

```ts
    return finalizeTaskResult({
      taskId: manifest.id,
      executionId,
      context,
      attempts,
      success,
      passedAttemptNumber,
      finalCode,
      totalDuration: Date.now() - startTime,
      executedBy: "parallel-orchestrator",
    });
```

and delete the now-unused `finalScore` local (the `finalScore = this.calculateFinalScore(...)` assignment in the loop goes too).
- In `executeCompilation`, replace the `compileItem` literal with `const compileItem = buildCompileWorkItem({ executionId, attemptNumber, workItemId, context, code: llmResult.code!, llmResponse: llmResult.llmResponse!, ...(overlayBase !== undefined ? { overlayBase } : {}) });`.

- [ ] **Step 5: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/ --ignore=tests/unit/parallel/streaming-transport-routing.test.ts && deno test --allow-all tests/unit/parallel/streaming-transport-routing.test.ts tests/unit/ingest/ tests/unit/cli/`
Expected: PASS with identical scores and failure-reason strings (the golden fixtures under `tests/unit/cli/` and `tests/unit/ingest/` exercise them).

Run `deno check`, `deno lint src/parallel`, `deno fmt` over the files under **Files**.

- [ ] **Step 6: Commit**

```bash
git add src/parallel/shared src/parallel/orchestrator.ts src/parallel/mod.ts tests/unit/parallel/shared
git commit -m "refactor(parallel): extract evaluateAttempt, createFailedAttempt, finalizeTaskResult and buildCompileWorkItem into shared units (D6)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 7: `runCompileWorkItem` and `buildAttemptContext`

**Files:**
- Create: `src/parallel/shared/run-compile.ts`, `src/parallel/shared/attempt-context.ts`
- Modify: `src/parallel/orchestrator.ts` (`executeCompilation` 786-880 becomes a delegation; `buildContext` 1048-1083 moves out), `src/parallel/shared/mod.ts`
- Test: `tests/unit/parallel/shared/run-compile.test.ts` (new); the existing orchestrator suites cover `buildAttemptContext` through the delegation

**Interfaces:**
- Produces:

```ts
// run-compile.ts
export interface RunCompileDeps {
  queue: { enqueue(item: CompileWorkItem, options?: CompileEnqueueOptions): Promise<CompileWorkResult>; readonly length: number };
  configuredContainers: string[];
  maxRetries: number;                       // options.infraRetriesPerAttempt ?? 1
  emit: (event: ParallelExecutionEvent) => void;
  healthMonitor?: ContainerHealthMonitor;
  taskId: string;
  variantId: string;
}
export function runCompileWorkItem(item: CompileWorkItem, deps: RunCompileDeps): Promise<{ compileResult: CompileWorkResult; infraRetries: InfraRetryRecord[] }>;

// attempt-context.ts
export function buildAttemptContext(manifest: TaskManifest, variant: ModelVariant, options: ParallelBenchmarkOptions): Promise<TaskExecutionContext>;
```

Ruling recorded here: the spec writes `buildAttemptContext(manifest, variantConfig, runSettings, attempt, prior?)`; today's context is attempt-independent (attempt data lives on the work item), so the extracted function keeps the three parameters `buildContext` already takes. Plan B calls the same function per task. `runCompileWorkItem` emits `compile_queued`, `compile_started` (per routed try) and `compile_completed` exactly as `executeCompilation` does today, and throws whatever `withInfraRetry` throws (`InfraRetriesExhaustedError` on exhaustion).

- [ ] **Step 1: Write the failing test**

`tests/unit/parallel/shared/run-compile.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { CompileWorkItem, CompileWorkResult, ParallelExecutionEvent } from "../../../../src/parallel/types.ts";
import { runCompileWorkItem } from "../../../../src/parallel/shared/run-compile.ts";
import { InfraRetriesExhaustedError } from "../../../../src/parallel/infra-retry.ts";
import { MultiContainerMockCompileQueue } from "../../../utils/multi-container-mock-compile-queue.ts";
import { createMockCompileWorkItem } from "../../../utils/test-helpers.ts";

const CONTAINER = "Cronus28";

Deno.test("runCompileWorkItem returns the queue result and emits the compile events", async () => {
  const queue = new MultiContainerMockCompileQueue([CONTAINER]);
  const events: ParallelExecutionEvent["type"][] = [];
  const item: CompileWorkItem = createMockCompileWorkItem({ attemptNumber: 1 });
  const { compileResult, infraRetries } = await runCompileWorkItem(item, {
    queue,
    configuredContainers: [CONTAINER],
    maxRetries: 1,
    emit: (e) => events.push(e.type),
    taskId: item.context.manifest.id,
    variantId: item.context.variantId,
  });
  assertEquals(compileResult.containerName, CONTAINER);
  assertEquals(infraRetries, []);
  assertEquals(events, ["compile_queued", "compile_started", "compile_completed"]);
});

Deno.test("runCompileWorkItem rethrows infra exhaustion from a quarantined result", async () => {
  class Quarantines extends MultiContainerMockCompileQueue {
    override async enqueue(item: CompileWorkItem, options?: Parameters<MultiContainerMockCompileQueue["enqueue"]>[1]): Promise<CompileWorkResult> {
      const r = await super.enqueue(item, options);
      r.quarantined = { quarantined: true, forcedByAlertId: "alert-1", originContainer: CONTAINER, classificationReason: "container_quarantined" };
      return r;
    }
  }
  const item = createMockCompileWorkItem({ attemptNumber: 1 });
  const err = await assertRejects(
    () => runCompileWorkItem(item, {
      queue: new Quarantines([CONTAINER]),
      configuredContainers: [CONTAINER],
      maxRetries: 0,
      emit: () => {},
      taskId: item.context.manifest.id,
      variantId: item.context.variantId,
    }),
    InfraRetriesExhaustedError,
  );
  assert(err.retries.length >= 1);
});
```

(If `InfraRetriesExhaustedError` is not exported from `src/parallel/infra-retry.ts`, import it from wherever `src/parallel/orchestrator.ts` imports it.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/parallel/shared/run-compile.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`src/parallel/shared/run-compile.ts`: the body of `executeCompilation` from `this.emit({ type: "compile_queued", ...` to `return { compileResult, infraRetries: retries };`, with `this.emit` replaced by `deps.emit`, `manifest.id` by `deps.taskId`, `variant.variantId` by `deps.variantId`, `this.compileQueue!.enqueue` by `deps.queue.enqueue`, `this.compileQueue?.length ?? 0` by `deps.queue.length`, `maxRetries` by `deps.maxRetries`, `configuredContainers` by `deps.configuredContainers`, and the health-monitor spread reading `deps.healthMonitor`. The `context` object passed to `withInfraRetry` keeps `{ taskId, variantId, attemptNumber: item.attemptNumber }`.

`src/parallel/shared/attempt-context.ts`: `buildContext` (orchestrator 1048-1083) moved verbatim as `buildAttemptContext`, replacing any `this.` reads with the equivalent import (it should only touch its three arguments; if it reads `this.config.templateDir` or similar, add that value as a fourth parameter `templateDir: string` and pass `this.config.templateDir` from the orchestrator).

Orchestrator: `executeCompilation` becomes

```ts
    const compileItem = buildCompileWorkItem({ ...as in Task 6 });
    const configuredContainers = this.config.containerNames && this.config.containerNames.length > 0
      ? this.config.containerNames
      : [options.containerName];
    return runCompileWorkItem(compileItem, {
      queue: this.compileQueue!,
      configuredContainers,
      maxRetries: options.infraRetriesPerAttempt ?? 1,
      emit: this.emit.bind(this),
      ...(this.healthMonitor ? { healthMonitor: this.healthMonitor } : {}),
      taskId: manifest.id,
      variantId: variant.variantId,
    });
```

and `buildContext` becomes `return buildAttemptContext(manifest, variant, options);`. Export both from `src/parallel/shared/mod.ts`.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/ --ignore=tests/unit/parallel/streaming-transport-routing.test.ts && deno test --allow-all tests/unit/parallel/streaming-transport-routing.test.ts`
Expected: PASS.

Run `deno check`, `deno lint src/parallel`, `deno fmt` over the files under **Files**.

- [ ] **Step 5: Commit**

```bash
git add src/parallel/shared src/parallel/orchestrator.ts tests/unit/parallel/shared/run-compile.test.ts
git commit -m "refactor(parallel): extract runCompileWorkItem and buildAttemptContext (D6)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 8: `priceUsage`, batch rates in `PricingService`, priced once in the pool

**Files:**
- Modify: `src/llm/pricing-types.ts:9-14` (`ModelPricing` gains optional cache and batch rates)
- Modify: `src/llm/pricing-service.ts:45-52` (`CatalogPricingRow`), `:214-241` (`loadCatalogPricing` maps the new columns)
- Create: `src/parallel/shared/price-usage.ts`
- Modify: `src/llm/anthropic-adapter.ts:208-216` (`pricingSlugForAttempt` moves to `price-usage.ts`; the adapter re-exports it)
- Modify: `src/parallel/llm-work-pool.ts:93-125` (`mergeUsageAcrossAttempts` stops summing `estimatedCost`), `:295-310` (price once after the merge)
- Modify: `src/parallel/shared/mod.ts`
- Test: `tests/unit/parallel/shared/price-usage.test.ts` (new), `tests/unit/llm/pricing-service.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
// pricing-types.ts
export interface ModelPricing {
  input: number; output: number;                 // USD per 1K tokens (unchanged)
  cacheRead?: number; cacheWrite?: number;       // USD per 1K, from the catalog when present
  batchInput?: number; batchOutput?: number;
  batchCacheRead?: number; batchCacheWrite?: number;
}
// pricing-service.ts
export interface CatalogPricingRow {
  model_slug: string; effective_from: string; effective_until?: string | null;
  input_per_mtoken: number; output_per_mtoken: number;
  cache_read_per_mtoken?: number | null; cache_write_per_mtoken?: number | null;
  batch_input_per_mtoken?: number | null; batch_output_per_mtoken?: number | null;
  batch_cache_read_per_mtoken?: number | null; batch_cache_write_per_mtoken?: number | null;
  source?: string;
}
// price-usage.ts
export type PriceMode = "sync" | "batch";
export interface PriceUsageInput { usage: TokenUsage; provider: string; requestedModel: string; servedModel?: string | undefined; mode: PriceMode }
export class BatchPricingUnavailableError extends Error { constructor(public readonly slug: string) }
export function pricingSlugForAttempt(requestedSlug: string, servedModel?: string): string;   // moved, unchanged
export function priceUsage(input: PriceUsageInput): TokenUsage;   // returns a copy with estimatedCost set
```

`priceUsage` is the only place cost is computed for an attempt (spec section 6). Adapters keep their internal `estimatedCost` for live streaming display; the pool overwrites it after the empty-retry merge, so the recorded cost is always `priceUsage`'s. Batch mode throws `BatchPricingUnavailableError` when the catalog row has no batch rates (spec D5; Plan B's `submit` turns that into a refusal).

- [ ] **Step 1: Write the failing tests**

`tests/unit/parallel/shared/price-usage.test.ts`:

```ts
import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { PricingService } from "../../../../src/llm/pricing-service.ts";
import {
  BatchPricingUnavailableError,
  priceUsage,
  pricingSlugForAttempt,
} from "../../../../src/parallel/shared/price-usage.ts";

function seed(): void {
  PricingService.clearCatalogPricing();
  PricingService.loadCatalogPricing([
    {
      model_slug: "anthropic/claude-haiku-4-5",
      effective_from: "2026-01-01",
      input_per_mtoken: 1,
      output_per_mtoken: 5,
      cache_read_per_mtoken: 0.1,
      cache_write_per_mtoken: 1.25,
      batch_input_per_mtoken: 0.5,
      batch_output_per_mtoken: 2.5,
      batch_cache_read_per_mtoken: 0.05,
      batch_cache_write_per_mtoken: 0.625,
      source: "manual",
    },
    {
      model_slug: "anthropic/claude-opus-5",
      effective_from: "2026-01-01",
      input_per_mtoken: 10,
      output_per_mtoken: 50,
      source: "manual",
    },
  ]);
}

const usage = { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000, cacheReadTokens: 1000, cacheCreationTokens: 1000 };

Deno.test("priceUsage sync uses catalog cache rates when present", () => {
  seed();
  const out = priceUsage({ usage, provider: "anthropic", requestedModel: "claude-haiku-4-5", mode: "sync" });
  assertAlmostEquals(out.estimatedCost ?? -1, 0.001 + 0.005 + 0.0001 + 0.00125, 1e-9);
  assertEquals(usage.hasOwnProperty("estimatedCost"), false, "input is not mutated");
});

Deno.test("priceUsage sync falls back to the 0.10 / 1.25 cache heuristic without catalog cache rates", () => {
  seed();
  const out = priceUsage({ usage, provider: "anthropic", requestedModel: "claude-opus-5", mode: "sync" });
  assertAlmostEquals(out.estimatedCost ?? -1, 0.01 + 0.05 + 0.01 * 0.10 + 0.01 * 1.25, 1e-9);
});

Deno.test("priceUsage batch uses batch columns and refuses without them", () => {
  seed();
  const out = priceUsage({ usage, provider: "anthropic", requestedModel: "claude-haiku-4-5", mode: "batch" });
  assertAlmostEquals(out.estimatedCost ?? -1, 0.0005 + 0.0025 + 0.00005 + 0.000625, 1e-9);
  assertThrows(
    () => priceUsage({ usage, provider: "anthropic", requestedModel: "claude-opus-5", mode: "batch" }),
    BatchPricingUnavailableError,
  );
});

Deno.test("priceUsage prices by the served model when present", () => {
  seed();
  const served = priceUsage({ usage, provider: "anthropic", requestedModel: "claude-opus-5", servedModel: "claude-haiku-4-5", mode: "sync" });
  const direct = priceUsage({ usage, provider: "anthropic", requestedModel: "claude-haiku-4-5", mode: "sync" });
  assertEquals(served.estimatedCost, direct.estimatedCost);
  assertEquals(pricingSlugForAttempt("anthropic/claude-opus-5", "claude-haiku-4-5"), "anthropic/claude-haiku-4-5");
});
```

Extend `tests/unit/llm/pricing-service.test.ts` with:

```ts
Deno.test("loadCatalogPricing maps cache and batch columns per 1K tokens", () => {
  PricingService.clearCatalogPricing();
  PricingService.loadCatalogPricing([{
    model_slug: "x/y", effective_from: "2026-01-01", input_per_mtoken: 1000, output_per_mtoken: 2000,
    cache_read_per_mtoken: 100, batch_input_per_mtoken: 500, batch_output_per_mtoken: 1000, source: "manual",
  }]);
  const p = PricingService.getPriceSync("x", "y");
  assertEquals(p, { input: 1, output: 2, cacheRead: 0.1, batchInput: 0.5, batchOutput: 1 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/parallel/shared/price-usage.test.ts tests/unit/llm/pricing-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/llm/pricing-types.ts`: add the six optional fields to `ModelPricing` with the comment `/** USD per 1K tokens; present only when the catalog row carries the column. */`.

`src/llm/pricing-service.ts`: extend `CatalogPricingRow` as above; in `loadCatalogPricing` replace the `map.set(slug, {...})` literal with:

```ts
      const perK = (v: number | null | undefined): number | undefined =>
        typeof v === "number" ? v / 1000 : undefined;
      const entry: ModelPricing = {
        input: row.input_per_mtoken / 1000,
        output: row.output_per_mtoken / 1000,
      };
      const optional: Array<[keyof ModelPricing, number | undefined]> = [
        ["cacheRead", perK(row.cache_read_per_mtoken)],
        ["cacheWrite", perK(row.cache_write_per_mtoken)],
        ["batchInput", perK(row.batch_input_per_mtoken)],
        ["batchOutput", perK(row.batch_output_per_mtoken)],
        ["batchCacheRead", perK(row.batch_cache_read_per_mtoken)],
        ["batchCacheWrite", perK(row.batch_cache_write_per_mtoken)],
      ];
      for (const [k, v] of optional) if (v !== undefined) entry[k] = v;
      map.set(slug, entry);
```

`src/parallel/shared/price-usage.ts`:

```ts
import type { TokenUsage } from "../../llm/types.ts";
import type { ModelPricing } from "../../llm/pricing-types.ts";
import { PricingService } from "../../llm/pricing-service.ts";

export type PriceMode = "sync" | "batch";

export interface PriceUsageInput {
  usage: TokenUsage;
  provider: string;
  requestedModel: string;
  servedModel?: string | undefined;
  mode: PriceMode;
}

export class BatchPricingUnavailableError extends Error {
  constructor(public readonly slug: string) {
    super(`no batch pricing in the catalog for ${slug}; add batch_*_per_mtoken to site/catalog/pricing.yml and sync-catalog --apply`);
    this.name = "BatchPricingUnavailableError";
  }
}

/** Slug to price an attempt by: the served model when a fallback rescued it. Moved from anthropic-adapter.ts. */
export function pricingSlugForAttempt(requestedSlug: string, servedModel?: string): string {
  if (servedModel === undefined) return requestedSlug;
  const vendor = requestedSlug.split("/")[0];
  return `${vendor}/${servedModel}`;
}

function rates(p: ModelPricing, mode: PriceMode, slug: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (mode === "batch") {
    if (p.batchInput === undefined || p.batchOutput === undefined) {
      throw new BatchPricingUnavailableError(slug);
    }
    return {
      input: p.batchInput,
      output: p.batchOutput,
      cacheRead: p.batchCacheRead ?? p.batchInput * 0.10,
      cacheWrite: p.batchCacheWrite ?? p.batchInput * 1.25,
    };
  }
  return {
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead ?? p.input * 0.10,
    cacheWrite: p.cacheWrite ?? p.input * 1.25,
  };
}

/**
 * The only place an attempt's cost is computed (spec section 6). Returns a
 * copy of `usage` with `estimatedCost`; never mutates the input.
 */
export function priceUsage(input: PriceUsageInput): TokenUsage {
  const slug = pricingSlugForAttempt(`${input.provider}/${input.requestedModel}`, input.servedModel);
  const model = slug.slice(slug.indexOf("/") + 1);
  const r = rates(PricingService.getPriceSync(input.provider, model), input.mode, slug);
  const u = input.usage;
  const cost = (u.promptTokens / 1000) * r.input +
    (u.completionTokens / 1000) * r.output +
    ((u.cacheReadTokens ?? 0) / 1000) * r.cacheRead +
    ((u.cacheCreationTokens ?? 0) / 1000) * r.cacheWrite;
  return { ...u, estimatedCost: cost };
}
```

`src/llm/anthropic-adapter.ts`: delete the local `pricingSlugForAttempt` body and replace it with `export { pricingSlugForAttempt } from "../parallel/shared/price-usage.ts";` placed with the other imports (keep the internal call sites unchanged; they now resolve to the re-export). If that creates an import cycle warning under `deno check`, import it as `import { pricingSlugForAttempt } from "../parallel/shared/price-usage.ts";` and add a separate `export { pricingSlugForAttempt };` line.

`src/parallel/llm-work-pool.ts`: in `mergeUsageAcrossAttempts` delete the `estimatedCost` summing block. In `executeWork`, right after `const emptyRetryCount = retryOutcome.retryCount;` add:

```ts
      continuationResult.response.usage = priceUsage({
        usage: continuationResult.response.usage,
        provider: item.llmProvider,
        requestedModel: item.llmModel,
        ...(continuationResult.response.servedModel !== undefined
          ? { servedModel: continuationResult.response.servedModel }
          : {}),
        mode: "sync",
      });
```

(import `priceUsage` from `./shared/price-usage.ts`). Export `priceUsage`, `pricingSlugForAttempt`, `BatchPricingUnavailableError` and the `PriceMode`, `PriceUsageInput` types from `src/parallel/shared/mod.ts`.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/shared/ tests/unit/llm/pricing-service.test.ts tests/unit/llm/anthropic-adapter.test.ts tests/unit/parallel/llm-work-pool.test.ts` (if the Anthropic adapter test file has a different name, run `tests/unit/llm/` whole)
Expected: PASS.

Run `deno check`, `deno lint src/llm src/parallel`, `deno fmt` over the files under **Files**.

- [ ] **Step 5: Commit**

```bash
git add src/llm/pricing-types.ts src/llm/pricing-service.ts src/llm/anthropic-adapter.ts src/parallel/shared src/parallel/llm-work-pool.ts tests/unit/parallel/shared/price-usage.test.ts tests/unit/llm/pricing-service.test.ts
git commit -m "feat(pricing): priceUsage as the single cost computation with batch rates from the catalog (D5, D6)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 9: Canonical settings helper shared by client and server

**Files:**
- Create: `shared/settings-hash.ts`, `shared/fixtures/settings-hash.fixture.json`
- Create: `site/src/lib/shared/settings-hash.ts` (one-line re-export, like `site/src/lib/shared/canonical.ts`)
- Modify: `site/src/lib/server/ingest.ts:8-18` (`settingsHash` delegates to the shared helper)
- Test: `tests/unit/shared/settings-hash.test.ts` (new), `site/tests/settings-hash-parity.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export type InvocationMode = "sync" | "batch";
export type FallbackPolicy = "requested" | "unavailable";
export interface CanonicalSettingsExtras {
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
export interface CanonicalSettings {
  temperature: number | null; max_attempts: number | null; max_tokens: number | null;
  prompt_version: string | null; bc_version: string | null; extra_json: string | null;
}
export interface SettingsBase { temperature?: number | null; max_attempts?: number | null; max_tokens?: number | null; prompt_version?: string | null; bc_version?: string | null }
export function extrasJson(extras: CanonicalSettingsExtras): string;                  // canonicalJSON(extras)
export function buildCanonicalSettings(base: SettingsBase, extras: CanonicalSettingsExtras): CanonicalSettings;
export function settingsHashOf(settings: SettingsBase & { extra_json?: string | null }): Promise<string>;  // sha256 hex of canonicalJSON of the six keys, `?? null` each; byte-identical to the server's existing hash
export function promptProfileDigest(input: { overrides: Record<string, unknown> | null; knowledge: string | null; variantSystemPrompt: string | null }): Promise<string>;
export function sha256Hex(text: string): Promise<string>;   // runtime-neutral (crypto.subtle)
```

The file must stay runtime-neutral (Deno, Workers, vitest under Node): only `./canonical.ts`, `TextEncoder` and `crypto.subtle`. Tasks 11 and 13 consume it on both sides.

- [ ] **Step 1: Write the failing Deno test**

`tests/unit/shared/settings-hash.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import {
  buildCanonicalSettings,
  extrasJson,
  promptProfileDigest,
  settingsHashOf,
} from "../../../shared/settings-hash.ts";
import type { CanonicalSettingsExtras } from "../../../shared/settings-hash.ts";

const extras: CanonicalSettingsExtras = {
  invocation_mode: "batch",
  continuation: { enabled: false, max: 0 },
  empty_retry: { enabled: false, max: 0 },
  fallback_policy: "unavailable",
  provider_route: "anthropic",
  endpoint: "/v1/messages",
  thinking_budget: null,
  prompt_profile_digest: "a".repeat(64),
  infra_retries_per_attempt: 1,
};

Deno.test("extrasJson is canonical (sorted keys, no whitespace)", () => {
  assertEquals(
    extrasJson(extras),
    '{"continuation":{"enabled":false,"max":0},"empty_retry":{"enabled":false,"max":0},"endpoint":"/v1/messages","fallback_policy":"unavailable","infra_retries_per_attempt":1,"invocation_mode":"batch","prompt_profile_digest":"' +
      "a".repeat(64) + '","provider_route":"anthropic","thinking_budget":null}',
  );
});

Deno.test("buildCanonicalSettings fills the six keys and nothing else", () => {
  const s = buildCanonicalSettings({ temperature: 0, max_tokens: 64000 }, extras);
  assertEquals(Object.keys(s).sort(), ["bc_version", "extra_json", "max_attempts", "max_tokens", "prompt_version", "temperature"]);
  assertEquals(s.max_attempts, null);
  assertEquals(s.extra_json, extrasJson(extras));
});

Deno.test("settingsHashOf matches the committed fixture and hashes legacy null/string extra_json unchanged", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("shared/fixtures/settings-hash.fixture.json")) as {
    cases: Array<{ name: string; settings: Record<string, unknown>; hash: string }>;
  };
  for (const c of fixture.cases) {
    assertEquals(await settingsHashOf(c.settings), c.hash, c.name);
  }
});

Deno.test("promptProfileDigest is stable and sensitive to every part", async () => {
  const base = { overrides: { prefix: "p" }, knowledge: "k", variantSystemPrompt: null };
  const d1 = await promptProfileDigest(base);
  assertEquals(d1.length, 64);
  assertEquals(await promptProfileDigest({ ...base }), d1);
  assertEquals((await promptProfileDigest({ ...base, knowledge: "k2" })) === d1, false);
  assertEquals((await promptProfileDigest({ ...base, variantSystemPrompt: "s" })) === d1, false);
});
```

Fixture `shared/fixtures/settings-hash.fixture.json` (the `hash` values are computed ONCE by running `settingsHashOf` after Step 3 and pinned; the executor fills them in and never edits them again):

```json
{
  "cases": [
    { "name": "legacy null extras", "settings": { "temperature": 0, "max_attempts": 2, "max_tokens": 64000 }, "hash": "FILL" },
    { "name": "legacy string extras", "settings": { "temperature": 0, "max_attempts": 2, "extra_json": "{\"thinking\":true}" }, "hash": "FILL" },
    { "name": "batch profile", "settings": { "temperature": 0, "max_attempts": 2, "max_tokens": 64000, "prompt_version": null, "bc_version": null, "extra_json": "{\"continuation\":{\"enabled\":false,\"max\":0},\"empty_retry\":{\"enabled\":false,\"max\":0},\"endpoint\":\"/v1/messages\",\"fallback_policy\":\"unavailable\",\"infra_retries_per_attempt\":1,\"invocation_mode\":\"batch\",\"prompt_profile_digest\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"provider_route\":\"anthropic\",\"thinking_budget\":null}" }, "hash": "FILL" }
  ]
}
```

The "legacy null extras" case MUST equal what today's server produces: before writing the helper, compute it with the current server code by adding a temporary `console.log` in a vitest test, or by evaluating `sha256Hex(canonicalJSON({temperature:0,max_attempts:2,max_tokens:64000,prompt_version:null,bc_version:null,extra_json:null}))` in Deno with `shared/canonical.ts`. Both must give the same string; pin that.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/shared/settings-hash.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`shared/settings-hash.ts`:

```ts
import { canonicalJSON } from "./canonical.ts";

export type InvocationMode = "sync" | "batch";
export type FallbackPolicy = "requested" | "unavailable";

export interface CanonicalSettingsExtras {
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

/** The six keys the server hashes. Unchanged since migration 0001. */
export interface CanonicalSettings {
  temperature: number | null;
  max_attempts: number | null;
  max_tokens: number | null;
  prompt_version: string | null;
  bc_version: string | null;
  extra_json: string | null;
}

export interface SettingsBase {
  temperature?: number | null;
  max_attempts?: number | null;
  max_tokens?: number | null;
  prompt_version?: string | null;
  bc_version?: string | null;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

export function extrasJson(extras: CanonicalSettingsExtras): string {
  return canonicalJSON(extras);
}

export function buildCanonicalSettings(
  base: SettingsBase,
  extras: CanonicalSettingsExtras,
): CanonicalSettings {
  return {
    temperature: base.temperature ?? null,
    max_attempts: base.max_attempts ?? null,
    max_tokens: base.max_tokens ?? null,
    prompt_version: base.prompt_version ?? null,
    bc_version: base.bc_version ?? null,
    extra_json: extrasJson(extras),
  };
}

/** Byte-identical to the server's historical settings hash. */
export function settingsHashOf(
  settings: SettingsBase & { extra_json?: string | null },
): Promise<string> {
  return sha256Hex(canonicalJSON({
    temperature: settings.temperature ?? null,
    max_attempts: settings.max_attempts ?? null,
    max_tokens: settings.max_tokens ?? null,
    prompt_version: settings.prompt_version ?? null,
    bc_version: settings.bc_version ?? null,
    extra_json: settings.extra_json ?? null,
  }));
}

/** sha256 over the resolved prompt overrides, knowledge text and variant system prompt. */
export function promptProfileDigest(input: {
  overrides: Record<string, unknown> | null;
  knowledge: string | null;
  variantSystemPrompt: string | null;
}): Promise<string> {
  return sha256Hex(canonicalJSON({
    overrides: input.overrides,
    knowledge: input.knowledge,
    variant_system_prompt: input.variantSystemPrompt,
  }));
}
```

`site/src/lib/shared/settings-hash.ts`: `export * from "../../../../shared/settings-hash.ts";` (mirror the exact relative path style of `site/src/lib/shared/canonical.ts`).

`site/src/lib/server/ingest.ts`: replace the body of `settingsHash` with `return settingsHashOf(settings);` importing `settingsHashOf` from `$lib/shared/settings-hash`. Keep the exported name `settingsHash`.

`site/tests/settings-hash-parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fixture from "../../shared/fixtures/settings-hash.fixture.json?raw";
import { settingsHash } from "../src/lib/server/ingest";
import { settingsHashOf } from "../src/lib/shared/settings-hash";

describe("settings hash parity (client helper == server hash)", () => {
  it("matches the committed fixture on both entry points", async () => {
    const cases = (JSON.parse(fixture) as { cases: Array<{ name: string; settings: Record<string, unknown>; hash: string }> }).cases;
    for (const c of cases) {
      expect(await settingsHashOf(c.settings), c.name).toBe(c.hash);
      expect(await settingsHash(c.settings), c.name).toBe(c.hash);
    }
  });
});
```

(If `site/tests/canonical-parity.test.ts` runs under `vitest.unit.config.ts` rather than the worker config, register this file the same way.)

- [ ] **Step 4: Fill the fixture, run tests and checks**

Compute the three hashes with the new helper (`deno eval` importing `shared/settings-hash.ts`), pin them in the fixture, and confirm the first equals the pre-change server value captured in Step 1.

Run: `deno test --allow-all tests/unit/shared/settings-hash.test.ts tests/unit/canonical_parity_test.ts`
Expected: PASS.

Run: `cd site && npm run build && npm run test:main && cd ..`
Expected: PASS.

Run: `deno check shared/settings-hash.ts && deno lint shared && deno fmt shared/settings-hash.ts tests/unit/shared/settings-hash.test.ts`

- [ ] **Step 5: Commit**

```bash
git add shared/settings-hash.ts shared/fixtures/settings-hash.fixture.json site/src/lib/shared/settings-hash.ts site/src/lib/server/ingest.ts tests/unit/shared/settings-hash.test.ts site/tests/settings-hash-parity.test.ts
git commit -m "feat(settings): canonical settings profile helper shared by client and server (D4)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 10: `renderLLMRequest` with explicit inputs (no `Deno.cwd()` reads)

**Files:**
- Create: `src/parallel/shared/prompt-inputs.ts`, `src/parallel/shared/render-request.ts`
- Modify: `src/parallel/llm-work-pool.ts:568-660` (`buildRequest` delegates; `extractErrors` moves), `:144-160` (keep the renderer; add `starterRoot`)
- Modify: `src/parallel/types.ts` (`ParallelExecutionConfig.starterRoot?: string`)
- Modify: `src/parallel/shared/mod.ts`
- Test: `tests/unit/parallel/shared/render-request.test.ts` (new)

**Interfaces:**
- Produces:

```ts
// prompt-inputs.ts
export interface RenderInputs {
  provider: string;
  apiModelId: string;
  variantConfig: VariantConfig | null;          // effective, after preset and CLI merge
  variantSystemPrompt: string | null;           // resolved text (variantConfig.systemPrompt)
  promptOverrides: CLIPromptOverrides | null;   // resolved values, not names
  knowledge: { content: string } | { ref: string; sha256: string } | null;
  templateDir: string;
  starterRoot: string;                          // directory that contains tasks/starter/<id>/
}
export interface FrozenPromptInputs extends RenderInputs { settings: CanonicalSettings }   // Plan B writes prompt-inputs.json from this
export function renderInputsFor(item: LLMWorkItem, config: { templateDir: string; starterRoot: string }): RenderInputs;

// render-request.ts
export function extractFixErrors(attempt: { compilationResult?: { errors: Array<{ message: string }> } | undefined; failureReasons: string[] }): string[];   // moved verbatim from LLMWorkPool.extractErrors
export function renderLLMRequest(args: {
  context: TaskExecutionContext;                // carries manifest, instructions, temperature, maxTokens
  attemptNumber: number;
  prior?: ExecutionAttempt | undefined;
  inputs: RenderInputs;
  renderer?: TemplateRenderer;                  // default: cached per inputs.templateDir
}): Promise<LLMRequest>;
```

Spec section 6 writes `renderLLMRequest(context, attempt, prior?, inputs)`; the object form above is the same four things. `knowledge` in sync is `{ content: promptOverrides.knowledgeContent }` when present, else `null`; the `ref` form is for Plan B's run directory. The 400,000-character previous-code cap, the ordered `failureReasons` and `retrySourceFor` are already inside `buildFixPrompt` / `retrySourceFor` (`src/llm/prompt-building.ts`, `src/tasks/object-overlay.ts`); this task moves the call, not the rules.

- [ ] **Step 1: Write the failing test**

`tests/unit/parallel/shared/render-request.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { renderLLMRequest } from "../../../../src/parallel/shared/render-request.ts";
import type { RenderInputs } from "../../../../src/parallel/shared/prompt-inputs.ts";
import {
  cleanupTempDir,
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createTempDir,
} from "../../../utils/test-helpers.ts";

function inputs(starterRoot: string): RenderInputs {
  return {
    provider: "mock",
    apiModelId: "mock-gpt-4",
    variantConfig: null,
    variantSystemPrompt: null,
    promptOverrides: null,
    knowledge: null,
    templateDir: "templates",
    starterRoot,
  };
}

Deno.test("renderLLMRequest attempt 1 reads starter code from inputs.starterRoot, not cwd", async () => {
  const root = await createTempDir("render-root");
  try {
    const starterDir = join(root, "tasks", "starter", "CG-AL-X999");
    await Deno.mkdir(starterDir, { recursive: true });
    await Deno.writeTextFile(join(starterDir, "Thing.Codeunit.al"), "codeunit 70999 Thing { }");
    const manifest = createMockTaskManifest({
      id: "CG-AL-X999",
      description: "Find and fix the defect.",
      prompt_template: "diagnose.md",
    });
    const context = createMockTaskExecutionContext({ manifest, instructions: manifest.description, temperature: 0.2, maxTokens: 1234 });
    const req = await renderLLMRequest({ context, attemptNumber: 1, inputs: inputs(root) });
    assert(req.prompt.includes("codeunit 70999 Thing"));
    assert(req.prompt.includes("Find and fix the defect."));
    assertEquals(req.temperature, 0.2);
    assertEquals(req.maxTokens, 1234);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("renderLLMRequest attempt 2 builds the fix prompt from the prior attempt", async () => {
  const manifest = createMockTaskManifest({ id: "CG-AL-E001", description: "Create Ping." });
  const context = createMockTaskExecutionContext({ manifest, instructions: manifest.description });
  const prior = createMockExecutionAttempt({
    attemptNumber: 1,
    success: false,
    extractedCode: "codeunit 70001 Ping { }",
    candidateCode: "codeunit 70001 Ping { /* candidate */ }",
    failureReasons: ["Compilation failed", "  Ping.al:1: AL0118 nope"],
  });
  const req = await renderLLMRequest({ context, attemptNumber: 2, prior, inputs: inputs(Deno.cwd()) });
  assert(req.prompt.includes("/* candidate */"), "fix prompt uses candidateCode via retrySourceFor");
  assert(req.prompt.includes("AL0118 nope"));
});

Deno.test("renderLLMRequest applies the variant system prompt and knowledge", async () => {
  const manifest = createMockTaskManifest({ id: "CG-AL-E001", description: "Create Ping." });
  const context = createMockTaskExecutionContext({ manifest, instructions: manifest.description });
  const req = await renderLLMRequest({
    context,
    attemptNumber: 1,
    inputs: {
      ...inputs(Deno.cwd()),
      variantSystemPrompt: "VARIANT SYSTEM",
      promptOverrides: { knowledgeContent: "KNOWLEDGE BANK" },
      knowledge: { content: "KNOWLEDGE BANK" },
    },
  });
  assertEquals(req.systemPrompt, "VARIANT SYSTEM");
});
```

(The third test pins today's precedence: `variantConfig.systemPrompt` overrides the injected system prompt, exactly as `buildRequest` lines 640-660 do. If the current code composes them instead of replacing, assert the composed result; do not change behaviour in this task.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/parallel/shared/render-request.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

`src/parallel/shared/prompt-inputs.ts`: the two interfaces above plus

```ts
export function renderInputsFor(
  item: LLMWorkItem,
  config: { templateDir: string; starterRoot: string },
): RenderInputs {
  const vc = item.context.variantConfig ?? null;
  const overrides = item.context.promptOverrides ?? null;
  return {
    provider: item.llmProvider,
    apiModelId: item.llmModel,
    variantConfig: vc,
    variantSystemPrompt: vc?.systemPrompt ?? null,
    promptOverrides: overrides,
    knowledge: overrides?.knowledgeContent !== undefined ? { content: overrides.knowledgeContent } : null,
    templateDir: config.templateDir,
    starterRoot: config.starterRoot,
  };
}
```

(`TaskExecutionContext.promptOverrides` is what `buildRequest` reads today as `item.context.promptOverrides`; keep that source.)

`src/parallel/shared/render-request.ts`: copy the pool's imports for `buildGenerationPrompt`, `buildFixPrompt`, `PromptInjectionResolver`, `retrySourceFor`, `usesObjectOverlay`, `loadStarterCode`, `starterDirForTask`, `TemplateRenderer`; move `extractErrors` verbatim as `extractFixErrors`; add a module-level `const renderers = new Map<string, TemplateRenderer>(); function rendererFor(dir: string): TemplateRenderer` that creates one per `templateDir`. `renderLLMRequest` is the body of `buildRequest` (lines 568-660) with: `item.attemptNumber` becoming `args.attemptNumber`, `previousAttempt` becoming `args.prior`, `item.taskManifest` becoming `args.context.manifest`, `item.context.instructions` becoming `args.context.instructions`, `item.context.promptOverrides` becoming `args.inputs.promptOverrides ?? undefined`, `item.llmProvider` becoming `args.inputs.provider`, `this.templateRenderer` becoming `args.renderer ?? rendererFor(args.inputs.templateDir)`, `starterDirForTask(Deno.cwd(), ...)` becoming `starterDirForTask(args.inputs.starterRoot, ...)`, `item.context.temperature/maxTokens` becoming `args.context.temperature/maxTokens`, and the variant system prompt block reading `args.inputs.variantSystemPrompt`.

`src/parallel/types.ts` `ParallelExecutionConfig`: add `starterRoot?: string;` with the comment `/** Directory containing tasks/starter/<id>/; defaults to Deno.cwd() at pool construction. */`. In the pool constructor store `this.starterRoot = config.starterRoot ?? Deno.cwd();` and `this.templateDir = config.templateDir || DEFAULT_TEMPLATE_DIR;`. Replace `buildRequest`'s body with:

```ts
    const prior = item.previousAttempts[item.previousAttempts.length - 1];
    return renderLLMRequest({
      context: item.context,
      attemptNumber: item.attemptNumber,
      ...(prior ? { prior } : {}),
      inputs: renderInputsFor(item, { templateDir: this.templateDir, starterRoot: this.starterRoot }),
      renderer: this.templateRenderer,
    });
```

Delete the pool's private `extractErrors`; `generateCodeWithStreaming` (line 497) calls `extractFixErrors(previousAttempt)` from the shared module instead. Export `renderLLMRequest`, `extractFixErrors`, `renderInputsFor` and the two input types from `src/parallel/shared/mod.ts`.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/parallel/ --ignore=tests/unit/parallel/streaming-transport-routing.test.ts && deno test --allow-all tests/unit/parallel/streaming-transport-routing.test.ts tests/unit/llm/`
Expected: PASS (the existing prompt-content assertions in `llm-work-pool.test.ts` are the regression net).

Run `deno check`, `deno lint src/parallel`, `deno fmt` over the files under **Files**.

- [ ] **Step 5: Commit**

```bash
git add src/parallel/shared src/parallel/llm-work-pool.ts src/parallel/types.ts tests/unit/parallel/shared/render-request.test.ts
git commit -m "refactor(parallel): renderLLMRequest over explicit RenderInputs; no cwd reads (D6, D13)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 11: Executor-resolved invocation record, `IngestMeta` schema 4, canonical settings at assembly, `invocation_mode` in the payload

**Files:**
- Create: `src/llm/endpoint.ts`
- Modify: `src/llm/openai-adapter.ts:102-104` (export the responses-only predicate as a module function)
- Modify: `src/ingest/capture.ts:236-262` (`invocationSnapshot` returns a typed `InvocationRecord`)
- Modify: `src/parallel/orchestrator.ts:185-205` (expose the resolved retry policies)
- Modify: `cli/commands/bench/parallel-executor.ts:725-752` (pass the resolved values)
- Modify: `cli/commands/bench/ingest-meta.ts` (schema 4)
- Modify: `cli/commands/bench/ingest-assembly.ts:160-200` (canonical settings when the invocation is typed)
- Modify: `src/ingest/mod.ts:84-100` (`BenchResults.invocationMode`), `src/ingest/envelope.ts` (`invocation_mode` in the payload), `site/src/lib/shared/types.ts:105-135` (`SignedRunPayload.payload.invocation_mode?`)
- Test: `tests/unit/llm/endpoint.test.ts` (new), `tests/unit/ingest/capture.test.ts` (extend), `tests/unit/ingest/ingest-meta.test.ts` (extend), `tests/unit/ingest/ingest-assembly-identity.test.ts` (extend), `tests/unit/ingest/envelope_test.ts` (extend)

**Interfaces:**
- Produces:

```ts
// src/llm/endpoint.ts
export function endpointFor(provider: string, apiModelId: string): string;
//   anthropic -> "/v1/messages"; openai -> isResponsesOnlyModel(m) ? "/v1/responses" : "/v1/chat/completions";
//   openrouter -> "/v1/chat/completions"; gemini -> "/v1beta/models:generateContent";
//   azure-openai -> "/openai/deployments/chat/completions"; anything else -> "unknown"
export function providerRouteFor(provider: string, apiModelId: string): string;   // "openrouter:<model>" or the provider

// src/ingest/capture.ts
export interface InvocationRecord {
  provider: string; requested_model: string; api_model_id: string; endpoint_host: string | null;
  max_tokens: number | null; temperature: number | null; reasoning: unknown;      // unchanged legacy fields
  mode: InvocationMode; endpoint: string; provider_route: string; fallback_policy: FallbackPolicy;
  continuation: { enabled: boolean; max: number }; empty_retry: { enabled: boolean; max: number };
  infra_retries_per_attempt: number; max_attempts: number; prompt_profile_digest: string;
}
export function invocationSnapshot(cfg: {
  provider: string; model: string; apiModelId: string; baseUrl?: string; maxTokens?: number; temperature?: number; reasoning?: unknown;
  mode: InvocationMode; fallbackPolicy: FallbackPolicy; continuation: ContinuationConfig; emptyRetry: EmptyRetryConfig;
  infraRetriesPerAttempt: number; maxAttempts: number; promptProfileDigest: string;
}): InvocationRecord;
export function isInvocationRecord(v: unknown): v is InvocationRecord;   // structural check used by ingest assembly and Plan B

// orchestrator
getResolvedRetryPolicies(): { continuation: ContinuationConfig; emptyRetry: EmptyRetryConfig };
```

`IngestMeta.schema` becomes `1 | 2 | 3 | 4`; `buildIngestMeta` writes 4 whenever a capture is supplied (the capture is always typed now); `parseIngestMeta` accepts 4. `assembleBenchResultsForVariant` builds `CanonicalSettings` through `buildCanonicalSettings` when `opts.invocation` passes `isInvocationRecord`, else the legacy three-key object (older files replay exactly as before). The payload gains top-level `invocation_mode` (the server stores it in Task 13; until then the field is ignored by the server, which validates named fields only).

Ruling recorded here: `prompt_version` and `bc_version` stay `null` in the canonical settings. Today's client never sends them, so every historical sync hash has them null; filling them now would move every model to a new profile for no batch-mode reason. `thinking_budget` moves from a loose top-level settings key (ignored by the hash today) into `extra_json` (hashed), which is the intended new-profile-for-future-sync-runs effect the spec accepts.

- [ ] **Step 1: Write the failing tests**

`tests/unit/llm/endpoint.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { endpointFor, providerRouteFor } from "../../../src/llm/endpoint.ts";

Deno.test("endpointFor follows the adapters' transport choice", () => {
  assertEquals(endpointFor("anthropic", "claude-opus-5"), "/v1/messages");
  assertEquals(endpointFor("openai", "gpt-6-astra"), "/v1/chat/completions");
  assertEquals(endpointFor("openai", "gpt-5.5-codex"), "/v1/responses");
  assertEquals(endpointFor("openrouter", "google/gemini-3.8-flash"), "/v1/chat/completions");
  assertEquals(endpointFor("gemini", "gemini-3.8-flash"), "/v1beta/models:generateContent");
  assertEquals(endpointFor("mock", "mock-gpt-4"), "unknown");
});

Deno.test("providerRouteFor names the OpenRouter target model", () => {
  assertEquals(providerRouteFor("anthropic", "claude-opus-5"), "anthropic");
  assertEquals(providerRouteFor("openrouter", "google/gemini-3.8-flash"), "openrouter:google/gemini-3.8-flash");
});
```

Extend `tests/unit/ingest/capture.test.ts`:

```ts
Deno.test("invocationSnapshot carries the executor-resolved profile fields", () => {
  const rec = invocationSnapshot({
    provider: "anthropic", model: "claude-opus-5", apiModelId: "claude-opus-5",
    maxTokens: 64000, temperature: 0,
    mode: "sync", fallbackPolicy: "requested",
    continuation: { enabled: true, maxContinuations: 3 },
    emptyRetry: { enabled: true, maxRetries: 2, baseDelayMs: 1000, jitterMs: 250 },
    infraRetriesPerAttempt: 1, maxAttempts: 2, promptProfileDigest: "d".repeat(64),
  });
  assertEquals(rec.mode, "sync");
  assertEquals(rec.endpoint, "/v1/messages");
  assertEquals(rec.provider_route, "anthropic");
  assertEquals(rec.continuation, { enabled: true, max: 3 });
  assertEquals(rec.empty_retry, { enabled: true, max: 2 });
  assertEquals(rec.max_attempts, 2);
  assertEquals(rec.max_tokens, 64000);
  assertEquals(isInvocationRecord(rec), true);
  assertEquals(isInvocationRecord({ provider: "anthropic" }), false);
});
```

Extend `tests/unit/ingest/ingest-meta.test.ts`:

```ts
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
```

Extend `tests/unit/ingest/ingest-assembly-identity.test.ts` (reuse its result/variant fixtures):

```ts
Deno.test("assembly builds canonical settings from a typed invocation and legacy settings otherwise", async () => {
  const invocation = invocationSnapshot({
    provider: "anthropic", model: "claude-opus-5", apiModelId: "claude-opus-5", maxTokens: 64000, temperature: 0,
    mode: "batch", fallbackPolicy: "unavailable",
    continuation: { enabled: false, maxContinuations: 0 },
    emptyRetry: { enabled: false, maxRetries: 0, baseDelayMs: 0, jitterMs: 0 },
    infraRetriesPerAttempt: 1, maxAttempts: 2, promptProfileDigest: "d".repeat(64),
  });
  const typed = await assembleBenchResultsForVariant(results, variant, { pricingVersion: "2026-09-06", invocation });
  assert(typed.kind === "assembled");
  assertEquals(Object.keys(typed.benchResults.settings).sort(), ["bc_version", "extra_json", "max_attempts", "max_tokens", "prompt_version", "temperature"]);
  assertEquals(typed.benchResults.settings["max_attempts"], 2);
  assertEquals(typed.benchResults.invocationMode, "batch");
  const extras = JSON.parse(typed.benchResults.settings["extra_json"] as string);
  assertEquals(extras.invocation_mode, "batch");
  assertEquals(extras.thinking_budget, null);

  const legacy = await assembleBenchResultsForVariant(results, variant, { pricingVersion: "2026-09-06", invocation: { provider: "anthropic" } });
  assert(legacy.kind === "assembled");
  assertEquals("extra_json" in legacy.benchResults.settings, false);
  assertEquals(legacy.benchResults.invocationMode, "sync");
});
```

Extend `tests/unit/ingest/envelope_test.ts`: build a payload with `invocationMode: "batch"` and assert `p["invocation_mode"] === "batch"`; without it assert `p["invocation_mode"] === "sync"`.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/endpoint.test.ts tests/unit/ingest/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/llm/openai-adapter.ts`: move the regex test out of the class: `export function isResponsesOnlyModel(model: string): boolean { return /\bcodex\b/.test(model); }` at module level, and make the private method call it.

`src/llm/endpoint.ts`:

```ts
import { isResponsesOnlyModel } from "./openai-adapter.ts";

/** The provider endpoint path the adapter for `provider` talks to. Enters the settings profile (spec section 10). */
export function endpointFor(provider: string, apiModelId: string): string {
  switch (provider) {
    case "anthropic":
      return "/v1/messages";
    case "openai":
      return isResponsesOnlyModel(apiModelId) ? "/v1/responses" : "/v1/chat/completions";
    case "openrouter":
      return "/v1/chat/completions";
    case "gemini":
      return "/v1beta/models:generateContent";
    case "azure-openai":
      return "/openai/deployments/chat/completions";
    default:
      return "unknown";
  }
}

export function providerRouteFor(provider: string, apiModelId: string): string {
  return provider === "openrouter" ? `openrouter:${apiModelId}` : provider;
}
```

`src/ingest/capture.ts`: add the `InvocationRecord` interface; `invocationSnapshot` keeps its seven legacy fields and adds

```ts
    mode: cfg.mode,
    endpoint: endpointFor(cfg.provider, cfg.apiModelId),
    provider_route: providerRouteFor(cfg.provider, cfg.apiModelId),
    fallback_policy: cfg.fallbackPolicy,
    continuation: { enabled: cfg.continuation.enabled, max: cfg.continuation.maxContinuations },
    empty_retry: { enabled: cfg.emptyRetry.enabled, max: cfg.emptyRetry.maxRetries },
    infra_retries_per_attempt: cfg.infraRetriesPerAttempt,
    max_attempts: cfg.maxAttempts,
    prompt_profile_digest: cfg.promptProfileDigest,
```

and

```ts
export function isInvocationRecord(v: unknown): v is InvocationRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (r["mode"] === "sync" || r["mode"] === "batch") &&
    typeof r["endpoint"] === "string" &&
    typeof r["provider_route"] === "string" &&
    (r["fallback_policy"] === "requested" || r["fallback_policy"] === "unavailable") &&
    typeof r["infra_retries_per_attempt"] === "number" &&
    typeof r["max_attempts"] === "number" &&
    typeof r["prompt_profile_digest"] === "string" &&
    typeof (r["continuation"] as Record<string, unknown> | undefined)?.["max"] === "number" &&
    typeof (r["empty_retry"] as Record<string, unknown> | undefined)?.["max"] === "number";
}
```

`src/parallel/orchestrator.ts`: add `getResolvedRetryPolicies()` returning `this.llmPool.getResolvedRetryPolicies()`; add the same method to `LLMWorkPool` returning `{ continuation: this.continuationConfig, emptyRetry: this.emptyRetryConfig }`.

`cli/commands/bench/parallel-executor.ts:734-747`: the `invocations[v.variantId] = invocationSnapshot({...})` call adds

```ts
                mode: "sync",
                fallbackPolicy: v.provider === "anthropic" &&
                    shouldRequestServerFallback(v.model, Deno.env.get("CENTRALGAUGE_REFUSAL_FALLBACK"))
                  ? "requested"
                  : "unavailable",
                continuation: policies.continuation,
                emptyRetry: policies.emptyRetry,
                infraRetriesPerAttempt,
                maxAttempts: options.attempts,
                promptProfileDigest: await promptProfileDigest({
                  overrides: options.promptOverrides
                    ? Object.fromEntries(Object.entries(options.promptOverrides).filter(([k]) => k !== "knowledgeContent"))
                    : null,
                  knowledge: options.promptOverrides?.knowledgeContent ?? null,
                  variantSystemPrompt: v.config.systemPrompt ?? null,
                }),
```

with `const policies = orchestrator.getResolvedRetryPolicies();` computed once before the loop (the `for` becomes `for await`-free; `promptProfileDigest` is async, so make the loop body `await`). `infraRetriesPerAttempt` and `options` are already in scope at that point (lines 345 and 419 show the names); if the orchestrator variable is named differently in that scope, use that name.

`cli/commands/bench/ingest-meta.ts`: `schema: 1 | 2 | 3 | 4`; `buildIngestMeta` uses `4` when `capture` is given; `parseIngestMeta` accepts `4`.

`cli/commands/bench/ingest-assembly.ts:160-172`: replace the settings block with

```ts
  let settings: Record<string, unknown>;
  let invocationMode: InvocationMode = "sync";
  if (opts.invocation && isInvocationRecord(opts.invocation)) {
    const inv = opts.invocation;
    invocationMode = inv.mode;
    settings = { ...buildCanonicalSettings(
      {
        temperature: variant.config.temperature ?? null,
        max_attempts: inv.max_attempts,
        max_tokens: variant.config.maxTokens ?? null,
        prompt_version: null,
        bc_version: null,
      },
      {
        invocation_mode: inv.mode,
        continuation: inv.continuation,
        empty_retry: inv.empty_retry,
        fallback_policy: inv.fallback_policy,
        provider_route: inv.provider_route,
        endpoint: inv.endpoint,
        thinking_budget: variant.config.thinkingBudget ?? null,
        prompt_profile_digest: inv.prompt_profile_digest,
        infra_retries_per_attempt: inv.infra_retries_per_attempt,
      },
    ) };
  } else {
    settings = {};
    if (variant.config.temperature !== undefined) settings["temperature"] = variant.config.temperature;
    if (variant.config.maxTokens !== undefined) settings["max_tokens"] = variant.config.maxTokens;
    if (variant.config.thinkingBudget !== undefined) settings["thinking_budget"] = variant.config.thinkingBudget;
  }
```

and set `invocationMode` on the `BenchResults` literal. Check the `thinkingBudget` type on `VariantConfig`: if it is not `number | string | null | undefined`, coerce with `typeof x === "number" || typeof x === "string" ? x : x == null ? null : String(x)`.

`src/ingest/mod.ts`: `BenchResults.invocationMode: InvocationMode` (required; the assembler always sets it) and pass it to `buildPayload` as `invocationMode`. `src/ingest/envelope.ts`: `BuildPayloadInput.invocationMode?: InvocationMode` and `p["invocation_mode"] = input.invocationMode ?? "sync";`. `site/src/lib/shared/types.ts`: `invocation_mode?: "sync" | "batch";` on the payload type beside `invocation?`.

- [ ] **Step 4: Run tests and checks**

Run: `deno test --allow-all tests/unit/llm/endpoint.test.ts tests/unit/ingest/ tests/unit/cli/ tests/unit/parallel/orchestrator.test.ts`
Expected: PASS.

Run `deno check`, `deno lint src/llm src/ingest src/parallel cli/commands/bench`, `deno fmt` over the files under **Files** (not the `site/` file).

- [ ] **Step 5: Commit**

```bash
git add src/llm/endpoint.ts src/llm/openai-adapter.ts src/ingest/capture.ts src/ingest/mod.ts src/ingest/envelope.ts src/parallel/orchestrator.ts src/parallel/llm-work-pool.ts cli/commands/bench/parallel-executor.ts cli/commands/bench/ingest-meta.ts cli/commands/bench/ingest-assembly.ts site/src/lib/shared/types.ts tests/unit/llm/endpoint.test.ts tests/unit/ingest
git commit -m "feat(ingest): typed invocation record (schema 4), canonical settings at assembly, invocation_mode in the payload (D4)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 12: Migration 0019, batch rate columns, cost view, `rowCostUsd`, catalog pricing fields

**Files:**
- Create: `site/migrations/0019_batch_mode.sql`
- Modify: `site/src/lib/server/cost-sql.ts:41-51` (`rowCostUsd` gains the runs alias)
- Modify: `site/src/lib/server/leaderboard.ts:356`, `site/src/lib/server/model-aggregates.ts:372,375`, `site/src/routes/api/v1/families/[slug]/+server.ts:127`, `site/src/routes/api/v1/summary/+server.ts:109` (pass the runs alias used in that query)
- Modify: `site/src/routes/api/v1/admin/catalog/pricing/+server.ts:9-20,60-90` (four optional batch fields, upsert them)
- Modify: `src/ingest/types.ts:9-16` (`PricingRates` batch fields), `src/ingest/catalog/read.ts` (pricing row schema accepts them), `src/doctor/sections/ingest/check-catalog-local.ts` (if it re-validates pricing row keys)
- Modify: `site/catalog/pricing.yml` (batch rates for the fall panel rows)
- Test: `site/tests/migrations.test.ts` (extend), `site/tests/lib/cost-sql.test.ts` (new, unit config), `site/tests/api/catalog-admin.test.ts` (extend), `tests/unit/ingest/catalog_read_test.ts` (extend)

**Interfaces:**
- Produces: columns `runs.invocation_mode TEXT NOT NULL DEFAULT 'sync'` and `cost_snapshots.batch_input_per_mtoken`, `batch_output_per_mtoken`, `batch_cache_read_per_mtoken`, `batch_cache_write_per_mtoken` (all `REAL`, nullable); `v_results_with_cost.cost_usd` picks the batch columns when the joined run is `batch` and is NULL when they are missing; `rowCostUsd(r = 'r', cs = 'cs', runs = 'runs')` emits the same CASE; the admin pricing upsert and `sync-catalog` carry the four fields; `PricingRates` gains them as optional.

`CACHE_VERSION` is bumped once, in Task 14, after every response-shape change has landed.

- [ ] **Step 1: Write the failing tests**

Extend `site/tests/migrations.test.ts`:

```ts
describe("migration 0019 batch mode", () => {
  it("adds runs.invocation_mode defaulting to sync and four batch rate columns", async () => {
    const runCols = (await env.DB.prepare(`PRAGMA table_info(runs)`).all()).results as { name: string; dflt_value: string | null; notnull: number }[];
    const mode = runCols.find((c) => c.name === "invocation_mode");
    expect(mode?.notnull).toBe(1);
    expect(mode?.dflt_value).toBe("'sync'");
    const csCols = ((await env.DB.prepare(`PRAGMA table_info(cost_snapshots)`).all()).results as { name: string }[]).map((c) => c.name);
    for (const c of ["batch_input_per_mtoken", "batch_output_per_mtoken", "batch_cache_read_per_mtoken", "batch_cache_write_per_mtoken"]) {
      expect(csCols).toContain(c);
    }
  });

  it("v_results_with_cost prices batch runs from batch columns and NULL without them", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (901,'f901','v','F')`),
      env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (901,901,'m901','m901','M')`),
      env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts901','2026-01-01T00:00:00Z',1,0)`),
      env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s901')`),
      env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from,batch_input_per_mtoken,batch_output_per_mtoken) VALUES ('pv-b',901,10,20,'2026-01-01',5,10)`),
      env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('pv-n',901,10,20,'2026-01-01')`),
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-sync','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-b','sig','2026-01-01T00:00:00Z',1,'{}','sync')`),
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-batch','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-b','sig','2026-01-01T00:00:00Z',1,'{}','batch')`),
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES ('r-batch-nocols','ts901',901,'s901','rig','2026-01-01T00:00:00Z','completed','claimed','pv-n','sig','2026-01-01T00:00:00Z',1,'{}','batch')`),
      ...["r-sync", "r-batch", "r-batch-nocols"].map((id) =>
        env.DB.prepare(`INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,failure_reasons_json) VALUES (?,'t',1,1,1,1,'[]',1,1,1000000,1000000,0,0,'[]')`).bind(id),
      ),
    ]);
    const rows = (await env.DB.prepare(`SELECT run_id, cost_usd FROM v_results_with_cost WHERE run_id IN ('r-sync','r-batch','r-batch-nocols') ORDER BY run_id`).all()).results as { run_id: string; cost_usd: number | null }[];
    expect(rows.find((r) => r.run_id === "r-sync")?.cost_usd).toBeCloseTo(30, 6);
    expect(rows.find((r) => r.run_id === "r-batch")?.cost_usd).toBeCloseTo(15, 6);
    expect(rows.find((r) => r.run_id === "r-batch-nocols")?.cost_usd).toBeNull();
  });
});
```

(Match the NOT NULL columns of `runs` and `results` to what the existing fixtures in `site/tests/api/leaderboard-run-scope.test.ts` insert; add any the schema requires.)

`site/tests/lib/cost-sql.test.ts` (register it under `vitest.unit.config.ts` the way other `tests/lib/*.test.ts` unit files are):

```ts
import { describe, expect, it } from "vitest";
import { rowCostUsd } from "../../src/lib/server/cost-sql";

describe("rowCostUsd", () => {
  it("branches on the runs alias invocation_mode", () => {
    const sql = rowCostUsd("r", "cs", "runs");
    expect(sql).toContain("CASE WHEN runs.invocation_mode = 'batch'");
    expect(sql).toContain("cs.batch_input_per_mtoken");
    expect(sql).toContain("cs.input_per_mtoken");
    expect(sql.endsWith("/ 1000000.0")).toBe(true);
  });
  it("rejects a non-identifier alias", () => {
    expect(() => rowCostUsd("r", "cs", "runs; DROP")).toThrow();
  });
});
```

Extend `site/tests/api/catalog-admin.test.ts` (reuse its signed-admin helper): post a pricing row with the four batch fields and read them back from `cost_snapshots`; post the same row without them and expect the columns NULL (not 0).

Extend `tests/unit/ingest/catalog_read_test.ts`: a pricing row with `batch_input_per_mtoken: 2.5` parses and keeps the field; a row without it parses with the field absent.

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm run build && npx vitest run tests/migrations.test.ts && npx vitest run --config vitest.unit.config.ts tests/lib/cost-sql.test.ts; cd ..`
Expected: FAIL (columns and view branch missing).

- [ ] **Step 3: Write the migration**

`site/migrations/0019_batch_mode.sql`:

```sql
-- 0019_batch_mode.sql
-- Batch invocation profile (spec docs/superpowers/specs/2026-09-06-batch-mode-design.md, D4/D5).
-- runs.invocation_mode: 'sync' | 'batch'. NOT NULL with a default so every
-- historical row reads as sync and every ranking query can predicate on it.
-- cost_snapshots.batch_*: explicit batch-tier rates; NULL means "no batch
-- pricing known", and the view then yields a NULL cost rather than a guess.
ALTER TABLE runs ADD COLUMN invocation_mode TEXT NOT NULL DEFAULT 'sync';
CREATE INDEX IF NOT EXISTS idx_runs_set_mode ON runs(task_set_hash, invocation_mode);

ALTER TABLE cost_snapshots ADD COLUMN batch_input_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_output_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_cache_read_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_cache_write_per_mtoken REAL;

DROP VIEW IF EXISTS v_results_with_cost;
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    CASE WHEN run.invocation_mode = 'batch' THEN
      (r.tokens_in          * cs.batch_input_per_mtoken +
       r.tokens_out         * cs.batch_output_per_mtoken +
       r.tokens_cache_read  * COALESCE(cs.batch_cache_read_per_mtoken, 0) +
       r.tokens_cache_write * COALESCE(cs.batch_cache_write_per_mtoken, 0))
    ELSE
      (r.tokens_in          * cs.input_per_mtoken +
       r.tokens_out         * cs.output_per_mtoken +
       r.tokens_cache_read  * COALESCE(cs.cache_read_per_mtoken, 0) +
       r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0))
    END / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;
```

- [ ] **Step 4: `rowCostUsd` and its callers**

`site/src/lib/server/cost-sql.ts`:

```ts
export function rowCostUsd(r = 'r', cs = 'cs', runs = 'runs'): string {
  const rr = assertSqlAlias(r);
  const cc = assertSqlAlias(cs);
  const ru = assertSqlAlias(runs);
  const sync =
    `(${rr}.tokens_in * ${cc}.input_per_mtoken` +
    ` + ${rr}.tokens_out * ${cc}.output_per_mtoken` +
    ` + ${rr}.tokens_cache_read * COALESCE(${cc}.cache_read_per_mtoken, 0)` +
    ` + ${rr}.tokens_cache_write * COALESCE(${cc}.cache_write_per_mtoken, 0))`;
  const batch =
    `(${rr}.tokens_in * ${cc}.batch_input_per_mtoken` +
    ` + ${rr}.tokens_out * ${cc}.batch_output_per_mtoken` +
    ` + ${rr}.tokens_cache_read * COALESCE(${cc}.batch_cache_read_per_mtoken, 0)` +
    ` + ${rr}.tokens_cache_write * COALESCE(${cc}.batch_cache_write_per_mtoken, 0))`;
  return `(CASE WHEN ${ru}.invocation_mode = 'batch' THEN ${batch} ELSE ${sync} END) / 1000000.0`;
}
```

Update the doc comment to say the third alias must name the `runs` join of the enclosing query. At each caller, pass the alias that query joins `runs` under (`runs` in `leaderboard.ts:356` and `model-aggregates.ts:372,375`; read the `families/[slug]` and `summary` queries and pass theirs; if one of them joins `cost_snapshots` without `runs`, add `JOIN runs ON runs.id = r.run_id` there, which the pricing join already implies).

- [ ] **Step 5: Catalog pricing fields**

`site/src/routes/api/v1/admin/catalog/pricing/+server.ts`: add `batch_input_per_mtoken?: number | null; batch_output_per_mtoken?: number | null; batch_cache_read_per_mtoken?: number | null; batch_cache_write_per_mtoken?: number | null;` to `PricingUpsert`; validate each as `undefined | null | finite number` (400 `invalid_pricing_field` otherwise); extend the INSERT column list, VALUES placeholders, `ON CONFLICT ... DO UPDATE SET` (`batch_input_per_mtoken = excluded.batch_input_per_mtoken`, etc.) and `.bind(...)` with `p.batch_input_per_mtoken ?? null` (NULL, never 0: absence must stay distinguishable).

`src/ingest/types.ts` `PricingRates`: add the four as `?: number | null`. `src/ingest/catalog/read.ts`: extend the pricing row schema (Zod or manual) with the four optional nullable numbers. Search `src/doctor/sections/ingest/check-catalog-local.ts` and `src/catalog/seed/types.ts` for a pricing key whitelist; if present, add the four keys so `doctor ingest` does not flag them.

`site/catalog/pricing.yml`: for every row of the fall panel and the hand-driven-run model, add the four batch fields. Anthropic and OpenAI publish batch at 50% of the synchronous rate: `anthropic/claude-fable-5-1`, `anthropic/claude-opus-5`, `anthropic/claude-haiku-4-5` (add the row if absent, from the LiteLLM source the precheck uses), `openai/gpt-6-astra`, `openai/gpt-5-mini` get `batch_* = 0.5 * sync_*` for input, output, cache read and cache write. `openrouter/google/gemini-3.8-flash` gets the rates OpenRouter lists for the `:batch` variant, taken from the spike-3 findings; if the findings do not name a rate, leave the fields absent for that row and note it in the findings document (Plan B's `submit` will refuse that model until the rates are known). Each edited row keeps its `pricing_version`; the upsert reconciles by (version, model).

- [ ] **Step 6: Run tests and checks**

Run: `cd site && npm run build && npm run test:main && npm run test:build; cd ..`
Expected: PASS.

Run: `deno test --allow-all tests/unit/ingest/ && deno check src/ingest/types.ts src/ingest/catalog/read.ts && deno lint src/ingest && deno fmt src/ingest/types.ts src/ingest/catalog/read.ts`

Run `deno task start doctor ingest` (read-only precheck) and confirm it reports the catalog rows as pending sync rather than invalid.

- [ ] **Step 7: Commit**

```bash
git add site/migrations/0019_batch_mode.sql site/src/lib/server/cost-sql.ts site/src/lib/server/leaderboard.ts site/src/lib/server/model-aggregates.ts "site/src/routes/api/v1/families/[slug]/+server.ts" site/src/routes/api/v1/summary/+server.ts site/src/routes/api/v1/admin/catalog/pricing/+server.ts src/ingest/types.ts src/ingest/catalog/read.ts src/doctor src/catalog/seed/types.ts site/catalog/pricing.yml site/tests/migrations.test.ts site/tests/lib/cost-sql.test.ts site/tests/api/catalog-admin.test.ts tests/unit/ingest/catalog_read_test.ts
git commit -m "feat(site): migration 0019 (invocation_mode, batch rate columns, mode-aware cost view) and batch pricing through the catalog (D5)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 13: `invocation_mode` stored at ingest; mode parsing, default rule and predicates in the leaderboard and model aggregates

**Files:**
- Create: `site/src/lib/server/invocation-mode.ts`
- Modify: `site/src/routes/api/v1/runs/+server.ts:286-300` (validate), `:336-375` (insert the column)
- Modify: `site/src/lib/shared/api-types.ts:26-50` (`LeaderboardQuery.mode`)
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:260-300` (`parseQuery` reads `mode`), `:100-160` (resolve the default before computing; cache key already spreads `q`)
- Modify: `site/src/lib/server/leaderboard.ts:100-215` (outer WHERE, the three subquery clauses, `buildRunScopeClause`)
- Modify: `site/src/lib/server/model-aggregates.ts:112-130` (`ComputeOpts.mode`), `:259-300` (predicates), the `computeModelAggregatesLite` twin at `:213`
- Modify: `site/src/routes/api/v1/models/[...slug]/+server.ts:137-145` and the three `og/` routes that call `computeModelAggregates` (resolve the mode for the current set and pass it)
- Test: `site/tests/api/leaderboard-mode.test.ts` (new), `site/tests/api/v2-runs.test.ts` (extend), `site/tests/server/invocation-mode.test.ts` (new)

**Interfaces:**
- Produces:

```ts
// invocation-mode.ts
export type InvocationMode = "sync" | "batch";
export function parseModeParam(url: URL): InvocationMode | null;
//   absent -> null; "sync"/"batch" -> that; "all" -> ApiError(400, "invalid_mode_for_metric", ...); anything else -> ApiError(400, "invalid_mode", ...)
export type SetScope = { kind: "current" } | { kind: "hash"; hash: string };
export function resolveInvocationMode(db: D1Database, scope: SetScope, requested: InvocationMode | null): Promise<InvocationMode>;
//   requested -> requested; else SELECT DISTINCT invocation_mode FROM runs WHERE task_set_hash <scope>;
//   0 modes -> "sync"; 1 -> it; 2 -> ApiError(400, "mode_required", "task set has runs in both sync and batch mode; pass mode=sync or mode=batch")
export function modePredicate(alias: string): string;   // `${alias}.invocation_mode = ?` after assertSqlAlias
```

`LeaderboardQuery.mode: InvocationMode` (required, resolved); `ComputeOpts.mode: InvocationMode` (required). Every `runs`-joined scope in `queryLeaderboard` and `computeModelAggregates(Lite)` carries `AND <alias>.invocation_mode = ?` with the bound mode: the outer `runs`, `ru1`, `ru2`, `ru1b`, and every secondary aggregate that joins `runs` (tokens, consistency, latency, pass-hat, fallback count; grep the file for `JOIN runs` and `FROM runs`). Task 14 does tiers, matrix and compare.

- [ ] **Step 1: Write the failing tests**

`site/tests/server/invocation-mode.test.ts` (worker config, uses D1):

```ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseModeParam, resolveInvocationMode } from "../../src/lib/server/invocation-mode";
import { ApiError } from "../../src/lib/server/errors";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

async function seedRuns(modes: string[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'f','v','F')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','m','M')`),
    env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash) VALUES ('s')`),
    ...modes.map((mode, i) =>
      env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode) VALUES (?,'ts',1,'s','rig','2026-01-01T00:00:00Z','completed','claimed','v','sig','2026-01-01T00:00:00Z',1,'{}',?)`).bind(`r${i}`, mode)
    ),
  ]);
}

describe("parseModeParam", () => {
  it("accepts sync, batch and absent; refuses all and junk", () => {
    expect(parseModeParam(new URL("https://x/?mode=sync"))).toBe("sync");
    expect(parseModeParam(new URL("https://x/?mode=batch"))).toBe("batch");
    expect(parseModeParam(new URL("https://x/"))).toBeNull();
    expect(() => parseModeParam(new URL("https://x/?mode=all"))).toThrowError(expect.objectContaining({ code: "invalid_mode_for_metric" }));
    expect(() => parseModeParam(new URL("https://x/?mode=turbo"))).toThrowError(expect.objectContaining({ code: "invalid_mode" }));
  });
});

describe("resolveInvocationMode", () => {
  it("defaults to the only mode present, sync when empty, and refuses when both exist", async () => {
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("sync");
    await seedRuns(["batch"]);
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "hash", hash: "ts" }, null)).toBe("batch");
    expect(await resolveInvocationMode(env.DB, { kind: "current" }, "sync")).toBe("sync");
    await resetDb();
    await seedRuns(["sync", "batch"]);
    await expect(resolveInvocationMode(env.DB, { kind: "current" }, null)).rejects.toMatchObject({ code: "mode_required" });
  });
});
```

(If `ApiError` exposes the code under another property name, match that; the assertion is on the code string.)

`site/tests/api/leaderboard-mode.test.ts`: copy the fixture scaffolding of `site/tests/api/leaderboard-run-scope.test.ts` (families, models, task set `ts` current, settings, cost snapshot, machine key, tasks `t1`/`t2`) and insert two runs for the same model, `r-sync` (`invocation_mode='sync'`, passes `t1` attempt 1) and `r-batch` (`invocation_mode='batch'`, passes `t2` attempt 1). Then:

```ts
describe("leaderboard invocation mode", () => {
  it("refuses mode=all and requires mode when both modes exist", async () => {
    const all = await SELF.fetch("https://x/api/v1/leaderboard?mode=all");
    expect(all.status).toBe(400);
    expect((await all.json()).error.code).toBe("invalid_mode_for_metric");
    const none = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(none.status).toBe(400);
    expect((await none.json()).error.code).toBe("mode_required");
  });

  it("counts only the selected mode's runs in every numerator", async () => {
    const sync = (await (await SELF.fetch("https://x/api/v1/leaderboard?mode=sync")).json()).rows as LeaderboardRow[];
    expect(sync[0]?.tasks_passed_attempt_1).toBe(1);
    const batch = (await (await SELF.fetch("https://x/api/v1/leaderboard?mode=batch")).json()).rows as LeaderboardRow[];
    expect(batch[0]?.tasks_passed_attempt_1).toBe(1);
    expect(sync[0]?.pass_at_1).toBe(batch[0]?.pass_at_1);
  });

  it("defaults to the single mode present", async () => {
    await env.DB.prepare(`DELETE FROM results WHERE run_id = 'r-batch'`).run();
    await env.DB.prepare(`DELETE FROM runs WHERE id = 'r-batch'`).run();
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    expect((await res.json()).filters.mode).toBe("sync");
  });
});
```

(Read the error envelope shape from `site/src/lib/server/errors.ts` and the `filters` block of `LeaderboardResponse` in `api-types.ts`; adjust the property paths, not the assertions. If the response has no `filters` block, assert on the `mode` echo field you add to the response in Step 3.)

Extend `site/tests/api/v2-runs.test.ts`: post a payload with `invocation_mode: "batch"` and assert `SELECT invocation_mode FROM runs WHERE id = ?` returns `batch`; post one without the field and expect `sync`; post `invocation_mode: "turbo"` and expect `400 invalid_invocation_mode`.

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm run build && npx vitest run tests/server/invocation-mode.test.ts tests/api/leaderboard-mode.test.ts tests/api/v2-runs.test.ts; cd ..`
Expected: FAIL.

- [ ] **Step 3: Implement**

`site/src/lib/server/invocation-mode.ts`:

```ts
import { ApiError } from "./errors";

export type InvocationMode = "sync" | "batch";
export type SetScope = { kind: "current" } | { kind: "hash"; hash: string };

export function parseModeParam(url: URL): InvocationMode | null {
  const raw = url.searchParams.get("mode");
  if (raw === null || raw === "") return null;
  if (raw === "sync" || raw === "batch") return raw;
  if (raw === "all") {
    throw new ApiError(400, "invalid_mode_for_metric", "mode=all is not supported: sync and batch are distinct invocation profiles and are never ranked together. Pass mode=sync or mode=batch.");
  }
  throw new ApiError(400, "invalid_mode", "mode must be sync or batch");
}

export async function resolveInvocationMode(db: D1Database, scope: SetScope, requested: InvocationMode | null): Promise<InvocationMode> {
  if (requested) return requested;
  const where = scope.kind === "current"
    ? `task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
    : `task_set_hash = ?`;
  const stmt = db.prepare(`SELECT DISTINCT invocation_mode AS mode FROM runs WHERE ${where}`);
  const rows = (await (scope.kind === "current" ? stmt : stmt.bind(scope.hash)).all<{ mode: string }>()).results ?? [];
  const modes = rows.map((r) => r.mode).filter((m): m is InvocationMode => m === "sync" || m === "batch");
  if (modes.length === 0) return "sync";
  if (modes.length === 1) return modes[0]!;
  throw new ApiError(400, "mode_required", "this task set has runs in both sync and batch mode; pass mode=sync or mode=batch");
}

export function modePredicate(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`invalid SQL alias: ${alias}`);
  return `${alias}.invocation_mode = ?`;
}
```

`runs/+server.ts`: after the `invocation` validation add

```ts
    const invocationMode = payload.invocation_mode ?? "sync";
    if (invocationMode !== "sync" && invocationMode !== "batch") {
      throw new ApiError(400, "invalid_invocation_mode", "invocation_mode must be sync or batch");
    }
```

and add `invocation_mode` to the `INSERT INTO runs(...)` column list with one more `?` and `invocationMode` bound in the matching position.

`api-types.ts`: `mode: InvocationMode;` on `LeaderboardQuery` (import the type from `$lib/server/invocation-mode` or declare the union locally to keep `shared/` free of server imports; declare it locally as `"sync" | "batch"`). Add `mode: InvocationMode` to the leaderboard response's `filters` block (or wherever the response echoes `set`/`tier`).

`leaderboard/+server.ts` `parseQuery`: `const requestedMode = parseModeParam(url);` and return it as `mode` (typed `InvocationMode | null` on an intermediate type); before calling `queryLeaderboard`, resolve `q.mode = await resolveInvocationMode(env.DB, q.set === "current" ? { kind: "current" } : { kind: "hash", hash: q.set }, requestedMode)`. Do the resolution BEFORE `buildCacheKey` so the resolved mode is in the key (a default that flips when the first batch run lands must not serve a stale sync page under the same key). Pass `mode: q.mode` into the `getTierMap` options (Task 14 adds the field; until then keep the object as it is and let Task 14 wire it).

`leaderboard.ts`: push `modePredicate("runs")` into `wheres` with `params.push(q.mode)`; append `AND ${modePredicate("ru1")}` / `ru2` / `ru1b` to the three task-set subquery clauses and push `q.mode` onto the matching param arrays; in `buildRunScopeClause` add `parts.push(\`AND ${modePredicate(ruAlias)}\`); bind.push(q.mode);` unconditionally (this is the mirror every secondary aggregate already uses). Then grep the file for every remaining `JOIN runs` / `FROM runs` (tokens, consistency, latency, pass-hat, fallback-count subqueries) and add the predicate with its bound param in query order; a scope without a `runs` alias must gain the join.

`model-aggregates.ts`: `ComputeOpts.mode: InvocationMode` (required); `where.push(modePredicate("runs")); params.push(opts.mode);` and the `ru1/ru2/ru1b` clauses exactly as in the leaderboard; same sweep of `JOIN runs` in both `computeModelAggregates` and `computeModelAggregatesLite`. Callers (`models/[...slug]`, the three `og/` routes) resolve the mode with `resolveInvocationMode(env.DB, taskSetHash ? { kind: "hash", hash: taskSetHash } : { kind: "current" }, parseModeParam(url))` and pass it; the `og/` image routes have no query string, so they pass `null` and inherit the default rule (a two-mode set makes them 400; acceptable and visible, per D4).

- [ ] **Step 4: Run tests and checks**

Run: `cd site && npm run build && npm run test:main; cd ..`
Expected: PASS, including every pre-existing leaderboard, families, models and summary test (their fixtures insert `runs` without `invocation_mode`, so they read as sync and resolve to `sync` by the default rule).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/invocation-mode.ts site/src/routes/api/v1/runs/+server.ts site/src/lib/shared/api-types.ts site/src/routes/api/v1/leaderboard/+server.ts site/src/lib/server/leaderboard.ts site/src/lib/server/model-aggregates.ts "site/src/routes/api/v1/models/[...slug]/+server.ts" site/src/routes/og site/tests/server/invocation-mode.test.ts site/tests/api/leaderboard-mode.test.ts site/tests/api/v2-runs.test.ts
git commit -m "feat(site): invocation_mode stored at ingest; one mode per ranking query with the task-set default rule (D4)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 14: Mode in tiers, matrix and compare; cache keys; `CACHE_VERSION` v11

**Files:**
- Modify: `site/src/lib/server/tier-data.ts:5-9` (`AucMatrixOptions.mode`), `:70-100` (both queries), `:142-146` (`keyUrl`)
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:157-161` (pass `mode` to `getTierMap`)
- Modify: `site/src/lib/server/matrix.ts:150-275` (every `runs`-joined query), `site/src/routes/api/v1/matrix/+server.ts:19-45` (parse, resolve, cache key)
- Modify: `site/src/routes/api/v1/compare/+server.ts:85-180` (p1, p2_only, attempted, per-task rows)
- Modify: `site/src/lib/server/cache-version.ts:38` (`"v10"` to `"v11"` with a changelog line)
- Test: `site/tests/server/tier-data.test.ts` (extend), `site/tests/api/matrix.test.ts` (extend), `site/tests/api/compare.test.ts` (extend), `site/tests/api/leaderboard.test.ts` (the `CACHE_VERSION` assertion moves with the constant)

**Interfaces:**
- Produces: `AucMatrixOptions.mode: InvocationMode` (required) and a tier cache key segment `/m${mode}`; matrix and compare responses computed for exactly one mode, echoing `mode` in their `filters`; `CACHE_VERSION = "v11"`.

- [ ] **Step 1: Write the failing tests**

Extend `site/tests/server/tier-data.test.ts` (reuse its seeding helper): seed one model with a passing sync run on `t1` and a passing batch run on `t2` in the same set; `buildAucMatrix(env.DB, { taskSetHash, metric: "auc_2", mode: "sync" })` yields a row whose per-task vector marks `t1` solved and `t2` unsolved; `mode: "batch"` the reverse.

Extend `site/tests/api/matrix.test.ts`: with the same two-mode fixture, `GET /api/v1/matrix` returns `400 mode_required`; `?mode=sync` returns cells for the sync run only and `filters.mode === "sync"`; `?mode=all` returns `400 invalid_mode_for_metric`.

Extend `site/tests/api/compare.test.ts`: with the two-mode fixture, `GET /api/v1/compare?models=m` returns `400 mode_required`; `?mode=batch` reports `tasks_passed_attempt_1 === 1` from the batch run only.

- [ ] **Step 2: Run to verify failure**

Run: `cd site && npm run build && npx vitest run tests/server/tier-data.test.ts tests/api/matrix.test.ts tests/api/compare.test.ts; cd ..`
Expected: FAIL.

- [ ] **Step 3: Implement**

`tier-data.ts`: add `mode: InvocationMode;` to `AucMatrixOptions`; in both `buildAucMatrix` queries append `AND ru.invocation_mode = ?` to the WHERE and bind `opts.mode` after the existing params; in `getTierMap` extend `keyUrl` with `/m${opts.mode}` between the category segment and `CACHE_VERSION`. In the leaderboard route pass `mode: q.mode` in the `getTierMap` options.

`matrix.ts`: every query that joins or selects from `runs` (the model discovery subquery at ~158, the settings query at ~196, the cell query at ~269) gets `AND runs.invocation_mode = ?` next to `${taskSetRunsFilter}` / `${taskSetSubFilter}` with `opts.mode` appended to that query's params; `computeMatrix`'s options gain `mode: InvocationMode` and the response `filters` echo it. The route parses `parseModeParam(url)`, resolves with `resolveInvocationMode` against the parsed `set` (`set=all` on the matrix keeps its existing meaning for task sets but the mode still resolves against `{ kind: "current" }` when `set` is `current` or `all`), and adds `mode` to `buildCacheKey("matrix", { set, category, difficulty, mode }, epoch)`.

`compare/+server.ts`: add `AND ru1.invocation_mode = ?`, `AND ru2.invocation_mode = ?`, `AND ru1b.invocation_mode = ?`, `AND runs.invocation_mode = ?` to the `p1`, `p2_only`, its `NOT EXISTS`, and `attempted` CTEs, and `AND runs.invocation_mode = ?` to the per-task rows query (both branches), binding the resolved mode in each statement's parameter order; parse and resolve the mode the same way as the matrix route; echo `mode` in the response. If the route caches, include `mode` in its cache key.

`cache-version.ts`: `export const CACHE_VERSION = "v11";` and add a changelog line above it: `v11: invocation_mode enters every ranking query, tier/matrix/compare cache keys, and the cost view branches on it (migration 0019).`

- [ ] **Step 4: Run tests and checks**

Run: `cd site && npm run build && npm run test:main && npm run test:build; cd ..`
Expected: PASS. Then run the `worker-pitfall-reviewer` agent over the `site/` diff of Tasks 12 to 14 (cache keys, `_cv`, migration-gated columns, deploy order) and fix anything it flags before committing.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/tier-data.ts site/src/lib/server/matrix.ts site/src/lib/server/cache-version.ts site/src/routes/api/v1/leaderboard/+server.ts site/src/routes/api/v1/matrix/+server.ts site/src/routes/api/v1/compare/+server.ts site/tests
git commit -m "feat(site): mode-scoped tiers, matrix and compare with mode in every cache key; cache v11 (D4)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 15: Harness fingerprint directory expansion and gold-ci adoption

**Files:**
- Modify: `src/utils/harness-fingerprint.ts:1-90`
- Modify: `scripts/gold-ci.ts:183-200` (flag), `:215-260` (adoption path)
- Modify: `docs/reasoning-suite/gold-ci.json` (re-baselined by the script, not by hand)
- Test: `tests/unit/utils/harness-fingerprint.test.ts` (extend)

**Interfaces:**
- Produces: `HARNESS_INPUTS` gains `src/parallel/shared/` (a directory), `src/parallel/infra-retry.ts`, `src/llm/prompt-building.ts`, `src/tasks/object-overlay.ts`, `src/llm/candidate-resolution.ts`, `src/parallel/llm-work-pool.ts`; `LEGACY_HARNESS_INPUTS_2026_08` keeps the previous six entries for the one-time adoption check; `expandInputs(paths, root): Promise<string[]>` walks a directory entry recursively, `.ts` files only, sorted, POSIX separators; `hashFiles` calls it first, so the fingerprint of a directory is the fingerprint of its sorted file list. `scripts/gold-ci.ts --adopt-harness` rewrites the ledger's `harnessHash` (top level and per trusted task) from the legacy list's hash to the new one, only when the legacy list still hashes to the ledger's recorded value (proof that no previously tracked file changed), and records `harnessAdopted: { from, to, at, reason }` on the ledger.

- [ ] **Step 1: Write the failing tests**

Extend `tests/unit/utils/harness-fingerprint.test.ts`:

```ts
Deno.test("expandInputs walks a directory entry in sorted order with posix separators", async () => {
  const root = await createTempDir("hf-expand");
  try {
    await Deno.mkdir(join(root, "dir", "sub"), { recursive: true });
    await Deno.writeTextFile(join(root, "dir", "b.ts"), "b");
    await Deno.writeTextFile(join(root, "dir", "sub", "a.ts"), "a");
    await Deno.writeTextFile(join(root, "dir", "notes.md"), "ignored");
    await Deno.writeTextFile(join(root, "file.ts"), "f");
    const out = await expandInputs(["file.ts", "dir", "missing.ts"], root);
    assertEquals(out, ["dir/b.ts", "dir/sub/a.ts", "file.ts", "missing.ts"]);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("hashFiles over a directory changes when a file inside it changes", async () => {
  const root = await createTempDir("hf-dir-hash");
  try {
    await Deno.mkdir(join(root, "dir"), { recursive: true });
    await Deno.writeTextFile(join(root, "dir", "a.ts"), "one");
    const h1 = await hashFiles(["dir"], root);
    await Deno.writeTextFile(join(root, "dir", "a.ts"), "two");
    const h2 = await hashFiles(["dir"], root);
    assertEquals(h1 === h2, false);
    assertEquals(h1.length, 64);
  } finally {
    await cleanupTempDir(root);
  }
});

Deno.test("HARNESS_INPUTS names the shared units and every legacy entry", () => {
  for (const legacy of LEGACY_HARNESS_INPUTS_2026_08) assert(HARNESS_INPUTS.includes(legacy));
  assert(HARNESS_INPUTS.includes("src/parallel/shared"));
  assert(HARNESS_INPUTS.includes("src/parallel/llm-work-pool.ts"));
});
```

(Import `expandInputs`, `hashFiles`, `HARNESS_INPUTS`, `LEGACY_HARNESS_INPUTS_2026_08` and the temp-dir helpers; the `missing.ts` entry passes through `expandInputs` unchanged so `hashFiles`' `missing` policy still applies.)

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/utils/harness-fingerprint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the fingerprint change**

`src/utils/harness-fingerprint.ts`:

```ts
import { join, relative } from "@std/path";
import { walk } from "@std/fs/walk";

/** The list before batch mode (2026-08). Kept only for the one-time gold-ci adoption check. */
export const LEGACY_HARNESS_INPUTS_2026_08 = [
  "src/constants.ts",
  "src/parallel/compile-queue.ts",
  "src/tasks/executor-v2.ts",
  "src/tasks/candidate-guard.ts",
  "scripts/trap-probe.ts",
  "mcp/al-tools-server.ts",
] as const;

/** The code that decides a verdict or a prompt. A directory entry means every .ts file under it. */
export const HARNESS_INPUTS = [
  ...LEGACY_HARNESS_INPUTS_2026_08,
  "src/parallel/shared",
  "src/parallel/infra-retry.ts",
  "src/llm/prompt-building.ts",
  "src/tasks/object-overlay.ts",
  "src/llm/candidate-resolution.ts",
  "src/parallel/llm-work-pool.ts",
] as const;

/** Expand directory entries to their sorted .ts files (posix separators); files and missing paths pass through. */
export async function expandInputs(paths: readonly string[], root: string): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(join(root, p));
    } catch {
      out.push(p);
      continue;
    }
    if (!info.isDirectory) {
      out.push(p);
      continue;
    }
    for await (const entry of walk(join(root, p), { includeDirs: false, exts: [".ts"] })) {
      out.push(relative(root, entry.path).replaceAll("\\", "/"));
    }
  }
  return out.sort();
}
```

and make `hashFiles` start with `const expanded = await expandInputs(paths, root);` iterating `expanded` instead of `[...paths].sort()`. Check `deno.json` has `@std/fs` in `imports`; add `"@std/fs": "jsr:@std/fs@^1"` matching the pinned `@std` major if it is missing.

- [ ] **Step 4: Add `--adopt-harness` to gold-ci**

In `scripts/gold-ci.ts` `main`, after `const ledger = await loadLedger();`:

```ts
  if (argv.includes("--adopt-harness")) {
    const legacyHash = await hashFiles([...LEGACY_HARNESS_INPUTS_2026_08], REPO, { missing: "throw" });
    if (ledger.harnessHash !== legacyHash) {
      console.error(
        `[gold-ci] refusing to adopt: the legacy input list hashes to ${legacyHash.slice(0, 12)} but the ledger records ${(ledger.harnessHash ?? "(none)").slice(0, 12)}; a tracked harness file changed, replay instead`,
      );
      return 1;
    }
    let adopted = 0;
    for (const rec of Object.values(ledger.tasks)) {
      if (rec.verdict === "pass" && rec.harnessHash === legacyHash) {
        rec.harnessHash = harnessHash;
        adopted++;
      }
    }
    ledger.harnessHash = harnessHash;
    ledger.harnessAdopted = {
      from: legacyHash,
      to: harnessHash,
      at: new Date().toISOString(),
      reason: "HARNESS_INPUTS expanded to the shared execution units (batch mode plan A); no previously tracked file changed",
    };
    await Deno.writeTextFile(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
    console.log(`[gold-ci] adopted harness ${harnessHash.slice(0, 12)} on ${adopted} trusted task(s)`);
    return 0;
  }
```

Add `harnessAdopted?: { from: string; to: string; at: string; reason: string };` to the `Ledger` interface and import `LEGACY_HARNESS_INPUTS_2026_08` beside `harnessFingerprint`/`hashFiles`. Document the flag in the script's usage comment: `--adopt-harness   one-time re-baseline after HARNESS_INPUTS grows; refuses if a previously tracked file changed`.

- [ ] **Step 5: Re-baseline and verify**

Run in order:

```bash
deno test --allow-all tests/unit/utils/harness-fingerprint.test.ts
deno run --allow-all scripts/gold-ci.ts --check      # expect: every trusted task now STALE (harness hash moved)
deno run --allow-all scripts/gold-ci.ts --adopt-harness
deno run --allow-all scripts/gold-ci.ts --check      # expect: 232 trusted, 0 stale, exit 0
```

If the first `--check` reports any FAILING task or any task stale for an `inputsHash` reason, stop: that is a real change and needs a replay, not adoption.

Run `deno check src/utils/harness-fingerprint.ts scripts/gold-ci.ts && deno lint src/utils scripts && deno fmt src/utils/harness-fingerprint.ts scripts/gold-ci.ts tests/unit/utils/harness-fingerprint.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/utils/harness-fingerprint.ts scripts/gold-ci.ts docs/reasoning-suite/gold-ci.json tests/unit/utils/harness-fingerprint.test.ts deno.json deno.lock
git commit -m "feat(fingerprint): directory expansion, shared units in HARNESS_INPUTS, gold-ci --adopt-harness re-baseline

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 16: Full verification, documentation, and the gated deploy

**Files:**
- Modify: `CLAUDE.md` (Memory section), `FallRelease.md` (Phase 2 deploy checklist), `docs/refusal-fallback.md` or `docs/site/` (one paragraph on the invocation profile), `.claude/rules/` (no new rule file; the batch runner's rule lands with Plan B)
- No code changes.

- [ ] **Step 1: Full local verification**

Confirm no bench is live: `find results/.bench-running.json -mmin -2` prints nothing. Then:

```bash
deno task test:unit 2>&1 | tee "$TMP/plan-a-unit.log"; grep -E "^(ok|FAILED|error)" "$TMP/plan-a-unit.log" | tail -5
deno check cli/ src/ scripts/gold-ci.ts shared/
deno lint
deno task id-audit
deno task taxonomy-audit
cd site && npm run build && npm run test:main && npm run test:build && npm run check; cd ..
deno run --allow-all scripts/gold-ci.ts --check
```

Expected: all green; gold-ci reports 232 trusted, 0 stale. If `tests/unit/container/` fails for a reason unrelated to this plan (container down), record it in the ledger and do not retry it.

- [ ] **Step 2: Documentation**

`CLAUDE.md` Memory section, add these bullets after the refusal-fallback bullet:

```
- **Exclusive bench lock (D14, 2026-09).** `acquireBenchLock` throws `BenchLockHeldError` when another live marker exists; a marker whose heartbeat is older than 120 s is reclaimed by atomic rename; release and heartbeat are owner-token checked. `bench` exits 1 with `[FAIL]` when the lock is held. `tryAcquireBenchLock` is the non-throwing form. Readers (`isBenchRunning`, the PreToolUse hook) are still mtime-only.
- **Shared execution units (`src/parallel/shared/`, spec D6).** `evaluateAttempt`, `createFailedAttempt`, `finalizeTaskResult`, `buildCompileWorkItem`, `runCompileWorkItem`, `buildAttemptContext`, `renderLLMRequest` (explicit `RenderInputs`, no cwd reads), `priceUsage` (the ONLY cost computation; batch mode throws `BatchPricingUnavailableError` without `batch_*_per_mtoken` catalog rates), `synthesizeInfraAttempt` (attempt-level infra record that keeps prior attempts; the task then terminates in both modes). The orchestrator and pool are thin callers; edit the unit, not the caller. The directory is in `HARNESS_INPUTS` (gold-ci re-baselines via `scripts/gold-ci.ts --adopt-harness` only when no previously tracked file changed).
- **Attempt prompt and provider fields.** `ExecutionAttempt.prompt` is the rendered request on success AND failure (transcripts carry it); `providerFinishReason` (raw stop reason) and `providerErrorCode` (`http_<status>[:<type>]`) flow to D1 `results.provider_finish_reason` / `provider_error_code`.
- **Invocation profile (spec D4).** `IngestMeta` schema 4 carries a typed `InvocationRecord` per variant (mode, endpoint, provider_route, fallback_policy, continuation, empty_retry, infra_retries_per_attempt, max_attempts, prompt_profile_digest). Ingest assembly builds `CanonicalSettings` from it: the six hashed keys, with `extra_json` = canonical JSON of the extras (`shared/settings-hash.ts`, fixture `shared/fixtures/settings-hash.fixture.json`, parity test on both runtimes). Future sync runs therefore get a NEW settings hash; historical rows are untouched. The payload carries `invocation_mode`; D1 `runs.invocation_mode` (migration `0019`) is a required predicate in every ranking query (leaderboard, aggregates, tiers, matrix, compare) and in their cache keys; `mode=all` is `400 invalid_mode_for_metric`; a set with both modes and no `mode` is `400 mode_required`; the default is the set's only mode. `cost_snapshots.batch_*_per_mtoken` (four nullable columns) price batch runs; NULL means unknown, never a factor. Deploy order for 0019: migrations, `sync-catalog --apply` (pushes the batch rates from `site/catalog/pricing.yml`), `_cv=v11`, deploy.
```

`FallRelease.md`: under the Phase 2 deploy checklist add the four-step 0019 order and the note that `sync-catalog --apply` now pushes batch rates (and that `openrouter/google/gemini-3.8-flash` needs its `batch_*` rates filled from the spike-3 findings before a batch run). Under Decision 5 record: "Plan A landed (foundations); Plan B (runner) next; spikes findings in `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md`."

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md FallRelease.md docs
git commit -m "docs: record the exclusive lock, shared units, invocation profile and 0019 deploy order

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

- [ ] **Step 4: STOP and ask the owner before deploying**

The deploy changes the production scoreboard. Present this exact sequence and wait for an explicit yes:

```bash
cd site
npx wrangler d1 migrations apply centralgauge --remote          # 0019 first
cd ..
deno task start sync-catalog --apply                             # pushes batch_* rates; expect 429 pauses (~10 req/min)
deno task start doctor ingest                                    # must be green
cd site && npm run deploy && cd ..                                # CACHE_VERSION already v11
curl -s "https://ai.sshadows.dk/api/v1/leaderboard?mode=all" | head -c 300    # expect 400 invalid_mode_for_metric
curl -s "https://ai.sshadows.dk/api/v1/leaderboard" | head -c 300             # expect 200 (all production runs are sync)
```

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set for the non-interactive shell (CLAUDE.md, Wrangler section). Only after the owner confirms, run it, then run `git push` only if the owner asks for that too.

---

## Self-review notes (written after the plan)

- **Spec coverage.** Section 3: D4 (Tasks 9, 11, 13, 14), D5 (8, 12), D6 (5, 6, 7, 8, 10), D7 (the fragment mappers and `buildRequestParams` exposure are Plan B, with the adapters; Task 4 lays the raw-finish-reason field they map into), D10 (5), D11 (3), D12 (Plan B, `fallbackPolicy` frozen at submit), D13 (10 removes the cwd read; the drift checks are Plan B), D14 (2). Section 6: every unit except the fragment mappers and `buildRequestParams`, which move with the adapters in Plan B. Section 10: canonical settings (9, 11), query enforcement (13, 14), harness fingerprint (15), attempt record (3, 4), results file schema 4 (11; the `batch?` block and `# Batch` scores section are Plan B), site (12, 13, 14). Section 11: Task 1. Section 12: lock (2), shared units and failed-attempt prompt (3, 5, 6), settings hash fixture and `mode=all` (9, 13), pricing (8), site (12 to 14); state-machine, persistence, equivalence and adapter tests are Plan B. Section 14: steps 1 and 2 complete here; step 3 moved first by owner instruction; steps 4 to 6 are Plan B.
- **Deviations recorded as rulings.** Task 7: `buildAttemptContext` keeps three parameters. Task 10: `renderLLMRequest` takes an options object; `RenderInputs` is the render subset of `FrozenPromptInputs`. Task 11: `prompt_version` and `bc_version` stay null; `thinking_budget` moves into `extra_json`. Task 8: adapters keep an internal estimate for streaming display, the pool re-prices through `priceUsage` so the recorded cost has one source.
- **Type consistency checked.** `InvocationMode` is declared in `shared/settings-hash.ts` (client) and `site/src/lib/server/invocation-mode.ts` (server) as the same union; `api-types.ts` declares it locally. `RenderInputs.promptOverrides` is `CLIPromptOverrides | null` and `renderLLMRequest` passes `?? undefined` into the resolver, matching `buildRequest`'s optional parameter. `CompileWorkResult.testResult` is optional in `src/parallel/types.ts`; Task 6's tests set it through the mock factory. `LLMWorkResult.request` (Task 3) is what Tasks 5, 6 and 10 read.
