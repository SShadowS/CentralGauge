# Harness Bench: design (spec 1a, infrastructure)

Status: design, approved in brainstorming 2026-09-24. Not implemented.
Companion spec: `2026-09-24-harness-refapp-design.md` (1b, content).

## 1. Goal

Benchmark whole agent harnesses, not just models. The unit under test is a
**harness config**: harness + pinned version + model routing + skills/rules
bundle + MCP components + limits. Typical questions:

- Does this set of skills and MCPs improve results for my process?
- Can a cheaper model set do the same tasks at the same pass rate?
- Does Claude Code with config X beat pi with config Y on the same work?

**Primary use case:** same harness, same models, different MCP/skill sets.
The question is as much about efficiency as about pass rate: does set 1 need
fewer tool calls, fewer errors, fewer tokens, less money and less time than
set 2 to reach the same result? Telemetry and the report are designed around
that comparison first.

Prior art: BC-Bench (`microsoft/BC-Bench`, SWE-Bench style, real BCApps
tasks, Copilot CLI and Claude Code). Its paper found between-model
differences larger than between-harness differences, so harness-config
effects are expected to be small and the report must be honest about what
it cannot distinguish. Several decisions below are adopted from it.

Primary audience is BC developers comparing configs locally. Results live in
local files. A public leaderboard may come later, so results must carry every
field an ingest would need, but no ingest, D1 or site work is in scope.

## 2. Decisions

| # | Decision |
| --- | --- |
| D1 | Local-first. Leaderboard-ready result records, no ingest code. |
| D2 | Tasks are repo-scale work items against a multi-app reference app (spec 1b). Process tasks (review, PR text, rubric scoring) are a later layer. |
| D3 | The workspace ships visible tests. A separate hidden oracle decides the verdict. |
| D4 | Every harness runs inside a Windows sandbox container. No host writes. Windows because BC containers pin Docker to the Windows context. |
| D5 | Baseline toolkit `cg-al` (compile, test) is in every sandbox. Our al-tools MCP is an optional, named config component. |
| D6 | Storage is per run cell. An experiment is a thin grouping of configs over one task set. |
| D7 | Default 3 repeats per (config, task). |
| D8 | Cost, tokens, turns are harness self-reported. A field the harness cannot supply is null, never 0. No metering proxy. |
| D9 | Contract is at the container boundary (Approach 1). Harness-specific logic lives in its image and entrypoint, not in the orchestrator. |
| D10 | One workspace folder in and out, like a real BC repo. We rebuild from source for the verdict; harness-built `.app` files are ignored. |
| D11 | Verdict fails on any build failure, any visible-test regression, or a failed hidden scorer. |
| D12 | Agent `cg-al test` calls and verdict runs share `CompileQueuePool` plus the health/drain machinery. Agent calls run at lower priority. |
| D13 | Harness task set is separate from `tasks/`, with its own task-set hash. Never mixed into the LLM leaderboard. |
| D14 | Every tool call is recorded as a normalized trace event (tool, source, outcome, duration). Calls through our backend (`cg-al`, al-tools MCP) are also counted host-side, independent of the harness. |
| D15 | An experiment declares which config components it varies. The runner refuses when arms differ in anything else. |
| D16 | Task sources are pluggable at the staging step: `refapp` (snapshot + overlay) now, `git` (repo + base commit, BC-Bench style) later. |

## 3. Layout

```
harness/
  images/<harness>/        Dockerfile.windows, run.ps1 (per harness)
  images/base/             base sandbox: Node, Git, alc, cg-al toolkit
  configs/<id>.yml         harness configs
  bundles/<name>/          skills, rules, prompts copied into C:\config
  experiments/<id>.yml     experiment definitions
harness-tasks/             task set (spec 1b): refapp/, tasks/
src/harness/               runner, staging, verdict, report
results/harness/           run cells
```

## 4. Harness config

```yaml
id: cc-opus-with-al-skills
harness: claude-code          # selects harness/images/claude-code
harness_version: 2.3.1        # must match the image label, else refuse
models:                       # passed to run.ps1; keys are harness-specific
  main: anthropic/claude-opus-5-5
  small: anthropic/claude-haiku-4-5-20251001
components:                   # each recorded and hashed separately
  instructions: bundles/al-skills/instructions   # AGENTS.md-style rules
  skills: bundles/al-skills/skills
  agents: null                # custom sub-agent definitions
  hooks: null
  plugins: []                 # { name, source: local|github, repo, revision }
  mcp: [al-tools]             # named MCP components; empty = CLI toolkit only
  lsp: [al-lsp]               # named LSP components
limits: { timeout_min: 30, max_budget_usd: 5 }
```

Config hash = canonical hash of the yml, every component's file contents, the
image digest and the `cg-al` toolkit version. Each component also gets its
own hash, so the report can show exactly which components differ between two
arms. Editing a skill file produces a new hash, same semantics as the
task-set hash. A component may record its source (`github@<sha>`) for
sharing; a `local` source is flagged as not reproducible elsewhere. Model ids
come from the catalog, never hardcoded in code.

Loading a skill does not mean the agent uses it (BC-Bench observation:
agents often invoke no skill on well-specified tasks). A nudge in
`instructions` ("consider your skills") is itself a variable, so it lives in
its own component and shows up in the component diff.

## 5. Sandbox runtime contract

Per run cell (config x task x repeat):

1. Host stages a fresh workspace through the task's source (D16). `refapp`:
   snapshot + task overlay + `Test\` + pre-seeded `.alpackages`. The
   staging interface takes a task and returns a workspace directory plus
   its app list in dependency order, so a later `git` source (BC-Bench
   entries: repo, base commit, FAIL_TO_PASS / PASS_TO_PASS) plugs in without
   runner changes. Known blockers for that source, deferred: BC-Bench tasks
   pin BC versions other than our BC28 containers, and BCApps is very large.
2. `docker run` the harness image with exactly these mounts:
   - `C:\workspace` read-write
   - `C:\task` read-only: `prompt.md`, attachments (screenshots, sample
     files) and agent-visible task metadata
   - `C:\config` read-only: bundle, MCP definitions, model routing
   - `C:\cg-secrets` read-only: API keys, toolkit token (never `-e`)
3. `run.ps1` translates `C:\config` into the harness's native format
   (`.claude\`, pi config, and so on), runs the harness non-interactively on
   the prompt, and writes `C:\workspace\.cg\telemetry.json` plus the raw log.
4. `cg-al compile` runs `alc` locally against `.alpackages` (no BC needed).
   `cg-al test` calls the host toolkit backend with the token; the host
   publishes all apps to a BC container and runs tests via the SOAP harness.
   The al-tools MCP component uses the same backend.
5. On `timeout_min` the container is killed; the workspace is still judged.
6. Host copies the workspace out, strips `.cg\` and every `*.app`, runs the
   verdict pipeline (section 7), then destroys the sandbox.

### Telemetry

Two files, both written by `run.ps1` or a host-side parser from the raw
harness log:

`telemetry.json` (run totals, every field nullable): `harness_version`
(what actually ran, not what the config claims; a mismatch with the config
is `harness_error`), `cost_usd`, `tokens_in`, `tokens_out`,
`tokens_cache_read`, `tokens_cache_write`, `tokens_reasoning`, `turns`,
`per_model[] {model, calls, tokens_in, tokens_out, cost_usd}`, `wall_ms`,
`exit_code`, `stop_reason`, `refusal_detected`.

`trace.jsonl` (one normalized event per tool call):

```json
{"seq": 12, "t_ms": 48210, "tool": "al_compile", "source": "mcp:al-tools",
 "outcome": "ok|error|denied", "duration_ms": 3100, "error_kind": null,
 "model": "anthropic/claude-opus-5-5"}
```

`source` is one of `builtin`, `mcp:<server>`, `skill:<name>`,
`subagent:<name>`, `shell`. Skill invocations and sub-agent spawns are
events too, so "was the skill used" is answerable. Shell commands are
recorded by first token only (`cg-al`, `git`, `pwsh`), not full command
lines.

**Host-side counts.** Every `cg-al compile`, `cg-al test` and al-tools MCP
call goes through our backend, so the host records its own count, duration
and result independent of the harness. This is the trustworthy baseline for
the primary use case: build and test iterations, time to first green build,
compile errors per iteration. A large gap between host counts and the
harness trace is an adapter bug.

**Metrics contract.** Each adapter declares which telemetry fields its
harness can supply. A declared field that is missing is a warning (adapter
bug). An undeclared field is null and shows as n/a. Missing is never 0.

Adding a harness means a new image, `run.ps1`, a metrics contract, and
optionally a host-side trace parser. The orchestrator does not change.

### Container throughput

A run publishes 7 apps, heavier than today's single candidate. The container
mutex is held across publish + test. Measure publish cost in the first spike
before choosing concurrency defaults.

## 6. Experiment and storage

```yaml
id: al-skills-vs-plain
hypothesis: >-
  AL skills cut cg-al compile iterations by ~30% at equal pass rate,
  because the skill covers object ID and dependency setup.
baseline: cc-opus-plain
variants: [cc-opus-with-al-skills, cc-opus-with-al-mcp]
vary: [skills, mcp]           # runner refuses if arms differ elsewhere
tasks: "harness-tasks/tasks/*"
repeats: 3
```

`vary` makes the primary use case a controlled experiment by default:
harness, image, models and limits must be identical across arms unless
listed. Cross-harness experiments list `harness` (and usually `models`)
explicitly. `hypothesis` is required and printed at the top of the report.

Staged runs keep cost down: `--sample N` runs N tasks at 1 repeat as a
smoke test, then a full run at 1 repeat, then the remaining repeats. Cell
reuse makes each stage pay only for new cells.

Run cell path: `results/harness/<configHash>/<taskSetHash>/<taskId>-r<N>.json`,
plus a sibling directory holding the final workspace and raw log.

Running an experiment reuses existing cells and runs only missing ones, so
it is resumable and adding a variant pays only for that variant. Before a run
starts, print the cell count and an estimated cost from prior cells of the
same config where available.

Each cell records the full fingerprint: config hash, per-component hashes,
image digest, harness version (reported), toolkit version, task-set hash,
refapp version, repeat index, and the resolved model routing. Each cell
directory holds `telemetry.json`, `trace.jsonl`, the host-side call log, the
per-procedure test results, the final workspace and the raw harness log. This is the leaderboard-prep surface.

## 7. Verdict pipeline

Scorers are listed per task in `task.yml`. A cell passes only if every scorer
passes.

1. **build**: compile every app in dependency order. Any failure fails the cell.
2. **pass_to_pass** (regression): run the task's listed visible tests
   (codeunit + procedure) from our pristine copy, plus tests the agent added.
   Edits to shipped test procedures are ignored for this check, so an agent
   cannot pass by weakening a visible test. Any failure fails the cell.
3. **fail_to_pass** (feature, bugfix, refactor): publish the hidden oracle
   test app and run the listed procedures. Zero tests after publish is infra,
   not a fail (GH #13 rule).
4. **mutant_kill** (test-authoring): the agent's tests must pass against the
   reference-correct code and fail against every hidden mutant. Mutant 0 is
   always the task's original buggy state (fail before fix, pass after,
   BC-Bench test-generation rule).

Results are recorded per test procedure, not per app, so flaky tests can be
diagnosed per procedure.

The scorer list is the extension point for future process scorers.

## 8. Outcomes and error handling

Every cell ends in exactly one outcome (discriminated union):

| Outcome | Meaning | Scored | Retry |
| --- | --- | --- | --- |
| `pass` | all scorers pass | yes | no |
| `fail` | a scorer failed; per-scorer detail kept | yes | no |
| `timeout` | harness hit `timeout_min`; workspace judged | as judged, flag kept | no |
| `budget_exhausted` | harness stopped on budget, when supported | as judged, flag kept | no |
| `refusal` | provider refusal reported by the harness | yes, fail | no |
| `harness_error` | crash or nonzero exit before work, bad auth, unknown model | no | 1 auto-retry, then operator |
| `infra_error` | sandbox start failed, BC fault during verdict, backend down | no | existing infra-retry and health monitor |

Rules:

- A BC fault during the agent's own `cg-al test` is returned to the agent as a
  tool error and counted in telemetry. A BC fault during our verdict is
  `infra_error` and re-judges the saved workspace on another container. The
  agent is never re-run for a verdict-side fault.
- Saved workspaces make re-judging after an oracle fix possible without an
  agent re-run. The task-set hash changes, so the re-judged cell is keyed
  anew and the old cell is kept.
- Unscored cells are missing in paired stats. The report shows coverage (for
  example 34/36 cells) and a per-config `harness_error` rate warning.
- Sandbox cleanup runs in `finally`. Orphans named `cg-harness-<runId>-*` are
  swept at start.
- `acquireBenchLock` is held for harness runs, since BC containers are shared.

## 9. Report

`centralgauge harness report <experiment>` per variant against baseline,
paired by task. Sections in this order:

1. **Header**: hypothesis, component diff between baseline and each variant,
   coverage (scored cells / planned cells).
2. **Efficiency** (the primary use case). Per arm, median and paired delta
   with bootstrap CI:
   - tool calls total, and by `source` (builtin, each MCP server, each
     skill, shell)
   - tool errors total and error rate, by `source`
   - host-side `cg-al` compile and test iterations, time to first green
     build, compile errors per iteration
   - turns, tokens (in, out, cache, reasoning), cost, wall time
   - skill and MCP usage rate: share of cells where each loaded component
     was actually invoked at least once
   Efficiency is reported twice: over all cells, and over **both-pass**
   pairs only (same task and repeat index passed in both arms). The
   both-pass view removes the confound that a failed run can be short and
   cheap.
3. **Outcome**: pass rate (mean of per-repeat pass rates, cohort rule),
   pass^k (share of tasks passing in all k repeats), paired bootstrap CI on
   the delta, per-task flip table.
4. **Slices** by task `kind` and `coupling` tag.

When a CI includes zero, the report says "not distinguishable" instead of
naming a winner. n/a counts are shown for every metric a harness could not
supply.

Output: console, JSON, one static HTML file.

## 10. CLI

```
centralgauge harness run <experiment> [--dry-run] [--sample N] [--repeats N]
centralgauge harness cell <config> <task> [--repeat N]
centralgauge harness rejudge <experiment|cell>
centralgauge harness report <experiment>
centralgauge harness images build <harness>
```

Cliffy, following the existing `--no-X` rule.

## 11. Testing

- Unit: Zod schemas for task, config, experiment; hash canonicalization with a
  fixture; outcome classifier; paired stats; workspace staging and strip.
- Contract: a `mock` harness image whose `run.ps1` applies a scripted patch
  (correct, naive, crash, timeout). Exercises the full pipeline on real
  containers. The same image gates each task: correct passes, naive fails.
- Per real harness: smoke task (change one caption) end to end with parsed
  telemetry and trace.
- Trace parser fixtures: recorded raw logs per harness (tool call, tool
  error, skill invocation, MCP call, sub-agent) with expected `trace.jsonl`.
- Host-side count vs trace consistency check on the smoke task.
- `vary` enforcement: an experiment whose arms differ outside `vary` is
  refused.

## 12. Scope

In spec 1a:

- base image with `cg-al`, images for `mock`, `claude-code`, `pi`
- toolkit backend and the al-tools MCP component
- runner, staging, verdict pipeline, outcomes, experiment, report
- a minimal refapp slice (Core, Rental, Test) and 2 tasks, enough to prove
  multi-app build, pass_to_pass, fail_to_pass and mutant_kill

In spec 1b: the full refapp and the ~10-task v1 set.

Later specs: process scorers, leaderboard ingest, private task overlays,
more harnesses, LLM judge, the `git` task source (BC-Bench adapter), a
contamination probe (context-free "which files does the fix touch" question,
as BC-Bench does).

## 13. First spike

Before planning 1a in detail, measure on a real container: publish + test
time for a 3-app and a 7-app workspace, and whether `alc` inside the Windows
sandbox compiles against pre-seeded `.alpackages` with no BC access.
