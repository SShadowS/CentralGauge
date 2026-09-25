# Harness Bench M2: Claude Code trace, metrics and arms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish M2 on top of the accepted M1-32 adapter and deliver campaign-ready Claude Code arms by the 10-09 gate: a full trace parser (tool calls, sub-agents, skills, MCP) with conservative, replayable call categorization; a metrics contract whose completeness is exact per measurement and whose capabilities travel with each run; a fail-closed MCP inventory check; publication-path redaction beyond exact secrets; and a qualification of the real campaign arms (real skills bundle, real al-tools MCP from M3, final image) through the real execution and publication pipeline without spending a credential.

**Architecture:** Pure modules first (`classify.ts`, `redact-patterns.ts`, `adapters/jsonl.ts`, `adapters/claude-trace.ts`, `call-fields.ts`, `trace-metrics.ts`), unit-tested without Docker or BC. Gate-path edits (`trace.ts`, `adapters/claude-code.ts`, `sandbox.ts`, `images.ts`, `execution.ts`, the `cell` command) merge only after the 10-05 gate is accepted. The al-tools MCP server is M3-03's stdio front end to the existing backend `/v1/{compile,test,symbols}` API, so every backend protection (quiescent snapshot, validation, cancellation, bounded bodies, host log) is reused, never recreated. Retry and compaction are parsed and declared only from shapes recorded from Claude Code 2.1.282. A scripted Messages API stub runs **inside** the sandbox (`127.0.0.1`), so fixture recording and arm qualification need no credential and no egress change, before or after the 10-08 firewall.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/assert`, Cliffy (`cli/commands/harness-command.ts`); Node 22.19.0 in the base image (stub, al-tools MCP); Claude Code 2.1.282 (ops only).

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (spec 1a) sections 4, 5 (Telemetry, Call categorization, Metrics contract), 8, 9 (header), 11, 12 item 2. Findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` sections 4, 7, 8. Roadmap row M2 in `docs/superpowers/plans/2026-09-24-harness-bench-spike.md`. M1 part 2 plan `docs/superpowers/plans/2026-09-30-harness-core-part2.md` (M1-19, M1-20, M1-22, M1-24, M1-28, M1-32, M1-33, M1-34). M3 plan `docs/superpowers/plans/2026-10-06-harness-pi.md` (M3-01, M3-03, M3-05, M3-07; in revision). Decisions under `H:\cg-coord\decisions\` (all read): `accept-M0-04`, `accept-M0-07`, `cut-laya`, `accept-M1-32`, `m1p2-round2`, `egress` (all addenda), `secrets-accepted-risk`, `m1-metric-rules`, `gate-1002-moved`, `reviewer-gpt6sol`, `reviews-on-copilot`. Review: `H:\cg-coord\reviews\M2-plan-001\review-gpt6astra.md` (REJECT of bde973bd; every required change is mapped below).

**Revision 2 (2026-09-25).** Applies all six required changes of the gpt-6-astra review and the orchestrator's capacity decisions: lane `content` takes M2-01 to M2-10 and M2-12 plus the skill content; lane `infra` owns the al-tools MCP implementation (M3-03); the orchestrator owns arm configs and the `vary` audit; `infra2` keeps M1 stream B. Authorized cuts applied: M1-25 and the former M2-10 (efficiency) are cut (cut item 3); M3-06 and M3-08 (toolchain) are cut (cut item 2) to protect `infra` capacity for M1-33 and M3.

## Review changes and where each is addressed

| # | Required change | Addressed in |
| --- | --- | --- |
| 1 | Capacity-backed integrated M1/M2/M3 schedule; named campaign-content owners | Integrated schedule (below); owners: skills = lane `content` (M2-07, done 10-04); al-tools tools, schemas, implementation = lane `infra` (M3-03, 10-05); arm configs and `vary` audit = orchestrator (O-1, 10-06); final image and real-arm qualification = `ops` (M2-13, 10-07, rerun slot 10-08, accepted 10-09) |
| 2 | Nested-metric completeness, per-run capability provenance, zero/null/n/a semantics | M2-05 (capture vs structure vs metric completeness; `per_model[m].requests` reasons mapped to `per_model`; `raw_usage.capabilities` persisted per run); M2-06 (`TraceMetrics` uses the run's persisted capabilities; undeclared types are `null`, never 0); M2-12 (retry/compaction parsed and declared only from recordings, counts pinned to what was recorded) |
| 3 | Fail-closed MCP inventory, recovery facts, implementable backend interface | M2-09 (expected tool names persisted in the manifest's native settings before release; a requested server without them is never loaded; unexpected servers fail setup; recovery reads only the persisted manifest; ToolSearch deferral pinned); backend interface = M3-03's stdio server over the existing `/v1` ops (no new backend route; protections reused) |
| 4 | Publication-path redaction tests; a probe that exercises publication | M2-02 (UTF-8 and UTF-16LE patterns in `publishRedacted` and `redactText`, serialized raw log, trace command, tool-result content, stderr, cut tail); M2-03 (over-cap commands are dropped, never cut mid-token; patterns applied before storage); M2-10 (crash/recovery publication with a pattern secret not in custody); M2-13 (canaries through the real `harness cell` publication path) |
| 5 | Conservative, replayable classification; evidence-based error attribution | M2-01 (quote-aware redirects; unknown command with a redirect is `unclassified`; MCP `publish` case); M2-03 (`command_cut` recorded; error classes only from structured backend evidence); M2-06 (no confident reclassification from a dropped command; trace-classified compiles are labelled as calls, not backend builds; invalid traces warn, never break the primary report) |
| 6 | Runtime-drift qualification, bounded ops, real campaign arms by 10-09 | M2-08 (stub-provider cells run through `runSandbox`, image by immutable id); M2-09 (definition drift refused before launch, runtime inventory drift fails setup, separate tests); M2-13 (real arms from O-1, final image, runtime drift drill with a drift image, 10-07 first run, 10-08 rerun slot, 10-09 acceptance) |

Answers adopted from the review: unreproducible retry/compaction stay undeclared (n/a) with the failed reproduction published; all-requests-failed runs keep cost null; a held-out blind sample is labelled before any category numbers are quoted (after campaign capture, not blocking the primary metric); ToolSearch keeps the pinned default and is recorded; skill scope is "observed invocation" only; the post-gate image rebuild is fine (gate evidence preserved, dev executions never reused).

## Global Constraints

- Lanes: `content` (M2 code and skill content), `infra` (M1 stream A and M3), `infra2` (M1 stream B), `ops` (containers, images, sandboxes; evidence under `H:\cg-coord\tasks\<id>\runs\<nnn>\evidence.md`), orchestrator (configs, `vary` audit, integration). Code lanes never touch Docker or a BC container.
- **Gate safety (10-05).** Nothing that changes a file on the 10-05 gate path (`src/harness/trace.ts`, `adapters/claude-code.ts`, `sandbox.ts`, `images.ts`, `execution.ts`, `cli/commands/harness-command.ts` cell path, `harness/images/**`) is integrated, and no image is replaced, before the orchestrator accepts M1-29. Lanes write such tasks earlier on their branches. Integration order on 10-06: M2-02, M2-03, M2-05, then M3-01's `claude-code.ts` move rebased on M2-03, then M3-03, M2-08, M2-09, M2-10.
- Containers: only Cronus281, Cronus282, Cronus283, through leases. Cronus28 and Cronus284 never.
- Unit tests in `tests/unit/harness/`, `deno test --allow-all <file>`; never `--parallel`; never `tests/unit/container/` while a bench is live. Every code acceptance runs without containers.
- After each task: `deno check`, `deno lint`, `deno fmt` on that task's files only; never under `site/`. Zod 4, `exactOptionalPropertyTypes`, CLAUDE.md import order, `[OK]`/`[FAIL]`/`[WARN]` tags, no emoji, no em dash anywhere.
- **Schemas.** M2 makes **no additional change** to `ExecutionRecordSchema`, `TelemetrySchema` or `ResolvedManifestSchema` (M1-22's execution `v: 2` with `incomplete_observed` is M1's). The trace changes to **trace version 2**, independent of the execution version. New per-run facts go into `telemetry.raw_usage` (free JSON) under versioned keys, or into the manifest's free `settings.native` record.
- **Evidence governs.** A record shape is parsed and a field or trace type is declared only after a recorded Claude Code 2.1.282 log shows it. Synthesized fixtures test parsing of recorded shapes only.
- **Null, zero, n/a.** A measurement the run could not observe is `null` with a reason; a type the harness cannot show (per the run's persisted capabilities) is `null` and renders `n/a`; `0` means observed and none.
- Categorization is rules only (Laya cut). No rule, no category: `unclassified`. Rules carry `RULES_VERSION`; each classification stores `<rule-id>@<version>`. The 45-call M0-07 fixture is a regression pin, not held-out accuracy.
- Secrets: never argv, never `docker run -e`; files under `C:\cg-secrets` only. Published files and strings are redacted for exact custody secrets first, then token patterns (UTF-8 and UTF-16LE). The frozen workspace is redacted for exact custody secrets only (M1-12), never for patterns.
- MCP arms are Claude Code only. Every Claude Code arm passes `--strict-mcp-config` (an empty native config when the arm has no MCP). LSP stays refused.
- Credentials: M2 ops tasks use none (stub provider, dummy token) and reserve no ledger slot. Stub-provider cells write to their own results root and are never judged or reused.
- Model ids never hardcoded in code; stub replies echo the requested `model`.
- Cuts applied: M1-25 and former M2-10 (efficiency, cut item 3); M3-06 and M3-08 (toolchain, cut item 2). Header coverage (M2-06) stays.
- After the last code task: `graphify update .`.

## Review Focus

1. **A token-shaped secret not in custody** (the agent echoes an `sk-ant-oat01-...`, prints a `Bearer` header, or a UTF-16LE stderr line carries a key) reaches a published surface, including after a crash. Expected: `[REDACTED:<pattern>]` in raw log, stderr, trace and record strings; frozen workspace byte-identical. Pinned in M2-02 (`publishRedacted redacts patterns in a serialized raw log, trace and UTF-16LE stderr`), M2-03 (`an over-cap command is dropped, never cut`), M2-10 (`recovery publishes a crashed attempt with a non-custody pattern secret redacted`), M2-13 (canaries).
2. **Structurally damaged but valid JSON streams** (assistant record without a message id, orphan result, orphan sub-agent, a tool_use that never got a result, interleaved sub-agent messages, repeated message chunks). Expected: counted once, attributed, and the affected measurement (`trace_complete`, `per_model[m].requests`) is null with a named reason while a valid cost stays valid. Pinned in M2-03 and M2-05.
3. **An MCP server whose runtime inventory differs from the persisted expectation**, a requested server with no expected inventory, an unexpected server, or a recovery after the definition file changed. Expected: never confirmed loaded; unexpected servers fail setup; recovery uses the persisted manifest. Pinned in M2-09.
4. **A historical run read by a newer parser or rules version.** Expected: the report uses the run's persisted capabilities; stale classifications are replayed only from a complete command; a dropped command stays `unclassified`. Pinned in M2-06.
5. **Wrapped, compound and quoted shell commands** (`powershell -Command "cg-al compile Core"`, `echo "x > a.al"`, `python make.py > out.txt`). Expected: deterministic category or `unclassified`, never a guess. Pinned in M2-01.

---

## Integrated schedule (M1 part 2 remainder, M2, M3; through 10-09)

One row per lane per day; a cell lists that lane's work in order. "int" = orchestrator integration after review. M4 ops jobs are the M1 part 2 plan's, unchanged.

| Day | content | infra | infra2 | ops (containers) | orchestrator |
| --- | --- | --- | --- | --- | --- |
| 09-26 | M2-01 rules | M3-01 pi parser (pure; deps accepted) | M1-13/14/15 per M1p2 | per M1p2 | reviews |
| 09-27 | M2-02 redaction | M3-01 | M1-15 | per M1p2 | int M2-01 (new files) |
| 09-28 | M2-03 trace builder | M3-02 pi adapter, image files | M1-15 | per M1p2 | |
| 09-29 | M2-03 | M3-02 | M1-15 | M1-26 host checks (no BC) | |
| 09-30 | M2-04 stub API | M1-17 prep on M1-16 branch | M1-15 (due) | M4-01a/b | int M2-04 (new files) |
| 10-01 | M2-05 metrics contract | buffer / M3 review fixes | M1-16 | M4-01c, M4-03 (281) | |
| 10-02 | M2-06 trace metrics, header | M1-17; M1-22 first commit | M1-19 | M1-27 (281); M4-05 (282/283) | |
| 10-03 | M2-07 skill content | M1-22 | M1-19 fixes | M1-27 step 5 (282, 283); M4-07; M4-17 pilot (slot 1) | int M2-06 after M1-22 |
| 10-04 | M2-07 skill content (done) | M1-24 | buffer | M1-28 images, backend probe (281) | |
| 10-05 | M2-08 stub-provider cells | M3-03 al-tools MCP (real tools) | buffer | **M1-29 gate** (281, slot 2); M4-09 (282/283); M3-04 pi probes (no BC) | accept M1-29 |
| 10-06 | M2-09 MCP inventory; M2-10 publication tests | M3-05; M1-33 start | M1-18; M1-35 | M4-11 (282/283); M4-17 pilot (281, slot 3); M2-11 fixtures (no BC) | int M2-02/03/05, M3-01, M3-03, M2-08/09/10; **O-1 arm configs + vary audit** |
| 10-07 | M2-12 retry/compaction from evidence | M1-33 | M1-23 | image rebuild (am); M3-07 (281); M4-13 (282/283); **M2-13 run 1** (281, pm) | int M2-12 |
| 10-08 | fixes from M2-13 | M1-33 (done) | M1-24b | M1-34 steps 0-8 (am, no jobs); M1-30 (281); M4-15 (282/283); M2-13 rerun slot (281, late pm) | |
| 10-09 | buffer | buffer | buffer (M1-25 cut) | M1-34 steps 9-12; M1-38 (281, am); M3-09 pi gate (281); M4-15 (282/283) | **10-09 gate**: accept M2-13, M3-09; freeze arm configs and image digest |

Capacity notes: `infra` pulls M3-01/M3-02 into its idle window before M1-17 (both depend only on accepted work); M3-06/M3-08 are cut. `content` carries one task per day with 10-08/10-09 as repair buffer. `ops` adds no BC time outside Cronus281 afternoons on 10-07/10-08; M2-11 uses no BC container; M2-13 compiles through the backend on Cronus281 only (no publish). The M3 plan's schedule table is superseded by this one (orchestrator aligns it).

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/harness/classify.ts`, `tests/fixtures/harness/classify/m0-07-labeled.jsonl` | rules v1 | M2-01 |
| `src/harness/redact-patterns.ts`; `sandbox.ts` (modify) | token patterns, UTF-8 and UTF-16LE; publication and string redaction | M2-02 |
| `src/harness/adapters/jsonl.ts` | shared record helpers (`J`, `Line`, `isObj`, `obj`, `list`); M3-01 adds its reader here | M2-03 |
| `src/harness/call-fields.ts` | per-call stored fields: redacted command or drop, target, classification | M2-03 |
| `src/harness/trace.ts` (modify), `adapters/claude-trace.ts`, `adapters/claude-code.ts` (modify) | trace v2, builder, adapter switch | M2-03 |
| `scripts/harness/stub-anthropic.mjs`, `scripts/harness/stub-scenarios/*.json` | in-container Messages API stub | M2-04 |
| `src/harness/adapter.ts` (modify `incompleteTelemetry`), `adapters/claude-code.ts` | metrics contract, capabilities | M2-05 |
| `src/harness/trace-metrics.ts`, `report.ts`, `cli/commands/harness-command.ts` | trace metrics, header coverage | M2-06 |
| `harness/bundles/al-skills/skills/**` | skill content for skill arms | M2-07 |
| `src/harness/execution.ts`, `cli/commands/harness-command.ts` | `--stub-provider` cells | M2-08 |
| `src/harness/images.ts`, `adapters/claude-code.ts` | persisted MCP inventory, fail-closed check | M2-09 |
| `tests/unit/harness/execution.test.ts` | publication-path redaction incl. recovery | M2-10 |
| `tests/fixtures/harness/claude-code/{retry,fatal,compaction}.jsonl` | recorded fixtures | M2-11 |
| `adapters/claude-trace.ts`, `adapters/claude-code.ts` | retry/compaction from evidence | M2-12 |

## Handoff contract to M3 (pi producer)

The pi adapter (M3-01, M3-05) must, from the integration of M2-03 onward: emit trace v2 events, building each `tool_call` with `callFields()` (M2-03); emit a `skill_invoke` event (skill = the folder name) for every pi `read` whose path matches `/[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i` (documented as a proxy: a read, not a Skill tool); write `raw_usage.trace_complete` and `raw_usage.capabilities` with the M2-05 shape (`parser: "pi-trace@1"`, its own declared lists; `trace_types` without `subagent_spawn`). M3-05 adds the tests `pi trace: SKILL.md read gives skill_invoke` and `pi trace: capabilities and trace_complete are written` against its captured fixtures. Until then pi traces read as incomplete in the report header, which is the honest reading.

---

### Task M2-01: rule-based call categorization, version 1

Spec 1a section 5 "Call categorization", section 11. Carryovers `accept-M0-07`: `Skill`, `Agent`, `ToolSearch`; `cg-al` version and unknown ops as `other`; parenthesized and compound PowerShell; cross-harness skill semantics (the category is the tool's own; skill use is the `skill_invoke` event type); exact or token-aware MCP tool parts. Review item 5: quote-aware redirects; an unknown command stays `unclassified` even with a redirect; a positive MCP `publish` case while `cg-al publish` stays `other`.

**Lane:** content. **Deps:** none. **Date:** 09-26. New files only.

**Files:** Create `src/harness/classify.ts`, `tests/fixtures/harness/classify/m0-07-labeled.jsonl`; Test `tests/unit/harness/classify.test.ts`.

**Interfaces:**
- Produces: `CATEGORIES` (10 names); `type Category`; `RULES_VERSION = 1`; `interface CallInput { tool: string; command: string | null; target: string | null }`; `interface Classification { category: Category; classifier: string }`; `classify(c): Classification`. Classifier ids: `builtin.<Tool>@1`, `mcp-exact.<server>.<tool>@1`, `mcp-token.<token>@1`, `shell.cg-al.<op>@1`, `shell.cg-al.meta@1`, `shell.toolchain.al@1`, `shell.toolchain.alc@1`, `shell.git@1`, `shell.read@1`, `shell.search@1`, `shell.edit@1`, `shell.redirect@1`, `shell.env@1`, `none@1`.

- [ ] **Step 1: Build the labelled fixture from the accepted M0-07 evidence**

```bash
paste -d'\t' <(tail -n +2 /h/Temp3/harness-spike/M0-07/labels-blind.csv | cut -d, -f2) /h/Temp3/harness-spike/M0-07/calls.jsonl \
  | jq -Rc 'split("\t") as [$label, $call] | ($call | fromjson) as $c
      | {i: (input_line_number - 1), harness: ($c.file | split("\\") | last | split("/") | last | split("-") | first),
         tool: $c.tool, command: ($c.command // null), label: $label}' \
  > /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl
wc -l /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl   # 45
grep -c '"harness":"claude"' /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl   # 27
```

Scan for both M0 secret values (0 hits); `.gitattributes` already covers `tests/fixtures/harness/** -text` (add the line if not).

- [ ] **Step 2: Write the failing tests** (`tests/unit/harness/classify.test.ts`)

```typescript
import { assertEquals } from "@std/assert";
import { CATEGORIES, classify, RULES_VERSION } from "../../../src/harness/classify.ts";

const c = (tool: string, command: string | null = null, target: string | null = null) => classify({ tool, command, target });

Deno.test("classify: the 45 blind-labelled M0-07 calls match their labels (training pin, not held-out accuracy)", async () => {
  const rows = (await Deno.readTextFile("tests/fixtures/harness/classify/m0-07-labeled.jsonl")).trim().split("\n").map((l) => JSON.parse(l));
  assertEquals(rows.length, 45);
  const wrong = rows.map((r) => ({ r, got: c(r.tool, r.command).category })).filter(({ r, got }) => got !== r.label)
    .map(({ r, got }) => `${r.i} ${r.tool} ${r.command ?? ""}: ${got}, label ${r.label}`);
  assertEquals(wrong, []);
});

Deno.test("classify: carryover rules from accept-M0-07", () => {
  const cases: [string, string | null, string][] = [
    ["Skill", null, "other"], ["Agent", null, "other"], ["Task", null, "other"], ["ToolSearch", null, "other"],
    ["Bash", "cg-al --version", "other"], ["Bash", "cg-al publish Core", "other"], ["PowerShell", "cg-al frobnicate", "other"],
    ["PowerShell", 'Set-Content -Path a.txt -Value "x"; Get-ChildItem', "edit"],
    ["PowerShell", '(Get-ChildItem -Path "C:\\workspace\\src" -Filter *.al -Recurse -File | Measure-Object).Count', "search"],
    ["bash", "set | grep PI_", "other"],
    ["mcp__al-tools__al_compile", null, "compile"], ["mcp__al-tools__al_test", null, "test"],
    ["mcp__al-tools__al_symbols", null, "symbols"], ["mcp__al-tools__al_new_thing", null, "unclassified"],
    ["mcp__test-server__read_file", null, "unclassified"], ["mcp__other__build_app", null, "compile"],
    ["mcp__other__run-tests", null, "test"], ["mcp__other__publish_app", null, "publish"], ["mcp__other__attest", null, "unclassified"],
  ];
  for (const [tool, cmd, want] of cases) assertEquals(c(tool, cmd).category, want, `${tool} ${cmd}`);
});

Deno.test("classify: command shapes (cg-al, toolchain, wrappers, redirects)", () => {
  const cases: [string, string, string][] = [
    ["Bash", "cg-al compile Core Rental", "compile"], ["Bash", "cg-al test 80000", "test"], ["Bash", "cg-al symbols", "symbols"],
    ["PowerShell", "& 'C:\\cg-al.ps1' compile Core", "compile"],
    ["PowerShell", "powershell -NoProfile -File C:\\cg-al.ps1 test 80001", "test"],
    ["PowerShell", "cg-al.cmd compile", "compile"], ["PowerShell", 'powershell -Command "cg-al compile Core"', "compile"],
    ["Bash", 'cmd /c "cg-al test"', "test"], ["Bash", "cd /c/workspace && cg-al compile Core", "compile"],
    ["Bash", "al compile /project:C:\\workspace\\Core /packagecachepath:C:\\workspace\\.alpackages", "compile"],
    ["PowerShell", "al.exe compile /project:Core", "compile"],
    ["Bash", "dotnet C:\\tools\\altool.dll compile /project:Core", "compile"],
    ["PowerShell", "& 'C:\\bc\\alc.exe' /project:Core /packagecachepath:.alpackages", "compile"],
    ["Bash", "git diff --stat", "vcs"], ["Bash", "echo hi > Core/src/A.al", "edit"], ["Bash", "cat a.al > b.al", "edit"],
    ["Bash", "ls 2>/dev/null", "search"], ["Bash", "cat a.al 2>&1 | head -5", "read"],
  ];
  for (const [tool, cmd, want] of cases) assertEquals(c(tool, cmd).category, want, cmd);
});

Deno.test("classify: never a guess (unknown segment, quoted '>', unknown command with a redirect, empty)", () => {
  for (const cmd of ["python make.py", "ls; python x.py", "echo hi", 'echo "x > a.al"', "python make.py > out.txt", "", "al GetPackageManifest x.app"]) {
    assertEquals(c("Bash", cmd), { category: "unclassified", classifier: `none@${RULES_VERSION}` }, cmd);
  }
  assertEquals(c("Bash").category, "unclassified");
  assertEquals(c("WebFetch").category, "unclassified");
});

Deno.test("classify: builtins, pi tools, skill reads, classifier ids", () => {
  assertEquals(c("Read"), { category: "read", classifier: "builtin.Read@1" });
  assertEquals(c("Write").category, "edit");
  assertEquals(c("read", null, ".pi/skills/fleet-notes/SKILL.md").category, "read");
  assertEquals(c("Bash", "cg-al compile Core").classifier, "shell.cg-al.compile@1");
  assertEquals(c("mcp__al-tools__al_compile").classifier, "mcp-exact.al-tools.al_compile@1");
  assertEquals(c("mcp__x__build").classifier, "mcp-token.build@1");
  assertEquals(CATEGORIES.length, 10);
});
```

- [ ] **Step 3: Run to verify failure:** `deno test --allow-all tests/unit/harness/classify.test.ts` fails (module missing).

- [ ] **Step 4: Implement** `src/harness/classify.ts`

```typescript
/**
 * Deterministic, versioned call categorization (spec 1a section 5, D14).
 * Rules only (Laya cut). No rule, no category: `unclassified`. Skill use is a
 * trace event type (skill_invoke), never a category (accept-M0-07).
 * Changing any rule bumps RULES_VERSION.
 */

export const CATEGORIES = ["compile", "test", "publish", "symbols", "read", "search", "edit", "vcs", "other", "unclassified"] as const;
export type Category = (typeof CATEGORIES)[number];
export const RULES_VERSION = 1;

export interface CallInput {
  tool: string;
  command: string | null;
  target: string | null;
}
export interface Classification {
  category: Category;
  classifier: string;
}

const at = (rule: string, category: Category): Classification => ({ category, classifier: `${rule}@${RULES_VERSION}` });
const NONE = () => at("none", "unclassified");

const BUILTIN: Record<string, Category> = {
  Read: "read", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", MultiEdit: "edit", NotebookEdit: "edit",
  Skill: "other", Agent: "other", Task: "other", ToolSearch: "other",
  read: "read", grep: "search", find: "search", ls: "search", edit: "edit", write: "edit",
};
const SHELLS = new Set(["Bash", "bash", "PowerShell"]);

/** Exact tool parts for known servers (al-tools: M3-03's tool list). An unknown tool of a known server is unclassified. */
const MCP_EXACT: Record<string, Record<string, Category>> = {
  "al-tools": { al_compile: "compile", al_test: "test", al_symbols: "symbols" },
};
/** Whole-token matches for unknown servers (`attest` is not `test`). */
const MCP_TOKENS: [string, Category][] = [
  ["compile", "compile"], ["build", "compile"], ["test", "test"], ["tests", "test"],
  ["publish", "publish"], ["deploy", "publish"], ["symbol", "symbols"], ["symbols", "symbols"],
];

function classifyMcp(tool: string): Classification {
  const rest = tool.slice("mcp__".length);
  const cut = rest.indexOf("__");
  if (cut <= 0) return NONE();
  const server = rest.slice(0, cut);
  const name = rest.slice(cut + 2);
  if (Object.hasOwn(MCP_EXACT, server)) {
    const table = MCP_EXACT[server]!;
    return Object.hasOwn(table, name) ? at(`mcp-exact.${server}.${name}`, table[name]!) : NONE();
  }
  const tokens = name.toLowerCase().split(/[_\-.]+/);
  for (const [tok, cat] of MCP_TOKENS) if (tokens.includes(tok)) return at(`mcp-token.${tok}`, cat);
  return NONE();
}

const NEUTRAL = new Set(["cd", "set-location", "sl", "pushd", "popd", "echo", "write-output", "write-host", "true", "exit"]);
/** Only shape the output of the segment before the pipe. */
const FILTERS = new Set([
  "head", "tail", "grep", "egrep", "select-string", "sls", "findstr", "sort", "sort-object", "uniq", "wc",
  "measure-object", "measure", "select-object", "select", "where-object", "where", "out-string", "format-table", "ft", "format-list", "fl", "cut",
]);
const READ = new Set(["cat", "type", "get-content", "gc", "more", "less"]);
const SEARCH = new Set(["ls", "dir", "get-childitem", "gci", "find", "rg", "grep", "select-string", "findstr", "tree", "test-path"]);
const EDIT = new Set(["set-content", "add-content", "out-file", "new-item", "ni", "remove-item", "rm", "del", "move-item", "mv", "copy-item", "cp", "rename-item", "mkdir", "md", "touch"]);
const ENV = new Set(["set", "env", "printenv"]);
const STRENGTH: Category[] = ["compile", "test", "publish", "symbols", "edit", "vcs", "read", "search", "other"];
/** A redirect to a real file, tested on the unquoted text only; 2>&1, >$null, >/dev/null, >nul are not edits. */
const REDIRECT = /(^|[^0-9&>])>>?\s*(?!&|\$null\b|\/dev\/null\b|nul\b)[^\s&|]/i;
const unquoted = (s: string) => s.replace(/"[^"]*"|'[^']*'/g, "");

/** Split on ; && || | and newlines outside quotes; a segment after | is piped. */
function segments(cmd: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = "";
  let piped = false;
  let q: string | null = null;
  const cut = (next: boolean) => {
    out.push({ text: cur, piped });
    cur = "";
    piped = next;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (q !== null) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      cut(false);
      i++;
    } else if (ch === ";" || ch === "\n") cut(false);
    else if (ch === "|") cut(true);
    else cur += ch;
  }
  cut(false);
  return out.map((s) => ({ ...s, text: s.text.trim().replace(/^[$@]?\(+/, "") })).filter((s) => s.text !== "");
}

const words = (s: string) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
const commandWord = (w: string) =>
  (w.replace(/^&/, "").replace(/\).*$/, "").split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|cmd|ps1|bat|dll)$/, "");

function classifyShell(cmd: string, depth = 0): Classification {
  const picked: Classification[] = [];
  for (const seg of segments(cmd)) {
    const r = classifySegment(seg.text, seg.piped, depth);
    if (r === "neutral") continue;
    if (r === null) return NONE();
    picked.push(r);
  }
  if (picked.length === 0) return NONE();
  return picked.sort((a, b) => STRENGTH.indexOf(a.category) - STRENGTH.indexOf(b.category))[0]!;
}

function base(ws: string[], piped: boolean): Classification | "neutral" | null {
  const w0 = commandWord(ws[0]!);
  if (piped && FILTERS.has(w0)) return "neutral";
  if (NEUTRAL.has(w0)) return "neutral";
  if (w0 === "cg-al") {
    const op = (ws[1] ?? "").toLowerCase();
    return ["compile", "test", "symbols"].includes(op) ? at(`shell.cg-al.${op}`, op as Category) : at("shell.cg-al.meta", "other");
  }
  if (w0 === "al" || w0 === "altool") return (ws[1] ?? "").toLowerCase() === "compile" ? at("shell.toolchain.al", "compile") : null;
  if (w0 === "alc") return at("shell.toolchain.alc", "compile");
  if (w0 === "git") return at("shell.git", "vcs");
  if (READ.has(w0)) return at("shell.read", "read");
  if (SEARCH.has(w0)) return at("shell.search", "search");
  if (EDIT.has(w0)) return at("shell.edit", "edit");
  if (ENV.has(w0)) return at("shell.env", "other");
  return null;
}

function classifySegment(text: string, piped: boolean, depth: number): Classification | "neutral" | null {
  let ws = words(text);
  if (ws[0] === "&") ws = ws.slice(1);
  if (ws.length === 0) return "neutral";
  const w0 = commandWord(ws[0]!);
  if (depth < 3 && ["powershell", "pwsh", "cmd", "bash", "sh"].includes(w0)) {
    const i = ws.findIndex((w, k) => k > 0 && /^([-/](c|command|file))$/i.test(w));
    return i < 0 ? null : classifyShell(ws.slice(i + 1).join(" "), depth + 1);
  }
  if (w0 === "dotnet" && ws[1] && /\.dll$/i.test(ws[1])) ws = ws.slice(1);
  const b = base(ws, piped);
  // A redirect makes a known segment an edit; an unknown command stays unknown.
  if (b !== null && REDIRECT.test(unquoted(text))) return at("shell.redirect", "edit");
  return b;
}

export function classify(c: CallInput): Classification {
  if (c.tool.startsWith("mcp__")) return classifyMcp(c.tool);
  if (SHELLS.has(c.tool)) return c.command ? classifyShell(c.command) : NONE();
  return Object.hasOwn(BUILTIN, c.tool) ? at(`builtin.${c.tool}`, BUILTIN[c.tool]!) : NONE();
}
```

- [ ] **Step 5: Run to verify pass** (5 tests). A failing labelled row is fixed in the rule, never the label.
- [ ] **Step 6: Commit** `feat(harness): rule-based call categorization v1 with M0-07 carryovers (M2-01)`.

**Acceptance:** tests pass; 45/45 labelled calls, 0 unclassified (training pin).

---

### Task M2-02: redaction beyond exact secrets, on the publication path

Spec 1a section 5 (secrets redacted before storage: known values and token patterns); `accept-M0-04` carryover; secrets-accepted-risk condition. Review item 4: patterns for UTF-8 and UTF-16LE captures; tests on serialized raw logs, trace commands, tool-result content, stderr, strings; cut tail.

**Lane:** content. **Deps:** M1-12, M1-20 (accepted). **Date:** 09-27 (module and `sandbox.ts` wiring on the branch; integrated 10-06).

**Files:** Create `src/harness/redact-patterns.ts`; Modify `src/harness/sandbox.ts` (`publishRedacted`, `redactText`); Test `tests/unit/harness/redact-patterns.test.ts`, append `tests/unit/harness/sandbox.test.ts`, `tests/unit/harness/fsutil.test.ts`.

**Interfaces:** `SECRET_PATTERNS`; `redactPatternText(s): { text; count }`; `redactPatterns(data: Uint8Array): { out; count }` (UTF-8 and UTF-16LE ASCII runs).

- [ ] **Step 1: Failing tests** (`tests/unit/harness/redact-patterns.test.ts`)

```typescript
import { assertEquals } from "@std/assert";
import { redactPatterns, redactPatternText } from "../../../src/harness/redact-patterns.ts";

const A = "A".repeat(40);
const enc = new TextEncoder();
const u16 = (s: string) => new Uint8Array([...s].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8]));

Deno.test("redactPatternText: every pattern, surrounding text kept", () => {
  const cases: [string, string][] = [
    [`x sk-ant-oat01-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-ant-api03-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-or-v1-${"0".repeat(64)} y`, "x [REDACTED:openrouter-key] y"],
    [`x sk-proj-${A} y`, "x [REDACTED:openai-key] y"],
    [`x ghp_${A} y`, "x [REDACTED:github-token] y"],
    [`x eyJ${A}.eyJ${A}.${A} y`, "x [REDACTED:jwt] y"],
    [`Authorization: Bearer ${A}`, "Authorization: Bearer [REDACTED:bearer]"],
  ];
  for (const [input, want] of cases) assertEquals(redactPatternText(input).text, want, input);
});

Deno.test("redactPatternText: hashes, uuids, stream ids and existing markers are not secrets", () => {
  for (const s of ["sha256:" + "a".repeat(64), "1ae7bb8f-04b6-4431-b315-c3a36ef73f35", "toolu_01YBAhLW7fMAGUsCorHcdN6D msg_011CfQ7y4eF8fJdGnHsHN2P3", "Bearer [REDACTED:backend-token]", "sk-short"]) {
    assertEquals(redactPatternText(s), { text: s, count: 0 }, s);
  }
});

Deno.test("redactPatterns: UTF-8 bytes around the match untouched; UTF-16LE runs redacted in UTF-16LE", () => {
  const r = redactPatterns(enc.encode(`ø sk-ant-oat01-${A} æ\n`));
  assertEquals([new TextDecoder().decode(r.out), r.count], ["ø [REDACTED:anthropic-key] æ\n", 1]);
  const w = redactPatterns(new Uint8Array([0xff, 0xfe, ...u16(`err sk-ant-oat01-${A}\r\n`)]));
  assertEquals(new TextDecoder("utf-16le").decode(w.out.subarray(2)), "err [REDACTED:anthropic-key]\r\n");
  assertEquals(w.count, 1);
});

Deno.test("redactPatterns: the M0-04 probe fixture has no false positives", async () => {
  const data = await Deno.readFile("tests/fixtures/harness/claude-code/probe.jsonl");
  const r = redactPatterns(data);
  assertEquals([r.count, r.out], [0, data]);
});
```

Append to `tests/unit/harness/sandbox.test.ts`:

```typescript
Deno.test("publishRedacted redacts patterns in a serialized raw log, trace and UTF-16LE stderr (exact secrets first)", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const key = `sk-ant-oat01-${"B".repeat(40)}`;
  const tok = "s".repeat(20);
  const raw = JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: `found ${key} and Bearer ${tok}` }] } }) + "\n";
  const trace = JSON.stringify({ v: 2, command: `echo ${key}` }) + "\n";
  const stderr = new Uint8Array([0xff, 0xfe, ...[...`warn ${key}\r\n`].flatMap((ch) => [ch.charCodeAt(0), 0])]);
  await Deno.writeTextFile(join(dir, "raw.jsonl"), raw);
  await Deno.writeTextFile(join(dir, "trace.jsonl"), trace);
  await Deno.writeFile(join(dir, "stderr.txt"), stderr);
  const n = await publishRedacted(["raw.jsonl", "trace.jsonl", "stderr.txt"].map((f) => ({ src: join(dir, f), dest: join(dir, "out", f) })), [{ name: "backend-token", value: tok }]);
  const outRaw = await Deno.readTextFile(join(dir, "out", "raw.jsonl"));
  assertStringIncludes(outRaw, "[REDACTED:anthropic-key] and Bearer [REDACTED:backend-token]");
  assertEquals(outRaw.includes(key) || outRaw.includes(tok), false);
  assertEquals((await Deno.readTextFile(join(dir, "out", "trace.jsonl"))).includes(key), false);
  assertEquals(new TextDecoder("utf-16le").decode((await Deno.readFile(join(dir, "out", "stderr.txt"))).subarray(2)), "warn [REDACTED:anthropic-key]\r\n");
  assertEquals(n, 4);
});

Deno.test("publishRedacted: a capture cut inside a pattern token leaves no prefix of 20 chars or more", async () => {
  // Accepted ceiling: a cut tail shorter than the pattern minimum is not a complete key and is left as is.
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "a.txt"), `x sk-ant-oat01-${"D".repeat(25)}`);
  await Deno.writeTextFile(join(dir, "b.txt"), `x sk-ant-oat01-${"D".repeat(19)}`);
  await publishRedacted(["a.txt", "b.txt"].map((f) => ({ src: join(dir, f), dest: join(dir, "out", f) })), []);
  assertEquals(await Deno.readTextFile(join(dir, "out", "a.txt")), "x [REDACTED:anthropic-key]");
  assertEquals(await Deno.readTextFile(join(dir, "out", "b.txt")), `x sk-ant-oat01-${"D".repeat(19)}`);
});

Deno.test("redactText redacts token patterns after exact secrets", () => {
  assertEquals(redactText(`e: Bearer ${"C".repeat(30)}`, []).text, "e: Bearer [REDACTED:bearer]");
});
```

Write the cut-tail test concretely: two files, `...sk-ant-oat01-${"D".repeat(25)}` (expect redacted) and `...sk-ant-oat01-${"D".repeat(19)}` (expect unchanged); the comment above records the accepted ceiling (a tail shorter than the pattern minimum is not a complete key).

Append to `tests/unit/harness/fsutil.test.ts`, copying the arrange block of the existing `freezeWorkspace` test: `the workspace freeze is not pattern-redacted` (a `Core/src/A.al` containing `// sk-ant-oat01-<40 x D>` freezes byte-identical with secrets `[]`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/harness/redact-patterns.ts`

```typescript
/**
 * Token-pattern redaction for published files and strings (M0-04 carryover).
 * Runs after exact-secret redaction. Never applied to the frozen workspace.
 * Byte-level: UTF-8 (patterns are ASCII, bytes >= 0x80 never match) and
 * UTF-16LE (runs of ASCII chars each followed by 0x00 are collapsed,
 * redacted and re-expanded).
 */

export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g }, // before openai: sk-ant- fits its shape too
  { name: "openrouter-key", re: /sk-or-v1-[A-Za-z0-9]{32,}/g },
  { name: "openai-key", re: /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/g },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
];
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi;

export function redactPatternText(s: string): { text: string; count: number } {
  let count = 0;
  let text = s;
  for (const p of SECRET_PATTERNS) {
    text = text.replace(p.re, () => (count++, `[REDACTED:${p.name}]`));
  }
  text = text.replace(BEARER, (_m, prefix: string) => (count++, `${prefix}[REDACTED:bearer]`));
  return { text, count };
}

const toBin = (d: Uint8Array) => {
  let s = "";
  for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, i + 8192));
  return s;
};
const fromBin = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const U16_RUN = /(?:[\x09\x0a\x0d\x20-\x7e]\x00){16,}/g;

export function redactPatterns(data: Uint8Array): { out: Uint8Array; count: number } {
  let count = 0;
  const r8 = redactPatternText(toBin(data));
  count += r8.count;
  const s16 = r8.text.replace(U16_RUN, (run) => {
    const r = redactPatternText(run.replace(/\x00/g, ""));
    if (r.count === 0) return run;
    count += r.count;
    return [...r.text].map((ch) => ch + "\x00").join("");
  });
  return count === 0 ? { out: data, count: 0 } : { out: fromBin(s16), count };
}
```

In `src/harness/sandbox.ts`: `publishRedacted` applies `redactPatterns` to `t.out` (after `redactBytes` and `redactCutTail`) and adds its count; `redactText` applies `redactPatternText` after the exact loop.

- [ ] **Step 4: Run to verify pass:** `deno test --allow-all tests/unit/harness/redact-patterns.test.ts tests/unit/harness/sandbox.test.ts tests/unit/harness/fsutil.test.ts`.
- [ ] **Step 5: Commit** `feat(harness): pattern redaction on the publication path, UTF-8 and UTF-16LE (M2-02)`.

**Acceptance:** tests pass; probe fixture 0 hits; frozen workspace untouched.

---

### Task M2-03: trace v2 and the full Claude Code trace builder

Spec 1a section 5 trace fields and types, D14, section 11. Findings section 4 (sub-agents via `parent_tool_use_id`, skills as `Skill` tool_use, MCP as `mcp__<server>__<tool>`, timestamps on `assistant`/`user` records, assistant chunks repeat a message id). Review items 2 (structural problems), 4 (no mid-token cut), 5 (evidence-based error classes; replayable classification). Retry and compaction are **not** parsed here (M2-12 adds them from recordings).

Error classes come only from structured evidence in the tool result: the cg-al client line `{"op", "client": {"status"}, "result": {...}}` (M1-19) or the al-tools MCP reply `{"op", "status", "result"}` (M3-03). `result.apps[]` with an `ok: false` entry carrying diagnostics gives `compile_diagnostics`; `result.tests[]` with a row `failure: "assertion"` and no row `failure: "infra"` gives `test_assertion`; any `failure: "infra"` row, `result.infra`, status 0, 401 or >= 500 gives `infra`; status 400 gives `tool_protocol`; `<tool_use_error>` text gives `tool_protocol`; a permission denial gives `denied`; anything else is null.

**Lane:** content. **Deps:** M2-01, M2-02 (patterns), M1-32. **Date:** 09-28 to 09-29 (integrated 10-06, before M3-01's `claude-code.ts` move, which rebases on it).

**Files:** Modify `src/harness/trace.ts`; Create `src/harness/adapters/jsonl.ts`, `src/harness/call-fields.ts`, `src/harness/adapters/claude-trace.ts`; Modify `src/harness/adapters/claude-code.ts` (import the helpers from `jsonl.ts`; replace the outcome and trace loops with `claudeTrace`); Test `tests/unit/harness/claude-trace.test.ts`, modify `claude-code.test.ts` (probe test counts `tool_call` events) and `adapter.test.ts` (trace literals gain the v2 fields).

**Interfaces:**
- trace.ts: `TRACE_VERSION = 2`; v2 adds `command: string | null`, `command_cut: boolean | null`, `target: string | null`, `category: Category | null`, `classifier: string | null`; `writeTrace` unchanged otherwise; `readTrace(path): Promise<TraceEvent[]>` (v1 upgraded with nulls; mixed versions or bad `seq` refused with `ValidationError` naming file and line).
- jsonl.ts: `interface J`, `interface Line { rec: J; line: number }`, `isObj`, `obj`, `list` (M3-01 adds `readRecords`, `nonJsonReason`, `only`, `refuse`).
- call-fields.ts: `MAX_COMMAND_CHARS = 16384`; `callFields(tool: string, rawCommand: string | null, target: string | null): { command; command_cut; target; category; classifier }` (patterns redacted before anything is stored; classification on the full redacted command; an over-cap command is stored as `null` with `command_cut: true`, never cut mid-token).
- claude-trace.ts: `transportOf(tool)`; `interface ClaudeTrace { events; problems: string[]; structural: string[]; requests: Map<string, number>; unidentified: number }`; `claudeTrace(lines, file, denied: ReadonlySet<string>): ClaudeTrace`. `structural` lists problems that make the trace incomplete (orphan parent, orphan result, tool_use without a result while a final result exists and it was not denied, assistant record without a message id or model); `unidentified` counts assistant records without a message id.

- [ ] **Step 1: Failing tests** (`tests/unit/harness/claude-trace.test.ts`)

```typescript
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { claudeTrace } from "../../../src/harness/adapters/claude-trace.ts";
import type { Line } from "../../../src/harness/adapters/jsonl.ts";
import { callFields, MAX_COMMAND_CHARS } from "../../../src/harness/call-fields.ts";
import { readTrace, writeTrace } from "../../../src/harness/trace.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const lines = (text: string): Line[] =>
  text.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim()).map(({ l, i }) => ({ rec: JSON.parse(l), line: i + 1 }));
const probe = async () => lines(await Deno.readTextFile(FIXTURE));
const rec = (o: Record<string, unknown>, line: number): Line => ({ rec: o, line });
const asst = (id: string | null, blocks: unknown[], parent: string | null = null, ts = "2026-10-01T00:00:00.000Z") =>
  ({ type: "assistant", timestamp: ts, parent_tool_use_id: parent, message: { ...(id ? { id: `msg_${id}` } : {}), model: "m", content: blocks } });
const res = (id: string, content: unknown, isError = false, ts = "2026-10-01T00:00:01.000Z") =>
  ({ type: "user", timestamp: ts, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });
const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use", id, name, input });

Deno.test("claudeTrace: probe gives requests, calls, skill and sub-agent in stream order, no problems", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  assertEquals(t.events.map((e) => `${e.type}:${e.tool ?? e.request_id}`), [
    "model_request:msg_011CfQ7y4eF8fJdGnHsHN2P3", "tool_call:Skill", "skill_invoke:Skill", "tool_call:Read", "tool_call:Bash",
    "tool_call:Agent", "subagent_spawn:Agent", "tool_call:ToolSearch", "model_request:msg_011CfQ7yrmQDhhPFDNQMjuRm",
    "tool_call:Glob", "model_request:msg_011CfQ7zG18wv3RDeVHig78o", "tool_call:mcp__al-tools__al_compile",
    "model_request:msg_011CfQ818GqWA9CenXhE8eWR",
  ]);
  assertEquals([t.requests.get("claude-sonnet-5"), t.problems, t.structural, t.unidentified], [4, [], [], 0]);
});

Deno.test("claudeTrace: sub-agent attribution, timing, fields", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  const glob = t.events.find((e) => e.tool === "Glob")!;
  assertEquals([glob.agent, glob.parent], ["general-purpose", "toolu_01JFf97YM2Bqmy8ACxXQgweb"]);
  const read = t.events.find((e) => e.tool === "Read")!;
  assertEquals([read.t_ms, read.duration_ms, read.target, read.category], [1230, 45, "C:\\workspace\\src\\FleetMgt.Codeunit.al", "read"]);
  const bash = t.events.find((e) => e.tool === "Bash")!;
  assertEquals([bash.command, bash.command_cut, bash.classifier, bash.outcome, bash.error_class], ["cg-al --version", false, "shell.cg-al.meta@1", "error", null]);
  const mcp = t.events.find((e) => e.tool === "mcp__al-tools__al_compile")!;
  assertEquals([mcp.transport, mcp.category, mcp.duration_ms, mcp.command, mcp.error_class], ["mcp:al-tools", "compile", 8186, null, null]);
});

Deno.test("claudeTrace: interleaved sub-agent messages and repeated chunks count each message once", () => {
  const t = claudeTrace([
    rec(asst("1", [use("a", "Agent", { subagent_type: "Explore" })]), 1),
    rec(asst("2", [use("b", "Glob")], "a"), 2),
    rec(asst("1", [use("c", "Read")]), 3),
    rec(asst("2", [use("d", "Grep")], "a"), 4),
    ...["a", "b", "c", "d"].map((id, i) => rec(res(id, "ok"), 5 + i)),
  ], "f", new Set());
  assertEquals(t.requests.get("m"), 2);
  assertEquals(t.events.filter((e) => e.type === "tool_call").map((e) => `${e.tool}:${e.agent}`), ["Agent:main", "Glob:Explore", "Read:main", "Grep:Explore"]);
  assertEquals(t.structural, []);
});

Deno.test("claudeTrace: structural problems (orphan parent once, orphan result, lost result, no message id)", () => {
  const t = claudeTrace([
    rec(asst("1", [use("a", "Read")], "toolu_missing"), 1),
    rec(asst("2", [use("b", "Glob")], "toolu_missing"), 2),
    rec(asst(null, [use("c", "Grep")]), 3),
    rec(res("zzz", "x"), 4),
    rec({ type: "result", subtype: "success", is_error: false }, 5),
  ], "f", new Set());
  assertEquals(t.events.filter((e) => e.type === "tool_call").map((e) => e.agent), ["subagent", "subagent", "main"]);
  assertEquals(t.unidentified, 1);
  assertEquals(t.structural, [
    "f:1: parent_tool_use_id toolu_missing has no earlier Agent call",
    "f:3: assistant record without a message id or model",
    "tool_result for unknown zzz",
    "tool_use a has no result",
    "tool_use b has no result",
    "tool_use c has no result",
  ]);
});

Deno.test("claudeTrace: error classes only from structured backend evidence", () => {
  const cgal = (op: string, status: number, result: unknown) => JSON.stringify({ op, client: { script_ms: 900, status }, result });
  const mcpReply = (op: string, status: number, result: unknown) => ({ type: "text", text: JSON.stringify({ op, status, result }) });
  const t = claudeTrace([
    rec(asst("1", [
      use("a", "Bash", { command: "cg-al compile Core" }), use("b", "Bash", { command: "cg-al test 80000" }),
      use("c", "Bash", { command: "cg-al test 80000" }), use("d", "PowerShell", { command: "cg-al compile Core" }),
      use("e", "Read", { file_path: "C:\\x" }), use("f", "mcp__al-tools__al_test", {}), use("g", "Bash", { command: "cg-al compile" }),
    ]), 1),
    rec(res("a", `Exit code 1\n${cgal("compile", 200, { request: "br_1", ok: false, apps: [{ app: "Core", ok: false, diagnostics: [{ code: "AL0118" }] }] })}`, true), 2),
    rec(res("b", `Exit code 1\n${cgal("test", 200, { request: "br_2", ok: false, tests: [{ outcome: "fail", failure: "assertion" }] })}`, true), 3),
    rec(res("c", `Exit code 1\n${cgal("test", 200, { request: "br_3", ok: false, apps: [{ app: "Core", ok: false, diagnostics: [{ code: "AL0118" }] }] })}`, true), 4),
    rec(res("d", `Exit code 2\n${cgal("compile", 503, { request: "br_4", infra: "container down" })}`, true), 5),
    rec(res("e", "<tool_use_error>File does not exist.</tool_use_error>", true), 6),
    rec(res("f", [mcpReply("test", 200, { request: "br_5", ok: false, tests: [{ outcome: "fail", failure: "assertion" }, { outcome: "error", failure: "infra" }] })], true), 7),
    rec(res("g", `Exit code 1\n${cgal("compile", 200, { request: "br_6", ok: false })}`, true), 8),
  ], "f", new Set());
  const by = (id: string) => t.events.find((x) => x.call_id === id && x.type === "tool_call")!;
  assertEquals(["a", "b", "c", "d", "e", "f", "g"].map((id) => [by(id).backend_request, by(id).error_class]), [
    ["br_1", "compile_diagnostics"], ["br_2", "test_assertion"], ["br_3", "compile_diagnostics"], ["br_4", "infra"],
    [null, "tool_protocol"], ["br_5", "infra"], ["br_6", null],
  ]);
});

Deno.test("claudeTrace: permission denials are denied", () => {
  const t = claudeTrace([rec(asst("1", [use("a", "Write", { file_path: "C:\\x" })]), 1), rec(res("a", "denied", true), 2)], "f", new Set(["a"]));
  const e = t.events.find((x) => x.type === "tool_call")!;
  assertEquals([e.outcome, e.error_class], ["denied", "denied"]);
});

Deno.test("callFields: an over-cap command is dropped, never cut; patterns redacted before storage", () => {
  const long = "echo " + "x".repeat(MAX_COMMAND_CHARS) + "; python x.py";
  assertEquals(callFields("Bash", long, null), { command: null, command_cut: true, target: null, category: "unclassified", classifier: "none@1" });
  const key = `sk-ant-oat01-${"K".repeat(40)}`;
  assertEquals(callFields("Bash", `echo ${key}`, null).command, "echo [REDACTED:anthropic-key]");
  assertEquals(callFields("Read", null, "C:\\a").command_cut, null);
});

Deno.test("claudeTrace: a repeated tool_use id is refused with the line", () => {
  assertThrows(() => claudeTrace([rec(asst("1", [use("a", "Read")]), 1), rec(asst("2", [use("a", "Read")]), 2)], "f", new Set()), ValidationError, "f:2: tool_use id a repeats line 1");
});

Deno.test("readTrace: v2 round trip; v1 upgraded; mixed versions refused", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  await writeTrace(join(dir, "v2.jsonl"), t.events);
  assertEquals(await readTrace(join(dir, "v2.jsonl")), t.events);
  const v1 = { ...t.events[1]!, v: 1 } as Record<string, unknown>;
  for (const k of ["command", "command_cut", "target", "category", "classifier"]) delete v1[k];
  await Deno.writeTextFile(join(dir, "v1.jsonl"), JSON.stringify(v1) + "\n");
  assertEquals((await readTrace(join(dir, "v1.jsonl")))[0]!.category, null);
  await Deno.writeTextFile(join(dir, "mix.jsonl"), JSON.stringify(v1) + "\n" + JSON.stringify({ ...t.events[2], seq: 3 }) + "\n");
  await assertRejects(() => readTrace(join(dir, "mix.jsonl")), ValidationError, "mix.jsonl:2");
});
```

In `claude-code.test.ts` probe test: `trace.filter((e) => e.type === "tool_call").length === toolUses` and `r.traceEvents === trace.length`. In `adapter.test.ts` trace literals add `v: 2, command: null, command_cut: null, target: null, category: null, classifier: null`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement trace v2** in `src/harness/trace.ts`: `const V1_FIELDS = { ...current fields except v }`; `const V1 = z.strictObject({ v: z.literal(1), ...V1_FIELDS })`; `TRACE_VERSION = 2`; `TraceEventSchema = z.strictObject({ v: z.literal(2), ...V1_FIELDS, command: Str, command_cut: z.boolean().nullable(), target: Str, category: z.enum(CATEGORIES).nullable(), classifier: Str })`; `readTrace` as below.

```typescript
export async function readTrace(path: string): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  let version: unknown = null;
  for (const [i, l] of (await Deno.readTextFile(path)).split("\n").entries()) {
    if (l.trim() === "") continue;
    const fail = (why: string): never => {
      const msg = `${path}:${i + 1}: ${why}`;
      throw new ValidationError(msg, [msg]);
    };
    let raw: unknown;
    try {
      raw = JSON.parse(l);
    } catch {
      fail("not JSON");
    }
    const v = (raw as { v?: unknown } | null)?.v;
    if (version !== null && v !== version) fail(`version ${v} after ${version}`);
    version = v;
    let e: TraceEvent;
    if (v === 1) {
      const r = V1.safeParse(raw);
      if (!r.success) fail(r.error.issues[0]!.message);
      e = { ...r.data!, v: TRACE_VERSION, command: null, command_cut: null, target: null, category: null, classifier: null };
    } else {
      const r = TraceEventSchema.safeParse(raw);
      if (!r.success) fail(r.error.issues[0]!.message);
      e = r.data!;
    }
    const prev = out.at(-1);
    if (prev && e.seq <= prev.seq) fail(`seq ${e.seq} does not follow ${prev.seq}`);
    out.push(e);
  }
  return out;
}
```

- [ ] **Step 4: Implement** `src/harness/adapters/jsonl.ts` (the `J` interface moved verbatim from `claude-code.ts` plus the keys `timestamp`, `input`, `text`, `op`, `client`, `result`, `request`, `ok`, `infra`, `apps`, `tests`, `failure`, `diagnostics`, `skill`, `subagent_type`, `file_path`, `notebook_path`, `path`, `command`, `permission_denials`, `status`; `Line`, `isObj`, `obj`, `list` moved verbatim) and `src/harness/call-fields.ts`:

```typescript
/** Stored per-call fields shared by every harness producer (Claude Code M2-03, pi M3-05). */

import type { Category } from "./classify.ts";
import { classify } from "./classify.ts";
import { redactPatternText } from "./redact-patterns.ts";

/** ponytail: chars, not bytes. Over the cap the command is not stored at all (a cut could leave a secret prefix). */
export const MAX_COMMAND_CHARS = 16384;

export function callFields(tool: string, rawCommand: string | null, target: string | null): {
  command: string | null;
  command_cut: boolean | null;
  target: string | null;
  category: Category;
  classifier: string;
} {
  const full = rawCommand === null ? null : redactPatternText(rawCommand).text;
  const cut = full !== null && full.length > MAX_COMMAND_CHARS;
  return {
    command: cut ? null : full,
    command_cut: full === null ? null : cut,
    target,
    ...classify({ tool, command: full, target }),
  };
}
```

- [ ] **Step 5: Implement** `src/harness/adapters/claude-trace.ts`

```typescript
/**
 * Claude Code stream-json records to trace v2 events (spec 1a section 5,
 * D14; findings section 4). Pure. Stream order: a model_request at the first
 * record of each assistant message id, a tool_call per tool_use block, plus a
 * subagent_spawn (Agent/Task) or skill_invoke (Skill) marker for the same
 * call. Retry and compaction records are added by M2-12 from recorded shapes.
 */

import type { TraceEvent } from "../trace.ts";
import type { J, Line } from "./jsonl.ts";
import { ValidationError } from "../../errors.ts";
import { callFields } from "../call-fields.ts";
import { TRACE_VERSION } from "../trace.ts";
import { isObj, list, obj } from "./jsonl.ts";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
const utf8 = new TextEncoder();

export function transportOf(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (m) return `mcp:${m[1]}`;
  return SHELL_TOOLS.has(tool) ? "shell" : "builtin";
}

export interface ClaudeTrace {
  events: TraceEvent[];
  problems: string[];
  /** Problems that make the trace incomplete. */
  structural: string[];
  /** Distinct visible assistant message ids per model. */
  requests: Map<string, number>;
  /** Assistant records without a message id (requests unprovable). */
  unidentified: number;
}

const refuse = (msg: string): never => {
  throw new ValidationError(msg, [msg]);
};
const ms = (ts: unknown) => {
  if (typeof ts !== "string") return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
};
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const textOf = (c: unknown) => typeof c === "string" ? c : list(c).map(obj).map((x) => (typeof x.text === "string" ? x.text : "")).join("\n");

/** The cg-al client line {op, client:{status}, result} or the al-tools MCP reply {op, status, result}. */
function backendReply(text: string): { op: string; status: number | null; result: J } | null {
  for (const l of text.split(/\r?\n/)) {
    const s = l.indexOf("{");
    if (s < 0) continue;
    try {
      const v = JSON.parse(l.slice(s));
      if (isObj(v) && typeof v.op === "string") {
        const st = isObj(v.client) ? v.client.status : v.status;
        return { op: v.op, status: typeof st === "number" ? st : null, result: obj(v.result) };
      }
    } catch {
      // not the reply line
    }
  }
  return null;
}

function errorClass(outcome: TraceEvent["outcome"], text: string, reply: ReturnType<typeof backendReply>): string | null {
  if (outcome === "denied") return "denied";
  if (outcome !== "error") return null;
  if (reply !== null) {
    const rows = list(reply.result.tests).map(obj);
    const failedApps = list(reply.result.apps).map(obj).filter((a) => a.ok === false && list(a.diagnostics).length > 0);
    const st = reply.status;
    if (reply.result.infra !== undefined || st === 0 || st === 401 || (st !== null && st >= 500) || rows.some((r) => r.failure === "infra")) return "infra";
    if (st === 400) return "tool_protocol";
    if (failedApps.length > 0) return "compile_diagnostics";
    if (rows.some((r) => r.failure === "assertion")) return "test_assertion";
    return null;
  }
  return text.trimStart().startsWith("<tool_use_error>") ? "tool_protocol" : null;
}

const BASE = {
  session: null, agent: "main", parent: null, call_id: null, request_id: null, tool: null, transport: null, skill: null,
  backend_request: null, outcome: null, error_class: null, result_bytes: null, truncated: null, duration_ms: null, model: null,
  command: null, command_cut: null, target: null, category: null, classifier: null,
} as const;

export function claudeTrace(lines: Line[], file: string, denied: ReadonlySet<string>): ClaudeTrace {
  const problems: string[] = [];
  const structural: string[] = [];
  const events: TraceEvent[] = [];
  const push = (e: Omit<TraceEvent, "v" | "seq">) => events.push({ v: TRACE_VERSION, seq: events.length + 1, ...e });
  const t0 = lines.map((l) => ms(l.rec.timestamp)).find((t) => t !== null) ?? null;
  const rel = (t: number | null) => (t === null || t0 === null ? null : Math.max(0, t - t0));
  const hasFinal = lines.some((l) => l.rec.type === "result");

  const results = new Map<string, { error: boolean; bytes: number; text: string; at: number | null }>();
  for (const { rec, line } of lines) {
    if (rec.type !== "user") continue;
    for (const c of list(obj(rec.message).content).map(obj)) {
      if (c.type !== "tool_result") continue;
      const id = c.tool_use_id;
      if (typeof id !== "string") refuse(`${file}:${line}: tool_result without a tool_use_id`);
      if (results.has(id as string)) refuse(`${file}:${line}: second result for ${id}`);
      const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      results.set(id as string, { error: c.is_error === true, bytes: utf8.encode(body).length, text: textOf(c.content), at: ms(rec.timestamp) });
    }
  }

  const spawned = new Map<string, string>();
  const orphans = new Set<string>();
  const seenMsg = new Set<string>();
  const callLine = new Map<string, number>();
  const requests = new Map<string, number>();
  let unidentified = 0;
  for (const { rec, line } of lines) {
    if (rec.type !== "assistant") continue;
    const parent = typeof rec.parent_tool_use_id === "string" ? rec.parent_tool_use_id : null;
    let agent = "main";
    if (parent !== null) {
      const a = spawned.get(parent);
      if (a === undefined && !orphans.has(parent)) {
        orphans.add(parent);
        structural.push(`${file}:${line}: parent_tool_use_id ${parent} has no earlier Agent call`);
      }
      agent = a ?? "subagent";
    }
    const session = str(rec.session_id);
    const at = ms(rec.timestamp);
    const msg = obj(rec.message);
    const model = str(msg.model);
    const requestId = str(msg.id);
    if (requestId === null || model === null) {
      unidentified++;
      structural.push(`${file}:${line}: assistant record without a message id or model`);
    } else if (!seenMsg.has(requestId)) {
      seenMsg.add(requestId);
      requests.set(model, (requests.get(model) ?? 0) + 1);
      push({ ...BASE, type: "model_request", t_ms: rel(at), session, agent, parent, request_id: requestId, model });
    }
    for (const c of list(msg.content).map(obj)) {
      if (c.type !== "tool_use") continue;
      if (typeof c.id !== "string" || typeof c.name !== "string") refuse(`${file}:${line}: tool_use without a string id and name`);
      const id = c.id as string;
      const name = c.name as string;
      const seen = callLine.get(id);
      if (seen !== undefined) refuse(`${file}:${line}: tool_use id ${id} repeats line ${seen}`);
      callLine.set(id, line);
      const input = obj(c.input);
      const rawCmd = SHELL_TOOLS.has(name) && typeof input.command === "string" ? input.command : null;
      const target = [input.file_path, input.notebook_path, input.path].map(str).find((v) => v !== null) ?? null;
      const r = results.get(id);
      const outcome: TraceEvent["outcome"] = denied.has(id) ? "denied" : r ? (r.error ? "error" : "ok") : null;
      const reply = r ? backendReply(r.text) : null;
      const common = { t_ms: rel(at), session, agent, parent, call_id: id, request_id: requestId, tool: name, transport: transportOf(name), model };
      push({
        ...BASE, ...common, type: "tool_call",
        skill: name === "Skill" ? str(input.skill) : null,
        backend_request: reply ? str(reply.result.request) : null,
        outcome,
        error_class: errorClass(outcome, r?.text ?? "", reply),
        result_bytes: r?.bytes ?? null,
        duration_ms: r && r.at !== null && at !== null && r.at >= at ? r.at - at : null,
        ...callFields(name, rawCmd, target),
      });
      if (SPAWN_TOOLS.has(name)) {
        spawned.set(id, str(input.subagent_type) ?? "subagent");
        push({ ...BASE, ...common, type: "subagent_spawn" });
      }
      if (name === "Skill") push({ ...BASE, ...common, type: "skill_invoke", skill: str(input.skill) });
    }
  }
  for (const id of [...results.keys()].sort()) if (!callLine.has(id)) structural.push(`tool_result for unknown ${id}`);
  if (hasFinal) {
    for (const id of [...callLine.keys()].sort()) {
      if (!results.has(id) && !denied.has(id)) structural.push(`tool_use ${id} has no result`);
    }
  }
  return { events, problems, structural, requests, unidentified };
}
```

(The structural-problem order in the test follows this code: line-ordered problems first, then sorted result ids, then sorted lost calls.)

- [ ] **Step 6: Switch the adapter.** In `claude-code.ts` import `J`, `Line`, `isObj`, `obj`, `list` from `./jsonl.ts` and `transportOf`, `claudeTrace` from `./claude-trace.ts`; delete the local copies, the "Tool outcomes" loop and the trace part of the assistant loop (keep `didWork` and `perMessage` for the TTL split and cost, unchanged). Then:

```typescript
  const denied = new Set(list(result?.permission_denials).map(obj).map((d) => d.tool_use_id).filter((x): x is string => typeof x === "string"));
  const built = claudeTrace(lines, file, denied);
  streamProblems.push(...built.problems, ...built.structural);
  const trace = built.events;
```

- [ ] **Step 7: Run to verify pass:** `deno test --allow-all tests/unit/harness/claude-trace.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/adapter.test.ts tests/unit/harness/pricing.test.ts`. Every M1-32 cost and hardening test passes unchanged (the cost path is not touched).
- [ ] **Step 8: Commit** `feat(harness): trace v2 and full Claude Code trace builder (M2-03)`.

**Acceptance:** tests pass; `deno check src/harness/**/*.ts` clean.

---

### Task M2-04: in-container Messages API stub

Retry, compaction and fatal records were not observed in M0 (findings section 4). The stub is plain Node-compatible JavaScript (`node:` built-ins only, like M3-03's `al-tools-mcp.mjs`), started inside the sandbox on `127.0.0.1:3400`, so no egress rule changes before or after the 10-08 firewall. Each `POST /v1/messages` consumes the next step; `after: "repeat_last"` repeats the last step; the default replies `end_turn` text "done". `count_tokens` answers `{input_tokens: 1}`; anything else 404. The request log (to a file under `%TEMP%`) holds index, path, model, stream flag, step and status only.

**Lane:** content. **Deps:** none. **Date:** 09-30. New files only.

**Files:** Create `scripts/harness/stub-anthropic.mjs`, `scripts/harness/stub-scenarios/{retry,fatal,compaction,arm-mcp,arm-skill,drift}.json`; Test `tests/unit/harness/stub-anthropic.test.ts`.

**Interfaces:** `checkScenario(s): Scenario` (throws `Error` naming the path); `createStub(s): (method: string, path: string, body: string) => { status: number; headers: Record<string, string>; body: string; log: { i; path; model; stream; step; status } }`; main: `node stub-anthropic.mjs <scenario.json> <log.jsonl> <port>` listening on `127.0.0.1`.

- [ ] **Step 1: Failing tests**

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { checkScenario, createStub } from "../../../scripts/harness/stub-anthropic.mjs";

const events = (body: string) =>
  body.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));

Deno.test("stub: tool_use step streams a complete message; input as one json delta; log has no headers", () => {
  const s = createStub(checkScenario({ steps: [{ content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "C:\\a" } }], stop_reason: "tool_use" }] }));
  const r = s("POST", "/v1/messages", JSON.stringify({ model: "claude-x", stream: true }));
  const ev = events(r.body);
  assertEquals(ev.map((e) => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  assertEquals([ev[0].message.model, JSON.parse(ev[2].delta.partial_json), ev[4].delta.stop_reason], ["claude-x", { file_path: "C:\\a" }, "tool_use"]);
  assertEquals(r.log, { i: 1, path: "/v1/messages", model: "claude-x", stream: true, step: 0, status: 200 });
});

Deno.test("stub: errors, repeat_last, default end_turn, count_tokens, 404, non-streaming", () => {
  const fatal = createStub(checkScenario({ steps: [{ status: 500, error_type: "api_error" }], after: "repeat_last" }));
  for (let i = 0; i < 3; i++) assertEquals(fatal("POST", "/v1/messages", "{}").status, 500);
  const s = createStub(checkScenario({ steps: [{ status: 529, error_type: "overloaded_error" }] }));
  assertEquals(JSON.parse(s("POST", "/v1/messages", "{}").body).error.type, "overloaded_error");
  assertEquals(events(s("POST", "/v1/messages", JSON.stringify({ stream: true })).body)[4].delta.stop_reason, "end_turn");
  assertEquals(JSON.parse(s("POST", "/v1/messages/count_tokens", "{}").body).input_tokens, 1);
  assertEquals(s("GET", "/v1/other", "").status, 404);
  assertEquals(JSON.parse(s("POST", "/v1/messages", JSON.stringify({ stream: false })).body).content[0].text, "done");
});

Deno.test("stub: usage states the TTL split; bad scenarios refused; every committed scenario parses", async () => {
  const s = createStub(checkScenario({ steps: [{ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 190000, cache_creation_input_tokens: 10 } }] }));
  const u = events(s("POST", "/v1/messages", JSON.stringify({ stream: true })).body)[0].message.usage;
  assertEquals([u.input_tokens, u.cache_creation], [190000, { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }]);
  assertThrows(() => checkScenario({ steps: [{ content: "x" }] }), Error, "steps[0]");
  for await (const f of Deno.readDir("scripts/harness/stub-scenarios")) {
    checkScenario(JSON.parse(await Deno.readTextFile(`scripts/harness/stub-scenarios/${f.name}`)));
  }
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `scripts/harness/stub-anthropic.mjs`

```javascript
// Scripted Anthropic Messages API, run inside the sandbox on 127.0.0.1 (M2-04).
// For fixture recording (M2-11) and arm qualification (M2-13) without a
// credential. node: built-ins only (runs under Node in the image, Deno in tests).
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import process from "node:process";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (v, d) => (v === undefined ? d : Number.isSafeInteger(v) && v >= 0 ? v : NaN);

export function checkScenario(s) {
  const fail = (p, why) => { throw new Error(`scenario ${p}: ${why}`); };
  if (!isObj(s) || !Array.isArray(s.steps)) fail("steps", "must be an array");
  if (s.after !== undefined && s.after !== "end_turn" && s.after !== "repeat_last") fail("after", "end_turn or repeat_last");
  const steps = s.steps.map((st, i) => {
    const p = `steps[${i}]`;
    if (!isObj(st)) fail(p, "must be an object");
    if (st.status !== undefined) {
      if (!Number.isInteger(st.status) || st.status < 400 || typeof st.error_type !== "string") fail(p, "status >= 400 and error_type");
      return { status: st.status, error_type: st.error_type };
    }
    if (!Array.isArray(st.content) || !["end_turn", "tool_use"].includes(st.stop_reason)) fail(p, "content array and stop_reason");
    for (const [k, b] of st.content.entries()) {
      const ok = isObj(b) && ((b.type === "text" && typeof b.text === "string") ||
        (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && isObj(b.input)));
      if (!ok) fail(`${p}.content[${k}]`, "text or tool_use block");
    }
    const u = isObj(st.usage) ? st.usage : {};
    const usage = {
      input_tokens: count(u.input_tokens, 10), output_tokens: count(u.output_tokens, 5),
      cache_read_input_tokens: count(u.cache_read_input_tokens, 0), cache_creation_input_tokens: count(u.cache_creation_input_tokens, 0),
    };
    if (Object.values(usage).some(Number.isNaN)) fail(`${p}.usage`, "non-negative integers");
    return { content: st.content, stop_reason: st.stop_reason, usage };
  });
  return { steps, after: s.after ?? "end_turn" };
}

const DONE = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
const usageOf = (m) => ({ ...m.usage, cache_creation: { ephemeral_5m_input_tokens: m.usage.cache_creation_input_tokens, ephemeral_1h_input_tokens: 0 } });
const JSON_H = { "content-type": "application/json" };

function sse(model, id, m) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", { message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usageOf(m), output_tokens: 1 } } });
  m.content.forEach((b, index) => {
    out += b.type === "text"
      ? ev("content_block_start", { index, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } })
      : ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }) + ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    out += ev("content_block_stop", { index });
  });
  return out + ev("message_delta", { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } }) + ev("message_stop", {});
}

export function createStub(s) {
  let next = 0;
  let n = 0;
  return (method, path, body) => {
    const log = { i: ++n, path, model: null, stream: null, step: null, status: 404 };
    const done = (status, headers, text) => ({ status, headers, body: text, log: { ...log, status } });
    if (method === "POST" && path === "/v1/messages/count_tokens") return done(200, JSON_H, JSON.stringify({ input_tokens: 1 }));
    if (method !== "POST" || path !== "/v1/messages") return done(404, JSON_H, JSON.stringify({ type: "error", error: { type: "not_found_error", message: path } }));
    let req = {};
    try { req = JSON.parse(body || "{}"); } catch { /* treat as empty */ }
    const model = typeof req.model === "string" ? req.model : "stub";
    log.model = model;
    log.stream = req.stream === true;
    const idx = next < s.steps.length ? next++ : s.after === "repeat_last" && s.steps.length > 0 ? s.steps.length - 1 : null;
    log.step = idx;
    const step = idx === null ? DONE : s.steps[idx];
    if (step.status !== undefined) return done(step.status, JSON_H, JSON.stringify({ type: "error", error: { type: step.error_type, message: "stub" } }));
    const id = `msg_stub_${n}`;
    if (!log.stream) {
      return done(200, JSON_H, JSON.stringify({ id, type: "message", role: "assistant", model, content: step.content, stop_reason: step.stop_reason, stop_sequence: null, usage: usageOf(step) }));
    }
    return done(200, { "content-type": "text/event-stream" }, sse(model, id, step));
  };
}

if (/stub-anthropic\.mjs$/.test(process.argv[1] ?? "")) {
  const [scenarioPath, logPath, port] = process.argv.slice(2);
  const stub = createStub(checkScenario(JSON.parse(readFileSync(scenarioPath, "utf8"))));
  http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { if (body.length < 1_000_000) body += c; });
    req.on("end", () => {
      const r = stub(req.method ?? "GET", new URL(req.url ?? "/", "http://stub").pathname, body);
      appendFileSync(logPath, JSON.stringify(r.log) + "\n");
      res.writeHead(r.status, r.headers).end(r.body);
    });
  }).listen(Number(port), "127.0.0.1");
}
```

Scenarios (every tool_use step `stop_reason: "tool_use"`, ids `toolu_stub_NN` in order):
- `retry.json`: 529, 529 (`overloaded_error`), then text "ok".
- `fatal.json`: `[{"status":500,"error_type":"api_error"}]`, `after: "repeat_last"`.
- `compaction.json`: `Read` of `C:\workspace\app.json` with `usage.input_tokens` 190000; text "Summary: read app.json."; text "ok".
- `arm-skill.json`: `Skill {"skill": "<one skill name from M2-07>"}`; `Bash {"command": "echo sk-ant-oat01-CANARYCANARYCANARYCANARYCANARY01"}`; `Bash {"command": "cg-al --version"}`; text "done".
- `arm-mcp.json`: `ToolSearch {"query":"select:mcp__al-tools__al_compile","max_results":1}`; `mcp__al-tools__al_compile {"apps":["Core"]}`; `mcp__al-tools__al_symbols {}`; `Agent {"subagent_type":"general-purpose","description":"list","prompt":"List C:\\workspace."}`; sub-agent `Glob {"pattern":"*"}`; sub-agent text "listed"; `Bash {"command":"type C:\\cg-secrets\\backend-token"}` (exact-secret canary); text "done".
- `drift.json`: text "done" (the runtime drift drill only needs `system/init`).

- [ ] **Step 4: Run to verify pass;** **Step 5: Commit** `feat(harness): in-container Messages API stub and scenarios (M2-04)`.

**Acceptance:** tests pass under Deno; `node --check scripts/harness/stub-anthropic.mjs` is not required on the host (Node is in the image); M2-11 proves it runs there.

---

### Task M2-05: metrics contract, completeness and capability provenance

Spec 1a section 5 "Metrics contract" and `telemetry.json`; `m1-metric-rules` (validity flags with metric-specific reasons); `accept-M1-32`. Review item 2.

Three separate notions, never merged:
- **capture complete**: a final `result` record and no non-JSON line;
- **trace complete**: capture complete and `claudeTrace(...).structural` empty;
- **metric complete**, per measurement: `cost_usd` (M1-32 rules, unchanged: a fatal run with a complete capture can still lack cost); `turns`, `stop_reason`, `wall_ms` (from the result); `per_model[m].requests` (capture complete and `unidentified === 0`).

Termination is independent of all three (M1-32).

Per-run provenance in `raw_usage.capabilities` = `{ v: 1, parser: "claude-code-trace@2", rules: "rules@1", telemetry: [...declared fields], nested: ["per_model.requests"], trace_types: [...] }`. The report reads these, never the installed adapter. `raw_usage.trace_complete: boolean`; `raw_usage.incomplete_reasons: Record<string, string>` with keys `<field>` or `per_model[<model>].requests`.

`incompleteTelemetry(declared, t)` (signature unchanged) additionally flags `per_model` when the run's `raw_usage.capabilities.nested` includes `per_model.requests` and an entry's `requests` is null. `per_model` in `incomplete_telemetry` never touches the primary metric (excluded only by `cost_usd`, M1-22/M1-09 rules).

**Lane:** content. **Deps:** M2-03. **Date:** 10-01 (integrated 10-06).

**Files:** Modify `src/harness/adapter.ts` (`incompleteTelemetry`), `src/harness/adapters/claude-code.ts`; Test append `tests/unit/harness/claude-code.test.ts`, `tests/unit/harness/adapter.test.ts`.

**Interfaces:** `CLAUDE_CAPABILITIES` (exported const, the object above); `raw_usage` keys `capabilities`, `trace_complete`, `incomplete_reasons`; `per_model[].requests` filled when metric complete.

- [ ] **Step 1: Failing tests** (append to `claude-code.test.ts`; `parse` is the file's helper)

```typescript
const raw = (r: { telemetry: Telemetry }) => r.telemetry.raw_usage as Record<string, any>;

Deno.test("metrics: probe is complete; requests per model; capabilities persisted; no reasons", async () => {
  const { r } = await parse(await Deno.readTextFile(FIXTURE));
  assertEquals([raw(r).trace_complete, raw(r).incomplete_reasons], [true, {}]);
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [4]);
  assertEquals(raw(r).capabilities, CLAUDE_CAPABILITIES);
  assertEquals(incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry), []);
});

Deno.test("metrics: usable final usage but an assistant record without a message id: cost valid, requests null, per_model incomplete with a reason", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const i = lines.findIndex((j) => j.type === "assistant");
  delete lines[i].message.id;
  const { r } = await parse(lines.map((j) => JSON.stringify(j)).join("\n") + "\n");
  assert(r.telemetry.cost_usd !== null, "primary cost stays valid");
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [null]);
  assertEquals(raw(r).trace_complete, false);
  assertEquals(incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry), ["per_model"]);
  assertStringIncludes(raw(r).incomplete_reasons["per_model[claude-sonnet-5].requests"], "without a message id");
});

Deno.test("metrics: final result plus a non-JSON line: capture incomplete, requests null, reasons named", async () => {
  const text = (await Deno.readTextFile(FIXTURE)).replace("\n", "\nWARNING stray\n");
  const { r } = await parse(text);
  assertEquals([raw(r).trace_complete, r.telemetry.per_model.map((m) => m.requests)], [false, [null]]);
  assertStringIncludes(raw(r).incomplete_reasons.cost_usd, "non-JSON");
});

Deno.test("metrics: a killed stream: every declared field null has a reason; compactions undeclared stays null", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean).slice(0, 20);
  const { r } = await parse(lines.join("\n") + "\n", null);
  const missing = incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry);
  assertEquals(Object.keys(raw(r).incomplete_reasons).filter((k) => !k.startsWith("per_model[")).sort(), missing.filter((k) => k !== "per_model").sort());
  assertStringIncludes(raw(r).incomplete_reasons.cost_usd, "no result record");
  assertEquals(r.telemetry.compactions, null);
});
```

Append to `adapter.test.ts`: `incompleteTelemetry flags per_model only when the run declares nested requests` (a telemetry with `per_model: [{..., requests: null}]` and `raw_usage.capabilities.nested: []` gives `[]`; with `["per_model.requests"]` gives `["per_model"]`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** `adapter.ts`:

```typescript
export function incompleteTelemetry(declared: readonly (keyof Telemetry)[], t: Telemetry): (keyof Telemetry)[] {
  const caps = (t.raw_usage as { capabilities?: { nested?: unknown } } | null)?.capabilities;
  const nested = Array.isArray(caps?.nested) ? caps.nested : [];
  return declared.filter((k) => {
    const v = t[k];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return true;
    return k === "per_model" && nested.includes("per_model.requests") && t.per_model.some((m) => m.requests === null);
  });
}
```

`claude-code.ts`: hoist `DECLARED` (current list) and export `CLAUDE_CAPABILITIES = { v: 1, parser: "claude-code-trace@2", rules: \`rules@${RULES_VERSION}\`, telemetry: DECLARED, nested: ["per_model.requests"], trace_types: ["tool_call", "model_request", "subagent_spawn", "skill_invoke"] } as const`. After `claudeTrace`:

```typescript
  const captureComplete = result !== undefined && nonJson.count === 0;
  const traceComplete = captureComplete && built.structural.length === 0;
  const requestsKnown = captureComplete && built.unidentified === 0;
```

Per model: `requests: requestsKnown ? (built.requests.get(model) ?? 0) : null`. After the telemetry object:

```typescript
  const noResult = "no result record (the run was killed or crashed before its final record)";
  const why = (k: string) =>
    !result ? noResult
    : k === "cost_usd" ? (est?.missing.join("; ") || "cost not computable")
    : nonJson.count > 0 ? nonJsonReason(nonJson)
    : `${k} not reported by the result record`;
  const reasons: Record<string, string> = {};
  for (const k of incompleteTelemetry(DECLARED, telemetry)) if (k !== "per_model" || telemetry.per_model.length === 0) reasons[k] = why(k);
  for (const m of telemetry.per_model) {
    if (m.requests === null) {
      reasons[`per_model[${m.model}].requests`] = !captureComplete
        ? (result ? nonJsonReason(nonJson) : noResult)
        : `${built.unidentified} assistant record(s) without a message id or model`;
    }
  }
```

(`telemetry.per_model[].model` is the catalog slug; use the api model id for the reason key when the slug is unknown: the key uses whatever `per_model[].model` holds, and the test uses the probe's value; if the pricing book maps it to `anthropic/claude-sonnet-5`, write the test key as that slug.) Put `capabilities: CLAUDE_CAPABILITIES, trace_complete: traceComplete, incomplete_reasons: reasons` into `raw_usage`.

- [ ] **Step 4: Run to verify pass:** `claude-code.test.ts`, `adapter.test.ts`, `claude-trace.test.ts`.
- [ ] **Step 5: Commit** `feat(harness): metrics contract with per-measurement completeness and run capabilities (M2-05)`.

**Acceptance:** tests pass; no schema file changed.

---

### Task M2-06: trace metrics and report header coverage

Spec 1a section 5 (rule-classified and unclassified per arm), `accept-M0-07` (per-harness coverage; category totals never rank harnesses), section 9 header. Review items 2 and 5: capabilities from the run; `null` for undeclared types; stale classifications replayed only from a complete command; trace-classified compile calls are calls, not backend builds; an invalid trace warns and never breaks the primary report.

**Lane:** content. **Deps:** M2-05, M1-22 (published `trace_path`; `report.ts` coverage line). **Date:** 10-02 (rebased on M1-22, integrated 10-03).

**Files:** Create `src/harness/trace-metrics.ts`; Modify `src/harness/report.ts`, `cli/commands/harness-command.ts` (report path); Test `tests/unit/harness/trace-metrics.test.ts`, append `tests/unit/harness/report.test.ts`.

**Interfaces:**
- `interface TraceMetrics { complete; tool_calls; tool_errors; errors_by_class; by_transport; by_agent; categories: Record<Category, number>; rule_classified; unclassified; unreplayable: number; compile_calls: { via_backend_route: number; in_container: number }; model_requests: number | null; subagents: number | null; skill_invocations: Record<string, number> | null; mcp_calls: Record<string, number>; compactions: number | null; retries: number | null; rules: string }`
- `traceMetrics(events, run: { complete: boolean; trace_types: readonly string[] }): TraceMetrics`
- `interface LoadedTrace { events: TraceEvent[]; complete: boolean; trace_types: string[] }`; `loadTraces(root, executions): Promise<{ traces: Map<string, LoadedTrace | null>; invalid: { execution: string; error: string }[] }>` (never throws for a missing or malformed trace).
- `ArmCoverage.trace: { executions; with_trace; complete; invalid; tool_calls; rule_classified; unclassified; unreplayable; rules } | null`; `ReportOptions.traces?`.

- [ ] **Step 1: Failing tests** (`trace-metrics.test.ts`)

```typescript
Deno.test("traceMetrics: probe counts; undeclared types are null, not zero", async () => {
  const t = claudeTrace(lines(await Deno.readTextFile(FIXTURE)), FIXTURE, new Set());
  const m = traceMetrics(t.events, { complete: true, trace_types: ["tool_call", "model_request", "subagent_spawn", "skill_invoke"] });
  assertEquals([m.tool_calls, m.tool_errors, m.model_requests, m.subagents], [7, 1, 4, 1]);
  assertEquals([m.compactions, m.retries], [null, null]);
  assertEquals([m.skill_invocations, m.mcp_calls, m.by_agent], [{ "fleet-notes": 1 }, { "al-tools": 1 }, { main: 6, "general-purpose": 1 }]);
  assertEquals([m.rule_classified, m.unclassified, m.rules], [7, 0, "rules@1"]);
  assertEquals(m.compile_calls, { via_backend_route: 1, in_container: 0 });
  assertEquals(m.errors_by_class, { unclassified_error: 1 });
});

Deno.test("traceMetrics: stale classifier is replayed from a complete command, never from a dropped one", () => {
  const e = { /* a v2 tool_call for Bash with command "cg-al compile Core", category "other", classifier "shell.x@0", command_cut false */ };
  // replayed: compile. Same with command null and command_cut true: counted unclassified and unreplayable 1.
});
```

Write that second test with two full v2 literals (all fields, as in `BASE` of M2-03) and assert `categories.compile === 1` for the first, `unclassified === 1 && unreplayable === 1` for the second.

Append to `report.test.ts`:
- `report coverage: trace lines per arm; partial and invalid traces counted, not mixed` (arm A: two complete traces with 3 and 2 tool calls, one unclassified; arm B: one complete trace with 2 calls, one partial with 9, one invalid (`loadTraces` given a file with `{"v":7}`), one without a trace). Expected A `{ executions: 2, with_trace: 2, complete: 2, invalid: 0, tool_calls: 5, rule_classified: 4, unclassified: 1, unreplayable: 0 }`; B `{ executions: 4, with_trace: 2, complete: 1, invalid: 1, tool_calls: 2, ... }`; `renderReport` shows `calls rule-classified 4/5, unclassified 1 (rules@1); traces complete 2/2` and for B `traces complete 1/4, 1 invalid, 1 without a trace`.
- `report: an invalid trace never breaks the primary metric` (same primary numbers with and without the `traces` option).
- `report coverage: no traces option gives trace null`.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/harness/trace-metrics.ts`

```typescript
/** Per-execution metrics from a trace, read with the run's own capabilities (spec 1a sections 5 and 9). */

import { join } from "@std/path";
import type { ExecutionRecord } from "./records.ts";
import type { TraceEvent } from "./trace.ts";
import { type Category, CATEGORIES, classify, RULES_VERSION } from "./classify.ts";
import { readTrace } from "./trace.ts";

export interface TraceMetrics { /* as in Interfaces */ }
export interface LoadedTrace {
  events: TraceEvent[];
  complete: boolean;
  trace_types: string[];
}

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export function traceMetrics(events: TraceEvent[], run: { complete: boolean; trace_types: readonly string[] }): TraceMetrics {
  const has = (t: string) => run.trace_types.includes(t);
  const m: TraceMetrics = {
    complete: run.complete, tool_calls: 0, tool_errors: 0, errors_by_class: {}, by_transport: {}, by_agent: {},
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
    rule_classified: 0, unclassified: 0, unreplayable: 0, compile_calls: { via_backend_route: 0, in_container: 0 },
    model_requests: has("model_request") ? 0 : null, subagents: has("subagent_spawn") ? 0 : null,
    skill_invocations: has("skill_invoke") ? {} : null, mcp_calls: {},
    compactions: has("compaction") ? 0 : null, retries: has("retry") ? 0 : null, rules: `rules@${RULES_VERSION}`,
  };
  for (const e of events) {
    if (e.type === "model_request" && m.model_requests !== null) m.model_requests++;
    else if (e.type === "subagent_spawn" && m.subagents !== null) m.subagents++;
    else if (e.type === "skill_invoke" && m.skill_invocations !== null) bump(m.skill_invocations, e.skill ?? "(unnamed)");
    else if (e.type === "compaction" && m.compactions !== null) m.compactions++;
    else if (e.type === "retry" && m.retries !== null) m.retries++;
    if (e.type !== "tool_call") continue;
    m.tool_calls++;
    if (e.outcome !== null && e.outcome !== "ok") {
      m.tool_errors++;
      bump(m.errors_by_class, e.error_class ?? "unclassified_error");
    }
    bump(m.by_transport, e.transport ?? "unknown");
    bump(m.by_agent, e.agent);
    if (e.transport?.startsWith("mcp:")) bump(m.mcp_calls, e.transport.slice(4));
    const current = e.category !== null && e.classifier !== null && e.classifier.endsWith(`@${RULES_VERSION}`);
    let c: { category: Category; classifier: string };
    if (current) c = { category: e.category!, classifier: e.classifier! };
    else if (e.command_cut === true) {
      m.unreplayable++;
      c = { category: "unclassified", classifier: `none@${RULES_VERSION}` };
    } else c = classify({ tool: e.tool ?? "", command: e.command, target: e.target });
    m.categories[c.category]++;
    if (c.category === "unclassified") m.unclassified++;
    else m.rule_classified++;
    if (c.category === "compile") {
      if (c.classifier.startsWith("shell.toolchain.")) m.compile_calls.in_container++;
      else m.compile_calls.via_backend_route++; // calls, not backend builds (host log counts builds)
    }
  }
  return m;
}

export async function loadTraces(root: string, executions: ExecutionRecord[]) {
  const traces = new Map<string, LoadedTrace | null>();
  const invalid: { execution: string; error: string }[] = [];
  for (const e of executions) {
    if (e.trace_path === null) {
      traces.set(e.id, null);
      continue;
    }
    const raw = e.telemetry.raw_usage as { trace_complete?: unknown; capabilities?: { trace_types?: unknown } } | null;
    try {
      traces.set(e.id, {
        events: await readTrace(join(root, e.trace_path)),
        complete: raw?.trace_complete === true,
        trace_types: Array.isArray(raw?.capabilities?.trace_types) ? raw.capabilities.trace_types.map(String) : ["tool_call"],
      });
    } catch (err) {
      traces.set(e.id, null);
      if (!(err instanceof Deno.errors.NotFound)) invalid.push({ execution: e.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { traces, invalid };
}
```

`report.ts`: `ReportOptions.traces?: { traces: Map<string, LoadedTrace | null>; invalid: { execution: string }[] }`; per arm sum as in the tests, using `traceMetrics` on complete traces only; render the line; a `[WARN]` line per invalid trace. `harness-command.ts` report path passes `traces: await loadTraces(opts.resultsDir, executions)`. Records written before M2-05 have no `trace_complete` and read as incomplete (honest).

- [ ] **Step 4: Run to verify pass;** **Step 5: Commit** `feat(harness): trace metrics and per-arm classification coverage in the report header (M2-06)`.

**Acceptance:** tests pass; `harness report --json` shows `coverage[].trace`.

---

### Task M2-07: skill content for the skill arms

Spec 1a section 4 (skills bundle as a component; a nudge in `instructions` is its own component). Owner decision (orchestrator): lane `content` authors the skill content by 10-07. Content tests AL knowledge a BC developer's skill would carry for the refapp tasks (object ID and dependency setup, event subscriber patterns, test codeunit setup, `cg-al` usage), never task answers: no oracle, mutant or reference-solution text, no HX task identifiers.

**Lane:** content. **Deps:** M4 task set frozen content (read-only). **Date:** 10-03 to 10-04 (delivered 10-04, before O-1).

**Files:** Create `harness/bundles/al-skills/skills/<name>/SKILL.md` (3 to 5 skills, each with YAML front matter `name` and `description`), `tests/unit/harness/skills-bundle.test.ts`.

- [ ] **Step 1: Failing test** `skills-bundle.test.ts`: every `SKILL.md` has front matter with `name` equal to its folder and a non-empty `description`; no file contains `HX-0`, `oracle`, `mutant`, `reference`, any five-digit id in 85000-89999, or an em dash; the bundle loads through `resolveManifest` as a `skills` component (hash stable across two resolves).
- [ ] **Step 2: Author the skills;** **Step 3: Run the test;** **Step 4: Commit** `feat(harness): AL skills bundle for the skill arms (M2-07)`.

**Acceptance:** test passes; orchestrator review of the text (task-answer leakage) in O-1.

---

### Task M2-08: stub-provider cells through the real pipeline

Review items 4 and 6: qualification and fixture recording must exercise the real execution path (staging, grant, backend, sandbox via `runSandbox`, bounded lifecycle, image by immutable id, redaction and publication, records) without a credential. `harness cell ... --stub-provider <scenario.json>`:

- requires `--results-root` under `results/harness/stub-cells/` (refused elsewhere) and never judges (no verdict, no BC publish; a backend compile may run);
- releases no credential: the arm's credential files are replaced by a 40-char dummy in the secrets dir, and no ledger reservation is made; `env.supervised` and `egressEnforced` are not consulted;
- mounts a directory with `stub-anthropic.mjs` and the scenario at `C:\cg-stub` read-only (extra mount), sets `ANTHROPIC_BASE_URL=http://127.0.0.1:3400` (non-secret env), and overrides the command: `powershell -NoProfile -Command "Start-Process -NoNewWindow 'C:\Program Files\nodejs\node.exe' -ArgumentList 'C:\cg-stub\stub-anthropic.mjs','C:\cg-stub\scenario.json',(Join-Path $env:TEMP 'cg-stub.jsonl'),'3400'; Start-Sleep -Seconds 1; & C:\run.ps1; $rc = $LASTEXITCODE; Get-Content (Join-Path $env:TEMP 'cg-stub.jsonl') | ForEach-Object { [Console]::Error.WriteLine('CG_STUB ' + $_) }; exit $rc"`;
- accepts `--image <sha256 id>` (only with `--stub-provider`) to run a different image of the same harness (drift drill); the manifest records that id;
- writes `stub_provider: { scenario_sha256 }` into the run's side file; stub cells are planned attempts under their own campaign id in the stub results root, so no campaign can reuse them.

**Lane:** content. **Deps:** M1-22, M1-24, M2-04. **Date:** 10-05 (integrated 10-06).

**Files:** Modify `src/harness/execution.ts` (`HarnessEnv.stubProvider?: { dir: string; imageOverride?: string }`), `cli/commands/harness-command.ts` (`cell` flags); Test append `tests/unit/harness/execution.test.ts`, `tests/unit/harness/cli-cell.test.ts` (or the file M1-24 uses for `cell`).

- [ ] **Step 1: Failing tests** (using M1-22's `makeEnv` and `FakeDocker`):
  - `stub provider: no ledger reservation, dummy credential, stub mount and env, command override, no judgment` (the recorded `docker run` args contain the `C:\cg-stub` read-only mount, `ANTHROPIC_BASE_URL=http://127.0.0.1:3400`, the command override; the ledger file is untouched; the secrets dir's `claude-oauth-token` is the dummy; no judgment record exists; the execution is published under the stub results root).
  - `stub provider: refused outside results/harness/stub-cells` and `--image refused without --stub-provider`.
  - `stub provider: --image runs that id and the manifest records it`.
- [ ] **Step 2: Run to verify failure;** **Step 3: Implement** (in `runExecution`: branch on `env.stubProvider` at the credential gate, secrets preparation, sandbox spec and judging; nothing else changes); **Step 4: Run to verify pass;** **Step 5: Commit** `feat(harness): stub-provider cells for credential-free fixtures and arm qualification (M2-08)`.

**Acceptance:** tests pass; `deno task start harness cell --help` lists `--stub-provider` and `--image`.

---

### Task M2-09: fail-closed MCP inventory

Spec 1a section 4 (a requested component that did not load fails setup; no silently different arm). Review item 3. M3-03 provides the al-tools server, its tool file `harness/images/base/al-tools-tools.json`, the image label `centralgauge.mcp.al-tools = "<version> <sha256>"`, `ImageFacts.mcp`, `runtimeFacts` filling `servers`, `nativeSettings` adding `mcp: [names]`, and `run.ps1` writing `mcp.json`. M2-09 adds, on top of M3-03:

1. **Expected inventory persisted before release.** `runtimeFacts` verifies, for every requested server, that the repo definition file's hash equals the image label's hash (else `ConfigurationError` "definition <file> differs from image <id>: rebuild", refused before launch = **definition drift**), then writes `native_settings.mcp_tools = { <name>: [sorted tool names] }`. The manifest (with `settings.native`) is stored in the intent before any credential or sandbox (M1-22), so recovery reads it and never current files.
2. **Fail-closed check in the adapter.** For each requested server: loaded only if `system/init.mcp_servers` shows it `connected` **and** the `mcp__<name>__*` names in `system/init.tools` equal `settings.native.mcp_tools[<name>]`. No expected list: not loaded, problem `no expected tool inventory for mcp:<name>`. A connected server that was not requested: termination `setup_failed`, problem `unexpected MCP server <name>`. Missing or extra tools: not loaded (**runtime drift**), problem naming both lists. Not loaded means `observedMismatch` gives `setup_failed` (M1-22).
3. **ToolSearch deferral.** `system/init.tools` lists deferred MCP tools (probe fixture line 1 lists all five `mcp__al-tools__*` tools while the run later calls `ToolSearch` to load one): the check compares the available inventory, not tools selected through ToolSearch. Pinned by a test on the probe.
4. **Strict config on every arm.** `run.ps1` passes `--mcp-config <file> --strict-mcp-config` on every arm, with `{"mcpServers": {}}` when the arm has no MCP (M3-03's `run.ps1` is changed accordingly in this task if M3-03 wrote it only for MCP arms).

**Lane:** content. **Deps:** M3-03 (merged 10-06), M2-03. **Date:** 10-06.

**Files:** Modify `src/harness/images.ts` (`runtimeFacts`), `src/harness/adapters/claude-code.ts`, `harness/images/claude-code/run.ps1`; Test append `tests/unit/harness/images.test.ts`, `tests/unit/harness/claude-code.test.ts`.

- [ ] **Step 1: Failing tests** (`claude-code.test.ts`; `al` = `{ name: "al-tools", version: "v", tool_schema_hash: "h" }`; the probe's `init` lists `al_compile, al_container_status, al_test, al_verify, al_verify_task`):

```typescript
const PROBE_TOOLS = ["al_compile", "al_container_status", "al_test", "al_verify", "al_verify_task"];
const mcpManifest = (tools?: string[]) => ({ mcp: [al], settings: { requested: {}, native: tools ? { mcp: ["al-tools"], mcp_tools: { "al-tools": tools } } : { mcp: ["al-tools"] } } });

Deno.test("mcp inventory: exact match loads, even though the run loaded tools through ToolSearch", async () => {
  const { r } = await parse(await Deno.readTextFile(FIXTURE), 0, mcpManifest(PROBE_TOOLS));
  assert(r.observed.loaded_components!.includes("mcp:al-tools"));
});

Deno.test("mcp inventory: no expected list, missing tool, extra tool: never loaded, reason named", async () => {
  for (const [tools, why] of [[undefined, "no expected tool inventory"], [PROBE_TOOLS.slice(1), "tools differ"], [[...PROBE_TOOLS, "al_x"], "tools differ"]] as const) {
    const { r } = await parse(await Deno.readTextFile(FIXTURE), 0, mcpManifest(tools as string[] | undefined));
    assert(!r.observed.loaded_components!.includes("mcp:al-tools"));
    assertStringIncludes(JSON.stringify(r.telemetry.raw_usage), why);
  }
});

Deno.test("mcp inventory: a disconnected server is not loaded; an unexpected server fails setup", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const down = text.replace('"status":"connected"', '"status":"failed"');
  assert(!(await parse(down, 0, mcpManifest(PROBE_TOOLS))).r.observed.loaded_components!.includes("mcp:al-tools"));
  const { r } = await parse(text); // manifest requests no MCP, the stream shows al-tools connected
  assertEquals(r.termination, "setup_failed");
  assertStringIncludes(JSON.stringify(r.telemetry.raw_usage), "unexpected MCP server al-tools");
});

Deno.test("mcp inventory: recovery reads the persisted manifest, not the current definition file", async () => {
  // Parse with mcpManifest(PROBE_TOOLS) after overwriting a temp copy of al-tools-tools.json with other tools:
  // the adapter never reads that file, so the result equals the first test's.
});

Deno.test("run.ps1: strict MCP config on every arm, empty servers when none; token only in the config file", async () => {
  const ps = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  assertStringIncludes(ps, "'--strict-mcp-config'");
  assertStringIncludes(ps, "mcpServers");
  assert(!/claudeArgs[^\n]*backend-token/.test(ps));
});
```

(`parse(text, exitCode, over)` passes `over` into `manifest("cc", over)`; the existing helper already does.) Append to `images.test.ts`: `runtimeFacts: expected MCP tool names persisted in native settings; definition drift refused before launch` (image label hash from `mcpLabel(".")` gives `native_settings.mcp_tools["al-tools"]` equal to the sorted names in `al-tools-tools.json`; an image label with another hash throws `ConfigurationError` "differs from image").

- [ ] **Step 2: Run to verify failure;** **Step 3: Implement** the four points; **Step 4: Run to verify pass;** **Step 5: Commit** `feat(harness): fail-closed MCP inventory from persisted facts, strict MCP on every arm (M2-09)`.

**Acceptance:** tests pass; a plain arm's manifest has no `mcp` or `mcp_tools` key (its hash is unchanged by M2-09).

---

### Task M2-10: publication-path redaction through execution and recovery

Review item 4: publication and crash/recovery with a pattern secret **not** in custody; record and error strings. Uses M1-22's `runtime-fixture.ts` (`makeEnv`, `ccBehavior`, `probeLines`, crash hooks).

**Lane:** content. **Deps:** M2-02 (integrated), M1-22. **Date:** 10-06.

**Files:** Test append `tests/unit/harness/execution.test.ts` (no production change expected; if a test fails, the fix goes where the unredacted surface is published).

- [ ] **Step 1: Tests:**
  - `publication redacts a non-custody pattern secret in raw log, stderr, trace command and side file` (the fake sandbox writes `probeLines()` plus a Bash tool_use whose command and result carry `sk-ant-oat01-<40 x Q>`, and a UTF-16LE stderr line with the same key; after `runCell`, `grep` of the key over the stub results root is empty and each surface holds `[REDACTED:anthropic-key]`).
  - `recovery publishes a crashed attempt with a non-custody pattern secret redacted` (crash via `hooks.after("draft")`, then `recoverInterrupted`; same assertion).
  - `record and error strings are pattern-redacted` (a backend fault whose message carries a `Bearer <30 chars>` header; the execution record's side-file reason shows `[REDACTED:bearer]` or `[REDACTED:backend-token]`, never the value).
- [ ] **Step 2: Run;** they pass once M2-02 is integrated; any failure is a defect to fix in the publication step, not in the test. **Step 3: Commit** `test(harness): publication and recovery redaction for non-custody secrets (M2-10)`.

**Acceptance:** tests pass.

---

### Task M2-11 (ops): record retry, fatal and compaction fixtures

Findings section 4 and `accept-M0-04` (missing retry, compaction and fatal fixtures). Through `harness cell --stub-provider` (M2-08): bounded lifecycle, image by immutable id, no credential, no ledger slot, no BC container (the scenarios never call `cg-al`).

**Lane:** ops. **Deps:** M2-08 (integrated), M1-28 (image). **Date:** 10-06.

- [ ] **Step 1:** for `retry`, `fatal`, `compaction`: `DOCKER_CONTEXT=desktop-windows deno task start harness cell cc-sonnet-plain HX-001 --rev refapp-v1-rc1 --stub-provider scripts/harness/stub-scenarios/<s>.json --results-root results/harness/stub-cells/M2-11`. If `compaction` shows no `system/compact_boundary`, repeat once with the scenario's `usage.input_tokens` at 199000; if still absent, record "not reproducible with the stub" and commit no compaction fixture.
- [ ] **Step 2:** from each published raw log (already redacted): distinct `[type, subtype]` pairs; the verbatim retry and compaction records (or "not emitted"); the `CG_STUB` request log from stderr (count and statuses); the dummy token has 0 hits; `docker ps -a` for the owner label is empty.
- [ ] **Step 3:** copy the three raw logs to `tests/fixtures/harness/claude-code/{retry,fatal,compaction}.jsonl`; commit `test(harness): recorded Claude Code 2.1.282 retry, fatal and compaction fixtures (M2-11)`.

**Acceptance (evidence file):** per scenario the stub request count and statuses, the exit code, the distinct record types, the verbatim retry and compaction records or "not emitted", 0 dummy-token hits, empty `docker ps`, the fixture commit SHA.

---

### Task M2-12: retry and compaction from recorded shapes

Parses and declares exactly what M2-11 recorded. Review item 2: counts pinned to the recording, not to the number of stub failures.

**Lane:** content. **Deps:** M2-11 evidence. **Date:** 10-07 (integrated 10-07).

**Files:** Modify `src/harness/adapters/claude-trace.ts`, `src/harness/adapters/claude-code.ts` (`DECLARED`, `CLAUDE_CAPABILITIES`); Test append `claude-trace.test.ts`, `claude-code.test.ts`.

- [ ] **Step 1: Failing tests** built from the recorded files: for each record type M2-11 quoted (for example `system/compact_boundary`, and the retry record's exact `type`/`subtype`), `claudeTrace` emits one `compaction` or `retry` event per recorded record, with the count equal to the number of those records in the fixture (computed in the test with `jq`-equivalent filtering, then asserted as a literal copied from the evidence). `fatal.jsonl`: termination and `didWork` as recorded (quote them in the test comment with the evidence path); cost null with reason `no model usage reported` if the recorded `modelUsage` is empty (review answer 4: keep null). If a shape was "not emitted", the test asserts the type is absent from `CLAUDE_CAPABILITIES.trace_types` (and `compactions` absent from `DECLARED`) so the report renders n/a.
- [ ] **Step 2: Implement** the recorded shapes in `claudeTrace` (constants named after the recorded subtypes), `compactions` telemetry when declared (`captureComplete ? count : null`), bump `parser` to `claude-code-trace@3`.
- [ ] **Step 3: Run; Step 4: Commit** `feat(harness): retry and compaction parsed and declared from recorded fixtures (M2-12)` (message cites the M2-11 evidence and states what is declared).

**Acceptance:** tests pass; capabilities in new runs say what is declared.

---

### O-1 (orchestrator): arm configs and `vary` audit

**Date:** 10-06. Configs under `harness/configs/`: the Claude Code baseline (plain), the skill arm (`components.skills: bundles/al-skills/skills`), the MCP arm (`components.mcp: [al-tools]`), each with the same models and settings; experiment files with `vary: [skills]` and `vary: [mcp]`. `harness validate` on both experiments; the resolved manifests differ only in the varied component (and, for the MCP arm, `settings.native.mcp` and `mcp_tools`, which follow from the component: the orchestrator records that ruling in the audit decision). Review of M2-07 text for task-answer leakage. Decision file `H:\cg-coord\decisions\<date>-arm-configs.md`.

---

### Task M2-13 (ops): real campaign-arm qualification

Spec 1a section 11 (per real harness: smoke end to end; correlation ids line up with the host log). Review item 6: the real arms (O-1 configs, M2-07 skills, M3-03 al-tools, the final rebuilt image), through the real pipeline and publication, with runtime drift proven separately from definition drift. No credential; compiles run through the backend on Cronus281 (no publish, no test run).

**Lane:** ops. **Deps:** O-1, M2-07, M2-08, M2-09, M2-10, M3-03, M3-07 (al-tools round trip), image rebuild at the integrated commit. **Date:** 10-07 afternoon (run 1, Cronus281); 10-08 late afternoon rerun slot (Cronus281, after M1-30; the in-container stub needs no firewall change); accepted by the orchestrator 10-09.

- [ ] **Step 1: Final image.** `harness images build base`, then `harness images build claude-code --version 2.1.282`; quote both ids and the `centralgauge.mcp.al-tools` label. This image id is the one frozen on 10-09.
- [ ] **Step 2: Skill arm.** `harness cell <skill-arm config> HX-001 --rev <frozen rev> --stub-provider scripts/harness/stub-scenarios/arm-skill.json --results-root results/harness/stub-cells/M2-13 --containers Cronus281`. Quote from the published records: `observed.loaded_components` includes `skills`; one `skill_invoke` naming the scenario's skill; `raw_usage.capabilities` and `trace_complete: true`; the canary `sk-ant-oat01-CANARY...` appears nowhere under the results root (grep count 0) and `[REDACTED:anthropic-key]` appears in the raw log and the trace command.
- [ ] **Step 3: MCP arm.** Same with the MCP arm config and `arm-mcp.json`. Quote: `loaded_components` includes `mcp:al-tools`; `init.tools` lists exactly the three al-tools tools; `al_compile` and `al_symbols` tool calls with `transport: "mcp:al-tools"`, categories `compile` and `symbols`, and `backend_request` values equal to the host log's request ids for those operations; the Glob call's agent is `general-purpose` with the Agent call as parent; `ToolSearch` is `other`; the backend-token value has 0 hits under the results root and `[REDACTED:backend-token]` appears where the `type` command printed it.
- [ ] **Step 4: Baseline arm.** Same with the plain config and `drift.json`: `loaded_components` has no `mcp:*`; the run is not `setup_failed` (strict empty MCP config).
- [ ] **Step 5: Runtime drift drill.** Build a throwaway image `centralgauge/harness-claude-code:drift` `FROM` the final image with a `C:\al-tools-tools.json` that adds one tool (labels inherited, so the persisted expectation stays the original); run the MCP arm with `--image <drift id>` and `drift.json`. Expected: termination `setup_failed`, problem `mcp:al-tools tools differ`. Remove the drift image afterwards.
- [ ] **Step 6: Definition drift.** In a scratch worktree, edit `harness/images/base/al-tools-tools.json` (description only) without rebuilding, run `harness validate` or the cell: refused before launch with "differs from image". Quote. Discard the worktree.
- [ ] **Step 7: Cleanup.** `docker ps -a` for the owner label empty; lease released; private state for the stub executions gone.

**Acceptance (evidence file, orchestrator on 10-09):** every quoted item above; the final image id and label; the three arm manifest hashes and the `vary` audit reference; the drift outcomes. On acceptance the orchestrator freezes the arm configs and the image id for the 10-10 campaigns.

---

## Self-review

- **Spec coverage.** Section 5 telemetry (turns, compactions, per-model usage and requests), trace fields and types, error classes from evidence, shell commands with redaction, correlation ids (M2-03, M2-13), categorization with versioned classifier and replay (M2-01, M2-06), metrics contract with reasons and provenance (M2-05, M2-12). Section 4 MCP facts and loaded checks (M3-03, M2-09). Section 9 header (M2-06); efficiency cut. Section 11: fixtures for tool call, error, skill, MCP, sub-agent (probe), retry, compaction, fatal (M2-11), hard kill (M2-05), redaction (M2-02, M2-10), smoke with correlation (M2-13). All `accept-M0-04` and `accept-M0-07` carryovers are tests in M2-01, M2-02, M2-11, M2-12; pi's share is the handoff contract.
- **Placeholders.** Tasks on files that M1-22/M1-24/M3-03 create name the function, the behavior and the tests; their shapes come from those plans.
- **Types.** `Classification` (M2-01) feeds `callFields` (M2-03) and `traceMetrics` (M2-06); `ClaudeTrace.structural`/`unidentified` feed M2-05; `CLAUDE_CAPABILITIES` feeds `loadTraces`; `ImageFacts.mcp` (M3-03) feeds M2-09; `HarnessEnv.stubProvider` (M2-08) feeds M2-11 and M2-13.

## Owner questions

None. Scope and gate dates are unchanged; the cuts used (cut item 3: M1-25, former M2-10; cut item 2: M3-06, M3-08) are in the launch contract's orchestrator-applied cut order.
