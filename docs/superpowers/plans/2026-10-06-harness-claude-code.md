# Harness Bench M2: Claude Code trace, metrics and arms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish M2 on top of the accepted M1-32 adapter: a full Claude Code trace parser (tool calls, sub-agents, skills, MCP, retries, compactions), the metrics contract, deterministic versioned call categorization with an honest `unclassified` residue, and the MCP and skill arm plumbing the 10-10 to 10-13 campaigns need.

**Architecture:** Pure modules first (`classify.ts`, `redact-patterns.ts`, `adapters/claude-trace.ts`, `trace-metrics.ts`, `mcp.ts`), each unit-tested without Docker or BC. Then small, reviewable edits to the gate-path files (`trace.ts`, `adapters/claude-code.ts`, `sandbox.ts`, `images.ts`, `execution.ts`, `backend.ts`, `run.ps1`), merged only after the 10-05 gate is accepted. Record shapes (execution, telemetry) do not change: new per-run facts go into the trace (schema v2) and into `telemetry.raw_usage`, which is free JSON. Retry and compaction record shapes are recorded from the pinned Claude Code against a scripted local stub of the Messages API, so no credential is spent and no guessed shape is ever declared.

**Tech Stack:** Deno + TypeScript, Zod 4, `@std/path`, `@std/assert`, Cliffy (`cli/commands/harness-command.ts`); Claude Code 2.1.282 in `centralgauge/harness-claude-code:2.1.282` (ops tasks only).

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (spec 1a) sections 4, 5 (Telemetry, Call categorization, Metrics contract), 9 (efficiency), 11 (trace parser and categorization fixtures), 12 item 2. Findings `docs/superpowers/specs/2026-09-29-harness-spikes-findings.md` sections 4, 7, 8. Roadmap row M2 in `docs/superpowers/plans/2026-09-24-harness-bench-spike.md`. M1 part 2 plan `docs/superpowers/plans/2026-09-30-harness-core-part2.md` (M1-19, M1-20, M1-22, M1-24, M1-25, M1-32). Decisions under `H:\cg-coord\decisions\` (all read): `accept-M0-04` (parser rules, missing retry/compaction/fatal fixtures, redactor beyond exact secrets), `accept-M0-07` (rule carryovers), `cut-laya`, `accept-M1-32` (non-JSON stdout: count, line numbers, byte lengths only; termination null + stream_problems maps to infra_exposed), `m1p2-round2` (TTL null policy, BcLane), `egress` (5 supervised credential runs before enforcement, campaigns gated on it), `secrets-accepted-risk`, `m1-metric-rules`, `reviewer-gpt6sol`, `reviews-on-copilot`.

## What M1-32 already delivers (not redone here)

On master in `src/harness/adapters/claude-code.ts`: stream reading with BOM/CRLF, non-JSON lines counted without content, refusal of contradictory records (second `result` or `init`, repeated tool id), cost from `result.modelUsage` (never summed chunks) with the TTL split, termination from the final `result` and `rate_limit_event`, observed version/models/skills/MCP from `system/init`, one `tool_call` trace event per `tool_use` (agent `main` or `subagent`, transport, outcome, result bytes), `run.ps1` with the token by file and env, `--max-budget-usd`. The 10-05 gate (M1-29) runs on exactly that code.

## Global Constraints

- Lanes: code is `infra` (stream A) or `infra2` (stream B) and never touches Docker or a BC container; anything that does is `ops` with an evidence file under `H:\cg-coord\tasks\<id>\runs\<nnn>\evidence.md`.
- **Gate safety (10-05).** M2-01, M2-04 add new files only and may merge any time. Every other code task touches a file on the 10-05 gate path (`src/harness/trace.ts`, `adapters/claude-code.ts`, `sandbox.ts`, `images.ts`, `execution.ts`, `backend.ts`, `harness/images/claude-code/run.ps1`) and is integrated only after the orchestrator accepts M1-29. A lane may write such a task earlier on its branch.
- Unit tests in `tests/unit/harness/`, run as `deno test --allow-all <file>`; never `--parallel`; never `tests/unit/container/` while a bench is live. Every acceptance command in this plan runs without containers.
- After each task: `deno check`, `deno lint`, `deno fmt` on that task's files only; never `deno fmt` under `site/`. Zod 4, `exactOptionalPropertyTypes`, CLAUDE.md import order, `[OK]`/`[FAIL]`/`[WARN]` tags, no emoji, no em dash anywhere (code, comments, fixtures written by us, commit messages).
- Record shapes are frozen: no change to `ExecutionRecordSchema`, `TelemetrySchema` or `ResolvedManifestSchema` in M2. New facts go to the trace (v2, versioned below) or `telemetry.raw_usage`.
- A telemetry field or trace event type is **declared** only after a recorded Claude Code 2.1.282 log shows its shape. Synthesized fixtures may test parsing but never justify a declaration.
- Categorization is rules only (Laya cut). A call no rule matches is `unclassified`, never a guess. Rules carry `RULES_VERSION`; every classification stores `<rule-id>@<version>`.
- Secrets: never in argv, never `docker run -e`; files under `C:\cg-secrets` only. Published logs and traces are redacted for exact custody secrets (M1-12/M1-20) and, from M2-02, for token patterns. The frozen workspace is never pattern-redacted (it is the verdict input).
- MCP arms are Claude Code only (pi 0.87.1 has no native MCP, findings section 4). LSP components stay refused.
- Model ids are never hardcoded in code; configs name catalog slugs. Stub scenarios echo whatever `model` the request names.
- Ops tasks in M2 use no provider credential and no BC container (M2-05, M2-11): they count against neither the 5-run supervised budget nor BC leases.
- Report sections beyond the primary metric and outcome are launch-contract cut item 3: M2-10 is **cuttable**. M2-09 adds only header coverage lines (section 1) and is not cut.
- After the last code task: `graphify update .`.

## Review Focus

1. **A token-shaped secret that is not in custody** (the agent echoes an `sk-ant-oat01-...` it found, or a `Bearer ...` header from its MCP config) lands in a shell command or tool result. Expected: the published raw log and trace show `[REDACTED:<pattern>]`; the frozen workspace stays byte-identical. Pinned in M2-02 (`publishRedacted redacts token patterns in logs`, `the workspace freeze is not pattern-redacted`).
2. **A hard-killed or damaged stream** (no `result`, a truncated last line, a non-JSON line). Expected: `raw_usage.trace_complete` false, `compactions` and per-model `requests` null (never 0), the report counts the execution as trace-partial. Pinned in M2-08 (`a killed stream leaves compactions and requests null, trace incomplete`) and M2-09 (`partial traces are counted, not mixed into complete ones`).
3. **Sub-agent records** whose `parent_tool_use_id` has no earlier `Agent` call, or sub-agent tool calls interleaved with the main agent's. Expected: calls attributed to the spawning `subagent_type` (or `subagent` with one problem line), never double counted, never a crash. Pinned in M2-03 (`orphan sub-agent records are attributed once with a problem`).
4. **An MCP server that connects with a different tool set**, or ambient MCP configuration (a `.mcp.json` the agent writes into the workspace). Expected: the component is not confirmed loaded, so the execution is `setup_failed` rather than a silently different arm; ambient config is ignored by `--strict-mcp-config` on every arm. Pinned in M2-06 (`run.ps1 always passes --strict-mcp-config`) and M2-07 (`an MCP server with a different tool set is not loaded`).
5. **Wrapped and compound shell commands** (`powershell -Command "cg-al compile Core"`, `cmd /c`, `& 'C:\cg-al.ps1' test`, `echo x > a.al`, `ls; python x.py`). Expected: a deterministic category or `unclassified`, never a guess, and the same answer for the same rules version. Pinned in M2-01 (`command shapes`, `any unknown segment makes the call unclassified`).

---

## Schedule

| Task | Lane | Deps | Date | What |
| --- | --- | --- | --- | --- |
| M2-01 | infra2 | M1-21 (accepted) | 10-03 | `classify.ts`: rules v1, M0-07 carryovers, 45-call labelled fixture |
| M2-02 | infra2 | M1-12, M1-20 (accepted) | 10-03 (integrate after M1-29) | token-pattern redaction, wired into `publishRedacted` and `redactText` |
| M2-03 | infra2 | M2-01, M1-32 | 10-04 (integrate after M1-29) | trace v2; `claude-trace.ts` builder (model requests, sub-agents, skills, MCP, denials, backend ids, error classes); adapter switched to it |
| M2-04 | infra2 | none | 10-05 | scripted Messages API stub + scenarios (retry, fatal, compaction, arm probe) |
| M2-05 | ops | M2-04, M1-28 (image built) | 10-06 | record retry, fatal and compaction fixtures from Claude Code 2.1.282 against the stub |
| M2-06 | infra | M1-22, M1-24, M1-29 accepted | 10-06 | MCP definitions, runtime facts, `C:\config\mcp.json`, `run.ps1` strict MCP config |
| M2-07 | infra | M2-06, M2-03, M1-19 | 10-07 | backend `/mcp/<name>` route per grant, stub-echo impl, observed tool-set check, arm probe script |
| M2-08 | infra2 | M2-03, M2-05 | 10-07 | metrics contract: compactions, per-model requests, trace completeness, incomplete reasons, declared trace types |
| M2-09 | infra2 | M2-08, M1-22 | 10-08 | `trace-metrics.ts`, trace loading, report header coverage per arm (classified / unclassified / partial) |
| M2-10 | infra2 | M2-09 | 10-09 | **cuttable (cut item 3):** report efficiency from traces |
| M2-11 | ops | M2-02, M2-05, M2-07, M2-08 | 10-09 | sandbox probe of an MCP + skill arm (stub API, backend, no credential, no BC) |

Priority when lanes are short (both lanes carry M1 work on 10-06 to 10-09): M2-06, M2-07, M2-11 (MCP arms for 10-10) before M2-08, M2-09, then M2-02 integration; M2-10 and M1-25 are cut first.

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/harness/classify.ts` | rules v1: builtin, MCP exact + token-aware, shell segments and wrappers | M2-01 |
| `tests/fixtures/harness/classify/m0-07-labeled.jsonl` | the 45 blind-labelled M0-07 calls | M2-01 |
| `src/harness/redact-patterns.ts` | token patterns over UTF-8 bytes and strings | M2-02 |
| `src/harness/sandbox.ts` (modify) | `publishRedacted`, `redactText` apply patterns after exact secrets | M2-02 |
| `src/harness/trace.ts` (modify) | schema v2 (`command`, `target`, `category`, `classifier`), `readTrace` accepting v1 | M2-03 |
| `src/harness/adapters/claude-trace.ts` | stream records to trace events (pure) | M2-03 |
| `src/harness/adapters/claude-code.ts` (modify) | uses `claudeTrace`; metrics contract (M2-08); MCP tool-set check (M2-07) | M2-03, M2-07, M2-08 |
| `src/harness/adapter.ts` (modify) | optional `traceTypes`, `nativeMcp`; optional `ParseInput.mcpTools` | M2-06, M2-07, M2-08 |
| `scripts/harness/stub-anthropic.ts`, `scripts/harness/stub-scenarios/*.json` | scripted Messages API | M2-04 |
| `tests/fixtures/harness/claude-code/{retry,fatal,compaction}.jsonl` | recorded fixtures | M2-05 |
| `src/harness/mcp.ts`, `harness/mcp/echo.json` | MCP definitions, facts, stub-echo impl, handlers | M2-06, M2-07 |
| `src/harness/images.ts`, `execution.ts`, `backend.ts`, `run.ps1` (modify) | MCP plumbing | M2-06, M2-07 |
| `scripts/harness/mcp-arm-probe.ts` | ops probe driver | M2-07 |
| `src/harness/trace-metrics.ts`, `src/harness/report.ts` (modify), `cli/commands/harness-command.ts` (modify) | trace metrics, header coverage, efficiency | M2-09, M2-10 |

---

### Task M2-01: rule-based call categorization, version 1

Spec 1a section 5 "Call categorization" (categories `compile, test, publish, symbols, read, search, edit, vcs, other, unclassified`; rules first; residue `unclassified`; `category` + `classifier` per event), section 11 (rule fixtures per category and per toolchain command shape). Carryovers `accept-M0-07`: `Skill`, `Agent`, `ToolSearch` handling; `cg-al` version and unknown ops as `other`; parenthesized and compound PowerShell; cross-harness skill semantics (Claude `Skill` tool vs pi `read` of `SKILL.md`: the category is the tool's own, skill use is a trace event type, never a category); exact or token-aware MCP tool-part mappings (`mcp__test-server__read_file` is not `test`).

**Lane:** infra2. **Deps:** none beyond master. **Date:** 10-03. New files only.

**Files:**
- Create: `src/harness/classify.ts`
- Create: `tests/fixtures/harness/classify/m0-07-labeled.jsonl`
- Test: `tests/unit/harness/classify.test.ts`

**Interfaces:**
- Produces: `CATEGORIES` (readonly tuple of the 10 names); `type Category`; `RULES_VERSION = 1`; `interface CallInput { tool: string; command: string | null; target: string | null }`; `interface Classification { category: Category; classifier: string }`; `classify(c: CallInput): Classification`. Classifier ids: `builtin.<Tool>@1`, `mcp-exact.<server>.<tool>@1`, `mcp-token.<token>@1`, `shell.cg-al.<op>@1`, `shell.cg-al.meta@1`, `shell.toolchain.al@1`, `shell.toolchain.alc@1`, `shell.git@1`, `shell.read@1`, `shell.search@1`, `shell.edit@1`, `shell.redirect@1`, `shell.env@1`, `none@1`. Backend compiles are the `shell.cg-al.*` and `mcp-*` ids; in-container compiles are `shell.toolchain.*` (used by M2-10).

- [ ] **Step 1: Build the labelled fixture from the accepted M0-07 evidence**

```bash
paste -d'\t' <(tail -n +2 /h/Temp3/harness-spike/M0-07/labels-blind.csv | cut -d, -f2) /h/Temp3/harness-spike/M0-07/calls.jsonl \
  | jq -Rc 'split("\t") as [$label, $call] | ($call | fromjson) as $c
      | {i: (input_line_number - 1), harness: ($c.file | split("\\") | last | split("/") | last | split("-") | first),
         tool: $c.tool, command: ($c.command // null), label: $label}' \
  > /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl
wc -l /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl   # expect 45
grep -c '"harness":"claude"' /u/Git/CentralGauge/tests/fixtures/harness/classify/m0-07-labeled.jsonl   # expect 27
```

Check the file holds no secret value (`grep -c` of both M0 secret values from `H:\Temp3\harness-spike\` secrets gives 0) and add `tests/fixtures/harness/classify/*.jsonl -text` to `.gitattributes` next to the existing harness fixture line.

- [ ] **Step 2: Write the failing tests**

`tests/unit/harness/classify.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import {
  CATEGORIES,
  classify,
  RULES_VERSION,
} from "../../../src/harness/classify.ts";

const c = (tool: string, command: string | null = null, target: string | null = null) =>
  classify({ tool, command, target });

Deno.test("classify: the 45 blind-labelled M0-07 calls all match their labels", async () => {
  const rows = (await Deno.readTextFile("tests/fixtures/harness/classify/m0-07-labeled.jsonl"))
    .trim().split("\n").map((l) => JSON.parse(l));
  assertEquals(rows.length, 45);
  const wrong = rows.map((r) => ({ r, got: c(r.tool, r.command).category }))
    .filter(({ r, got }) => got !== r.label)
    .map(({ r, got }) => `${r.i} ${r.tool} ${r.command ?? ""}: ${got}, label ${r.label}`);
  assertEquals(wrong, []);
});

Deno.test("classify: carryover rules from accept-M0-07", () => {
  const cases: [string, string | null, string][] = [
    ["Skill", null, "other"],
    ["Agent", null, "other"],
    ["Task", null, "other"],
    ["ToolSearch", null, "other"],
    ["Bash", "cg-al --version", "other"],
    ["Bash", "cg-al publish Core", "other"],
    ["PowerShell", "cg-al frobnicate", "other"],
    ["PowerShell", 'Set-Content -Path a.txt -Value "x"; Get-ChildItem', "edit"],
    ["PowerShell", '(Get-ChildItem -Path "C:\\workspace\\src" -Filter *.al -Recurse -File | Measure-Object).Count', "search"],
    ["bash", "set | grep PI_", "other"],
    ["mcp__al-tools__al_compile", null, "compile"],
    ["mcp__al-tools__al_test", null, "test"],
    ["mcp__al-tools__al_verify", null, "test"],
    ["mcp__al-tools__al_verify_task", null, "test"],
    ["mcp__al-tools__al_container_status", null, "other"],
    ["mcp__al-tools__al_new_thing", null, "unclassified"],
    ["mcp__test-server__read_file", null, "unclassified"],
    ["mcp__other__build_app", null, "compile"],
    ["mcp__other__run-tests", null, "test"],
    ["mcp__other__attest", null, "unclassified"],
  ];
  for (const [tool, cmd, want] of cases) assertEquals(c(tool, cmd).category, want, `${tool} ${cmd}`);
});

Deno.test("classify: command shapes (cg-al, toolchain, wrappers, redirects)", () => {
  const cases: [string, string, string][] = [
    ["Bash", "cg-al compile Core Rental", "compile"],
    ["Bash", "cg-al test 80000", "test"],
    ["Bash", "cg-al symbols", "symbols"],
    ["PowerShell", "& 'C:\\cg-al.ps1' compile Core", "compile"],
    ["PowerShell", "powershell -NoProfile -File C:\\cg-al.ps1 test 80001", "test"],
    ["PowerShell", "cg-al.cmd compile", "compile"],
    ["PowerShell", 'powershell -Command "cg-al compile Core"', "compile"],
    ["Bash", 'cmd /c "cg-al test"', "test"],
    ["Bash", "cd /c/workspace && cg-al compile Core", "compile"],
    ["Bash", "al compile /project:C:\\workspace\\Core /packagecachepath:C:\\workspace\\.alpackages", "compile"],
    ["PowerShell", "al.exe compile /project:Core", "compile"],
    ["Bash", "dotnet C:\\tools\\altool.dll compile /project:Core", "compile"],
    ["PowerShell", "& 'C:\\bc\\alc.exe' /project:Core /packagecachepath:.alpackages", "compile"],
    ["Bash", "git diff --stat", "vcs"],
    ["Bash", "echo hi > Core/src/A.al", "edit"],
    ["Bash", "ls 2>/dev/null", "search"],
    ["Bash", "cat a.al 2>&1 | head -5", "read"],
  ];
  for (const [tool, cmd, want] of cases) assertEquals(c(tool, cmd).category, want, cmd);
});

Deno.test("classify: any unknown segment makes the call unclassified; empty is unclassified", () => {
  for (const cmd of ["python make.py", "ls; python x.py", "echo hi", "", "al GetPackageManifest x.app"]) {
    assertEquals(c("Bash", cmd), { category: "unclassified", classifier: `none@${RULES_VERSION}` }, cmd);
  }
  assertEquals(c("Bash").category, "unclassified");
  assertEquals(c("WebFetch").category, "unclassified");
});

Deno.test("classify: builtins, pi tools and skill reads keep the tool's own category", () => {
  assertEquals(c("Read"), { category: "read", classifier: "builtin.Read@1" });
  assertEquals(c("Write").category, "edit");
  assertEquals(c("NotebookEdit").category, "edit");
  assertEquals(c("read", null, ".pi/skills/fleet-notes/SKILL.md").category, "read");
  assertEquals(c("Bash", "cg-al compile Core").classifier, "shell.cg-al.compile@1");
  assertEquals(c("mcp__al-tools__al_compile").classifier, "mcp-exact.al-tools.al_compile@1");
  assertEquals(c("mcp__x__build").classifier, "mcp-token.build@1");
  assertEquals(CATEGORIES.length, 10);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `deno test --allow-all tests/unit/harness/classify.test.ts`
Expected: FAIL, module `src/harness/classify.ts` not found.

- [ ] **Step 4: Implement**

`src/harness/classify.ts`:

```typescript
/**
 * Deterministic, versioned call categorization (spec 1a section 5, D14).
 * Rules only: Laya is cut (decision 2026-09-25-cut-laya). A call no rule
 * matches is `unclassified`, never a guess. Skill use is a trace event type
 * (skill_invoke), never a category: Claude's Skill tool is `other`, pi's read
 * of a SKILL.md is `read` (accept-M0-07 carryover).
 * Changing any rule bumps RULES_VERSION; stored classifiers carry it.
 */

export const CATEGORIES = [
  "compile",
  "test",
  "publish",
  "symbols",
  "read",
  "search",
  "edit",
  "vcs",
  "other",
  "unclassified",
] as const;
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

const at = (rule: string, category: Category): Classification => ({
  category,
  classifier: `${rule}@${RULES_VERSION}`,
});
const NONE = () => at("none", "unclassified");

const BUILTIN: Record<string, Category> = {
  Read: "read",
  Glob: "search",
  Grep: "search",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Skill: "other",
  Agent: "other",
  Task: "other",
  ToolSearch: "other",
  read: "read",
  grep: "search",
  find: "search",
  ls: "search",
  edit: "edit",
  write: "edit",
};
const SHELLS = new Set(["Bash", "bash", "PowerShell"]);

/** Exact tool-part mappings for known servers; an unknown tool of a known server is unclassified. */
const MCP_EXACT: Record<string, Record<string, Category>> = {
  "al-tools": {
    al_compile: "compile",
    al_test: "test",
    al_verify: "test",
    al_verify_task: "test",
    al_container_status: "other",
  },
};
/** Whole-token matches for unknown servers (`attest` is not `test`). */
const MCP_TOKENS: [string, Category][] = [
  ["compile", "compile"],
  ["build", "compile"],
  ["test", "test"],
  ["tests", "test"],
  ["publish", "publish"],
  ["deploy", "publish"],
  ["symbol", "symbols"],
  ["symbols", "symbols"],
];

function classifyMcp(tool: string): Classification {
  const rest = tool.slice("mcp__".length);
  const cut = rest.indexOf("__");
  if (cut <= 0) return NONE();
  const server = rest.slice(0, cut);
  const name = rest.slice(cut + 2);
  if (Object.hasOwn(MCP_EXACT, server)) {
    const table = MCP_EXACT[server]!;
    return Object.hasOwn(table, name)
      ? at(`mcp-exact.${server}.${name}`, table[name]!)
      : NONE();
  }
  const tokens = name.toLowerCase().split(/[_\-.]+/);
  for (const [tok, cat] of MCP_TOKENS) {
    if (tokens.includes(tok)) return at(`mcp-token.${tok}`, cat);
  }
  return NONE();
}

/** Segments that say nothing about the category. */
const NEUTRAL = new Set(["cd", "set-location", "sl", "pushd", "popd", "echo", "write-output", "write-host", "true", "exit"]);
/** Filters that only shape the output of the segment before the pipe. */
const FILTERS = new Set([
  "head", "tail", "grep", "egrep", "select-string", "sls", "findstr", "sort", "sort-object", "uniq", "wc",
  "measure-object", "measure", "select-object", "select", "where-object", "where", "out-string",
  "format-table", "ft", "format-list", "fl", "cut",
]);
const READ = new Set(["cat", "type", "get-content", "gc", "more", "less"]);
const SEARCH = new Set(["ls", "dir", "get-childitem", "gci", "find", "rg", "grep", "select-string", "findstr", "tree", "test-path"]);
const EDIT = new Set([
  "set-content", "add-content", "out-file", "new-item", "ni", "remove-item", "rm", "del", "move-item", "mv",
  "copy-item", "cp", "rename-item", "mkdir", "md", "touch",
]);
const ENV = new Set(["set", "env", "printenv"]);
/** Strongest wins when every segment is classified: an edit that also lists is an edit. */
const STRENGTH: Category[] = ["compile", "test", "publish", "symbols", "edit", "vcs", "read", "search", "other"];
/** Output redirect to a real file; 2>&1, >$null, >/dev/null and >nul are not edits. */
const REDIRECT = /(^|[^0-9&>])>>?\s*(?!&|\$null\b|\/dev\/null\b|nul\b)[^\s&|]/i;

/** Split on ; && || | and newlines outside quotes; a segment after | is marked piped. */
function segments(cmd: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = "";
  let piped = false;
  let q: string | null = null;
  const cut = (nextPiped: boolean) => {
    out.push({ text: cur, piped });
    cur = "";
    piped = nextPiped;
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
  return out
    .map((s) => ({ ...s, text: s.text.trim().replace(/^[$@]?\(+/, "") }))
    .filter((s) => s.text !== "");
}

function words(s: string): string[] {
  return [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

function commandWord(w: string): string {
  const base = w.replace(/^&/, "").replace(/\).*$/, "").split(/[\\/]/).pop() ?? "";
  return base.toLowerCase().replace(/\.(exe|cmd|ps1|bat|dll)$/, "");
}

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

function classifySegment(text: string, piped: boolean, depth: number): Classification | "neutral" | null {
  let ws = words(text);
  if (ws[0] === "&") ws = ws.slice(1);
  if (ws.length === 0) return "neutral";
  let w0 = commandWord(ws[0]!);
  // Wrappers: classify the inner command (bounded depth).
  if (depth < 3 && ["powershell", "pwsh", "cmd", "bash", "sh"].includes(w0)) {
    const i = ws.findIndex((w, k) => k > 0 && /^([-/](c|command|file)|-c)$/i.test(w));
    if (i < 0) return null;
    return classifyShell(ws.slice(i + 1).join(" "), depth + 1);
  }
  if (w0 === "dotnet" && ws[1] && /\.dll$/i.test(ws[1])) {
    ws = ws.slice(1);
    w0 = commandWord(ws[0]!);
  }
  if (REDIRECT.test(text)) return at("shell.redirect", "edit");
  if (piped && FILTERS.has(w0)) return "neutral";
  if (NEUTRAL.has(w0)) return "neutral";
  if (w0 === "cg-al") {
    const op = (ws[1] ?? "").toLowerCase();
    return ["compile", "test", "symbols"].includes(op)
      ? at(`shell.cg-al.${op}`, op as Category)
      : at("shell.cg-al.meta", "other");
  }
  if (w0 === "al" || w0 === "altool") {
    return (ws[1] ?? "").toLowerCase() === "compile" ? at("shell.toolchain.al", "compile") : null;
  }
  if (w0 === "alc") return at("shell.toolchain.alc", "compile");
  if (w0 === "git") return at("shell.git", "vcs");
  if (READ.has(w0)) return at("shell.read", "read");
  if (SEARCH.has(w0)) return at("shell.search", "search");
  if (EDIT.has(w0)) return at("shell.edit", "edit");
  if (ENV.has(w0)) return at("shell.env", "other");
  return null;
}

export function classify(c: CallInput): Classification {
  if (c.tool.startsWith("mcp__")) return classifyMcp(c.tool);
  if (SHELLS.has(c.tool)) return c.command ? classifyShell(c.command) : NONE();
  return Object.hasOwn(BUILTIN, c.tool) ? at(`builtin.${c.tool}`, BUILTIN[c.tool]!) : NONE();
}
```

`deno fmt` will reflow the constant sets; that is fine.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all tests/unit/harness/classify.test.ts`
Expected: PASS (5 tests). If a labelled row fails, fix the rule, never the label.

- [ ] **Step 6: Commit**

```bash
git add src/harness/classify.ts tests/unit/harness/classify.test.ts tests/fixtures/harness/classify/m0-07-labeled.jsonl .gitattributes
git commit -m "feat(harness): rule-based call categorization v1 with M0-07 carryovers (M2-01)"
```

**Acceptance:** `deno test --allow-all tests/unit/harness/classify.test.ts` passes; the 45 labelled calls give 45/45 with 0 unclassified. The fixture is the M0 training sample, so this is a regression pin, not a held-out accuracy (open question 5).

---

### Task M2-02: redaction beyond exact secrets

Spec 1a section 5 ("secrets redacted before storage (known key values from `C:\cg-secrets`, token patterns)"); carryover `accept-M0-04` (redactor beyond exact secrets); secrets-accepted-risk condition (every captured log scanned). Exact-secret redaction (UTF-8 and UTF-16LE) exists (`redactBytes`, M1-12; `publishRedacted`, `redactText`, M1-20). Patterns apply to published logs and strings only, never to the frozen workspace (`redactTree` via `freezeWorkspace`), which is the verdict input.

**Lane:** infra2. **Deps:** M1-12, M1-20 (accepted). **Date:** 10-03; the `sandbox.ts` edit is integrated after M1-29.

**Files:**
- Create: `src/harness/redact-patterns.ts`
- Modify: `src/harness/sandbox.ts` (`publishRedacted`, `redactText`)
- Test: `tests/unit/harness/redact-patterns.test.ts`; append to `tests/unit/harness/sandbox.test.ts`

**Interfaces:**
- Produces: `SECRET_PATTERNS: readonly { name: string; re: RegExp }[]`; `redactPatternText(s: string): { text: string; count: number }`; `redactPatterns(data: Uint8Array): { out: Uint8Array; count: number }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/redact-patterns.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { redactPatterns, redactPatternText } from "../../../src/harness/redact-patterns.ts";

const A = "A".repeat(40);
const enc = new TextEncoder();
const dec = new TextDecoder();

Deno.test("redactPatternText: every pattern, surrounding text kept", () => {
  const cases: [string, string][] = [
    [`x sk-ant-oat01-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-ant-api03-${A} y`, "x [REDACTED:anthropic-key] y"],
    [`x sk-or-v1-${"0".repeat(64)} y`, "x [REDACTED:openrouter-key] y"],
    [`x sk-proj-${A} y`, "x [REDACTED:openai-key] y"],
    [`x ghp_${A} y`, "x [REDACTED:github-token] y"],
    [`x github_pat_${A}_${A} y`, "x [REDACTED:github-token] y"],
    [`x eyJ${A}.eyJ${A}.${A} y`, "x [REDACTED:jwt] y"],
    [`Authorization: Bearer ${A}`, "Authorization: Bearer [REDACTED:bearer]"],
  ];
  for (const [input, want] of cases) assertEquals(redactPatternText(input).text, want, input);
});

Deno.test("redactPatternText: hashes, uuids and stream ids are not secrets", () => {
  const safe = [
    "sha256:" + "a".repeat(64),
    "1ae7bb8f-04b6-4431-b315-c3a36ef73f35",
    "toolu_01YBAhLW7fMAGUsCorHcdN6D msg_011CfQ7y4eF8fJdGnHsHN2P3",
    "Bearer [REDACTED:backend-token]",
    "sk-short",
  ];
  for (const s of safe) assertEquals(redactPatternText(s), { text: s, count: 0 }, s);
});

Deno.test("redactPatterns: UTF-8 bytes around the match are untouched", () => {
  const input = enc.encode(`ø sk-ant-oat01-${A} æ\n`);
  const r = redactPatterns(input);
  assertEquals([dec.decode(r.out), r.count], ["ø [REDACTED:anthropic-key] æ\n", 1]);
});

Deno.test("redactPatterns: the M0-04 probe fixture has no false positives", async () => {
  const data = await Deno.readFile("tests/fixtures/harness/claude-code/probe.jsonl");
  const r = redactPatterns(data);
  assertEquals(r.count, 0);
  assertEquals(r.out, data);
});
```

Append to `tests/unit/harness/sandbox.test.ts` (reuse its temp-dir helper):

```typescript
Deno.test("publishRedacted redacts token patterns in logs after exact secrets", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const src = join(dir, "raw.jsonl");
  await Deno.writeTextFile(src, `{"cmd":"echo sk-ant-oat01-${"B".repeat(40)} and ${"s".repeat(20)}"}\n`);
  const n = await publishRedacted([{ src, dest: join(dir, "out", "raw.jsonl") }], [{ name: "backend-token", value: "s".repeat(20) }]);
  const out = await Deno.readTextFile(join(dir, "out", "raw.jsonl"));
  assertEquals(out, `{"cmd":"echo [REDACTED:anthropic-key] and [REDACTED:backend-token]"}\n`);
  assertEquals(n, 2);
});

Deno.test("redactText redacts token patterns too", () => {
  assertEquals(redactText(`e: Bearer ${"C".repeat(30)}`, []).text, "e: Bearer [REDACTED:bearer]");
});

Deno.test("the workspace freeze is not pattern-redacted", async () => {
  // Build a workspace with Core/src/A.al containing `// sk-ant-oat01-<40 x D>` and freeze it
  // exactly as the existing freezeWorkspace test in fsutil.test.ts does (same helper, same secrets []).
  // Assert the frozen A.al bytes equal the source bytes.
});
```

The third test reuses the setup of the existing `freezeWorkspace` test in `tests/unit/harness/fsutil.test.ts` (copy its arrange block verbatim, change only the file content and the assertion).

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/harness/redact-patterns.test.ts tests/unit/harness/sandbox.test.ts`
Expected: FAIL (module missing; the two sandbox tests fail on the unredacted token). The freeze test passes already and must keep passing.

- [ ] **Step 3: Implement**

`src/harness/redact-patterns.ts`:

```typescript
/**
 * Token-pattern redaction for published logs, traces and error text
 * (M0-04 carryover). Runs after exact-secret redaction. Never applied to the
 * frozen workspace: that is the verdict input.
 * ponytail: UTF-8 only; exact secrets already cover UTF-16LE, and every
 * published log we write is UTF-8. Add a UTF-16 pass if a UTF-16 log appears.
 */

export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  // Order matters: anthropic before openai (sk-ant- also fits the openai shape).
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
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
    text = text.replace(p.re, () => {
      count++;
      return `[REDACTED:${p.name}]`;
    });
  }
  text = text.replace(BEARER, (_m, prefix: string) => {
    count++;
    return `${prefix}[REDACTED:bearer]`;
  });
  return { text, count };
}

/** Byte-exact outside the matches: patterns are ASCII, so bytes >= 0x80 never match. */
export function redactPatterns(data: Uint8Array): { out: Uint8Array; count: number } {
  let bin = "";
  for (let i = 0; i < data.length; i += 8192) {
    bin += String.fromCharCode(...data.subarray(i, i + 8192));
  }
  const r = redactPatternText(bin);
  if (r.count === 0) return { out: data, count: 0 };
  const out = new Uint8Array(r.text.length);
  for (let i = 0; i < r.text.length; i++) out[i] = r.text.charCodeAt(i);
  return { out, count: r.count };
}
```

In `src/harness/sandbox.ts`, `publishRedacted`: after `const t = redactCutTail(r.out, secrets);` add `const p = redactPatterns(t.out);`, count `r.count + t.count + p.count`, write `p.out`. In `redactText`: after the exact loop, `const p = redactPatternText(next); return { text: p.text, count: count + p.count };`. Import `redactPatterns, redactPatternText` from `./redact-patterns.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `deno test --allow-all tests/unit/harness/redact-patterns.test.ts tests/unit/harness/sandbox.test.ts tests/unit/harness/fsutil.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (two commits: the module on 10-03, the `sandbox.ts` wiring for integration after M1-29)

```bash
git add src/harness/redact-patterns.ts tests/unit/harness/redact-patterns.test.ts
git commit -m "feat(harness): token-pattern redaction module (M2-02)"
git add src/harness/sandbox.ts tests/unit/harness/sandbox.test.ts tests/unit/harness/fsutil.test.ts
git commit -m "feat(harness): published logs and error text are pattern-redacted, workspace never (M2-02)"
```

**Acceptance:** the three test files pass; the probe fixture gives 0 pattern hits.

---

### Task M2-03: trace v2 and the full Claude Code trace builder

Spec 1a section 5 trace fields (`type` in `tool_call, model_request, skill_invoke, subagent_spawn, compaction, retry`; `transport` separate from `agent` and `skill`; `error_class` in `tool_protocol, compile_diagnostics, test_assertion, infra, denied, cancelled`; `cg-al` calls carry the operation; shell commands in full; `result_bytes`), D14 (correlation ids), section 11 (fixtures for tool call, tool error, skill, MCP, sub-agent). Findings section 4 (sub-agent records carry `parent_tool_use_id`; skill is a `Skill` tool_use; MCP is `mcp__<server>__<tool>`; timestamps on `assistant` and `user` records). M1-19 client output: one JSON line `{"op", "client": {"script_ms", "status"}, "result": {"request": "br_N", "ok", "infra"?, ...}}`, exit 1 compile/test failed, 2 infra, 3 unauthorized, 64 usage.

Trace changes version: v1 is frozen by M1-21, so v2 adds `command` (shell tools only, capped), `target` (file path input), `category`, `classifier`. `readTrace` still reads v1 files (M1 dev runs) and upgrades them with nulls.

**Lane:** infra2. **Deps:** M2-01, M1-32. **Date:** 10-04; integrated after M1-29.

**Files:**
- Modify: `src/harness/trace.ts`
- Create: `src/harness/adapters/claude-trace.ts`
- Modify: `src/harness/adapters/claude-code.ts` (move `J`, `Line`, `isObj`, `obj`, `list`, `transportOf` into `claude-trace.ts` and import them; replace the outcome and trace loops with `claudeTrace`)
- Test: create `tests/unit/harness/claude-trace.test.ts`; modify `tests/unit/harness/claude-code.test.ts` (probe test counts `tool_call` events, not all events) and `tests/unit/harness/adapter.test.ts` (trace fixtures gain the four v2 fields)

**Interfaces:**
- Consumes: `classify`, `CATEGORIES` (M2-01).
- Produces (trace.ts): `TRACE_VERSION = 2`; `TraceEventSchema` (v2, strict); `type TraceEvent`; `writeTrace(path, events)` (v2 only, unchanged behavior otherwise); `readTrace(path): Promise<TraceEvent[]>` (v1 lines upgraded with `command`, `target`, `category`, `classifier` = null; a file mixing versions or breaking `seq` order is refused with `ValidationError` naming the file and line).
- Produces (claude-trace.ts): `interface J`, `interface Line { rec: J; line: number }`, `isObj`, `obj`, `list`, `transportOf(tool)`; `RETRY_SUBTYPE = "api_retry"` (provisional; M2-05 confirms or changes it); `MAX_COMMAND_CHARS = 16384`; `interface ClaudeTrace { events: TraceEvent[]; problems: string[]; requests: Map<string, number> }`; `claudeTrace(lines: Line[], file: string, denied: ReadonlySet<string>): ClaudeTrace`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/harness/claude-trace.test.ts`:

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import { claudeTrace, type Line, MAX_COMMAND_CHARS } from "../../../src/harness/adapters/claude-trace.ts";
import { readTrace, writeTrace } from "../../../src/harness/trace.ts";
import { join } from "@std/path";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const lines = (text: string): Line[] =>
  text.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim())
    .map(({ l, i }) => ({ rec: JSON.parse(l), line: i + 1 }));
const probe = async () => lines(await Deno.readTextFile(FIXTURE));

Deno.test("claudeTrace: probe gives model requests, calls, a skill and a sub-agent in stream order", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  assertEquals(t.events.map((e) => `${e.type}:${e.tool ?? e.request_id}`), [
    "model_request:msg_011CfQ7y4eF8fJdGnHsHN2P3",
    "tool_call:Skill",
    "skill_invoke:Skill",
    "tool_call:Read",
    "tool_call:Bash",
    "tool_call:Agent",
    "subagent_spawn:Agent",
    "tool_call:ToolSearch",
    "model_request:msg_011CfQ7yrmQDhhPFDNQMjuRm",
    "tool_call:Glob",
    "model_request:msg_011CfQ7zG18wv3RDeVHig78o",
    "tool_call:mcp__al-tools__al_compile",
    "model_request:msg_011CfQ818GqWA9CenXhE8eWR",
  ]);
  assertEquals(t.events.map((e) => e.seq), t.events.map((_, i) => i + 1));
  assertEquals(t.requests.get("claude-sonnet-5"), 4);
  assertEquals(t.problems, []);
});

Deno.test("claudeTrace: sub-agent calls carry the spawning subagent_type and parent", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  const glob = t.events.find((e) => e.tool === "Glob")!;
  assertEquals([glob.agent, glob.parent], ["general-purpose", "toolu_01JFf97YM2Bqmy8ACxXQgweb"]);
  const skill = t.events.find((e) => e.type === "skill_invoke")!;
  assertEquals([skill.skill, skill.agent], ["fleet-notes", "main"]);
});

Deno.test("claudeTrace: timing, command, target, category, transport", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  const read = t.events.find((e) => e.tool === "Read")!;
  assertEquals([read.t_ms, read.duration_ms, read.target, read.category], [1230, 45, "C:\\workspace\\src\\FleetMgt.Codeunit.al", "read"]);
  const bash = t.events.find((e) => e.tool === "Bash")!;
  assertEquals([bash.command, bash.category, bash.classifier, bash.outcome, bash.error_class, bash.transport],
    ["cg-al --version", "other", "shell.cg-al.meta@1", "error", null, "shell"]);
  const mcp = t.events.find((e) => e.tool === "mcp__al-tools__al_compile")!;
  assertEquals([mcp.transport, mcp.category, mcp.duration_ms, mcp.command], ["mcp:al-tools", "compile", 8186, null]);
});

function rec(o: Record<string, unknown>, line: number): Line {
  return { rec: o, line };
}
const asst = (id: string, blocks: unknown[], parent: string | null = null, ts = "2026-10-01T00:00:00.000Z") =>
  ({ type: "assistant", timestamp: ts, parent_tool_use_id: parent, message: { id: `msg_${id}`, model: "m", content: blocks } });
const result = (id: string, content: unknown, isError = false, ts = "2026-10-01T00:00:01.000Z") =>
  ({ type: "user", timestamp: ts, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

Deno.test("claudeTrace: cg-al replies give backend_request and error_class", () => {
  const reply = (op: string, status: number, result: unknown) => JSON.stringify({ op, client: { script_ms: 900, status }, result });
  const t = claudeTrace([
    rec(asst("1", [
      { type: "tool_use", id: "a", name: "Bash", input: { command: "cg-al compile Core" } },
      { type: "tool_use", id: "b", name: "Bash", input: { command: "cg-al test 80000" } },
      { type: "tool_use", id: "c", name: "PowerShell", input: { command: "cg-al compile Core" } },
      { type: "tool_use", id: "d", name: "Bash", input: { command: "cg-al compile Core" } },
      { type: "tool_use", id: "e", name: "Read", input: { file_path: "C:\\x" } },
    ]), 1),
    rec(result("a", `Exit code 1\n${reply("compile", 200, { request: "br_1", ok: false })}`, true), 2),
    rec(result("b", `Exit code 1\n${reply("test", 200, { request: "br_2", ok: false })}`, true), 3),
    rec(result("c", `Exit code 2\n${reply("compile", 503, { request: "br_3", infra: "container down" })}`, true), 4),
    rec(result("d", reply("compile", 200, { request: "br_4", ok: true })), 5),
    rec(result("e", "<tool_use_error>File does not exist.</tool_use_error>", true), 6),
  ], "f", new Set());
  const by = (id: string) => t.events.find((x) => x.call_id === id && x.type === "tool_call")!;
  assertEquals([by("a").backend_request, by("a").error_class], ["br_1", "compile_diagnostics"]);
  assertEquals([by("b").backend_request, by("b").error_class], ["br_2", "test_assertion"]);
  assertEquals([by("c").backend_request, by("c").error_class], ["br_3", "infra"]);
  assertEquals([by("d").backend_request, by("d").outcome, by("d").error_class], ["br_4", "ok", null]);
  assertEquals([by("e").outcome, by("e").error_class], ["error", "tool_protocol"]);
});

Deno.test("claudeTrace: permission denials are denied, not errors", () => {
  const t = claudeTrace([
    rec(asst("1", [{ type: "tool_use", id: "a", name: "Write", input: { file_path: "C:\\x" } }]), 1),
    rec(result("a", "Permission to use Write has been denied.", true), 2),
  ], "f", new Set(["a"]));
  const e = t.events.find((x) => x.type === "tool_call")!;
  assertEquals([e.outcome, e.error_class], ["denied", "denied"]);
});

Deno.test("claudeTrace: orphan sub-agent records are attributed once with a problem", () => {
  const t = claudeTrace([
    rec(asst("1", [{ type: "tool_use", id: "a", name: "Read", input: {} }], "toolu_missing"), 1),
    rec(asst("2", [{ type: "tool_use", id: "b", name: "Glob", input: {} }], "toolu_missing"), 2),
  ], "f", new Set());
  assertEquals(t.events.filter((e) => e.type === "tool_call").map((e) => e.agent), ["subagent", "subagent"]);
  assertEquals(t.problems, ["f:1: parent_tool_use_id toolu_missing has no earlier Agent call"]);
});

Deno.test("claudeTrace: compaction and retry records become events", () => {
  const t = claudeTrace([
    rec({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 190000 } }, 1),
    rec({ type: "system", subtype: "api_retry" }, 2),
  ], "f", new Set());
  assertEquals(t.events.map((e) => [e.type, e.error_class]), [["compaction", null], ["retry", "infra"]]);
});

Deno.test("claudeTrace: a huge command is capped with the cut length named", () => {
  const cmd = "echo " + "x".repeat(MAX_COMMAND_CHARS);
  const t = claudeTrace([rec(asst("1", [{ type: "tool_use", id: "a", name: "Bash", input: { command: cmd } }]), 1)], "f", new Set());
  const c = t.events.find((e) => e.type === "tool_call")!.command!;
  assertEquals(c, cmd.slice(0, MAX_COMMAND_CHARS) + " [cut: 5 more chars]");
});

Deno.test("claudeTrace: a repeated tool_use id is refused with the line", () => {
  assertThrows(() =>
    claudeTrace([
      rec(asst("1", [{ type: "tool_use", id: "a", name: "Read", input: {} }]), 1),
      rec(asst("2", [{ type: "tool_use", id: "a", name: "Read", input: {} }]), 2),
    ], "f", new Set()), ValidationError, "f:2: tool_use id a repeats line 1");
});

Deno.test("readTrace: v2 round trip; v1 files are upgraded; mixed versions refused", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  await writeTrace(join(dir, "v2.jsonl"), t.events);
  assertEquals(await readTrace(join(dir, "v2.jsonl")), t.events);
  const v1 = { ...t.events[1]!, v: 1 } as Record<string, unknown>;
  for (const k of ["command", "target", "category", "classifier"]) delete v1[k];
  await Deno.writeTextFile(join(dir, "v1.jsonl"), JSON.stringify(v1) + "\n");
  assertEquals((await readTrace(join(dir, "v1.jsonl")))[0]!.category, null);
  await Deno.writeTextFile(join(dir, "mix.jsonl"), JSON.stringify(v1) + "\n" + JSON.stringify({ ...t.events[2], seq: 3 }) + "\n");
  await assertRejectsValidation(join(dir, "mix.jsonl"));
});

async function assertRejectsValidation(path: string) {
  let err: unknown;
  try {
    await readTrace(path);
  } catch (e) {
    err = e;
  }
  assertEquals(err instanceof ValidationError, true);
}
```

In `tests/unit/harness/claude-code.test.ts`, probe test: replace `assertEquals(r.traceEvents, toolUses);` with

```typescript
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim().split("\n").map((l) => JSON.parse(l));
  assertEquals(trace.filter((e) => e.type === "tool_call").length, toolUses);
  assertEquals(r.traceEvents, trace.length);
```

(and drop the later duplicate `const trace = ...` declaration in that test). In `tests/unit/harness/adapter.test.ts`, every literal trace event gains `v: 2, command: null, target: null, category: null, classifier: null`.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/harness/claude-trace.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/adapter.test.ts`
Expected: FAIL (module missing; v2 fields refused by the v1 schema).

- [ ] **Step 3: Implement trace v2**

In `src/harness/trace.ts`: keep the v1 field object as `const V1_FIELDS = { ...current fields without v }`; `const V1 = z.strictObject({ v: z.literal(1), ...V1_FIELDS })`; `TRACE_VERSION = 2`;

```typescript
export const TraceEventSchema = z.strictObject({
  v: z.literal(TRACE_VERSION),
  ...V1_FIELDS,
  /** Shell tools only: the command as issued (capped by the producer; redacted on publication). */
  command: Str,
  /** File path input of read and edit tools, else null. */
  target: Str,
  category: z.enum(CATEGORIES).nullable(),
  /** `<rule-id>@<RULES_VERSION>` of the rule that set `category`. */
  classifier: Str,
});

/** Reads v2, and v1 upgraded with nulls. One version per file; seq strictly increasing. */
export async function readTrace(path: string): Promise<TraceEvent[]> {
  const out: TraceEvent[] = [];
  let version: number | null = null;
  const text = await Deno.readTextFile(path);
  for (const [i, l] of text.split("\n").entries()) {
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
    const v = (raw as { v?: unknown })?.v;
    if (version !== null && v !== version) fail(`version ${v} after ${version}`);
    const e = v === 1
      ? (() => {
        const r = V1.safeParse(raw);
        if (!r.success) fail(r.error.issues[0]!.message);
        return { ...r.data!, v: TRACE_VERSION, command: null, target: null, category: null, classifier: null } as TraceEvent;
      })()
      : (() => {
        const r = TraceEventSchema.safeParse(raw);
        if (!r.success) fail(r.error.issues[0]!.message);
        return r.data!;
      })();
    version = v as number;
    if (out.length > 0 && e.seq <= out[out.length - 1]!.seq) fail(`seq ${e.seq} does not follow ${out[out.length - 1]!.seq}`);
    out.push(e);
  }
  return out;
}
```

Import `CATEGORIES` from `./classify.ts`. `writeTrace` is unchanged (it validates against the v2 schema).

- [ ] **Step 4: Implement the builder**

`src/harness/adapters/claude-trace.ts`:

```typescript
/**
 * Claude Code stream-json records to normalized trace events (spec 1a
 * section 5, D14; findings section 4). Pure. Events are emitted in stream
 * order: a model_request at the first record of each assistant message id,
 * a tool_call per tool_use block, plus a subagent_spawn (Agent/Task) or
 * skill_invoke (Skill) marker for the same call. Sub-agent records are
 * attributed through parent_tool_use_id to the spawning call's
 * subagent_type. Categories come from the versioned rules (classify.ts).
 */

import type { TraceEvent } from "../trace.ts";
import { ValidationError } from "../../errors.ts";
import { classify } from "../classify.ts";
import { TRACE_VERSION } from "../trace.ts";

/** Move the `J` interface from claude-code.ts here unchanged, and add: timestamp?, input?, text?, op?, client?, result?, request?, ok?, infra?, skill?, subagent_type?, file_path?, notebook_path?, path?, command?, permission_denials?. */
export interface J {
  [k: string]: unknown;
  // (the full declared-key list, see the comment above)
}
export interface Line {
  rec: J;
  line: number;
}
export const isObj = (v: unknown): v is J => v !== null && typeof v === "object" && !Array.isArray(v);
export const obj = (v: unknown): J => (isObj(v) ? v : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function transportOf(tool: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool);
  if (m) return `mcp:${m[1]}`;
  return tool === "Bash" || tool === "PowerShell" ? "shell" : "builtin";
}

/** Provisional until M2-05 records a retry from Claude Code 2.1.282. */
export const RETRY_SUBTYPE = "api_retry";
/** ponytail: chars, not bytes; the cut is named so nothing looks complete that is not. */
export const MAX_COMMAND_CHARS = 16384;
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);
const utf8 = new TextEncoder();

export interface ClaudeTrace {
  events: TraceEvent[];
  problems: string[];
  /** Distinct assistant message ids per model (visible requests only). */
  requests: Map<string, number>;
}

function refuse(msg: string): never {
  throw new ValidationError(msg, [msg]);
}
const ms = (ts: unknown): number | null => {
  if (typeof ts !== "string") return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : list(content).map(obj).map((c) => (typeof c.text === "string" ? c.text : "")).join("\n");

/** The cg-al client line {op, client, result} or a backend MCP reply carrying `request`. */
function backendReply(text: string): J | null {
  for (const l of text.split(/\r?\n/)) {
    const s = l.indexOf("{");
    if (s < 0) continue;
    try {
      const v = JSON.parse(l.slice(s));
      if (isObj(v) && (typeof v.op === "string" || typeof v.request === "string")) return v;
    } catch {
      // not the reply line
    }
  }
  return null;
}

function errorClass(outcome: TraceEvent["outcome"], text: string, reply: J | null): string | null {
  if (outcome === "denied") return "denied";
  if (outcome !== "error") return null;
  if (reply !== null) {
    const r = typeof reply.op === "string" ? obj(reply.result) : reply;
    const status = typeof reply.op === "string" ? obj(reply.client).status : 200;
    if (r.infra !== undefined || status === 0 || status === 401 || (typeof status === "number" && status >= 500)) {
      return "infra";
    }
    if (status === 400) return "tool_protocol";
    if (r.ok === false) return reply.op === "test" ? "test_assertion" : reply.op === "compile" ? "compile_diagnostics" : null;
  }
  return text.trimStart().startsWith("<tool_use_error>") ? "tool_protocol" : null;
}

const BASE = {
  session: null,
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
  command: null,
  target: null,
  category: null,
  classifier: null,
} as const;

export function claudeTrace(lines: Line[], file: string, denied: ReadonlySet<string>): ClaudeTrace {
  const problems: string[] = [];
  const events: TraceEvent[] = [];
  const push = (e: Omit<TraceEvent, "v" | "seq">) => events.push({ v: TRACE_VERSION, seq: events.length + 1, ...e });
  const t0 = lines.map((l) => ms(l.rec.timestamp)).find((t) => t !== null) ?? null;
  const rel = (t: number | null) => (t === null || t0 === null ? null : Math.max(0, t - t0));

  // Pass 1: one result per tool_use id (same refusals as M1-32).
  const results = new Map<string, { error: boolean; bytes: number; text: string; at: number | null }>();
  for (const { rec, line } of lines) {
    if (rec.type !== "user") continue;
    for (const c of list(obj(rec.message).content).map(obj)) {
      if (c.type !== "tool_result") continue;
      const id = c.tool_use_id;
      if (typeof id !== "string") refuse(`${file}:${line}: tool_result without a tool_use_id`);
      if (results.has(id)) refuse(`${file}:${line}: second result for ${id}`);
      const text = textOf(c.content);
      const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
      results.set(id, { error: c.is_error === true, bytes: utf8.encode(body).length, text, at: ms(rec.timestamp) });
    }
  }

  const spawned = new Map<string, string>();
  const orphans = new Set<string>();
  const seenMsg = new Set<string>();
  const callLine = new Map<string, number>();
  const requests = new Map<string, number>();
  for (const { rec, line } of lines) {
    const parent = typeof rec.parent_tool_use_id === "string" ? rec.parent_tool_use_id : null;
    let agent = "main";
    if (parent !== null) {
      const a = spawned.get(parent);
      if (a === undefined && !orphans.has(parent)) {
        orphans.add(parent);
        problems.push(`${file}:${line}: parent_tool_use_id ${parent} has no earlier Agent call`);
      }
      agent = a ?? "subagent";
    }
    const session = str(rec.session_id);
    const at = ms(rec.timestamp);
    if (rec.type === "system" && rec.subtype === "compact_boundary") {
      push({ ...BASE, type: "compaction", t_ms: rel(at), session, agent, parent });
      continue;
    }
    if (rec.type === "system" && rec.subtype === RETRY_SUBTYPE) {
      push({ ...BASE, type: "retry", t_ms: rel(at), session, agent, parent, error_class: "infra" });
      continue;
    }
    if (rec.type !== "assistant") continue;
    const msg = obj(rec.message);
    const model = str(msg.model);
    const requestId = str(msg.id);
    if (requestId !== null && !seenMsg.has(requestId)) {
      seenMsg.add(requestId);
      if (model !== null) requests.set(model, (requests.get(model) ?? 0) + 1);
      push({ ...BASE, type: "model_request", t_ms: rel(at), session, agent, parent, request_id: requestId, model });
    }
    for (const c of list(msg.content).map(obj)) {
      if (c.type !== "tool_use") continue;
      if (typeof c.id !== "string" || typeof c.name !== "string") {
        refuse(`${file}:${line}: tool_use without a string id and name`);
      }
      const id = c.id;
      const name = c.name;
      const seen = callLine.get(id);
      if (seen !== undefined) refuse(`${file}:${line}: tool_use id ${id} repeats line ${seen}`);
      callLine.set(id, line);
      const input = obj(c.input);
      const rawCmd = SHELL_TOOLS.has(name) && typeof input.command === "string" ? input.command : null;
      const command = rawCmd === null || rawCmd.length <= MAX_COMMAND_CHARS
        ? rawCmd
        : `${rawCmd.slice(0, MAX_COMMAND_CHARS)} [cut: ${rawCmd.length - MAX_COMMAND_CHARS} more chars]`;
      const target = [input.file_path, input.notebook_path, input.path].map(str).find((v) => v !== null) ?? null;
      const r = results.get(id);
      const outcome: TraceEvent["outcome"] = denied.has(id) ? "denied" : r ? (r.error ? "error" : "ok") : null;
      const reply = r ? backendReply(r.text) : null;
      const request = reply === null
        ? null
        : str(typeof reply.op === "string" ? obj(reply.result).request : reply.request);
      const common = {
        t_ms: rel(at),
        session,
        agent,
        parent,
        call_id: id,
        request_id: requestId,
        tool: name,
        transport: transportOf(name),
        model,
      };
      push({
        ...BASE,
        ...common,
        type: "tool_call",
        skill: name === "Skill" ? str(input.skill) : null,
        backend_request: request,
        outcome,
        error_class: errorClass(outcome, r?.text ?? "", reply),
        result_bytes: r?.bytes ?? null,
        duration_ms: r && r.at !== null && at !== null && r.at >= at ? r.at - at : null,
        command,
        target,
        ...classify({ tool: name, command: rawCmd, target }),
      });
      if (SPAWN_TOOLS.has(name)) {
        spawned.set(id, str(input.subagent_type) ?? "subagent");
        push({ ...BASE, ...common, type: "subagent_spawn" });
      }
      if (name === "Skill") push({ ...BASE, ...common, type: "skill_invoke", skill: str(input.skill) });
    }
  }
  for (const id of [...results.keys()].sort()) {
    if (!callLine.has(id)) problems.push(`tool_result for unknown ${id}`);
  }
  return { events, problems, requests };
}
```

Note: classification uses the uncapped command (`rawCmd`); the stored command is capped.

- [ ] **Step 5: Switch the adapter**

In `src/harness/adapters/claude-code.ts`: delete the local `J`, `Line`, `isObj`, `obj`, `list`, `transportOf`, the "Tool outcomes" loop and the trace-building part of the assistant loop (keep `didWork` and `perMessage` for the TTL split). Import from `./claude-trace.ts`. Before the TTL split:

```typescript
  const denied = new Set(
    list(result?.permission_denials).map(obj).map((d) => d.tool_use_id)
      .filter((x): x is string => typeof x === "string"),
  );
  const built = claudeTrace(lines, file, denied);
  streamProblems.push(...built.problems);
  const trace = built.events;
```

Everything else in `parseClaudeStream` is unchanged in this task (M2-08 uses `built.requests`).

- [ ] **Step 6: Run to verify pass**

Run: `deno test --allow-all tests/unit/harness/claude-trace.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/adapter.test.ts`
Expected: PASS. All pre-existing `claude-code hardening` tests pass unchanged (same refusal messages).

- [ ] **Step 7: Commit**

```bash
git add src/harness/trace.ts src/harness/adapters/claude-trace.ts src/harness/adapters/claude-code.ts tests/unit/harness/claude-trace.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/adapter.test.ts
git commit -m "feat(harness): trace v2 and full Claude Code trace builder (M2-03)"
```

**Acceptance:** the three files pass; `deno check src/harness/**/*.ts` clean.

---

### Task M2-04: scripted Messages API stub

Needed because retry, compaction and fatal records were not observed in M0 (findings section 4, `accept-M0-04`) and the 5 supervised credential runs must not be spent on fixtures (egress decision). The stub serves `POST /v1/messages` (streaming SSE and non-streaming), `POST /v1/messages/count_tokens`, and 404 elsewhere; each messages request consumes the next scenario step. It logs method, path, model, stream flag and step index per request, never headers or bodies.

**Lane:** infra2. **Deps:** none. **Date:** 10-05. New files only.

**Files:**
- Create: `scripts/harness/stub-anthropic.ts`, `scripts/harness/stub-scenarios/retry.json`, `fatal.json`, `compaction.json`, `arm-probe.json`
- Test: `tests/unit/harness/stub-anthropic.test.ts`

**Interfaces:**
- Produces: `ScenarioSchema` (Zod); `type Scenario`; `stubHandler(s: Scenario, log: (e: StubLogEntry) => void): (req: Request) => Promise<Response>`; `interface StubLogEntry { i: number; path: string; model: string | null; stream: boolean | null; step: number | null; status: number }`; CLI `deno run --allow-net --allow-read --allow-write scripts/harness/stub-anthropic.ts <scenario.json> <log.jsonl> --hostname <addr> --port <n>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { assertEquals } from "@std/assert";
import { ScenarioSchema, stubHandler } from "../../../scripts/harness/stub-anthropic.ts";

const post = (path: string, body: unknown) =>
  new Request(`http://stub${path}`, { method: "POST", body: JSON.stringify(body), headers: { authorization: "Bearer x", "content-type": "application/json" } });

async function events(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
}

Deno.test("stub: a tool_use step streams a complete message with the input as one json delta", async () => {
  const s = ScenarioSchema.parse({ steps: [{ content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "C:\\a" } }], stop_reason: "tool_use" }] });
  const log: unknown[] = [];
  const h = stubHandler(s, (e) => log.push(e));
  const ev = await events(await h(post("/v1/messages?beta=true", { model: "claude-x", stream: true })));
  assertEquals(ev.map((e) => e.type), ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
  assertEquals(ev[0].message.model, "claude-x");
  assertEquals(JSON.parse(ev[2].delta.partial_json), { file_path: "C:\\a" });
  assertEquals(ev[4].delta.stop_reason, "tool_use");
  assertEquals(log, [{ i: 1, path: "/v1/messages", model: "claude-x", stream: true, step: 0, status: 200 }]);
});

Deno.test("stub: error steps, then after=repeat_last keeps failing; default after replies end_turn", async () => {
  const fatal = stubHandler(ScenarioSchema.parse({ steps: [{ status: 500, error_type: "api_error" }], after: "repeat_last" }), () => {});
  for (let i = 0; i < 3; i++) {
    const r = await fatal(post("/v1/messages", { model: "m", stream: true }));
    assertEquals([r.status, (await r.json()).error.type], [500, "api_error"]);
  }
  const done = stubHandler(ScenarioSchema.parse({ steps: [{ status: 529, error_type: "overloaded_error" }] }), () => {});
  assertEquals((await done(post("/v1/messages", { model: "m", stream: true }))).status, 529);
  const ev = await events(await done(post("/v1/messages", { model: "m", stream: true })));
  assertEquals(ev[4].delta.stop_reason, "end_turn");
});

Deno.test("stub: usage carries a stated TTL split; count_tokens and unknown paths", async () => {
  const h = stubHandler(ScenarioSchema.parse({ steps: [{ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 190000, cache_creation_input_tokens: 10 } }] }), () => {});
  const ev = await events(await h(post("/v1/messages", { model: "m", stream: true })));
  assertEquals(ev[0].message.usage.cache_creation, { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 });
  assertEquals(ev[0].message.usage.input_tokens, 190000);
  assertEquals((await (await h(post("/v1/messages/count_tokens", {}))).json()).input_tokens, 1);
  assertEquals((await h(post("/v1/other", {}))).status, 404);
});

Deno.test("stub: non-streaming requests get a JSON message", async () => {
  const h = stubHandler(ScenarioSchema.parse({ steps: [] }), () => {});
  const m = await (await h(post("/v1/messages", { model: "m", stream: false }))).json();
  assertEquals([m.type, m.stop_reason, m.content[0].text], ["message", "end_turn", "done"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/harness/stub-anthropic.test.ts` - FAIL (module missing).

- [ ] **Step 3: Implement**

`scripts/harness/stub-anthropic.ts`:

```typescript
/**
 * Scripted Anthropic Messages API for recording Claude Code fixtures and
 * probing arms without a credential (M2-05, M2-11). Each POST /v1/messages
 * consumes the next step. After the last step: `end_turn` (default) replies
 * with a text "done"; `repeat_last` repeats the last step forever. The log
 * holds no headers and no bodies.
 * Usage: deno run --allow-net --allow-read --allow-write scripts/harness/stub-anthropic.ts <scenario.json> <log.jsonl> --hostname <addr> --port <n>
 */

import { parseArgs } from "@std/cli/parse-args";
import { z } from "zod";

const Block = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
]);
const Usage = z.strictObject({
  input_tokens: z.number().int().nonnegative().default(10),
  output_tokens: z.number().int().nonnegative().default(5),
  cache_read_input_tokens: z.number().int().nonnegative().default(0),
  cache_creation_input_tokens: z.number().int().nonnegative().default(0),
});
const Step = z.union([
  z.strictObject({ status: z.number().int().min(400), error_type: z.string() }),
  z.strictObject({ content: z.array(Block), stop_reason: z.enum(["end_turn", "tool_use"]), usage: Usage.default(Usage.parse({})) }),
]);
export const ScenarioSchema = z.strictObject({
  steps: z.array(Step),
  after: z.enum(["end_turn", "repeat_last"]).default("end_turn"),
});
export type Scenario = z.output<typeof ScenarioSchema>;
type Message = Extract<Scenario["steps"][number], { content: unknown }>;

export interface StubLogEntry {
  i: number;
  path: string;
  model: string | null;
  stream: boolean | null;
  step: number | null;
  status: number;
}

const DONE: Message = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: Usage.parse({}) };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function usageOf(m: Message) {
  return { ...m.usage, cache_creation: { ephemeral_5m_input_tokens: m.usage.cache_creation_input_tokens, ephemeral_1h_input_tokens: 0 } };
}

function sse(model: string, id: string, m: Message): string {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usageOf(m), output_tokens: 1 } },
  });
  m.content.forEach((b, index) => {
    if (b.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: m.usage.output_tokens } });
  out += ev("message_stop", {});
  return out;
}

export function stubHandler(s: Scenario, log: (e: StubLogEntry) => void): (req: Request) => Promise<Response> {
  let next = 0;
  let n = 0;
  return async (req) => {
    const path = new URL(req.url).pathname;
    const entry: StubLogEntry = { i: ++n, path, model: null, stream: null, step: null, status: 404 };
    try {
      if (req.method === "POST" && path === "/v1/messages/count_tokens") {
        entry.status = 200;
        return json(200, { input_tokens: 1 });
      }
      if (req.method !== "POST" || path !== "/v1/messages") {
        return json(404, { type: "error", error: { type: "not_found_error", message: path } });
      }
      const body = await req.json().catch(() => ({}));
      const model = typeof body.model === "string" ? body.model : "stub";
      entry.model = model;
      entry.stream = body.stream === true;
      let idx: number | null = next < s.steps.length ? next++ : s.after === "repeat_last" && s.steps.length > 0 ? s.steps.length - 1 : null;
      const step = idx === null ? DONE : s.steps[idx]!;
      entry.step = idx;
      if ("status" in step) {
        entry.status = step.status;
        return json(step.status, { type: "error", error: { type: step.error_type, message: "stub" } });
      }
      entry.status = 200;
      const id = `msg_stub_${n}`;
      if (!entry.stream) {
        return json(200, { id, type: "message", role: "assistant", model, content: step.content, stop_reason: step.stop_reason, stop_sequence: null, usage: usageOf(step) });
      }
      return new Response(sse(model, id, step), { headers: { "content-type": "text/event-stream" } });
    } finally {
      log(entry);
    }
  };
}

if (import.meta.main) {
  const a = parseArgs(Deno.args, { string: ["hostname", "port"] });
  const [scenarioPath, logPath] = a._.map(String);
  if (!scenarioPath || !logPath || !a.hostname || !a.port) throw new Error("usage: see header");
  const s = ScenarioSchema.parse(JSON.parse(await Deno.readTextFile(scenarioPath)));
  const logFile = await Deno.open(logPath, { create: true, append: true });
  const enc = new TextEncoder();
  Deno.serve({ hostname: a.hostname, port: Number(a.port) }, stubHandler(s, (e) => {
    logFile.writeSync(enc.encode(JSON.stringify(e) + "\n"));
  }));
}
```

(`let idx` may be `const`; `deno lint` will say so.)

Scenarios:
- `retry.json`: `{"steps":[{"status":529,"error_type":"overloaded_error"},{"status":529,"error_type":"overloaded_error"},{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}]}`
- `fatal.json`: `{"steps":[{"status":500,"error_type":"api_error"}],"after":"repeat_last"}`
- `compaction.json`: step 1 `tool_use` `Read` of `C:\workspace\hello.txt` with `usage.input_tokens` 190000; step 2 text "Summary: read hello.txt." (end_turn, serves the compaction request if one happens); step 3 text "ok" (end_turn).
- `arm-probe.json` (M2-11): `Skill {"skill":"probe-skill"}` (tool_use), `Agent {"subagent_type":"general-purpose","description":"list","prompt":"List C:\\workspace."}`, the sub-agent's `Glob {"pattern":"*"}`, sub-agent text "1 file" (end_turn), `ToolSearch {"query":"select:mcp__echo__echo_compile","max_results":1}`, `mcp__echo__echo_compile {"app":"Core"}`, `Bash {"command":"cg-al --version"}`, final text "done" (end_turn). Every tool_use step has `stop_reason: "tool_use"`; ids `toolu_stub_01` ... in order.

- [ ] **Step 4: Run to verify pass** - `deno test --allow-all tests/unit/harness/stub-anthropic.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/harness/stub-anthropic.ts scripts/harness/stub-scenarios tests/unit/harness/stub-anthropic.test.ts
git commit -m "feat(harness): scripted Messages API stub for credential-free fixtures (M2-04)"
```

**Acceptance:** tests pass; every scenario file parses with `ScenarioSchema` (add a loop test over `scripts/harness/stub-scenarios/*.json`).

---

### Task M2-05 (ops): record retry, fatal and compaction fixtures

Findings section 4 ("Retry / compaction: not seen"), `accept-M0-04` (missing fixture coverage for retry, compaction and fatal records). No provider credential, no BC container, no ledger reservation: the OAuth token file holds a dummy value, and `ANTHROPIC_BASE_URL` (a non-secret env value) points Claude Code at the stub on the host.

**Lane:** ops. **Deps:** M2-04, M1-28 (image `centralgauge/harness-claude-code:2.1.282` built). **Date:** 10-06.

**Files (committed by ops):** `tests/fixtures/harness/claude-code/retry.jsonl`, `fatal.jsonl`, `compaction.jsonl` (plus `.gitattributes` `-text` if the existing line does not cover them). Evidence: `H:\cg-coord\tasks\M2-05\runs\<nnn>\evidence.md`.

- [ ] **Step 1: Prepare.** A throwaway dir under `H:\Temp3\harness-spike\M2-05\` with `workspace\hello.txt` ("hello"), `task\prompt.md` ("Read hello.txt and reply with its content."), `config\settings.json` = `{"settings":{"api_models":{"main":"claude-sonnet-5"}},"limits":{"max_budget_usd":5}}` (the api id comes from `site/catalog/models.yml` for the catalog slug the cc-sonnet-plain config uses; copy it, do not invent it), `secrets\claude-oauth-token` holding a 40-char dummy value. Resolve the host address the sandbox can reach (the nat gateway recorded by M1-26).
- [ ] **Step 2: Per scenario** (`retry`, `fatal`, `compaction`): start `deno run --allow-net --allow-read --allow-write scripts/harness/stub-anthropic.ts scripts/harness/stub-scenarios/<s>.json H:\Temp3\harness-spike\M2-05\<s>-stub.jsonl --hostname <gateway> --port 3400`, then

```bash
DOCKER_CONTEXT=desktop-windows docker run --rm --isolation hyperv --name cg-harness-m2-05-<s> \
  --mount type=bind,src=<dir>\workspace,dst=C:\workspace --mount type=bind,src=<dir>\task,dst=C:\task,readonly \
  --mount type=bind,src=<dir>\config,dst=C:\config,readonly --mount type=bind,src=<dir>\secrets,dst=C:\cg-secrets,readonly \
  -e ANTHROPIC_BASE_URL=http://<gateway>:3400 centralgauge/harness-claude-code:2.1.282 > <dir>\<s>.jsonl 2> <dir>\<s>.stderr.txt
```

Stop the stub. If `compaction` shows no `compact_boundary` line, rerun it once with `-e CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` and record which run produced it; if neither does, record "compaction not reproducible with the stub" and commit no compaction fixture.
- [ ] **Step 3: Check and commit.** For each log: `grep -c` of the dummy token is 0; the last line is `type:"result"` (fatal: `is_error` true); list every distinct `type`/`subtype` pair (`jq -c '[.type,.subtype]' | sort -u`) in the evidence, quoting verbatim the retry record(s) and the `compact_boundary` record. Copy the logs to the fixture paths and commit: `git commit -m "test(harness): recorded Claude Code 2.1.282 retry, fatal and compaction fixtures (M2-05)"`.

**Acceptance (evidence file):** for each scenario the stub log's request count and statuses, the Claude exit code, the distinct record types, the verbatim retry and compaction records (or "not emitted"), 0 dummy-token hits, and the fixture commit SHA. M2-08 declares only what this evidence shows.

---

### Task M2-06: MCP definitions, runtime facts and native MCP config

Spec 1a section 4 (manifest records each MCP server's implementation version and tool-schema hash; each component hashed; a requested component that did not load fails setup), section 5 item 4 (the al-tools MCP component calls the backend; the token allows only its own workspace), section 12 item 4 and findings section 8 (MCP arms are Claude Code only). M1-22 made `runtimeFacts` refuse MCP "until M2"; this lifts that for adapters that declare native MCP. MCP servers are reached only through the backend (`<CG_BACKEND_URL>/mcp/<name>`, the execution's backend token), so the egress rules (proxy + backend port) need no new port. `--strict-mcp-config` is passed on every Claude Code arm so a `.mcp.json` the agent writes into the workspace, or any ambient config, never changes an arm.

**Lane:** infra. **Deps:** M1-22 (`images.ts`, `execution.ts`), M1-24 (`harness cell` calls `runtimeFacts`), M1-29 accepted. **Date:** 10-06.

**Files:**
- Create: `src/harness/mcp.ts`, `harness/mcp/echo.json`
- Modify: `src/harness/adapter.ts` (`nativeMcp?: boolean`), `src/harness/adapters/claude-code.ts` (`nativeMcp: true`), `src/harness/images.ts` (`runtimeFacts`), every `runtimeFacts(` call site (grep; M1-24 `harness cell`, M1-23 campaign runner if merged), `src/harness/execution.ts` (`writeConfigDir`), `harness/images/claude-code/run.ps1`
- Test: `tests/unit/harness/mcp.test.ts`; append to `tests/unit/harness/images.test.ts`, `tests/unit/harness/execution.test.ts`, `tests/unit/harness/claude-code.test.ts`

**Interfaces:**
- Produces (mcp.ts): `McpDefinitionSchema`; `type McpDefinition = { v: 1; name: string; version: string; impl: "stub-echo"; path: string; tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] }`; `loadMcpDefinition(harnessRoot, name): Promise<McpDefinition>`; `mcpFacts(d): Promise<{ version: string; tool_schema_hash: string }>`; `mcpFactsFor(harnessRoot, names: string[]): Promise<Record<string, { version; tool_schema_hash }>>`; `toolNames(d): string[]` (sorted).
- Produces (images.ts): `runtimeFacts(config, image, adapter, catalog, mcp: Record<string, { version: string; tool_schema_hash: string }> = {})`.
- Produces (config dir): `C:\config\mcp.json` = `{ "servers": [{ "name": string, "path": string }] }` when the manifest has MCP servers.

- [ ] **Step 1: Failing tests**

`tests/unit/harness/mcp.test.ts`:

```typescript
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { loadMcpDefinition, mcpFacts, toolNames } from "../../../src/harness/mcp.ts";

const DEF = {
  v: 1, name: "echo", version: "stub-1", impl: "stub-echo", path: "/mcp/echo",
  tools: [{ name: "echo_compile", inputSchema: { type: "object", properties: { app: { type: "string" } } } }],
};
async function root(defs: Record<string, unknown>) {
  const r = await Deno.realPath(await Deno.makeTempDir());
  await Deno.mkdir(join(r, "mcp"));
  for (const [n, d] of Object.entries(defs)) await Deno.writeTextFile(join(r, "mcp", `${n}.json`), JSON.stringify(d));
  return r;
}

Deno.test("mcp: definitions load; facts hash the sorted tool schemas", async () => {
  const r = await root({ echo: DEF, echo2: { ...DEF, name: "echo2", path: "/mcp/echo2", tools: [...DEF.tools].reverse() } });
  const d = await loadMcpDefinition(r, "echo");
  assertEquals(toolNames(d), ["echo_compile"]);
  const f = await mcpFacts(d);
  assertEquals(f.version, "stub-1");
  assertEquals(f.tool_schema_hash, (await mcpFacts({ ...d, tools: [...d.tools].reverse() })).tool_schema_hash);
  assertNotEquals(f.tool_schema_hash, (await mcpFacts({ ...d, tools: [{ ...d.tools[0]!, inputSchema: {} }] })).tool_schema_hash);
});

Deno.test("mcp: a name, path or file mismatch is refused; a missing definition names the file", async () => {
  const r = await root({ echo: { ...DEF, name: "other" }, bad: { ...DEF, name: "bad", path: "/mcp/x" } });
  await assertRejects(() => loadMcpDefinition(r, "echo"), ConfigurationError, "echo.json");
  await assertRejects(() => loadMcpDefinition(r, "bad"), ConfigurationError, "path");
  await assertRejects(() => loadMcpDefinition(r, "nope"), ConfigurationError, "nope.json");
});
```

Append to `tests/unit/harness/images.test.ts` (replacing the M1-22 assertion that MCP is refused "M2"):

```typescript
Deno.test("runtimeFacts: MCP servers from definitions for native-MCP adapters; LSP and non-MCP harnesses refused", () => {
  const withMcp = { ...cfg, components: { ...cfg.components, mcp: ["echo"] } };
  const f = runtimeFacts(withMcp, image, claudeCodeAdapter, catalog, { echo: { version: "stub-1", tool_schema_hash: "h" } });
  assertEquals(f.servers, { echo: { version: "stub-1", tool_schema_hash: "h" } });
  assertThrows(() => runtimeFacts(withMcp, image, claudeCodeAdapter, catalog), ConfigurationError, "echo");
  assertThrows(() => runtimeFacts(withMcp, image, { ...claudeCodeAdapter, nativeMcp: false }, catalog, { echo: { version: "1", tool_schema_hash: "h" } }), ConfigurationError, "native MCP");
  assertThrows(() => runtimeFacts({ ...cfg, components: { ...cfg.components, lsp: ["al-lsp"] } }, image, claudeCodeAdapter, catalog), ConfigurationError, "LSP");
});
```

Append to `tests/unit/harness/execution.test.ts`:

```typescript
Deno.test("writeConfigDir: mcp.json lists each server's backend path; a changed definition is refused", async () => {
  // Arrange with the harness root used by the existing writeConfigDir test; add harness/mcp/echo.json (DEF above)
  // and a manifest whose mcp is [{ name: "echo", ...await mcpFacts(DEF) }].
  // Assert: JSON.parse(mcp.json) equals { servers: [{ name: "echo", path: "/mcp/echo" }] };
  // settings.json and manifest.json unchanged in shape.
  // Then edit echo.json's tool description and assert writeConfigDir rejects with ConfigurationError "mcp echo changed".
});
```

Append to `tests/unit/harness/claude-code.test.ts`:

```typescript
Deno.test("run.ps1 always passes --strict-mcp-config; MCP headers come from the secrets file, never argv", async () => {
  const ps = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  assertStringIncludes(ps, "'--strict-mcp-config'");
  assertStringIncludes(ps, "Join-Path 'C:\\cg-secrets' 'backend-token'");
  assertStringIncludes(ps, "$($env:CG_BACKEND_URL)$($s.path)");
  // The token only ever reaches the MCP config file, never the claude argument list.
  assert(!/claudeArgs[^\n]*backendToken/.test(ps));
  assertStringIncludes(ps, "[IO.File]::WriteAllText($mcpFile");
});
```

- [ ] **Step 2: Run to verify failure** - `deno test --allow-all tests/unit/harness/mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/execution.test.ts tests/unit/harness/claude-code.test.ts`: FAIL.

- [ ] **Step 3: Implement `src/harness/mcp.ts`**

```typescript
/**
 * Named MCP components (spec 1a sections 4 and 5). A definition lives in
 * harness/mcp/<name>.json: implementation version, the impl the backend
 * serves it with, and the tool list snapshot whose hash is the manifest's
 * tool_schema_hash. Servers are reached only through the cg-al backend at
 * <CG_BACKEND_URL>/mcp/<name> with the execution's backend token.
 * Claude Code only: pi 0.87.1 has no native MCP (findings section 4).
 */

import { join } from "@std/path";
import { z } from "zod";
import { ConfigurationError } from "../errors.ts";
import { hashJson } from "./hash.ts";

/** M3 adds its al-tools impl here. */
export const MCP_IMPLS = ["stub-echo"] as const;

const Tool = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export const McpDefinitionSchema = z.strictObject({
  v: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1),
  impl: z.enum(MCP_IMPLS),
  path: z.string(),
  tools: z.array(Tool).min(1),
}).superRefine((d, ctx) => {
  if (d.path !== `/mcp/${d.name}`) ctx.addIssue({ code: "custom", message: `path must be /mcp/${d.name}`, path: ["path"] });
  if (new Set(d.tools.map((t) => t.name)).size !== d.tools.length) {
    ctx.addIssue({ code: "custom", message: "duplicate tool name", path: ["tools"] });
  }
});
export type McpDefinition = z.output<typeof McpDefinitionSchema>;

export async function loadMcpDefinition(harnessRoot: string, name: string): Promise<McpDefinition> {
  const file = join(harnessRoot, "mcp", `${name}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(file));
  } catch (err) {
    throw new ConfigurationError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const r = McpDefinitionSchema.safeParse(raw);
  if (!r.success) {
    throw new ConfigurationError(`${file}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (r.data.name !== name) throw new ConfigurationError(`${file}: name ${r.data.name} does not match the file name`);
  return r.data;
}

export const toolNames = (d: McpDefinition): string[] => d.tools.map((t) => t.name).sort();

export async function mcpFacts(d: McpDefinition): Promise<{ version: string; tool_schema_hash: string }> {
  const tools = [...d.tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: d.version, tool_schema_hash: await hashJson({ domain: "mcp-tools", tools }) };
}

export async function mcpFactsFor(harnessRoot: string, names: string[]) {
  const out: Record<string, { version: string; tool_schema_hash: string }> = {};
  for (const n of names) out[n] = await mcpFacts(await loadMcpDefinition(harnessRoot, n));
  return out;
}
```

`harness/mcp/echo.json`: exactly `DEF` above (used by M2-11 only; no campaign config names it).

- [ ] **Step 4: Adapter flag and runtime facts**

`src/harness/adapter.ts`, `HarnessAdapter`: add `/** The harness loads MCP servers natively (pi does not). */ nativeMcp?: boolean;`. `claudeCodeAdapter`: `nativeMcp: true`.

`src/harness/images.ts`, `runtimeFacts`: add the fifth parameter; replace the M1-22 refusal with

```typescript
  if (config.components.lsp.length > 0) {
    throw new ConfigurationError(`${config.id}: LSP components are not supported in spec 1a`);
  }
  if (config.components.mcp.length > 0 && adapter.nativeMcp !== true) {
    throw new ConfigurationError(`${config.id}: ${config.harness} has no native MCP; MCP arms are Claude Code only`);
  }
  const missing = config.components.mcp.filter((n) => !Object.hasOwn(mcp, n));
  if (missing.length > 0) {
    throw new ConfigurationError(`${config.id}: no MCP definition facts for ${missing.join(", ")} (harness/mcp/<name>.json)`);
  }
```

and return `servers: Object.fromEntries(config.components.mcp.map((n) => [n, mcp[n]!]))`. Each call site passes `await mcpFactsFor(harnessRoot, config.components.mcp)`.

- [ ] **Step 5: Config dir and entrypoint**

`src/harness/execution.ts`, end of `writeConfigDir` (before `settings.json`):

```typescript
  if (m.mcp.length > 0) {
    const servers = [];
    for (const s of m.mcp) {
      const d = await loadMcpDefinition(harnessRoot, s.name);
      const f = await mcpFacts(d);
      if (f.version !== s.version || f.tool_schema_hash !== s.tool_schema_hash) {
        throw new ConfigurationError(`mcp ${s.name} changed since the campaign was created`);
      }
      servers.push({ name: s.name, path: d.path });
    }
    await Deno.writeTextFile(join(dir, "mcp.json"), JSON.stringify({ servers }, null, 2) + "\n");
  }
```

`harness/images/claude-code/run.ps1`, before `$claudeArgs`:

```powershell
# MCP (M2-06): servers only through the backend with this execution's token.
# The native config is written to a file (never argv). --strict-mcp-config on
# every arm, so workspace or ambient MCP config never changes an arm.
$mcpServers = @{}
if (Test-Path 'C:\config\mcp.json') {
  $mcp = Get-Content 'C:\config\mcp.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $backendToken = (Get-Content (Join-Path 'C:\cg-secrets' 'backend-token') -Raw -Encoding UTF8).Trim()
  foreach ($s in $mcp.servers) {
    $mcpServers[$s.name] = @{ type = 'http'; url = "$($env:CG_BACKEND_URL)$($s.path)"; headers = @{ Authorization = "Bearer $backendToken"; 'X-CG-Execution' = $env:CG_EXECUTION_ID } }
  }
}
$mcpFile = Join-Path $env:TEMP 'cg-mcp.json'
[IO.File]::WriteAllText($mcpFile, (ConvertTo-Json -InputObject @{ mcpServers = $mcpServers } -Depth 6), $utf8)
```

and append `'--mcp-config', $mcpFile, '--strict-mcp-config'` to `$claudeArgs`. Changing `run.ps1` changes the image digest: rebuild with `harness images build claude-code` before any campaign (M1-24).

- [ ] **Step 6: Run to verify pass** - the four test files PASS; the full `tests/unit/harness/` suite passes (`deno test --allow-all tests/unit/harness/`).

- [ ] **Step 7: Commit**

```bash
git add src/harness/mcp.ts harness/mcp/echo.json src/harness/adapter.ts src/harness/adapters/claude-code.ts src/harness/images.ts src/harness/execution.ts harness/images/claude-code/run.ps1 cli/commands/harness-command.ts tests/unit/harness/mcp.test.ts tests/unit/harness/images.test.ts tests/unit/harness/execution.test.ts tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): MCP definitions, runtime facts and strict native MCP config (M2-06)"
```

**Acceptance:** tests pass; `deno task start harness validate` on an experiment whose variant adds `mcp: [echo]` resolves the manifest with `servers.echo`.

---

### Task M2-07: backend MCP route, observed tool set, arm probe driver

Spec 1a section 4 (a requested component that did not load fails setup), section 5 (backend calls recorded host-side; correlation ids line up). The backend (M1-19) serves `POST /mcp/<name>` only for servers of the execution's own arm (handlers are part of the grant), with the same token, execution header, admission and host-log line (`op: "mcp:<name>"`, `request: "br_N"`). The `stub-echo` impl answers MCP JSON-RPC (`initialize`, `notifications/*`, `tools/list`, `tools/call`) and returns `{"request": "br_N", "ok": true, ...}` as text, so the trace's `backend_request` lines up with the host log. The adapter confirms `mcp:<name>` loaded only when `system/init` shows it connected **and** its `mcp__<name>__*` tool names equal the definition's.

**Lane:** infra. **Deps:** M2-06, M2-03, M1-19. **Date:** 10-07.

**Files:**
- Modify: `src/harness/mcp.ts` (`type McpHandler`, `stubEchoHandler`, `mcpHandlers`), `src/harness/backend.ts` (grant field `mcp?`, route), `src/harness/execution.ts` (grant gets handlers; parse gets `mcpTools`), `src/harness/adapter.ts` (`ParseInput.mcpTools?`), `src/harness/adapters/claude-code.ts` (loaded check)
- Create: `scripts/harness/mcp-arm-probe.ts`
- Test: append to `tests/unit/harness/mcp.test.ts`, `tests/unit/harness/backend.test.ts`, `tests/unit/harness/claude-code.test.ts`

**Interfaces:**
- Produces (mcp.ts): `type McpHandler = (req: Request, ctx: { requestId: string; signal: AbortSignal }) => Promise<Response>`; `stubEchoHandler(d: McpDefinition): McpHandler`; `mcpHandlers(defs: McpDefinition[]): Record<string, McpHandler>`.
- Produces (backend.ts): `BackendGrant.mcp?: Record<string, McpHandler>`.
- Produces (adapter.ts): `ParseInput.mcpTools?: Readonly<Record<string, readonly string[]>>`.

- [ ] **Step 1: Failing tests**

Append to `tests/unit/harness/mcp.test.ts`:

```typescript
Deno.test("stubEchoHandler: initialize, tools/list, tools/call echo the request id; notifications get 202", async () => {
  const h = stubEchoHandler(McpDefinitionSchema.parse(DEF));
  const call = (body: unknown) => h(new Request("http://b/mcp/echo", { method: "POST", body: JSON.stringify(body) }), { requestId: "br_7", signal: new AbortController().signal });
  const init = await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assertEquals([init.result.protocolVersion, init.result.serverInfo.name], ["2025-06-18", "echo"]);
  assertEquals((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const list = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assertEquals(list.result.tools.map((t: { name: string }) => t.name), ["echo_compile"]);
  const res = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo_compile", arguments: { app: "Core" } } })).json();
  assertEquals(JSON.parse(res.result.content[0].text), { request: "br_7", ok: true, echo: { app: "Core" } });
  const bad = await (await call({ jsonrpc: "2.0", id: 4, method: "nope" })).json();
  assertEquals(bad.error.code, -32601);
});
```

Append to `tests/unit/harness/backend.test.ts` (reuse its grant/serve helpers from the round-trip test):

- `backend /mcp: only the grant's servers answer; the host log records op mcp:<name> with the request id` (grant with `mcp: mcpHandlers([echo])`: `POST /mcp/echo` with the grant's token returns 200 and the host log's last line has `op: "mcp:echo"` and the same `request` as the reply text; `POST /mcp/other` returns 404; the same request with another execution's token returns 401; a grant without `mcp` returns 404 for `/mcp/echo`).
- `backend /mcp: a revoked grant refuses MCP like any other op` (after `revoke`, 401 or the same status the `/v1/compile` revocation test expects).

Append to `tests/unit/harness/claude-code.test.ts`:

```typescript
Deno.test("claude-code: an MCP server with a different tool set is not loaded", async () => {
  const al = { name: "al-tools", version: "1", tool_schema_hash: "h" };
  const names = ["al_compile", "al_container_status", "al_test", "al_verify", "al_verify_task"];
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.copyFile(FIXTURE, join(dir, "raw.jsonl"));
  const run = (mcpTools: Record<string, string[]>) =>
    claudeCodeAdapter.parse({ rawLog: join(dir, "raw.jsonl"), exitCode: 0, pricing: BOOK, traceOut: join(dir, "t.jsonl"), manifest: manifest("cc", { mcp: [al] }), mcpTools });
  assert((await run({ "al-tools": names })).observed.loaded_components!.includes("mcp:al-tools"));
  const r = await run({ "al-tools": ["al_compile"] });
  assert(!r.observed.loaded_components!.includes("mcp:al-tools"));
  assertStringIncludes(JSON.stringify(r.telemetry.raw_usage), "mcp:al-tools tools differ");
});
```

- [ ] **Step 2: Run to verify failure** - the three files FAIL.

- [ ] **Step 3: Implement the stub impl and handlers** (append to `src/harness/mcp.ts`)

```typescript
export type McpHandler = (req: Request, ctx: { requestId: string; signal: AbortSignal }) => Promise<Response>;

/** Minimal MCP streamable-HTTP server (JSON responses only) for probes. */
export function stubEchoHandler(d: McpDefinition): McpHandler {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (req, ctx) => {
    if (req.method !== "POST") return new Response(null, { status: 405 });
    const m = await req.json().catch(() => null) as { id?: unknown; method?: unknown; params?: Record<string, unknown> } | null;
    if (m === null || typeof m.method !== "string") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    if (m.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    const ok = (result: unknown) => json({ jsonrpc: "2.0", id: m.id ?? null, result });
    switch (m.method) {
      case "initialize":
        return ok({ protocolVersion: String(m.params?.protocolVersion ?? "2025-06-18"), capabilities: { tools: {} }, serverInfo: { name: d.name, version: d.version } });
      case "tools/list":
        return ok({ tools: d.tools });
      case "tools/call":
        return ok({ content: [{ type: "text", text: JSON.stringify({ request: ctx.requestId, ok: true, echo: m.params?.arguments ?? null }) }] });
      default:
        return json({ jsonrpc: "2.0", id: m.id ?? null, error: { code: -32601, message: `unknown method ${m.method}` } });
    }
  };
}

const IMPL: Record<McpDefinition["impl"], (d: McpDefinition) => McpHandler> = { "stub-echo": stubEchoHandler };
export function mcpHandlers(defs: McpDefinition[]): Record<string, McpHandler> {
  return Object.fromEntries(defs.map((d) => [d.name, IMPL[d.impl](d)]));
}
```

- [ ] **Step 4: Backend route.** In `src/harness/backend.ts`: `BackendGrant` gains `mcp?: Record<string, McpHandler>`. In `handle(req)`, route `POST /mcp/<name>` through exactly the path `/v1/<op>` requests take (token check, execution header, `closing` admission, request id `br_N`, per-request signal), then: unknown name or no `grant.mcp` entry gives 404 with no BC call; otherwise call the handler with `{ requestId, signal }` and append a host-log line with `op: "mcp:<name>"`, the status, and `request`. No snapshot and no pause: MCP handlers that need the workspace (M3) take the snapshot themselves through the same helper `/v1/compile` uses.

- [ ] **Step 5: Wire execution and the loaded check.** In `src/harness/execution.ts` where the grant is built: load the arm's definitions (`loadMcpDefinition` per `manifest.mcp`), set `mcp: mcpHandlers(defs)`, and pass `mcpTools: Object.fromEntries(defs.map((d) => [d.name, toolNames(d)]))` to `adapter.parse`. In `src/harness/adapter.ts`, `ParseInput` gains `mcpTools?: Readonly<Record<string, readonly string[]>>`. In `claude-code.ts`, replace the `connected` computation:

```typescript
  const initTools = list(init?.tools).filter((t): t is string => typeof t === "string");
  const connected = list(init?.mcp_servers).map(obj)
    .filter((s) => s.status === "connected" && typeof s.name === "string")
    .map((s) => s.name as string)
    .filter((name) => {
      const want = input.mcpTools?.[name];
      if (want === undefined) return true;
      const got = initTools.filter((t) => t.startsWith(`mcp__${name}__`)).map((t) => t.slice(`mcp__${name}__`.length)).sort();
      const w = [...want].sort();
      if (got.length === w.length && got.every((x, i) => x === w[i])) return true;
      streamProblems.push(`mcp:${name} tools differ: got [${got.join(", ")}], want [${w.join(", ")}]`);
      return false;
    })
    .map((name) => `mcp:${name}`);
```

- [ ] **Step 6: Probe driver** `scripts/harness/mcp-arm-probe.ts` (run by M2-11; no unit test beyond `deno check`). It: starts the stub API (`stubHandler` with `scripts/harness/stub-scenarios/arm-probe.json`) on `--hostname <gateway> --port <p>`; creates a `Backend` (M1-19) with a grant for a temp workspace (`hello.txt` only; `trusted: []`, ops that throw if called) and `mcp: mcpHandlers([await loadMcpDefinition(harnessRoot, "echo")])`; resolves the manifest for `harness/configs/cc-probe-mcp-skill.yml` (created here: cc-sonnet-plain plus `components.skills: bundles/probe/skills` with one skill `probe-skill` whose `SKILL.md` says "Reply with the word probe." and `components.mcp: [echo]`) and writes the config dir with `writeConfigDir`; writes a secrets dir with a dummy `claude-oauth-token` and the grant's `backend-token` through `prepareSecrets`; runs the sandbox with `runSandbox` (image by immutable id from `imageFacts`, env `CG_BACKEND_URL`, `CG_EXECUTION_ID`, `ANTHROPIC_BASE_URL`); parses with `claudeCodeAdapter.parse` (with `mcpTools`); and prints one JSON object: `termination`, `observed.loaded_components`, `stream_problems`, the trace's `tool_call` rows (`tool`, `agent`, `category`, `backend_request`), `skill_invoke` and `subagent_spawn` counts, and the host log's `mcp:echo` request ids. Exit 0 only when `loaded_components` includes `skills` and `mcp:echo`, the echo `tool_call.backend_request` equals the host log's request id, the Glob call's agent is `general-purpose`, and one `skill_invoke` names `probe-skill`.

- [ ] **Step 7: Run to verify pass** - `deno test --allow-all tests/unit/harness/mcp.test.ts tests/unit/harness/backend.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts` PASS; `deno check scripts/harness/mcp-arm-probe.ts` clean.

- [ ] **Step 8: Commit**

```bash
git add src/harness/mcp.ts src/harness/backend.ts src/harness/execution.ts src/harness/adapter.ts src/harness/adapters/claude-code.ts scripts/harness/mcp-arm-probe.ts harness/configs/cc-probe-mcp-skill.yml harness/bundles/probe tests/unit/harness/mcp.test.ts tests/unit/harness/backend.test.ts tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): backend MCP route per grant, observed MCP tool set, arm probe (M2-07)"
```

**Acceptance:** tests pass; a config without MCP produces no `mcp.json` and the backend answers 404 on `/mcp/*` for its grant.

---

### Task M2-08: metrics contract

Spec 1a section 5 "Metrics contract" (each adapter declares which fields it can supply; a declared field that is missing marks the execution `incomplete` and warns; an undeclared field is null and shows n/a) and `telemetry.json` (`turns`, `compactions`, `per_model[].requests`). `m1-metric-rules` (validity flags with metric-specific reasons). `accept-M1-32` (non-JSON lines never discard the attempt but make the stream unprovable). Record shapes stay frozen: reasons and completeness go to `telemetry.raw_usage`; trace-level counts (tool calls, errors, retries, sub-agents, skills) come from the trace (M2-09), and `traceTypes` says which event types this harness can show, so an absent type is n/a, not zero.

**Lane:** infra2. **Deps:** M2-03, M2-05 (evidence decides what is declared). **Date:** 10-07.

**Files:**
- Modify: `src/harness/adapter.ts` (`traceTypes?`), `src/harness/adapters/claude-code.ts`, `src/harness/adapters/claude-trace.ts` (`RETRY_SUBTYPE` per M2-05 evidence)
- Test: append to `tests/unit/harness/claude-code.test.ts`

**Interfaces:**
- Produces (adapter.ts): `HarnessAdapter.traceTypes?: readonly TraceEvent["type"][]`.
- Produces (raw_usage keys): `trace_complete: boolean` (a `result` record and no non-JSON line); `incomplete_reasons: Record<string, string>` (one entry per declared telemetry field that came back null or empty).
- Produces: `per_model[].requests` = distinct visible assistant messages per model when the trace is complete, else null; `compactions` = count of `compaction` events when complete and declared, else null.

- [ ] **Step 1: Failing tests** (append to `tests/unit/harness/claude-code.test.ts`)

```typescript
Deno.test("metrics: probe declares a complete trace, per-model requests and no incomplete reasons", async () => {
  const { r } = await parse(await Deno.readTextFile(FIXTURE));
  const raw = r.telemetry.raw_usage as Record<string, unknown>;
  assertEquals([raw.trace_complete, raw.incomplete_reasons], [true, {}]);
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [4]);
});

Deno.test("metrics: a killed stream leaves compactions and requests null, trace incomplete, reasons named", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean).slice(0, 20);
  const { r } = await parse(lines.join("\n") + "\n", null);
  const raw = r.telemetry.raw_usage as { trace_complete: boolean; incomplete_reasons: Record<string, string> };
  assertEquals(raw.trace_complete, false);
  assertEquals(r.telemetry.compactions, null);
  assertEquals(Object.keys(raw.incomplete_reasons).sort(), [...incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry)].sort());
  assertStringIncludes(raw.incomplete_reasons.cost_usd!, "no result record");
});

Deno.test("metrics: recorded retry and fatal fixtures (M2-05)", async () => {
  const fatal = await parse(await Deno.readTextFile("tests/fixtures/harness/claude-code/fatal.jsonl"), 1);
  assertEquals(fatal.r.termination, "harness_crash");
  assertEquals(fatal.r.didWork, false);
  const retry = await parse(await Deno.readTextFile("tests/fixtures/harness/claude-code/retry.jsonl"));
  assertEquals(retry.r.termination, "completed");
  const trace = (await Deno.readTextFile(join(retry.dir, "trace.jsonl"))).trim().split("\n").map((l) => JSON.parse(l));
  // Only if M2-05 evidence shows a retry record: 2 retry events and "retry" in traceTypes.
  // Otherwise: 0 retry events and "retry" absent from traceTypes (n/a, not zero).
  assertEquals(trace.filter((e) => e.type === "retry").length, claudeCodeAdapter.traceTypes!.includes("retry") ? 2 : 0);
});

Deno.test("metrics: recorded compaction fixture counts one compaction when declared (M2-05)", async () => {
  // Present only when M2-05 committed compaction.jsonl; otherwise delete this test and keep "compactions" undeclared.
  const { r } = await parse(await Deno.readTextFile("tests/fixtures/harness/claude-code/compaction.jsonl"));
  assert(claudeCodeAdapter.declared.includes("compactions"));
  assertEquals(r.telemetry.compactions, 1);
});

Deno.test("metrics: every declared field has a reason when missing; undeclared fields never do", async () => {
  const { r } = await parse("");
  const reasons = (r.telemetry.raw_usage as { incomplete_reasons: Record<string, string> }).incomplete_reasons;
  for (const k of Object.keys(reasons)) assert((claudeCodeAdapter.declared as readonly string[]).includes(k), k);
});
```

The fatal test's `didWork` expectation holds only if the recorded fatal log has no `assistant` record; if M2-05 shows one, assert `true` and say so in the commit message.

- [ ] **Step 2: Run to verify failure** - FAIL (`trace_complete` undefined; requests null).

- [ ] **Step 3: Implement.** In `claude-code.ts`: hoist the declared list to `const DECLARED = [ ...current list, ...(M2-05 shows compact_boundary ? ["compactions"] : []) ] as const` and use it in the adapter. After `claudeTrace`:

```typescript
  const complete = result !== undefined && nonJson.count === 0;
  const count = (t: TraceEvent["type"]) => built.events.filter((e) => e.type === t).length;
```

In the per-model mapping set `requests: complete ? (built.requests.get(model) ?? 0) : null`. Telemetry: `compactions: complete && (DECLARED as readonly string[]).includes("compactions") ? count("compaction") : null`. After the telemetry object is built:

```typescript
  const why = (k: string): string =>
    !result
      ? "no result record (the run was killed or crashed before its final record)"
      : k === "cost_usd"
      ? (est?.missing.join("; ") || "cost not computable")
      : nonJson.count > 0
      ? nonJsonReason(nonJson)
      : `${k} not reported by the result record`;
  const incomplete_reasons = Object.fromEntries(incompleteTelemetry(DECLARED, telemetry).map((k) => [k, why(k)]));
```

and put `trace_complete: complete, incomplete_reasons` into `raw_usage`. Set `traceTypes: ["tool_call", "model_request", "subagent_spawn", "skill_invoke", ...(compaction proven ? ["compaction"] : []), ...(retry proven ? ["retry"] : [])]` on the adapter and `RETRY_SUBTYPE` to the recorded subtype.

- [ ] **Step 4: Run to verify pass** - `deno test --allow-all tests/unit/harness/claude-code.test.ts tests/unit/harness/claude-trace.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness/adapter.ts src/harness/adapters/claude-code.ts src/harness/adapters/claude-trace.ts tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): Claude Code metrics contract from recorded fixtures (M2-08)"
```

**Acceptance:** tests pass; the commit message states which of `compactions` and `retry` are declared and cites the M2-05 evidence file.

---

### Task M2-09: trace metrics and report header coverage

Spec 1a section 5 ("The report shows how many events were rule-classified and unclassified per arm"), `accept-M0-07` (per-harness coverage and unclassified counts; coverage differs by harness, so category totals must not rank harnesses), section 9 header (coverage, incomplete-telemetry count per arm). An arm has exactly one harness (`manifest.harness`), so per-arm lines are per-harness lines. Header only: not cuttable.

**Lane:** infra2. **Deps:** M2-08, M1-22 (published `trace_path`). **Date:** 10-08.

**Files:**
- Create: `src/harness/trace-metrics.ts`
- Modify: `src/harness/report.ts` (`ArmCoverage.trace`, `ReportOptions.traces`, render line), `cli/commands/harness-command.ts` (load traces)
- Test: `tests/unit/harness/trace-metrics.test.ts`; append to `tests/unit/harness/report.test.ts`

**Interfaces:**
- Produces: `interface TraceMetrics { complete: boolean; tool_calls: number; tool_errors: number; errors_by_class: Record<string, number>; by_transport: Record<string, number>; by_agent: Record<string, number>; categories: Record<Category, number>; rule_classified: number; unclassified: number; compile_by_source: { backend: number; in_container: number }; model_requests: number; subagents: number; skill_invocations: Record<string, number>; mcp_calls: Record<string, number>; compactions: number; retries: number; rules: string }`; `traceMetrics(events: TraceEvent[], complete: boolean): TraceMetrics`; `interface LoadedTrace { events: TraceEvent[]; complete: boolean }`; `loadTraces(resultsRoot: string, executions: ExecutionRecord[]): Promise<Map<string, LoadedTrace | null>>` (null when `trace_path` is null or the file is missing).
- Produces (report.ts): `ReportOptions.traces?: Map<string, LoadedTrace | null>`; `ArmCoverage.trace: { executions: number; with_trace: number; complete: number; tool_calls: number; rule_classified: number; unclassified: number; rules: string } | null` (null when `traces` is not given).

- [ ] **Step 1: Failing tests**

`tests/unit/harness/trace-metrics.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { claudeTrace, type Line } from "../../../src/harness/adapters/claude-trace.ts";
import { traceMetrics } from "../../../src/harness/trace-metrics.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const lines = (t: string): Line[] => t.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim()).map(({ l, i }) => ({ rec: JSON.parse(l), line: i + 1 }));

Deno.test("traceMetrics: probe counts", async () => {
  const t = claudeTrace(lines(await Deno.readTextFile(FIXTURE)), FIXTURE, new Set());
  const m = traceMetrics(t.events, true);
  assertEquals([m.tool_calls, m.tool_errors, m.model_requests, m.subagents], [7, 1, 4, 1]);
  assertEquals(m.skill_invocations, { "fleet-notes": 1 });
  assertEquals(m.mcp_calls, { "al-tools": 1 });
  assertEquals(m.by_agent, { main: 6, "general-purpose": 1 });
  assertEquals([m.rule_classified, m.unclassified, m.rules], [7, 0, "rules@1"]);
  assertEquals(m.compile_by_source, { backend: 1, in_container: 0 });
  assertEquals(m.errors_by_class, { unclassified_error: 1 });
});

Deno.test("traceMetrics: v1 events and stale classifiers are reclassified with the current rules", () => {
  const e = { v: 2, seq: 1, t_ms: null, type: "tool_call", session: null, agent: "main", parent: null, call_id: "a", request_id: null,
    tool: "Read", transport: "builtin", skill: null, backend_request: null, outcome: "ok", error_class: null, result_bytes: null,
    truncated: null, duration_ms: null, model: null, command: null, target: null, category: null, classifier: null } as const;
  assertEquals(traceMetrics([e], true).categories.read, 1);
  assertEquals(traceMetrics([{ ...e, category: "edit", classifier: "builtin.Read@0" }], true).categories.read, 1);
});
```

Append to `tests/unit/harness/report.test.ts`:

- `report coverage: trace lines per arm, partial traces are counted, not mixed into complete ones` (records from the fixtures module with two executions per arm; `traces` map: arm A both complete with 3 and 2 tool calls, one unclassified; arm B one complete, one `{ complete: false }`, one execution missing (null)). Expected `coverage[A].trace = { executions: 2, with_trace: 2, complete: 2, tool_calls: 5, rule_classified: 4, unclassified: 1, rules: "rules@1" }`. Arm B (three executions: one complete trace with 2 tool calls, one partial with 9, one without a trace): `{ executions: 3, with_trace: 2, complete: 1, tool_calls: 2, ... }`, so the partial trace's 9 calls never enter the counts. `renderReport` contains `calls rule-classified 4/5, unclassified 1 (rules@1); traces complete 2/2` for A and `traces complete 1/3, 1 without a trace` for B.
- `report coverage: no traces option gives trace null and no line`.

- [ ] **Step 2: Run to verify failure** - FAIL.

- [ ] **Step 3: Implement `src/harness/trace-metrics.ts`**

```typescript
/** Per-execution metrics from a normalized trace (spec 1a sections 5 and 9). */

import { join } from "@std/path";
import type { ExecutionRecord } from "./records.ts";
import type { TraceEvent } from "./trace.ts";
import { type Category, CATEGORIES, classify, RULES_VERSION } from "./classify.ts";
import { readTrace } from "./trace.ts";

export interface TraceMetrics { /* as in Interfaces above */ }
export interface LoadedTrace {
  events: TraceEvent[];
  complete: boolean;
}

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export function traceMetrics(events: TraceEvent[], complete: boolean): TraceMetrics {
  const m: TraceMetrics = {
    complete, tool_calls: 0, tool_errors: 0, errors_by_class: {}, by_transport: {}, by_agent: {},
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
    rule_classified: 0, unclassified: 0, compile_by_source: { backend: 0, in_container: 0 },
    model_requests: 0, subagents: 0, skill_invocations: {}, mcp_calls: {}, compactions: 0, retries: 0,
    rules: `rules@${RULES_VERSION}`,
  };
  for (const e of events) {
    if (e.type === "model_request") m.model_requests++;
    else if (e.type === "subagent_spawn") m.subagents++;
    else if (e.type === "skill_invoke") bump(m.skill_invocations, e.skill ?? "(unnamed)");
    else if (e.type === "compaction") m.compactions++;
    else if (e.type === "retry") m.retries++;
    if (e.type !== "tool_call") continue;
    m.tool_calls++;
    if (e.outcome !== null && e.outcome !== "ok") {
      m.tool_errors++;
      bump(m.errors_by_class, e.error_class ?? "unclassified_error");
    }
    bump(m.by_transport, e.transport ?? "unknown");
    bump(m.by_agent, e.agent);
    if (e.transport?.startsWith("mcp:")) bump(m.mcp_calls, e.transport.slice(4));
    const current = e.category !== null && e.classifier?.endsWith(`@${RULES_VERSION}`);
    const c = current
      ? { category: e.category!, classifier: e.classifier! }
      : classify({ tool: e.tool ?? "", command: e.command, target: e.target });
    m.categories[c.category]++;
    if (c.category === "unclassified") m.unclassified++;
    else m.rule_classified++;
    if (c.category === "compile") {
      if (c.classifier.startsWith("shell.toolchain.")) m.compile_by_source.in_container++;
      else m.compile_by_source.backend++;
    }
  }
  return m;
}

export async function loadTraces(resultsRoot: string, executions: ExecutionRecord[]) {
  const out = new Map<string, LoadedTrace | null>();
  for (const e of executions) {
    if (e.trace_path === null) {
      out.set(e.id, null);
      continue;
    }
    try {
      const raw = e.telemetry.raw_usage as { trace_complete?: unknown } | null;
      out.set(e.id, { events: await readTrace(join(resultsRoot, e.trace_path)), complete: raw?.trace_complete === true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      out.set(e.id, null);
    }
  }
  return out;
}
```

Note: M1 dev records without `trace_complete` read as incomplete, which is the honest reading.

In `report.ts`: add `traces?: Map<string, LoadedTrace | null>` to `ReportOptions`; when computing each arm's `ArmCoverage`, if `opts.traces` is set, sum over the arm's executions: `executions`, `with_trace` (non-null), `complete`, and from complete traces only `tool_calls`, `rule_classified`, `unclassified` via `traceMetrics`; `rules` = `rules@${RULES_VERSION}`; else `trace: null`. `renderReport` prints under each arm's coverage line: `calls rule-classified ${rc}/${tc}, unclassified ${u} (${rules}); traces complete ${complete}/${executions}` and, when `with_trace < executions`, `, ${executions - with_trace} without a trace`. In `cli/commands/harness-command.ts` report path: `traces: await loadTraces(opts.resultsDir, executions)`.

- [ ] **Step 4: Run to verify pass** - `deno test --allow-all tests/unit/harness/trace-metrics.test.ts tests/unit/harness/report.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness/trace-metrics.ts src/harness/report.ts cli/commands/harness-command.ts tests/unit/harness/trace-metrics.test.ts tests/unit/harness/report.test.ts
git commit -m "feat(harness): trace metrics and per-arm classification coverage in the report header (M2-09)"
```

**Acceptance:** tests pass; `harness report --json` shows `coverage[].trace`.

---

### Task M2-10 (cuttable, launch-contract cut item 3): report efficiency from traces

Spec 1a section 9 item 3 (exploratory): tool calls total and by transport, skill and agent; tool errors by `error_class`; calls by category with in-container (classified trace) and backend compiles as separate columns labelled by source; turns, compactions, retries; available / loaded / invoked rate per skill and MCP server. Every figure is labelled exploratory; an event type not in the adapter's `traceTypes` renders `n/a`. Partial traces are excluded from means and counted. If M1-25 has landed, add these under its `efficiency` object; otherwise create `efficiency.trace` alone.

**Lane:** infra2. **Deps:** M2-09. **Date:** 10-09.

**Files:** Modify `src/harness/report.ts`; test: append to `tests/unit/harness/report.test.ts`.

**Interfaces:** `HarnessReport.efficiency.trace: Record<arm, { executions: number; partial: number; per_execution_mean: { tool_calls; tool_errors; model_requests; subagents; compactions: number | "n/a"; retries: number | "n/a"; turns: number | null }; by_transport; by_agent; errors_by_class; categories; compile_by_source; skills: Record<name, { available: true; loaded_rate: number; invoked_rate: number }>; mcp: Record<name, { available: true; loaded_rate: number; invoked_rate: number }> }>`; `metric_labels` gains `efficiency.trace: "exploratory"`.

- [ ] **Step 1: Failing tests** (append to `report.test.ts`):
  - `efficiency.trace: means over complete traces only; partial counted` (arm with traces 4 and 6 tool calls plus one partial: mean 5, partial 1).
  - `efficiency.trace: n/a for event types the adapter does not declare` (a fake adapter registry entry without `"retry"` gives `retries: "n/a"`).
  - `efficiency.trace: available / loaded / invoked per skill and MCP server` (manifest `skills` with `probe-skill/SKILL.md`, `mcp: [echo]`; two executions: one with `loaded_components` `["skills","mcp:echo"]` and a `skill_invoke` of `probe-skill` and a `mcp:echo` tool call, one with `loaded_components: ["skills"]`: skill loaded 1.0 invoked 0.5; echo loaded 0.5 invoked 0.5).
  - `efficiency.trace is labelled exploratory in text and JSON`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** in `buildReport` with `traceMetrics` per complete trace; skill names are the first path segment of `manifest.skills.files[].path`; `invoked_rate` = executions with at least one `skill_invoke` of that name (for MCP: one `tool_call` with `transport` `mcp:<name>`) over executions; `loaded_rate` from `observed.loaded_components` (`skills` covers every skill of the bundle). Render a compact table per arm under an `Efficiency (exploratory)` heading.
- [ ] **Step 4: Run to verify pass**; **Step 5: Commit** `feat(harness): efficiency from traces, exploratory (M2-10)`.

**Acceptance:** tests pass. If cut: nothing else depends on it; M2-09's header lines stay.

---

### Task M2-11 (ops): sandbox probe of an MCP + skill arm

Spec 1a section 11 ("Per real harness: smoke task end to end; correlation ids line up between trace and host call log"), section 4 (loaded components observed). No provider credential (stub API), no BC container (the echo MCP never touches BC; `cg-al --version` never calls the backend). Not counted in the 5-run budget.

**Lane:** ops. **Deps:** M2-02, M2-05 (stub proven with this image), M2-07, M2-08; image rebuilt after M2-06 (`harness images build claude-code`). **Date:** 10-09. If M1-34's firewall is already applied, the stub port must be reachable from the sandbox network; otherwise run before the firewall is enabled and say so in the evidence.

- [ ] **Step 1:** `DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/mcp-arm-probe.ts --hostname <gateway> --port 3400 --out H:\Temp3\harness-spike\M2-11\` and quote its JSON output.
- [ ] **Step 2:** Check and quote: exit 0; `loaded_components` includes `skills` and `mcp:echo`; `init.tools` shows exactly `mcp__echo__echo_compile` for the server; the echo call's `backend_request` equals the host log's `mcp:echo` line; the Glob call's agent is `general-purpose` with the Agent call as parent; one `skill_invoke` names `probe-skill`; `ToolSearch` and `Skill` are `other`, `cg-al --version` is `other`, echo is `compile`; the published trace and raw log contain 0 hits for the dummy OAuth token and the backend token, and `[REDACTED:bearer]` wherever the MCP header appears; `docker ps -a --filter name=cg-harness-` is empty afterwards.
- [ ] **Step 3 (negative):** edit a copy of `echo.json` to add a second tool without rebuilding facts, rerun: the probe exits non-zero and the parse shows `mcp:echo tools differ` (the arm would be `setup_failed`).

**Acceptance (evidence file):** the quoted output and checks above, image id, Claude Code version from `init`, stub request log count.

---

## Self-review

- **Spec coverage.** Section 5 telemetry fields: turns (M1-32), compactions and requests (M2-08), per-model usage (M1-32, requests M2-08); trace fields and types (M2-03, retry/compaction declared per M2-05); error classes (M2-03: `tool_protocol`, `compile_diagnostics`, `test_assertion`, `infra`, `denied`; `cancelled` is never observed in Claude print mode and stays unused); shell commands in full with redaction (M2-03 cap, M2-02 patterns); correlation ids (M2-03 parse, M2-07 MCP host log, M2-11 evidence; cg-al correlation is unit-tested and first seen live in the campaign `--sample 1` run). Categorization with classifier and version, re-runnable over stored traces (M2-01, M2-09 reclassifies stale versions). Metrics contract and incomplete reasons (M2-08). Section 4 MCP version and tool-schema hash, loaded check (M2-06, M2-07). Section 9 header coverage (M2-09), efficiency (M2-10, cuttable). Section 11 fixtures: tool call, tool error, skill, MCP, sub-agent (probe), retry, compaction, fatal (M2-05), hard kill (existing truncation tests + M2-08). All `accept-M0-07` carryovers are M2-01 tests; `accept-M0-04` carryovers are M2-02 and M2-05.
- **Placeholders.** Tasks that modify files not yet on master (`images.ts`, `execution.ts`, `backend.ts`, from M1-19/M1-22) name the function and the exact behavior; their existing tests are the anchor.
- **Types.** `Classification` (M2-01) feeds `claudeTrace` (M2-03) and `traceMetrics` (M2-09); `TraceEvent` v2 is used everywhere after M2-03; `McpDefinition`, `mcpFacts`, `toolNames` (M2-06) feed `mcpHandlers` (M2-07) and `ParseInput.mcpTools`; `LoadedTrace` (M2-09) feeds M2-10.

## Open questions

1. **Lane capacity 10-06 to 10-09.** infra carries M1-33, infra2 carries M1-18, M1-35, M1-23, M1-24b and M1-25 on the same days. Proposed order: M2-06, M2-07, M2-11 (MCP arms for 10-10) first; M2-10 and M1-25 cut first. Does the orchestrator accept that order, or move M2-08/M2-09 to lane-content?
2. **M3 al-tools contract and timing.** This plan fixes MCP as backend-served (`/mcp/<name>`, `impl` registry, reply text carrying `request`). The roadmap dates M3 10-09 to 10-13, overlapping the 10-10 campaigns: MCP arms need al-tools qualified by 10-09, or the MCP campaign moves.
3. **Unreproducible retry or compaction.** If the stub cannot make Claude Code 2.1.282 emit them, those metrics stay undeclared (n/a). Acceptable for the talk?
4. **All-requests-failed runs** (fatal fixture, no model usage): cost is null and the execution leaves the primary metric, though the provider billed nothing. Keep, or record exact 0 when every request failed before a response?
5. **Held-out rule accuracy.** Rules v1 are pinned on the 45 M0-07 calls they were tuned on. Label a fresh blind sample (for example 60 calls from the first campaign traces) before quoting category numbers in the talk?
6. **ToolSearch deferral.** MCP tools are deferred behind `ToolSearch` in 2.1.282 (probe). Keep the default as part of the harness, or disable deferral in MCP arms (which is itself a settings variable)?
7. **Skill and MCP bundle content** for the campaign arms (real AL skills, the al-tools tool list) is not in M2. Who authors it, and by when?
8. **Skill scope.** `skill` is set only on the `Skill` call and its `skill_invoke`; later calls are not attributed to a skill in scope. Enough for "invoked" rates?
9. **`--strict-mcp-config` on every arm** changes `run.ps1` and so the image digest after the 10-05 gate; M1 dev executions then never match campaign arms. Fine given no historical reuse?
