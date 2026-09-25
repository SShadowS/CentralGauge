# Harness Bench M3: pi adapter, al-tools MCP component, toolchain component

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By the 2026-10-09 launch gate ("Claude Code and pi adapters working"), a supervised pi 0.87.1 cell (openrouter provider) runs HX-001 in the Windows sandbox behind the egress proxy, with an estimated cost in the records; Claude Code can load the al-tools MCP component; the AL Tools NuGet toolchain component exists if the cut order leaves room.

**Architecture:** The pi adapter mirrors the accepted Claude Code adapter (M1-32): a pure stream parser (`parsePiStream`) behind the frozen `HarnessAdapter` contract, one image (`harness/images/pi/`) whose `run.ps1` reads `C:\config`, and a pi extension (`cg-budget.ts`) that enforces the manifest budget because pi has no budget flag. The al-tools MCP component is a dependency-free stdio MCP server in the base image that forwards to the same `cg-al` backend. The toolchain component is an image layer on top of a harness image, pinned in `harness/images/pins.json` and identified by an image label.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/assert`; pi `@earendil-works/pi-coding-agent` 0.87.1 on Node 22.19.0 (base image); Windows PowerShell 5.1 in the images; AL Tools NuGet `Microsoft.Dynamics.BusinessCentral.Development.Tools` 18.0.41.62505 with .NET 8.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (spec 1a, sections 4, 5, 8, 11, 12 items 3-4). Binding inputs: findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` (sections 3, 4, 6, 8); M1 part 2 plan `docs/superpowers/plans/2026-09-30-harness-core-part2.md` (M1-19, M1-20, M1-22, M1-24, M1-32, M1-33, M1-34); launch contract `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`; decisions under `H:\cg-coord\decisions\`: `accept-M0-04` (pi parser rules), `accept-M0-06` (toolchain carryover), `accept-M0-07` (categorization is M2), `m1p2-round2` (unknown cache TTL gives a null cost), `secrets-accepted-risk`, `egress` with all addenda, `accept-M1-32` (non-JSON stdout: count, line numbers, byte lengths only; termination null plus stream problems maps to `infra_exposed` in M1-22), `reviewer-gpt6sol`. Code on master: `src/harness/adapter.ts`, `pricing.ts`, `trace.ts`, `records.ts`, `sandbox.ts`, `fsutil.ts`, `adapters/claude-code.ts`, `adapters/mod.ts`. Fixture: `tests/fixtures/harness/pi/probe.jsonl`.

## Global Constraints

- The adapter contract in `src/harness/adapter.ts` is reused exactly: no new field on `HarnessAdapter`, `ParseInput` or `ParsedRun`. `Telemetry`, `TraceEvent` and `ExecutionRecord` shapes are unchanged.
- pi is judged from its events, never from its exit code: pi exits 0 even when every provider call fails (findings section 4; task brief). Termination comes from `agent_end`, the last assistant `stopReason`, `auto_retry_end.success` and our own `cg_*` records.
- Parser rules (accept-M0-04): count tool calls from `tool_execution_start` only; usage and pi's cost from assistant `message_end` only (`turn_end` and `agent_end` repeat them and would double count).
- Cost basis: `cost_usd` is the list-price estimate from reported tokens through `estimateCost` and the run's `PricingBook`; pi's `usage.cost.total` sum is `reported_cost_usd` only. pi reports `cacheWrite` with no TTL, so cache-write tokens are `cache_write_unknown` and the cost is null with the reason named (m1p2-round2, owner decision). Never guessed.
- Non-JSON stdout (accept-M1-32): counted with line numbers and byte lengths, never content; it makes the cost null and is listed in `raw_usage.stream_problems`.
- Secrets: the OpenRouter key is read from `C:\cg-secrets\openrouter-api-key` into pi's environment only. Never `--api-key` (argv), never `docker run -e`, never an image layer (M0-03 carryover a; findings section 3 names the spike's argv key as a rejected pattern).
- Egress (decision `egress` and addenda): at most 5 supervised credential-bearing runs across all lanes before the marker is `authorized` and verified; each reserved in the shared ledger `CG_CREDENTIAL_LEDGER`; no unattended retries; Ctrl+C on unexpected network activity. pi reaches OpenRouter through `HTTPS_PROXY` when the sandbox is on `cg-harness-sandbox` (M1-33).
- Paid spend: OpenRouter spend is logged in `H:\cg-coord\decisions\spend.md` (cap USD 150, report at 120).
- pi 0.87.1 has no native MCP (findings section 4). MCP components are Claude Code only; the pi adapter refuses them. pi arms vary skills, instructions and models.
- Model ids are never hardcoded in code; configs name catalog slugs (`site/catalog/models.yml`), the adapter maps slug to `api_model_id`. No `sync-catalog --apply`, no ingest, no deploy.
- Lanes: code tasks are lane `infra`, never touch Docker or a BC container, and run as `deno test --allow-all <file>` (never `--parallel`, never `tests/unit/container/` while a bench is live). Container, image and sandbox work is lane `ops`, with evidence under `H:\cg-coord\tasks\<id>\runs\<nnn>\evidence.md`. Every ad-hoc ops docker command is prefixed `DOCKER_CONTEXT=desktop-windows`.
- BC containers: Cronus281 (Cronus282/283 after M1-27 qualification); Cronus28 and Cronus284 are never used. Starting, stopping or recreating a BC container is forbidden without the owner.
- After each task: `deno check`, `deno lint`, `deno fmt` on the task's files only (never under `site/`). After the last infra task: `graphify update .`. Import order per CLAUDE.md. `[OK]`/`[FAIL]`/`[WARN]` tags, no emoji. No em dash anywhere, including fixtures written by this plan.
- Recorded fixtures under `tests/fixtures/harness/` stay byte-exact (`.gitattributes`: `tests/fixtures/harness/** -text`) and are scanned for every secret value before commit.
- Cut order (launch contract): item 2 is the AL Tools NuGet `toolchain` component. Tasks M3-06 and M3-08 are **CUTTABLE (cut item 2)**; the orchestrator may drop them without asking. Dropping pi needs the owner. The al-tools MCP component (M3-03, M3-07) is not in the cut order: the 10-10 campaigns include Claude Code MCP arms.

## Review Focus

1. **Every provider call fails (bad key 401, credits exhausted 402, rate limit 429) and pi still exits 0.** Expected: never `completed`; 402/429 give `usage_limited`, anything else `harness_crash`; `did_work` false when no request succeeded and no tool ran. Pinned in M3-01 (`pi parse: pi exits 0 after every provider call failed`) and replayed on a captured log in M3-05.
2. **The sandbox is killed mid-request (timeout).** Expected: termination null (the runner decides timeout), cost null with the reason "no agent_end", the partial per-model usage kept in `raw_usage.usage`. Pinned in M3-01 (`pi parse: a cut stream`).
3. **A cache write is reported (an Anthropic model through OpenRouter).** Expected: cost null naming "cache write TTL unknown", never priced at a guessed TTL; `reported_cost_usd` still filled. Pinned in M3-01 (`pi parse: cache writes have no TTL`).
4. **The budget guard does not load or loads with the wrong limit** (a changed image, a typo in `run.ps1`), so pi runs uncapped. Expected: `setup_failed` with the reason in `stream_problems`. Pinned in M3-01 (`pi parse: a missing or wrong budget guard is setup_failed`) and M3-02 (`run.ps1: loads the budget guard explicitly`).
5. **The OpenRouter key leaks through argv or the agent prints its environment.** Expected: the key never appears in `run.ps1` argv or any image layer; a printed key is redacted on publication by M1-22's byte-wise redaction. Pinned in M3-02 (`run.ps1: the key travels by file and env only`) and M3-09 Step 5 (secret scan of `results/harness`).

## Reuse

Reused as-is: `HarnessAdapter`, `requestedComponents`, `incompleteTelemetry` (`adapter.ts`); `estimateCost`, `ModelTokens`, `PricingBook`, `loadPricingBook` (`pricing.ts`); `writeTrace`, `TraceEvent` (`trace.ts`); `Termination`, `Telemetry` (`records.ts`); `runSandbox`, `realDocker`, `SandboxSpec` (`sandbox.ts`); `ConfigurationError`, `ValidationError` (`src/errors.ts`); `loadConfig`, `checkModelsInCatalog`, `HarnessConfigSchema` (`config.ts`); `hashJson` (`hash.ts`); the M1-24 image code (`src/harness/images.ts`, `harnessImagesBuild` in `cli/commands/harness-command.ts`); the M1-19 backend protocol (`POST /v1/<op>`, `Authorization: Bearer`, `X-CG-Execution`, token file `C:\cg-secrets\backend-token`, env `CG_BACKEND_URL`, `CG_EXECUTION_ID`); `resolveBackendHost` (`src/harness/backend.ts`); the test helpers `tests/unit/harness/fixtures.ts` (`manifest`) and `fake-docker.ts` (`FakeDocker.addImage`, `builds`).

Moved, not rewritten: `readRecords`, `nonJsonReason`, `only`, `refuse` leave `adapters/claude-code.ts` for `adapters/jsonl.ts` (M3-01 Step 1) so both adapters share the accepted non-JSON handling; the Claude Code tests are the guard that the move changed nothing.

Not reused: `mcp/al-tools-server.ts` (binds 0.0.0.0, talks to BC directly; the harness MCP must go through the backend); `almcp.dll` from the NuGet package (accept-M0-06: presence only, never probed; nothing in M3 relies on it).

Deferred, with the owner: call categorization rules for pi (`SKILL.md` reads as skill use, toolchain command shapes) are M2 (accept-M0-07 carryover); M3 emits `tool_call` and `retry` events only, like the Claude Code adapter.

## Schedule

| Task | Lane | Deps | Date | What |
| --- | --- | --- | --- | --- |
| M3-01 | infra | M1-21, M1-32 (accepted) | 10-02 | shared JSONL reader; `parsePiStream`: calls, outcomes, usage, cost, termination, observed skills |
| M3-02 | infra | M3-01, M1-20 | 10-03 | `piAdapter` registered; `harness/images/pi` (Dockerfile, `run.ps1`, `cg-budget.ts`); config `pi-flash-plain`; `scripts/harness/pi-probe.ts` |
| M3-03 | infra | M1-19, M1-24 | 10-05 | al-tools MCP component: stdio server in the base image, image label facts, `runtimeFacts`, Claude Code wiring |
| M3-04 | ops | M3-02, M1-24, M1-28 | 10-05 | build the pi image; no-credential probes: version, auth failure, proxy honored, skills, prompt on stdin (fixtures) |
| M3-05 | infra | M3-04 | 10-06 | parser pinned to the M3-04 captured fixtures |
| M3-06 | infra | M1-24, M3-03 | 10-06 | **CUTTABLE (cut item 2)** toolchain component: image layer, pins, tag and label, `--toolchain` |
| M3-07 | ops | M3-03, M1-28 | 10-07 | al-tools MCP round trip from inside the claude-code image to the real backend, no model credential |
| M3-08 | ops | M3-06 | 10-08 | **CUTTABLE (cut item 2)** fill toolchain pins, build, offline compile of HX-001 apps in the sandbox |
| M3-09 | ops | M3-05, M1-29, M1-33, M1-34 (Step 6, marker `qualified`) | 10-08 to 10-09 | **gate:** supervised pi cell on HX-001 behind the proxy, estimated cost in the records |

---

### Task M3-01: shared JSONL reader and the pi stream parser

pi 0.87.1 JSON mode (findings section 4; fixture `tests/fixtures/harness/pi/probe.jsonl`, 90 lines, 5 assistant `message_end`, 4 `tool_execution_start`, 5 `turn_end`, final `agent_settled`). Two records are ours, not pi's: `cg_entry` (first stdout line, written by `run.ps1` with `pi --version`) and `cg_budget_armed` / `cg_budget_exhausted` (written by the budget extension, M3-02). Shapes of `auto_retry_start`, `auto_retry_end` (`success`, `finalError`) and an error `message_end` (`stopReason: "error"`, `errorMessage`) are taken from the task brief and pi's event names; M3-05 pins them to captured logs.

Termination, in this order:
1. a `cg_budget_exhausted` record: `budget_exhausted`;
2. no `agent_end`: `null` (the runner decides: timeout, kill; accept-M1-32 maps null plus stream problems to `infra_exposed`);
3. no `cg_budget_armed`, or its `limit_usd` differs from the manifest's `limits.max_budget_usd`: `setup_failed` (the arm did not run as configured);
4. last assistant `stopReason` is `stop` or `length`: `completed`;
5. otherwise (`error`, `aborted`, `toolUse` at the end, no assistant message): `usage_limited` when the last `errorMessage` or any `auto_retry_end.finalError` matches `402`, `429`, `rate limit`, `insufficient credits` or `quota`; else `harness_crash`.

`did_work`: a `tool_execution_start`, or an assistant `message_end` whose `stopReason` is neither `error` nor `aborted`.

**Lane:** infra. **Deps:** M1-21, M1-32 (both accepted on master). **Date:** 10-02.

**Files:**
- Create: `src/harness/adapters/jsonl.ts`, `src/harness/adapters/pi.ts`
- Modify: `src/harness/adapters/claude-code.ts` (import the moved helpers; no behavior change)
- Test: `tests/unit/harness/pi.test.ts`

**Interfaces:**
- Consumes: `ParseInput`, `ParsedRun`, `requestedComponents` (`adapter.ts`); `estimateCost`, `ModelTokens`, `PricingBook` (`pricing.ts`); `TraceEvent` (`trace.ts`); `Termination`, `Telemetry` (`records.ts`).
- Produces (jsonl.ts): `interface Line<T> { rec: T; line: number }`; `interface NonJson { count: number; first: { line: number; bytes: number }[] }`; `readRecords<T extends object>(text: string): { lines: Line<T>[]; nonJson: NonJson }`; `nonJsonReason(n: NonJson): string`; `refuse(msg: string): never`; `only<T>(recs: Line<T>[], what: string, file: string): Line<T> | undefined`.
- Produces (pi.ts): `PI_PROVIDER = "openrouter"`; `PI_ROUTE = "openrouter:api-key"`; `PI_EGRESS_HOSTS = ["openrouter.ai"]`; `ENTRY_RECORD = "cg_entry"`; `ARMED_RECORD = "cg_budget_armed"`; `BUDGET_RECORD = "cg_budget_exhausted"`; `parsePiStream(text: string, input: Omit<ParseInput, "traceOut">, streamProblems?: string[]): ParsedRun & { trace: TraceEvent[] }`.

- [ ] **Step 1: Move the shared reader (guarded by the existing tests)**

Create `src/harness/adapters/jsonl.ts` with the functions cut verbatim from `claude-code.ts` (`readRecords`, `nonJsonReason`, `only`, `refuse`, `NON_JSON_SHOWN`, `NonJson`, `Line`), made generic over the record type:

```typescript
/**
 * JSONL reading shared by the harness stream parsers (moved from the Claude
 * Code adapter, accept-M1-32): one JSON object with a string `type` per line;
 * a leading BOM, CRLF and blank lines are accepted. Any other line never
 * throws the attempt away: it is counted, and the first few are named by line
 * number and byte length. No content is stored, since even a prefix can carry
 * part of a secret; the full log stays in quarantine.
 */

import { ValidationError } from "../../errors.ts";

export interface Line<T> {
  rec: T;
  line: number;
}

const NON_JSON_SHOWN = 3;
export interface NonJson {
  count: number;
  first: { line: number; bytes: number }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function readRecords<T extends object>(
  text: string,
): { lines: Line<T>[]; nonJson: NonJson } {
  const raw = (text.startsWith("\uFEFF") ? text.slice(1) : text).split(
    /\r?\n/,
  );
  const lines: Line<T>[] = [];
  const nonJson: NonJson = { count: 0, first: [] };
  for (const [i, l] of raw.entries()) {
    if (l.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      v = undefined;
    }
    if (isObj(v) && typeof v["type"] === "string") {
      lines.push({ rec: v as T, line: i + 1 });
      continue;
    }
    nonJson.count++;
    if (nonJson.first.length < NON_JSON_SHOWN) {
      nonJson.first.push({
        line: i + 1,
        bytes: new TextEncoder().encode(l).length,
      });
    }
  }
  return { lines, nonJson };
}

/** Names the non-JSON lines: count and the first line numbers. */
export function nonJsonReason(n: NonJson): string {
  return `${n.count} non-JSON stdout line${n.count === 1 ? "" : "s"} (${
    n.first.map((x) => `line ${x.line}`).join(", ")
  }${n.count > n.first.length ? ", ..." : ""})`;
}

export function refuse(msg: string): never {
  throw new ValidationError(msg, [msg]);
}

/** At most one record of a kind; a second one contradicts the first. */
export function only<T>(
  recs: Line<T>[],
  what: string,
  file: string,
): Line<T> | undefined {
  if (recs.length > 1) {
    refuse(
      `${file}: ${recs.length} ${what} records (lines ${
        recs.map((r) => r.line).join(", ")
      })`,
    );
  }
  return recs[0];
}
```

In `claude-code.ts`: delete those definitions, add `import { type Line, nonJsonReason, only, readRecords, refuse } from "./jsonl.ts";` (last import, relative), change the local `interface Line { rec: J; line: number }` uses to `Line<J>`, and call `readRecords<J>(text)`. The `ValidationError` import stays only if still used (it is not after the move: `refuse` covers it; `deno lint` names an unused import).

- [ ] **Step 2: Run the Claude Code tests (must still pass unchanged)**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts`
Expected: PASS, same count as before the move.

- [ ] **Step 3: Write the failing pi tests**

`tests/unit/harness/pi.test.ts`:

```typescript
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import type { ResolvedManifest } from "../../../src/harness/manifest.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { parsePiStream } from "../../../src/harness/adapters/pi.ts";
import { manifest } from "./fixtures.ts";

const FIXTURE = "tests/fixtures/harness/pi/probe.jsonl";
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "google/gemini-3.8-flash": {
      slug: "openrouter/google/gemini-3.8-flash",
      pricing_version: "2026-09-07",
      input: 0.75,
      output: 3.75,
      cache_read: 0.075,
      cache_write_5m: 0.0417,
      cache_write_1h: null,
      cache_write_1h_derived: false,
    },
  },
};
const ENTRY = JSON.stringify({ type: "cg_entry", pi_version: "0.87.1", max_budget_usd: 5 });
const ARMED = JSON.stringify({ type: "cg_budget_armed", limit_usd: 5 });
const HEAD = `${ENTRY}\n${ARMED}\n`;

function pm(over: Partial<ResolvedManifest> = {}): ResolvedManifest {
  return manifest("pi", {
    harness: "pi",
    harness_version: "0.87.1",
    models: { main: "openrouter/google/gemini-3.8-flash" },
    provider_routes: { main: "openrouter:api-key" },
    ...over,
  });
}
const run = (text: string, over: Partial<ResolvedManifest> = {}, exitCode: number | null = 0) =>
  parsePiStream(text, { rawLog: "C:\\q\\raw.jsonl", exitCode, manifest: pm(over), pricing: BOOK });
const problems = (r: ReturnType<typeof run>) =>
  (r.telemetry.raw_usage as { stream_problems: string[] }).stream_problems;
const assistant = (o: Record<string, unknown>) =>
  JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      provider: "openrouter",
      model: "google/gemini-3.8-flash",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
      ...o,
    },
  });
const END = `${JSON.stringify({ type: "agent_end", willRetry: false })}\n${JSON.stringify({ type: "agent_settled" })}\n`;

Deno.test("pi parse: the M0-04 probe gives calls, outcomes, estimated and reported cost, observed skills", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
    skills: {
      path: "bundles/s/skills",
      hash: "a".repeat(64),
      files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }],
    },
  });
  assertEquals(r.termination, "completed");
  assert(r.didWork);
  assertEquals(r.telemetry.harness_version, "0.87.1");
  assertAlmostEquals(r.telemetry.cost_usd!, (10030 * 0.75 + 1058 * 3.75) / 1e6, 1e-12);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.telemetry.pricing_snapshot, "openrouter/google/gemini-3.8-flash@2026-09-07");
  assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.01149, 1e-9);
  assertEquals(r.telemetry.per_model, [{
    model: "openrouter/google/gemini-3.8-flash",
    requests: 5,
    tokens_in_uncached: 10030,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_out: 1058,
    tokens_reasoning: 598,
    cost_usd: r.telemetry.cost_usd,
  }]);
  assertEquals([r.telemetry.turns, r.telemetry.stop_reason, r.telemetry.exit_code], [5, "stop", 0]);
  assertEquals(r.observed, {
    harness_version: "0.87.1",
    models: ["openrouter/google/gemini-3.8-flash"],
    loaded_components: ["skills"],
  });
  assertEquals(r.trace.map((e) => [e.tool, e.transport, e.outcome, e.result_bytes]), [
    ["read", "builtin", "ok", 191],
    ["read", "builtin", "ok", 1309],
    ["bash", "shell", "error", 78],
    ["bash", "shell", "ok", 114],
  ]);
  assertEquals(r.trace.map((e) => e.request_id), [
    "gen-1790337684-4yFOxDaLsiEetl7SFlSd",
    "gen-1790337692-FMVYrPlIFfx1b7MxkAHD",
    "gen-1790337701-8CKiSkNCCCusBQdrudlX",
    "gen-1790337704-kM82l3iIWRO7njJHjTFb",
  ]);
  assert(r.trace.every((e) => e.session === "01a0d871-168a-71a7-aca7-ade97274c0e8" && e.model === "google/gemini-3.8-flash"));
  assertEquals(r.traceEvents, 4);
  assertEquals(problems(r), []);
});

Deno.test("pi parse: turn_end and agent_end never double count usage", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  // Each message's usage also appears in turn_end and agent_end; only message_end counts.
  const r = run(HEAD + text);
  assertEquals(r.telemetry.per_model[0]!.requests, 5);
  assertEquals(r.telemetry.per_model[0]!.tokens_in_uncached, 10030);
});

Deno.test("pi parse: pi exits 0 after every provider call failed", () => {
  const fail = (msg: string) =>
    HEAD +
    assistant({ stopReason: "error", errorMessage: msg }) + "\n" +
    JSON.stringify({ type: "auto_retry_end", success: false, finalError: msg }) + "\n" + END;
  const auth = run(fail("401 Unauthorized: invalid API key"));
  assertEquals([auth.termination, auth.didWork, auth.telemetry.exit_code], ["harness_crash", false, 0]);
  assertEquals(auth.telemetry.cost_usd, 0);
  assertEquals(run(fail("402 insufficient credits")).termination, "usage_limited");
  assertEquals(run(fail("429 Too Many Requests: rate limit")).termination, "usage_limited");
  assertEquals(run(HEAD + assistant({ stopReason: "aborted" }) + "\n" + END).termination, "harness_crash");
  assertEquals(run(HEAD + END).termination, "harness_crash", "agent ended without any answer");
});

Deno.test("pi parse: a cut stream (hard kill) has no termination and no cost, partial usage kept", async () => {
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const cut = lines.slice(0, 40).join("\n") + "\n";
  const r = run(cut, {}, null);
  assertEquals(r.termination, null);
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.turns, null);
  const raw = r.telemetry.raw_usage as { missing: string[]; usage: Record<string, { requests: number }> };
  assertStringIncludes(raw.missing[0]!, "no agent_end");
  assert(raw.usage["google/gemini-3.8-flash"]!.requests >= 1);
});

Deno.test("pi parse: cache writes have no TTL, so the cost is null and the reported cost stays", () => {
  const text = HEAD +
    assistant({
      stopReason: "stop",
      usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 50, totalTokens: 160, cost: { total: 0.001 } },
    }) + "\n" + END;
  const r = run(text);
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.reported_cost_usd, 0.001);
  const raw = r.telemetry.raw_usage as { missing: string[] };
  assert(raw.missing.some((m) => m.includes("cache write TTL unknown (50 tokens)")));
  assertEquals(r.termination, "completed");
});

Deno.test("pi parse: a missing or wrong budget guard is setup_failed", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const none = run(ENTRY + "\n" + text);
  assertEquals(none.termination, "setup_failed");
  assertStringIncludes(problems(none).join("\n"), "budget guard not armed");
  const wrong = run(ENTRY + "\n" + JSON.stringify({ type: "cg_budget_armed", limit_usd: 50 }) + "\n" + text);
  assertEquals(wrong.termination, "setup_failed");
  assertStringIncludes(problems(wrong).join("\n"), "limit 50, manifest 5");
});

Deno.test("pi parse: the budget record wins over every other ending", () => {
  const text = HEAD + assistant({ stopReason: "aborted" }) + "\n" +
    JSON.stringify({ type: "cg_budget_exhausted", spent_usd: 5.01, limit_usd: 5 }) + "\n" + END;
  assertEquals(run(text).termination, "budget_exhausted");
});

Deno.test("pi parse: usage problems make the cost null; provider must be openrouter", () => {
  const bad = run(HEAD + assistant({ stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } } }) + "\n" + END);
  assertEquals(bad.telemetry.cost_usd, null);
  assert((bad.telemetry.raw_usage as { missing: string[] }).missing.some((m) => m.includes("totalTokens 5")));
  const other = run(HEAD + assistant({ stopReason: "stop", provider: "anthropic" }) + "\n" + END);
  assertEquals(other.telemetry.cost_usd, null);
  const noCost = run(HEAD + assistant({ stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } }) + "\n" + END);
  assertEquals(noCost.telemetry.reported_cost_usd, null);
  assert(noCost.telemetry.cost_usd !== null, "pi's own cost is not needed for the estimate");
});

Deno.test("pi parse: non-JSON stdout keeps the attempt, stores no content, nulls the cost", async () => {
  const secretish = "sk-or-v1-" + "z".repeat(40);
  const r = run(HEAD + secretish + "\n" + await Deno.readTextFile(FIXTURE));
  assertEquals(r.termination, "completed");
  assertEquals(r.telemetry.cost_usd, null);
  const all = JSON.stringify(r.telemetry.raw_usage);
  assert(!all.includes("z".repeat(10)), "no content of a non-JSON line is stored");
  assertStringIncludes(problems(r)[0]!, "1 non-JSON stdout line (line 3)");
});

Deno.test("pi parse: contradictory records are refused with file and line", () => {
  const start = (id: string) => JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName: "read", args: {} });
  assertThrows(() => run(HEAD + start("c1") + "\n" + start("c1") + "\n"), ValidationError, "c1 repeats line 3");
  assertThrows(() => run(HEAD + ENTRY + "\n"), ValidationError, "2 cg_entry records");
  const endRec = JSON.stringify({ type: "tool_execution_end", toolCallId: "c9", isError: false, result: { content: [] } });
  assertThrows(() => run(HEAD + endRec + "\n" + endRec + "\n"), ValidationError, "second tool_execution_end for c9");
  const orphan = run(HEAD + endRec + "\n" + END);
  assertStringIncludes(problems(orphan).join("\n"), "tool_execution_end for unknown c9");
});

Deno.test("pi parse: retries become trace events; unknown record types are listed", () => {
  const text = HEAD + JSON.stringify({ type: "auto_retry_start", attempt: 1 }) + "\n" +
    JSON.stringify({ type: "auto_retry_end", success: true }) + "\n" +
    JSON.stringify({ type: "mystery" }) + "\n" + assistant({ stopReason: "stop" }) + "\n" + END;
  const r = run(text);
  assertEquals(r.trace.map((e) => e.type), ["retry"]);
  assertEquals(r.termination, "completed");
  assertStringIncludes(problems(r).join("\n"), "unknown record type mystery (1)");
});

Deno.test("pi parse: instructions, agents, hooks and toolchain are unobservable; skills missing from the prompt are not loaded", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
    skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "objid/SKILL.md", sha256: "b".repeat(64) }] },
    instructions: { path: "bundles/env/instructions", hash: "c".repeat(64), files: [] },
    toolchain: ["al-tools-nuget@18.0.41.62505"],
  });
  assertEquals(r.observed.loaded_components, []);
  assertEquals(r.unobservable.sort(), ["instructions", "toolchain:al-tools-nuget@18.0.41.62505"]);
});

Deno.test("pi parse: harness version is the x.y.z inside pi --version output", () => {
  const e = JSON.stringify({ type: "cg_entry", pi_version: "pi 0.87.1\r\n", max_budget_usd: 5 });
  assertEquals(run(`${e}\n${ARMED}\n${END}`).observed.harness_version, "0.87.1");
  assertEquals(run(`${ARMED}\n${END}`).observed.harness_version, null);
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts`
Expected: FAIL, module `src/harness/adapters/pi.ts` not found.

- [ ] **Step 5: Implement the parser**

`src/harness/adapters/pi.ts`:

```typescript
/**
 * pi 0.87.1 adapter (spec 1a section 12 item 3; findings section 4;
 * decisions accept-M0-04, accept-M1-32, m1p2-round2). pi's JSON mode is
 * judged from its events, never the exit code: pi exits 0 when every
 * provider call fails. Tool calls come from tool_execution_start only,
 * outcomes from tool_execution_end, usage and pi's own cost from assistant
 * message_end only (turn_end and agent_end repeat them). pi states no
 * cache-write TTL, so any cache write makes the cost null. cg_entry (from
 * run.ps1) and cg_budget_* (from the budget extension) are our records.
 */

import type { ParsedRun, ParseInput } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { Telemetry, Termination } from "../records.ts";
import type { TraceEvent } from "../trace.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { nonJsonReason, only, readRecords, refuse } from "./jsonl.ts";

export const PI_PROVIDER = "openrouter";
export const PI_ROUTE = "openrouter:api-key";
/** Hosts the proxy must allow for PI_ROUTE (M1-33 allowlist; verified in M3-04 and M3-09). */
export const PI_EGRESS_HOSTS = ["openrouter.ai"];
export const ENTRY_RECORD = "cg_entry";
export const ARMED_RECORD = "cg_budget_armed";
export const BUDGET_RECORD = "cg_budget_exhausted";

type R = Record<string, unknown>;

const KNOWN_TYPES = new Set([
  "session",
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "auto_retry_start",
  "auto_retry_end",
  ENTRY_RECORD,
  ARMED_RECORD,
  BUDGET_RECORD,
]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const LIMIT_TEXT = /\b(402|429)\b|rate.?limit|insufficient credits|quota/i;

const isObj = (v: unknown): v is R =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): R => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const utf8 = new TextEncoder();
/** A JSON round trip: the value is JSON by construction, whatever the log held. */
const toJson = (v: unknown): Telemetry["raw_usage"] =>
  JSON.parse(JSON.stringify(v));

interface Agg {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  problems: string[];
}

export function parsePiStream(
  text: string,
  input: Omit<ParseInput, "traceOut">,
  /** Problems found before parsing (a missing log); reported first. */
  streamProblems: string[] = [],
): ParsedRun & { trace: TraceEvent[] } {
  const file = input.rawLog;
  const { lines, nonJson } = readRecords<R>(text);
  if (nonJson.count > 0) {
    streamProblems.push(
      `${nonJsonReason(nonJson)}: ${
        nonJson.first.map((x) => `line ${x.line} (${x.bytes} bytes)`).join(", ")
      }`,
    );
  }
  const of = (t: string) => lines.filter((x) => x.rec["type"] === t);
  const unknown = new Map<string, number>();
  for (const { rec } of lines) {
    const t = rec["type"] as string;
    if (!KNOWN_TYPES.has(t)) unknown.set(t, (unknown.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...unknown].sort(([a], [b]) => a < b ? -1 : 1)) {
    streamProblems.push(`unknown record type ${t} (${n})`);
  }

  const session = only(of("session"), "session", file)?.rec;
  const entry = only(of(ENTRY_RECORD), ENTRY_RECORD, file)?.rec;
  const armed = only(of(ARMED_RECORD), ARMED_RECORD, file)?.rec;
  const budget = only(of(BUDGET_RECORD), BUDGET_RECORD, file)?.rec;
  const ended = of("agent_end").length > 0;
  const sessionId = str(session?.["id"]);
  const version = /\d+\.\d+\.\d+/.exec(str(entry?.["pi_version"]) ?? "")?.[0] ??
    null;

  // Outcomes, one per tool call id.
  const outcomes = new Map<string, { error: boolean; bytes: number }>();
  for (const { rec, line } of of("tool_execution_end")) {
    const id = str(rec["toolCallId"]);
    if (id === null) {
      refuse(`${file}:${line}: tool_execution_end without a toolCallId`);
    }
    if (outcomes.has(id)) {
      refuse(`${file}:${line}: second tool_execution_end for ${id}`);
    }
    const body = list(obj(rec["result"])["content"]).map(obj)
      .filter((c) => c["type"] === "text").map((c) => str(c["text"]) ?? "")
      .join("");
    outcomes.set(id, {
      error: rec["isError"] === true,
      bytes: utf8.encode(body).length,
    });
  }

  const trace: TraceEvent[] = [];
  const ev = (o: Partial<TraceEvent>): TraceEvent => ({
    v: 1,
    seq: trace.length + 1,
    t_ms: null,
    type: "tool_call",
    session: sessionId,
    agent: "main",
    parent: null,
    call_id: null,
    request_id: null,
    tool: null,
    transport: null,
    skill: null,
    backend_request: null,
    outcome: null,
    error_class: null,
    result_bytes: null,
    truncated: null,
    duration_ms: null,
    model: null,
    ...o,
  });
  const started = new Map<string, number>();
  const usage = new Map<string, Agg>();
  let reported: number | null = 0;
  let last: R | null = null;
  let requestId: string | null = null;
  let model: string | null = null;
  let systemSkills: string | null = null;
  let didWork = false;
  for (const { rec, line } of lines) {
    const t = rec["type"];
    if (t === "message_start" && systemSkills === null) {
      const m = obj(rec["message"]);
      if (m["role"] === "system") {
        systemSkills = str(obj(m["sections"])["skills"]) ?? "";
      }
    } else if (t === "message_end" && obj(rec["message"])["role"] === "assistant") {
      const m = obj(rec["message"]);
      last = m;
      model = str(m["model"]);
      requestId = str(m["responseId"]);
      const stop = str(m["stopReason"]);
      if (stop !== "error" && stop !== "aborted") didWork = true;
      const key = model ?? "";
      const a: Agg = usage.get(key) ?? {
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: null,
        problems: [],
      };
      usage.set(key, a);
      a.requests++;
      if (m["provider"] !== PI_PROVIDER) {
        a.problems.push(
          `line ${line}: provider ${String(m["provider"])}, expected ${PI_PROVIDER}`,
        );
      }
      const u = obj(m["usage"]);
      const n = (k: string): number => {
        const v = u[k];
        if (isCount(v)) return v;
        a.problems.push(`line ${line}: usage.${k} missing or not a count`);
        return 0;
      };
      const [i, o, cr, cw, total] = [
        n("input"),
        n("output"),
        n("cacheRead"),
        n("cacheWrite"),
        n("totalTokens"),
      ];
      if (total !== i + o + cr + cw) {
        a.problems.push(
          `line ${line}: totalTokens ${total} != input + output + cacheRead + cacheWrite`,
        );
      }
      a.input += i;
      a.output += o;
      a.cacheRead += cr;
      a.cacheWrite += cw;
      const rz = u["reasoning"];
      if (rz !== undefined) {
        if (isCount(rz)) a.reasoning = (a.reasoning ?? 0) + rz;
        else a.problems.push(`line ${line}: usage.reasoning not a count`);
      }
      const c = obj(u["cost"])["total"];
      reported = reported !== null && typeof c === "number" &&
          Number.isFinite(c) && c >= 0
        ? reported + c
        : null;
    } else if (t === "tool_execution_start") {
      didWork = true;
      const id = str(rec["toolCallId"]);
      const name = str(rec["toolName"]);
      if (id === null || name === null) {
        refuse(
          `${file}:${line}: tool_execution_start without a string toolCallId and toolName`,
        );
      }
      const seen = started.get(id);
      if (seen !== undefined) {
        refuse(`${file}:${line}: tool call ${id} repeats line ${seen}`);
      }
      started.set(id, line);
      const out = outcomes.get(id);
      trace.push(ev({
        call_id: id,
        request_id: requestId,
        tool: name,
        transport: SHELL_TOOLS.has(name) ? "shell" : "builtin",
        outcome: out ? (out.error ? "error" : "ok") : null,
        result_bytes: out?.bytes ?? null,
        model,
      }));
    } else if (t === "auto_retry_start") {
      trace.push(ev({ type: "retry", request_id: requestId, model }));
    }
  }
  for (const id of [...outcomes.keys()].sort()) {
    if (!started.has(id)) {
      streamProblems.push(`tool_execution_end for unknown ${id}`);
    }
  }

  // Cost: list price from tokens. Cache writes carry no TTL (never priced).
  const models = [...usage.keys()].sort();
  const tokens: ModelTokens[] = models.map((m) => {
    const a = usage.get(m)!;
    return {
      model: m,
      requests: a.requests,
      input: a.input,
      cache_read: a.cacheRead,
      cache_write_5m: 0,
      cache_write_1h: 0,
      cache_write_unknown: a.cacheWrite,
      output: a.output,
      reasoning: a.reasoning,
      problems: a.problems,
    };
  });
  const priced = estimateCost(tokens, input.pricing);
  const cut = [
    ...(nonJson.count > 0
      ? [`${nonJsonReason(nonJson)}: a lost line may have been a usage record`]
      : []),
    ...(!ended
      ? ["no agent_end: the run was cut, the last request's usage may be missing"]
      : []),
  ];
  const est = cut.length > 0
    ? {
      ...priced,
      cost_usd: null,
      pricing_snapshot: null,
      missing: [...cut, ...priced.missing],
    }
    : priced;

  // Termination (plan M3-01, rules 1 to 5).
  const limit = input.manifest.limits.max_budget_usd;
  const armedLimit = armed?.["limit_usd"];
  if (ended && armed === undefined) {
    streamProblems.push("budget guard not armed (no cg_budget_armed record)");
  } else if (armed !== undefined && armedLimit !== limit) {
    streamProblems.push(
      `budget guard limit ${String(armedLimit)}, manifest ${limit}`,
    );
  }
  const stop = last ? str(last["stopReason"]) : null;
  const errors = [
    last ? str(last["errorMessage"]) : null,
    ...of("auto_retry_end").map((x) => str(x.rec["finalError"])),
  ].filter((x): x is string => x !== null).join("\n");
  let termination: Termination | null;
  if (budget !== undefined) termination = "budget_exhausted";
  else if (!ended) termination = null;
  else if (armed === undefined || armedLimit !== limit) {
    termination = "setup_failed";
  } else if (stop === "stop" || stop === "length") termination = "completed";
  else termination = LIMIT_TEXT.test(errors) ? "usage_limited" : "harness_crash";

  const slugOf = (api: string) =>
    Object.hasOwn(input.pricing.models, api)
      ? input.pricing.models[api]!.slug
      : api;
  const skillNames = new Set(
    [...(systemSkills ?? "").matchAll(/<name>([^<]+)<\/name>/g)].map((x) =>
      x[1]!.trim()
    ),
  );
  const wantSkills = [
    ...new Set(
      (input.manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!),
    ),
  ];
  const loaded = systemSkills === null ? null : [
    ...(input.manifest.skills && wantSkills.length > 0 &&
        wantSkills.every((s) => skillNames.has(s))
      ? ["skills"]
      : []),
  ];
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    ["instructions", "agents", "hooks"].includes(c) ||
    c.startsWith("plugin:") || c.startsWith("lsp:") ||
    c.startsWith("mcp:") || c.startsWith("toolchain:")
  );
  return {
    telemetry: {
      harness_version: version,
      cost_usd: est.cost_usd,
      cost_source: est.cost_usd !== null ? "estimated" : null,
      pricing_snapshot: est.cost_usd !== null ? est.pricing_snapshot : null,
      reported_cost_usd: last === null ? null : reported,
      per_model: est.per_model,
      turns: ended ? of("turn_end").length : null,
      compactions: null,
      wall_ms: null,
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: null,
      raw_usage: toJson({
        usage: Object.fromEntries(models.map((m) => [m, usage.get(m)])),
        reported_cost_total: reported,
        budget: budget ?? null,
        missing: est.missing,
        stream_problems: streamProblems,
      }),
    },
    observed: {
      harness_version: version,
      models: last === null ? null : models.map(slugOf),
      loaded_components: loaded,
    },
    unobservable,
    didWork,
    termination,
    usageResetAt: null,
    imageSupport: null,
    traceEvents: trace.length,
    trace,
  };
}
```

Notes for the implementer: the `setup_failed` reason for a missing guard is only pushed when the stream ended (a cut stream before `agent_start` is the runner's call, rule 2). If the test for `pi exits 0 ... agent ended without any answer` fails because `last === null` makes `stop` null, that is the intended `harness_crash` path (rule 5).

- [ ] **Step 6: Run the tests to see them pass**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts tests/unit/harness/claude-code.test.ts`
Expected: PASS (13 pi tests; Claude Code count unchanged).

- [ ] **Step 7: Check, lint, format** (`src/harness/adapters/jsonl.ts`, `src/harness/adapters/pi.ts`, `src/harness/adapters/claude-code.ts`, `tests/unit/harness/pi.test.ts`)

Run: `deno check src/harness/adapters/pi.ts src/harness/adapters/claude-code.ts tests/unit/harness/pi.test.ts && deno lint src/harness/adapters tests/unit/harness/pi.test.ts && deno fmt src/harness/adapters/jsonl.ts src/harness/adapters/pi.ts src/harness/adapters/claude-code.ts tests/unit/harness/pi.test.ts`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/harness/adapters/jsonl.ts src/harness/adapters/pi.ts src/harness/adapters/claude-code.ts tests/unit/harness/pi.test.ts
git commit -m "feat(harness): pi stream parser, shared JSONL reader (M3-01)"
```

**Acceptance (no container):** `deno test --allow-all tests/unit/harness/pi.test.ts tests/unit/harness/claude-code.test.ts` passes; `git diff master -- src/harness/adapters/claude-code.ts` shows only the moved helpers and imports.

---

### Task M3-02: pi adapter, image, budget guard, config and probe script

The adapter object behind the contract, registered as `pi`. Budget: the contract requires `enforcesBudget` (M1-22 refuses an arm without it) and pi 0.87.1 has no budget flag, so the image loads `C:\cg-budget.ts` with `-e` (explicit `-e` paths load even with `--no-extensions`, pi `docs/cli.md`). The extension sums pi's per-message `usage.cost.total` over assistant `message_end` events, writes `cg_budget_armed` at `agent_start`, and on reaching the limit writes `cg_budget_exhausted` and shuts pi down. A message with output tokens and a zero or missing cost means pi cannot price the model: the guard fails closed (writes `cg_budget_exhausted` with `reason: "unpriced"`). pi's cost is only the guard; the recorded cost is the host estimate.

`run.ps1` settings: `--mode json --no-session --offline --no-approve --no-extensions -e C:\cg-budget.ts --provider openrouter --model <api id>`; `--thinking` from `settings.thinking` when set; instructions via `--append-system-prompt <file>`; skills via `--no-skills --skill C:\config\bundle\skills` (explicit path, so the workspace stays untouched by setup, as in M1-32); the prompt on stdin (pi prepends piped stdin to the first prompt, `docs/cli.md`); `PI_OFFLINE=1`; the key in `OPENROUTER_API_KEY` read from the secrets file. The first stdout line is `cg_entry` with `pi --version` output.

**Lane:** infra. **Deps:** M3-01, M1-20 (`runSandbox` for the probe script). **Date:** 10-03.

**Files:**
- Modify: `src/harness/adapters/pi.ts` (adapter object), `src/harness/adapters/mod.ts` (register)
- Create: `harness/images/pi/Dockerfile.windows`, `harness/images/pi/run.ps1`, `harness/images/pi/cg-budget.ts`, `harness/configs/pi-flash-plain.yml`, `scripts/harness/pi-probe.ts`
- Test: `tests/unit/harness/pi.test.ts` (append)

**Interfaces:**
- Consumes: `parsePiStream`, `PI_ROUTE`, `PI_PROVIDER` (M3-01); `writeTrace`; `HarnessAdapter`; `Catalog`.
- Produces: `piAdapter: HarnessAdapter` (harness `pi`, `secretFiles: ["openrouter-api-key"]`, `credentialBearing: true`, `enforcesBudget: true`, declared `harness_version`, `cost_usd`, `reported_cost_usd`, `per_model`, `turns`, `exit_code`, `stop_reason`); `nativeSettings` returns `{ ...config.settings, provider: "openrouter", api_models: { main } }`; `providerRoutes` returns `{ main: "openrouter:api-key" }`; from `cg-budget.ts`: `budgetStep(spent: number, message: unknown): { spent: number; unpriced: boolean }` and the default extension factory; config `pi-flash-plain`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/pi.test.ts`; merge imports into the import block)

```typescript
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { piAdapter } from "../../../src/harness/adapters/pi.ts";
import { checkModelsInCatalog, HarnessConfigSchema, loadConfig } from "../../../src/harness/config.ts";
import { budgetStep } from "../../../harness/images/pi/cg-budget.ts";

const CATALOG = {
  models: [
    { slug: "openrouter/google/gemini-3.8-flash", api_model_id: "google/gemini-3.8-flash", family: "gemini", display_name: "F" },
    { slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" },
  ],
  pricing: [],
  families: [],
};
const CFG = HarnessConfigSchema.parse({
  id: "pi", harness: "pi", harness_version: "0.87.1",
  models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: {}, limits: { timeout_min: 30, max_budget_usd: 2 },
});

Deno.test("pi adapter: registered; contract fields; parse writes the trace", async () => {
  assertEquals(adapterFor("pi"), piAdapter);
  assertEquals([piAdapter.credentialBearing, piAdapter.enforcesBudget], [true, true]);
  assertEquals(piAdapter.secretFiles, ["openrouter-api-key"]);
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), HEAD + await Deno.readTextFile(FIXTURE));
  const r = await piAdapter.parse({
    rawLog: join(dir, "raw.jsonl"), exitCode: 0, manifest: pm(), pricing: BOOK, traceOut: join(dir, "trace.jsonl"),
  });
  assertEquals(r.traceEvents, 4);
  assertEquals((await Deno.readTextFile(join(dir, "trace.jsonl"))).trim().split("\n").length, 4);
  const missing = await piAdapter.parse({
    rawLog: join(dir, "absent.jsonl"), exitCode: null, manifest: pm(), pricing: BOOK, traceOut: join(dir, "t2.jsonl"),
  });
  assertEquals(missing.termination, null);
  assertStringIncludes(JSON.stringify(missing.telemetry.raw_usage), "raw log missing");
});

Deno.test("pi adapter: settings from the catalog; one openrouter model; unsupported components refused", () => {
  assertEquals(piAdapter.nativeSettings(CFG, CATALOG), {
    provider: "openrouter",
    api_models: { main: "google/gemini-3.8-flash" },
  });
  assertEquals(piAdapter.providerRoutes(CFG), { main: "openrouter:api-key" });
  assertEquals(piAdapter.nativeSettings({ ...CFG, settings: { thinking: "high" } }, CATALOG)["thinking"], "high");
  const bad: [Partial<typeof CFG>, string][] = [
    [{ models: { main: "anthropic/claude-sonnet-5" } }, "openrouter"],
    [{ models: { main: "openrouter/google/nope" } }, "catalog"],
    [{ models: { main: "openrouter/google/gemini-3.8-flash", small: "openrouter/google/gemini-3.8-flash" } }, "one model slot"],
    [{ components: { ...CFG.components, mcp: ["al-tools"] } }, "no MCP"],
    [{ components: { ...CFG.components, agents: "bundles/a" } }, "agents"],
    [{ settings: { reasoning: "high" } }, "unknown setting reasoning"],
    [{ settings: { thinking: "huge" } }, "thinking"],
  ];
  for (const [over, msg] of bad) {
    assertThrows(() => piAdapter.nativeSettings({ ...CFG, ...over }, CATALOG), ConfigurationError, msg);
  }
});

Deno.test("run.ps1: the key travels by file and env only; the image pins pi 0.87.1", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  assert(!run.includes("--api-key"), "never argv");
  assertStringIncludes(run, "$env:OPENROUTER_API_KEY = (Get-Content 'C:\\cg-secrets\\openrouter-api-key' -Raw -Encoding UTF8).Trim()");
  const docker = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(docker, "@earendil-works/pi-coding-agent@0.87.1");
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(docker), "no secret path or value in a layer");
  assertStringIncludes(docker, "COPY cg-budget.ts C:/cg-budget.ts");
});

Deno.test("run.ps1: loads the budget guard explicitly, JSON mode, offline, prompt on stdin, cg_entry first", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  for (const s of [
    "'--mode', 'json'", "'--no-session'", "'--offline'", "'--no-approve'", "'--no-extensions'", "'-e', 'C:\\cg-budget.ts'",
    "$env:CG_MAX_BUDGET_USD", "$env:PI_OFFLINE = '1'", "type = 'cg_entry'", "| & pi @piArgs", "'--append-system-prompt'",
    "'--no-skills', '--skill', 'C:\\config\\bundle\\skills'", "-Encoding UTF8",
  ]) assertStringIncludes(run, s);
  assert(run.indexOf("type = 'cg_entry'") < run.indexOf("| & pi @piArgs"));
});

Deno.test("cg-budget: sums assistant cost, ignores other roles, fails closed on unpriced output", () => {
  const a = (total: unknown, output = 10) => ({ role: "assistant", usage: { output, cost: { total } } });
  assertEquals(budgetStep(0, a(0.5)), { spent: 0.5, unpriced: false });
  assertEquals(budgetStep(0.5, { role: "toolResult", usage: { cost: { total: 9 } } }), { spent: 0.5, unpriced: false });
  assertEquals(budgetStep(0, a(0, 0)), { spent: 0, unpriced: false }, "an empty error message costs nothing");
  assertEquals(budgetStep(0, a(0)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(undefined)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(-1)), { spent: 0, unpriced: true });
});

Deno.test("pi-flash-plain: loads and passes the catalog check", async () => {
  const cfg = await loadConfig("harness", "pi-flash-plain");
  await checkModelsInCatalog([cfg], "site/catalog");
  assertEquals(cfg.harness, piAdapter.harness);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts`
Expected: FAIL, `piAdapter` not exported / `harness/images/pi/cg-budget.ts` not found.

- [ ] **Step 3: Implement**

Append to `src/harness/adapters/pi.ts` (merge imports: `import type { HarnessAdapter } from "../adapter.ts";`, `import { ConfigurationError } from "../../errors.ts";`, `import { writeTrace } from "../trace.ts";`):

```typescript
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const piAdapter: HarnessAdapter = {
  harness: "pi",
  declared: [
    "harness_version",
    "cost_usd",
    "reported_cost_usd",
    "per_model",
    "turns",
    "exit_code",
    "stop_reason",
  ],
  secretFiles: ["openrouter-api-key"],
  credentialBearing: true,
  enforcesBudget: true,
  nativeSettings(config, catalog) {
    const c = config.components;
    const unsupported = [
      ...(c.mcp.length > 0 ? ["mcp"] : []),
      ...(c.lsp.length > 0 ? ["lsp"] : []),
      ...(c.agents !== null ? ["agents"] : []),
      ...(c.hooks !== null ? ["hooks"] : []),
      ...(c.plugins.length > 0 ? ["plugins"] : []),
    ];
    if (unsupported.length > 0) {
      throw new ConfigurationError(
        `${config.id}: pi 0.87.1 has no MCP and supports only instructions, skills and toolchain (refused: ${
          unsupported.join(", ")
        })`,
      );
    }
    const slots = Object.keys(config.models);
    if (slots.length !== 1 || slots[0] !== "main") {
      throw new ConfigurationError(
        `${config.id}: pi takes exactly one model slot, main (got ${slots.join(", ")})`,
      );
    }
    const slug = config.models["main"]!;
    if (!slug.startsWith(`${PI_PROVIDER}/`)) {
      throw new ConfigurationError(
        `${config.id}: pi runs through ${PI_PROVIDER}; ${slug} is not an ${PI_PROVIDER}/ slug`,
      );
    }
    const m = catalog.models.find((x) => x.slug === slug);
    if (!m) {
      throw new ConfigurationError(`model ${slug} (slot main) is not in the catalog`);
    }
    for (const k of Object.keys(config.settings)) {
      if (k !== "thinking") {
        throw new ConfigurationError(`${config.id}: unknown setting ${k} for pi (known: thinking)`);
      }
    }
    const t = config.settings["thinking"];
    if (t !== undefined && !(typeof t === "string" && THINKING.has(t))) {
      throw new ConfigurationError(
        `${config.id}: thinking must be one of ${[...THINKING].join(", ")}`,
      );
    }
    return {
      ...config.settings,
      provider: PI_PROVIDER,
      api_models: { main: m.api_model_id },
    };
  },
  providerRoutes(config) {
    return Object.fromEntries(
      Object.keys(config.models).map((slot) => [slot, PI_ROUTE]),
    );
  },
  extraMounts: () => Promise.resolve([]),
  async parse(input) {
    let text = "";
    const problems: string[] = [];
    try {
      text = await Deno.readTextFile(input.rawLog);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      problems.push(`${input.rawLog}: raw log missing`);
    }
    const { trace, ...parsed } = parsePiStream(text, input, problems);
    await writeTrace(input.traceOut, trace);
    return parsed;
  },
};
```

`src/harness/adapters/mod.ts`: `import { piAdapter } from "./pi.ts";` and add `pi: piAdapter,` to `ADAPTERS`; update the header comment to "(M1-32 adds claude-code, M3-02 adds pi, M1-35 adds mock)".

`harness/images/pi/cg-budget.ts`:

```typescript
// Budget guard for pi 0.87.1 (adapter contract enforcesBudget; pi has no
// budget flag). Loaded by run.ps1 with `-e C:\cg-budget.ts`. Sums pi's own
// per-message cost over assistant message_end events. Writes one
// cg_budget_armed JSON line at agent_start and one cg_budget_exhausted line
// when the limit is reached or pi cannot price the model (fails closed),
// then shuts pi down. The recorded cost is the host's list-price estimate;
// this is only the guard. No imports: the image has no package for types.

interface Msg {
  role?: unknown;
  usage?: { output?: unknown; cost?: { total?: unknown } };
}
interface Ctx {
  shutdown(): void;
}
interface Api {
  on(event: "agent_start", h: (e: unknown, ctx: Ctx) => void): void;
  on(event: "message_end", h: (e: { message: Msg }, ctx: Ctx) => void): void;
}
/** Node's process, typed locally (no @types in the image; Deno tests never call the factory). */
interface Proc {
  env: Record<string, string | undefined>;
  stdout: { write(s: string): void };
}

export function budgetStep(
  spent: number,
  message: unknown,
): { spent: number; unpriced: boolean } {
  const m = (message ?? {}) as Msg;
  if (m.role !== "assistant") return { spent, unpriced: false };
  const out = m.usage?.output;
  const total = m.usage?.cost?.total;
  const produced = typeof out === "number" && out > 0;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return { spent, unpriced: produced || total !== undefined };
  }
  if (produced && total === 0) return { spent, unpriced: true };
  return { spent: spent + total, unpriced: false };
}

export default function (pi: Api): void {
  const process = (globalThis as unknown as { process: Proc }).process;
  const limit = Number(process.env["CG_MAX_BUDGET_USD"]);
  if (!(Number.isFinite(limit) && limit > 0)) {
    throw new Error("CG_MAX_BUDGET_USD must be a positive number");
  }
  const line = (o: Record<string, unknown>) =>
    process.stdout.write(JSON.stringify(o) + "\n");
  let spent = 0;
  let done = false;
  pi.on("agent_start", () => line({ type: "cg_budget_armed", limit_usd: limit }));
  pi.on("message_end", (e, ctx) => {
    if (done) return;
    const s = budgetStep(spent, e.message);
    spent = s.spent;
    if (s.unpriced || spent >= limit) {
      done = true;
      line({
        type: "cg_budget_exhausted",
        spent_usd: spent,
        limit_usd: limit,
        reason: s.unpriced ? "unpriced" : "limit",
      });
      ctx.shutdown();
    }
  });
}
```

Note: `budgetStep(0, a(undefined))` with output 10 must give `unpriced: true` (the `produced || total !== undefined` branch); `budgetStep(0, a(0, 0))` gives `unpriced: false` (no output, zero cost). If `pi.on("agent_start")` fires more than once per run (retries), `only()` in the parser refuses the second `cg_budget_armed`; guard it with a `let armed = false` flag in the same edit if M3-04 shows repeats.

`harness/images/pi/Dockerfile.windows`:

```dockerfile
# pi harness image. Built by `harness images build pi --version 0.87.1`.
# BASE has no default: `harness images build` passes the inspected immutable base image and
# verifies the layers (M1-24). Node 22.19.0 comes from the base (pi 0.87.1 engines, findings section 3).
# No secret is ever copied into a layer: the provider key arrives as a file at run time.
ARG BASE
FROM ${BASE}
RUN $env:PATH = 'C:\Program Files\nodejs;' + $env:PATH; \
    npm install -g @earendil-works/pi-coding-agent@0.87.1; \
    [Environment]::SetEnvironmentVariable('PATH', (npm config get prefix) + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)
COPY run.ps1 C:/run.ps1
COPY cg-budget.ts C:/cg-budget.ts
CMD ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\run.ps1"]
```

(The test's `!/OPENROUTER|api-key|cg-secrets/i` check forbids those words anywhere in the Dockerfile, comments included.)

`harness/images/pi/run.ps1`:

```powershell
# pi entrypoint (spec 1a section 5 item 3; findings sections 3 and 4). Reads
# C:\config, runs pi 0.87.1 in JSON mode with the prompt on stdin, streams
# JSONL to stdout. The first stdout line is our cg_entry record. The
# OpenRouter key goes from the read-only secrets mount into pi's env only
# (never --api-key). The budget guard is loaded explicitly with -e.
# Windows PowerShell 5.1: every text read names UTF-8.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$global:OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$cfg = Get-Content 'C:\config\settings.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$version = (& pi --version | Out-String).Trim()
$entry = @{ type = 'cg_entry'; pi_version = $version; max_budget_usd = [double]$cfg.limits.max_budget_usd }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $entry -Compress))
$piArgs = @('--mode', 'json', '--no-session', '--offline', '--no-approve', '--no-extensions', '-e', 'C:\cg-budget.ts',
  '--provider', $cfg.settings.provider, '--model', $cfg.settings.api_models.main)
if ($cfg.settings.thinking) { $piArgs += @('--thinking', $cfg.settings.thinking) }
if (Test-Path 'C:\config\bundle\instructions') {
  $instructions = @(Get-ChildItem 'C:\config\bundle\instructions' -File)
  if ($instructions.Count -ne 1) { throw "bundle instructions must hold exactly one file, found $($instructions.Count)" }
  $piArgs += @('--append-system-prompt', $instructions[0].FullName)
}
if (Test-Path 'C:\config\bundle\skills') { $piArgs += @('--no-skills', '--skill', 'C:\config\bundle\skills') }
$env:OPENROUTER_API_KEY = (Get-Content 'C:\cg-secrets\openrouter-api-key' -Raw -Encoding UTF8).Trim()
$env:CG_MAX_BUDGET_USD = [string]$cfg.limits.max_budget_usd
$env:PI_OFFLINE = '1'
Set-Location C:\workspace
Get-Content 'C:\task\prompt.md' -Raw -Encoding UTF8 | & pi @piArgs
exit $LASTEXITCODE
```

`harness/configs/pi-flash-plain.yml`:

```yaml
id: pi-flash-plain
harness: pi
harness_version: "0.87.1"
models:
  main: openrouter/google/gemini-3.8-flash
settings: {}
components:
  instructions: bundles/env/instructions
limits: { timeout_min: 30, max_budget_usd: 2 }
```

`scripts/harness/pi-probe.ts` (ops helper for M3-04; `deno check` only, no unit test: every branch runs a container):

```typescript
// Usage: deno run --allow-all scripts/harness/pi-probe.ts <image-id> <out-dir> [--proxy-log] [--skills <dir>] [--instructions <dir>]
// Runs the pi image once with a FAKE OpenRouter key (no credential, no spend) and prints what the
// parser makes of it. --proxy-log points HTTPS_PROXY at a host listener that logs each request line
// and answers 403, which shows whether pi honors the proxy and which hosts it contacts.
import { parseArgs } from "@std/cli/parse-args";
import { copy } from "@std/fs/copy";
import { join } from "@std/path";
import { parsePiStream } from "../../src/harness/adapters/pi.ts";
import { resolveBackendHost } from "../../src/harness/backend.ts";
import { ResolvedManifestSchema } from "../../src/harness/manifest.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { realDocker, runSandbox } from "../../src/harness/sandbox.ts";

const a = parseArgs(Deno.args, { boolean: ["proxy-log"], string: ["skills", "instructions"] });
const [imageId, outArg] = a._.map(String);
if (!imageId || !outArg) throw new Error("usage: pi-probe.ts <image-id> <out-dir>");
await Deno.mkdir(outArg, { recursive: true });
const out = await Deno.realPath(outArg);
const dirs = Object.fromEntries(
  await Promise.all(["workspace", "task", "config", "secrets"].map(async (d) => {
    await Deno.mkdir(join(out, d), { recursive: true });
    return [d, join(out, d)] as const;
  })),
);
const FAKE = "sk-or-v1-cgprobe" + "0".repeat(48);
await Deno.writeTextFile(join(dirs.secrets!, "openrouter-api-key"), FAKE);
await Deno.writeTextFile(join(dirs.task!, "prompt.md"), "Reply with the single word ok.\n");
if (a.skills) await copy(a.skills, join(dirs.config!, "bundle", "skills"));
if (a.instructions) await copy(a.instructions, join(dirs.config!, "bundle", "instructions"));
await Deno.writeTextFile(join(dirs.config!, "settings.json"), JSON.stringify({
  harness: "pi", harness_version: "0.87.1", models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: { provider: "openrouter", api_models: { main: "google/gemini-3.8-flash" } },
  limits: { timeout_min: 5, max_budget_usd: 0.05 }, toolchain: [],
}));
const env: Record<string, string> = {};
let listener: Deno.Listener | undefined;
if (a["proxy-log"]) {
  const host = await resolveBackendHost();
  listener = Deno.listen({ hostname: host, port: 3999 });
  env["HTTPS_PROXY"] = env["HTTP_PROXY"] = `http://${host}:3999`;
  (async () => {
    for await (const c of listener!) {
      const buf = new Uint8Array(1024);
      const n = (await c.read(buf)) ?? 0;
      const first = new TextDecoder().decode(buf.subarray(0, n)).split("\r\n")[0];
      await Deno.writeTextFile(join(out, "proxy.log"), `${first}\n`, { append: true });
      await c.write(new TextEncoder().encode("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
      c.close();
    }
  })().catch(() => {});
}
const id = crypto.randomUUID();
const res = await runSandbox(realDocker(), {
  name: `cg-harness-probe-${id}`, owner: Deno.hostname(), executionId: id, imageId,
  workspace: dirs.workspace!, taskDir: dirs.task!, configDir: dirs.config!, secretsDir: dirs.secrets!,
  extraMounts: [], env, timeoutMs: 180_000, killGraceMs: 30_000, opTimeoutMs: 60_000,
  maxCaptureBytes: 16 * 1024 * 1024, rawLog: join(out, "raw.jsonl"), stderrLog: join(out, "stderr.txt"),
}, [FAKE]);
listener?.close();
const m = ResolvedManifestSchema.parse({
  v: 1, rules: "probe", config_id: "pi-probe", harness: "pi", harness_version: "0.87.1",
  models: { main: "openrouter/google/gemini-3.8-flash" }, settings: { requested: {}, native: {} },
  limits: { timeout_min: 5, max_budget_usd: 0.05 }, instructions: null, skills: null, agents: null, hooks: null,
  plugins: [], mcp: [], lsp: [], toolchain: [], image: { digest: imageId, base_digest: "probe" },
  backend_version: "probe", provider_routes: { main: "openrouter:api-key" },
});
const r = parsePiStream(await Deno.readTextFile(join(out, "raw.jsonl")), {
  rawLog: join(out, "raw.jsonl"), exitCode: res.exitCode, manifest: m,
  pricing: await loadPricingBook("site/catalog", new Date()),
});
console.log(JSON.stringify({ sandbox: res, termination: r.termination, didWork: r.didWork, observed: r.observed, telemetry: r.telemetry }, null, 2));
```

If `@std/cli` or `@std/fs` is missing from `deno.json` imports, use the ones the repo already maps (check `deno.json` `imports` first; do not add a dependency for this script: replace `copy` with `Deno.copyFile` over a `Deno.readDir` loop if `@std/fs` is absent).

- [ ] **Step 4: Run to see it pass**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 5: Check, lint, format**

Run: `deno check src/harness/adapters/pi.ts src/harness/adapters/mod.ts harness/images/pi/cg-budget.ts scripts/harness/pi-probe.ts tests/unit/harness/pi.test.ts && deno lint src/harness/adapters harness/images/pi scripts/harness/pi-probe.ts tests/unit/harness/pi.test.ts && deno fmt src/harness/adapters/pi.ts src/harness/adapters/mod.ts harness/images/pi/cg-budget.ts scripts/harness/pi-probe.ts tests/unit/harness/pi.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/harness/adapters/pi.ts src/harness/adapters/mod.ts harness/images/pi harness/configs/pi-flash-plain.yml scripts/harness/pi-probe.ts tests/unit/harness/pi.test.ts
git commit -m "feat(harness): pi adapter, image with budget guard, pi-flash-plain config (M3-02)"
```

**Acceptance (no container):** `deno test --allow-all tests/unit/harness/pi.test.ts tests/unit/harness/claude-code.test.ts` passes; `grep -rn -- "--api-key" harness/images/pi` prints nothing; `deno check scripts/harness/pi-probe.ts` is clean.

---

### Task M3-03: al-tools MCP component (Claude Code)

Spec 1a D5 and section 5 item 4: "Our al-tools MCP is an optional, named component on the backend"; the token allows only compile, test and symbol lookup on its own workspace. So the MCP server is a front end to the same `cg-al` backend, never to BC: a dependency-free stdio MCP server (newline-delimited JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`) in the base image, started by Claude Code through an `mcp.json` that `run.ps1` writes when `settings.mcp` names it. The tool list lives in one JSON file, read by the server at run time and hashed by `harness images build base` into the image label `centralgauge.mcp.al-tools` = `<version> <sha256>`, which child images inherit; `imageFacts` reads it and `runtimeFacts` fills `RuntimeFacts.servers` from the image (what is in the image is what the manifest records). pi refuses MCP (M3-02).

**Lane:** infra. **Deps:** M1-19 (backend protocol, `cg-al.ps1`), M1-24 (`src/harness/images.ts`, `harnessImagesBuild`). **Date:** 10-05.

**Files:**
- Create: `harness/images/base/al-tools-mcp.mjs`, `harness/images/base/al-tools-tools.json`
- Modify: `harness/images/base/Dockerfile.windows` (two `COPY` lines), `src/harness/images.ts` (`IMAGE_LABELS.mcpPrefix`, `ImageFacts.mcp?`, `imageFacts`, `runtimeFacts`), `cli/commands/harness-command.ts` (`harnessImagesBuild("base")` adds the label), `src/harness/adapters/claude-code.ts` (`nativeSettings` adds `mcp` when non-empty), `harness/images/claude-code/run.ps1` (writes `mcp.json`, passes `--mcp-config ... --strict-mcp-config`)
- Test: `tests/unit/harness/al-tools-mcp.test.ts` (new), `tests/unit/harness/images.test.ts` (modify the M1-24 MCP refusal test), `tests/unit/harness/claude-code.test.ts` (append)

**Interfaces:**
- Consumes: backend `POST /v1/{compile,test,symbols}` with `Authorization: Bearer <token>`, `X-CG-Execution`, body `{ apps }` / `{ codeunits }` / `{}` (M1-19); `hashJson`.
- Produces: `AL_TOOLS_DEF = "harness/images/base/al-tools-tools.json"` (constant in `images.ts`); `IMAGE_LABELS.mcpPrefix = "centralgauge.mcp."`; `interface ImageFacts { ...; mcp?: Record<string, { version: string; tool_schema_hash: string }> }`; `mcpLabel(root: string): Promise<[string, string]>` (label key and value); tools `al_compile { apps?: string[] }`, `al_test { codeunits?: number[] }`, `al_symbols {}`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/al-tools-mcp.test.ts`:

```typescript
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

const DEF = "harness/images/base/al-tools-tools.json";
const TOKEN = "t".repeat(32);

async function server(handler: (req: Request) => Response | Promise<Response>) {
  const calls: { path: string; auth: string | null; exec: string | null; body: string }[] = [];
  const backend = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    calls.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), exec: req.headers.get("x-cg-execution"), body: await req.text() });
    return handler(req);
  });
  const secrets = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(secrets, "backend-token"), TOKEN + "\n");
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", "--allow-net", "harness/images/base/al-tools-mcp.mjs"],
    env: { CG_AL_TOOLS_DEF: DEF, CG_SECRETS_DIR: secrets, CG_BACKEND_URL: `http://127.0.0.1:${backend.addr.port}`, CG_EXECUTION_ID: "exec-1" },
    stdin: "piped", stdout: "piped", stderr: "piped",
  }).spawn();
  return { backend, child, calls };
}

async function converse(msgs: unknown[], handler: (req: Request) => Response) {
  const s = await server(handler);
  const w = s.child.stdin.getWriter();
  await w.write(new TextEncoder().encode(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n"));
  await w.close();
  const out = await s.child.output();
  await s.backend.shutdown();
  const replies = new TextDecoder().decode(out.stdout).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { replies: new Map(replies.map((r) => [r.id, r])), calls: s.calls, count: replies.length };
}

Deno.test("al-tools MCP: initialize, tools/list from the definition file, notifications get no reply", async () => {
  const def = JSON.parse(await Deno.readTextFile(DEF));
  const { replies, count } = await converse([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "ping" },
    { jsonrpc: "2.0", id: 4, method: "resources/list" },
  ], () => new Response("{}"));
  assertEquals(count, 4);
  assertEquals(replies.get(1).result.serverInfo, { name: "al-tools", version: def.version });
  assertEquals(replies.get(1).result.protocolVersion, "2025-06-18");
  assertEquals(replies.get(2).result.tools, def.tools);
  assertEquals(replies.get(3).result, {});
  assertEquals(replies.get(4).error.code, -32601);
});

Deno.test("al-tools MCP: calls go to the backend with the file token and the execution id", async () => {
  const { replies, calls } = await converse([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "al_compile", arguments: { apps: ["Core"] } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "al_test", arguments: { codeunits: [80001] } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "al_symbols", arguments: {} } },
  ], (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/v1/compile") return new Response(JSON.stringify({ ok: true, apps: [] }));
    if (p === "/v1/test") return new Response(JSON.stringify({ ok: false, failed: 1 }));
    return new Response("unauthorized", { status: 401 });
  });
  assertEquals(calls.map((c) => [c.path, c.auth, c.exec, c.body]).sort(), [
    ["/v1/compile", `Bearer ${TOKEN}`, "exec-1", '{"apps":["Core"]}'],
    ["/v1/symbols", `Bearer ${TOKEN}`, "exec-1", "{}"],
    ["/v1/test", `Bearer ${TOKEN}`, "exec-1", '{"codeunits":[80001]}'],
  ]);
  assertEquals(replies.get(1).result.isError, false);
  assertEquals(JSON.parse(replies.get(1).result.content[0].text), { op: "compile", status: 200, result: { ok: true, apps: [] } });
  assertEquals(replies.get(2).result.isError, true, "a failed test run is a tool error");
  assertEquals(replies.get(3).result.isError, true, "401 is a tool error");
});

Deno.test("al-tools MCP: unknown tool and an unreachable backend are tool errors, never a crash", async () => {
  const { replies } = await converse([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "al_oracle", arguments: {} } },
  ], () => new Response("{}"));
  assertEquals(replies.get(1).result.isError, true);
  const s = await server(() => new Response("{}"));
  await s.backend.shutdown(); // backend gone before the call
  const w = s.child.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "al_compile", arguments: {} } }) + "\n"));
  await w.close();
  const out = await s.child.output();
  const r = JSON.parse(new TextDecoder().decode(out.stdout).trim());
  assertEquals(r.result.isError, true);
  assert(!new TextDecoder().decode(out.stdout).includes(TOKEN), "the token never reaches stdout");
});
```

Replace the M1-24 test `runtimeFacts: native settings from the catalog; MCP and LSP refused until M2` in `tests/unit/harness/images.test.ts` with:

```typescript
Deno.test("runtimeFacts: MCP facts come from the image label; LSP and unknown MCP refused", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = { digest: ID, base_digest: BASE, harness: "claude-code", version: "2.1.282" };
  const f = runtimeFacts(cfg, image, claudeCodeAdapter, catalog);
  assertEquals([f.image.digest, f.backend_version, f.provider_routes.main, f.servers], [ID, "cg-al-backend@1", "anthropic:first-party-oauth", {}]);
  const withMcp = { ...cfg, components: { ...cfg.components, mcp: ["al-tools"] } };
  assertThrows(() => runtimeFacts(withMcp, image, claudeCodeAdapter, catalog), ConfigurationError, "no MCP component al-tools");
  const mcp = { "al-tools": { version: "al-tools-mcp@1", tool_schema_hash: "h".repeat(64) } };
  assertEquals(runtimeFacts(withMcp, { ...image, mcp }, claudeCodeAdapter, catalog).servers, mcp);
  assertThrows(() => runtimeFacts({ ...cfg, components: { ...cfg.components, lsp: ["al-lsp"] } }, image, claudeCodeAdapter, catalog), ConfigurationError, "LSP");
  assertThrows(() => runtimeFacts(cfg, { ...image, version: "2.1.281" }, claudeCodeAdapter, catalog), ConfigurationError, "2.1.281");
  const d = new FakeDocker();
  const [key, value] = await mcpLabel(".");
  assertEquals(key, "centralgauge.mcp.al-tools");
  d.addImage("x", ID, { ...LABELS, [key]: value });
  assertEquals(Object.keys((await imageFacts(d, "x")).mcp ?? {}), ["al-tools"]);
  d.addImage("y", `sha256:${"d".repeat(64)}`, { ...LABELS, "centralgauge.mcp.al-tools": "only-one-part" });
  await assertRejects(() => imageFacts(d, "y"), ConfigurationError, "centralgauge.mcp.al-tools");
});
```

(add `mcpLabel` to that file's `images.ts` import.)

Append to `tests/unit/harness/claude-code.test.ts`:

```typescript
Deno.test("claude-code MCP: settings carry the MCP list; run.ps1 writes mcp.json with the backend env", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, components: { mcp: ["al-tools"] }, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = { models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }], pricing: [], families: [] };
  assertEquals(claudeCodeAdapter.nativeSettings(cfg, catalog)["mcp"], ["al-tools"]);
  assertEquals(claudeCodeAdapter.nativeSettings({ ...cfg, components: { ...cfg.components, mcp: [] } }, catalog)["mcp"], undefined, "no key without MCP: plain arms keep their hash");
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  for (const s of ["'--mcp-config'", "'--strict-mcp-config'", "C:\\al-tools-mcp.mjs", "CG_BACKEND_URL = $env:CG_BACKEND_URL", "CG_EXECUTION_ID = $env:CG_EXECUTION_ID"]) {
    assertStringIncludes(run, s);
  }
  const base = await Deno.readTextFile("harness/images/base/Dockerfile.windows");
  assertStringIncludes(base, "COPY al-tools-mcp.mjs C:/al-tools-mcp.mjs");
  assertStringIncludes(base, "COPY al-tools-tools.json C:/al-tools-tools.json");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `deno test --allow-all tests/unit/harness/al-tools-mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/claude-code.test.ts`
Expected: FAIL (server file missing, `mcpLabel` not exported, `mcp` not in settings).

- [ ] **Step 3: Implement**

`harness/images/base/al-tools-tools.json`:

```json
{
  "version": "al-tools-mcp@1",
  "tools": [
    {
      "name": "al_compile",
      "description": "Compile AL apps in the workspace on the benchmark backend and return the diagnostics per app.",
      "inputSchema": {
        "type": "object",
        "properties": { "apps": { "type": "array", "items": { "type": "string" }, "description": "App folder names; empty compiles every app." } },
        "additionalProperties": false
      }
    },
    {
      "name": "al_test",
      "description": "Publish the workspace apps to a Business Central server and run test codeunits; returns per-test results.",
      "inputSchema": {
        "type": "object",
        "properties": { "codeunits": { "type": "array", "items": { "type": "integer" }, "description": "Test codeunit ids; empty runs every test codeunit." } },
        "additionalProperties": false
      }
    },
    {
      "name": "al_symbols",
      "description": "List the symbol packages available to the workspace.",
      "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
    }
  ]
}
```

`harness/images/base/al-tools-mcp.mjs`:

```javascript
// al-tools MCP server (spec 1a D5, section 5 item 4): a stdio front end to the
// same cg-al backend, never to BC. Newline-delimited JSON-RPC 2.0. The token
// is read from a file (never argv, never env); CG_BACKEND_URL and
// CG_EXECUTION_ID are the runner's non-secret env. Runs under Node (image)
// and Deno (unit tests): node: built-ins and fetch only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const DEF = JSON.parse(readFileSync(process.env.CG_AL_TOOLS_DEF ?? "C:\\al-tools-tools.json", "utf8"));
const OPS = { al_compile: "compile", al_test: "test", al_symbols: "symbols" };
const SECRETS = process.env.CG_SECRETS_DIR ?? "C:\\cg-secrets";

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const text = (o, isError) => ({ content: [{ type: "text", text: JSON.stringify(o) }], isError });

async function call(name, args) {
  const op = Object.hasOwn(OPS, name) && DEF.tools.some((t) => t.name === name) ? OPS[name] : null;
  if (op === null) return text({ error: `unknown tool ${name}` }, true);
  const a = args ?? {};
  const body = op === "compile"
    ? { apps: (Array.isArray(a.apps) ? a.apps : []).map(String) }
    : op === "test"
    ? { codeunits: (Array.isArray(a.codeunits) ? a.codeunits : []).map(Number) }
    : {};
  let status = 0;
  let raw = "";
  try {
    const token = readFileSync(join(SECRETS, "backend-token"), "utf8").trim();
    const r = await fetch(`${process.env.CG_BACKEND_URL}/v1/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-cg-execution": process.env.CG_EXECUTION_ID ?? "", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_800_000),
    });
    status = r.status;
    raw = await r.text();
  } catch (e) {
    raw = JSON.stringify({ error: `backend unreachable: ${e?.name ?? "error"}` });
  }
  let result = raw;
  try {
    result = JSON.parse(raw);
  } catch { /* not JSON: returned as text */ }
  const ok = status === 200 && result !== null && typeof result === "object" && result.ok === true;
  return text({ op, status, result }, !ok);
}

async function handle(msg) {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return; // notification
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "al-tools", version: DEF.version },
    } });
  }
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: DEF.tools } });
  if (method === "tools/call") return send({ jsonrpc: "2.0", id, result: await call(params?.name, params?.arguments) });
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

const pending = new Set();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim() === "") return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  const p = handle(msg).catch(() => send({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32603, message: "internal error" } }));
  pending.add(p);
  p.finally(() => pending.delete(p));
});
// No process.exit: it can cut buffered stdout. The process ends when stdin
// closes and the last reply is written.
rl.on("close", async () => {
  await Promise.all([...pending]);
  process.exitCode = 0;
});
```

(The error text for an unreachable backend carries only the error name, never the message: a fetch error message can echo the URL and headers.)

`harness/images/base/Dockerfile.windows`: append after the `cg-al` lines:

```dockerfile
COPY al-tools-mcp.mjs C:/al-tools-mcp.mjs
COPY al-tools-tools.json C:/al-tools-tools.json
```

`src/harness/images.ts` (M1-24 file): add `mcpPrefix: "centralgauge.mcp."` to `IMAGE_LABELS` **as a separate constant** `MCP_LABEL_PREFIX = "centralgauge.mcp."` (the required-label check iterates `Object.values(IMAGE_LABELS)`, so the prefix must not join that object); add to `ImageFacts` `mcp?: Record<string, { version: string; tool_schema_hash: string }>;`; in `imageFacts`, after the missing-label check:

```typescript
  const mcp: NonNullable<ImageFacts["mcp"]> = {};
  for (const [k, v] of Object.entries(l)) {
    if (!k.startsWith(MCP_LABEL_PREFIX)) continue;
    const [version, hash, ...rest] = v.split(" ");
    if (!version || !hash || rest.length > 0) {
      throw new ConfigurationError(`image ${ref}: label ${k} must be "<version> <sha256>", got "${v}"`);
    }
    mcp[k.slice(MCP_LABEL_PREFIX.length)] = { version, tool_schema_hash: hash };
  }
  return { digest: img.Id, base_digest: l[IMAGE_LABELS.base]!, harness: l[IMAGE_LABELS.harness]!, version: l[IMAGE_LABELS.version]!, mcp };
```

and add:

```typescript
export const AL_TOOLS_DEF = "harness/images/base/al-tools-tools.json";

/** The base image's al-tools label: the tool definition's version and its canonical hash. */
export async function mcpLabel(root: string): Promise<[string, string]> {
  const def = JSON.parse(await Deno.readTextFile(join(root, AL_TOOLS_DEF))) as { version?: unknown };
  if (typeof def.version !== "string" || def.version === "") {
    throw new ConfigurationError(`${AL_TOOLS_DEF}: version missing`);
  }
  return [`${MCP_LABEL_PREFIX}al-tools`, `${def.version} ${await hashJson(def)}`];
}
```

(import `join` from `@std/path` and `hashJson` from `./hash.ts`.) In `runtimeFacts`, replace the MCP/LSP refusal with:

```typescript
  if (config.components.lsp.length > 0) {
    throw new ConfigurationError(`${config.id}: LSP components are not implemented`);
  }
  const servers: RuntimeFacts["servers"] = {};
  for (const name of config.components.mcp) {
    const f = image.mcp && Object.hasOwn(image.mcp, name) ? image.mcp[name] : undefined;
    if (!f) {
      throw new ConfigurationError(
        `${config.id}: image ${image.digest} has no MCP component ${name} (rebuild the base image, then the harness image)`,
      );
    }
    servers[name] = f;
  }
```

and return `servers` instead of `{}`.

`cli/commands/harness-command.ts`, `harnessImagesBuild` base branch: add `const [mk, mv] = await mcpLabel(o.root);` and pass `"--label", \`${mk}=${mv}\`` in the `docker.build` args before `-t`.

`src/harness/adapters/claude-code.ts`, `nativeSettings`: return `{ ...config.settings, api_models, ...(config.components.mcp.length > 0 ? { mcp: [...config.components.mcp].sort() } : {}) }`.

`harness/images/claude-code/run.ps1`: before `$claudeArgs`:

```powershell
$mcpArgs = @()
if ($cfg.settings.mcp -and @($cfg.settings.mcp).Count -gt 0) {
  $servers = @{}
  foreach ($name in @($cfg.settings.mcp)) {
    if ($name -ne 'al-tools') { throw "unknown MCP component $name" }
    $servers[$name] = @{ type = 'stdio'; command = 'node'; args = @('C:\al-tools-mcp.mjs');
      env = @{ CG_BACKEND_URL = $env:CG_BACKEND_URL; CG_EXECUTION_ID = $env:CG_EXECUTION_ID } }
  }
  $mcpPath = "$userHome\mcp.json"
  [IO.File]::WriteAllText($mcpPath, (ConvertTo-Json -InputObject @{ mcpServers = $servers } -Depth 6), $utf8)
  $mcpArgs = @('--mcp-config', $mcpPath, '--strict-mcp-config')
}
```

and append `@mcpArgs` to the claude invocation: `$prompt | & claude @claudeArgs @mcpArgs`.

- [ ] **Step 4: Run to see them pass**

Run: `deno test --allow-all tests/unit/harness/al-tools-mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/claude-code.test.ts tests/unit/cli/commands/harness-command.test.ts`
Expected: PASS. If `harness-command.test.ts`'s `harnessImagesBuild` test asserts the exact base build args, extend its expectation with the `centralgauge.mcp.al-tools=...` label (compute it with `mcpLabel(root)` in the test's fixture root, which must contain a copy of `al-tools-tools.json`).

- [ ] **Step 5: Check, lint, format** (the modified `.ts` files and tests; `al-tools-mcp.mjs` with `deno lint` only)

- [ ] **Step 6: Commit**

```bash
git add harness/images/base src/harness/images.ts cli/commands/harness-command.ts src/harness/adapters/claude-code.ts harness/images/claude-code/run.ps1 tests/unit/harness/al-tools-mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/claude-code.test.ts tests/unit/cli/commands/harness-command.test.ts
git commit -m "feat(harness): al-tools MCP component on the cg-al backend, image-labelled tool schema (M3-03)"
```

**Acceptance (no container):** the four test files pass; `grep -n "0.0.0.0\|BcContainerProvider" harness/images/base/al-tools-mcp.mjs` prints nothing.

---

### Task M3-04 (ops): pi image and no-credential probes

Build the pi image and answer, without a real credential and without spend, the questions the parser and `run.ps1` rest on. Every run uses `scripts/harness/pi-probe.ts` with its fake key; none counts toward the 5 supervised credential runs (no credential is released). Default Docker network (nat); nothing touches a BC container.

**Lane:** ops. **Deps:** M3-02, M1-24 (`harness images build`), M1-28 (base image built). **Date:** 10-05.

- [ ] **Step 1: build.** `deno task start harness images build pi --version 0.87.1`; quote the `[OK]` line with the image id. Then `DOCKER_CONTEXT=desktop-windows docker run --rm <id> powershell -NoProfile -Command "pi --version; node --version"`; quote both lines exactly (the parser takes the first `x.y.z` from the first).
- [ ] **Step 2: auth failure.** `deno run --allow-all scripts/harness/pi-probe.ts <id> H:\Temp3\harness-spike\M3-04\auth`. Quote `sandbox.exitCode`, `termination`, `didWork`, the last assistant `stopReason` and `errorMessage` and every `auto_retry_*` line from `raw.jsonl`. Expected: exit 0 from pi, termination `harness_crash`, `didWork` false. Record whether `cg_entry` is line 1 and `cg_budget_armed` appears with `limit_usd` 0.05.
- [ ] **Step 3: proxy honored and host list.** Same with `--proxy-log` into `...\M3-04\proxy`. Quote `proxy.log` (expected: only `CONNECT openrouter.ai:443 ...` lines) and the error text pi reports. Expected: a different error from Step 2 (403 from the proxy, not 401 from OpenRouter). Any host other than `openrouter.ai` goes into the evidence as an allowlist question for M1-33, and `PI_EGRESS_HOSTS` is not changed without a reviewed decision.
- [ ] **Step 4: skills, instructions and prompt.** Same with `--skills <dir with fleet-notes\SKILL.md from scripts\spikes\harness\probe-workspace\.pi\skills>` and `--instructions harness\bundles\env\instructions` into `...\M3-04\components`. Quote from `raw.jsonl`: the system `message_start` `sections` keys, the `<name>` entries under `sections.skills`, whether the instructions text appears in any section (decides whether `instructions` stays unobservable), and the first user message text (must equal the prompt: stdin reached pi).
- [ ] **Step 5: fixtures.** Copy the three `raw.jsonl` files to `tests/fixtures/harness/pi/auth-fail.jsonl`, `proxy-refused.jsonl`, `components.jsonl` (byte copy; the fake key is not a secret but is still checked absent: `grep -c "sk-or-v1-cgprobe" tests/fixtures/harness/pi/*.jsonl` prints `0` for each file; if not, stop and report, never hand-edit). Commit on the lane branch: `test(harness): pi no-credential fixtures (M3-04)`.
- [ ] **Step 6: cleanup.** `DOCKER_CONTEXT=desktop-windows docker ps -a --filter name=cg-harness-probe` is empty.

**Acceptance (no container):** the evidence quotes the image id, `pi --version` output, the three runs' exit codes and terminations, `proxy.log`, the component observations, the zero-hit key scan and the empty `docker ps`; the three fixtures are committed.

---

### Task M3-05: parser pinned to the captured fixtures

The M3-01 rules for failed runs rest on assumed shapes. Pin them to the M3-04 logs and fix what differs. Every change to `parsePiStream` keeps all M3-01 tests passing; a shape that contradicts a M3-01 test is resolved by changing the test only when the captured log proves the assumption wrong, stated in the commit message.

**Lane:** infra. **Deps:** M3-04. **Date:** 10-06.

**Files:**
- Modify: `src/harness/adapters/pi.ts` (only where a fixture disagrees), `harness/images/pi/cg-budget.ts` (only if Step 2 of M3-04 showed a repeated `cg_budget_armed`)
- Test: `tests/unit/harness/pi.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

```typescript
const FX = (n: string) => Deno.readTextFile(`tests/fixtures/harness/pi/${n}.jsonl`);
const probeManifest = (over: Partial<ResolvedManifest> = {}) =>
  pm({ limits: { timeout_min: 5, max_budget_usd: 0.05 }, ...over });

Deno.test("pi fixture auth-fail: exit 0 is still a crash, no work, zero cost", async () => {
  const r = parsePiStream(await FX("auth-fail"), { rawLog: "a", exitCode: 0, manifest: probeManifest(), pricing: BOOK });
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
  assertEquals(r.telemetry.cost_usd, 0);
  assertEquals(r.observed.harness_version, "0.87.1");
});

Deno.test("pi fixture proxy-refused: the proxy error is a crash, not a usage limit", async () => {
  const r = parsePiStream(await FX("proxy-refused"), { rawLog: "p", exitCode: 0, manifest: probeManifest(), pricing: BOOK });
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
});

Deno.test("pi fixture components: skills observed from the system message", async () => {
  const r = parsePiStream(await FX("components"), {
    rawLog: "c", exitCode: 0, pricing: BOOK,
    manifest: probeManifest({ skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }] } }),
  });
  assertEquals(r.observed.loaded_components, ["skills"]);
});
```

`instructions` stays unobservable even if M3-04 Step 4 shows the appended text in `sections`: the manifest carries hashes, not text, so the parser has nothing to match against, and adding content to the manifest is out of scope. The finding goes into the M3-05 commit message.

- [ ] **Step 2: Run to see what fails.** `deno test --allow-all tests/unit/harness/pi.test.ts`. Record which assertions fail and why (shape differences).
- [ ] **Step 3: Adjust `parsePiStream`** for each captured shape (for example a different error field name on the failed `message_end`, `auto_retry_end` carrying `errorMessage` instead of `finalError`, a `stopReason` value not in rule 4 or 5). Keep the rule order; add the field name next to the existing one, never replace a tested one without the fixture proving it absent.
- [ ] **Step 4: Run to see them pass** (all pi tests and the Claude Code tests).
- [ ] **Step 5: Check, lint, format; commit** `fix(harness): pi parser pinned to captured failure logs (M3-05)`.

**Acceptance (no container):** `deno test --allow-all tests/unit/harness/pi.test.ts` passes with the three fixture tests.

---

### Task M3-06 (CUTTABLE, cut item 2): AL Tools NuGet toolchain component

Spec 1a D5 and section 5 item 4: the toolchain "is installed in the image at a pinned version"; compiles run locally against `.alpackages` (the staged workspace already holds the lock-verified symbols, M1-13), unseen by the backend. Findings section 6 and accept-M0-06 carryover: package 18.0.41.62505 works offline; `DOTNET_ROOT=C:\dotnet` is required; pin the package version, the package hash, the exact .NET SDK version and the install script hash; record BC build, symbol provenance, compiler version and hashes together (M3-08 evidence). A toolchain image is a layer on a harness image: tag `centralgauge/harness-<harness>:<version>-tc-<name>_<v>`, label `centralgauge.harness.toolchain` with the sorted component list; `runtimeFacts` refuses an image whose label differs from the config's `toolchain`. `almcp.dll` is not used.

**Lane:** infra. **Deps:** M1-24, M3-03 (same files, after it). **Date:** 10-06.

**Files:**
- Create: `harness/images/toolchain/al-tools-nuget/Dockerfile.windows`
- Modify: `harness/images/pins.json` (placeholders, filled by M3-08), `src/harness/images.ts` (`imageTag` optional toolchain, `IMAGE_LABELS` unchanged, `TOOLCHAIN_LABEL`, `ImageFacts.toolchain?`, `runtimeFacts` check, `toolchainPins`), `cli/commands/harness-command.ts` (`harnessImagesBuild` option `toolchain`, Cliffy `--toolchain <spec:string>`; `harnessCell` passes `config.components.toolchain` to `imageTag`; the same in any other `imageTag(config.harness, config.harness_version)` call: `grep -rn "imageTag(config" src cli`)
- Test: `tests/unit/harness/images.test.ts` (append), `tests/unit/cli/commands/harness-command.test.ts` (append)

**Interfaces:**
- Produces: `imageTag(harness: string, version: string, toolchain: readonly string[] = []): string`; `TOOLCHAIN_LABEL = "centralgauge.harness.toolchain"`; `ImageFacts.toolchain?: string[]`; `interface ToolchainPins { dotnet_sdk: string; dotnet_install_sha256: string; al_tools_nuget: { id: string; version: string; sha256: string } }`; `toolchainPins(root: string, spec: string): Promise<ToolchainPins>` (refuses placeholders, an unknown toolchain name, and a spec version different from the pin); `harnessImagesBuild(harness, o: { root; version?; toolchain?: string }, docker?)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/images.test.ts`; add `imageTag`, `toolchainPins` to the import)

```typescript
Deno.test("toolchain: tag, label check and pins", async () => {
  assertEquals(imageTag("pi", "0.87.1"), "centralgauge/harness-pi:0.87.1");
  assertEquals(imageTag("pi", "0.87.1", ["al-tools-nuget@18.0.41.62505"]), "centralgauge/harness-pi:0.87.1-tc-al-tools-nuget_18.0.41.62505");
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, components: { toolchain: ["al-tools-nuget@18.0.41.62505"] }, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = { digest: ID, base_digest: BASE, harness: "claude-code", version: "2.1.282" };
  assertThrows(() => runtimeFacts(cfg, image, claudeCodeAdapter, catalog), ConfigurationError, "toolchain");
  assertEquals(runtimeFacts(cfg, { ...image, toolchain: ["al-tools-nuget@18.0.41.62505"] }, claudeCodeAdapter, catalog).image.digest, ID);
  const noTc = { ...cfg, components: { ...cfg.components, toolchain: [] } };
  assertThrows(() => runtimeFacts(noTc, { ...image, toolchain: ["al-tools-nuget@18.0.41.62505"] }, claudeCodeAdapter, catalog), ConfigurationError, "toolchain");
  const d = new FakeDocker();
  d.addImage("t", ID, { ...LABELS, "centralgauge.harness.toolchain": "al-tools-nuget@18.0.41.62505" });
  assertEquals((await imageFacts(d, "t")).toolchain, ["al-tools-nuget@18.0.41.62505"]);

  const root = await Deno.realPath(await Deno.makeTempDir());
  await Deno.mkdir(`${root}/harness/images`, { recursive: true });
  const pins = (p: unknown) => Deno.writeTextFile(`${root}/harness/images/pins.json`, JSON.stringify({ servercore: "x@sha256:1", ...p as object }));
  await pins({ dotnet_sdk: "PLACEHOLDER", dotnet_install_sha256: "PLACEHOLDER", al_tools_nuget: { id: "Microsoft.Dynamics.BusinessCentral.Development.Tools", version: "18.0.41.62505", sha256: "PLACEHOLDER" } });
  await assertRejects(() => toolchainPins(root, "al-tools-nuget@18.0.41.62505"), ConfigurationError, "PLACEHOLDER");
  const good = { dotnet_sdk: "8.0.415", dotnet_install_sha256: "a".repeat(64), al_tools_nuget: { id: "Microsoft.Dynamics.BusinessCentral.Development.Tools", version: "18.0.41.62505", sha256: "b".repeat(64) } };
  await pins(good);
  assertEquals(await toolchainPins(root, "al-tools-nuget@18.0.41.62505"), good);
  await assertRejects(() => toolchainPins(root, "al-tools-nuget@17.0.1"), ConfigurationError, "pinned 18.0.41.62505");
  await assertRejects(() => toolchainPins(root, "other-tool@1"), ConfigurationError, "unknown toolchain");
});
```

Append to `tests/unit/cli/commands/harness-command.test.ts` (reuse that file's `harnessImagesBuild` fixture root and `FakeDocker` set-up from M1-24; write valid toolchain pins into the fixture root's `pins.json` first):

```typescript
Deno.test("harnessImagesBuild --toolchain: builds the layer on the harness image with pinned args, label and layer check", async () => {
  const { root, docker } = await imagesFixture(); // M1-24 helper in this file: root with pins.json, base and harness images registered
  await harnessImagesBuild("pi", { root, version: "0.87.1" }, docker);
  const f = await harnessImagesBuild("pi", { root, version: "0.87.1", toolchain: "al-tools-nuget@18.0.41.62505" }, docker);
  const args = docker.builds.at(-1)!;
  assert(args.includes("centralgauge/harness-pi:0.87.1-tc-al-tools-nuget_18.0.41.62505"));
  assert(args.includes("BASE=centralgauge/harness-pi:0.87.1"));
  for (const k of ["AL_TOOLS_ID=", "AL_TOOLS_VERSION=18.0.41.62505", "AL_TOOLS_SHA256=", "DOTNET_SDK=", "DOTNET_INSTALL_SHA256="]) {
    assert(args.some((a) => a.startsWith(k)), k);
  }
  assert(args.includes("centralgauge.harness.toolchain=al-tools-nuget@18.0.41.62505"));
  assertEquals(f.toolchain, ["al-tools-nuget@18.0.41.62505"]);
});
```

If M1-24's test file has no `imagesFixture` helper, factor the set-up of its existing `harnessImagesBuild` test into one named `imagesFixture()` in the same file (no behavior change), then use it here.

- [ ] **Step 2: Run to see them fail.** `deno test --allow-all tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts`
- [ ] **Step 3: Implement**

`src/harness/images.ts`:

```typescript
export const TOOLCHAIN_LABEL = "centralgauge.harness.toolchain";

export const imageTag = (harness: string, version: string, toolchain: readonly string[] = []) =>
  `centralgauge/harness-${harness}:${version}${
    toolchain.length > 0 ? `-tc-${[...toolchain].sort().join("-").replaceAll("@", "_")}` : ""
  }`;

export interface ToolchainPins {
  dotnet_sdk: string;
  dotnet_install_sha256: string;
  al_tools_nuget: { id: string; version: string; sha256: string };
}

/** Pins for one toolchain spec (`name@version`); placeholders and version drift are refused. */
export async function toolchainPins(root: string, spec: string): Promise<ToolchainPins> {
  const [name, version] = spec.split("@");
  if (name !== "al-tools-nuget") throw new ConfigurationError(`unknown toolchain ${name} (known: al-tools-nuget)`);
  const file = join(root, "harness", "images", "pins.json");
  const p = JSON.parse(await Deno.readTextFile(file)) as Partial<ToolchainPins>;
  const n = p.al_tools_nuget;
  const values = [p.dotnet_sdk, p.dotnet_install_sha256, n?.id, n?.version, n?.sha256];
  if (!n || values.some((v) => typeof v !== "string" || v === "" || v.includes("PLACEHOLDER"))) {
    throw new ConfigurationError(`${file}: toolchain pins missing or PLACEHOLDER (M3-08 fills them)`);
  }
  if (n.version !== version) {
    throw new ConfigurationError(`${spec}: pinned ${n.version} in ${file}`);
  }
  return { dotnet_sdk: p.dotnet_sdk!, dotnet_install_sha256: p.dotnet_install_sha256!, al_tools_nuget: n };
}
```

In `imageFacts`, add `toolchain: l[TOOLCHAIN_LABEL] ? l[TOOLCHAIN_LABEL].split(",") : []` to the returned object. In `runtimeFacts`, after the version check:

```typescript
  const want = [...config.components.toolchain].sort().join(",");
  const have = [...(image.toolchain ?? [])].sort().join(",");
  if (want !== have) {
    throw new ConfigurationError(`${config.id}: image toolchain is [${have}], config wants [${want}]`);
  }
```

`cli/commands/harness-command.ts`, `harnessImagesBuild`: after the harness image is built and verified (existing code returns `f`), when `o.toolchain` is set: `const pins = await toolchainPins(o.root, o.toolchain);`, `const from = tag; const tcTag = imageTag(harness, o.version, [o.toolchain]);`, build with

```typescript
  const code2 = await docker.build([
    "build", "-f", join(images, "toolchain", "al-tools-nuget", "Dockerfile.windows"),
    "--build-arg", `BASE=${from}`,
    "--build-arg", `AL_TOOLS_ID=${pins.al_tools_nuget.id}`,
    "--build-arg", `AL_TOOLS_VERSION=${pins.al_tools_nuget.version}`,
    "--build-arg", `AL_TOOLS_SHA256=${pins.al_tools_nuget.sha256}`,
    "--build-arg", `DOTNET_SDK=${pins.dotnet_sdk}`,
    "--build-arg", `DOTNET_INSTALL_SHA256=${pins.dotnet_install_sha256}`,
    "--label", `${TOOLCHAIN_LABEL}=${o.toolchain}`,
    "-t", tcTag, join(images, "toolchain", "al-tools-nuget"),
  ]);
  if (code2 !== 0) throw new ConfigurationError(`${tcTag} build failed (exit ${code2})`);
  if (!await hasBaseLayers(docker, tcTag, from)) {
    throw new ConfigurationError(`${tcTag} was not built on ${from}: the layers do not start with its layers`);
  }
  return await imageFacts(docker, tcTag);
```

Register the Cliffy option `--toolchain <spec:string>` on `images build` and pass it through. In `harnessCell` (and any other `imageTag(config.harness, config.harness_version)` call found by the grep in Files), pass `config.components.toolchain` as the third argument.

`harness/images/toolchain/al-tools-nuget/Dockerfile.windows`:

```dockerfile
# AL Tools NuGet toolchain layer (spec 1a D5; findings section 6; accept-M0-06 carryover).
# Built by `harness images build <harness> --version <v> --toolchain al-tools-nuget@<version>`.
# Every input is pinned in harness/images/pins.json and checked here by hash; no default values.
# DOTNET_ROOT is required: without it every `al` call fails with "Failed to resolve hostfxr.dll".
ARG BASE
FROM ${BASE}
ARG DOTNET_SDK
ARG DOTNET_INSTALL_SHA256
ARG AL_TOOLS_ID
ARG AL_TOOLS_VERSION
ARG AL_TOOLS_SHA256
RUN Invoke-WebRequest -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile 'C:\dotnet-install.ps1'; \
    if ((Get-FileHash 'C:\dotnet-install.ps1' -Algorithm SHA256).Hash -ne $env:DOTNET_INSTALL_SHA256) { throw 'dotnet-install.ps1 hash differs from the pin' }; \
    & C:\dotnet-install.ps1 -Version $env:DOTNET_SDK -InstallDir 'C:\dotnet'; \
    Remove-Item -Force 'C:\dotnet-install.ps1'; \
    [Environment]::SetEnvironmentVariable('PATH', 'C:\dotnet;C:\dotnet-tools;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine); \
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', 'C:\dotnet', [EnvironmentVariableTarget]::Machine)
RUN New-Item -ItemType Directory -Force -Path 'C:\nupkg' | Out-Null; \
    $id = $env:AL_TOOLS_ID.ToLowerInvariant(); $v = $env:AL_TOOLS_VERSION; \
    Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$id/$v/$id.$v.nupkg" -OutFile "C:\nupkg\$id.$v.nupkg"; \
    if ((Get-FileHash "C:\nupkg\$id.$v.nupkg" -Algorithm SHA256).Hash -ne $env:AL_TOOLS_SHA256) { throw 'AL Tools package hash differs from the pin' }; \
    & C:\dotnet\dotnet.exe tool install $env:AL_TOOLS_ID --version $v --tool-path C:\dotnet-tools --add-source C:\nupkg; \
    Remove-Item -Recurse -Force 'C:\nupkg'
```

`Get-FileHash` returns upper-case hex: M3-08 writes the pins in upper case, or the comparisons use `-ne $env:X.ToUpperInvariant()`; pick the latter in the implementation so a lower-case pin also works.

`harness/images/pins.json`: add `"dotnet_sdk": "PLACEHOLDER"`, `"dotnet_install_sha256": "PLACEHOLDER"`, `"al_tools_nuget": { "id": "Microsoft.Dynamics.BusinessCentral.Development.Tools", "version": "18.0.41.62505", "sha256": "PLACEHOLDER" }` next to `servercore`.

- [ ] **Step 4: Run to see them pass** (both test files plus `tests/unit/harness/pi.test.ts`, `claude-code.test.ts`).
- [ ] **Step 5: Check, lint, format; commit** `feat(harness): AL Tools NuGet toolchain as a pinned image layer (M3-06)`.

**Acceptance (no container):** the test files pass; `grep -n "Channel" harness/images/toolchain/al-tools-nuget/Dockerfile.windows` prints nothing (exact version, not a channel).

---

### Task M3-07 (ops): al-tools MCP round trip from inside the image, no model credential

Proves the MCP server reaches the real backend from a sandbox and returns a compile result, without a Claude credential (no model runs, so it does not count toward the 5 supervised runs). Uses M1-24's `scripts/harness/backend-probe.ts` set-up (grant, backend on the nat gateway, sandbox with the backend token only) with the image command overridden (`SandboxSpec.command`, "ops probes only") to pipe JSON-RPC into `node C:\al-tools-mcp.mjs`.

**Lane:** ops. **Deps:** M3-03, M1-28 (backend round trip proven). **Date:** 10-07.

- [ ] **Step 1: rebuild.** `deno task start harness images build base`, then `... images build claude-code --version 2.1.282`; quote both ids and `docker image inspect <claude id> --format "{{index .Config.Labels \"centralgauge.mcp.al-tools\"}}"` (inherited label present).
- [ ] **Step 2: round trip.** Hold the lease on Cronus281 and `acquireBenchLock`. Run the backend probe for HX-001 at `refapp-v1-rc1` with the command override `powershell -NoProfile -Command "'{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}','{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"al_compile\",\"arguments\":{\"apps\":[\"Core\"]}}}' | node C:\al-tools-mcp.mjs"` (add a `--command` passthrough to `backend-probe.ts` in this task's ops commit if M1-24 did not provide one; it is a script flag, not harness code). Quote the two JSON-RPC replies and the backend host log line (operation `compile`, apps `Core`, execution id).
- [ ] **Step 3: negative.** Same with an empty secrets dir: `al_compile` returns `isError: true` with status 0 or 401, and the host log shows no compile. Quote.
- [ ] **Step 4: cleanup and scan.** Empty `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME`; the backend token value from the grant is absent from the captured stdout (`grep -c`).

**Acceptance (no container):** the evidence quotes both image ids and the inherited label, the `tools/list` reply (three tools), the `al_compile` reply with `status: 200`, the matching host log line, the negative case, the empty `docker ps` and the zero-hit token scan.

---

### Task M3-08 (ops, CUTTABLE, cut item 2): toolchain pins, build, offline compile in the sandbox

**Lane:** ops. **Deps:** M3-06. **Date:** 10-08.

- [ ] **Step 1: resolve pins.** Download `dotnet-install.ps1` and the package `https://api.nuget.org/v3-flatcontainer/microsoft.dynamics.businesscentral.development.tools/18.0.41.62505/microsoft.dynamics.businesscentral.development.tools.18.0.41.62505.nupkg` to `H:\Temp3\harness-spike\M3-08\`; quote `Get-FileHash -Algorithm SHA256` of both and the exact .NET 8 SDK version chosen (the latest 8.0 SDK patch listed at https://dotnet.microsoft.com/download/dotnet/8.0 on the day; quote it). Write them into `harness/images/pins.json`; commit `chore(harness): toolchain pins (M3-08)`.
- [ ] **Step 2: build.** `deno task start harness images build claude-code --version 2.1.282 --toolchain al-tools-nuget@18.0.41.62505` and the same for `pi --version 0.87.1`; quote both `[OK]` lines.
- [ ] **Step 3: offline compile.** Stage HX-001 at `refapp-v1-rc1` into a scratch workspace with M1-24's staging path (the `.alpackages` is lock-verified), then `DOCKER_CONTEXT=desktop-windows docker run --rm --isolation hyperv --network none --mount type=bind,source=<ws>,target=C:\workspace <tc image id> powershell -NoProfile -Command "al version; foreach ($a in 'Core','Fleet','Rental') { Measure-Command { al compile /project:C:\workspace\$a /out:C:\workspace\$a\out.app /packagecachepath:C:\workspace\.alpackages } | Select-Object TotalSeconds; Test-Path C:\workspace\$a\out.app }"` (apps in dependency order; each later app finds the earlier `out.app` via `.alpackages` only if copied: copy each `out.app` into `.alpackages` between compiles, as M0-06 did for Fleet). Quote every line.
- [ ] **Step 4: provenance together (accept-M0-06).** One table: BC build of the symbols (`28.4.53241.53758`), symbols lock hash (`harness/symbols.lock.json` sha256), `al version` output, package id, version and sha256, .NET SDK version, install script sha256, toolchain image id, base image id.

**Acceptance (no container):** the evidence has the resolved pins, both image ids, `True` for every `out.app` with the compile times, and the provenance table; `pins.json` holds no `PLACEHOLDER`.

---

### Task M3-09 (ops): GATE 10-09: supervised pi cell on HX-001 behind the proxy

The launch gate's "pi adapter working": pi in the sandbox on `cg-harness-sandbox`, reaching OpenRouter only through the M1-33 proxy (`HTTPS_PROXY`), a trusted verdict, the estimated cost in the records. This run **counts toward the 5 supervised credential-bearing runs** unless the marker is `authorized` and `harness egress verify` passes at the time of the run; then it is an enforced run and does not count (decision `egress`, addendum "one shared 5-run budget"). Paid spend goes into `spend.md`.

**Lane:** ops. **Deps:** M3-05, M1-29 (the Claude Code gate passed: the pipeline works), M1-33, M1-34 through Step 6 (marker at least `qualified`, proxy and backend listening on `172.30.60.1`), M1-33's proxy allowlist includes `openrouter.ai` for route `openrouter:api-key` (`PI_EGRESS_HOSTS`). **Date:** 10-08 (afternoon, if M1-34 reaches `qualified`) to 10-09 (morning, before the orchestrator's final gate).

- [ ] **Step 1: preflight.** Quote: `deno task start harness egress verify` (no problem) and the marker state; the lease on Cronus281; empty `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME`; `wc -l H:\cg-coord\ledgers\credential-runs.jsonl` (below 5, unless the marker is `authorized`); the running total in `spend.md` (below USD 120); the pi image id from `harness images build pi --version 0.87.1` at this commit; the dedicated OpenRouter key file in the secrets dir, its value never printed (M1-34 Step 10 rotated it; the key carries a credit cap set in the OpenRouter console: quote the cap, not the key).
- [ ] **Step 2: dry cost check.** `deno task start harness cell pi-flash-plain HX-001 --rev refapp-v1-rc1 --help` lists `--supervised`; the config's `max_budget_usd` is 2.
- [ ] **Step 3: run.** `CG_CREDENTIAL_LEDGER=H:\cg-coord\ledgers\credential-runs.jsonl deno task start harness cell pi-flash-plain HX-001 --rev refapp-v1-rc1 --supervised --containers Cronus281 --secrets-dir <dedicated secrets dir>`. Watch the execution's quarantine `egress.jsonl` live; on any `deny` line or a host other than `openrouter.ai` (and the backend): Ctrl+C, record, stop.
- [ ] **Step 4: records** under `results/harness/cells/`; quote:
  - execution: `termination`, `did_work`, `telemetry.cost_usd` (non-null), `cost_source: "estimated"`, `pricing_snapshot`, `reported_cost_usd`, `per_model`, `turns`, `stop_reason`, `observed` (`harness_version` `0.87.1`, `models` `["openrouter/google/gemini-3.8-flash"]`), `validity` (`incomplete_observed: ["loaded_components"]` is expected: instructions are unobservable), `raw_usage.stream_problems` (expected empty);
  - judgment: `verdict`, `scorer_fingerprint`, each scorer's `passed` (pass or fail are both a gate pass: the gate is the pipeline, not the model);
  - `runs/<id>/raw.jsonl` line 1 is `cg_entry`, a `cg_budget_armed` line has `limit_usd` 2, the log ends with `agent_settled`; `runs/<id>/trace.jsonl` exists; `runs/<id>/sandbox.json` shows `confirmedGone: true`;
  - `egress.jsonl`: every line `allow` for `openrouter.ai:443` (count them) and no `deny`. If `cost_usd` is null, quote `raw_usage.missing`: a cache-read rate of 0 in the catalog or a cache write is a catalog or policy question for the orchestrator (open questions 1 and 2), not a parser fix.
- [ ] **Step 5: secret scan and cleanup.** `grep -rF -f <secrets dir>/openrouter-api-key results/harness | wc -l` prints `0` (the value is read from the file, never typed); the private state for the execution is gone; `docker ps -a` for the owner label is empty.
- [ ] **Step 6: spend and ledger.** Append to `H:\cg-coord\decisions\spend.md` one row (date, `M3-09`, OpenRouter, `reported_cost_usd` of the run, source: the execution record path) and update the running total; quote the new ledger line (or state that the run was enforced and did not reserve a slot).
- [ ] **Step 7 (only if the ledger has a free slot, or the marker is `authorized`): budget trip.** Copy `pi-flash-plain.yml` to a scratch config dir as `pi-flash-trip.yml` with `max_budget_usd: 0.001`, run the same cell with `--repeat 1` against it (via `--config-dir` if M1-24 provides it; otherwise record that the trip is deferred to the first `authorized` run and skip). Expected: termination `budget_exhausted`, a `cg_budget_exhausted` line with `reason: "limit"`, the sandbox gone. Quote. This is a second counted run when the marker is not `authorized`.

**Acceptance (no container):** the evidence quotes the preflight, the execution fields with a non-null estimated cost (or the named reason and the orchestrator's ruling), the judgment, the `egress.jsonl` summary with zero `deny`, the zero-hit key scan, the empty private state and `docker ps`, the `spend.md` row and the ledger line (or the enforced-run statement); Step 7 is quoted or explicitly deferred.

---

## Final integration (orchestrator, 10-09)

- `deno test --allow-all tests/unit/harness/` (excluding nothing: M3 adds no container test) passes on the merge; `deno check` and `deno lint` clean on the M3 files; `graphify update .`.
- M3-09 evidence accepted; `adapterFor("pi")` resolves on master; the launch-gate line "Claude Code and pi adapters working" cites M1-29 and M3-09.
- If M3-06 or M3-08 is cut (cut item 2), record it in `H:\cg-coord\decisions\` with the date; spec 1a D5's toolchain arm then does not run in the 10-10 campaigns.

## Self-review notes

- Spec 1a section 12 item 3 (pi harness after the spike proved telemetry): M3-01, M3-02, M3-04, M3-05, M3-09. Item 4 (al-tools MCP, Claude Code only; AL Tools NuGet toolchain): M3-03, M3-07; M3-06, M3-08 (cuttable). Call categorization (item 4's third part) is M2 (accept-M0-07).
- Section 5 "Adding a harness means a new image, `run.ps1`, a metrics contract, and a host-side trace parser. The orchestrator does not change": M3-02 (image, `run.ps1`, `declared`), M3-01 (parser); no runner change except the toolchain tag argument (M3-06).
- Section 11 "trace parser fixtures per harness ... retry, compaction and a hard kill": hard kill (M3-01 cut stream), fatal run (M3-04/M3-05 captured), retry (synthetic in M3-01; a real retry log is not provoked without spend). Compaction: not observed for pi in M0 and not provoked here; compaction records would show as `unknown record type` in `stream_problems`, never silently dropped.
- Type names used across tasks: `parsePiStream`, `piAdapter`, `PI_ROUTE`, `PI_EGRESS_HOSTS`, `budgetStep`, `mcpLabel`, `MCP_LABEL_PREFIX`, `AL_TOOLS_DEF`, `TOOLCHAIN_LABEL`, `toolchainPins`, `imageTag(harness, version, toolchain?)`, `ImageFacts.mcp?`, `ImageFacts.toolchain?`: each defined once and used with the same signature.

## Open questions

1. **Head-to-head model and cache pricing (launch risk).** Claude Code runs Anthropic models only. A same-model pi arm needs a catalog entry such as `openrouter/anthropic/claude-sonnet-5` with pricing, and pi reports `cacheWrite` with no TTL, so under m1p2-round2 every such pi run has a null cost and drops out of the primary metric. Options for the owner: (a) a written TTL rule for pi through OpenRouter after reading what pi-ai sends (`cache_control` without `ttl` means the 5-minute default), (b) a head-to-head on different models per harness, (c) accept null-cost pi cells and report pass rate only for that comparison.
2. **Catalog rates of 0.** The latest `openrouter/google/gemini-3.8-flash` row (2026-09-08, source openrouter) has `cache_read_per_mtoken: 0`, so any run with cache reads gets a null cost ("cache_read rate is 0"). The orchestrator fills it locally (as for Sonnet 5), or M3-09 may show a null cost.
3. **Budget guard proof.** The trip path (`cg_budget_exhausted`, `ctx.shutdown()`) only runs with real spend. Is one extra supervised slot approved for M3-09 Step 7, or is the trip deferred to the first `authorized` run?
4. **Shared 5-run budget.** M1-29 uses 1, M1-34 Step 11 uses 1, M4-17 pilots use some; M3-09 needs 1 (2 with Step 7). Does the ledger have room, or must M3-09 wait for `authorized`?
5. **Route to host table.** M1-33's proxy allowlist is "from the arm's provider routes"; its plan has no table. Proposed entry: `"openrouter:api-key": ["openrouter.ai"]` (from `PI_EGRESS_HOSTS`, confirmed by M3-04 Step 3). Where does the table live?
6. **Lane capacity.** Lane `infra` holds M1-33 from 10-06 to 10-08; M3-05 and M3-06 land on the same days. Move them to `infra2`, or cut M3-06 now (cut item 2)?
7. **Gate timing.** M3-09 depends on M1-34 reaching `qualified`. If that slips past 10-09 morning, the fallback is a supervised pi cell on nat without the proxy (counts toward the 5, does not meet "behind the proxy") and a gate-slip report to the owner. Confirm the fallback.
8. **pi context files.** `run.ps1` keeps pi's `AGENTS.md`/`CLAUDE.md` discovery on and uses `--no-approve` with explicit `--skill`, so workspace-local pi config never loads. Is that the parity rule wanted against Claude Code (which also reads a workspace `CLAUDE.md`)?
