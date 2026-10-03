# Harness v2 M9 Realistic Bundle Implementation Plan (rev 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Shared interfaces:** every cross-plan name, path, record shape, tag and date in this plan is defined in `H:\cg-coord\plans-v2\2026-10-03-harness-v2-interfaces.md` (the appendix). Where this plan and the appendix differ, the appendix wins and this plan is the bug.

Rev 2 answers round 1 review `H:\cg-coord\reviews\PLANS-v2-001\review-m9.md` (REJECT) and follows `cross-plan-rulings.md` rulings 1 to 8. Rev 3 answers round 2 review `H:\cg-coord\reviews\PLANS-v2-002\review-m9.md` (REJECT), rulings 1 to 10 (`H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md`), the owner decisions `H:\cg-coord\decisions\2026-10-03-v2-plans-round3.md` and the appendix. The finding-by-finding maps are in "Review responses" (rounds 1 and 2) and "Round 3 changes" at the end.

**Goal:** Claude Code arms apply the whole realistic setup (CLAUDE.md v2, `.claude/rules/*.md`, skills over `cg-al`, three subagents, al-tools MCP); every cell proves its component inventory fail-closed before the agent starts, against an allow-list derived from the arm's declared components (including a declared LSP plugin, ruling 3); subagent cost is reconciled exactly or reported missing (gate 3, ruling 4); the four 2x2 arm configs plus the factorial experiment skeleton exist.

**Architecture:** Rules travel inside the existing `instructions` component (`instructions/CLAUDE.md` + `instructions/rules/*.md`), so no manifest schema change and the instructions hash covers them. The one campaign image `claude-code:2.1.282-r3` (ruling 1) gets a `run.ps1` that installs rules and agents at user scope, pins the subagent model and runs `cg-inventory.ps1` before any credential is read; the script prints one `cg_inventory` JSON line. The claude-code adapter checks that record for exact declared/installed agreement and checks `system/init` against Claude Code's built-ins plus the declared allow-list; any problem makes the execution `setup_failed`. On inventoried images (revision 3 or a `3-dev-*` proof build) the adapter also reconciles `modelUsage` exactly against streamed messages plus sub-agent final-request usage, validating every source field (no zero-fill) and both model sets; an unreconciled run has a missing cost (appendix section 6). Developmental proofs run on `2.1.282-r3-dev-<task id>` tags that no experiment may reference.

**Tech Stack:** Deno 2 + TypeScript (zod, @std), Windows PowerShell 5.1 inside the image, `powershell.exe` host-run tests, Claude Code 2.1.282 stream-json.

**Spec:** `docs/superpowers/specs/2026-10-03-harness-v2-design.md` (master 2f8d2fca; read with `git -C U:/Git/CentralGauge show 2f8d2fca:docs/superpowers/specs/2026-10-03-harness-v2-design.md` if the checkout lacks it). Sections 4, 8.1, 8.3, 10, 12, 13. H-01 decision: `H:\cg-coord\decisions\2026-10-02-h-01-image-revision.md`. Cross-plan rulings: `H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md`.

**Window:** start 2026-10-03, target 2026-10-17 for everything M9 can close alone; M9-17 (r3 built 10-18, integrated gates by 10-21) follows the M10 merge and M10-08; M8 screening starts 10-25 (appendix section 13).

## Global Constraints

- "no customer data, internal hosts, credentials or Continia tooling enter the sandbox" (spec 4).
- "every component an arm declares is proven installed in the sandbox (runtime inventory check before the agent starts), and every component it does not declare is proven absent. A staged-but-absent component refuses the cell. Positive and negative inventory tests per component." (spec 4)
- "a bundle must not name a task's fix, its procedures or its oracle checks." (spec 4)
- LSP instructions are "capability-conditional ("if an LSP tool is available") and IDENTICAL in the realistic arm with and without LSP, so the LSP toggle changes only the LSP." (spec 4)
- Gate 3: "fixtures and a live run prove whether parent usage includes child usage (no omission, no double count), incl. child models, cache, retries and cancelled agents; subagent model pinned; the cell budget limits aggregate work." (spec 8.3) M9 owns gate 3 (ruling 4); M11 consumes the usage fields and co-signs the evidence.
- Spec 12 item 3: component inventory and gate 3 are prerequisites of SCREENING, not only of the campaign. M8 screening waits for M9-15 and M9-17.
- "Missing or incomplete telemetry stays missing, never zero." (spec 6)
- Arms: the 2x2 factorial, Claude Code only, pi out of v2 (spec 13). Model: the current Sonnet; catalog slug today `anthropic/claude-sonnet-5`; verify with `deno task start models anthropic/claude-sonnet-5 --check` before any live cell.
- Images (ruling 1, appendix section 1): ONE campaign revision `2.1.282-r3`, built once after M9 and M10 code are merged. Proof builds before that are `2.1.282-r3-dev-<task id>` (revision `3-dev-<task id>`); probe configs may name them, no experiment may (enforced by `loadExperiment`, M9-16). Frozen tags are never reused or retagged; every build recipe first refuses an existing tag.
- Parser (ruling 2, appendix section 2): bumped once to `claude-code-trace@5` by whichever of M9-04 / M10-07 merges first (M11-03 is withdrawn); the other extends @5 without a bump. If M9-04 merges first it owns the pinning test; otherwise M9-04 leaves the version string alone.
- LSP component slug is `al` (M10). The plugin identity M9 allow-lists for it is `LSP_PLUGINS.al` (`name`, `source`, `path | null`; appendix section 4): M9-04 declares the type and provisional values, M10-06 sets the values from its S1 capture. M9-04 owns the exact installed set (including `lsp:<name>` tokens) and the single positive LSP check (appendix section 3).
- Ruling 8: every code task lists "H-01 merged" as a dependency and builds on master after that merge; nothing builds on the unmerged H-01 branch.
- Tests: `deno test --allow-all --ignore=tests/unit/container tests/unit/harness tests/unit/cli/commands/harness-command.test.ts > <scratch>/m9-tests.log 2>&1`, never `--parallel`, never the container suite while a bench is live. Grep the log; do not re-run to refilter. No assertion is weakened anywhere; a test that fails for a real reason is reported, not edited.
- After code changes: `deno check`, `deno lint`, `deno fmt` on the touched files only; then `graphify update .`.
- No em dash in any file this plan creates (repo rule; the bundle lint enforces it for bundles).
- Live cells (lane-ops) are developmental: they never enter a confirmatory result. `harness cell` in supervised mode needs a TTY; the owner runs it and lane-ops prepares and verifies.
- Never kill a process by image name; only a PID you started.

## Review Focus

1. A Claude Code version that silently ignores user-scope `~/.claude/rules/` or changes its built-ins: the arm would run without rules while the inventory says installed. Expected: per-cell evidence says "installed", loading is qualified once per Claude Code version, and an unqualified version refuses every inventoried cell. Pinned by the M9-04 test "unknown Claude Code version refuses" and the `component_evidence` assertion.
2. Something already in a scope Claude Code reads before the agent starts (`C:\.claude`, a nested `CLAUDE.md` in a task overlay, `~/.claude.json` from the image build, managed settings). Expected: refused naming the path. Pinned by the M9-02 scope tests and the M9-07/M9-17 live plain cells.
3. An agent whose frontmatter `name` differs from its file name, or a skill whose `name` differs from its folder. Expected: caught at lint time. Pinned by the M9-09 frontmatter test.
4. A staged component folder with no files. Expected: "staged but empty", never vacuously installed. Pinned by the M9-02 empty-component test.
5. A compacted run: Claude Code bills the compaction request but never streams it, so modelUsage exceeds the streamed messages. Expected: cost kept with the excess recorded and labelled `compaction_excess` (owner default) only for main-model input excess that is not a sub-agent's usage counted twice; cache excess, child-model excess and doubled child usage are `unreconciled`; a compacted run never counts as gate 3 evidence. Pinned by the M9-06 compaction fixture and adversarial tests.
6. A missing or malformed usage field, or a model on only one side, read as zero and reconciling. Expected: `unreconciled`, cost missing. Pinned by the M9-06 field and model-set tests.

---

## File map

| File | Lane | Task | Responsibility |
| --- | --- | --- | --- |
| `harness/images/claude-code/cg-inventory.ps1` (new) | infra2 | M9-02 | Pre-start inventory, one JSON line, exit 0/5 |
| `tests/unit/harness/inventory.test.ts` (new) | infra2 | M9-02 | Host-run positive/negative tests of the script |
| `harness/images/claude-code/run.ps1` | infra2 | M9-03 | Install rules + agents, pin subagent model, call inventory |
| `harness/images/claude-code/Dockerfile.windows` | infra2 | M9-03 | Ship + lock down `cg-inventory.ps1` |
| `tests/unit/harness/claude-code.test.ts` | infra2 | M9-03, M9-04 | run.ps1/Dockerfile static tests; adapter inventory tests |
| `src/harness/adapter.ts` | infra2 | M9-04 | `ParsedRun.inventoryProblems` |
| `src/harness/adapters/claude-code.ts` | infra2 | M9-04, M9-06 | Inventory, allow-list, model pin, usage reconciliation |
| `src/harness/execution.ts` | infra2 | M9-05 | Inventory problems make the execution `setup_failed` |
| `tests/unit/harness/execution.test.ts` | infra2 | M9-05 | End-to-end refusal and no-judging through `runCell` |
| `tests/unit/harness/subagent-cost.test.ts` (new) | infra2 | M9-06, M9-14 | Gate 3 fixtures |
| `src/harness/config.ts` | infra2 | M9-16 | `-dev-` revisions; experiments refuse them |
| `tests/unit/harness/config.test.ts` | infra2 | M9-16 | Dev revision tests |
| `harness/configs/cc-v2-*.yml` (new, 9) | infra2 | M9-08 | Four arms + five probe configs |
| `harness/experiments/cc-v2-factorial.yml` (new) | infra2 | M9-08 | 2x2 skeleton |
| `harness/bundles/probe-m9/**` (new) | infra2 | M9-08 | Probe-only bundles (hooks refusal, subagent load, budget overlap) |
| `tests/unit/harness/v2-configs.test.ts` (new) | infra2 | M9-08 | Arm and experiment invariants |
| `tests/unit/harness/realistic-bundle.test.ts` (new) | infra2 | M9-09, M9-12 | Layout, frontmatter, hygiene, leakage lint, LSP wording, imports, hash lock |
| `harness/bundles/realistic/instructions/**` (new) | content | M9-10 | CLAUDE.md v2 + 4 rules |
| `harness/bundles/realistic/skills/**`, `agents/**` (new) | content | M9-11 | 4 skills, 3 agents |
| `tests/fixtures/harness/claude-code/m9-*.jsonl` (new) | ops | M9-13 | Live gate 3 captures (redacted, published copies) |
| `H:\cg-coord\m9\*` | ops, orchestrator | M9-01, 07, 12, 13, 15, 17 | Spike, live proof, audit and gate evidence |

## Schedule

| Dates | Tasks |
| --- | --- |
| Oct 3-4 | M9-01 spike (ops); M9-02 inventory script, M9-09 lint test, M9-16 dev revisions (infra2); M9-10 draft (content) |
| Oct 5 | M9-03 (infra2); Oct 5-7 M9-11 (content) |
| Oct 6-7 | M9-04, then M9-05 (infra2) |
| Oct 7-9 | M9-06, M9-08 (infra2); M9-12 audit of v1 tasks and every M8 candidate authored so far (content + orchestrator) |
| Oct 9-10 | M9-07 dev image `r3-dev-M9-07` + live inventory proof (ops) |
| Oct 10-14 | M9-13 live gate 3 on the dev image (ops); M9-14 fixture pin (infra2) |
| Oct 15-17 | M9-15 evidence for what M9 closes alone; buffer |
| Oct 18-21 | M9-17: r3 built once (10-18, after M10-04..07 merged and M10-08 green), integrated gate 1 for all four arms, gate 3 re-run (ops; infra2 flips probe revisions) |
| Oct 21-24 | M9-12 audit of the start seal's candidates and bundle hash lock (before M8-15b on 10-25); later per seal (wave 4, replacements) |

---

### Task M9-01: Capability spike on the r2 image (rules, agents, subagent model, background switch, built-ins)

**Lane:** lane-ops. **Deps:** H-01 r2 image built. **May touch:** `H:\cg-coord\m9\spike-01\**` only (no repo files).

Proves or refutes the Claude Code 2.1.282 facts the design assumes, as ContainerUser, in a throwaway container (never a cell). Its findings file is the version's loading qualification that `BUILTIN_INVENTORY["2.1.282"].qualified` cites (review "installation versus loading").

- [ ] **Step 1: Prepare the probe folder** `H:\cg-coord\m9\spike-01\probe\`:

`CLAUDE.md`:
```
The first probe word is ALDER.
```
`rules\probe.md` (no frontmatter):
```
The second probe word is BIRCH.
```
`rules\scoped.md`:
```
---
paths:
  - "**/*.al"
---
The third probe word is CEDAR.
```
`agents\probe-child.md`:
```
---
name: probe-child
description: Answers the probe word. Use when asked for the child probe word.
model: inherit
---
Reply with the single word DAPHNE.
```
`import\CLAUDE.md` (for the import fallback, Run 5):
```
The first probe word is ALDER.
@rules/probe.md
```
`mcp.json`: `{"mcpServers":{}}`. `ws\Core\app.json`: `{}`. `ws\Core\src\A.Codeunit.al`: `codeunit 50100 A { }`.

`spike.ps1`:
```powershell
$ErrorActionPreference = 'Stop'
$h = $env:USERPROFILE
$out = 'C:\probe\out'
New-Item -ItemType Directory -Force $out | Out-Null
# What exists before claude ever ran in this container (inventory assumptions).
@{
  user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  home = @(Get-ChildItem -Force $h | ForEach-Object { $_.Name })
  claude_dir = Test-Path "$h\.claude"
  claude_json = Test-Path "$h\.claude.json"
  managed = Test-Path 'C:\Program Files\ClaudeCode'
  root_claude = @('C:\CLAUDE.md', 'C:\.claude', 'C:\AGENTS.md') | Where-Object { Test-Path $_ }
} | ConvertTo-Json | Set-Content "$out\before.json" -Encoding UTF8
New-Item -ItemType Directory -Force "$h\.claude\rules", "$h\.claude\agents" | Out-Null
Copy-Item C:\probe\CLAUDE.md "$h\.claude\CLAUDE.md"
Copy-Item C:\probe\rules\* "$h\.claude\rules\"
Copy-Item C:\probe\agents\* "$h\.claude\agents\"
$env:CLAUDE_CODE_OAUTH_TOKEN = (Get-Content 'C:\cg-secrets\claude-oauth-token' -Raw).Trim()
$env:CLAUDE_CODE_GIT_BASH_PATH = 'C:\Git\bin\bash.exe'
$env:DISABLE_TELEMETRY = '1'; $env:DISABLE_ERROR_REPORTING = '1'; $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$common = @('-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5', '--dangerously-skip-permissions', '--max-budget-usd', '0.5', '--mcp-config', 'C:\probe\mcp.json', '--strict-mcp-config')
Set-Location C:\probe\ws
# Run 1: rules and agents load at user scope.
'List every probe word your instructions and rules give you, without reading any file. Then run the probe-child agent once and report its word.' | & claude @common > "$out\run1.jsonl"
# Run 2: a path-scoped user rule loads only after a matching file is read.
'Read Core\src\A.Codeunit.al, then list every probe word your instructions and rules give you.' | & claude @common > "$out\run2.jsonl"
# Run 3: the subagent model pin applies to built-in agents too (Explore defaults to another model).
$env:CLAUDE_CODE_SUBAGENT_MODEL = '<a second catalog api id, for example claude-haiku-4-5>'
'Use the Explore agent once to list the files under this folder, then use the probe-child agent once.' | & claude @common > "$out\run3.jsonl"
Remove-Item Env:\CLAUDE_CODE_SUBAGENT_MODEL
# Run 4: the background-task switch (gate 3 fallback, M9-13).
$env:CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'
'Start the probe-child agent in the background, then report its word.' | & claude @common > "$out\run4.jsonl"
Remove-Item Env:\CLAUDE_CODE_DISABLE_BACKGROUND_TASKS
# Run 5: the import fallback, rules folder removed from the user scope.
Remove-Item "$h\.claude\rules" -Recurse
New-Item -ItemType Directory -Force "$h\.claude\rules" | Out-Null
Copy-Item C:\probe\import\CLAUDE.md "$h\.claude\CLAUDE.md" -Force
Copy-Item C:\probe\rules\probe.md "$h\.claude\rules\probe.md"
'List every probe word your instructions give you, without reading any file.' | & claude @common > "$out\run5.jsonl"
```

- [ ] **Step 2: Run it** in `centralgauge/harness-claude-code:2.1.282-r2` with `--user ContainerUser`, `C:\probe` mounted read-write and the OAuth token mounted read-only at `C:\cg-secrets` the way M7 probes mount it, under the egress route lane-ops used for the M7 probe runs (record which). Remove the container afterwards by the id you started.

- [ ] **Step 3: Record findings** in `H:\cg-coord\m9\spike-01\findings.md`, each with the log line that proves it:
  1. `before.json`: `.claude`, `.claude.json`, managed folder and `C:\CLAUDE.md` / `C:\.claude` / `C:\AGENTS.md` all absent.
  2. Run 1: answer contains ALDER and BIRCH; `system/init.agents` contains `probe-child`; the child replied DAPHNE.
  3. Run 2: CEDAR appears only after the `.al` read (yes/no; realistic rules carry no `paths` frontmatter either way).
  4. Run 3: every `tool_use_result.resolvedModel`, every assistant `message.model` and every `modelUsage` key equals the pinned id.
  5. Run 4: whether the Agent call ran in the foreground (no `isAsync`, usage in the tool result) or the background parameter was refused; this decides the M9-13 fallback.
  6. Run 5: ALDER and BIRCH via the import (fallback works).
  7. The exact `system/init` `agents`, `skills`, `plugins` (each `name`, `path`, `source`) and `tools` lists as ContainerUser; all four are lists (M9-04 refuses an init lacking any).
  8. `system/init.tools` has no `LSP` entry without an LSP plugin.

- [ ] **Step 4: Decision branches** (orchestrator records each ruling in `H:\cg-coord\decisions\`):
  - BIRCH missing in Run 1, present in Run 5: user-scope rules do not load; CLAUDE.md v2 uses one `@rules/<file>.md` import per rule (M9-10), and the M9-09 import test keeps imports inside the audited bundle.
  - BIRCH missing in both: escalate; no rules arm is possible on 2.1.282.
  - `probe-child` missing from init: user-scope agents do not load; stop M9-03 and escalate.
  - Run 3 shows another model: `CLAUDE_CODE_SUBAGENT_MODEL` is not honoured; M9-04's model check would refuse such cells; escalate (options: disallow built-in agents other than the bundle's, or a newer harness_version).
  - Built-in lists differ from the ContainerAdministrator fixture: M9-04 uses the ContainerUser lists.

### Task M9-02: `cg-inventory.ps1` with host-run positive and negative tests

**Lane:** lane-infra2. **Deps:** none. **May touch:** `harness/images/claude-code/cg-inventory.ps1`, `tests/unit/harness/inventory.test.ts`.

**Interfaces:**
- Produces: `C:\cg-inventory.ps1` (in the image, M9-03), parameters `-ConfigDir -HomeDir -Workspace -Ancestors -ManagedDir` (defaults are the container paths; run.ps1 passes none). Stdout: exactly one line `{"type":"cg_inventory","v":1,"ok":<bool>,"installed":[<sorted component names>],"problems":[<strings>]}`; `ok` is true exactly when `problems` is empty. Exit 0 when ok, 5 when refused. Problem strings (M9-04/05 and the tests match them):
  - `<name> is staged but this image cannot install it`
  - `<name> is staged but empty`
  - `instructions: <rel> is staged but not installable`
  - `<component>: <dest> is staged but not installed`
  - `<component>: <dest> differs from the staged copy`
  - `undeclared file in the user scope: .claude/<rel>`
  - `undeclared user config present: <path>`
  - `undeclared project-scope entry: <path>`
  - `managed Claude Code settings present: <path>`

LSP plugins are not installed under `~/.claude` (M10 loads them with `--plugin-dir` from the image), so M9-02 writes no LSP case; M10-06 adds the LSP preflight section to this script, which adds `lsp:<name>` to `installed` when the declared LSP's preflight passes (appendix section 3). The declared-plugin allow-list and the positive LSP check live in the adapter (M9-04).

- [ ] **Step 1: Write the failing tests** `tests/unit/harness/inventory.test.ts`:

```typescript
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { tempDir } from "./temp-dirs.ts";

/**
 * Spec v2 section 4 / gate 1: the pre-start component inventory, run with
 * Windows PowerShell 5.1 (the image's shell) against a temp sandbox layout.
 */
const SCRIPT = fromFileUrl(
  new URL("../../../harness/images/claude-code/cg-inventory.ps1", import.meta.url),
);
const NOT_WINDOWS = Deno.build.os !== "windows";

/** Path relative to the sandbox root -> file content, or null for an empty folder. */
type Layout = Record<string, string | null>;
interface Inventory {
  type: string;
  v: number;
  ok: boolean;
  installed: string[];
  problems: string[];
}

/** A fully installed realistic arm: every staged file has its installed copy. */
const FULL: Layout = {
  "config/bundle/instructions/CLAUDE.md": "team\n",
  "config/bundle/instructions/rules/al.md": "rule\n",
  "config/bundle/skills/al-compile/SKILL.md": "skill\n",
  "config/bundle/agents/al-reviewer.md": "agent\n",
  "home/.claude/CLAUDE.md": "team\n",
  "home/.claude/rules/al.md": "rule\n",
  "home/.claude/skills/al-compile/SKILL.md": "skill\n",
  "home/.claude/agents/al-reviewer.md": "agent\n",
  "ws/Core/app.json": "{}",
};

async function inventory(layout: Layout): Promise<{ code: number; rec: Inventory; root: string }> {
  const root = await Deno.realPath(await tempDir({ prefix: "cg-inv-" }));
  for (const d of ["config", "home", "ws"]) {
    await Deno.mkdir(join(root, d), { recursive: true });
  }
  for (const [p, text] of Object.entries(layout)) {
    const f = join(root, ...p.split("/"));
    if (text === null) {
      await Deno.mkdir(f, { recursive: true });
      continue;
    }
    await Deno.mkdir(dirname(f), { recursive: true });
    await Deno.writeTextFile(f, text);
  }
  const out = await new Deno.Command("powershell", {
    args: [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
      "-ConfigDir", join(root, "config"),
      "-HomeDir", join(root, "home"),
      "-Workspace", join(root, "ws"),
      "-Ancestors", root,
      "-ManagedDir", join(root, "managed"),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).split(/\r?\n/).filter(Boolean);
  assertEquals(
    lines.length,
    1,
    `exactly one JSON line; stdout ${lines.join(" | ")}; stderr ${new TextDecoder().decode(out.stderr)}`,
  );
  return { code: out.code, rec: JSON.parse(lines[0]!) as Inventory, root };
}

const without = (l: Layout, ...keys: string[]): Layout =>
  Object.fromEntries(Object.entries(l).filter(([k]) => !keys.includes(k)));

const refused = (r: { code: number; rec: Inventory }, want: string) => {
  assertEquals([r.code, r.rec.ok], [5, false], JSON.stringify(r.rec));
  assert(
    r.rec.problems.some((p) => p.includes(want)),
    `a problem containing ${JSON.stringify(want)}: ${JSON.stringify(r.rec.problems)}`,
  );
};

Deno.test({
  name: "cg-inventory: a fully installed arm is ok and lists every component",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory(FULL);
    assertEquals(r.code, 0);
    assertEquals(r.rec, {
      type: "cg_inventory",
      v: 1,
      ok: true,
      installed: ["agents", "instructions", "skills"],
      problems: [],
    });
  },
});

Deno.test({
  name: "cg-inventory: an arm with no bundle and an empty user scope is ok with nothing installed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory({ "ws/Core/app.json": "{}" });
    assertEquals([r.code, r.rec.ok, r.rec.installed, r.rec.problems], [0, true, [], []]);
  },
});

// Positive half per component is the FULL case; negative halves below.
const PER_COMPONENT: [string, string][] = [
  ["instructions", "CLAUDE.md"],
  ["instructions", "rules/al.md"],
  ["skills", "skills/al-compile/SKILL.md"],
  ["agents", "agents/al-reviewer.md"],
];
const stagedKey = (comp: string, dest: string) =>
  `config/bundle/${comp}/${comp === "instructions" ? dest : dest.slice(comp.length + 1)}`;

Deno.test({
  name: "cg-inventory: a staged-but-absent component is refused and not listed as installed",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      const r = await inventory(without(FULL, `home/.claude/${dest}`));
      refused(r, `${comp}: ${dest} is staged but not installed`);
      assert(!r.rec.installed.includes(comp), `${comp} not installed`);
    }
  },
});

Deno.test({
  name: "cg-inventory: an installed-but-undeclared file is refused, per component and for hooks settings",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      refused(
        await inventory(without(FULL, stagedKey(comp, dest))),
        `undeclared file in the user scope: .claude/${dest}`,
      );
    }
    refused(
      await inventory({ ...FULL, "home/.claude/settings.json": "{\"hooks\":{}}" }),
      "undeclared file in the user scope: .claude/settings.json",
    );
  },
});

Deno.test({
  name: "cg-inventory: an installed copy that differs from the staged one is refused",
  ignore: NOT_WINDOWS,
  async fn() {
    for (const [comp, dest] of PER_COMPONENT) {
      refused(
        await inventory({ ...FULL, [`home/.claude/${dest}`]: "tampered\n" }),
        `${comp}: ${dest} differs from the staged copy`,
      );
    }
  },
});

Deno.test({
  name: "cg-inventory: hooks and plugins have no installer, an unknown instructions file is not installable, an empty component is refused",
  ignore: NOT_WINDOWS,
  async fn() {
    refused(
      await inventory({ ...FULL, "config/bundle/hooks/settings.json": "{}" }),
      "hooks is staged but this image cannot install it",
    );
    refused(
      await inventory({ ...FULL, "config/bundle/plugins/0/plugin.json": "{}" }),
      "plugins is staged but this image cannot install it",
    );
    refused(
      await inventory({ ...FULL, "config/bundle/instructions/notes.txt": "x" }),
      "instructions: notes.txt is staged but not installable",
    );
    const empty = await inventory({
      ...without(FULL, "config/bundle/agents/al-reviewer.md", "home/.claude/agents/al-reviewer.md"),
      "config/bundle/agents": null,
    });
    refused(empty, "agents is staged but empty");
    assert(!empty.rec.installed.includes("agents"));
  },
});

Deno.test({
  name: "cg-inventory: project, nested, ancestor, user-config and managed scopes must be empty",
  ignore: NOT_WINDOWS,
  async fn() {
    for (
      const p of [
        "ws/CLAUDE.md",
        "ws/CLAUDE.local.md",
        "ws/AGENTS.md",
        "ws/.mcp.json",
        "ws/.claude/rules/x.md",
        "ws/Core/src/CLAUDE.md",
        "CLAUDE.md",
        ".claude/agents/x.md",
      ]
    ) {
      const r = await inventory({ ...FULL, [p]: "x" });
      refused(r, "undeclared project-scope entry");
      assertStringIncludes(r.rec.problems.join("\n"), p.split("/").at(-1)! === "x.md" ? ".claude" : p.split("/").at(-1)!);
    }
    refused(await inventory({ ...FULL, "home/.claude.json": "{}" }), "undeclared user config present");
    refused(
      await inventory({ ...FULL, "managed/managed-settings.json": "{}" }),
      "managed Claude Code settings present",
    );
  },
});

Deno.test({
  name: "cg-inventory: an AGENTS.md parity copy is staged but never installed",
  ignore: NOT_WINDOWS,
  async fn() {
    const r = await inventory({ ...FULL, "config/bundle/instructions/AGENTS.md": "team\n" });
    assertEquals([r.code, r.rec.ok], [0, true]);
  },
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/inventory.test.ts`
Expected: FAIL (`-File` names a missing script; "exactly one JSON line" assertion).

- [ ] **Step 3: Write the script** `harness/images/claude-code/cg-inventory.ps1`:

```powershell
# Component inventory (Harness v2 spec section 4, feasibility gate 1). run.ps1 calls it after
# the bundle copies, before any credential is read and before claude starts. It proves every
# staged component (C:\config\bundle, hashed by the runner in writeConfigDir) is installed byte
# for byte under ~/.claude, and that nothing undeclared sits in a scope Claude Code reads: the
# user scope, the workspace (recursively), its ancestors, the managed-settings folder.
# One JSON line on stdout:
#   {"type":"cg_inventory","v":1,"ok":true|false,"installed":[...],"problems":[...]}
# Exit 0 when ok, 5 when refused. The parameters exist for the host tests; run.ps1 passes none.
# Windows PowerShell 5.1.
param(
  [string]$ConfigDir = 'C:\config',
  [string]$HomeDir = $env:USERPROFILE,
  [string]$Workspace = 'C:\workspace',
  [string]$Ancestors = 'C:\',
  [string]$ManagedDir = 'C:\Program Files\ClaudeCode'
)
$ErrorActionPreference = 'Stop'
$problems = New-Object System.Collections.Generic.List[string]

# Every file under $root (hidden ones too): relative path with forward slashes -> SHA256.
function Get-Tree([string]$root) {
  $tree = @{}
  if (-not (Test-Path -LiteralPath $root)) { return $tree }
  $base = (Get-Item -LiteralPath $root -Force).FullName.TrimEnd('\') + '\'
  foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
    $tree[$f.FullName.Substring($base.Length).Replace('\', '/')] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash
  }
  return $tree
}

# Expected user-scope tree: destination (relative to ~/.claude) -> hash, and its component.
$bundle = Join-Path $ConfigDir 'bundle'
$want = @{}
$owner = @{}
$staged = @()
if (Test-Path -LiteralPath $bundle) {
  $staged = @(Get-ChildItem -LiteralPath $bundle -Force | ForEach-Object { $_.Name } | Sort-Object)
}
foreach ($name in $staged) {
  if (@('instructions', 'skills', 'agents') -cnotcontains $name) {
    $problems.Add("$name is staged but this image cannot install it")
    continue
  }
  $tree = Get-Tree (Join-Path $bundle $name)
  if ($tree.Count -eq 0) { $problems.Add("$name is staged but empty"); continue }
  foreach ($k in @($tree.Keys | Sort-Object)) {
    $dest = $null
    if ($name -cne 'instructions') { $dest = "$name/$k" }
    elseif ($k -ceq 'CLAUDE.md' -or $k.StartsWith('rules/')) { $dest = $k }
    elseif ($k -cne 'AGENTS.md') { $problems.Add("instructions: $k is staged but not installable") }
    if ($null -ne $dest) { $want[$dest] = $tree[$k]; $owner[$dest] = $name }
  }
}

# Positive and negative at user scope in one comparison.
$have = Get-Tree (Join-Path $HomeDir '.claude')
$broken = @{}
foreach ($k in @($want.Keys | Sort-Object)) {
  if (-not $have.ContainsKey($k)) {
    $problems.Add("$($owner[$k]): $k is staged but not installed"); $broken[$owner[$k]] = $true
  } elseif ($have[$k] -ne $want[$k]) {
    $problems.Add("$($owner[$k]): $k differs from the staged copy"); $broken[$owner[$k]] = $true
  }
}
foreach ($k in @($have.Keys | Sort-Object)) {
  if (-not $want.ContainsKey($k)) { $problems.Add("undeclared file in the user scope: .claude/$k") }
}
$userConfig = Join-Path $HomeDir '.claude.json'
if (Test-Path -LiteralPath $userConfig) { $problems.Add("undeclared user config present: $userConfig") }

# Project scope: the workspace recursively (nested memory loads lazily), its ancestors directly.
$scoped = @('CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude', '.mcp.json')
foreach ($e in @(Get-ChildItem -LiteralPath $Workspace -Recurse -Force | Where-Object { $scoped -contains $_.Name })) {
  $problems.Add("undeclared project-scope entry: $($e.FullName)")
}
foreach ($dir in @($Ancestors.Split(';') | Where-Object { $_ })) {
  foreach ($n in $scoped) {
    $p = Join-Path $dir $n
    if (Test-Path -LiteralPath $p) { $problems.Add("undeclared project-scope entry: $p") }
  }
}
if (Test-Path -LiteralPath $ManagedDir) { $problems.Add("managed Claude Code settings present: $ManagedDir") }

$installed = @($owner.Values | Sort-Object -Unique | Where-Object { -not $broken.ContainsKey($_) })
$ok = $problems.Count -eq 0
$rec = [ordered]@{ type = 'cg_inventory'; v = 1; ok = $ok; installed = $installed; problems = @($problems) }
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $rec -Compress -Depth 3))
if ($ok) { exit 0 }
exit 5
```

Note: the ancestor case in the test passes the sandbox root, which holds `CLAUDE.md` / `.claude` written by the test; the `.claude/agents/x.md` case is reported as the `.claude` entry.

- [ ] **Step 4: Run to verify they pass**

Run: `deno test --allow-all tests/unit/harness/inventory.test.ts`
Expected: PASS (all 8). If PowerShell 5.1 serialises a one-element `installed` as a bare string, wrap with `@(...)` at the `[ordered]` site, never loosen the test.

- [ ] **Step 5: Lint, format, commit**

```bash
deno check tests/unit/harness/inventory.test.ts && deno lint tests/unit/harness/inventory.test.ts && deno fmt tests/unit/harness/inventory.test.ts
git add harness/images/claude-code/cg-inventory.ps1 tests/unit/harness/inventory.test.ts
git commit -m "feat(harness): cg-inventory.ps1 proves staged components installed and undeclared scopes empty (M9-02)"
```

### Task M9-03: run.ps1 installs rules and agents, pins the subagent model, runs the inventory

**Lane:** lane-infra2. **Deps:** M9-02, H-01 merged, M9-01 findings 2 and 4 positive (or the decision branch applied). **May touch:** `harness/images/claude-code/run.ps1`, `harness/images/claude-code/Dockerfile.windows`, `tests/unit/harness/claude-code.test.ts`.

M10 also edits run.ps1 (ruling 3): its LSP preflight goes after the MCP block and before the ready wait, its refusal also exits 5. Whoever merges second rebases; the M9 static test below keeps holding.

**Interfaces:**
- Consumes: `C:\cg-inventory.ps1` (M9-02), exit 5 contract.
- Produces: stdout whose first line is one `cg_inventory` record (M9-04 parses it); run.ps1 exit 5 on a refused inventory; any earlier run.ps1 throw (bad bundle shape) exits non-zero with no record (M9-04 turns that into "no cg_inventory record"); `CLAUDE_CODE_SUBAGENT_MODEL` set from `settings.api_models.main`.

- [ ] **Step 1: Write the failing static tests** (append to `tests/unit/harness/claude-code.test.ts`):

```typescript
Deno.test("run.ps1 (M9): rules and agents install at user scope, the inventory runs before ready, sub-agents pinned to the main model", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );
  const at = (s: string) => {
    const i = code.findIndex((l) => l.includes(s));
    assert(i >= 0, `run.ps1 lacks: ${s}`);
    return i;
  };
  const rules = at(
    `Copy-Item -LiteralPath "$dir\\rules" -Destination "$userHome\\.claude\\rules" -Recurse -Force`,
  );
  const agents = at(
    `Copy-Item 'C:\\config\\bundle\\agents' "$userHome\\.claude\\agents" -Recurse -Force`,
  );
  const inv = at("& 'C:\\cg-inventory.ps1'");
  assertEquals(code[inv + 1], "if ($LASTEXITCODE -ne 0) { exit 5 }");
  const ready = at("while (-not (Test-Path 'C:\\cg-secrets\\ready'))");
  const token = at("$env:CLAUDE_CODE_OAUTH_TOKEN =");
  assert(
    rules < inv && agents < inv && inv < ready && ready < token,
    "copies, then the inventory, then any credential",
  );
  const pin = at(
    "$env:CLAUDE_CODE_SUBAGENT_MODEL = $cfg.settings.api_models.main",
  );
  assert(pin < at("$prompt | & claude @claudeArgs"));
  assertStringIncludes(run, "instructions bundle holds unexpected folders");
});

Deno.test("claude-code Dockerfile (M9): ships cg-inventory.ps1 read-only for the agent user", async () => {
  const df = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  assert(/^COPY cg-inventory\.ps1 C:\/cg-inventory\.ps1\s*$/m.test(df), df);
  const lock = df.split(/\r?\n/).find((l) => l.includes("cg-lockdown.ps1"))!;
  assertStringIncludes(lock, "C:\\cg-inventory.ps1");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts --filter "M9"`
Expected: FAIL (`run.ps1 lacks: Copy-Item -LiteralPath "$dir\rules" ...`).

- [ ] **Step 3: Edit run.ps1** (H-01 version on master). Replace the block from `if (Test-Path 'C:\config\bundle\instructions') {` through the skills copy with:

```powershell
if (Test-Path 'C:\config\bundle\instructions') {
  $dir = 'C:\config\bundle\instructions'
  $names = @(Get-ChildItem $dir -File | ForEach-Object { $_.Name })
  $extra = @($names | Where-Object { $_ -notin @('AGENTS.md', 'CLAUDE.md') })
  if ($extra.Count -gt 0) { throw "instructions bundle holds unexpected files: $($extra -join ', ')" }
  # M9: scoped rules travel in the instructions component as rules\*.md; nothing else nests.
  $folders = @(Get-ChildItem $dir -Directory | Where-Object { $_.Name -cne 'rules' } | ForEach-Object { $_.Name })
  if ($folders.Count -gt 0) { throw "instructions bundle holds unexpected folders: $($folders -join ', ')" }
  if ($names -notcontains 'CLAUDE.md') { throw 'Claude Code instructions bundle must hold CLAUDE.md' }
  if (($names -contains 'AGENTS.md') -and ((Get-FileHash "$dir\AGENTS.md").Hash -ne (Get-FileHash "$dir\CLAUDE.md").Hash)) {
    throw 'AGENTS.md and CLAUDE.md differ: the parity rule needs byte-identical files'
  }
  Copy-Item -LiteralPath "$dir\CLAUDE.md" -Destination "$userHome\.claude\CLAUDE.md" -Force
  if (Test-Path "$dir\rules") {
    Copy-Item -LiteralPath "$dir\rules" -Destination "$userHome\.claude\rules" -Recurse -Force
  }
}
if (Test-Path 'C:\config\bundle\skills') {
  Copy-Item 'C:\config\bundle\skills' "$userHome\.claude\skills" -Recurse -Force
}
# M9: subagents install at user scope.
if (Test-Path 'C:\config\bundle\agents') {
  Copy-Item 'C:\config\bundle\agents' "$userHome\.claude\agents" -Recurse -Force
}
# Spec v2 gate 1: prove the components before any credential is read or claude starts. Hooks
# and plugins have no installer in this image, so a staged one is refused here (exit 5).
& 'C:\cg-inventory.ps1'
if ($LASTEXITCODE -ne 0) { exit 5 }
```

and directly after `$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'` add:

```powershell
# Spec v2 gate 3: every subagent, built-in or bundled, runs on the arm's main model.
$env:CLAUDE_CODE_SUBAGENT_MODEL = $cfg.settings.api_models.main
```

- [ ] **Step 4: Edit Dockerfile.windows**: header comment `Built by harness images build claude-code --version 2.1.282 --revision 3 (proofs: --revision 3-dev-<task id>)`; after `COPY run.ps1 C:/run.ps1` add `COPY cg-inventory.ps1 C:/cg-inventory.ps1`; the lockdown line becomes `RUN powershell -NoProfile -ExecutionPolicy Bypass -File C:\cg-lockdown.ps1 C:\cg-npm C:\run.ps1 C:\cg-inventory.ps1; \`.

- [ ] **Step 5: Run the claude-code, nonadmin and egress suites**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts tests/unit/harness/nonadmin.test.ts tests/unit/harness/egress.test.ts`
Expected: PASS, including every earlier run.ps1 test unchanged (strict MCP, UTF-8 reads, token by file, H-01 guard first).

- [ ] **Step 6: Commit**

```bash
git add harness/images/claude-code/run.ps1 harness/images/claude-code/Dockerfile.windows tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): run.ps1 installs rules and agents, pins the subagent model, runs the inventory (M9-03)"
```

### Task M9-04: claude-code adapter: fail-closed inventory with a declared-component allow-list

**Lane:** lane-infra2. **Deps:** M9-03, M9-16, H-01 merged, M9-01 finding 7. **May touch:** `src/harness/adapter.ts`, `src/harness/adapters/claude-code.ts`, `tests/unit/harness/claude-code.test.ts`.

**Interfaces:**
- Consumes: the `cg_inventory` line (M9-02 shape); `manifest.image.revision` (H-01; `3` or `3-dev-<id>` after M9-16); `manifest.lsp[].name` (M10 slug `al`).
- Produces (M10 and M11 build on these names):
  - `ParsedRun.inventoryProblems?: string[]` (M9-05).
  - `export const INVENTORY_REVISION = 3`; `export function inventoried(revision: string | undefined): boolean`.
  - `export const BUILTIN_INVENTORY` (per Claude Code version: `agents`, `skills`, `plugins`, `qualified`).
  - `export const LSP_PLUGINS: Readonly<Record<string, { name: string; source: string; path: string | null }>>` and `pluginIs(p, id)`: the plugin identity each declared LSP component may show in `system/init.plugins` (the allow-list hook of ruling 3; appendix section 4). M9-04 ships provisional values; M10-06 sets them from the S1 capture and adds the preflight to `cg-inventory.ps1`, never a second inventory or a second positive check.
  - Loaded tokens: `instructions`, `skills`, `agents`, `lsp:<name>`; `raw_usage.component_inventory: string[]`; `raw_usage.component_evidence: Record<string, string>`.
  - Parser `claude-code-trace@5` only if M9-04 is the first of M9-04/M10-07 to merge (ruling 2; M11-03 is withdrawn).

Fail-closed rules (review finding 2; appendix section 3): exactly one record, before `system/init`; strict shape; `ok` must equal "no problems"; on `ok`, `installed` must equal exactly the declared installable components (`agents`, `instructions`, `skills` whose manifest entry is non-null) plus `lsp:<name>` for each declared LSP component; `lsp:<name>` is loaded only when it is installed (preflight passed), its plugin identity is in `system/init.plugins` and the `LSP` tool is listed, otherwise the problem `lsp:<name> not loaded (preflight <passed|missing>, plugin <present|absent>, LSP tool <present|absent>)`; `system/init` must carry `agents`, `skills`, `plugins`, `tools` as lists of the right element type; every model seen anywhere (assistant `message.model`, sub-agent `resolvedModel`, `modelUsage` keys) must equal `settings.native.api_models.main`. A duplicate or malformed record is an inventory problem, never a thrown parse error, so it reaches `setup_failed` (finding 6).

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/claude-code.test.ts`; `parse` is the file's existing helper, `observedMismatch` is already imported; add `BUILTIN_INVENTORY`, `LSP_PLUGINS` to the import from `claude-code.ts`):

```typescript
// Spec v2 gate 1 (M9-04): inventoried arms (image revision 3 or 3-dev-*).
const H64 = "a".repeat(64);
const comp = (path: string, files: string[]) => ({
  path,
  hash: H64,
  files: files.map((p) => ({ path: p, sha256: H64 })),
});
const V2 = (over: Record<string, unknown> = {}) => ({
  image: { digest: "sha256:img", base_digest: "sha256:base", revision: "3" },
  settings: {
    requested: {},
    native: { api_models: { main: "claude-sonnet-5" } },
  },
  instructions: comp("bundles/realistic/instructions", [
    "CLAUDE.md",
    "rules/al.md",
  ]),
  skills: comp("bundles/realistic/skills", ["al-compile/SKILL.md"]),
  agents: comp("bundles/realistic/agents", ["al-reviewer.md"]),
  ...over,
});
const B = BUILTIN_INVENTORY["2.1.282"]!;
const BUILTIN_PLUGINS = B.plugins.map((s) => ({
  name: s.split("@")[0],
  path: "builtin",
  source: s,
}));
const invLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "cg_inventory",
    v: 1,
    ok: true,
    installed: ["agents", "instructions", "skills"],
    problems: [],
    ...over,
  });
const v2Init = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "s1",
    claude_code_version: "2.1.282",
    tools: ["Agent", "Bash", "Read"],
    mcp_servers: [],
    agents: [...B.agents, "al-reviewer"],
    skills: [...B.skills, "al-compile"],
    plugins: BUILTIN_PLUGINS,
    ...over,
  });
const v2Msg = (model: string) =>
  JSON.stringify({
    type: "assistant",
    session_id: "s1",
    message: { id: `m-${model}`, model, content: [{ type: "text", text: "x" }], usage: {} },
  });
const v2Child = (model: string) =>
  JSON.stringify({
    type: "user",
    session_id: "s1",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_X", content: "done" }] },
    tool_use_result: { model: null, resolvedModel: model, usage: { input_tokens: 1 } },
  });
const v2Result = (models: string[] = ["claude-sonnet-5"]) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "s1",
    num_turns: 1,
    duration_ms: 5,
    total_cost_usd: 0.001,
    stop_reason: "end_turn",
    usage: {},
    modelUsage: Object.fromEntries(models.map((m) => [m, {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    }])),
  });
const v2 = async (lines: string[], over: Record<string, unknown> = {}) =>
  (await parse(lines.join("\n"), 0, V2(over))).r;
const problemsOf = async (lines: string[], over: Record<string, unknown> = {}) =>
  (await v2(lines, over)).inventoryProblems!.join("\n");

Deno.test("inventory (M9-04): a proven arm loads instructions, skills and agents; evidence separates installed from loaded", async () => {
  const r = await v2([invLine(), v2Init(), v2Result()]);
  assertEquals(r.inventoryProblems, []);
  assertEquals([...r.observed.loaded_components!].sort(), [
    "agents",
    "instructions",
    "skills",
  ]);
  assertEquals(r.unobservable, []);
  assertEquals(
    observedMismatch(manifest("cc", V2()), r.observed, r.unobservable).mismatch,
    null,
  );
  const evidence = (r.telemetry.raw_usage as { component_evidence: Record<string, string> })
    .component_evidence;
  assertStringIncludes(evidence["instructions"]!, "installed (cg_inventory)");
  assertStringIncludes(evidence["instructions"]!, B.qualified);
  assertStringIncludes(evidence["agents"]!, "listed by system/init");
});

Deno.test("inventory (M9-04): record count, order, shape and ok/problems consistency are enforced", async () => {
  const cases: [string[], string][] = [
    [[v2Init(), v2Result()], "no cg_inventory record"],
    [[invLine(), invLine(), v2Init(), v2Result()], "2 cg_inventory records"],
    [[v2Init(), invLine(), v2Result()], "after system/init"],
    [[invLine({ extra: 1 }), v2Init(), v2Result()], "not of the recorded shape"],
    [[invLine({ installed: "agents" }), v2Init(), v2Result()], "not of the recorded shape"],
    [[invLine({ ok: false, problems: [] }), v2Init(), v2Result()], "contradicts"],
    [[invLine({ ok: true, problems: ["x"] }), v2Init(), v2Result()], "contradicts"],
    [
      [invLine({ ok: false, installed: ["skills"], problems: ["agents: agents/al-reviewer.md is staged but not installed"] }), v2Init(), v2Result()],
      "staged but not installed",
    ],
  ];
  for (const [lines, want] of cases) {
    assertStringIncludes(await problemsOf(lines), want);
  }
});

Deno.test("inventory (M9-04): installed must equal the declared installable components exactly", async () => {
  assertStringIncludes(
    await problemsOf([invLine({ installed: ["agents", "instructions"] }), v2Init(), v2Result()]),
    "but the arm declares [agents, instructions, skills]",
  );
  assertStringIncludes(
    await problemsOf([invLine({ installed: ["agents", "hooks", "instructions", "skills"] }), v2Init(), v2Result()]),
    "but the arm declares",
  );
  // A plain arm (instructions only) must not report skills or agents installed.
  assertStringIncludes(
    await problemsOf([invLine(), v2Init({ agents: [...B.agents], skills: [...B.skills] }), v2Result()], {
      skills: null,
      agents: null,
    }),
    "but the arm declares [instructions]",
  );
});

Deno.test("inventory (M9-04): system/init must carry agents, skills, plugins and tools as lists", async () => {
  for (const k of ["agents", "skills", "plugins", "tools"]) {
    assertStringIncludes(await problemsOf([invLine(), v2Init({ [k]: undefined }), v2Result()]), k);
    assertStringIncludes(await problemsOf([invLine(), v2Init({ [k]: "x" }), v2Result()]), k);
  }
  assertStringIncludes(await problemsOf([invLine(), v2Init({ agents: [1] }), v2Result()]), "agents");
});

Deno.test("inventory (M9-04): unrequested agents, skills, plugins and the LSP tool are refused", async () => {
  const cases: [string[], string][] = [
    [[invLine(), v2Init({ agents: [...B.agents, "al-reviewer", "rogue"] }), v2Result()], "unrequested agent loaded: rogue"],
    [[invLine(), v2Init({ skills: [...B.skills, "al-compile", "rogue"] }), v2Result()], "unrequested skill loaded: rogue"],
    [[invLine(), v2Init({ plugins: [...BUILTIN_PLUGINS, { name: "x", path: "C:\\x", source: "x@market" }] }), v2Result()], "unrequested plugin loaded: x@market"],
    [[invLine(), v2Init({ plugins: [...BUILTIN_PLUGINS, { name: LSP_PLUGINS.al!.name, path: LSP_PLUGINS.al!.path, source: LSP_PLUGINS.al!.source }] }), v2Result()], "unrequested plugin loaded"],
    [[invLine(), v2Init({ tools: ["Agent", "LSP"] }), v2Result()], "unrequested LSP tool loaded"],
  ];
  for (const [lines, want] of cases) {
    assertStringIncludes(await problemsOf(lines), want);
  }
});

Deno.test("inventory (M9-04): a declared LSP loads lsp:al only with preflight, plugin and tool; installed must include lsp:al", async () => {
  const lspArm = {
    lsp: [{ name: "al", version: "al-lsp@1", tool_schema_hash: H64 }],
  };
  const plugin = { name: LSP_PLUGINS.al!.name, path: LSP_PLUGINS.al!.path, source: LSP_PLUGINS.al!.source };
  const installed = ["agents", "instructions", "lsp:al", "skills"];
  const ok = await v2(
    [invLine({ installed }), v2Init({ plugins: [...BUILTIN_PLUGINS, plugin], tools: ["Agent", "LSP"] }), v2Result()],
    lspArm,
  );
  assertEquals(ok.inventoryProblems, []);
  assert(ok.observed.loaded_components!.includes("lsp:al"));
  // No preflight (installed lacks lsp:al): the exact set and the positive check both refuse.
  const noPreflight = await problemsOf(
    [invLine(), v2Init({ plugins: [...BUILTIN_PLUGINS, plugin], tools: ["Agent", "LSP"] }), v2Result()],
    lspArm,
  );
  assertStringIncludes(noPreflight, "but the arm declares [agents, instructions, lsp:al, skills]");
  assertStringIncludes(noPreflight, "lsp:al not loaded (preflight missing, plugin present, LSP tool present)");
  // Preflight passed but neither plugin nor tool in init.
  const missing = await v2([invLine({ installed }), v2Init(), v2Result()], lspArm);
  assert(!missing.observed.loaded_components!.includes("lsp:al"));
  assertStringIncludes(
    missing.inventoryProblems!.join("\n"),
    "lsp:al not loaded (preflight passed, plugin absent, LSP tool absent)",
  );
  assertStringIncludes(
    observedMismatch(manifest("cc", V2(lspArm)), missing.observed, missing.unobservable).mismatch!,
    "lsp:al",
  );
  // A plugin at another path or with another source is not the declared plugin.
  for (const other of [{ ...plugin, path: "C:\\elsewhere" }, { ...plugin, source: "x@market" }]) {
    assertStringIncludes(
      await problemsOf(
        [invLine({ installed }), v2Init({ plugins: [...BUILTIN_PLUGINS, other], tools: ["Agent", "LSP"] }), v2Result()],
        lspArm,
      ),
      "unrequested plugin loaded",
    );
  }
});

Deno.test("inventory (M9-04): every model seen must be api_models.main (assistant, sub-agent, modelUsage)", async () => {
  const want = "model claude-haiku-9 ran; the arm pins claude-sonnet-5";
  assertStringIncludes(await problemsOf([invLine(), v2Init(), v2Result(["claude-sonnet-5", "claude-haiku-9"])]), want);
  assertStringIncludes(await problemsOf([invLine(), v2Init(), v2Msg("claude-haiku-9"), v2Result()]), want);
  assertStringIncludes(await problemsOf([invLine(), v2Init(), v2Child("claude-haiku-9"), v2Result()]), want);
  assertStringIncludes(
    await problemsOf([invLine(), v2Init(), v2Result()], {
      settings: { requested: {}, native: { api_models: { judge: "claude-sonnet-5" } } },
    }),
    "api_models.main missing",
  );
});

Deno.test("inventory (M9-04): a requested agent missing from init is a mismatch, not unverified", async () => {
  const r = await v2([invLine(), v2Init({ agents: [...B.agents] }), v2Result()]);
  assert(!r.observed.loaded_components!.includes("agents"));
  assertStringIncludes(
    observedMismatch(manifest("cc", V2()), r.observed, r.unobservable).mismatch!,
    "agents",
  );
});

Deno.test("inventory (M9-04): unknown Claude Code version refuses (loading must be qualified first)", async () => {
  assertStringIncludes(
    await problemsOf([invLine(), v2Init({ claude_code_version: "2.1.999" }), v2Result()]),
    "no qualified built-in inventory for Claude Code 2.1.999",
  );
});

Deno.test("inventory (M9-04): a dev proof revision is inventoried; a frozen image keeps the M2 rules", async () => {
  const dev = await v2([v2Init(), v2Result()], {
    image: { digest: "sha256:img", base_digest: "sha256:base", revision: "3-dev-M9-07" },
  });
  assertStringIncludes(dev.inventoryProblems!.join("\n"), "no cg_inventory record");
  const frozen = await v2([v2Init(), v2Result()], {
    image: { digest: "sha256:img", base_digest: "sha256:base" },
  });
  assertEquals(frozen.inventoryProblems, []);
  assertEquals([...frozen.unobservable].sort(), ["agents", "instructions"]);
});
```

If M9-04 merges first of the three parser changes (ruling 2), also change the existing capabilities test assertion from `"claude-code-trace@4"` to `"claude-code-trace@5"`; otherwise leave it.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts --filter "inventory (M9-04)"`
Expected: FAIL (`BUILTIN_INVENTORY` not exported).

- [ ] **Step 3: Implement.** In `src/harness/adapter.ts`, add to `ParsedRun`:

```typescript
  /**
   * Component inventory problems (spec v2 section 4, gate 1); any one refuses
   * the execution as setup_failed. Absent when the adapter has no inventory.
   */
  inventoryProblems?: string[];
```

In `src/harness/adapters/claude-code.ts`:

1. `KNOWN_TYPES`: add `"cg_inventory", // M9: run.ps1's pre-start component inventory, one line before init.`
2. Parser (ruling 2): if this is the first of the three to merge, `parser: "claude-code-trace@5"`.
3. Add after `mcpInventory`:

```typescript
/** First claude-code image revision whose run.ps1 emits cg_inventory (M9). */
export const INVENTORY_REVISION = 3;

/**
 * Whether an image revision runs the inventory: 3 and later, including the
 * proof builds `3-dev-<task id>` (cross-plan ruling 1). Frozen images (no
 * revision, or 2) keep the M2 rules.
 */
export function inventoried(revision: string | undefined): boolean {
  // ponytail: H-01 revisions are ordered integers; a forked revision line would
  // need an explicit inventory label instead of this comparison.
  return Number.parseInt(revision ?? "0", 10) >= INVENTORY_REVISION;
}

/**
 * Claude Code's own agents, skills and plugins per version, as system/init
 * lists them for ContainerUser, and the qualification that proved user-scope
 * CLAUDE.md, rules and agents LOAD in that version (spec v2 section 4: per
 * cell the inventory proves installation; loading is qualified per version).
 * A version not listed refuses every inventoried cell until it is qualified.
 */
export const BUILTIN_INVENTORY: Readonly<
  Record<
    string,
    {
      agents: readonly string[];
      skills: readonly string[];
      plugins: readonly string[];
      qualified: string;
    }
  >
> = {
  "2.1.282": {
    agents: ["claude", "Explore", "general-purpose", "Plan", "statusline-setup"],
    skills: [
      "batch",
      "claude-api",
      "code-review",
      "dataviz",
      "debug",
      "deep-research",
      "doctor",
      "fewer-permission-prompts",
      "loop",
      "run",
      "run-skill-generator",
      "schedule",
      "simplify",
      "update-config",
      "verify",
      "workflow-authoring",
    ],
    plugins: ["agents-md@builtin"],
    qualified: "M9-01 spike (H:\\cg-coord\\m9\\spike-01\\findings.md)",
  },
};

/**
 * The plugin each declared LSP component may show in system/init (cross-plan
 * ruling 3: the allow-list follows the arm's declared components; appendix
 * section 4). M10-06 owns the values (from its S1 capture
 * tests/fixtures/harness/claude-code/lsp-init.json); these are provisional.
 * path null: init entries carry no path. Any other plugin is refused.
 */
export const LSP_PLUGINS: Readonly<
  Record<string, { name: string; source: string; path: string | null }>
> = {
  al: {
    name: "al-language-server-go-windows",
    source: "al-language-server-go-windows@inline",
    path: "C:\\cg-lsp\\al-language-server-go-windows",
  },
};

/** An init plugin entry is the declared plugin (appendix section 4 match rule). */
export function pluginIs(
  p: J,
  id: { name: string; source: string; path: string | null },
): boolean {
  return p.name === id.name && p.source === id.source &&
    (id.path === null || p.path === id.path);
}

const INVENTORY_KEYS = "installed,ok,problems,type,v";
const INSTALLABLE = ["agents", "instructions", "skills"] as const;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Fail-closed component inventory (spec v2 section 4, gate 1). run.ps1's
 * cg_inventory line proves installation before the agent starts; system/init
 * proves what Claude Code loaded against its own built-ins and the arm's
 * declared allow-list; every model seen must be the arm's main model (gate 3).
 */
function componentInventory(
  lines: Line[],
  init: Line | undefined,
  usedModels: string[],
  manifest: ParseInput["manifest"],
): {
  required: boolean;
  loaded: string[];
  problems: string[];
  evidence: Record<string, string>;
} {
  const required = inventoried(manifest.image.revision);
  const none = { required, loaded: [], problems: [], evidence: {} };
  if (!required) return none;
  const problems: string[] = [];
  const evidence: Record<string, string> = {};
  // Appendix section 3: the installable components plus one lsp:<name> per declared LSP.
  const declared = [
    ...INSTALLABLE.filter((k) => manifest[k] !== null),
    ...manifest.lsp.map((s) => `lsp:${s.name}`),
  ].sort();
  let installed: string[] = [];
  const recs = lines.filter((x) => x.rec.type === "cg_inventory");
  if (recs.length !== 1) {
    problems.push(
      recs.length === 0
        ? "no cg_inventory record: the image did not prove its components"
        : `${recs.length} cg_inventory records (${linesOf(recs)})`,
    );
  } else {
    const { rec: r, line } = recs[0]!;
    if (init && line > init.line) {
      problems.push(`line ${line}: cg_inventory after system/init (line ${init.line})`);
    }
    if (
      Object.keys(r).sort().join() !== INVENTORY_KEYS || r.v !== 1 ||
      typeof r.ok !== "boolean" || !strings(r.installed) || !strings(r.problems)
    ) {
      problems.push(`line ${line}: cg_inventory record is not of the recorded shape`);
    } else if (r.ok !== (r.problems.length === 0)) {
      problems.push(
        `line ${line}: cg_inventory ok=${r.ok} contradicts its ${r.problems.length} problem(s)`,
      );
    } else if (!r.ok) {
      problems.push(...r.problems);
    } else if ([...r.installed].sort().join() !== declared.join()) {
      problems.push(
        `cg_inventory installed [${[...r.installed].sort().join(", ")}] but the arm declares [${declared.join(", ")}]`,
      );
    } else {
      installed = r.installed;
    }
  }
  if (!init) return { required, loaded: [], problems, evidence };
  const i = init.rec;
  const version = typeof i.claude_code_version === "string" ? i.claude_code_version : "";
  const builtin = Object.hasOwn(BUILTIN_INVENTORY, version)
    ? BUILTIN_INVENTORY[version]!
    : null;
  if (!builtin) {
    problems.push(`no qualified built-in inventory for Claude Code ${version || "(unknown)"}`);
    return { required, loaded: [], problems, evidence };
  }
  // Absence is provable only from a list that is there.
  const bad: string[] = ["agents", "skills", "tools"].filter((k) => !strings(i[k]));
  if (!Array.isArray(i.plugins) || !i.plugins.every((p) => p !== null && typeof p === "object")) {
    bad.push("plugins");
  }
  if (bad.length > 0) {
    problems.push(`system/init lacks a valid list for ${bad.join(", ")}: absence cannot be proven`);
    return { required, loaded: [], problems, evidence };
  }
  const loaded: string[] = [];
  const want = {
    agents: (manifest.agents?.files ?? []).map((f) => f.path.replace(/\.md$/, "")),
    skills: [
      ...new Set((manifest.skills?.files ?? []).map((f) => f.path.split("/")[0]!)),
    ],
  };
  for (const [component, kind] of [["agents", "agent"], ["skills", "skill"]] as const) {
    const seen = i[component] as string[];
    for (const n of seen) {
      if (!builtin[component].includes(n) && !want[component].includes(n)) {
        problems.push(`unrequested ${kind} loaded: ${n}`);
      }
    }
    if (
      manifest[component] !== null && installed.includes(component) &&
      want[component].length > 0 && want[component].every((n) => seen.includes(n))
    ) {
      loaded.push(component);
      evidence[component] = "installed (cg_inventory) and listed by system/init";
    }
  }
  // One allow-list: built-in plugins plus each declared LSP component's plugin.
  const lspSeen = new Set<string>();
  for (const p of (i.plugins as unknown[]).map(obj)) {
    const src = typeof p.source === "string" ? p.source : null;
    if (src !== null && builtin.plugins.includes(src)) continue;
    const decl = manifest.lsp.find((s) =>
      Object.hasOwn(LSP_PLUGINS, s.name) && pluginIs(p, LSP_PLUGINS[s.name]!)
    );
    if (decl) lspSeen.add(decl.name);
    else problems.push(`unrequested plugin loaded: ${src ?? String(p.name)}`);
  }
  for (const s of manifest.lsp) {
    if (!Object.hasOwn(LSP_PLUGINS, s.name)) {
      problems.push(`no plugin identity for LSP component ${s.name}`);
    }
  }
  const lspTool = (i.tools as string[]).includes("LSP");
  if (manifest.lsp.length === 0 && lspTool) problems.push("unrequested LSP tool loaded");
  // The ONE positive LSP check (appendix section 3): preflight passed
  // (cg_inventory installed lsp:<name>), declared plugin in init, LSP tool listed.
  for (const s of manifest.lsp) {
    const pre = installed.includes(`lsp:${s.name}`);
    const plugin = lspSeen.has(s.name);
    if (pre && plugin && lspTool) {
      loaded.push(`lsp:${s.name}`);
      evidence[`lsp:${s.name}`] =
        "preflight passed (cg_inventory); plugin and LSP tool listed by system/init";
    } else {
      problems.push(
        `lsp:${s.name} not loaded (preflight ${pre ? "passed" : "missing"}, plugin ${plugin ? "present" : "absent"}, LSP tool ${lspTool ? "present" : "absent"})`,
      );
    }
  }
  if (manifest.instructions !== null && installed.includes("instructions")) {
    loaded.push("instructions");
    evidence["instructions"] =
      `installed (cg_inventory); loading qualified for Claude Code ${version} by ${builtin.qualified}`;
  }
  const main = obj(obj(manifest.settings.native)["api_models"])["main"];
  if (typeof main !== "string") {
    problems.push("settings.native.api_models.main missing: no model pin to check");
  } else {
    for (const m of usedModels) {
      if (m !== main) problems.push(`model ${m || "(none)"} ran; the arm pins ${main}`);
    }
  }
  return { required, loaded, problems, evidence };
}
```

4. In `parseClaudeStream`, collect sub-agent results while building the TTL splits. In the existing `for (const { rec, line } of of("user"))` loop, after `model` is computed, add `children.push({ line, model, usage: tu });` with, before the loop:

```typescript
  /** Sub-agent tool_use_result.usage records (gate 3: M9-06 reconciles them). */
  const children: { line: number; model: string | null; usage: J }[] = [];
```

5. Replace the block from `const mcp = mcpInventory(init, input.manifest);` through the `unobservable` declaration with:

```typescript
  const usedModels = [
    ...new Set([
      ...(result ? models : []),
      ...[...perMessage.values()].map((v) => v.model),
      ...children.map((c) => c.model ?? ""),
    ]),
  ].sort();
  const inv = componentInventory(lines, inits[0], usedModels, input.manifest);
  const mcp = mcpInventory(init, input.manifest);
  const connected = mcp.loaded;
  const loaded = init
    ? [
      ...(inv.required
        ? inv.loaded
        : input.manifest.skills && wantSkills.length > 0 &&
            wantSkills.every((s) => skillNames.has(s))
        ? ["skills"]
        : []),
      ...connected,
    ]
    : null;
  // With the inventory only the toolchain stays unconfirmable; a requested
  // hook or plugin is refused by the inventory, never unverified.
  const unobservable = requestedComponents(input.manifest).filter((c) =>
    inv.required
      ? c.startsWith("toolchain:")
      : ["instructions", "agents", "hooks"].includes(c) ||
        c.startsWith("plugin:") || c.startsWith("lsp:") ||
        c.startsWith("toolchain:")
  );
```

6. In `raw_usage`, after `mcp_inventory: mcp.problems,` add `component_inventory: inv.problems,` and `component_evidence: inv.evidence,`. In the returned object, after `unobservable,` add `inventoryProblems: inv.problems,`.

- [ ] **Step 4: Run to verify they pass**

Run: `deno test --allow-all tests/unit/harness/claude-code.test.ts tests/unit/harness/adapter.test.ts tests/unit/harness/claude-trace.test.ts`
Expected: PASS, every pre-M9 test unchanged (the parser pin changes only per ruling 2).

- [ ] **Step 5: check/lint/fmt the touched files, commit**

```bash
git add src/harness/adapter.ts src/harness/adapters/claude-code.ts tests/unit/harness/claude-code.test.ts
git commit -m "feat(harness): claude-code adapter proves the component inventory fail-closed with a declared-component allow-list (M9-04)"
```

### Task M9-05: inventory refusals reach `setup_failed` and are never judged

**Lane:** lane-infra2. **Deps:** M9-04, M9-16. **May touch:** `src/harness/execution.ts`, `tests/unit/harness/execution.test.ts`, `tests/unit/harness/runtime-fixture.ts` (only if `cellFor` does not yet pass `config.image_revision` to `imageTag`).

**Interfaces:**
- Consumes: `ParsedRun.inventoryProblems` (M9-04).
- Produces: side file `setup_error` = `component inventory: <problems joined by "; ">` when the observed mismatch is null and the inventory has problems; no judgment record for such an execution.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/execution.test.ts`; add `import { imageTag } from "../../../src/harness/images.ts";` and `import { BUILTIN_INVENTORY } from "../../../src/harness/adapters/claude-code.ts";`):

```typescript
/** A revision-3 claude-code arm in a test env (spec v2 gate 1). */
async function inventoriedEnv(): Promise<TestEnv> {
  const t = await makeEnv();
  await write(
    t.harnessRoot,
    "configs/cc-v2-inv.yml",
    `id: cc-v2-inv
harness: claude-code
harness_version: "2.1.282"
image_revision: "3"
models: { main: anthropic/claude-sonnet-5 }
settings: {}
components: { instructions: bundles/env/instructions }
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  t.docker.addImage(
    imageTag("claude-code", "2.1.282", "3"),
    `sha256:${"d".repeat(64)}`,
    {
      "centralgauge.harness": "claude-code",
      "centralgauge.harness.version": "2.1.282",
      "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
      "centralgauge.harness.revision": "3",
    },
  );
  return t;
}
const B282 = BUILTIN_INVENTORY["2.1.282"]!;
/** INIT with the lists the inventory requires (M9-04). */
const V2_INIT = JSON.stringify({
  ...JSON.parse(INIT),
  agents: [...B282.agents],
  skills: [...B282.skills],
  plugins: B282.plugins.map((s) => ({ name: s.split("@")[0], path: "builtin", source: s })),
  tools: ["Agent", "Bash", "Read"],
});
const INV = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "cg_inventory",
    v: 1,
    ok: true,
    installed: ["instructions"],
    problems: [],
    ...over,
  });

/** Runs one cell whose container prints `lines` and exits `code`; returns the execution and its side file. */
async function inventoryCell(lines: string[], code = 0) {
  const t = await inventoriedEnv();
  t.docker.behavior = async (_call, io) => {
    for (const l of lines) await io.stdout(l);
    return code;
  };
  const e = (await runCell(t.env, await cellFor(t, "cc-v2-inv"))).executions[0]!;
  return { t, e, side: await sideOf(t, e.id) };
}

Deno.test("component inventory (spec v2 gate 1): every inventory failure is setup_failed and never judged; a proven arm completes", async () => {
  const probe = await probeLines();
  const cases: [string, string[], number, string][] = [
    ["no record", [V2_INIT, ...probe], 0, "no cg_inventory record"],
    ["duplicate", [INV(), INV(), V2_INIT, ...probe], 0, "2 cg_inventory records"],
    ["malformed", [INV({ extra: 1 }), V2_INIT, ...probe], 0, "not of the recorded shape"],
    [
      "refused",
      [INV({ ok: false, installed: [], problems: ["instructions: CLAUDE.md is staged but not installed"] }), V2_INIT, ...probe],
      0,
      "component inventory: instructions: CLAUDE.md is staged but not installed",
    ],
    [
      "record only, exit 5",
      [INV({ ok: false, installed: [], problems: ["hooks is staged but this image cannot install it"] })],
      5,
      "hooks is staged",
    ],
    ["installer threw before the inventory (no output, exit 1)", [], 1, "no cg_inventory record"],
  ];
  for (const [name, lines, code, want] of cases) {
    const { t, e, side } = await inventoryCell(lines, code);
    assertEquals(e.termination, "setup_failed", name);
    assertStringIncludes(side.setup_error, want, name);
    assertEquals(await t.env.store.judgments(e.id), [], `${name}: never judged`);
  }
  const { e } = await inventoryCell([INV(), V2_INIT, ...probe]);
  assertEquals(e.termination, "completed");
});

// Round 3 (orchestrator; interfaces section 3 "Refusal outcome" (b)): a problem found
// AFTER the agent started (here: an unpinned model ran) is setup_failed and never judged,
// but the credential was released and paid work happened, so its cost is KEPT.
Deno.test("component inventory: a post-start problem keeps the run's cost", async () => {
  const { t, e } = await inventoryCell([INV(), V2_INIT, ...probeWithModel("anthropic/claude-other")]);
  assertEquals(e.termination, "setup_failed");
  assertEquals(await t.env.store.judgments(e.id), []);
  assert(e.cost_usd !== null && e.cost_usd > 0, "post-start refusal must keep the reported cost, never 0");
});
```

(`probeWithModel(model)` = the existing `probe` records with every assistant/result `model` replaced by `model`; define it next to `probe`.)

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/harness/execution.test.ts --filter "component inventory"`
Expected: FAIL on "no record" (termination `completed`; the problems are ignored). If `cellFor` throws an image-revision mismatch instead, first make `cellFor` resolve `imageTag(config.harness, config.harness_version, config.image_revision)` (one line in `runtime-fixture.ts`), then re-run to see the intended failure.

- [ ] **Step 3: Implement** in `buildDraft` (`src/harness/execution.ts`), right after the `check` declaration:

```typescript
  // Spec v2 gate 1: an arm whose components the adapter could not prove is never judged.
  const inventory = started ? parsed.inventoryProblems ?? [] : [];
  const mismatch = check.mismatch ??
    (inventory.length > 0 ? `component inventory: ${inventory.join("; ")}` : null);
```

then replace `check.mismatch !== null` in the `termination` expression with `mismatch !== null`, and `setup_error: f.setupError ?? check.mismatch,` with `setup_error: f.setupError ?? mismatch,`. Judging already skips `setup_failed` executions; the no-judgment assertion pins it for this path.

- [ ] **Step 4: Run the harness suites**

Run: `deno test --allow-all --ignore=tests/unit/container tests/unit/harness tests/unit/cli/commands/harness-command.test.ts > <scratch>/m9-05.log 2>&1`
Expected: PASS; grep the log for `FAILED`.

- [ ] **Step 5: Commit**

```bash
git add src/harness/execution.ts tests/unit/harness/execution.test.ts tests/unit/harness/runtime-fixture.ts
git commit -m "feat(harness): component inventory problems make the execution setup_failed, never judged (M9-05)"
```

### Task M9-06: exact usage reconciliation on inventoried images (gate 3, fixture half)

**Lane:** lane-infra2. **Deps:** M9-04. **May touch:** `src/harness/adapters/claude-code.ts`, `tests/unit/harness/subagent-cost.test.ts`.

What the recorded fixtures show (checked 2026-10-03 with jq over `tests/fixtures/harness/claude-code/`):

| Fixture | Streamed messages (in / cache read / cache write) | Sub-agent `tool_use_result.usage` | modelUsage |
| --- | --- | --- | --- |
| probe.jsonl (foreground agent) | 8 / 99240 / 28198 | 2 / 21406 / 870 | 10 / 120646 / 29068 = sum, exact |
| m129-resume.jsonl (background agent, all 9 child messages streamed, no result usage) | 58 / 839202 / 47154 | none | 58 / 839202 / 47154, exact |
| retry.jsonl, tool-progress.jsonl | equal | none | exact |
| compaction.jsonl | 190010 / 0 / 0 | none | 190020 / 0 / 0 (the compaction request is billed, never streamed) |

So a sub-agent's `tool_use_result.usage` is its FINAL request, which the stream never shows; modelUsage = streamed messages (one per message id, main and sub-agents) + every sub-agent final request. Output tokens cannot be reconciled from the stream (chunks carry a partial count: probe streams 9, bills 2181), only floored.

Rule (inventoried images only, so frozen v1 parsing and its synthetic tests are untouched; appendix section 6): every required source field is validated, never zero-filled: each streamed assistant `message.usage` and each sub-agent `tool_use_result.usage` must carry `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and `output_tokens` as counts, and each `modelUsage` entry `inputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` and `outputTokens`; a missing or non-count field is `unreconciled` naming the source and field. The `modelUsage` model set must equal the set of models seen in streamed messages and sub-agent results; a model on one side only is `unreconciled` even with zero counts. Per model, input, cache read and cache write must EQUAL that sum; output must be at least the floor. A run with at least one compaction may EXCEED (never fall short) only on input of the main-session model (the model of messages without `parent_tool_use_id`), only when the input excess does not equal a sub-agent's streamed or final input (a suspected double count); the excess is recorded as `compaction_excess` with per-model deltas and the cost is kept (owner default, round 3 decisions). Cache excess, excess on a sub-agent-only model, or a doubled child after a compaction is `unreconciled`. Anything unreconciled: cost null and `per_model` empty with the reason in `missing`, and `usage_reconciliation.status = "unreconciled"`. Gate 3 evidence counts only `exact` runs (M9-13, M9-14, M9-17, M11-14).

**Interfaces:**
- Produces: `raw_usage.usage_reconciliation` = `{ status: "exact" } | { status: "compaction_excess", excess: Record<model, {input, read, write}> } | { status: "unreconciled", why: string }` on inventoried images (absent otherwise). M11 reads it (ruling 4; appendix section 6).

- [ ] **Step 1: Write the failing tests** `tests/unit/harness/subagent-cost.test.ts`:

```typescript
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { manifest } from "./fixtures.ts";
import { tempDir } from "./temp-dirs.ts";

/** Spec v2 gate 3, fixture half: modelUsage reconciles exactly or the cost is missing. */
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": {
      slug: "anthropic/claude-sonnet-5",
      pricing_version: "2026-09-25",
      input: 2,
      output: 10,
      cache_read: 0.2,
      cache_write_5m: 2.5,
      cache_write_1h: 4,
      cache_write_1h_derived: true,
    },
    "claude-haiku-9": {
      slug: "anthropic/claude-haiku-9",
      pricing_version: "2026-09-25",
      input: 1,
      output: 5,
      cache_read: 0.1,
      cache_write_5m: 1.25,
      cache_write_1h: 2,
      cache_write_1h_derived: true,
    },
  },
};
type U = { in: number; read: number; write: number; out: number };
const PARENT: U = { in: 10, read: 1000, write: 300, out: 100 };
const CHILD_STREAMED: U = { in: 5, read: 0, write: 400, out: 2 };
const CHILD_FINAL: U = { in: 2, read: 400, write: 20, out: 60 };
const sum = (...us: U[]): U =>
  us.reduce((a, b) => ({ in: a.in + b.in, read: a.read + b.read, write: a.write + b.write, out: a.out + b.out }), { in: 0, read: 0, write: 0, out: 0 });
const rec = (o: Record<string, unknown>) => JSON.stringify({ session_id: "s1", ...o });
const init = rec({ type: "system", subtype: "init", claude_code_version: "2.1.282", skills: [], agents: [], plugins: [], mcp_servers: [], tools: ["Agent"] });
const usage = (u: U) => ({
  input_tokens: u.in,
  cache_read_input_tokens: u.read,
  cache_creation_input_tokens: u.write,
  output_tokens: u.out,
  cache_creation: { ephemeral_5m_input_tokens: u.write, ephemeral_1h_input_tokens: 0 },
});
const assistant = (id: string, model: string, u: U, content: unknown[], parent?: string) =>
  rec({ type: "assistant", ...(parent ? { parent_tool_use_id: parent } : {}), message: { id, model, content, usage: usage(u) } });
const spawn = (model = "claude-sonnet-5") =>
  assistant("m1", model, PARENT, [{ type: "tool_use", id: "toolu_A", name: "Agent", input: { subagent_type: "al-reviewer", description: "r", prompt: "p" } }]);
const childMsg = (model = "claude-sonnet-5") =>
  assistant("c1", model, CHILD_STREAMED, [{ type: "text", text: "x" }], "toolu_A");
const childResult = (model: string, u: U | null) =>
  rec({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_A", is_error: u === null, content: u === null ? "cancelled" : "done" }] },
    ...(u === null ? {} : { tool_use_result: { model: null, resolvedModel: model, usage: usage(u) } }),
  });
const mu = (u: U) => ({ inputTokens: u.in, outputTokens: u.out, cacheReadInputTokens: u.read, cacheCreationInputTokens: u.write });
const result = (modelUsage: Record<string, unknown>, subtype = "success") =>
  rec({ type: "result", subtype, is_error: subtype !== "success", num_turns: 2, duration_ms: 10, total_cost_usd: 0.002, stop_reason: "end_turn", usage: {}, modelUsage });
const price = (u: U, p = { input: 2, read: 0.2, w5: 2.5, out: 10 }) =>
  (u.in * p.input + u.read * p.read + u.write * p.w5 + u.out * p.out) / 1e6;
const HAIKU = { input: 1, read: 0.1, w5: 1.25, out: 5 };

/**
 * Parses as an inventoried (revision 3) arm; inventory problems are irrelevant
 * here. `null` is the sentinel for a frozen image with no revision (passing
 * `undefined` would select the default "3").
 */
async function parse(lines: string[], revision: string | null = "3") {
  const dir = await Deno.realPath(await tempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), lines.join("\n"));
  return await claudeCodeAdapter.parse({
    rawLog: join(dir, "raw.jsonl"),
    exitCode: 0,
    pricing: BOOK,
    traceOut: join(dir, "trace.jsonl"),
    manifest: manifest("cc", {
      harness_version: "2.1.282",
      image: { digest: "sha256:img", base_digest: "sha256:base", ...(revision !== null ? { revision } : {}) },
    }),
  });
}
type Recon = { status: string; why?: string; excess?: Record<string, Record<string, number>> };
const recon = (r: Awaited<ReturnType<typeof parse>>) =>
  (r.telemetry.raw_usage as { usage_reconciliation?: Recon }).usage_reconciliation;
const missing = (r: Awaited<ReturnType<typeof parse>>) =>
  ((r.telemetry.raw_usage as { missing?: string[] }).missing ?? []).join("; ");
const unreconciled = (r: Awaited<ReturnType<typeof parse>>, want: string) => {
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(recon(r)?.status, "unreconciled");
  assertStringIncludes(missing(r), want);
};
const ALL = sum(PARENT, CHILD_STREAMED, CHILD_FINAL);

Deno.test("gate 3: streamed parent + streamed child + child final request equals modelUsage: exact, priced once (cache writes included)", async () => {
  const r = await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(ALL) })]);
  assertEquals(recon(r), { status: "exact" });
  assertAlmostEquals(r.telemetry.cost_usd!, price(ALL), 1e-12);
});

Deno.test("gate 3: omissions are missing cost (child final request, whole child, parent)", async () => {
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) })]),
    "is below",
  );
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(PARENT) })]),
    "is below",
  );
});

Deno.test("gate 3: inflated or doubled aggregates are missing cost", async () => {
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(sum(ALL, CHILD_STREAMED, CHILD_FINAL)) })]),
    "exceeds",
  );
});

Deno.test("gate 3: a child with no streamed messages reconciles through its result usage alone", async () => {
  const r = await parse([init, spawn(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_FINAL)) })]);
  assertEquals(recon(r), { status: "exact" });
  unreconciled(
    await parse([init, spawn(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(PARENT) })]),
    "is below",
  );
});

Deno.test("gate 3: output under the floor or missing is missing cost", async () => {
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": { ...mu(ALL), outputTokens: 50 } })]),
    "output",
  );
  const { outputTokens: _drop, ...noOut } = mu(ALL);
  assertEquals(
    (await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": noOut })])).telemetry.cost_usd,
    null,
  );
});

Deno.test("gate 3: a child on another model reconciles per model at its own rates", async () => {
  const r = await parse([
    init,
    spawn(),
    childMsg("claude-haiku-9"),
    childResult("claude-haiku-9", CHILD_FINAL),
    result({ "claude-sonnet-5": mu(PARENT), "claude-haiku-9": mu(sum(CHILD_STREAMED, CHILD_FINAL)) }),
  ]);
  assertEquals(recon(r), { status: "exact" });
  assertAlmostEquals(r.telemetry.cost_usd!, price(PARENT) + price(sum(CHILD_STREAMED, CHILD_FINAL), HAIKU), 1e-12);
  unreconciled(
    await parse([init, spawn(), childMsg("claude-haiku-9"), childResult("claude-haiku-9", CHILD_FINAL), result({ "claude-sonnet-5": mu(ALL) })]),
    "claude-haiku-9",
  );
});

Deno.test("gate 3: cancelled after paid work: streamed work is reconciled; unstreamed paid work is missing cost", async () => {
  const done = await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", null), result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) })]);
  assertEquals(recon(done), { status: "exact" });
  assertAlmostEquals(done.telemetry.cost_usd!, price(sum(PARENT, CHILD_STREAMED)), 1e-12);
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", null), result({ "claude-sonnet-5": mu(ALL) })]),
    "exceeds",
  );
});

Deno.test("gate 3: a budget stop during child work is budget_exhausted and reconciled", async () => {
  const r = await parse([init, spawn(), childMsg(), result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) }, "error_max_budget_usd")]);
  assertEquals(r.termination, "budget_exhausted");
  assertEquals(recon(r), { status: "exact" });
});

Deno.test("gate 3: recorded fixtures reconcile exactly; compaction is the one recorded excess", async () => {
  for (const f of ["probe.jsonl", "m129-resume.jsonl", "retry.jsonl", "tool-progress.jsonl"]) {
    const text = await Deno.readTextFile(`tests/fixtures/harness/claude-code/${f}`);
    assertEquals(recon(await parse(text.split(/\r?\n/).filter(Boolean)))?.status, "exact", f);
  }
  const text = await Deno.readTextFile("tests/fixtures/harness/claude-code/compaction.jsonl");
  const r = await parse(text.split(/\r?\n/).filter(Boolean));
  assertEquals(recon(r), { status: "compaction_excess", excess: { "claude-sonnet-5": { input: 10, read: 0, write: 0 } } });
  assert(r.telemetry.cost_usd !== null);
});

Deno.test("gate 3: frozen images keep the v1 accounting (no reconciliation field)", async () => {
  const r = await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(ALL) })], null);
  assertEquals(recon(r), undefined);
});

Deno.test("gate 3: every required usage field is validated, never zero-filled", async () => {
  const P0: U = { ...PARENT, read: 0 };
  const { cache_read_input_tokens: _r, ...noRead } = usage(P0);
  const parentNoRead = rec({ type: "assistant", message: { id: "m1", model: "claude-sonnet-5", content: [{ type: "text", text: "x" }], usage: noRead } });
  unreconciled(await parse([init, parentNoRead, result({ "claude-sonnet-5": mu(P0) })]), "cache_read_input_tokens missing or not a count");
  const badChild = rec({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "done" }] },
    tool_use_result: { model: null, resolvedModel: "claude-sonnet-5", usage: { ...usage(CHILD_FINAL), output_tokens: "60" } },
  });
  unreconciled(await parse([init, spawn(), childMsg(), badChild, result({ "claude-sonnet-5": mu(ALL) })]), "output_tokens missing or not a count");
  const { cache_creation_input_tokens: _w, ...noWrite } = usage(CHILD_FINAL);
  const childNoWrite = rec({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_A", content: "done" }] },
    tool_use_result: { model: null, resolvedModel: "claude-sonnet-5", usage: noWrite },
  });
  unreconciled(await parse([init, spawn(), childMsg(), childNoWrite, result({ "claude-sonnet-5": mu(ALL) })]), "cache_creation_input_tokens missing or not a count");
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": { ...mu(ALL), cacheReadInputTokens: -1 } })]),
    "cacheReadInputTokens missing or not a count",
  );
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": { ...mu(ALL), inputTokens: "17" } })]),
    "inputTokens missing or not a count",
  );
});

Deno.test("gate 3: a model on only one side is unreconciled, even with zero counts", async () => {
  unreconciled(
    await parse([init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), result({ "claude-sonnet-5": mu(ALL), "claude-haiku-9": mu({ in: 0, read: 0, write: 0, out: 0 }) })]),
    "model claude-haiku-9 is only in modelUsage",
  );
  unreconciled(
    await parse([init, spawn(), childMsg("claude-haiku-9"), childResult("claude-haiku-9", CHILD_FINAL), result({ "claude-sonnet-5": mu(PARENT) })]),
    "model claude-haiku-9 is only in the stream",
  );
});

/** The compaction record of the recorded fixture (the line the trace maps to a `compaction` event). */
async function compactLine(): Promise<string> {
  const lines = (await Deno.readTextFile("tests/fixtures/harness/claude-code/compaction.jsonl")).split(/\r?\n/).filter(Boolean);
  const c = lines.find((l) => {
    const r = JSON.parse(l);
    return r.type === "system" && r.subtype === "compact_boundary";
  });
  assert(c !== undefined, "compaction.jsonl has a compact_boundary record (if it marks compaction otherwise, use that record)");
  return c;
}

Deno.test("gate 3: a compaction excuses only main-model input that no sub-agent explains (adversarial)", async () => {
  const C = await compactLine();
  const head = [init, spawn(), childMsg(), childResult("claude-sonnet-5", CHILD_FINAL), C];
  const ok = await parse([...head, result({ "claude-sonnet-5": mu({ ...ALL, in: ALL.in + 11 }) })]);
  assertEquals(recon(ok), { status: "compaction_excess", excess: { "claude-sonnet-5": { input: 11, read: 0, write: 0 } } });
  assert(ok.telemetry.cost_usd !== null);
  unreconciled(
    await parse([...head, result({ "claude-sonnet-5": mu({ ...ALL, read: ALL.read + 11 }) })]),
    "cache excess after compaction is not attributable",
  );
  unreconciled(
    await parse([...head, result({ "claude-sonnet-5": mu({ ...ALL, in: ALL.in + CHILD_FINAL.in }) })]),
    "equals a sub-agent's input",
  );
  unreconciled(
    await parse([...head.slice(0, 2), childMsg("claude-haiku-9"), childResult("claude-haiku-9", CHILD_FINAL), C, result({ "claude-sonnet-5": mu(PARENT), "claude-haiku-9": mu({ ...sum(CHILD_STREAMED, CHILD_FINAL), in: 99 }) })]),
    "is not the main-session model",
  );
});
```

Retries are pinned by `retry.jsonl` (here and in the M2-11 tests); background-agent inclusion across segments by `m129-resume.jsonl`. Do not duplicate them.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/subagent-cost.test.ts`
Expected: FAIL (`usage_reconciliation` undefined).

- [ ] **Step 3: Implement** in `claude-code.ts`.

1. Per message id, keep the highest output count seen across chunks, and the sub-agent link. Change the assistant loop's `perMessage.set(...)` to (`rec` is the loop's record):

```typescript
      const prev = perMessage.get(msg.id);
      const o = obj(msg.usage).output_tokens;
      perMessage.set(msg.id, {
        model,
        usage: obj(msg.usage),
        // A chunk without a count never lowers the floor; reconcile() still
        // requires the stored usage to carry output_tokens as a count.
        out: Math.max(prev?.out ?? 0, isCount(o) ? o : 0),
        parent: typeof rec.parent_tool_use_id === "string" ? rec.parent_tool_use_id : null,
      });
```

and the map type to `Map<string, { model: string; usage: J; out: number; parent: string | null }>` (also in `notCumulative`'s parameter).

2. Add:

```typescript
type Tally = { input: number; read: number; write: number; out: number };
export type Reconciliation =
  | { status: "exact" }
  | { status: "compaction_excess"; excess: Record<string, Omit<Tally, "out">> }
  | { status: "unreconciled"; why: string };

/**
 * Spec v2 gate 3, inventoried images (appendix section 6). The last
 * modelUsage must equal, per model, the streamed assistant messages (main and
 * sub-agents, one per message id) plus each sub-agent's
 * tool_use_result.usage, its final request, which the stream never shows
 * (probe.jsonl and m129-resume.jsonl reconcile exactly). Every source field
 * must be a count (never zero-filled) and both sides must name the same
 * models. Equal input and cache counts: nothing omitted, nothing counted
 * twice. Output is a floor: stream chunks carry a partial count. A run with a
 * compaction may exceed only on main-session input that no sub-agent's input
 * explains (compaction.jsonl: the summary request is billed, never
 * streamed); the excess is recorded, never hidden.
 */
function reconcile(
  last: J,
  perMessage: Map<string, { model: string; usage: J; out: number; parent: string | null }>,
  children: { line: number; model: string | null; usage: J }[],
  compactions: number,
): Reconciliation {
  const no = (why: string): Reconciliation => ({ status: "unreconciled", why });
  const FIELDS = [
    ["input", "input_tokens"],
    ["read", "cache_read_input_tokens"],
    ["write", "cache_creation_input_tokens"],
  ] as const;
  const want = new Map<string, Tally>();
  const add = (where: string, m: string, u: J, out: number): string | null => {
    for (const [, f] of [...FIELDS, ["out", "output_tokens"] as const]) {
      if (!isCount(u[f])) return `${where} ${f} missing or not a count`;
    }
    const t = want.get(m) ?? { input: 0, read: 0, write: 0, out: 0 };
    for (const [k, f] of FIELDS) t[k] += u[f] as number;
    t.out += out;
    want.set(m, t);
    return null;
  };
  for (const [id, v] of perMessage) {
    const bad = add(`message ${id}`, v.model, v.usage, v.out);
    if (bad) return no(bad);
  }
  for (const c of children) {
    if (c.model === null) return no(`line ${c.line}: sub-agent usage without a model`);
    const bad = add(`line ${c.line}: sub-agent usage`, c.model, c.usage, c.usage.output_tokens as number);
    if (bad) return no(bad);
  }
  for (const m of Object.keys(last)) {
    if (!want.has(m)) return no(`model ${m || "(no model)"} is only in modelUsage`);
  }
  for (const m of want.keys()) {
    if (!Object.hasOwn(last, m)) return no(`model ${m || "(no model)"} is only in the stream`);
  }
  // Compaction attribution: main-session models, and every sub-agent input a
  // doubled child would add (each child's final input, each parent's streamed input).
  const mainModels = new Set([...perMessage.values()].filter((v) => v.parent === null).map((v) => v.model));
  const streamedByParent = new Map<string, number>();
  for (const v of perMessage.values()) {
    if (v.parent !== null) streamedByParent.set(v.parent, (streamedByParent.get(v.parent) ?? 0) + (v.usage.input_tokens as number));
  }
  const childInputs = new Set([...children.map((c) => c.usage.input_tokens as number), ...streamedByParent.values()]);
  const excess: Record<string, Omit<Tally, "out">> = {};
  for (const m of Object.keys(last).sort()) {
    const name = m || "(no model)";
    const x = obj(last[m]);
    const t = want.get(m)!;
    const got: Partial<Tally> = {};
    for (
      const [k, f] of [
        ["input", "inputTokens"],
        ["read", "cacheReadInputTokens"],
        ["write", "cacheCreationInputTokens"],
        ["out", "outputTokens"],
      ] as const
    ) {
      const v = x[f];
      if (!isCount(v)) return no(`modelUsage ${name} ${f} missing or not a count`);
      got[k] = v;
    }
    const g = got as Tally;
    if (g.out < t.out) {
      return no(`modelUsage ${name} output ${g.out} is below the ${t.out} the messages report`);
    }
    const d = { input: g.input - t.input, read: g.read - t.read, write: g.write - t.write };
    const shown = `input ${d.input}, cache read ${d.read}, cache write ${d.write}`;
    if (d.input < 0 || d.read < 0 || d.write < 0) {
      return no(`modelUsage ${name} is below the streamed messages and sub-agent results (${shown})`);
    }
    if (d.input > 0 || d.read > 0 || d.write > 0) {
      if (compactions === 0) {
        return no(`modelUsage ${name} exceeds the streamed messages and sub-agent results (${shown})`);
      }
      if (!mainModels.has(m)) {
        return no(`modelUsage ${name} exceeds after a compaction but is not the main-session model (${shown})`);
      }
      if (d.read > 0 || d.write > 0) {
        return no(`modelUsage ${name}: cache excess after compaction is not attributable (${shown})`);
      }
      if (childInputs.has(d.input)) {
        return no(`modelUsage ${name}: input excess ${d.input} equals a sub-agent's input (suspected double count)`);
      }
      excess[m] = d;
    }
  }
  return Object.keys(excess).length > 0
    ? { status: "compaction_excess", excess }
    : { status: "exact" };
}
```

3. After the `notCumulative` call site (keep it unchanged for multi-result runs), add:

```typescript
  // Spec v2 gate 3: exact reconciliation on inventoried images only.
  const reconciliation = inventoried(input.manifest.image.revision) && result
    ? reconcile(
      obj(result.modelUsage),
      perMessage,
      children,
      trace.filter((e) => e.type === "compaction").length,
    )
    : null;
  if (reconciliation?.status === "unreconciled") {
    unproven.costs.push(`${file}: usage not reconciled (${reconciliation.why})`);
  }
```

This must sit before `const proven = unproven.costs.length === 0;`. In `raw_usage` add `...(reconciliation ? { usage_reconciliation: reconciliation } : {}),`.

- [ ] **Step 4: Run the new file and every claude-code fixture test**

Run: `deno test --allow-all tests/unit/harness/subagent-cost.test.ts tests/unit/harness/claude-code.test.ts tests/unit/harness/execution.test.ts`
Expected: PASS. If a recorded fixture reconciles differently from the table above (including a recorded usage object that lacks one of the required fields), STOP and report the fixture, model and deltas to the orchestrator; never widen the rule and never zero-fill.

- [ ] **Step 5: Commit**

```bash
git add src/harness/adapters/claude-code.ts tests/unit/harness/subagent-cost.test.ts
git commit -m "feat(harness): exact modelUsage reconciliation with sub-agent final requests on inventoried images (gate 3 fixtures, M9-06)"
```

### Task M9-16: development image revisions; experiments refuse them

**Lane:** lane-infra2. **Deps:** H-01 merged. **May touch:** `src/harness/config.ts`, `tests/unit/harness/config.test.ts`.

Cross-plan ruling 1: proofs before the one r3 build use `2.1.282-r3-dev-<task id>`; no experiment may reference them. H-01's single `IMAGE_REVISION` regex serves the CLI `--revision` check, the config schema and the manifest schema, so one change covers all three. M10 uses the same mechanism for its dev builds.

**Interfaces:**
- Produces: `IMAGE_REVISION = /^[1-9][0-9]{0,3}(?:-dev-[A-Za-z0-9-]{1,32})?$/`; `loadExperiment` throws `ConfigurationError` naming the arm when any arm's `image_revision` contains `-dev-`.

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/harness/config.test.ts`; reuse its temp-harness helpers if present, else `Deno.makeTempDir`):

```typescript
Deno.test("image_revision: proof builds are 3-dev-<task id>; malformed ones are refused", () => {
  for (const ok of ["3", "12", "3-dev-M9-07", "3-dev-M10-03"]) {
    assertEquals(ImageRevisionSchema.parse(ok), ok);
  }
  for (const bad of ["03", "3-dev-", "3-dev-a b", "dev-3", "3-DEV-x"]) {
    assertThrows(() => ImageRevisionSchema.parse(bad), Error, undefined, bad);
  }
  assertEquals(imageTag("claude-code", "2.1.282", "3-dev-M9-07"), "centralgauge/harness-claude-code:2.1.282-r3-dev-M9-07");
});

Deno.test("loadExperiment: an arm on a development image revision is refused (cross-plan ruling 1)", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "configs"));
    await Deno.mkdir(join(root, "experiments"));
    const cfg = (id: string, rev: string) =>
      `id: ${id}\nharness: claude-code\nharness_version: "2.1.282"\nimage_revision: "${rev}"\nmodels: { main: anthropic/claude-sonnet-5 }\nlimits: { timeout_min: 30, max_budget_usd: 5 }\n`;
    await Deno.writeTextFile(join(root, "configs", "a.yml"), cfg("a", "3"));
    await Deno.writeTextFile(join(root, "configs", "b.yml"), cfg("b", "3-dev-M9-07"));
    await Deno.writeTextFile(
      join(root, "experiments", "e.yml"),
      `id: e\nhypothesis: "h"\nprimary_metric: pass_rate\nbaseline: a\nvariants: [b]\nvary: [settings]\ntasks: "x/*"\n`,
    );
    await assertRejects(() => loadExperiment(root, "e"), ConfigurationError, "development image revision 3-dev-M9-07");
    await loadConfig(root, "b"); // a probe config may still name it
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
```

(Add the imports the file lacks: `ImageRevisionSchema`, `loadExperiment`, `loadConfig` from `config.ts`, `imageTag` from `images.ts`, `ConfigurationError`, `join`, `assertRejects`, `assertThrows`.)

- [ ] **Step 2: Run to verify they fail**

Run: `deno test --allow-all tests/unit/harness/config.test.ts --filter "development|proof builds"`
Expected: FAIL (`3-dev-M9-07` rejected by the regex).

- [ ] **Step 3: Implement** in `src/harness/config.ts`: replace the H-01 regex with

```typescript
/**
 * Image revision (H-01 run 004): a rebuild for the same harness_version,
 * tagged `<version>-r<n>`; or a proof build of revision n, `<n>-dev-<task id>`
 * (cross-plan ruling 1), which no experiment may run.
 */
export const IMAGE_REVISION = /^[1-9][0-9]{0,3}(?:-dev-[A-Za-z0-9-]{1,32})?$/;
```

and in `loadExperiment`'s arm loop:

```typescript
  for (const arm of [experiment.baseline, ...experiment.variants]) {
    const cfg = await loadConfig(harnessRoot, arm);
    // Cross-plan ruling 1: proof images prove things; they never run an experiment.
    if (cfg.image_revision?.includes("-dev-")) {
      throw new ConfigurationError(
        `${path}: arm ${arm} names development image revision ${cfg.image_revision}`,
        path,
      );
    }
    configs.push(cfg);
  }
```

- [ ] **Step 4: Run** `deno test --allow-all tests/unit/harness/config.test.ts tests/unit/harness/images.test.ts tests/unit/cli/commands/harness-command.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness/config.ts tests/unit/harness/config.test.ts
git commit -m "feat(harness): 3-dev-<task> proof image revisions; experiments refuse them (M9-16, cross-plan ruling 1)"
```

### Task M9-07: dev image and live inventory proof (gate 1, developmental half)

**Lane:** lane-ops. **Deps:** M9-03, M9-04, M9-05, M9-08, M9-10, M9-11, M9-16. **May touch:** `H:\cg-coord\m9\gate1\**`.

- [ ] **Step 1:** Verify the model: `deno task start models anthropic/claude-sonnet-5 --check`.
- [ ] **Step 2:** Build the proof image from merged M9 code, after the appendix section 1 guard (`if DOCKER_CONTEXT=desktop-windows docker image inspect centralgauge/harness-claude-code:2.1.282-r3-dev-M9-07 >/dev/null 2>&1; then echo "[FAIL] tag exists"; exit 1; fi`): `deno task start harness images build claude-code --version 2.1.282 --revision 3-dev-M9-07`. Confirm the tag `centralgauge/harness-claude-code:2.1.282-r3-dev-M9-07` and its revision label; record the digests of `2.1.282` and `2.1.282-r2` before and after (unchanged).
- [ ] **Step 3:** Owner runs (TTY), lane-ops verifies each from `results/harness/cells/<id>/run/raw.jsonl` and `sandbox.json`:
  - `deno task start harness cell cc-v2-probe-plain HX-003`: first stdout line `cg_inventory`, `ok: true`, `installed: ["instructions"]`; `raw_usage.component_evidence.instructions` names the M9-01 qualification; termination not `setup_failed`.
  - `deno task start harness cell cc-v2-probe-realistic HX-003`: `installed: ["agents","instructions","skills"]`; `loaded_components` holds `agents`, `instructions`, `skills`, `mcp:al-tools`; `component_inventory` empty; `unverified` empty.
  - `deno task start harness cell cc-v2-probe-hooks HX-003`: `setup_failed`, `setup_error` contains `hooks is staged but this image cannot install it`, cost 0, no credential released (run.ps1 exits before the ready wait), no judgment.
- [ ] **Step 4:** Record ids, digests and verdicts in `H:\cg-coord\m9\gate1\evidence-dev.md`. Developmental only; the campaign evidence is M9-17.

### Task M9-08: four arm configs, five probe configs and bundles, factorial experiment skeleton

**Lane:** lane-infra2. **Deps:** M9-10, M9-11 (bundle paths must exist for `loadConfig`), M9-16, H-01 merged. **May touch:** `harness/configs/cc-v2-*.yml`, `harness/experiments/cc-v2-factorial.yml`, `harness/bundles/probe-m9/**`, `tests/unit/harness/v2-configs.test.ts`.

**Interfaces:**
- Consumes: LSP slug `al` (M10).
- Produces: arm ids `cc-v2-plain`, `cc-v2-plain-lsp`, `cc-v2-realistic`, `cc-v2-realistic-lsp` (all `image_revision: "3"`); probe ids `cc-v2-probe-plain`, `cc-v2-probe-realistic`, `cc-v2-probe-hooks`, `cc-v2-probe-subagent`, `cc-v2-probe-budget` (all `image_revision: "3-dev-M9-07"`, all moved together to `"3-dev-M9-13"` if M9-13 takes the fallback, and to `"3"` by M9-17 Step 1); experiment `cc-v2-factorial` (M11-16 Step 1 adds `contrasts`, `interaction` and `preregistration`; M11-17b sets `tasks` and `repeats`; appendix section 10).

- [ ] **Step 1: Write the failing test** `tests/unit/harness/v2-configs.test.ts`:

```typescript
import { assert, assertEquals } from "@std/assert";
import {
  checkModelsInCatalog,
  loadConfig,
  loadExperiment,
} from "../../../src/harness/config.ts";

/** Spec v2 section 7: the 2x2 arms differ only in the realistic bundle and the LSP. */
const ARMS = [
  "cc-v2-plain",
  "cc-v2-plain-lsp",
  "cc-v2-realistic",
  "cc-v2-realistic-lsp",
];
const PROBES = [
  "cc-v2-probe-plain",
  "cc-v2-probe-realistic",
  "cc-v2-probe-hooks",
  "cc-v2-probe-subagent",
  "cc-v2-probe-budget",
];

Deno.test("v2 arms: one harness, campaign image revision, model, settings and limit; LSP toggles only lsp", async () => {
  const cfgs = await Promise.all(ARMS.map((a) => loadConfig("harness", a)));
  await checkModelsInCatalog(cfgs, "site/catalog");
  const [plain, plainLsp, real, realLsp] = cfgs;
  for (const c of cfgs) {
    assertEquals(
      [c.harness, c.harness_version, c.image_revision, c.settings],
      ["claude-code", "2.1.282", "3", {}],
      c.id,
    );
    assertEquals(c.models, plain!.models, c.id);
    assertEquals(c.limits, plain!.limits, c.id);
  }
  assertEquals(plain!.components.instructions, "bundles/env/instructions");
  assertEquals(real!.components, {
    ...plain!.components,
    instructions: "bundles/realistic/instructions",
    skills: "bundles/realistic/skills",
    agents: "bundles/realistic/agents",
    mcp: ["al-tools"],
  });
  assertEquals(plainLsp!.components, { ...plain!.components, lsp: ["al"] });
  assertEquals(realLsp!.components, { ...real!.components, lsp: ["al"] });
});

Deno.test("cc-v2-factorial: plain baseline, three variants, vary is exactly the bundle and the LSP", async () => {
  const { experiment, configs } = await loadExperiment("harness", "cc-v2-factorial");
  assertEquals(configs.map((c) => c.id), ARMS);
  assertEquals([...experiment.vary].sort(), [
    "agents",
    "instructions",
    "lsp",
    "mcp",
    "skills",
  ]);
  assertEquals(experiment.primary_metric, "cost_per_solved_task");
});

Deno.test("v2 probe configs: developmental, same model; never in an experiment", async () => {
  const plain = await loadConfig("harness", "cc-v2-plain");
  const real = await loadConfig("harness", "cc-v2-realistic");
  const revs = new Set<string | undefined>();
  for (const id of PROBES) {
    const c = await loadConfig("harness", id);
    assertEquals([c.harness_version, c.models], [plain.harness_version, plain.models], id);
    assert(/^3(-dev-M9-(07|13))?$/.test(c.image_revision ?? ""), `${id}: ${c.image_revision}`);
    revs.add(c.image_revision);
  }
  assertEquals(revs.size, 1, "every probe config runs the same image revision");
  assertEquals((await loadConfig("harness", "cc-v2-probe-plain")).components, plain.components);
  assertEquals((await loadConfig("harness", "cc-v2-probe-realistic")).components, real.components);
  assertEquals((await loadConfig("harness", "cc-v2-probe-hooks")).components.hooks, "bundles/probe-m9/hooks");
  assertEquals((await loadConfig("harness", "cc-v2-probe-budget")).limits.max_budget_usd, 0.5);
  for await (const e of Deno.readDir("harness/experiments")) {
    const text = await Deno.readTextFile(`harness/experiments/${e.name}`);
    for (const p of PROBES) assert(!text.includes(p), `${e.name} names ${p}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/harness/v2-configs.test.ts`
Expected: FAIL (`harness/configs/cc-v2-plain.yml` not found).

- [ ] **Step 3: Write the configs.**

`harness/configs/cc-v2-plain.yml`:
```yaml
# Harness v2 2x2 (spec v2 section 7): realistic off, LSP off. Baseline of cc-v2-factorial.
id: cc-v2-plain
harness: claude-code
harness_version: "2.1.282"
image_revision: "3"
models:
  main: anthropic/claude-sonnet-5
settings: {}
components:
  instructions: bundles/env/instructions
limits: { timeout_min: 30, max_budget_usd: 5 }
```
`harness/configs/cc-v2-plain-lsp.yml`: same with `id: cc-v2-plain-lsp`, comment `realistic off, LSP on (component al from M10)`, and `lsp: [al]` under components.

`harness/configs/cc-v2-realistic.yml`:
```yaml
# Harness v2 2x2: realistic on, LSP off. The realistic bundle is one factor level, applied whole.
id: cc-v2-realistic
harness: claude-code
harness_version: "2.1.282"
image_revision: "3"
models:
  main: anthropic/claude-sonnet-5
settings: {}
components:
  instructions: bundles/realistic/instructions
  skills: bundles/realistic/skills
  agents: bundles/realistic/agents
  mcp: [al-tools]
limits: { timeout_min: 30, max_budget_usd: 5 }
```
`harness/configs/cc-v2-realistic-lsp.yml`: same plus `lsp: [al]`, `id: cc-v2-realistic-lsp`.

Probe configs (developmental only, never in an experiment; each starts with the comment `# M9 proof config (developmental). Never part of an experiment.` and `image_revision: "3-dev-M9-07"`):
- `cc-v2-probe-plain.yml`: components of `cc-v2-plain`.
- `cc-v2-probe-realistic.yml`: components of `cc-v2-realistic`.
- `cc-v2-probe-hooks.yml`: components of `cc-v2-plain` plus `hooks: bundles/probe-m9/hooks` (expects `setup_failed`).
- `cc-v2-probe-subagent.yml`: components of `cc-v2-realistic` with `instructions: bundles/probe-m9/subagent/instructions`.
- `cc-v2-probe-budget.yml`: components of `cc-v2-realistic` with `instructions: bundles/probe-m9/budget/instructions`, `limits: { timeout_min: 30, max_budget_usd: 0.5 }`.

`harness/bundles/probe-m9/hooks/settings.json`: `{ "hooks": {} }`

`harness/bundles/probe-m9/subagent/instructions/CLAUDE.md`:
```
This is a harness probe, not a benchmark run. Before working on the task, do these steps in order:
1. Start the library-function-finder agent in the background with the task statement as its prompt.
2. Run the Explore agent once in the foreground to list the app folders under C:\workspace.
3. If the background agent is still running, stop it with TaskStop.
4. Run the al-reviewer agent once in the foreground on the workspace.
Then solve the task in C:\task\prompt.md. Build and test with `cg-al compile` and `cg-al test`.
```

`harness/bundles/probe-m9/budget/instructions/CLAUDE.md` (deterministic overlapping background work that outruns a 0.5 USD budget):
```
This is a harness probe, not a benchmark run. Do these steps in order and do not skip any:
1. In ONE message, start three agents in the background at the same time:
   a. library-function-finder: "Read every .al file under C:\workspace one by one and write a two-line summary of each."
   b. library-function-finder: "Read every .al file under C:\workspace in reverse alphabetical order and list every procedure in each."
   c. al-reviewer: "Review every .al file under C:\workspace one by one for naming conventions."
2. Do not wait for them. While they run, read every .al file under C:\workspace yourself and summarize each.
3. Then check on the agents and continue until they finish.
```

`harness/experiments/cc-v2-factorial.yml`:
```yaml
# Harness v2 confirmatory campaign skeleton (spec v2 section 7): realistic {off,on} x LSP {off,on}.
#   cc-v2-plain          realistic off, LSP off   baseline
#   cc-v2-plain-lsp      realistic off, LSP on    C1 = plain-lsp vs plain
#   cc-v2-realistic      realistic on,  LSP off   C3 = realistic vs plain ("realistic effect without LSP")
#   cc-v2-realistic-lsp  realistic on,  LSP on    C2 = realistic-lsp vs realistic
# Contrasts, Holm family, seeds and arm-order randomization: M11 pre-registration stage A.
# tasks and repeats: set at the M8 freeze (stage B design numbers); the v1 set stands in until
# then so `harness validate` stays green. Arms resolve only on the one r3 image (M9-17).
id: cc-v2-factorial
hypothesis: "The AL language server and the realistic team setup each lower Claude Code's cost per solved task on the frozen v2 task population."
primary_metric: cost_per_solved_task
baseline: cc-v2-plain
variants: [cc-v2-plain-lsp, cc-v2-realistic, cc-v2-realistic-lsp]
vary: [instructions, skills, agents, mcp, lsp]
tasks: "harness-tasks/tasks/*"
repeats: 5
```

- [ ] **Step 4: Run the test and the static validator**

Run: `deno test --allow-all tests/unit/harness/v2-configs.test.ts` then `deno task start harness validate`
Expected: PASS; validator prints `[OK] experiment cc-v2-factorial (4 arms)` and no problem for the nine new configs.

- [ ] **Step 5: Commit**

```bash
git add harness/configs/cc-v2-*.yml harness/experiments/cc-v2-factorial.yml harness/bundles/probe-m9 tests/unit/harness/v2-configs.test.ts
git commit -m "feat(harness): v2 2x2 arm configs, proof configs and the factorial experiment skeleton (M9-08)"
```

### Task M9-09: realistic bundle lint (layout, frontmatter, hygiene, leakage identifiers, LSP wording, imports)

**Lane:** lane-infra2. **Deps:** none (written first; fails until M9-10/M9-11 land). **May touch:** `tests/unit/harness/realistic-bundle.test.ts`.

**Interfaces:**
- Produces: the exact layout lane-content must deliver: `instructions/CLAUDE.md`, `instructions/rules/{al-conventions,breaking-changes,code-navigation,testing}.md`, `skills/{al-compile,al-reuse-lookup,al-symbols,al-test}/SKILL.md`, `agents/{al-reviewer,al-test-writer,library-function-finder}.md`; the sentence `If an LSP tool is available` as the only allowed way to mention an LSP; `@` imports only to files inside the bundle's `rules/`.

- [ ] **Step 1: Write the test** `tests/unit/harness/realistic-bundle.test.ts`:

```typescript
import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { parse } from "@std/yaml";
import { claudeCodeHarnessNative } from "../../../src/harness/adapters/claude-code.ts";
import { loadTask } from "../../../src/harness/task.ts";

/** Spec v2 section 4: the realistic bundle, linted for shape and for leakage. */
const BUNDLE = "harness/bundles/realistic";
const RULES = ["al-conventions.md", "breaking-changes.md", "code-navigation.md", "testing.md"];
const SKILLS = ["al-compile", "al-reuse-lookup", "al-symbols", "al-test"];
const AGENTS = ["al-reviewer", "al-test-writer", "library-function-finder"];

async function files(dir: string): Promise<{ rel: string; text: string }[]> {
  const out: { rel: string; text: string }[] = [];
  for await (const e of walk(dir, { includeDirs: false })) {
    out.push({ rel: relative(dir, e.path).replaceAll("\\", "/"), text: await Deno.readTextFile(e.path) });
  }
  return out.sort((a, b) => a.rel < b.rel ? -1 : 1);
}
function frontMatter(text: string): Record<string, unknown> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const fm = parse(m[1]!);
  return fm !== null && typeof fm === "object" ? fm as Record<string, unknown> : {};
}

Deno.test("realistic bundle: exact layout", async () => {
  assertEquals((await files(`${BUNDLE}/instructions`)).map((f) => f.rel), ["CLAUDE.md", ...RULES.map((r) => `rules/${r}`)]);
  assertEquals((await files(`${BUNDLE}/skills`)).map((f) => f.rel), SKILLS.map((s) => `${s}/SKILL.md`));
  assertEquals((await files(`${BUNDLE}/agents`)).map((f) => f.rel), AGENTS.map((a) => `${a}.md`));
});

Deno.test("realistic bundle: skill and agent names equal their folder or file; agents inherit the model; rules carry no frontmatter", async () => {
  for (const s of SKILLS) {
    const fm = frontMatter(await Deno.readTextFile(join(BUNDLE, "skills", s, "SKILL.md")))!;
    assertEquals(fm["name"], s);
    assert(typeof fm["description"] === "string" && fm["description"].trim() !== "", `${s}: description`);
  }
  const disallowed: string[] = claudeCodeHarnessNative().disallowed_tools;
  for (const a of AGENTS) {
    const fm = frontMatter(await Deno.readTextFile(join(BUNDLE, "agents", `${a}.md`)))!;
    assertEquals(fm["name"], a);
    assert(typeof fm["description"] === "string" && fm["description"].trim() !== "", `${a}: description`);
    // Spec v2 gate 3: the subagent model is pinned by run.ps1, never by the bundle.
    assertEquals(fm["model"], "inherit", `${a}: model`);
    const tools = typeof fm["tools"] === "string" ? fm["tools"].split(",").map((t) => t.trim()) : [];
    for (const t of tools) assert(!disallowed.includes(t), `${a} grants disallowed tool ${t}`);
  }
  for (const r of RULES) {
    assertEquals(frontMatter(await Deno.readTextFile(join(BUNDLE, "instructions", "rules", r))), null, `${r}: always loaded, no paths`);
  }
});

/** Pattern, why it may not appear. Spec v2 section 4: no customer data, internal hosts, credentials or source tooling. */
const FORBIDDEN: [RegExp, string][] = [
  [/\u2014/, "em dash"],
  [/HX-?\d/i, "task id"],
  [/\bCGR\b/, "refapp prefix"],
  [/\b(?:70|8\d)\d{3}\b/, "refapp or test object id"],
  [/\b(?:vehicles?|leas(?:e|es|ing)|rentals?|outbox|damages?|fleets?)\b/i, "refapp domain noun"],
  [/\b(?:oracle|mutant|hidden tests?|reference solution|naive variant)\b/i, "benchmark internals"],
  [/https?:\/\//i, "URL"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "IP address"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "GUID"],
  [/continia|document (?:output|capture)|delivery network|zendesk|azure devops|lethal|DO\.Support/i, "source company or its tooling"],
  [/cronus\d*|sshadows|password|passwd|api[_ -]?key|bearer|oauth/i, "host or credential"],
  [/\b[\w-]+\.(?:local|corp|internal|lan)\b/i, "internal host"],
];

Deno.test("realistic bundle: no task, refapp, benchmark, host, credential or source-company text", async () => {
  for (const f of await files(BUNDLE)) {
    for (const [re, why] of FORBIDDEN) assert(!re.test(f.text), `${f.rel}: ${why} (${re})`);
  }
});

const OBJECT = /^\s*(?:codeunit|table|page|report|query|xmlport|enum|interface|permissionset|tableextension|pageextension|enumextension|reportextension)\s+(?:\d+\s+)?(?:"([^"]+)"|(\w+))/gim;
const PROC = /\bprocedure\s+(?:"([^"]+)"|(\w+))\s*\(/gi;
/** BC platform trigger and test-pattern names a team setup may say; none is specific to a task or the refapp. */
const GENERIC = new Set(["initialize", "onrun", "onvalidate", "oninsert", "onmodify", "ondelete", "onrename"]);

/**
 * Every object and procedure name in the refapp and in every task's files,
 * plus every oracle procedure named in a task.yml, read through the task
 * schema (quoted names and block lists included).
 */
async function leakIdentifiers(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const add = (name: string, where: string) => {
    const k = name.trim().toLowerCase();
    if (k.length >= 6 && !GENERIC.has(k) && !out.has(k)) out.set(k, where);
  };
  for await (const e of walk("harness-tasks", { includeDirs: false, exts: [".al"] })) {
    const text = await Deno.readTextFile(e.path);
    for (const re of [OBJECT, PROC]) for (const m of text.matchAll(re)) add((m[1] ?? m[2])!, e.path);
  }
  for await (const e of walk("harness-tasks", { includeDirs: false, match: [/task\.yml$/] })) {
    const { task } = await loadTask(dirname(e.path));
    for (const g of [...task.pass_to_pass, ...(task.fail_to_pass?.tests ?? [])]) {
      for (const p of g.procedures) add(p, e.path);
    }
  }
  return out;
}

Deno.test("realistic bundle: names no object, procedure or oracle check of the refapp or any task", async () => {
  const ids = await leakIdentifiers();
  assert(ids.size > 50, `identifier harvest looks broken: ${ids.size}`);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const f of await files(BUNDLE)) {
    const text = f.text.toLowerCase();
    for (const [k, where] of ids) {
      assert(!new RegExp(`(^|[^a-z0-9_])${esc(k)}($|[^a-z0-9_])`).test(text), `${f.rel} names "${k}" from ${where}`);
    }
  }
});

Deno.test("realistic bundle: every LSP mention is capability-conditional, and CLAUDE.md states the condition", async () => {
  const all = await files(BUNDLE);
  for (const f of all) {
    for (const line of f.text.split(/\r?\n/)) {
      if (/\bLSP\b|language server/i.test(line)) {
        assert(/if an LSP tool is available/i.test(line), `${f.rel}: unconditional LSP mention: ${line}`);
      }
    }
  }
  const claude = all.find((f) => f.rel === "instructions/CLAUDE.md");
  assert(claude, "instructions/CLAUDE.md present");
  assert(claude.text.includes("If an LSP tool is available"));
});

Deno.test("realistic bundle: memory imports resolve only to audited rules inside the bundle", async () => {
  const rules = new Set(RULES.map((r) => `rules/${r}`));
  for (const f of await files(`${BUNDLE}/instructions`)) {
    for (const m of f.text.matchAll(/(^|\s)@([^\s`]+)/g)) {
      assert(rules.has(m[2]!), `${f.rel}: import @${m[2]} is not a bundle rule file`);
    }
  }
});

Deno.test("al-compile skill states cg-al's usage line exactly", async () => {
  const ps1 = await Deno.readTextFile("harness/images/base/cg-al.ps1");
  const usage = ps1.match(/^# Usage: (.+)$/m)?.[1]?.trim();
  assert(usage, "cg-al.ps1 has a Usage line");
  assert((await Deno.readTextFile(join(BUNDLE, "skills", "al-compile", "SKILL.md"))).includes(usage));
});
```

The import test also forbids incidental `@word` text in instructions (an `@` followed by a non-rule path); lane-content writes no such text.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all tests/unit/harness/realistic-bundle.test.ts`
Expected: FAIL on layout (`harness/bundles/realistic/instructions` missing), NOT on "identifier harvest looks broken" (that would mean the harvest itself is wrong; fix the harvest first).

- [ ] **Step 3: Commit the failing test** on the lane branch (it gates M9-10/M9-11):

```bash
git add tests/unit/harness/realistic-bundle.test.ts
git commit -m "test(harness): realistic bundle lint and leakage identifiers (M9-09, red until the bundle lands)"
```

### Task M9-10: CLAUDE.md v2 and the four rules

**Lane:** lane-content. **Deps:** M9-09 (the lint is the acceptance), M9-01 decision on user-scope rules. **May touch:** `harness/bundles/realistic/instructions/**`.

Inspiration only: `U:\Git\DO.Support-NewFormat\.claude\` (rules `USE-AL-LSP-TOOLS.md`, `breakingchanges.md`; agents `al-unit-test-writer.md`, `library-function-investigator.md`, `code-review-validator.md`). Copy no sentence, product name, path, host, ADO/Zendesk reference or customer term. General AL knowledge only. No hints that map to a task trap: a rule may say "follow the existing pattern", never a specific numeric, rounding, locking or ordering rule that turns a known naive variant (`harness-tasks/tasks/*/naive/*` folder names) into the correct one.

- [ ] **Step 1: Write `harness/bundles/realistic/instructions/CLAUDE.md`** with these sections, in this order:
  1. `# Team conventions` with the environment facts, worded as a team would: the repository is at `C:\workspace`, one folder per Business Central app with its `app.json`; the task statement is in `C:\task\prompt.md`; builds and tests run only through `cg-al compile [App ...]`, `cg-al test [codeunit ...]`, `cg-al symbols` (compiles and runs tests on a Business Central server and prints JSON).
  2. `## How we work`: read the task; find the objects involved by searching before reading whole files; before writing a new procedure, look for an existing procedure, event or interface to reuse (the `al-reuse-lookup` skill or the `library-function-finder` agent); make the smallest change that meets the task; compile; run the tests; have `al-reviewer` review before finishing.
  3. `## Code navigation`: the exact sentence `If an LSP tool is available, use it first for symbols, definitions, references and diagnostics, and fall back to search when it has no answer.` No other LSP sentence anywhere in the bundle unless it starts the same way.
  4. `## Delegation`: when to use `al-test-writer` (tests for a change), `al-reviewer` (conventions, breaking changes, missing tests), `library-function-finder` (existing code to reuse).
  5. `## Rules`: one line pointing at the rules files by topic (they load from the user scope; if M9-01 ruled the import fallback, one `@rules/<file>.md` line per rule here instead, nothing else starting with `@`).
- [ ] **Step 2: Write the four rules** (no frontmatter, plain Markdown, 30 to 120 lines each):
  - `rules/al-conventions.md`: naming (PascalCase objects and procedures; follow the prefix and ID range the app already uses, read from `app.json`); one object per file, `<Name>.<ObjectType>.al`; labels for user-facing text; `Error` with labels; `local` by default, public only when another app needs it; events: integration events for extension points, subscribers in their own codeunits; record access (`SetLoadFields`, `FindSet` for loops, `IsEmpty` for existence); no `Commit` in business logic.
  - `rules/testing.md`: test codeunits `Subtype = Test`; Given/When/Then comments; `Library Assert` with exact expected values; one behaviour per test procedure; handler functions for UI; never a placeholder assertion; run only the affected codeunits while iterating, all before finishing.
  - `rules/breaking-changes.md`: do not remove or rename public procedures, fields, enum values or event publishers; do not change a public signature or an event's parameters; obsolete instead of removing; table field type and length changes; enum extensibility; keep existing behaviour for existing callers.
  - `rules/code-navigation.md`: starts with the same exact sentence as CLAUDE.md section 3; then search fallbacks (Grep for `procedure <Name>`, `[IntegrationEvent`, `implements`, object names; read `app.json` dependencies; `cg-al symbols` for packages).
- [ ] **Step 3: Run the lint**

Run: `deno test --allow-all tests/unit/harness/realistic-bundle.test.ts --filter "no task|LSP|names no object|imports"`
Expected: those PASS for the instructions files (layout fails until M9-11).
- [ ] **Step 4: Commit**

```bash
git add harness/bundles/realistic/instructions
git commit -m "feat(harness): realistic CLAUDE.md v2 and team rules (M9-10)"
```

### Task M9-11: realistic skills (cg-al wrappers) and the three subagents

**Lane:** lane-content. **Deps:** M9-09, M9-10. **May touch:** `harness/bundles/realistic/skills/**`, `harness/bundles/realistic/agents/**`.

- [ ] **Step 1: Skills** (frontmatter `name` = folder, one-line `description` that says when to use it; may adapt wording from `harness/bundles/al-skills/skills/al-build-loop/SKILL.md`, which already passed the v1 checks):
  - `al-compile/SKILL.md`: states the line `cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version` verbatim (from `cg-al.ps1` `# Usage:`), how to read `result.ok` and per-app diagnostics, the exit-code table copied from `al-build-loop`, one request at a time.
  - `al-test/SKILL.md`: `cg-al test` with and without codeunit numbers; reading per-test outcomes; iterate on the failing codeunit, then run all.
  - `al-symbols/SKILL.md`: `cg-al symbols`; how to relate packages to `app.json` dependencies.
  - `al-reuse-lookup/SKILL.md`: before writing a procedure: search the app, then its dependency apps in the workspace (Grep patterns for procedures, integration events, interfaces), then the symbol packages list; report candidates as `file:line` with signature; prefer calling an existing procedure over a copy.
- [ ] **Step 2: Agents** (frontmatter exactly `name`, `description`, `model: inherit`; optional `tools: Read, Grep, Glob, Bash` for the two read-only agents):
  - `al-test-writer.md`: writes test codeunits for a change in the test app, following `rules/testing.md`; runs them with `cg-al test`; reports which pass.
  - `al-reviewer.md`: reviews the changed files against `rules/al-conventions.md` and `rules/breaking-changes.md`, flags missing tests, compiles once; read-only, returns findings with `file:line`.
  - `library-function-finder.md`: the `al-reuse-lookup` procedure as an agent; read-only; returns a ranked list of candidates with signature and why each fits.
- [ ] **Step 3: Run the full lint**

Run: `deno test --allow-all tests/unit/harness/realistic-bundle.test.ts`
Expected: PASS (all 8).
- [ ] **Step 4: Commit**

```bash
git add harness/bundles/realistic/skills harness/bundles/realistic/agents
git commit -m "feat(harness): realistic skills over cg-al and the al-test-writer, al-reviewer, library-function-finder agents (M9-11)"
```

### Task M9-12: leakage audit before screening, bundle hash lock, re-audit at freeze

**Lane:** lane-content (fixes) + orchestrator (audit dispatch and verdict) + lane-infra2 (lock test). **Deps:** M9-11; M8 candidate list (each candidate after its A6 audit; the start set after M8-14, 10-21; wave 4 after M8-13; replacements after M8-17). **Target:** audits from 10-07 as candidates land; start-seal audit and the Step 3 lock 10-21..24 (M8-15b, 10-25, depends on the lock); later seals before their pilots. **May touch:** `harness/bundles/realistic/**` (fixes only, before the lock), `tests/unit/harness/realistic-bundle.test.ts` (lock test), `H:\cg-coord\reviews\M9-leak\**`, `H:\cg-coord\m9\bundle-lock.md`.

Order (review finding 8): every task that will be screened is audited BEFORE its first pilot cell; the bundle hashes are locked before any pilot outcome is seen; the frozen set and the held-outs are re-audited at freeze; a substantive bundle change after the lock re-opens screening for the affected tasks.

- [ ] **Step 1: Audit dispatch.** The orchestrator runs `al-test-auditor` once per task directory: all v1 tasks now, then each M8 candidate and held-out task as soon as it is authored (and always before its first pilot cell), with this brief:

```
Read-only leakage audit (Harness v2 spec section 4). Inputs: every file under
harness/bundles/realistic/ and harness/bundles/env/; the task at <task dir>: prompt.md,
task.yml, oracle/, correct/, every naive/<variant>/. Question: does any bundle sentence
(a) name the task's fix, an object or procedure the fix adds or changes, or an oracle check;
(b) state a rule specific enough that following it turns one of the naive variants into the
correct solution (quote the naive folder name and the bundle sentence); (c) hint at the
platform behaviour the task's trap relies on. Answer per finding: bundle file:line, task
file:line, class (a/b/c), and whether generic AL guidance (would appear in any BC team's
rules) or task-specific. No finding: say "none" with the files you read.
```

- [ ] **Step 2: Verdicts.** Task-specific class a or b findings are blocking; class c and generic-guidance findings are ruled one by one in `H:\cg-coord\reviews\M9-leak\verdict.md`. A blocking finding is fixed in the bundle (never in a task) by lane-content, followed by `deno test --allow-all tests/unit/harness/realistic-bundle.test.ts` and a re-audit of every task already audited (a bundle change can leak into any of them).
- [ ] **Step 3: Lock before the pilot.** When every screening candidate has a clean verdict and before the first pilot cell, lane-infra2 resolves the realistic manifest and pins its component hashes in the lint file:

```typescript
/** M9-12 lock (spec v2 section 3 item 5): the audited bundle, fixed before any pilot outcome. */
const LOCK = {
  instructions: "<instructions hash from resolveManifest>",
  skills: "<skills hash>",
  agents: "<agents hash>",
};

Deno.test("realistic bundle: hashes equal the pre-screening lock", async () => {
  const config = await loadConfig("harness", "cc-v2-realistic");
  const m = await resolveManifest("harness", config, {
    native_settings: {},
    image: { digest: "sha256:img", base_digest: "sha256:base" },
    backend_version: "b",
    servers: { "al-tools": { version: "1", tool_schema_hash: "h" } },
    provider_routes: { main: "anthropic" },
  });
  assertEquals(
    { instructions: m.instructions!.hash, skills: m.skills!.hash, agents: m.agents!.hash },
    LOCK,
  );
});
```

The three hash strings are the values the resolver prints on the lock day (copied into `LOCK` and into `H:\cg-coord\m9\bundle-lock.md` with the date and the audited task list); the test fails on any later byte change.
- [ ] **Step 4: Freeze re-audit.** At the M8 freeze, repeat Step 1 for the frozen set and the held-outs. A blocking finding after the lock means: fix the bundle, update `LOCK` with an orchestrator decision record, and repeat screening for every task whose pilot ran under the old bundle. The frozen manifest's bundle hashes must equal `LOCK`.

### Task M9-13: live subagent cost completeness and aggregate budget (gate 3, live half)

**Lane:** lane-ops. **Deps:** M9-06, M9-07 (dev image), M9-08. **May touch:** `H:\cg-coord\m9\gate3\**`, `tests/fixtures/harness/claude-code/m9-subagents.jsonl`, `tests/fixtures/harness/claude-code/m9-budget.jsonl`.

- [ ] **Step 1: Subagent accounting.** Owner runs `deno task start harness cell cc-v2-probe-subagent HX-003`. Verify from the published (redacted) `raw.jsonl` and `trace.jsonl`:
  - at least two `subagent_spawn` events (one Explore, one bundle agent), and the background agent either stopped by `TaskStop` after it streamed usage (record the tool call line) or finished first (record which);
  - `raw_usage.usage_reconciliation.status` is `exact` (gate 3 evidence; a `compaction_excess` run keeps its cost but does not count: rerun the cell);
  - `component_inventory` empty (so every assistant model, `resolvedModel` and `modelUsage` key was `claude-sonnet-5`);
  - `telemetry.cost_usd` non-null.
- [ ] **Step 2: Aggregate budget with overlapping background agents.** Owner runs `deno task start harness cell cc-v2-probe-budget HX-003` (`max_budget_usd: 0.5`). Pass requires ALL of:
  1. termination `budget_exhausted`;
  2. interleaving: in record order before the result there are positions i < j < k with child A at i, a different child B at j and A again at k (by `parent_tool_use_id`), so the children ran concurrently, not one after the other;
  3. paid cancellation: at least one child streamed assistant usage with a non-zero count and has no `tool_use_result.usage`;
  4. accounting through shutdown: `usage_reconciliation.status` is `exact`, cost non-null;
  5. no child continues after the stop: no `assistant` or `user` record carrying a `parent_tool_use_id`, and no second `system/init`, after the `budget_exhausted` result line;
  6. request lifecycle: the cell's egress proxy log (M7 P1/P2 route) shows no request to the API host that STARTED after the result line's time, and the sandbox's `confirmedGone` is true (container and its processes ended), so silence in the stream is backed by shutdown evidence;
  7. overshoot bound: `reported_cost_usd <= 1.2 x max_budget_usd` (owner-accepted default, round 3 decisions).
- [ ] **Step 3: Fallback if Step 2 fails or is inconclusive.** Unknown enforcement does not close gate 3. If M9-01 Run 4 showed `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` makes agents run in the foreground: lane-infra2 adds `$env:CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'` next to the subagent pin in run.ps1 (all arms, with a static test like M9-03's), a new proof image `3-dev-M9-13` is built (appendix section 1 guard first), lane-infra2 moves all five probe configs to `image_revision: "3-dev-M9-13"` in the same commit (the M9-08 test accepts it), and Steps 1 and 2 are repeated with criteria 2 and 3 replaced by "no `isAsync` agent result in the log". If the switch is not honoured either: gate 3 stays open and the owner decides between a harness-side cost watchdog (new task) and a newer Claude Code version.
- [ ] **Step 4: Capture.** Copy the two published `raw.jsonl` files (already redacted by the runner) to `tests/fixtures/harness/claude-code/m9-subagents.jsonl` and `m9-budget.jsonl`; grep both for `sk-ant-`, `oat01`, host user paths and the proxy credential pattern before handing them to M9-14 (any hit: stop, do not commit).
- [ ] **Step 5:** Write `H:\cg-coord\m9\gate3\evidence-dev.md`: cell ids, reconciliation status per run, the seven budget criteria with line numbers (proxy log lines for criterion 6), the fallback taken (if any).

### Task M9-14: pin the live gate 3 facts as fixture tests

**Lane:** lane-infra2. **Deps:** M9-13. **May touch:** `tests/unit/harness/subagent-cost.test.ts`, the two fixtures (read-only).

- [ ] **Step 1: Write the tests** (append to `subagent-cost.test.ts`, reusing its `parse`, `recon`, `missing`):

```typescript
// deno-lint-ignore no-explicit-any -- recorded stream-json, shape asserted below
type Rec = Record<string, any>;
const recsOf = async (f: string): Promise<Rec[]> =>
  (await Deno.readTextFile(`tests/fixtures/harness/claude-code/${f}`)).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

Deno.test("gate 3 live (M9-13): sub-agents ran on the pinned model and the run reconciles", async () => {
  const recs = await recsOf("m9-subagents.jsonl");
  assert(recs.some((r) => r.type === "assistant" && typeof r.parent_tool_use_id === "string"), "a sub-agent ran");
  const result = recs.findLast((r) => r.type === "result")!;
  assertEquals(Object.keys(result.modelUsage), ["claude-sonnet-5"]);
  const r = await parse(recs.map((x) => JSON.stringify(x)));
  assertEquals(recon(r), { status: "exact" });
  assert(r.telemetry.cost_usd !== null, missing(r));
});

Deno.test("gate 3 live (M9-13): the budget stop covers interleaved, cancelled-after-paid sub-agent work, within the bound, and nothing runs after it", async () => {
  const recs = await recsOf("m9-budget.jsonl");
  const at = recs.findLastIndex((r) => r.type === "result");
  assertEquals(recs[at]!.subtype, "error_max_budget_usd");
  const childSeq = recs.slice(0, at)
    .filter((r) => r.type === "assistant" && typeof r.parent_tool_use_id === "string")
    .map((r) => r.parent_tool_use_id as string);
  // Interleaving: some child A, then another child B, then A again.
  const interleaved = childSeq.some((a, i) => {
    const j = childSeq.findIndex((b, x) => x > i && b !== a);
    return j > 0 && childSeq.slice(j + 1).includes(a);
  });
  assert(interleaved, `children ran one after the other: ${childSeq.join(",")}`);
  // Paid cancellation: a child that streamed usage but never returned a final usage.
  const paid = new Set(
    recs.slice(0, at).filter((r) =>
      r.type === "assistant" && typeof r.parent_tool_use_id === "string" &&
      ((r.message?.usage?.input_tokens ?? 0) + (r.message?.usage?.output_tokens ?? 0)) > 0
    ).map((r) => r.parent_tool_use_id),
  );
  const finished = new Set(
    recs.filter((r) => r.type === "user" && r.tool_use_result?.usage)
      .flatMap((r) => (r.message?.content ?? []).map((c: Rec) => c.tool_use_id)),
  );
  assert([...paid].some((p) => !finished.has(p)), "no child was cancelled after paid work");
  assert(
    !recs.slice(at + 1).some((r) =>
      typeof r.parent_tool_use_id === "string" || (r.type === "system" && r.subtype === "init")
    ),
    "no child work and no resumed session after the stop",
  );
  assert(recs[at]!.total_cost_usd <= 1.2 * 0.5, `overshoot: ${recs[at]!.total_cost_usd}`);
  const r = await parse(recs.map((x) => JSON.stringify(x)));
  assertEquals(r.termination, "budget_exhausted");
  assertEquals(recon(r), { status: "exact" });
});
```

If M9-13 took the Step 3 fallback, the second test asserts instead that no agent result carries `isAsync: true` and keeps the stop, overshoot and reconciliation assertions. The proxy-log and `confirmedGone` evidence (M9-13 criterion 6) is not in the stream; it stays in `evidence-dev.md` and `evidence-r3.md`.

- [ ] **Step 2: Run** `deno test --allow-all tests/unit/harness/subagent-cost.test.ts`. Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add tests/unit/harness/subagent-cost.test.ts tests/fixtures/harness/claude-code/m9-subagents.jsonl tests/fixtures/harness/claude-code/m9-budget.jsonl
git commit -m "test(harness): live gate 3 recordings pin sub-agent reconciliation and the overlapping budget stop (M9-14)"
```

### Task M9-15: evidence for what M9 closes alone

**Lane:** orchestrator. **Deps:** M9-07, M9-12 (Steps 1 and 2 for every task authored so far; the Step 3 lock comes later, 10-21..24, and gates M8-15b, not this task), M9-14. **Target:** 10-15..17. **May touch:** `H:\cg-coord\m9\gates.md`, `H:\cg-coord\milestones.json` entry for M9.

- [ ] **Step 1:** Full harness suite green on master after the M9 merges: `deno test --allow-all --ignore=tests/unit/container tests/unit/harness tests/unit/cli/commands/harness-command.test.ts > <scratch>/m9-final.log 2>&1`; `deno task start harness validate` clean.
- [ ] **Step 2:** `gates.md`, part 1 (developmental): gate 1 host tests (M9-02), adapter (M9-04), execution (M9-05), dev live (M9-07); gate 3 fixtures (M9-06), dev live and pins (M9-13/14) with the budget verdict; leakage audit and bundle lock (M9-12); dev image digest; parser version owner per ruling 2.
- [ ] **Step 3:** Gate 3 sign-off: M11's owner co-signs the gate 3 section (ruling 4: M11 consumes `usage_reconciliation`, `component_evidence` and the per-model usage; it re-implements none of them). Both names and the date go into `gates.md`.
- [ ] **Step 4:** State in `gates.md` that M8 screening may not start until M9-17 is done (spec 12 item 3), and list the hand-offs: M10 owns `LSP_PLUGINS.al` values and the run.ps1 LSP preflight; M11 consumes the usage fields; M8 freeze triggers M9-12 Step 4; M11-16 adds `contrasts`/`interaction`/`preregistration` and M11-17b rewrites `tasks`/`repeats` in `cc-v2-factorial.yml` (appendix section 10).

### Task M9-17: the one r3 image; integrated gate 1 for all four arms; gate 3 repeated

**Lane:** lane-infra2 (Step 1), lane-ops (Steps 2 to 5), orchestrator (Step 6). **Deps:** M9-15; M10-04 to M10-07 merged (LSP layer, `LSP_PLUGINS.al` values from S1) and M10-08 green on its dev image; H-01 merged. **Target:** r3 built 10-18; Steps 3 to 6 by 10-21. M10-09 verifies the LSP parts on the r3 this task builds (it depends on Step 2, not the reverse). **May touch:** `harness/configs/cc-v2-probe-*.yml` (Step 1), `H:\cg-coord\m9\gate1\**`, `H:\cg-coord\m9\gate3\**`, `H:\cg-coord\m9\gates.md`.

- [ ] **Step 1 (infra2):** Flip the five probe configs from `image_revision: "3-dev-M9-07"` (or `3-dev-M9-13` after a fallback) to `"3"`; `deno test --allow-all tests/unit/harness/v2-configs.test.ts` PASS; commit `chore(harness): v2 proof configs move to the campaign image r3 (M9-17)`.
- [ ] **Step 2:** Build once from merged M9+M10, after the appendix section 1 guard (`if DOCKER_CONTEXT=desktop-windows docker image inspect centralgauge/harness-claude-code:2.1.282-r3 >/dev/null 2>&1; then echo "[FAIL] r3 exists"; exit 1; fi`): `deno task start harness images build claude-code --version 2.1.282 --revision 3`. Record the digest; `2.1.282`, `-r2` and every `-r3-dev-*` digest unchanged. This tag is never rebuilt (ruling 1). Tell M10-09 the digest.
- [ ] **Step 3: Integrated gate 1, all four arms** (owner runs, lane-ops verifies as in M9-07): `harness cell <arm> HX-003` for `cc-v2-plain`, `cc-v2-plain-lsp`, `cc-v2-realistic`, `cc-v2-realistic-lsp`. Each: `cg_inventory ok` with `installed` equal to its declared set per appendix section 3 (`["instructions"]`, `["instructions","lsp:al"]`, `["agents","instructions","skills"]`, `["agents","instructions","lsp:al","skills"]`); `loaded_components` equal to its requested components (`lsp:al` exactly on the two LSP arms); `component_inventory` empty; `unverified` empty. Plus `cc-v2-probe-hooks` refused as before.
- [ ] **Step 4: Gate 3 repeated on r3:** M9-13 Steps 1 and 2 with the flipped probe configs; same criteria (only `exact` runs count).
- [ ] **Step 5:** `H:\cg-coord\m9\gate1\evidence-r3.md`, `H:\cg-coord\m9\gate3\evidence-r3.md`.
- [ ] **Step 6 (orchestrator):** `gates.md` part 2: integrated gate 1 and gate 3 on r3, M11 co-sign repeated for gate 3; M8 screening unblocked from M9's side.

---

## Open questions (owner or orchestrator)

Answered 2026-10-03 (owner, round 3 decisions): overshoot bound 1.2x; compacted runs keep cost with the excess recorded (tightened attribution, never gate 3 evidence); USD 5 cell budget for all four arms. Answered by the appendix: `tasks`/`repeats` of `cc-v2-factorial.yml` are set by M11-17b; `LSP_PLUGINS.al` is `{ name, source, path | null }` with values from M10-06. Still open:

1. pi's run.ps1 silently ignores an `instructions/rules/` folder. pi is out of v2, so no guard is added.
2. The M9-01 spike needs an egress route to the API for a non-cell container; lane-ops picks the M7 probe route and records it. The same route's proxy log serves M9-13 criterion 6.

## Review responses (round 1, `review-m9.md`)

| Finding | Response | Where |
| --- | --- | --- |
| 1 Blocking: coverage only a lower bound | Accepted. Replaced the lower bound with exact per-model reconciliation (input, cache read, cache write) of modelUsage against streamed messages plus each sub-agent's `tool_use_result.usage` (its unstreamed final request, verified on the recorded fixtures); inflated, doubled, omitted, child-without-stream, wrong-model, missing-field and cancelled-after-paid-work cases are fixtures; unreconciled = missing cost. Two partial deviations, argued: (a) output is checked only as a floor, because the stream carries partial output counts (probe: 9 streamed vs 2181 billed), so no exact output reconciliation exists to test against; (b) a compacted run may exceed and keeps its cost with the excess recorded, because the recorded compaction fixture shows Claude Code bills a summary request it never streams; treating every compacted cell as missing cost would bias the primary metric against long runs. Both are labelled in `usage_reconciliation` and listed as open question 2. | M9-06 |
| 2 Blocking: init/inventory not fail-closed | Accepted. Exactly one record before init; `ok` must equal "no problems"; `installed` must equal the declared installable set; init must carry valid `agents`/`skills`/`plugins`/`tools` lists; every assistant model, child `resolvedModel` and modelUsage key must equal `api_models.main`. | M9-04 |
| 2 (sub) installed vs loaded evidence | Accepted. `component_evidence` separates "installed (cg_inventory)" plus per-version loading qualification from "listed by system/init"; `BUILTIN_INVENTORY` carries the qualification; unknown versions refuse; imports may resolve only to audited bundle rules (lint). | M9-01, M9-04, M9-09 |
| 3 Blocking: every LSP plugin rejected | Accepted (ruling 3). One allow-list: built-in plugin sources plus `LSP_PLUGINS[name]` for each declared LSP component; `lsp:<name>` loads only with that plugin and the LSP tool; any other plugin or an undeclared LSP tool refuses. M10 fills the identity and its run.ps1 preflight, never a second inventory. | M9-04 |
| 4 Major: parser, telemetry, image conflicts | Accepted per rulings 1, 2. One r3 built after M9+M10 merge; proofs on `-dev-` tags (M9-16 enforces); parser bumped once by the first to merge; slug `al`; LSP telemetry is M10/M11's and M9 adds none. | M9-16, M9-04, M9-08, M9-17 |
| 5 Major: background budget proof weak | Accepted. Deterministic three-agent overlap probe; six pass criteria incl. cancellation after usage, reconciliation through shutdown, nothing after the stop, overshoot bound; unknown enforcement does not close the gate; fallback = background tasks disabled for all arms, else owner decides on a watchdog. | M9-08, M9-13, M9-14, M9-01 Run 4 |
| 6 Major: refusal plumbing | Accepted. Duplicate and malformed records are inventory problems (no throw); execution tests cover no record, duplicate, malformed, refused, record-only exit 5 and installer exception, each `setup_failed` with no judgment. | M9-04, M9-05 |
| 7 Test bug + YAML harvest | Accepted. CLAUDE.md is looked up as `instructions/CLAUDE.md` with an explicit presence assert; oracle procedure names come from `loadTask` (schema-parsed YAML). | M9-09 |
| 8 Major: audit timing | Accepted. Audit before each task's first pilot cell, hash lock before any pilot outcome (test-pinned), re-audit at freeze, any later substantive change re-runs affected screening. | M9-12 |
| Coverage: all four arms; screening prerequisite; M11 co-sign | Accepted. M9-17 integrated gate 1 on all four arms and gate 3 on r3; screening waits for M9-17; M11 co-signs gate 3. | M9-15, M9-17, Global Constraints |

## Self-review notes

- Spec 4 table: instructions (M9-10), rules (M9-03 + M9-10), skills (M9-11), agents (M9-03 + M9-11), mcp (M9-08). Fail-closed inventory: M9-02/03/04/05/07/17. Leakage: M9-09 lint + M9-12 audit and lock. LSP wording: M9-09 + M9-10.
- Spec 8.1: gate 1 evidence M9-15 (dev) and M9-17 (r3, four arms). Spec 8.3: M9-06 (child models, cache, cancellation, budget, omission, inflation), retries by the M2-11 fixture, live M9-13/14 and repeated in M9-17, pin M9-03 + M9-04 model check.
- Spec 12 item 3: screening waits for M9-17 (Global Constraints, M9-15 Step 4).
- Names across tasks and plans: `cg_inventory` keys; `inventoryProblems`; `INVENTORY_REVISION`, `inventoried()`; `BUILTIN_INVENTORY[v].qualified`; `LSP_PLUGINS`; `component_inventory`, `component_evidence`, `usage_reconciliation` in raw_usage; config ids `cc-v2-*`; LSP slug `al`; proof revision `3-dev-M9-07`. Round 3: all of these are checked against the appendix, which now owns them.

## Review responses (round 2, `H:\cg-coord\reviews\PLANS-v2-002\review-m9.md`)

| Finding | Response | Where |
| --- | --- | --- |
| 1 PARTLY: `exact` is input/cache equality plus an output floor; compaction exception too broad (any excess after any compaction; doubled child; cache excess; unseen models) | Accepted. `exact` is described as input and cache equality plus an output floor, not exact cost verification. The compaction exception now requires main-session-model input excess only, no cache excess, and an excess that equals no sub-agent's streamed or final input; unseen models are refused by the model-set check. Adversarial fixtures pin each case. The estimate stays separately labelled (owner default) but never closes gate 3: M9-13, M9-14, M9-17 and M11-14 count only `exact` runs. | M9-06, M9-13, M9-14, M9-17, appendix section 6 |
| 3 PARTLY: M9 and M10 LSP identity and installed set incompatible (`LSP_PLUGINS` vs `LSP_PLUGIN_SOURCES`; `lsp:al` in `installed` refused by M9's exact set) | Accepted. One identity `LSP_PLUGINS: { name, source, path | null }` (M9 type, M10 values); the exact installed set includes `lsp:<name>` for each declared LSP; the ONE positive check (preflight + plugin + tool) is in M9-04 and M10 adds none. | M9-04, M9-02 note, appendix sections 3 and 4 |
| 4 PARTLY: M10 says configs cannot name dev revisions; telemetry is a bare map | Accepted. Appendix section 1: probe configs may name `3-dev-*`, experiments may not (M9-16); M10 updated. `lsp_calls` is `{ total, by_op } | null` per ruling 9 (appendix section 5); M9 adds no LSP telemetry. | Global Constraints, appendix |
| 5 PARTLY: fixtures prove two child ids, not interleaving; no paid cancellation or overshoot pins; stream silence is not shutdown proof | Accepted. M9-13 criteria now: A-B-A interleaving, paid cancellation, overshoot bound 1.2x (owner), and request-lifecycle evidence (proxy log shows no API request started after the result, `confirmedGone`). M9-14 pins interleaving, paid cancellation and the bound in tests. | M9-13, M9-14 |
| New BLOCKING: `num()` zero-fills missing source usage fields; models on one side | Accepted. Every required field of streamed messages, sub-agent results and modelUsage is validated with `isCount`; a missing or malformed field and a one-sided model are `unreconciled`; tests for missing, string, negative fields and both one-sided directions. | M9-06 |
| New certain test failure: `parse(lines, undefined)` selects the default `"3"` | Accepted. `null` is the frozen-image sentinel (`revision: string | null = "3"`). | M9-06 |
| New: fallback image `3-dev-M9-13` not reflected in probe configs or their test | Accepted. The fallback commit moves all five probe configs to `3-dev-M9-13`; the M9-08 test accepts `3`, `3-dev-M9-07` or `3-dev-M9-13` and requires one revision for all probes. | M9-08, M9-13 |
| (none rejected) | | |

## Round 3 changes

1. Header links the shared interfaces appendix; rulings path PLANS-v2-002; owner decisions applied (1.2x bound, compaction cost kept, USD 5 for all arms).
2. M9-04: `LSP_PLUGINS` gains `source` and nullable `path`, `pluginIs` match rule; exact installed set includes `lsp:<name>`; single positive LSP check with the appendix problem string; tests updated (preflight missing, plugin/tool absent, other path, other source).
3. M9-06: field validation without zero-fill, model-set equality, tightened compaction attribution, null revision sentinel, new tests.
4. M9-08/M9-13: probe revision handling for the `3-dev-M9-13` fallback; seven budget criteria incl. interleaving, paid cancellation, request lifecycle and the bound; gate 3 counts only `exact`.
5. M9-14: interleaving, paid-cancellation and overshoot assertions.
6. Dates and deps: M9-15 no longer waits for the M9-12 lock (later-dated); M9-12 lock 10-21..24 gates M8-15b; M9-17 builds r3 on 10-18 after M10-08 and finishes 10-21; M10-09 depends on M9-17 Step 2; build guards exit on an existing tag.
