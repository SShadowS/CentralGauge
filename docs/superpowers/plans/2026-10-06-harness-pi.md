# Harness Bench M3: pi adapter and al-tools MCP component

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By the 2026-10-09 launch gate ("Claude Code and pi adapters working"), a pi 0.87.1 cell (openrouter provider) runs HX-001 in the Windows sandbox behind the egress proxy after authorization, with an estimated cost in the records; Claude Code can load the al-tools MCP component. The AL Tools NuGet toolchain component is cut (launch contract cut item 2, applied in this revision).

**Architecture:** The pi adapter mirrors the accepted Claude Code adapter (M1-32): a pure stream parser (`parsePiStream`) behind the frozen `HarnessAdapter` contract, one image (`harness/images/pi/`) whose `run.ps1` reads `C:\config`, waits for the runner's `C:\cg-secrets\ready`, isolates pi's agent directory and starts pi. A pi extension (`cg-budget.ts`) is the only holder of the OpenRouter key (it registers it with `pi.registerProvider`), so a guard that fails to load leaves pi without a credential; it records `armed` and `exhausted` through `pi.appendEntry` (JSON-mode `entry_appended` records) and stops with `ctx.abort()` plus a `tool_call` block. The al-tools MCP component is a dependency-free stdio MCP server in the base image that forwards to the same `cg-al` backend.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/assert`; pi `@earendil-works/pi-coding-agent` 0.87.1 on Node 22.19.0 (image) and on the host's Node (runtime test, `C:\Users\SShadowS\AppData\Local\nvm\v24.14.0\node_modules\@earendil-works\pi-coding-agent`, version 0.87.1); Windows PowerShell 5.1 in the images.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (spec 1a, sections 4, 5, 8, 9, 11, 12 items 3-4). Binding inputs: findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` (sections 3, 4, 6, 8); M1 part 2 plan `docs/superpowers/plans/2026-09-30-harness-core-part2.md` (M1-19, M1-20, M1-22, M1-24, M1-32, M1-33, M1-34 and its integrated schedule); launch contract `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`; decisions under `H:\cg-coord\decisions\`: `accept-M0-04`, `accept-M0-06`, `accept-M0-07`, `m1p2-round2`, `pi-cache-ttl` (owner: pi through OpenRouter prices TTL-less cache writes at the 5-minute rate, disclosed), `container-allocation` (owner: Cronus281, Cronus282, Cronus283 only), `secrets-accepted-risk`, `egress` with all addenda, `accept-M1-32`, `reviewer-gpt6sol`. Review: `H:\cg-coord\reviews\M3-plan-001\review-gpt6astra.md` (REJECT of bde973bd; revision 2 applies all seven must-change items, mapped below). pi 0.87.1 references: `docs/json.md` (event stream, `agent_end` vs `agent_settled`, retry and compaction events, `entry_appended`), `docs/settings.md` (compaction, cache warming, retry), `docs/configuration.md` (agent directory, context files), `dist/core/extensions/types.d.ts` (`appendEntry`, `registerProvider`, `ctx.abort`, `tool_call` block).

**Revision 2 (after M3-plan-001).** Must-change items and where each is addressed:

| # | Review item | Addressed in |
| --- | --- | --- |
| 1 | Budget guard: records went to stderr, `ctx.shutdown()` has no handler in JSON mode; runtime proof needed | M3-02: `appendEntry` transport, `ctx.abort()` plus `tool_call` block, idempotent arming, key held only by the guard; `tests/integration/harness/pi-runtime.test.ts` runs the real pi 0.87.1 against a scripted local provider (no credential) |
| 2 | pi ignores M1-33's `ready` handshake; preflight not route-aware | M3-02 (`run.ps1` bounded wait, no pi before `ready`, `cg_entry.ready`); M1-33 amendment A1-A3 below (route table, route-aware probes, `ready` in every mode) |
| 3 | Termination: `agent_end` is not final; retries unchecked; stale errors; unknown stopReason counted as work | M3-01: final = `agent_settled`; last `auto_retry_end` decides; only the final failure text classifies; `didWork` only for `stop`, `length`, `toolUse`; new tests; real retry streams in the runtime test |
| 4 | Owner TTL decision not applied | M3-01 (pi/OpenRouter cache writes to `cache_write_5m`, assumption in `raw_usage.assumptions`), M3-01 report disclosure (`coverage.cost_assumptions`) |
| 5 | Compaction and cache warming are billable outside `message_end` | M3-02 disables both in an isolated, recorded agent `settings.json` (`nativeSettings.pi_settings`); M3-01 makes compaction, summarization and unknown record types null the cost |
| 6 | MCP: no Claude-client loading proof; protocol and argument validation | M3-03 (version policy, strict argument validation without a backend call), M3-07 (Claude Code `system/init` shows `al-tools` connected with a fake token, plus all three backend operations) |
| 7 | Schedule, cut, authorization-first gate, contradictions | Schedule below; toolchain cut (section "Cut"); M3-09 after M1-34 Step 12; the `--api-key` test no longer contradicts the entrypoint (the entrypoint never handles the key) |

## Global Constraints

- The adapter contract in `src/harness/adapter.ts` is reused exactly: no new field on `HarnessAdapter`, `ParseInput` or `ParsedRun`. `Telemetry`, `TraceEvent`, `ExecutionRecord` shapes unchanged.
- pi is judged from its events, never from its exit code (pi exits 0 when every provider call fails). Final settlement is `agent_settled`; `agent_end` only closes one low-level run (pi `docs/json.md`).
- Parser rules (accept-M0-04): tool calls from `tool_execution_start` only; usage and pi's cost from assistant `message_end` only.
- Cost basis: `cost_usd` is the list-price estimate from reported tokens through `estimateCost`; pi's `usage.cost.total` sum is `reported_cost_usd` only. **pi through OpenRouter only:** TTL-less cache writes are priced at the 5-minute rate and disclosed (`pi-cache-ttl`); every other unknown TTL stays null (m1p2-round2). Claude Code's logged-TTL rule is unchanged.
- Billing outside `message_end` is never silently omitted: compaction and cache warming are disabled in the recorded agent settings; a compaction, summarization or unknown record type makes the cost null with the reason named.
- Non-JSON stdout (accept-M1-32): counted with line numbers and byte lengths, never content; nulls the cost; never discards the attempt.
- Secrets: the OpenRouter key file is read only by the budget guard inside pi's process; `run.ps1` never reads it, never sets an env var for it, never passes `--api-key`. Never `docker run -e`, never an image layer.
- Credential release (M1-33): the entrypoint starts pi only after `C:\cg-secrets\ready` exists, bounded by `CG_READY_TIMEOUT_S` (default 600); on timeout it writes `cg_entry` with `ready: false` and exits 3 without starting pi.
- Egress and the 5-run budget: the M1/M4 allocation already fills all five pre-authorization slots (M4-17 HX-002, M1-29, M4-17 HX-005, M1-34 Step 11, M1-29 reserve). **No M3 run uses a slot:** every credential-bearing pi run happens after M1-34 Step 12 writes `authorized` and `harness egress verify` passes. Every other M3 run uses a fake key.
- Paid spend: OpenRouter spend is logged in `H:\cg-coord\decisions\spend.md` (cap USD 150, report at 120).
- pi 0.87.1 has no native MCP; the pi adapter refuses MCP. pi arms vary skills, instructions and models.
- Model ids never hardcoded in code; configs name catalog slugs. No `sync-catalog --apply`, no ingest, no deploy.
- Containers (`container-allocation`): Cronus281, Cronus282, Cronus283 only, through coord leases. Starting, stopping or recreating a BC container is forbidden without the owner.
- Lanes: code tasks are `infra` or `infra2`, never touch Docker or a BC container. Unit tests: `deno test --allow-all <file>` (never `--parallel`, never `tests/unit/container/` while a bench is live). The pi runtime test runs a host Node process against 127.0.0.1 only (no container, no credential, no internet). Ops work: evidence under `H:\cg-coord\tasks\<id>\runs\<nnn>\evidence.md`; ad-hoc docker commands prefixed `DOCKER_CONTEXT=desktop-windows`.
- M1 work preempts M3 work on a shared lane. After each task: `deno check`, `deno lint`, `deno fmt` on the task's files only (never under `site/`); after the last infra task `graphify update .`. Import order per CLAUDE.md. `[OK]`/`[FAIL]`/`[WARN]` tags, no emoji. No em dash anywhere.
- Recorded fixtures under `tests/fixtures/harness/` stay byte-exact (`-text`) and are scanned for every secret value and for the pattern `sk-or-v1-[A-Za-z0-9]{20,}` before commit.

## Review Focus

1. **Every provider call fails and pi exits 0.** Expected: never `completed`; `usage_limited` only when the final failure text names 402, 429, rate limit, insufficient credits or quota; `did_work` false. Pinned in M3-01 (`pi parse: pi exits 0 after every provider call failed`), M3-02 runtime (`scripted 500s end in harness_crash`, `scripted 429s end in usage_limited`), M3-05 (captured auth failure).
2. **Killed during a retry or after an earlier `agent_end`.** Expected: termination null, cost null ("no agent_settled"), partial usage kept. Pinned in M3-01 (`pi parse: a cut stream`, `pi parse: a kill during a retry after an earlier agent_end`).
3. **The budget guard does not load, loads twice, or trips.** Expected: not loaded means no key, so no provider request; repeated `agent_start` gives one `armed`; a trip stops further provider requests. Pinned in M3-02 runtime (`guard missing: pi makes no provider request`, `one armed record across retries`, `a trip stops further provider requests`).
4. **Paid work outside `message_end` (compaction, cache warming, an event type pi adds later).** Expected: disabled by recorded settings; if it appears anyway, cost null with the reason. Pinned in M3-01 (`pi parse: compaction or an unknown record nulls the cost`), M3-02 (`nativeSettings records the agent settings`).
5. **The OpenRouter key leaks.** Expected: not in argv, env, image layers or stdout; a printed key is redacted on publication (M1-22). Pinned in M3-02 (`run.ps1 never handles the key`, runtime `the key reaches the provider only as the Authorization header`) and M3-09 Step 5 (secret scan).

## Reuse

Reused as-is: `HarnessAdapter`, `requestedComponents` (`adapter.ts`); `estimateCost`, `ModelTokens`, `PricingBook`, `loadPricingBook` (`pricing.ts`); `writeTrace`, `TraceEvent` (`trace.ts`); `Termination`, `Telemetry` (`records.ts`); `runSandbox`, `realDocker` (`sandbox.ts`); `ConfigurationError`, `ValidationError`; `loadConfig`, `checkModelsInCatalog`, `HarnessConfigSchema` (`config.ts`); `hashJson` (`hash.ts`); `buildReport`/`renderReport` (`report.ts`); M1-24's `images.ts` and `harnessImagesBuild`; the M1-19 backend protocol (`POST /v1/<op>`, `Authorization: Bearer`, `X-CG-Execution`, token file `backend-token`, env `CG_BACKEND_URL`, `CG_EXECUTION_ID`); test helpers `tests/unit/harness/fixtures.ts` (`manifest`, `execution`), `fake-docker.ts`.

Moved, not rewritten: `readRecords`, `nonJsonReason`, `only`, `refuse` leave `adapters/claude-code.ts` for `adapters/jsonl.ts` (M3-01 Step 1); the Claude Code tests guard the move.

Not reused: `mcp/al-tools-server.ts` (binds 0.0.0.0, talks to BC directly); `almcp.dll` (accept-M0-06: presence only, nothing in M3 relies on it).

Owned elsewhere, stated so nothing disappears: call categorization for pi (`SKILL.md` reads as skill use) is M2 (accept-M0-07). Pattern-based redaction beyond exact secret values (M0-04 carryover) belongs to M1-22's publication redaction; M3 only guarantees its own fixtures carry no key pattern (open question 4).

## M1-33 amendment (orchestrator applies to the M1 part 2 plan before M1-33 starts; M1-33 owns them)

- **A1. One route-to-host policy** in `src/harness/egress.ts`: `ROUTE_HOSTS: Record<string, string[]> = { "anthropic:first-party-oauth": [<hosts recorded by M1-34 Step 11>, "api.anthropic.com"], "openrouter:api-key": ["openrouter.ai"] }`; `hostsForRoutes(routes)` throws `ConfigurationError` for an unknown route (fail closed). The proxy allowlist for an execution is `hostsForRoutes(Object.values(manifest.provider_routes))`, never the union over all arms.
- **A2. Route-aware positive preflight:** the expected-open probe is `proxy-allow-<host>` for exactly that execution's hosts (a pi arm probes `openrouter.ai`, a Claude arm `api.anthropic.com`).
- **A3. `ready` in every mode:** the runner writes `C:\cg-secrets\ready` after the secret files in every run (enforced: after the preflight; not enforced: right after the secrets), so every entrypoint waits unconditionally. M3-02's `run.ps1` implements the pi side; M1-33 adds the same wait to the Claude Code `run.ps1` (already in its file list).

## Schedule (resequenced against the M1/M4 schedule; coordinator: lane `infra` is idle until M1-16 lands, lane `infra2` is on M1-16)

| Task | Lane | Deps | Date | What |
| --- | --- | --- | --- | --- |
| M3-01 | infra | M1-21, M1-32 (accepted) | 09-26 | shared JSONL reader; `parsePiStream` (settlement, retries, TTL assumption, billable-event rule); report disclosure of cost assumptions |
| M3-02 | infra | M3-01, M1-20 (on master) | 09-27 to 09-28 | `piAdapter`; image, `run.ps1` (ready wait, isolated agent dir), budget guard; config; probe script; **real-runtime integration test** (scripted provider, no credential) |
| M3-03 | infra | M1-19, M1-24 | 10-05 (after M1-24, before M1-33 starts 10-06) | al-tools MCP component: server with version policy and argument validation, image label facts, `runtimeFacts`, Claude Code wiring |
| M3-04 | ops | M3-02, M1-28 | 10-05 (reserved block after M1-29, before M4-09 on Cronus282/283; no BC container) | build the pi image; fake-key probes in the sandbox: ready gating, auth failure, proxy honored plus host list, skills and prompt; runtime scenarios re-run inside the image; fixtures delivered by 16:00 |
| M3-05 | infra2 | M3-04 | 10-05 (after the fixtures; before M1-18/M1-35 on 10-06) | parser pinned to the captured fixtures |
| M3-07 | ops | M3-03, M1-28 | 10-07 (sequential block, before or after M4-13, not concurrent; Cronus281 lease) | Claude Code loads the al-tools MCP (fake token, `system/init`); all three operations through the MCP server to the real backend |
| M3-09 | ops | M3-05, M1-29, M1-33 (with A1-A3), M1-34 through Step 12 (`authorized`), M1-38 | 10-09 (after M1-34 Step 12 and M1-38; acceptance may land late on 10-09) | **gate:** pi cell on HX-001 behind the proxy with an estimated cost; not a ledger slot; optional real budget trip |

Protected, no M3 work: 10-06 to 10-08 on `infra` (M1-33) and `infra2` (M1-18, M1-35, M1-23, M1-24b); 10-08 ops blackout for M1-34 apply, revert and re-apply. Requested from the orchestrator (cut item 3, secondary report sections): defer M1-25's report extras so `infra2` keeps 10-09 for integration repairs; the primary metric and outcome reporting stay.

## Cut (launch contract cut item 2, applied now)

M3-06 (toolchain image layer) and M3-08 (pins, build, offline compile) are cut from the 10-10 campaigns; the orchestrator records the cut in `H:\cg-coord\decisions\`. If the toolchain is re-planned after 10-16, the replan must: build the layer `FROM` the inspected immutable harness image id (not a tag); install only the hash-checked package (`dotnet tool install` with a `nuget.config` that clears every other source, `<clear/>` plus the one local folder); record the symbol provenance of the qualified container that produced the lock (not the Cronus28 build by default); keep the toolchain out of the pi gate's dependency chain. The already-qualified plain images stay pinned by id.

---

### Task M3-01: shared JSONL reader, pi stream parser, cost-assumption disclosure

pi 0.87.1 JSON mode (`docs/json.md`; fixture `tests/fixtures/harness/pi/probe.jsonl`: 90 lines, 5 assistant `message_end`, 4 `tool_execution_start`, 5 `turn_end`, `agent_end`, `agent_settled`). Our records: `cg_entry` (first line, from `run.ps1`: `pi_version`, `max_budget_usd`, `ready`) and pi `entry_appended` records whose `entry.customType` is `cg-budget` (`entry.data.event` `armed` or `exhausted`, from the guard).

Termination, in order:
1. `cg_entry.ready === false`: `setup_failed` (pi never started).
2. a `cg-budget` `exhausted` entry: `budget_exhausted`.
3. no `agent_settled`, or an `auto_retry_start` after the last `auto_retry_end`: `null` (the runner decides; accept-M1-32 maps null plus stream problems to `infra_exposed`).
4. no `armed` entry, its `limit_usd` differs from `limits.max_budget_usd`, or it comes after the first assistant `message_start`: `setup_failed`.
5. the last `auto_retry_end` comes after the last assistant `message_end` and has `success: false`: failure with its `finalError`.
6. last assistant `stopReason`: `stop`/`length` give `completed`; `error`/`aborted` give failure with that message's `errorMessage`; `toolUse` gives failure (loop ended with tool use outstanding); missing or any other value gives failure plus a stream problem `unknown stopReason`.
7. failure: `usage_limited` when the final failure text (only that one) matches `402`, `429`, `rate limit`, `insufficient credits`, `quota`; else `harness_crash`.

Cost null reasons (in addition to `estimateCost`'s): non-JSON lines; no `agent_settled`; a pending retry; `compaction_start`, `compaction_end` or `summarization_*` records ("billable work outside message_end"); an unknown record type ("possibly billable"). Cache writes: pi through OpenRouter only (the adapter requires provider `openrouter` on every message), all `cacheWrite` tokens go to `cache_write_5m` and `raw_usage.assumptions` names the count and the decision.

`did_work`: a `tool_execution_start`, or an assistant `message_end` with `stopReason` `stop`, `length` or `toolUse`.

**Lane:** infra. **Deps:** M1-21, M1-32 (accepted on master). **Date:** 09-26.

**Files:**
- Create: `src/harness/adapters/jsonl.ts`, `src/harness/adapters/pi.ts`
- Modify: `src/harness/adapters/claude-code.ts` (imports the moved helpers), `src/harness/report.ts` (`ArmCoverage.cost_assumptions`, render line)
- Test: `tests/unit/harness/pi.test.ts`, `tests/unit/harness/report.test.ts` (append)

**Interfaces:**
- Produces (jsonl.ts): `interface Line<T> { rec: T; line: number }`; `interface NonJson`; `readRecords<T extends object>(text)`; `nonJsonReason(n)`; `refuse(msg): never`; `only<T>(recs, what, file)`.
- Produces (pi.ts): `PI_PROVIDER = "openrouter"`; `PI_ROUTE = "openrouter:api-key"`; `ENTRY_RECORD = "cg_entry"`; `BUDGET_ENTRY = "cg-budget"`; `TTL_ASSUMPTION = "pi_openrouter_cache_write_5m"`; `parsePiStream(text, input: Omit<ParseInput, "traceOut">, streamProblems?): ParsedRun & { trace: TraceEvent[] }`; `raw_usage` keys `usage`, `reported_cost_total`, `budget`, `assumptions: { key: string; tokens: number; decision: string }[]`, `missing`, `stream_problems`.
- Produces (report.ts): `ArmCoverage.cost_assumptions: Record<string, number>` (executions per assumption key, sorted keys).

- [ ] **Step 1: Move the shared reader** (guarded by the existing tests)

Create `src/harness/adapters/jsonl.ts`:

```typescript
/**
 * JSONL reading shared by the harness stream parsers (moved from the Claude
 * Code adapter, accept-M1-32): one JSON object with a string `type` per line;
 * a leading BOM, CRLF and blank lines are accepted. Any other line never
 * throws the attempt away: it is counted, and the first few are named by line
 * number and byte length. No content is stored, since even a prefix can carry
 * part of a secret; the full log stays in quarantine. Lines split on LF only
 * (pi docs/json.md: U+2028/U+2029 are valid inside JSON strings).
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

The JS `split(/\r?\n/)` splits on LF only (it does not split on U+2028), so the move keeps pi's framing rule. In `claude-code.ts`: delete the moved definitions, add `import { type Line, nonJsonReason, only, readRecords, refuse } from "./jsonl.ts";`, use `Line<J>` and `readRecords<J>(text)`; drop the `ValidationError` import if `deno lint` reports it unused.

- [ ] **Step 2: Run the Claude Code tests** (unchanged, must pass)

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts`
Expected: PASS, same count as before.

- [ ] **Step 3: Write the failing pi tests**

`tests/unit/harness/pi.test.ts`:

```typescript
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
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
const ENTRY = JSON.stringify({ type: "cg_entry", pi_version: "0.87.1", max_budget_usd: 5, ready: true });
const budget = (data: Record<string, unknown>) =>
  JSON.stringify({ type: "entry_appended", entry: { type: "custom", id: "e1", parentId: null, customType: "cg-budget", data } });
const ARMED = budget({ event: "armed", limit_usd: 5 });
const HEAD = `${ENTRY}\n${ARMED}\n`;
const END = `${JSON.stringify({ type: "agent_end", messages: [], willRetry: false })}\n${JSON.stringify({ type: "agent_settled" })}\n`;

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
type Raw = { stream_problems: string[]; missing: string[]; assumptions: { key: string; tokens: number }[]; usage: Record<string, { requests: number }> };
const raw = (r: ReturnType<typeof run>) => r.telemetry.raw_usage as unknown as Raw;
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
const retryStart = JSON.stringify({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "429 rate limit" });
const retryEnd = (success: boolean, finalError?: string) =>
  JSON.stringify({ type: "auto_retry_end", success, attempt: 2, ...(finalError ? { finalError } : {}) });

Deno.test("pi parse: the M0-04 probe gives calls, outcomes, estimated and reported cost, observed skills", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
    skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }] },
  });
  assertEquals(r.termination, "completed");
  assert(r.didWork);
  assertEquals(r.telemetry.harness_version, "0.87.1");
  assertAlmostEquals(r.telemetry.cost_usd!, (10030 * 0.75 + 1058 * 3.75) / 1e6, 1e-12);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.telemetry.pricing_snapshot, "openrouter/google/gemini-3.8-flash@2026-09-07");
  assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.01149, 1e-9);
  assertEquals(r.telemetry.per_model, [{
    model: "openrouter/google/gemini-3.8-flash", requests: 5, tokens_in_uncached: 10030, tokens_cache_read: 0,
    tokens_cache_write: 0, tokens_out: 1058, tokens_reasoning: 598, cost_usd: r.telemetry.cost_usd,
  }]);
  assertEquals([r.telemetry.turns, r.telemetry.stop_reason, r.telemetry.exit_code], [5, "stop", 0]);
  assertEquals(r.observed, { harness_version: "0.87.1", models: ["openrouter/google/gemini-3.8-flash"], loaded_components: ["skills"] });
  assertEquals(r.trace.map((e) => [e.tool, e.transport, e.outcome, e.result_bytes]), [
    ["read", "builtin", "ok", 191], ["read", "builtin", "ok", 1309], ["bash", "shell", "error", 78], ["bash", "shell", "ok", 114],
  ]);
  assertEquals(r.trace.map((e) => e.request_id), [
    "gen-1790337684-4yFOxDaLsiEetl7SFlSd", "gen-1790337692-FMVYrPlIFfx1b7MxkAHD",
    "gen-1790337701-8CKiSkNCCCusBQdrudlX", "gen-1790337704-kM82l3iIWRO7njJHjTFb",
  ]);
  assert(r.trace.every((e) => e.session === "01a0d871-168a-71a7-aca7-ade97274c0e8" && e.model === "google/gemini-3.8-flash"));
  assertEquals(raw(r).stream_problems, []);
  assertEquals(raw(r).assumptions, []);
});

Deno.test("pi parse: pi exits 0 after every provider call failed", () => {
  const fail = (msg: string) => HEAD + assistant({ stopReason: "error", errorMessage: msg }) + "\n" + retryEnd(false, msg) + "\n" + END;
  const auth = run(fail("401 Unauthorized: invalid API key"));
  assertEquals([auth.termination, auth.didWork, auth.telemetry.exit_code, auth.telemetry.cost_usd], ["harness_crash", false, 0, 0]);
  assertEquals(run(fail("402 insufficient credits")).termination, "usage_limited");
  assertEquals(run(fail("429 Too Many Requests: rate limit")).termination, "usage_limited");
  assertEquals(run(HEAD + assistant({ stopReason: "aborted" }) + "\n" + END).termination, "harness_crash");
  assertEquals(run(HEAD + assistant({ stopReason: "toolUse" }) + "\n" + END).termination, "harness_crash");
  assertEquals(run(HEAD + END).termination, "harness_crash", "settled without any answer");
});

Deno.test("pi parse: only the final failure classifies; an earlier 429 does not make a later crash a usage limit", () => {
  const text = HEAD + retryStart + "\n" + retryEnd(true) + "\n" + assistant({ stopReason: "toolUse", usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { total: 0 } } }) + "\n" +
    assistant({ stopReason: "error", errorMessage: "500 upstream exploded" }) + "\n" + END;
  const r = run(text);
  assertEquals(r.termination, "harness_crash");
  assert(r.didWork, "the toolUse answer was work");
});

Deno.test("pi parse: retry then success completes; terminal retry failure uses finalError", () => {
  const ok = run(HEAD + retryStart + "\n" + retryEnd(true) + "\n" + assistant({ stopReason: "stop" }) + "\n" + END);
  assertEquals(ok.termination, "completed");
  assertEquals(ok.trace.map((e) => e.type), ["retry"]);
  const bad = run(HEAD + assistant({ stopReason: "error", errorMessage: "503" }) + "\n" + retryStart + "\n" + retryEnd(false, "429 rate limit exceeded") + "\n" + END);
  assertEquals(bad.termination, "usage_limited");
});

Deno.test("pi parse: a cut stream (hard kill) has no termination and no cost, partial usage kept", async () => {
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const r = run(lines.slice(0, 40).join("\n") + "\n", {}, null);
  assertEquals([r.termination, r.telemetry.cost_usd, r.telemetry.turns], [null, null, null]);
  assertStringIncludes(raw(r).missing[0]!, "no agent_settled");
  assert(raw(r).usage["google/gemini-3.8-flash"]!.requests >= 1);
});

Deno.test("pi parse: a kill during a retry after an earlier agent_end", () => {
  const text = HEAD + assistant({ stopReason: "error", errorMessage: "529 overloaded" }) + "\n" +
    JSON.stringify({ type: "agent_end", messages: [], willRetry: true }) + "\n" + retryStart + "\n";
  const r = run(text, {}, null);
  assertEquals([r.termination, r.telemetry.cost_usd], [null, null]);
  const settledButPending = run(HEAD + retryStart + "\n" + END);
  assertEquals(settledButPending.termination, null, "a retry with no end is not settled work");
  assertStringIncludes(raw(settledButPending).missing.join("\n"), "retry without auto_retry_end");
});

Deno.test("pi parse: TTL-less cache writes are priced at the 5-minute rate for pi/OpenRouter and disclosed", () => {
  const text = HEAD + assistant({
    stopReason: "stop",
    usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 50, totalTokens: 180, cost: { total: 0.001 } },
  }) + "\n" + END;
  const r = run(text);
  assertAlmostEquals(r.telemetry.cost_usd!, (100 * 0.75 + 10 * 3.75 + 20 * 0.075 + 50 * 0.0417) / 1e6, 1e-15);
  assertEquals(r.telemetry.per_model[0]!.tokens_cache_write, 50);
  assertEquals(raw(r).assumptions, [{ key: "pi_openrouter_cache_write_5m", tokens: 50, decision: "2026-09-25-pi-cache-ttl" }]);
  assertEquals(r.telemetry.reported_cost_usd, 0.001);
});

Deno.test("pi parse: compaction or an unknown record nulls the cost", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  for (const extra of [
    JSON.stringify({ type: "compaction_start", reason: "threshold" }),
    JSON.stringify({ type: "summarization_retry_finished" }),
    JSON.stringify({ type: "cache_refresh", usage: {} }),
  ]) {
    const r = run(HEAD + extra + "\n" + text);
    assertEquals(r.telemetry.cost_usd, null, extra);
    assertEquals(r.termination, "completed");
  }
  const r = run(HEAD + JSON.stringify({ type: "cache_refresh" }) + "\n" + text);
  assertStringIncludes(raw(r).missing.join("\n"), "unknown record type cache_refresh (possibly billable)");
});

Deno.test("pi parse: budget guard records: missing, wrong limit, late, repeated", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const none = run(ENTRY + "\n" + text);
  assertEquals(none.termination, "setup_failed");
  assertStringIncludes(raw(none).stream_problems.join("\n"), "budget guard not armed");
  assertEquals(run(ENTRY + "\n" + budget({ event: "armed", limit_usd: 50 }) + "\n" + text).termination, "setup_failed");
  assertEquals(run(ENTRY + "\n" + text.replace('{"type":"agent_settled"}', `${ARMED}\n{"type":"agent_settled"}`)).termination, "setup_failed", "armed after the first request");
  assertThrows(() => run(HEAD + ARMED + "\n" + text), ValidationError, "2 cg-budget armed records");
});

Deno.test("pi parse: exhausted wins; ready false is setup_failed before anything else", () => {
  const trip = HEAD + assistant({ stopReason: "aborted" }) + "\n" + budget({ event: "exhausted", spent_usd: 5.01, limit_usd: 5, reason: "limit" }) + "\n" + END;
  assertEquals(run(trip).termination, "budget_exhausted");
  const notReady = JSON.stringify({ type: "cg_entry", pi_version: "", max_budget_usd: 5, ready: false });
  const r = run(notReady + "\n", {}, 3);
  assertEquals([r.termination, r.didWork], ["setup_failed", false]);
});

Deno.test("pi parse: usage problems null the cost; provider must be openrouter; pi's cost is optional", () => {
  const bad = run(HEAD + assistant({ stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { total: 0 } } }) + "\n" + END);
  assertEquals(bad.telemetry.cost_usd, null);
  assert(raw(bad).missing.some((m) => m.includes("totalTokens 5")));
  assertEquals(run(HEAD + assistant({ stopReason: "stop", provider: "anthropic" }) + "\n" + END).telemetry.cost_usd, null);
  const noCost = run(HEAD + assistant({ stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } }) + "\n" + END);
  assertEquals(noCost.telemetry.reported_cost_usd, null);
  assert(noCost.telemetry.cost_usd !== null);
});

Deno.test("pi parse: unknown stopReason is a crash and not work", () => {
  const r = run(HEAD + assistant({ stopReason: "weird" }) + "\n" + END);
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
  assertStringIncludes(raw(r).stream_problems.join("\n"), "unknown stopReason weird");
  assertEquals(run(HEAD + assistant({}) + "\n" + END).didWork, false, "missing stopReason");
});

Deno.test("pi parse: non-JSON stdout keeps the attempt, stores no content, nulls the cost", async () => {
  const r = run(HEAD + "sk-or-v1-" + "z".repeat(40) + "\n" + await Deno.readTextFile(FIXTURE));
  assertEquals([r.termination, r.telemetry.cost_usd], ["completed", null]);
  assert(!JSON.stringify(r.telemetry.raw_usage).includes("z".repeat(10)));
  assertStringIncludes(raw(r).stream_problems[0]!, "1 non-JSON stdout line (line 3)");
});

Deno.test("pi parse: contradictory records are refused with file and line", () => {
  const start = (id: string) => JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName: "read", args: {} });
  assertThrows(() => run(HEAD + start("c1") + "\n" + start("c1") + "\n"), ValidationError, "c1 repeats line 3");
  assertThrows(() => run(HEAD + ENTRY + "\n"), ValidationError, "2 cg_entry records");
  const endRec = JSON.stringify({ type: "tool_execution_end", toolCallId: "c9", isError: false, result: { content: [] } });
  assertThrows(() => run(HEAD + endRec + "\n" + endRec + "\n"), ValidationError, "second tool_execution_end for c9");
  assertStringIncludes(raw(run(HEAD + endRec + "\n" + END)).stream_problems.join("\n"), "tool_execution_end for unknown c9");
});

Deno.test("pi parse: instructions and toolchain are unobservable; a skill missing from the prompt is not loaded", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
    skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "objid/SKILL.md", sha256: "b".repeat(64) }] },
    instructions: { path: "bundles/env/instructions", hash: "c".repeat(64), files: [] },
    toolchain: ["al-tools-nuget@18.0.41.62505"],
  });
  assertEquals(r.observed.loaded_components, []);
  assertEquals(r.unobservable.sort(), ["instructions", "toolchain:al-tools-nuget@18.0.41.62505"]);
});

Deno.test("pi parse: harness version is the x.y.z inside pi --version output", () => {
  const e = JSON.stringify({ type: "cg_entry", pi_version: "pi 0.87.1\r\n", max_budget_usd: 5, ready: true });
  assertEquals(run(`${e}\n${ARMED}\n${END}`).observed.harness_version, "0.87.1");
  assertEquals(run(`${ARMED}\n${END}`).observed.harness_version, null);
});
```

Append to `tests/unit/harness/report.test.ts` (use that file's existing campaign and execution builders; the builder names below are the ones the file already uses for its coverage tests, adjust to them):

```typescript
Deno.test("buildReport: coverage counts executions priced under a cost assumption, per arm", async () => {
  const withAssumption = { assumptions: [{ key: "pi_openrouter_cache_write_5m", tokens: 50, decision: "2026-09-25-pi-cache-ttl" }] };
  const r = await reportWith((e, i) => i === 0 ? { ...e, telemetry: { ...e.telemetry, raw_usage: withAssumption } } : e);
  const c = r.coverage.find((x) => x.arm === r.coverage[0]!.arm)!;
  assertEquals(c.cost_assumptions, { pi_openrouter_cache_write_5m: 1 });
  assertStringIncludes(renderReport(r), "cost assumptions: pi_openrouter_cache_write_5m 1");
});
```

(`reportWith(mapExecution)` is a small helper added at the top of this test in the same commit if the file has none: it builds the file's standard two-arm report with each execution passed through `mapExecution` before `buildReport`.)

- [ ] **Step 4: Run to see them fail**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts tests/unit/harness/report.test.ts`
Expected: FAIL (`src/harness/adapters/pi.ts` missing; `cost_assumptions` undefined).

- [ ] **Step 5: Implement the parser**

`src/harness/adapters/pi.ts`:

```typescript
/**
 * pi 0.87.1 adapter (spec 1a section 12 item 3; findings section 4; pi
 * docs/json.md; decisions accept-M0-04, accept-M1-32, m1p2-round2,
 * pi-cache-ttl). Judged from events, never the exit code. Final settlement is
 * agent_settled (agent_end only closes one low-level run). Tool calls from
 * tool_execution_start, outcomes from tool_execution_end, usage and pi's own
 * cost from assistant message_end only. Cache writes carry no TTL: priced at
 * the 5-minute rate for pi/OpenRouter (owner decision), disclosed. Work that
 * bills outside message_end (compaction, summarization, anything unknown)
 * nulls the cost.
 */

import type { ParsedRun, ParseInput } from "../adapter.ts";
import type { ModelTokens } from "../pricing.ts";
import type { Telemetry, Termination } from "../records.ts";
import type { TraceEvent } from "../trace.ts";
import { requestedComponents } from "../adapter.ts";
import { estimateCost } from "../pricing.ts";
import { type Line, nonJsonReason, only, readRecords, refuse } from "./jsonl.ts";

export const PI_PROVIDER = "openrouter";
export const PI_ROUTE = "openrouter:api-key";
export const ENTRY_RECORD = "cg_entry";
export const BUDGET_ENTRY = "cg-budget";
export const TTL_ASSUMPTION = "pi_openrouter_cache_write_5m";

type R = Record<string, unknown>;

/** Record types that never bill. */
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
  "queue_update",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  ENTRY_RECORD,
]);
/** Billable outside message_end; disabled by the recorded agent settings (M3-02). */
const BILLABLE = /^(compaction_|summarization_)/;
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const WORK_STOPS = new Set(["stop", "length", "toolUse"]);
const LIMIT_TEXT = /\b(402|429)\b|rate.?limit|insufficient credits|quota/i;

const isObj = (v: unknown): v is R =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): R => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const utf8 = new TextEncoder();
const toJson = (v: unknown): Telemetry["raw_usage"] =>
  JSON.parse(JSON.stringify(v));
const lastOf = <T>(xs: Line<T>[]): Line<T> | undefined => xs[xs.length - 1];

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
  const costGaps: string[] = [];
  const unknown = new Map<string, number>();
  for (const { rec } of lines) {
    const t = rec["type"] as string;
    if (!KNOWN_TYPES.has(t)) unknown.set(t, (unknown.get(t) ?? 0) + 1);
  }
  for (const [t, n] of [...unknown].sort(([a], [b]) => a < b ? -1 : 1)) {
    const why = BILLABLE.test(t)
      ? `${t} (${n}): billable work outside message_end`
      : `unknown record type ${t} (${n}) (possibly billable)`;
    streamProblems.push(why);
    costGaps.push(why);
  }

  only(of("session"), "session", file);
  const session = of("session")[0]?.rec;
  const entry = only(of(ENTRY_RECORD), ENTRY_RECORD, file)?.rec;
  const budgetOf = (event: string) =>
    of("entry_appended").filter((x) => {
      const e = obj(x.rec["entry"]);
      return e["customType"] === BUDGET_ENTRY && obj(e["data"])["event"] === event;
    });
  const armedLine = only(budgetOf("armed"), `${BUDGET_ENTRY} armed`, file);
  const exhausted = only(budgetOf("exhausted"), `${BUDGET_ENTRY} exhausted`, file);
  const armed = armedLine ? obj(obj(armedLine.rec["entry"])["data"]) : undefined;
  const settled = of("agent_settled").length > 0;
  const retryStarts = of("auto_retry_start");
  const retryEnds = of("auto_retry_end");
  const lastRetryEnd = lastOf(retryEnds);
  const retryPending = (lastOf(retryStarts)?.line ?? 0) > (lastRetryEnd?.line ?? 0);
  const sessionId = str(session?.["id"]);
  const version = /\d+\.\d+\.\d+/.exec(str(entry?.["pi_version"]) ?? "")?.[0] ?? null;

  const outcomes = new Map<string, { error: boolean; bytes: number }>();
  for (const { rec, line } of of("tool_execution_end")) {
    const id = str(rec["toolCallId"]);
    if (id === null) refuse(`${file}:${line}: tool_execution_end without a toolCallId`);
    if (outcomes.has(id)) refuse(`${file}:${line}: second tool_execution_end for ${id}`);
    const body = list(obj(rec["result"])["content"]).map(obj)
      .filter((c) => c["type"] === "text").map((c) => str(c["text"]) ?? "").join("");
    outcomes.set(id, { error: rec["isError"] === true, bytes: utf8.encode(body).length });
  }

  const trace: TraceEvent[] = [];
  const ev = (o: Partial<TraceEvent>): TraceEvent => ({
    v: 1, seq: trace.length + 1, t_ms: null, type: "tool_call", session: sessionId,
    agent: "main", parent: null, call_id: null, request_id: null, tool: null,
    transport: null, skill: null, backend_request: null, outcome: null,
    error_class: null, result_bytes: null, truncated: null, duration_ms: null,
    model: null, ...o,
  });
  const started = new Map<string, number>();
  const usage = new Map<string, Agg>();
  let reported: number | null = 0;
  let last: Line<R> | undefined;
  let firstRequestLine: number | null = null;
  let requestId: string | null = null;
  let model: string | null = null;
  let systemSkills: string | null = null;
  let didWork = false;
  for (const l of lines) {
    const { rec, line } = l;
    const t = rec["type"];
    const m = obj(rec["message"]);
    if (t === "message_start" && m["role"] === "system" && systemSkills === null) {
      systemSkills = str(obj(m["sections"])["skills"]) ?? "";
    } else if (t === "message_start" && m["role"] === "assistant") {
      firstRequestLine ??= line;
    } else if (t === "message_end" && m["role"] === "assistant") {
      last = l;
      model = str(m["model"]);
      requestId = str(m["responseId"]);
      const stop = str(m["stopReason"]);
      if (stop !== null && WORK_STOPS.has(stop)) didWork = true;
      const a: Agg = usage.get(model ?? "") ?? {
        requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, problems: [],
      };
      usage.set(model ?? "", a);
      a.requests++;
      if (m["provider"] !== PI_PROVIDER) {
        a.problems.push(`line ${line}: provider ${String(m["provider"])}, expected ${PI_PROVIDER}`);
      }
      const u = obj(m["usage"]);
      const n = (k: string): number => {
        const v = u[k];
        if (isCount(v)) return v;
        a.problems.push(`line ${line}: usage.${k} missing or not a count`);
        return 0;
      };
      const [i, o, cr, cw, total] = [n("input"), n("output"), n("cacheRead"), n("cacheWrite"), n("totalTokens")];
      if (total !== i + o + cr + cw) {
        a.problems.push(`line ${line}: totalTokens ${total} != input + output + cacheRead + cacheWrite`);
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
      reported = reported !== null && typeof c === "number" && Number.isFinite(c) && c >= 0 ? reported + c : null;
    } else if (t === "tool_execution_start") {
      didWork = true;
      const id = str(rec["toolCallId"]);
      const name = str(rec["toolName"]);
      if (id === null || name === null) {
        refuse(`${file}:${line}: tool_execution_start without a string toolCallId and toolName`);
      }
      const seen = started.get(id);
      if (seen !== undefined) refuse(`${file}:${line}: tool call ${id} repeats line ${seen}`);
      started.set(id, line);
      const out = outcomes.get(id);
      trace.push(ev({
        call_id: id, request_id: requestId, tool: name,
        transport: SHELL_TOOLS.has(name) ? "shell" : "builtin",
        outcome: out ? (out.error ? "error" : "ok") : null,
        result_bytes: out?.bytes ?? null, model,
      }));
    } else if (t === "auto_retry_start") {
      trace.push(ev({ type: "retry", request_id: requestId, model }));
    }
  }
  for (const id of [...outcomes.keys()].sort()) {
    if (!started.has(id)) streamProblems.push(`tool_execution_end for unknown ${id}`);
  }

  // Cost: pi/OpenRouter cache writes at the 5-minute rate (owner decision pi-cache-ttl).
  const models = [...usage.keys()].sort();
  const tokens: ModelTokens[] = models.map((k) => {
    const a = usage.get(k)!;
    return {
      model: k, requests: a.requests, input: a.input, cache_read: a.cacheRead,
      cache_write_5m: a.cacheWrite, cache_write_1h: 0, cache_write_unknown: 0,
      output: a.output, reasoning: a.reasoning, problems: a.problems,
    };
  });
  const written = tokens.reduce((s, x) => s + x.cache_write_5m, 0);
  const assumptions = written > 0
    ? [{ key: TTL_ASSUMPTION, tokens: written, decision: "2026-09-25-pi-cache-ttl" }]
    : [];
  const priced = estimateCost(tokens, input.pricing);
  const gaps = [
    ...(nonJson.count > 0 ? [`${nonJsonReason(nonJson)}: a lost line may have been a usage record`] : []),
    ...(!settled ? ["no agent_settled: the run was cut, the last request's usage may be missing"] : []),
    ...(retryPending ? ["retry without auto_retry_end: a request may be missing"] : []),
    ...costGaps,
  ];
  const est = gaps.length > 0
    ? { ...priced, cost_usd: null, pricing_snapshot: null, missing: [...gaps, ...priced.missing] }
    : priced;

  // Termination (plan M3-01 rules 1 to 7).
  const limit = input.manifest.limits.max_budget_usd;
  const armedOk = armed !== undefined && armed["limit_usd"] === limit &&
    (firstRequestLine === null || armedLine!.line < firstRequestLine);
  if (settled && !armedOk) {
    streamProblems.push(
      armed === undefined
        ? "budget guard not armed (no cg-budget armed entry)"
        : armed["limit_usd"] !== limit
        ? `budget guard limit ${String(armed["limit_usd"])}, manifest ${limit}`
        : "budget guard armed after the first provider request",
    );
  }
  const lastMsg = last ? obj(last.rec["message"]) : null;
  const stop = lastMsg ? str(lastMsg["stopReason"]) : null;
  const retryFailed = lastRetryEnd !== undefined && lastRetryEnd.rec["success"] === false &&
    lastRetryEnd.line > (last?.line ?? 0);
  let failure: string | null = null;
  let completed = false;
  if (retryFailed) failure = str(lastRetryEnd!.rec["finalError"]) ?? "";
  else if (stop === "stop" || stop === "length") completed = true;
  else if (stop === "error" || stop === "aborted") failure = str(lastMsg!["errorMessage"]) ?? "";
  else {
    if (stop !== null && stop !== "toolUse") streamProblems.push(`unknown stopReason ${stop}`);
    failure = "";
  }
  let termination: Termination | null;
  if (entry?.["ready"] === false) termination = "setup_failed";
  else if (exhausted !== undefined) termination = "budget_exhausted";
  else if (!settled || retryPending) termination = null;
  else if (!armedOk) termination = "setup_failed";
  else if (completed) termination = "completed";
  else termination = LIMIT_TEXT.test(failure ?? "") ? "usage_limited" : "harness_crash";

  const slugOf = (api: string) =>
    Object.hasOwn(input.pricing.models, api) ? input.pricing.models[api]!.slug : api;
  const skillNames = new Set(
    [...(systemSkills ?? "").matchAll(/<name>([^<]+)<\/name>/g)].map((x) => x[1]!.trim()),
  );
  const wantSkills = [...new Set((input.manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!))];
  const loaded = systemSkills === null ? null : [
    ...(input.manifest.skills && wantSkills.length > 0 && wantSkills.every((s) => skillNames.has(s)) ? ["skills"] : []),
  ];
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    ["instructions", "agents", "hooks"].includes(c) || c.startsWith("plugin:") ||
    c.startsWith("lsp:") || c.startsWith("mcp:") || c.startsWith("toolchain:")
  );
  return {
    telemetry: {
      harness_version: version,
      cost_usd: est.cost_usd,
      cost_source: est.cost_usd !== null ? "estimated" : null,
      pricing_snapshot: est.cost_usd !== null ? est.pricing_snapshot : null,
      reported_cost_usd: last === undefined ? null : reported,
      per_model: est.per_model,
      turns: settled ? of("turn_end").length : null,
      compactions: null,
      wall_ms: null,
      exit_code: input.exitCode,
      stop_reason: stop,
      refusal_detected: null,
      raw_usage: toJson({
        usage: Object.fromEntries(models.map((k) => [k, usage.get(k)])),
        reported_cost_total: reported,
        budget: exhausted ? obj(obj(exhausted.rec["entry"])["data"]) : null,
        assumptions,
        missing: est.missing,
        stream_problems: streamProblems,
      }),
    },
    observed: {
      harness_version: version,
      models: last === undefined ? null : models.map(slugOf),
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

Implementation notes: the `ready: false` test has no `agent_settled`; rule 1 comes first so it is `setup_failed`, and `didWork` is false (no records). The "armed after the first request" test inserts the armed entry just before `agent_settled`, so its line is after the first assistant `message_start`. `only(of("session"))` is called for its refusal only.

`src/harness/report.ts`: add `cost_assumptions: Record<string, number>` to `ArmCoverage`; in the coverage builder:

```typescript
      const assumed: Record<string, number> = {};
      for (const e of es) {
        const raw = e.telemetry.raw_usage;
        const list = raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as { assumptions?: unknown }).assumptions
          : undefined;
        const keys = new Set(
          (Array.isArray(list) ? list : []).map((a) => (a as { key?: unknown })?.key)
            .filter((k): k is string => typeof k === "string"),
        );
        for (const k of keys) assumed[k] = (assumed[k] ?? 0) + 1;
      }
```

and return `cost_assumptions: Object.fromEntries(Object.entries(assumed).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))`; in `renderReport`'s coverage line append `, cost assumptions: ${reasons(c.cost_assumptions)}` (prints `none` when empty).

- [ ] **Step 6: Run to see them pass**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts tests/unit/harness/report.test.ts tests/unit/harness/claude-code.test.ts`
Expected: PASS (16 pi tests; report and Claude Code counts plus one).

- [ ] **Step 7: Check, lint, format** (`src/harness/adapters/{jsonl,pi,claude-code}.ts`, `src/harness/report.ts`, both tests)

- [ ] **Step 8: Commit**

```bash
git add src/harness/adapters/jsonl.ts src/harness/adapters/pi.ts src/harness/adapters/claude-code.ts src/harness/report.ts tests/unit/harness/pi.test.ts tests/unit/harness/report.test.ts
git commit -m "feat(harness): pi stream parser with settlement, retries and disclosed cache TTL (M3-01)"
```

**Acceptance (no container):** the three test files pass; `git diff master -- src/harness/adapters/claude-code.ts` shows only the moved helpers and imports.

---

### Task M3-02: pi adapter, image, budget guard, config, probe script and the real-runtime proof

**Budget guard** (`harness/images/pi/cg-budget.ts`, loaded with `-e`; explicit `-e` loads even with `--no-extensions`):
- reads the key file (`CG_PI_KEY_FILE`, default `C:\cg-secrets\openrouter-api-key`) and registers it with `pi.registerProvider("openrouter", { apiKey })`; a missing file, a key under 16 characters, or one starting with `$` or `!` (pi would interpolate it) throws, so pi has no OpenRouter credential and makes no paid request;
- on the first `agent_start` only: `pi.appendEntry("cg-budget", { event: "armed", limit_usd })`;
- on each assistant `message_end`: `budgetStep` adds `usage.cost.total`; any billable usage (input, output, cache read or cache write above 0) with a missing, negative or zero cost is `unpriced` (fails closed); at `spent >= limit` or `unpriced`: `appendEntry("cg-budget", { event: "exhausted", spent_usd, limit_usd, reason })`, then `ctx.abort()`; from then on every `tool_call` is blocked;
- overshoot is bounded by one request: the check runs at request boundaries, so a run can exceed the limit by the cost of the request that crossed it. The OpenRouter key's own credit cap (set in the console) is defense in depth, not the proof.

**Agent settings** (recorded): `nativeSettings` returns `pi_settings = { compaction: { enabled: false }, cacheWarming: "off", retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, provider: { maxRetries: 0 } } }` next to `provider` and `api_models`; `run.ps1` writes it to an isolated `PI_CODING_AGENT_DIR` (`C:\pi-agent`, empty otherwise, so no agent-level context file, skill, extension or `models.json`). Context files: pi still discovers `AGENTS.md`/`CLAUDE.md` in `C:\workspace` and its parents (`docs/configuration.md`: discovery does not need trust); the workspace is staged and hashed, `C:\` holds none; Claude Code reads `CLAUDE.md` only. That difference is documented, not hidden (open question 5).

`run.ps1`: waits for `C:\cg-secrets\ready` (poll 500 ms, bounded by `CG_READY_TIMEOUT_S`, default 600; on timeout writes `cg_entry` with `ready: false`, exits 3, pi never starts); then `pi --version`; writes `cg_entry`; runs `pi --mode json --no-session --offline --no-approve --no-extensions -e C:\cg-budget.ts --no-skills [--skill C:\config\bundle\skills] [--append-system-prompt <file>] [--thinking <level>] --provider openrouter --model <api id>` with the prompt on stdin. `--no-skills` is always passed.

**Lane:** infra. **Deps:** M3-01, M1-20 (on master). **Date:** 09-27 to 09-28.

**Files:**
- Modify: `src/harness/adapters/pi.ts` (adapter object), `src/harness/adapters/mod.ts` (register)
- Create: `harness/images/pi/Dockerfile.windows`, `harness/images/pi/run.ps1`, `harness/images/pi/cg-budget.ts`, `harness/configs/pi-flash-plain.yml`, `scripts/harness/pi-probe.ts`, `tests/integration/harness/pi-runtime.test.ts`, `tests/integration/harness/fake-openrouter.ts`
- Test: `tests/unit/harness/pi.test.ts` (append)

**Interfaces:**
- Consumes: `parsePiStream`, `PI_ROUTE`, `PI_PROVIDER` (M3-01).
- Produces: `piAdapter: HarnessAdapter` (harness `pi`, `secretFiles: ["openrouter-api-key"]`, `credentialBearing: true`, `enforcesBudget: true`, declared `harness_version`, `cost_usd`, `reported_cost_usd`, `per_model`, `turns`, `exit_code`, `stop_reason`); `PI_SETTINGS` (the recorded agent settings); `budgetStep(spent: number, message: unknown): { spent: number; unpriced: boolean }`; `startFakeOpenRouter(script: FakeTurn[]): { baseUrl; requests: { auth: string | null; body: unknown }[]; close() }`; config `pi-flash-plain`.

- [ ] **Step 1: Write the failing unit tests** (append to `tests/unit/harness/pi.test.ts`; merge imports)

```typescript
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { PI_SETTINGS, piAdapter } from "../../../src/harness/adapters/pi.ts";
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
  id: "pi", harness: "pi", harness_version: "0.87.1", models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: {}, limits: { timeout_min: 30, max_budget_usd: 2 },
});

Deno.test("pi adapter: registered; contract fields; parse writes the trace; a missing log is not a result", async () => {
  assertEquals(adapterFor("pi"), piAdapter);
  assertEquals([piAdapter.credentialBearing, piAdapter.enforcesBudget, piAdapter.secretFiles], [true, true, ["openrouter-api-key"]]);
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), HEAD + await Deno.readTextFile(FIXTURE));
  const r = await piAdapter.parse({ rawLog: join(dir, "raw.jsonl"), exitCode: 0, manifest: pm(), pricing: BOOK, traceOut: join(dir, "trace.jsonl") });
  assertEquals(r.traceEvents, 4);
  assertEquals((await Deno.readTextFile(join(dir, "trace.jsonl"))).trim().split("\n").length, 4);
  const missing = await piAdapter.parse({ rawLog: join(dir, "absent.jsonl"), exitCode: null, manifest: pm(), pricing: BOOK, traceOut: join(dir, "t2.jsonl") });
  assertEquals(missing.termination, null);
  assertStringIncludes(JSON.stringify(missing.telemetry.raw_usage), "raw log missing");
});

Deno.test("pi adapter: nativeSettings records the agent settings; one openrouter model; unsupported components refused", () => {
  assertEquals(piAdapter.nativeSettings(CFG, CATALOG), {
    provider: "openrouter", api_models: { main: "google/gemini-3.8-flash" }, pi_settings: PI_SETTINGS,
  });
  assertEquals(PI_SETTINGS.compaction.enabled, false);
  assertEquals(PI_SETTINGS.cacheWarming, "off");
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
    [{ settings: { pi_settings: {} } }, "unknown setting pi_settings"],
  ];
  for (const [over, msg] of bad) assertThrows(() => piAdapter.nativeSettings({ ...CFG, ...over }, CATALOG), ConfigurationError, msg);
});

Deno.test("run.ps1 never handles the key; the image pins pi 0.87.1 and has no secret", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  for (const s of ["--api-key", "OPENROUTER_API_KEY", "openrouter-api-key"]) assert(!run.includes(s), s);
  const docker = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(docker, "@earendil-works/pi-coding-agent@0.87.1");
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(docker));
  assertStringIncludes(docker, "COPY cg-budget.ts C:/cg-budget.ts");
});

Deno.test("run.ps1: waits for ready before pi, isolated agent dir, guard explicit, JSON mode, offline, stdin prompt", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  for (const s of [
    "C:\\cg-secrets\\ready", "CG_READY_TIMEOUT_S", "ready = $false", "exit 3", "$env:PI_CODING_AGENT_DIR = 'C:\\pi-agent'",
    "$cfg.settings.pi_settings", "'--mode', 'json'", "'--no-session'", "'--offline'", "'--no-approve'", "'--no-extensions'",
    "'-e', 'C:\\cg-budget.ts'", "'--no-skills'", "$env:CG_MAX_BUDGET_USD", "$env:PI_OFFLINE = '1'", "type = 'cg_entry'",
    "| & pi @piArgs", "'--append-system-prompt'", "-Encoding UTF8",
  ]) assertStringIncludes(run, s);
  const wait = run.indexOf("C:\\cg-secrets\\ready");
  assert(wait < run.indexOf("& pi --version") && wait < run.indexOf("| & pi @piArgs"), "no pi before ready");
});

Deno.test("cg-budget: sums assistant cost, ignores other roles, fails closed on any unpriced billable usage", () => {
  const a = (total: unknown, u: Record<string, number> = { output: 10 }) => ({ role: "assistant", usage: { ...u, cost: { total } } });
  assertEquals(budgetStep(0, a(0.5)), { spent: 0.5, unpriced: false });
  assertEquals(budgetStep(0.5, { role: "toolResult", usage: { cost: { total: 9 } } }), { spent: 0.5, unpriced: false });
  assertEquals(budgetStep(0, a(0, { output: 0 })), { spent: 0, unpriced: false }, "an empty error message costs nothing");
  assertEquals(budgetStep(0, a(0)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(0, { input: 1000 })), { spent: 0, unpriced: true }, "input-only usage");
  assertEquals(budgetStep(0, a(0, { cacheRead: 5 })), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(undefined)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(-1)), { spent: 0, unpriced: true });
});

Deno.test("pi-flash-plain: loads and passes the catalog check", async () => {
  const cfg = await loadConfig("harness", "pi-flash-plain");
  await checkModelsInCatalog([cfg], "site/catalog");
  assertEquals(cfg.harness, piAdapter.harness);
});
```

- [ ] **Step 2: Write the failing runtime test**

`tests/integration/harness/fake-openrouter.ts` (a scripted OpenAI-compatible streaming endpoint on 127.0.0.1; each request consumes the next scripted turn, the last one repeats):

```typescript
export type FakeTurn =
  | { kind: "text"; text: string; usage: { prompt_tokens: number; completion_tokens: number } }
  | { kind: "tool"; name: string; args: Record<string, unknown>; usage: { prompt_tokens: number; completion_tokens: number } }
  | { kind: "status"; status: number; body: string };

export function startFakeOpenRouter(script: FakeTurn[]) {
  const requests: { auth: string | null; body: unknown }[] = [];
  const sse = (chunks: unknown[]) =>
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    requests.push({ auth: req.headers.get("authorization"), body: await req.json().catch(() => null) });
    const turn = script[Math.min(requests.length - 1, script.length - 1)]!;
    if (turn.kind === "status") return new Response(turn.body, { status: turn.status });
    const base = { id: `gen-${requests.length}`, object: "chat.completion.chunk", model: "google/gemini-3.8-flash" };
    const delta = turn.kind === "text"
      ? { role: "assistant", content: turn.text }
      : { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: turn.name, arguments: JSON.stringify(turn.args) } }] };
    const usage = { ...turn.usage, total_tokens: turn.usage.prompt_tokens + turn.usage.completion_tokens };
    return new Response(
      sse([
        { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.kind === "text" ? "stop" : "tool_calls" }], usage },
      ]),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  return { baseUrl: `http://127.0.0.1:${server.addr.port}/v1`, requests, close: () => server.shutdown() };
}
```

`tests/integration/harness/pi-runtime.test.ts` (runs only when `CG_PI_CLI` names pi 0.87.1's `dist/bundle/cli.js`; `ignore` otherwise, and a reported skip is not an acceptance):

```typescript
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parsePiStream, PI_SETTINGS } from "../../../src/harness/adapters/pi.ts";
import { loadPricingBook } from "../../../src/harness/pricing.ts";
import { manifest } from "../../unit/harness/fixtures.ts";
import { type FakeTurn, startFakeOpenRouter } from "./fake-openrouter.ts";

const CLI = Deno.env.get("CG_PI_CLI");
const KEY = "sk-or-v1-cgfake" + "0".repeat(48);

async function runPi(script: FakeTurn[], o: { limit: number; guard?: boolean; model?: string }) {
  const fake = startFakeOpenRouter(script);
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const agent = join(dir, "agent");
  const ws = join(dir, "ws");
  await Deno.mkdir(agent);
  await Deno.mkdir(ws);
  await Deno.writeTextFile(join(agent, "settings.json"), JSON.stringify({ ...PI_SETTINGS, retry: { ...PI_SETTINGS.retry, baseDelayMs: 10 } }));
  // A zero-cost model entry (o.model) replaces openrouter's built-in list for that run only.
  const zero = { id: o.model, name: "zero cost", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
  await Deno.writeTextFile(join(agent, "models.json"), JSON.stringify({ providers: { openrouter: { baseUrl: fake.baseUrl, ...(o.model ? { api: "openai-completions", models: [zero] } : {}) } } }));
  await Deno.writeTextFile(join(dir, "key"), KEY);
  const args = [CLI!, "--mode", "json", "--no-session", "--offline", "--no-approve", "--no-extensions",
    ...(o.guard === false ? [] : ["-e", join(Deno.cwd(), "harness", "images", "pi", "cg-budget.ts")]),
    "--no-skills", "--provider", "openrouter", "--model", o.model ?? "google/gemini-3.8-flash"];
  const child = new Deno.Command("node", {
    args, cwd: ws, stdin: "piped", stdout: "piped", stderr: "piped", clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "", SystemRoot: Deno.env.get("SystemRoot") ?? "",
      PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", CG_PI_KEY_FILE: join(dir, "key"), CG_MAX_BUDGET_USD: String(o.limit),
    },
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode("Run the command echo hi, then reply ok."));
  await w.close();
  const out = await child.output();
  await fake.close();
  const text = `{"type":"cg_entry","pi_version":"0.87.1","max_budget_usd":${o.limit},"ready":true}\n` + new TextDecoder().decode(out.stdout);
  const r = parsePiStream(text, {
    rawLog: "runtime", exitCode: out.code, pricing: await loadPricingBook("site/catalog", new Date()),
    manifest: manifest("pi", { harness: "pi", harness_version: "0.87.1", models: { main: "openrouter/google/gemini-3.8-flash" }, provider_routes: { main: "openrouter:api-key" }, limits: { timeout_min: 5, max_budget_usd: o.limit } }),
  });
  return { r, text, requests: fake.requests, code: out.code };
}

const TEXT: FakeTurn = { kind: "text", text: "ok", usage: { prompt_tokens: 1000, completion_tokens: 10 } };
const TOOL: FakeTurn = { kind: "tool", name: "bash", args: { command: "echo hi" }, usage: { prompt_tokens: 1000, completion_tokens: 10 } };
const opts = { ignore: !CLI, sanitizeResources: false, sanitizeOps: false };
const armedCount = (t: string) => t.split("\n").filter((l) => l.includes('"customType":"cg-budget"') && l.includes('"event":"armed"')).length;

Deno.test({ name: "pi runtime: one armed record with the effective limit, the key only in the Authorization header", ...opts, async fn() {
  const { r, text, requests } = await runPi([TOOL, TEXT], { limit: 5 });
  assertEquals(armedCount(text), 1);
  assertEquals(r.termination, "completed");
  assert(requests.length >= 2 && requests.every((q) => q.auth === `Bearer ${KEY}`));
  assert(!text.includes(KEY), "the key never reaches stdout");
} });

Deno.test({ name: "pi runtime: a trip stops further provider requests", ...opts, async fn() {
  const { r, requests } = await runPi([TOOL, TOOL, TEXT], { limit: 0.000001 });
  assertEquals(r.termination, "budget_exhausted");
  assertEquals((r.telemetry.raw_usage as { budget: { reason: string } }).budget.reason, "limit");
  assertEquals(requests.length, 1, "no request after the trip");
} });

Deno.test({ name: "pi runtime: guard missing: pi makes no provider request", ...opts, async fn() {
  const { r, requests } = await runPi([TEXT], { limit: 5, guard: false });
  assertEquals(requests.length, 0, "no key without the guard, so no request");
  assert(r.termination !== "completed");
  assertEquals(r.didWork, false);
} });

Deno.test({ name: "pi runtime: one armed record across retries; retry then success completes", ...opts, async fn() {
  const { r, text } = await runPi([{ kind: "status", status: 500, body: "boom" }, TEXT], { limit: 5 });
  assertEquals(armedCount(text), 1);
  assertEquals(r.termination, "completed");
  assert(r.trace.some((e) => e.type === "retry"));
} });

Deno.test({ name: "pi runtime: scripted 500s end in harness_crash, scripted 429s in usage_limited", ...opts, async fn() {
  assertEquals((await runPi([{ kind: "status", status: 500, body: "boom" }], { limit: 5 })).r.termination, "harness_crash");
  assertEquals((await runPi([{ kind: "status", status: 429, body: "rate limit" }], { limit: 5 })).r.termination, "usage_limited");
} });

Deno.test({ name: "pi runtime: unpriced billable usage fails closed", ...opts, async fn() {
  const { r, requests } = await runPi([TEXT, TEXT], { limit: 5, model: "cg/zero-cost" });
  assertEquals(r.termination, "budget_exhausted");
  assertEquals((r.telemetry.raw_usage as { budget: { reason: string } }).budget.reason, "unpriced");
  assertEquals(requests.length, 1);
} });
```

If pi 0.87.1 rejects the zero-cost `models.json` entry, add the fields its error message names and record them in the commit message; the assertions stay.

- [ ] **Step 3: Run to see them fail**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts` (FAIL: `piAdapter` missing). Run: `CG_PI_CLI="C:\Users\SShadowS\AppData\Local\nvm\v24.14.0\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" deno test --allow-all tests/integration/harness/pi-runtime.test.ts` (FAIL: guard file missing).

- [ ] **Step 4: Implement**

Append to `src/harness/adapters/pi.ts` (merge imports: `import type { HarnessAdapter } from "../adapter.ts";`, `import { ConfigurationError } from "../../errors.ts";`, `import { writeTrace } from "../trace.ts";`):

```typescript
/** pi agent settings written into the isolated agent directory (recorded in the manifest). */
export const PI_SETTINGS = {
  compaction: { enabled: false },
  cacheWarming: "off",
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2000, provider: { maxRetries: 0 } },
} as const;
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export const piAdapter: HarnessAdapter = {
  harness: "pi",
  declared: ["harness_version", "cost_usd", "reported_cost_usd", "per_model", "turns", "exit_code", "stop_reason"],
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
        `${config.id}: pi 0.87.1 has no MCP and supports only instructions, skills and toolchain (refused: ${unsupported.join(", ")})`,
      );
    }
    const slots = Object.keys(config.models);
    if (slots.length !== 1 || slots[0] !== "main") {
      throw new ConfigurationError(`${config.id}: pi takes exactly one model slot, main (got ${slots.join(", ")})`);
    }
    const slug = config.models["main"]!;
    if (!slug.startsWith(`${PI_PROVIDER}/`)) {
      throw new ConfigurationError(`${config.id}: pi runs through ${PI_PROVIDER}; ${slug} is not an ${PI_PROVIDER}/ slug`);
    }
    const m = catalog.models.find((x) => x.slug === slug);
    if (!m) throw new ConfigurationError(`model ${slug} (slot main) is not in the catalog`);
    for (const k of Object.keys(config.settings)) {
      if (k !== "thinking") throw new ConfigurationError(`${config.id}: unknown setting ${k} for pi (known: thinking)`);
    }
    const t = config.settings["thinking"];
    if (t !== undefined && !(typeof t === "string" && THINKING.has(t))) {
      throw new ConfigurationError(`${config.id}: thinking must be one of ${[...THINKING].join(", ")}`);
    }
    return { ...config.settings, provider: PI_PROVIDER, api_models: { main: m.api_model_id }, pi_settings: PI_SETTINGS };
  },
  providerRoutes(config) {
    return Object.fromEntries(Object.keys(config.models).map((slot) => [slot, PI_ROUTE]));
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

(`nativeSettings` output contains `PI_SETTINGS` as a readonly constant; the manifest schema takes `Record<string, unknown>`, so the value is JSON-cloned by `resolveManifest`'s parse; the equality test compares values.)

`src/harness/adapters/mod.ts`: `import { piAdapter } from "./pi.ts";`, `pi: piAdapter,` in `ADAPTERS`, header comment "(M1-32 adds claude-code, M3-02 adds pi, M1-35 adds mock)".

`harness/images/pi/cg-budget.ts`:

```typescript
// Budget guard and sole key holder for pi 0.87.1 (adapter contract
// enforcesBudget; pi has no budget flag). Loaded by run.ps1 with
// `-e C:\cg-budget.ts`. The OpenRouter key is registered here, so a guard
// that fails to load leaves pi without a credential. Records go through
// pi.appendEntry (JSON-mode entry_appended); stdout belongs to pi. A trip
// aborts the current operation and blocks every later tool call. Overshoot
// is bounded by the request that crossed the limit.
import { readFileSync } from "node:fs";
import process from "node:process";

interface Msg {
  role?: unknown;
  usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; cost?: { total?: unknown } };
}
interface Ctx {
  abort(): void;
}
interface Api {
  registerProvider(name: string, config: { apiKey: string }): void;
  appendEntry(customType: string, data: unknown): void;
  on(event: "agent_start", h: () => void): void;
  on(event: "message_end", h: (e: { message: Msg }, ctx: Ctx) => void): void;
  on(event: "tool_call", h: () => { block: true; reason: string } | undefined): void;
}

const pos = (v: unknown) => typeof v === "number" && v > 0;

export function budgetStep(spent: number, message: unknown): { spent: number; unpriced: boolean } {
  const m = (message ?? {}) as Msg;
  if (m.role !== "assistant") return { spent, unpriced: false };
  const u = m.usage ?? {};
  const billable = pos(u.input) || pos(u.output) || pos(u.cacheRead) || pos(u.cacheWrite);
  const total = u.cost?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return { spent, unpriced: billable || total !== undefined };
  }
  if (billable && total === 0) return { spent, unpriced: true };
  return { spent: spent + total, unpriced: false };
}

export default function (pi: Api): void {
  const limit = Number(process.env["CG_MAX_BUDGET_USD"]);
  if (!(Number.isFinite(limit) && limit > 0)) throw new Error("CG_MAX_BUDGET_USD must be a positive number");
  const key = readFileSync(process.env["CG_PI_KEY_FILE"] ?? "C:\\cg-secrets\\openrouter-api-key", "utf8").trim();
  if (key.length < 16 || key.startsWith("$") || key.startsWith("!")) throw new Error("provider key file is not a usable literal key");
  pi.registerProvider("openrouter", { apiKey: key });
  let armed = false;
  let tripped = false;
  let spent = 0;
  pi.on("agent_start", () => {
    if (armed) return;
    armed = true;
    pi.appendEntry("cg-budget", { event: "armed", limit_usd: limit });
  });
  pi.on("tool_call", () => tripped ? { block: true, reason: "budget exhausted" } : undefined);
  pi.on("message_end", (e, ctx) => {
    if (tripped) return;
    const s = budgetStep(spent, e.message);
    spent = s.spent;
    if (s.unpriced || spent >= limit) {
      tripped = true;
      pi.appendEntry("cg-budget", { event: "exhausted", spent_usd: spent, limit_usd: limit, reason: s.unpriced ? "unpriced" : "limit" });
      ctx.abort();
    }
  });
}
```

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

`harness/images/pi/run.ps1`:

```powershell
# pi entrypoint (spec 1a section 5 item 3; findings sections 3 and 4; M1-33
# credential release). Waits for the runner's ready file, isolates pi's agent
# directory with the recorded settings, writes our cg_entry record, then runs
# pi 0.87.1 in JSON mode with the prompt on stdin. This script never reads the
# provider key: the budget guard (-e C:\cg-budget.ts) is its only holder.
# Windows PowerShell 5.1: every text read names UTF-8.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$global:OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$cfg = Get-Content 'C:\config\settings.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$budget = [double]$cfg.limits.max_budget_usd
$timeout = if ($env:CG_READY_TIMEOUT_S) { [int]$env:CG_READY_TIMEOUT_S } else { 600 }
$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not (Test-Path 'C:\cg-secrets\ready')) {
  if ($sw.Elapsed.TotalSeconds -ge $timeout) {
    $entry = @{ type = 'cg_entry'; pi_version = ''; max_budget_usd = $budget; ready = $false }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $entry -Compress))
    exit 3
  }
  Start-Sleep -Milliseconds 500
}
$env:PI_CODING_AGENT_DIR = 'C:\pi-agent'
New-Item -ItemType Directory -Force -Path $env:PI_CODING_AGENT_DIR | Out-Null
[IO.File]::WriteAllText("$env:PI_CODING_AGENT_DIR\settings.json", (ConvertTo-Json -InputObject $cfg.settings.pi_settings -Depth 8), $utf8)
$env:PI_OFFLINE = '1'
$env:CG_MAX_BUDGET_USD = [string]$budget
$version = (& pi --version | Out-String).Trim()
$entry = @{ type = 'cg_entry'; pi_version = $version; max_budget_usd = $budget; ready = $true }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $entry -Compress))
$piArgs = @('--mode', 'json', '--no-session', '--offline', '--no-approve', '--no-extensions', '-e', 'C:\cg-budget.ts', '--no-skills')
if (Test-Path 'C:\config\bundle\skills') { $piArgs += @('--skill', 'C:\config\bundle\skills') }
if (Test-Path 'C:\config\bundle\instructions') {
  $instructions = @(Get-ChildItem 'C:\config\bundle\instructions' -File)
  if ($instructions.Count -ne 1) { throw "bundle instructions must hold exactly one file, found $($instructions.Count)" }
  $piArgs += @('--append-system-prompt', $instructions[0].FullName)
}
if ($cfg.settings.thinking) { $piArgs += @('--thinking', $cfg.settings.thinking) }
$piArgs += @('--provider', $cfg.settings.provider, '--model', $cfg.settings.api_models.main)
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

`scripts/harness/pi-probe.ts` (ops helper for M3-04; `deno check` only; every branch runs a container):

```typescript
// Usage: deno run --allow-all scripts/harness/pi-probe.ts <image-id> <out-dir> [--proxy-log <host-ip>] [--no-ready]
//        [--skills <dir>] [--instructions <dir>]
// Runs the pi image once with a FAKE OpenRouter key (no credential, no spend) and prints the parse.
// --proxy-log <ip> points HTTPS_PROXY at a listener on <ip>:3999 that logs each request line and
// answers 403 (shows whether pi honors the proxy and which hosts it contacts). --no-ready withholds
// C:\cg-secrets\ready (CG_READY_TIMEOUT_S=10): pi must never start.
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import { parsePiStream, PI_SETTINGS } from "../../src/harness/adapters/pi.ts";
import { ResolvedManifestSchema } from "../../src/harness/manifest.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { realDocker, runSandbox } from "../../src/harness/sandbox.ts";

const a = parseArgs(Deno.args, { boolean: ["no-ready"], string: ["proxy-log", "skills", "instructions"] });
const [imageId, outArg] = a._.map(String);
if (!imageId || !outArg) throw new Error("usage: pi-probe.ts <image-id> <out-dir>");
await Deno.mkdir(outArg, { recursive: true });
const out = await Deno.realPath(outArg);
const d = (n: string) => join(out, n);
for (const n of ["workspace", "task", "config", "secrets"]) await Deno.mkdir(d(n), { recursive: true });
const copyDir = async (src: string, dst: string) => {
  await Deno.mkdir(dst, { recursive: true });
  for await (const e of Deno.readDir(src)) {
    if (e.isDirectory) await copyDir(join(src, e.name), join(dst, e.name));
    else if (e.isFile) await Deno.copyFile(join(src, e.name), join(dst, e.name));
  }
};
const FAKE = "sk-or-v1-cgprobe" + "0".repeat(48);
await Deno.writeTextFile(join(d("secrets"), "openrouter-api-key"), FAKE);
if (!a["no-ready"]) await Deno.writeTextFile(join(d("secrets"), "ready"), "");
await Deno.writeTextFile(join(d("task"), "prompt.md"), "Reply with the single word ok.\n");
if (a.skills) await copyDir(a.skills, join(d("config"), "bundle", "skills"));
if (a.instructions) await copyDir(a.instructions, join(d("config"), "bundle", "instructions"));
await Deno.writeTextFile(join(d("config"), "settings.json"), JSON.stringify({
  harness: "pi", harness_version: "0.87.1", models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: { provider: "openrouter", api_models: { main: "google/gemini-3.8-flash" }, pi_settings: PI_SETTINGS },
  limits: { timeout_min: 5, max_budget_usd: 0.05 }, toolchain: [],
}));
const env: Record<string, string> = a["no-ready"] ? { CG_READY_TIMEOUT_S: "10" } : {};
let listener: Deno.Listener | undefined;
if (a["proxy-log"]) {
  listener = Deno.listen({ hostname: a["proxy-log"], port: 3999 });
  env["HTTPS_PROXY"] = env["HTTP_PROXY"] = `http://${a["proxy-log"]}:3999`;
  (async () => {
    for await (const c of listener!) {
      const buf = new Uint8Array(1024);
      const n = (await c.read(buf)) ?? 0;
      await Deno.writeTextFile(d("proxy.log"), new TextDecoder().decode(buf.subarray(0, n)).split("\r\n")[0] + "\n", { append: true });
      await c.write(new TextEncoder().encode("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
      c.close();
    }
  })().catch(() => {});
}
const id = crypto.randomUUID();
const res = await runSandbox(realDocker(), {
  name: `cg-harness-probe-${id}`, owner: Deno.hostname(), executionId: id, imageId,
  workspace: d("workspace"), taskDir: d("task"), configDir: d("config"), secretsDir: d("secrets"),
  extraMounts: [], env, timeoutMs: 180_000, killGraceMs: 30_000, opTimeoutMs: 60_000,
  maxCaptureBytes: 16 * 1024 * 1024, rawLog: d("raw.jsonl"), stderrLog: d("stderr.txt"),
}, [FAKE]);
listener?.close();
const m = ResolvedManifestSchema.parse({
  v: 1, rules: "probe", config_id: "pi-probe", harness: "pi", harness_version: "0.87.1",
  models: { main: "openrouter/google/gemini-3.8-flash" }, settings: { requested: {}, native: {} },
  limits: { timeout_min: 5, max_budget_usd: 0.05 }, instructions: null, skills: null, agents: null, hooks: null,
  plugins: [], mcp: [], lsp: [], toolchain: [], image: { digest: imageId, base_digest: "probe" },
  backend_version: "probe", provider_routes: { main: "openrouter:api-key" },
});
const r = parsePiStream(await Deno.readTextFile(d("raw.jsonl")), {
  rawLog: d("raw.jsonl"), exitCode: res.exitCode, manifest: m, pricing: await loadPricingBook("site/catalog", new Date()),
});
console.log(JSON.stringify({ sandbox: res, termination: r.termination, didWork: r.didWork, observed: r.observed, telemetry: r.telemetry }, null, 2));
```

- [ ] **Step 5: Run to see them pass**

Run: `deno test --allow-all tests/unit/harness/pi.test.ts`
Expected: PASS (22 tests).
Run: `CG_PI_CLI="C:\Users\SShadowS\AppData\Local\nvm\v24.14.0\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js" deno test --allow-all tests/integration/harness/pi-runtime.test.ts`
Expected: PASS, 6 tests, none ignored. If the `models.json` baseUrl override for the built-in `openrouter` provider is not honored (the fake receives no request in the first test), register the base URL in a test-only extension `tests/integration/harness/fake-base.ts` (`pi.registerProvider("openrouter", { baseUrl: process.env.CG_FAKE_BASE })`, loaded with a second `-e` before the guard) and record which form worked in the commit message. If `appendEntry` records do not appear on stdout under `--no-session`, stop and report: the guard transport is then unproven and M3-04/M3-09 must not proceed.

- [ ] **Step 6: Check, lint, format** (`src/harness/adapters/pi.ts`, `mod.ts`, `harness/images/pi/cg-budget.ts`, `scripts/harness/pi-probe.ts`, both test dirs' new files)

- [ ] **Step 7: Commit**

```bash
git add src/harness/adapters/pi.ts src/harness/adapters/mod.ts harness/images/pi harness/configs/pi-flash-plain.yml scripts/harness/pi-probe.ts tests/unit/harness/pi.test.ts tests/integration/harness/pi-runtime.test.ts tests/integration/harness/fake-openrouter.ts
git commit -m "feat(harness): pi adapter, image, key-holding budget guard proven on the real pi runtime (M3-02)"
```

**Acceptance (no container):** `deno test --allow-all tests/unit/harness/pi.test.ts` passes; the runtime test passes with `CG_PI_CLI` set, 0 ignored (quote the summary line in the task report); `grep -n "OPENROUTER_API_KEY\|--api-key" harness/images/pi/run.ps1` prints nothing.

---

### Task M3-03: al-tools MCP component (Claude Code)

Spec 1a D5 and section 5 item 4: the MCP component calls the same backend; the token allows compile, test and symbol lookup on its own workspace only. A dependency-free stdio MCP server (newline-delimited JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`) in the base image, started by Claude Code from an `mcp.json` that `run.ps1` writes when `settings.mcp` names it. Protocol version policy: supported `2025-06-18`, `2025-03-26`, `2024-11-05`; a requested supported version is echoed, anything else gets `2025-06-18` (the client then decides). Arguments are validated before any backend call: `apps` absent or an array of 1 to 64 names matching `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$`; `codeunits` absent or an array of 1 to 64 integers in 1..2147483647; no other keys; `al_symbols` takes none. Absent means "all" (the tool description says so); an empty array or anything malformed is a tool error. The tool list lives in one JSON file, hashed by `harness images build base` into the label `centralgauge.mcp.al-tools` = `<version> <sha256>` (inherited by child images); `imageFacts` reads it and `runtimeFacts` fills `RuntimeFacts.servers` from the image.

**Lane:** infra. **Deps:** M1-19 (backend protocol), M1-24 (`src/harness/images.ts`, `harnessImagesBuild`). **Date:** 10-05.

**Files:**
- Create: `harness/images/base/al-tools-mcp.mjs`, `harness/images/base/al-tools-tools.json`
- Modify: `harness/images/base/Dockerfile.windows`, `src/harness/images.ts`, `cli/commands/harness-command.ts` (base build label), `src/harness/adapters/claude-code.ts` (`nativeSettings` adds `mcp` when non-empty), `harness/images/claude-code/run.ps1` (writes `mcp.json`)
- Test: `tests/unit/harness/al-tools-mcp.test.ts`, `tests/unit/harness/images.test.ts` (replace the M1-24 MCP refusal test), `tests/unit/harness/claude-code.test.ts` (append), `tests/unit/cli/commands/harness-command.test.ts` (base build args)

**Interfaces:**
- Produces: `AL_TOOLS_DEF = "harness/images/base/al-tools-tools.json"`; `MCP_LABEL_PREFIX = "centralgauge.mcp."`; `ImageFacts.mcp?: Record<string, { version: string; tool_schema_hash: string }>`; `mcpLabel(root): Promise<[string, string]>`; tools `al_compile { apps? }`, `al_test { codeunits? }`, `al_symbols {}`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/al-tools-mcp.test.ts`:

```typescript
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

const DEF = "harness/images/base/al-tools-tools.json";
const TOKEN = "t".repeat(32);

async function converse(msgs: unknown[], handler: (req: Request) => Response, stopBackendFirst = false) {
  const calls: { path: string; auth: string | null; exec: string | null; body: string }[] = [];
  const backend = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    calls.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), exec: req.headers.get("x-cg-execution"), body: await req.text() });
    return handler(req);
  });
  const port = backend.addr.port;
  if (stopBackendFirst) await backend.shutdown();
  const secrets = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(secrets, "backend-token"), TOKEN + "\n");
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-env", "--allow-net", "harness/images/base/al-tools-mcp.mjs"],
    env: { CG_AL_TOOLS_DEF: DEF, CG_SECRETS_DIR: secrets, CG_BACKEND_URL: `http://127.0.0.1:${port}`, CG_EXECUTION_ID: "exec-1" },
    stdin: "piped", stdout: "piped", stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n"));
  await w.close();
  const out = await child.output();
  if (!stopBackendFirst) await backend.shutdown();
  const stdout = new TextDecoder().decode(out.stdout);
  const replies = stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { replies: new Map(replies.map((r) => [r.id, r])), calls, count: replies.length, stdout };
}
const call = (id: number, name: string, args: unknown) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

Deno.test("al-tools MCP: initialize with the version policy, tools/list, ping, unknown method, notifications", async () => {
  const def = JSON.parse(await Deno.readTextFile(DEF));
  const { replies, count } = await converse([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { jsonrpc: "2.0", id: 4, method: "ping" },
    { jsonrpc: "2.0", id: 5, method: "resources/list" },
  ], () => new Response("{}"));
  assertEquals(count, 5);
  assertEquals(replies.get(1).result.protocolVersion, "2025-03-26");
  assertEquals(replies.get(2).result.protocolVersion, "2025-06-18");
  assertEquals(replies.get(1).result.serverInfo, { name: "al-tools", version: def.version });
  assertEquals(replies.get(3).result.tools, def.tools);
  assertEquals(replies.get(4).result, {});
  assertEquals(replies.get(5).error.code, -32601);
});

Deno.test("al-tools MCP: the three operations go to the backend with the file token and the execution id", async () => {
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: ["Core"] }), call(2, "al_test", { codeunits: [80001] }), call(3, "al_symbols", {}), call(4, "al_compile", {}),
  ], (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/v1/compile") return new Response(JSON.stringify({ ok: true, apps: [] }));
    if (p === "/v1/test") return new Response(JSON.stringify({ ok: false, failed: 1 }));
    return new Response("unauthorized", { status: 401 });
  });
  assertEquals(calls.map((c) => [c.path, c.auth, c.exec, c.body]).sort(), [
    ["/v1/compile", `Bearer ${TOKEN}`, "exec-1", "{}"],
    ["/v1/compile", `Bearer ${TOKEN}`, "exec-1", '{"apps":["Core"]}'],
    ["/v1/symbols", `Bearer ${TOKEN}`, "exec-1", "{}"],
    ["/v1/test", `Bearer ${TOKEN}`, "exec-1", '{"codeunits":[80001]}'],
  ]);
  assertEquals(replies.get(1).result.isError, false);
  assertEquals(JSON.parse(replies.get(1).result.content[0].text), { op: "compile", status: 200, result: { ok: true, apps: [] } });
  assertEquals(replies.get(2).result.isError, true);
  assertEquals(replies.get(3).result.isError, true);
});

Deno.test("al-tools MCP: malformed arguments are tool errors and never reach the backend", async () => {
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: "Core" }), call(2, "al_compile", { apps: [] }), call(3, "al_compile", { apps: ["..\\x"] }),
    call(4, "al_test", { codeunits: ["80001"] }), call(5, "al_test", { codeunits: [0] }), call(6, "al_compile", { apps: ["Core"], path: "C:\\" }),
    call(7, "al_symbols", { x: 1 }), call(8, "al_oracle", {}), call(9, "al_compile", null),
  ], () => new Response("{}"));
  assertEquals(calls.length, 0);
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) assertEquals(replies.get(id).result.isError, true, `call ${id}`);
});

Deno.test("al-tools MCP: an unreachable backend is a tool error; the token never reaches stdout", async () => {
  const { replies, stdout } = await converse([call(9, "al_compile", { apps: ["Core"] })], () => new Response("{}"), true);
  assertEquals(replies.get(9).result.isError, true);
  assert(!stdout.includes(TOKEN));
});
```

(`al_compile` with `null` arguments: `null` is not an object, so it is refused; `{}` means all apps.)

Replace the M1-24 test `runtimeFacts: native settings from the catalog; MCP and LSP refused until M2` in `tests/unit/harness/images.test.ts` with:

```typescript
Deno.test("runtimeFacts: MCP facts come from the image label; LSP and missing MCP refused", async () => {
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

Append to `tests/unit/harness/claude-code.test.ts`:

```typescript
Deno.test("claude-code MCP: settings carry the MCP list only when set; run.ps1 writes mcp.json with the backend env", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc", harness: "claude-code", harness_version: "2.1.282", models: { main: "anthropic/claude-sonnet-5" },
    settings: {}, components: { mcp: ["al-tools"] }, limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = { models: [{ slug: "anthropic/claude-sonnet-5", api_model_id: "claude-sonnet-5", family: "claude", display_name: "S5" }], pricing: [], families: [] };
  assertEquals(claudeCodeAdapter.nativeSettings(cfg, catalog)["mcp"], ["al-tools"]);
  assertEquals(claudeCodeAdapter.nativeSettings({ ...cfg, components: { ...cfg.components, mcp: [] } }, catalog)["mcp"], undefined);
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  for (const s of ["'--mcp-config'", "'--strict-mcp-config'", "C:\\al-tools-mcp.mjs", "CG_BACKEND_URL = $env:CG_BACKEND_URL", "CG_EXECUTION_ID = $env:CG_EXECUTION_ID"]) {
    assertStringIncludes(run, s);
  }
  const base = await Deno.readTextFile("harness/images/base/Dockerfile.windows");
  assertStringIncludes(base, "COPY al-tools-mcp.mjs C:/al-tools-mcp.mjs");
  assertStringIncludes(base, "COPY al-tools-tools.json C:/al-tools-tools.json");
});
```

In `tests/unit/cli/commands/harness-command.test.ts`, extend the M1-24 `harnessImagesBuild` base-build expectation with the label `centralgauge.mcp.al-tools=<mcpLabel(root) value>` (the fixture root gets a copy of `al-tools-tools.json`).

- [ ] **Step 2: Run to see them fail**

Run: `deno test --allow-all tests/unit/harness/al-tools-mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/claude-code.test.ts tests/unit/cli/commands/harness-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`harness/images/base/al-tools-tools.json`:

```json
{
  "version": "al-tools-mcp@1",
  "tools": [
    {
      "name": "al_compile",
      "description": "Compile AL apps in the workspace on the benchmark backend and return the diagnostics per app. Omit apps to compile every app.",
      "inputSchema": {
        "type": "object",
        "properties": { "apps": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$" } } },
        "additionalProperties": false
      }
    },
    {
      "name": "al_test",
      "description": "Publish the workspace apps to a Business Central server and run test codeunits; returns per-test results. Omit codeunits to run every test codeunit.",
      "inputSchema": {
        "type": "object",
        "properties": { "codeunits": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "type": "integer", "minimum": 1, "maximum": 2147483647 } } },
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
// CG_EXECUTION_ID are the runner's non-secret env. Arguments are validated
// before any backend call. Runs under Node (image) and Deno (unit tests).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const DEF = JSON.parse(readFileSync(process.env.CG_AL_TOOLS_DEF ?? "C:\\al-tools-tools.json", "utf8"));
const SECRETS = process.env.CG_SECRETS_DIR ?? "C:\\cg-secrets";
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const APP = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const result = (o, isError) => ({ content: [{ type: "text", text: JSON.stringify(o) }], isError });

/** [op, body] or an error string. */
function validate(name, args) {
  if (!isObj(args)) return "arguments must be an object";
  const keys = Object.keys(args);
  const list = (k, ok) => {
    const v = args[k];
    if (v === undefined) return null;
    if (!Array.isArray(v) || v.length < 1 || v.length > 64 || !v.every(ok)) return `${k} is malformed`;
    return v;
  };
  if (name === "al_compile") {
    if (keys.some((k) => k !== "apps")) return "unknown argument";
    const apps = list("apps", (x) => typeof x === "string" && APP.test(x));
    if (typeof apps === "string") return apps;
    return ["compile", apps === null ? {} : { apps }];
  }
  if (name === "al_test") {
    if (keys.some((k) => k !== "codeunits")) return "unknown argument";
    const cus = list("codeunits", (x) => Number.isInteger(x) && x >= 1 && x <= 2147483647);
    if (typeof cus === "string") return cus;
    return ["test", cus === null ? {} : { codeunits: cus }];
  }
  if (name === "al_symbols") return keys.length === 0 ? ["symbols", {}] : "al_symbols takes no arguments";
  return `unknown tool ${String(name)}`;
}

async function call(name, args) {
  const v = validate(name, args);
  if (typeof v === "string") return result({ error: v }, true);
  const [op, body] = v;
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
    // The name only: a fetch error message can echo the URL and headers.
    raw = JSON.stringify({ error: `backend unreachable: ${e?.name ?? "error"}` });
  }
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch { /* not JSON: returned as text */ }
  const ok = status === 200 && isObj(parsed) && parsed.ok === true;
  return result({ op, status, result: parsed }, !ok);
}

async function handle(msg) {
  const { id, method, params } = isObj(msg) ? msg : {};
  if (id === undefined || id === null) return;
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
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
// No process.exit: it can cut buffered stdout. The process ends when stdin closes and the last reply is written.
rl.on("close", async () => {
  await Promise.all([...pending]);
  process.exitCode = 0;
});
```

`harness/images/base/Dockerfile.windows`: append

```dockerfile
COPY al-tools-mcp.mjs C:/al-tools-mcp.mjs
COPY al-tools-tools.json C:/al-tools-tools.json
```

`src/harness/images.ts` (M1-24 file): add `export const MCP_LABEL_PREFIX = "centralgauge.mcp.";` (separate from `IMAGE_LABELS`, whose values are all required); `ImageFacts.mcp?: Record<string, { version: string; tool_schema_hash: string }>`; in `imageFacts`, before the return:

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
```

and add `mcp` to the returned object. Add:

```typescript
export const AL_TOOLS_DEF = "harness/images/base/al-tools-tools.json";

/** The base image's al-tools label: the tool definition's version and canonical hash. */
export async function mcpLabel(root: string): Promise<[string, string]> {
  const def = JSON.parse(await Deno.readTextFile(join(root, AL_TOOLS_DEF))) as { version?: unknown };
  if (typeof def.version !== "string" || def.version === "") throw new ConfigurationError(`${AL_TOOLS_DEF}: version missing`);
  return [`${MCP_LABEL_PREFIX}al-tools`, `${def.version} ${await hashJson(def)}`];
}
```

(imports `join` from `@std/path`, `hashJson` from `./hash.ts`). In `runtimeFacts`, replace the MCP/LSP refusal with:

```typescript
  if (config.components.lsp.length > 0) throw new ConfigurationError(`${config.id}: LSP components are not implemented`);
  const servers: RuntimeFacts["servers"] = {};
  for (const name of config.components.mcp) {
    const f = image.mcp && Object.hasOwn(image.mcp, name) ? image.mcp[name] : undefined;
    if (!f) {
      throw new ConfigurationError(`${config.id}: image ${image.digest} has no MCP component ${name} (rebuild the base image, then the harness image)`);
    }
    servers[name] = f;
  }
```

and return `servers`.

`cli/commands/harness-command.ts`, `harnessImagesBuild` base branch: `const [mk, mv] = await mcpLabel(o.root);` and `"--label", \`${mk}=${mv}\`` before `-t`.

`src/harness/adapters/claude-code.ts` `nativeSettings`: `return { ...config.settings, api_models, ...(config.components.mcp.length > 0 ? { mcp: [...config.components.mcp].sort() } : {}) };` (plain arms keep their manifest hash).

`harness/images/claude-code/run.ps1`, before `$claudeArgs`:

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

and the invocation becomes `$prompt | & claude @claudeArgs @mcpArgs`.

- [ ] **Step 4: Run to see them pass** (the four test files)
- [ ] **Step 5: Check, lint, format** (`.ts` files; `deno lint` for the `.mjs`)
- [ ] **Step 6: Commit** `feat(harness): al-tools MCP component on the cg-al backend with validated arguments (M3-03)`

**Acceptance (no container):** the four test files pass; `grep -n "0.0.0.0\|BcContainerProvider" harness/images/base/al-tools-mcp.mjs` prints nothing.

---

### Task M3-04 (ops): pi image and fake-key probes in the sandbox

No real credential, no spend, no ledger slot, no BC container. Reserved block on 10-05 after M1-29, coordinated with M4-09 (which uses Cronus282/283; this task uses none). Fixture delivery deadline 10-05 16:00 (M3-05 starts on it).

**Lane:** ops. **Deps:** M3-02, M1-28 (base image). **Date:** 10-05.

- [ ] **Step 1: build.** `deno task start harness images build pi --version 0.87.1`; quote the id. `DOCKER_CONTEXT=desktop-windows docker run --rm <id> powershell -NoProfile -Command "pi --version; node --version"`; quote both lines.
- [ ] **Step 2: ready gating.** `deno run --allow-all scripts/harness/pi-probe.ts <id> H:\Temp3\harness-spike\M3-04\noready --no-ready`. Expected: exit 3, `raw.jsonl` is exactly one `cg_entry` line with `ready: false`, termination `setup_failed`, no `session` record (pi never started). Quote.
- [ ] **Step 3: auth failure.** Same without `--no-ready` into `...\auth`. Expected: `cg_entry` line 1 with `ready: true`; one `cg-budget` `armed` entry with `limit_usd` 0.05 before the first assistant `message_start`; pi exit 0; termination `harness_crash`; `didWork` false. Quote `raw.jsonl` lines for `cg_entry`, `entry_appended`, the last assistant `stopReason`/`errorMessage`, every `auto_retry_*`.
- [ ] **Step 4: proxy honored and host list.** Same with `--proxy-log <nat gateway ip>` (from `docker network inspect nat`) into `...\proxy`. Quote `proxy.log` (expected only `CONNECT openrouter.ai:443`) and the error text; a different error from Step 3 proves the proxy was used. Any other host goes into the evidence as an A1 question for M1-33.
- [ ] **Step 5: components and prompt.** Same with `--skills <scripts\spikes\harness\probe-workspace\.pi\skills>` and `--instructions harness\bundles\env\instructions` into `...\components`. Quote the system `message_start` `sections` keys, the `<name>` entries, whether the instructions text appears in any section, and the first user message (equals the prompt).
- [ ] **Step 6: runtime scenarios inside the image.** Run the M3-02 runtime test with pi from the image instead of the host: `DOCKER_CONTEXT=desktop-windows docker cp <container>:C:\Users\ContainerAdministrator\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent H:\Temp3\harness-spike\M3-04\pi-image-pkg` from a stopped `docker create <id>` container, then `CG_PI_CLI=H:\Temp3\harness-spike\M3-04\pi-image-pkg\dist\bundle\cli.js deno test --allow-all tests/integration/harness/pi-runtime.test.ts`; quote the summary (6 passed, 0 ignored). This proves the image's pi package, not only the host's. `docker rm` the created container.
- [ ] **Step 7: fixtures.** Byte-copy the four `raw.jsonl` files to `tests/fixtures/harness/pi/{not-ready,auth-fail,proxy-refused,components}.jsonl`; `grep -c "sk-or-v1-" tests/fixtures/harness/pi/*.jsonl` prints `0` for each (if not: stop, never hand-edit). Commit on the lane branch: `test(harness): pi fake-key fixtures (M3-04)`.
- [ ] **Step 8: cleanup.** `docker ps -a --filter name=cg-harness-probe` empty.

**Acceptance (no container):** the evidence quotes the image id, both versions, Steps 2 to 6 results, `proxy.log`, the zero-hit scan and the empty `docker ps`; four fixtures committed.

---

### Task M3-05: parser pinned to the captured fixtures

**Lane:** infra2. **Deps:** M3-04. **Date:** 10-05 (after the 16:00 fixture delivery; before M1-18/M1-35 on 10-06).

**Files:** Modify `src/harness/adapters/pi.ts` only where a fixture disagrees; Test `tests/unit/harness/pi.test.ts` (append).

- [ ] **Step 1: Write the failing tests**

```typescript
const FX = (n: string) => Deno.readTextFile(`tests/fixtures/harness/pi/${n}.jsonl`);
const probe = (over: Partial<ResolvedManifest> = {}) => pm({ limits: { timeout_min: 5, max_budget_usd: 0.05 }, ...over });
const parseFx = async (n: string, exitCode: number, over: Partial<ResolvedManifest> = {}) =>
  parsePiStream(await FX(n), { rawLog: n, exitCode, manifest: probe(over), pricing: BOOK });

Deno.test("pi fixture not-ready: setup_failed, pi never started", async () => {
  const r = await parseFx("not-ready", 3);
  assertEquals([r.termination, r.didWork, r.observed.models], ["setup_failed", false, null]);
});

Deno.test("pi fixture auth-fail: exit 0 is still a crash; guard armed before the request; zero cost", async () => {
  const r = await parseFx("auth-fail", 0);
  assertEquals([r.termination, r.didWork, r.telemetry.cost_usd, r.observed.harness_version], ["harness_crash", false, 0, "0.87.1"]);
  assertEquals(raw(r).stream_problems, []);
});

Deno.test("pi fixture proxy-refused: the proxy error is a crash, not a usage limit", async () => {
  const r = await parseFx("proxy-refused", 0);
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
});

Deno.test("pi fixture components: skills observed from the system message", async () => {
  const r = await parseFx("components", 0, { skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }] } });
  assertEquals(r.observed.loaded_components, ["skills"]);
});
```

- [ ] **Step 2: Run; record which assertions fail and why.**
- [ ] **Step 3: Adjust `parsePiStream`** for each captured shape (an error field name, a record type to add to `KNOWN_TYPES` only if pi documents it as non-billing, a `stopReason` value). Keep the rule order; add, never replace, a tested field name unless the fixture proves it absent; say so in the commit message. `instructions` stays unobservable even if Step 5 of M3-04 shows the text (the manifest holds hashes, not text).
- [ ] **Step 4: Run all pi tests and the runtime test (with `CG_PI_CLI`); PASS.**
- [ ] **Step 5: Check, lint, format; commit** `fix(harness): pi parser pinned to captured sandbox logs (M3-05)`.

**Acceptance (no container):** `deno test --allow-all tests/unit/harness/pi.test.ts` passes with the four fixture tests.

---

### Task M3-07 (ops): Claude Code loads the al-tools MCP; all operations through it

No model credential, so no ledger slot. Sequential ops block on 10-07, not concurrent with M4-13. Container: Cronus281 lease (the `al_test` operation publishes and tests).

**Lane:** ops. **Deps:** M3-03, M1-28. **Date:** 10-07.

- [ ] **Step 1: rebuild.** `deno task start harness images build base`, then `... images build claude-code --version 2.1.282` and `... images build pi --version 0.87.1` (the plain images are rebuilt on the new base; quote all three ids and the inherited label `docker image inspect <claude id> --format "{{index .Config.Labels \"centralgauge.mcp.al-tools\"}}"`). The M3-09 pi run uses the pi id recorded here.
- [ ] **Step 2: Claude loads the server (fake token).** Run a `harness cell` for a config `cc-sonnet-mcp` (a scratch copy of `cc-sonnet-plain` with `components.mcp: [al-tools]`, never committed) with a secrets dir whose `claude-oauth-token` is a fake 40-character value and **without** `--supervised` ledger use: if M1-24's `cellGate` refuses a credential-bearing arm without `--supervised`, use M1-24's `backend-probe.ts` with the claude-code image's default command instead (it grants the backend token, runs the entrypoint, captures stdout). Expected: the `system/init` record lists `mcp_servers` with `{"name":"al-tools","status":"connected"}` and `tools` containing `mcp__al-tools__al_compile`, `mcp__al-tools__al_test`, `mcp__al-tools__al_symbols`; then the run fails with an authentication error, `total_cost_usd` 0. Quote the init record and the result record.
- [ ] **Step 3: all three operations.** Hold the Cronus281 lease and `acquireBenchLock`; run `backend-probe.ts` for HX-001 at `refapp-v1-rc1` with the command override (add a `--command` passthrough in this ops commit if absent) `powershell -NoProfile -Command "$m = @('{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\"}}','{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}','{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"al_compile\",\"arguments\":{\"apps\":[\"Core\"]}}}','{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"al_symbols\",\"arguments\":{}}}','{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"al_test\",\"arguments\":{}}}'); $m | node C:\al-tools-mcp.mjs"`. Quote the five replies and the matching backend host-log lines (operations `compile`, `symbols`, `test`, the execution id).
- [ ] **Step 4: negative.** Same with an empty secrets dir: every tool call `isError: true`, no host-log line. Quote.
- [ ] **Step 5: cleanup and scan.** Empty `docker ps -a` for the owner label; the backend token is absent from the captured stdout (`grep -c`).

**Acceptance (no container):** the evidence quotes the three image ids and the inherited label, the Claude `system/init` record with `al-tools` connected and three tools, the five JSON-RPC replies with `status: 200` for compile and symbols and a test result for `al_test`, the host-log lines, the negative case, the empty `docker ps` and the zero-hit token scan.

---

### Task M3-09 (ops): GATE 10-09: pi cell on HX-001 behind the proxy, after authorization

Runs after M1-34 Step 12 writes `authorized` and `harness egress verify` passes, so it is an enforced run and reserves no pre-authorization slot. Sequenced after M1-38 on Cronus281 (M4-15 holds Cronus282/283). Acceptance may land late on 10-09; a slip past 10-09 goes to the owner (launch contract).

**Lane:** ops. **Deps:** M3-05, M1-29, M1-33 (with A1-A3), M1-34 through Step 12, M1-38. **Date:** 10-09.

- [ ] **Step 1: preflight.** Quote: `deno task start harness egress verify` (no problem) and the marker state `authorized`; the Cronus281 lease; empty `docker ps -a --filter label=centralgauge.harness.owner=$env:COMPUTERNAME`; `spend.md` running total (below USD 120); the pi image id from M3-07 Step 1; the rotated OpenRouter key file (M1-34 Step 10) in the secrets dir, value never printed, and the key's credit cap from the OpenRouter console (quote the cap). The catalog row for `openrouter/google/gemini-3.8-flash` in force today has non-zero `cache_read_per_mtoken` and `cache_write_per_mtoken` (open question 1); if not, stop: the orchestrator fixes the catalog locally first.
- [ ] **Step 2: run.** `deno task start harness cell pi-flash-plain HX-001 --rev refapp-v1-rc1 --containers Cronus281 --secrets-dir <dedicated secrets dir>` (enforced: no `--supervised` reservation). Watch the execution's `egress.jsonl`; any `deny` or a host other than `openrouter.ai`: Ctrl+C, record, stop.
- [ ] **Step 3: records** under `results/harness/cells/`; quote:
  - execution: `termination`, `did_work`, `telemetry.cost_usd` (non-null), `cost_source`, `pricing_snapshot`, `reported_cost_usd`, `per_model`, `turns`, `stop_reason`, `observed` (`harness_version` `0.87.1`, `models` `["openrouter/google/gemini-3.8-flash"]`), `validity` (`incomplete_observed: ["loaded_components"]` expected: instructions unobservable), `raw_usage.assumptions` (listed if cache writes occurred), `raw_usage.stream_problems` (expected empty);
  - judgment: `verdict`, `scorer_fingerprint`, each scorer's `passed` (pass or fail both pass the gate);
  - `runs/<id>/raw.jsonl`: line 1 `cg_entry` with `ready: true`; one `cg-budget` `armed` entry with `limit_usd` 2 before the first request; final `agent_settled`; `runs/<id>/sandbox.json` `confirmedGone: true`;
  - `egress.jsonl`: only `allow` lines for `openrouter.ai:443` (count), no `deny`; the preflight lines include `proxy-allow-openrouter.ai` open and no `api.anthropic.com` probe (A2).
- [ ] **Step 4: report disclosure.** `deno task start harness report` (or M1-24b's equivalent) over the cell store shows the coverage line with `cost assumptions: ...` (`none` when no cache writes). Quote.
- [ ] **Step 5: secret scan and cleanup.** `grep -rF -f <secrets dir>/openrouter-api-key results/harness | wc -l` prints `0`; private state gone; `docker ps -a` for the owner label empty.
- [ ] **Step 6: spend.** One row in `H:\cg-coord\decisions\spend.md` (date, `M3-09`, OpenRouter, the run's `reported_cost_usd`, source: the execution record path); update the running total.
- [ ] **Step 7 (optional, enforced, after Step 6): real budget trip.** A scratch config `pi-flash-trip` (copy of `pi-flash-plain` with `max_budget_usd: 0.001`, never committed) on HX-001: termination `budget_exhausted`, a `cg-budget` `exhausted` entry with `reason: "limit"`, one provider request after which none follow (count the `allow` lines in `egress.jsonl`: one CONNECT or keep-alive reuse; quote), sandbox gone. Spend row added.

**Acceptance (no container):** the evidence quotes the preflight with `authorized`, the execution fields with a non-null estimated cost, the judgment, the `egress.jsonl` summary with zero `deny` and the route-aware preflight line, the report coverage line, the zero-hit key scan, the empty private state and `docker ps`, and the `spend.md` row; Step 7 quoted or marked not run.

---

## Final integration (orchestrator, 10-09)

- `deno test --allow-all tests/unit/harness/` passes on the merge; the runtime test passes with `CG_PI_CLI` (0 ignored); `deno check`/`deno lint` clean on the M3 files; `graphify update .`.
- M3-09 evidence accepted; the launch-gate line "Claude Code and pi adapters working" cites M1-29 and M3-09.
- Recorded in `H:\cg-coord\decisions\`: the toolchain cut (cut item 2) and, if the orchestrator applies it, the M1-25 report-extras deferral (cut item 3).

## Self-review notes

- Spec 1a section 12 item 3: M3-01, M3-02, M3-04, M3-05, M3-09. Item 4: al-tools MCP (M3-03, M3-07); toolchain cut (item 2); categorization is M2.
- Section 5 "a new image, `run.ps1`, a metrics contract, and a host-side trace parser; the orchestrator does not change": M3-02, M3-01; runner changes only through the M1-33 amendment A1-A3, which M1-33 owns.
- Section 11 parser fixtures: tool call, tool error (probe); fatal run (auth-fail, proxy-refused, runtime 500/429); retry (runtime, real pi records); hard kill (cut stream, kill during retry); compaction disabled and, if seen, cost-nulling (unit). Skill invocation: observed as loaded; invocation is M2 categorization.
- Names across tasks: `parsePiStream`, `piAdapter`, `PI_SETTINGS`, `PI_ROUTE`, `BUDGET_ENTRY`, `TTL_ASSUMPTION`, `budgetStep`, `startFakeOpenRouter`, `mcpLabel`, `MCP_LABEL_PREFIX`, `AL_TOOLS_DEF`, `ArmCoverage.cost_assumptions`: each defined once.

## Open questions (owner or orchestrator)

1. **Catalog rates of 0.** The latest `openrouter/google/gemini-3.8-flash` row (2026-09-08) has cache read and cache write rates of 0, so a run with cache tokens gets a null cost ("rate is 0"). The orchestrator corrects it locally from documented OpenRouter prices before M3-09. The same-model head-to-head also needs a catalog entry and pricing such as `openrouter/anthropic/claude-sonnet-5` before the 10-10 campaigns.
2. **Gate timing (owner).** M3-09 depends on M1-34 reaching `authorized` on 10-09. If that slips, the pi gate slips with it: a NAT run is not evidence for "behind the proxy" and no pre-authorization slot is free. Accept a slip report, or approve a different gate proof?
3. **M1-25 extras (orchestrator, cut item 3).** Defer M1-25's report extras so `infra2` keeps 10-09 for integration repairs?
4. **Pattern redaction (owner of M1-22).** The M0-04 carryover "redactor beyond exact secrets" has no task in M1 part 2 or M3; M3 only scans its own fixtures for `sk-or-v1-`. Assign it to M1-22 follow-up or M2?
5. **Context-file parity (owner).** pi reads `AGENTS.md` and `CLAUDE.md` from `C:\workspace` and its parents; Claude Code reads `CLAUDE.md`. The agent directory and skills are isolated and explicit. Is this documented difference acceptable for the head-to-head, or should refapp workspaces carry no context files at all?
