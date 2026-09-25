# Harness Bench: design (spec 1a, infrastructure)

Status: design, approved in brainstorming 2026-09-24, revised after the
GPT-6 Astra review (`.panel/harness-spec-review-gpt6astra.md`). Not
implemented.
Companion spec: `2026-09-24-harness-refapp-design.md` (1b, content).

## 1. Goal

Benchmark whole agent harnesses, not just models. The unit under test is a
**harness config**: harness + pinned version + model routing + skills/rules
bundle + MCP components + limits. Typical questions:

- Does this set of skills and MCPs improve results for my process?
- Can a cheaper model set do the same tasks at the same pass rate?
- Does Claude Code with config X beat pi with config Y on the same work?

**Primary use case:** same harness, same models, different MCP/skill sets.
The question is as much about efficiency as about pass rate.

**Primary metric: cost per solved task.** Sum over tasks of each task's
mean cost over all its attempts (failed, timed out, usage-limited and
retried attempts included) divided by the sum of per-task pass rates, every
task weighted equally (owner decision
`H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`). This is the headline number of the
Directions EMEA talk on 2026-10-27 (`U:\Git\presentations\DirectionsEMEA2026\centralgauge-submission.md`),
and the same framing as the existing LLM leaderboard. Tool calls, tool
errors, build/test iterations, tokens and time are secondary and explain the
cost.

**Cost basis (decided 2026-09-24).** Sandbox Claude Code runs authenticate
with a subscription OAuth token (the Team account), so their self-reported
cost is not money spent. For every harness, the primary metric therefore
uses **list-price cost computed from reported tokens** with the catalog
pricing snapshot recorded on the execution (`cost_source: estimated`). A
harness's own reported cost is kept next to it for cross-checking. This
keeps Claude Code and pi comparable whatever the auth method.

Prior art: BC-Bench (`microsoft/BC-Bench`, SWE-Bench style, real BCApps
tasks, Copilot CLI and Claude Code). Its paper found between-model
differences larger than between-harness differences, so harness-config
effects are expected to be small and the report must be honest about what it
cannot distinguish. Several decisions below are adopted from it.

Primary audience is BC developers comparing configs locally. Results live in
local files. A public leaderboard may come later, so records must carry
every field an ingest would need, but no ingest, D1 or site work is in scope.

### Threat model

Configs are trusted (the operator writes them). The agent is untrusted in
the narrow sense that it must not be able to fake a verdict: it cannot reach
the hidden oracle at runtime, cannot weaken the tests it is judged by, and
cannot make a stale or hand-made `.app` count. "Hidden" means withheld at
runtime, not private: oracles are in a public repo and could in principle be
fetched from the internet. Egress lockdown, VM isolation and private task
sets are out of scope for 1a.

## 2. Decisions

| # | Decision |
| --- | --- |
| D1 | Local-first. Leaderboard-ready records, no ingest code. |
| D2 | Tasks are repo-scale work items against a multi-app reference app (spec 1b). Process tasks (review, PR text, rubric scoring) are a later layer. |
| D3 | The workspace ships visible tests. A separate hidden oracle decides the verdict. |
| D4 | Every harness runs inside a Windows sandbox container. No host writes. Windows because BC containers pin Docker to the Windows context. |
| D5 | Baseline toolkit `cg-al` (compile, test) is in every sandbox and goes through the host backend. An in-container compiler (AL Tools NuGet) is an optional, pinned `toolchain` component, so backend vs in-container compile is itself a comparable arm. Our al-tools MCP is an optional, named component on the backend. The verdict always rebuilds host-side regardless. |
| D6 | Records are split into execution, artifact and judgment (section 6). An experiment is a campaign over a set of configs and tasks. |
| D7 | Default 3 repeats per (config, task). |
| D8 | Cost, tokens, turns are harness self-reported. A field the harness cannot supply is null, never 0. No metering proxy. |
| D9 | Contract is at the container boundary. Harness-specific logic lives in its image and entrypoint, not in the orchestrator. |
| D10 | One workspace folder in and out, like a real BC repo. The verdict runs on a reconstructed workspace (section 7), never on harness-built `.app` files. |
| D11 | Verdict fails on any build failure, any visible-test regression, or a failed hidden scorer. |
| D12 | Agent `cg-al` calls and verdict runs share `CompileQueuePool` plus the health/drain machinery, at fixed concurrency. Agent credentials expose only agent operations. |
| D13 | Harness task set is separate from `tasks/`, with its own task-set identity. Never mixed into the LLM leaderboard. |
| D14 | Every tool call is recorded as a normalized, versioned trace event with correlation ids, shell commands in full (secrets redacted). Backend calls are also recorded host-side, independent of the harness. Calls are categorized after the run by deterministic rules; the residue is `unclassified` (Laya cut, spike findings 2026-09-29 section 7). |
| D15 | An experiment declares which config components it varies. The runner compares the resolved execution manifests and refuses when arms differ in anything else. |
| D16 | Task sources are pluggable at the staging step: `refapp` (snapshot + overlay) now, `git` (repo + base commit, BC-Bench style) later. Only the interface ships in 1a. |
| D17 | Arms are interleaved in randomized order within (task, repeat) blocks. Historical executions are reused only on explicit request. |
| D18 | Termination, verdict and measurement validity are separate fields, not one outcome. Every attempt is kept, with its cost. |
| D19 | `cost_per_solved_task` is the default primary metric. Each experiment declares one primary metric; everything else is exploratory. |

## 3. Layout

```
harness/
  images/<harness>/        Dockerfile.windows, run.ps1 (per harness)
  images/base/             base sandbox: Node, Git, cg-al client
  toolchains/<name>/       optional in-container toolchains (AL Tools NuGet)
  configs/<id>.yml         harness configs
  bundles/<name>/          skills, rules, prompts copied into C:\config
  experiments/<id>.yml     experiment definitions
harness-tasks/             task set (spec 1b): refapp/, tasks/
src/harness/               runner, staging, backend, verdict, report
results/harness/           executions, artifacts, judgments
```

## 4. Harness config

```yaml
id: cc-opus-with-al-skills
harness: claude-code          # selects harness/images/claude-code
harness_version: 2.3.1        # must match the image label, else refuse
models:                       # passed to run.ps1; keys are harness-specific
  main: anthropic/claude-opus-5-5
  small: anthropic/claude-haiku-4-5-20251001
settings:                     # native harness settings that change behavior
  reasoning: high
components:                   # each recorded and hashed separately
  instructions: bundles/al-skills/instructions   # AGENTS.md-style rules
  skills: bundles/al-skills/skills
  agents: null                # custom sub-agent definitions
  hooks: null
  plugins: []                 # local only in 1a
  mcp: [al-tools]             # named MCP components; empty = CLI toolkit only
  lsp: [al-lsp]               # named LSP components
  toolchain: []               # e.g. [al-tools-nuget@17.0.1]; empty = backend only
limits: { timeout_min: 30, max_budget_usd: 5 }
```

Model ids come from the catalog, never hardcoded in code. Task `limits`
override config `limits` only to be stricter.

**Resolved execution manifest.** At setup the runner resolves the config
into a manifest: native harness settings as written into the container,
every component's file contents, each MCP server's implementation version
and tool-schema hash, requested model routing and provider route, image
digest, `cg-al` backend version, resource limits. The manifest hash is the
config identity; each component also gets its own hash so the report can
show exactly what differs between arms. The hashing rules carry a version
number so a rule change never silently collides with old hashes.

At the end of a run the manifest is completed with what was **observed**:
harness version that actually ran, models that actually answered, and which
components the harness reports as loaded. A requested component that did
not load, or a harness version mismatch, fails setup (`termination:
setup_failed`) rather than producing a silently different arm.

Loading a skill does not mean the agent uses it (BC-Bench observation). A
nudge in `instructions` ("consider your skills") is itself a variable, so it
lives in its own component and shows up in the component diff. Usage is
reported as available / loaded / invoked, never as "used" in a cognitive
sense.

Provider-side prompt caching is not controlled by a fresh container. The
experiment records cache token fields and the report shows them; it does
not claim cold-cache runs.

## 5. Sandbox runtime contract

Per execution (config x task x repeat):

1. Host stages a fresh workspace through the task's source (D16). `refapp`:
   snapshot at an immutable commit + task overlay + `Test\` + pre-seeded
   `.alpackages`. The staging interface takes a task and returns a
   workspace directory plus its app list in dependency order, so a later
   `git` source (BC-Bench entries) plugs in without runner changes. Known
   blockers for that source, deferred: BC-Bench tasks pin BC versions other
   than our BC28 containers, and BCApps is very large.
2. Host issues a per-execution backend token scoped to that execution's
   workspace, then `docker run`s the harness image with exactly these mounts:
   - `C:\workspace` read-write
   - `C:\task` read-only: `prompt.md`, attachments (screenshots, sample
     files) and agent-visible task metadata
   - `C:\config` read-only: resolved native config, bundle, MCP definitions
   - `C:\cg-secrets` read-only: API keys, backend token (never `-e`, never
     argv). This mount is agent-readable; the production plan must either
     keep secrets out of it or state here why they must be there (spike
     findings 2026-09-29 section 8, M0-03 carryover).
3. `run.ps1` translates `C:\config` into the harness's native format
   (`.claude\`, pi config, and so on) and runs the harness non-interactively
   on the prompt. The harness's structured output (Claude Code
   `stream-json`, pi JSON mode) streams to container stdout, which the host
   captures continuously, so a hard kill still leaves a log.
4. `cg-al compile` and `cg-al test` are thin clients. The backend compiles
   host-side with the existing compiler path, and for `test` publishes all
   apps to a BC container and runs tests via the SOAP harness. The al-tools
   MCP component calls the same backend. The token allows only compile, test
   and symbol lookup on its own workspace. There is no endpoint that lists
   installed apps, reads other workspaces, or runs the oracle. When the
   config has a `toolchain` component, that toolchain is installed in the
   image at a pinned version and the agent may compile locally against
   `.alpackages`; those compiles are not seen by the backend and are counted
   from the classified trace (see Call categorization).
5. On `timeout_min` the process tree and container are stopped; the
   workspace is still judged.
6. Host revokes the token, freezes the workspace (copy, then hash: the
   **artifact**), destroys the sandbox, and hands the artifact to the verdict
   pipeline (section 7).

### Telemetry

Three sources, each with provenance recorded per metric:

**`telemetry.json`** (run totals from the harness, every field nullable):
`harness_version`, `cost_usd` (with `cost_source: reported|estimated` and
the pricing snapshot used for an estimate), `per_model[] {model, requests,
tokens_in_uncached, tokens_cache_read, tokens_cache_write, tokens_out,
tokens_reasoning, cost_usd}`, `turns`, `compactions`, `wall_ms`,
`exit_code`, `stop_reason`, `refusal_detected`, and the raw provider-native
usage objects. Token fields are non-overlapping: `tokens_in_uncached +
tokens_cache_read + tokens_cache_write` is the input total, and
`tokens_reasoning` is reported inside `tokens_out` and never added to it
again. Where a harness reports overlapping fields, the adapter normalizes and
keeps the raw values.

**`trace.jsonl`** (one event per step, schema versioned):

```json
{"v": 1, "seq": 12, "t_ms": 48210, "type": "tool_call",
 "session": "s1", "agent": "main", "parent": null, "call_id": "tc_12",
 "request_id": "req_7", "tool": "al_compile", "transport": "mcp:al-tools",
 "skill": null, "backend_request": "br_4",
 "outcome": "ok|error|denied|cancelled",
 "error_class": null, "result_bytes": 5120, "truncated": false,
 "duration_ms": 3100, "model": "anthropic/claude-opus-5-5"}
```

- `type`: `tool_call`, `model_request`, `skill_invoke`, `subagent_spawn`,
  `compaction`, `retry`.
- `transport` (`builtin`, `mcp:<server>`, `shell`) is separate from
  `agent` (main or sub-agent name) and `skill` (skill in scope, if any).
- `error_class`: `tool_protocol`, `compile_diagnostics`,
  `test_assertion`, `infra`, `denied`, `cancelled`.
- `cg-al` calls carry the structured operation name (`compile`, `test`,
  `symbols`). Other shell commands are recorded in full, with secrets
  redacted before storage (known key values from `C:\cg-secrets`, token
  patterns).
- `result_bytes` and `truncated` show how much context a tool result
  consumed, which is where verbose MCPs cost money.

**Host call log** (backend side, fully trusted): per backend request the
operation, apps compiled (count and names), diagnostics count, tests run and
failed, and spans for queue wait, compile, publish and test, plus container
assignment and queue depth. Units are kept apart: one model tool call, one
logical build request and N per-app compiler executions are different
numbers. Backend counts need not equal harness tool counts (one MCP call can
compile seven apps), so a mismatch is only flagged when the correlation ids
do not line up.

**Call categorization.** After a run, every trace event gets a
`category`: `compile`, `test`, `publish`, `symbols`, `read`, `search`,
`edit`, `vcs`, `other`, or `unclassified`. It runs over stored traces and can
be re-run with a newer classifier without re-running agents.

1. Deterministic rules first: `cg-al` operations, known MCP tool names,
   harness builtin tools (Read, Edit, Grep...), and command patterns
   (`alc.exe`, `altool compile`, the AL Tools NuGet entry points, `git`).
   Rules are versioned and cover most calls with certainty.
2. Events no rule matches are `unclassified`, never a guess. (Laya and
   hosted Jev are cut: Laya was 3/10 correct at p >= 0.8, spike findings
   2026-09-29 section 7.)
3. Each event stores `category` and `classifier` (rule id and rule version).

The report shows how many events were rule-classified and unclassified per
arm. Compile counts from the backend and from classified
traces are shown separately and labelled by source.

**Metrics contract.** Each adapter declares which fields its harness can
supply. A declared field that is missing marks the execution's measurement
validity as `incomplete` and warns. An undeclared field is null and shows as
n/a. When the experiment's primary metric is incomplete for an execution,
that execution is excluded from the primary comparison and counted in the
report.

Adding a harness means a new image, `run.ps1`, a metrics contract, and a
host-side trace parser. The orchestrator does not change.

### Container throughput

A run publishes several apps, heavier than today's single candidate. Fixed
concurrency is used in 1a (no priority scheduling). Queue wait is recorded
per backend call because BC latency changes agent behavior (a slow test run
makes an agent change strategy) and cannot simply be subtracted afterward.
Spike result: 7-app compile + publish + test median 73.2 s (operation sum,
spike findings 2026-09-29 section 1), under the 10 minute rule, so all apps
are published per `cg-al test` call and the default is not forced to one
execution per container.

## 6. Experiment, campaign and records

```yaml
id: al-skills-vs-plain
hypothesis: >-
  AL skills cut cost per solved task by ~30% at equal pass rate, because the
  skill covers object ID and dependency setup.
primary_metric: cost_per_solved_task
baseline: cc-opus-plain
variants: [cc-opus-with-al-skills, cc-opus-with-al-mcp]
vary: [skills, mcp]           # runner refuses if manifests differ elsewhere
tasks: "harness-tasks/tasks/*"
repeats: 3
```

`vary` makes the primary use case a controlled experiment: resolved
manifests must be identical across arms outside the listed components.
Cross-harness experiments list `harness` (and usually `models`) explicitly.
`hypothesis` and `primary_metric` are required and printed at the top of
the report.

**Campaign.** Running an experiment creates a campaign. For each (task,
repeat) block the runner executes every arm, in a randomized order that is
recorded. So arms share the same time window, provider state and container
load as far as practical. `harness run` resumes the current campaign.
Reusing executions from an older campaign needs `--reuse-history` and is
marked in the report, because it mixes provider revisions and load
conditions.

Staged runs keep cost down: `--sample N` runs N tasks at 1 repeat as a
smoke test, then a full run at 1 repeat, then the remaining repeats. Before
a run starts, print the execution count and an estimated cost from prior
executions of the same manifest where available.

**Records** (immutable, JSON, under `results/harness/`):

- **execution**: UUID, campaign id, block, order within block, start and end
  timestamps, config manifest (requested and observed), task id, task
  visible-input hash, repeat index, attempt number, termination, telemetry,
  trace, host call log, container assignments, captured raw log.
- **artifact**: hash of the frozen workspace, pointer to its stored copy,
  execution id.
- **judgment**: artifact hash, task oracle hash, scorer versions,
  per-scorer and per-test-procedure results, verdict, verdict container,
  timestamps.

A task has two hashes: **visible-input hash** (prompt, attachments, refapp
commit, overlay, shipped tests, symbols: everything the agent sees) and
**oracle hash** (hidden oracle, mutants, reference solutions, scorer config).
A fix to an oracle changes only the oracle hash, so `harness rejudge` adds a
new judgment for the existing artifact and never implies the agent saw new
inputs. A change to visible inputs means new executions are needed.

The **task-set identity** is a sorted manifest of per-task (id,
visible-input hash, oracle hash). Adding a task extends the manifest without
invalidating executions of the other tasks. Comparisons state which manifest
they cover.

This record split is the leaderboard-prep surface.

## 7. Verdict pipeline

The verdict never runs on the agent's workspace as-is. It builds a
**verdict workspace**:

1. Start from the trusted staged inputs: refapp snapshot, overlay, symbols
   restored from a hashed `.alpackages` manifest, compiler settings.
2. Take from the artifact only the allowed changes: source files under the
   app folders, `app.json` of existing apps, and new test files under
   `Test\`. Every `*.app` in the artifact is dropped. Shipped test files and
   test helpers are restored from the pristine copy.
3. Validate: app ids, names and publishers unchanged; dependencies acyclic
   and within the workspace plus symbols; object ids within the declared
   ranges and outside the reserved bands. A violation fails the build scorer.
4. Copying refuses symlinks, junctions and other reparse points. No build
   script from the artifact is ever executed on the host.

Scorers are listed per task in `task.yml`. An execution passes only if every
scorer passes.

1. **build**: compile every app of the verdict workspace in dependency
   order. Any failure fails the verdict.
2. **pass_to_pass**: run the task's listed visible tests (codeunit +
   procedure) from the pristine copy, plus tests the agent added. Any
   failure fails the verdict.
3. **fail_to_pass** (feature, bugfix, refactor): publish the hidden oracle
   test app and run the listed procedures. Zero tests after publish is
   infra, not a fail (GH #13 rule).
4. **mutant_kill** (test-authoring): see below.

After a judgment, the candidate apps and the oracle are unpublished and the
BC test runner's isolation rolls back test data, so no state carries into
the next agent's `cg-al test` call.

**Test-authoring boundary.** Only the agent's changes under `Test\` are
kept; production code is reset to the reference sources (BC-Bench
test-generation rule). The agent's tests must: build, discover at least one
test, pass on the reference-correct code, and fail on every hidden mutant by
an assertion failure. A compile error or an infra fault on a mutant is not a
kill. Mutant 0 is always the task's original buggy state.

Results are recorded per test procedure, so flaky tests can be diagnosed
per procedure. The scorer list is the extension point for future process
scorers.

## 8. Termination, verdict, validity

Each execution carries three independent fields:

| Field | Values |
| --- | --- |
| `termination` | `completed`, `timeout`, `budget_exhausted`, `refusal`, `usage_limited`, `harness_crash`, `setup_failed` |
| `verdict` | `pass`, `fail`, `unscored` |
| `validity` | `complete`, `incomplete_telemetry`, `infra_exposed` |

- A `timeout` or `budget_exhausted` execution is judged normally; it can
  pass.
- `refusal` is judged normally too (usually a fail) and counted.
- `usage_limited`: the harness stopped because the subscription or provider
  usage window ran out (detected from the harness's own limit message or
  exit reason). `unscored`, the attempt is kept with its cost, and the
  campaign pauses new executions until the window resets, then retries the
  cell. A usage limit is never scored as a model failure.
- `harness_crash` after the agent did work is judged. `harness_crash`
  before any work and `setup_failed` give `unscored`, get one automatic
  retry, and the failed attempt is kept with its cost.
- `infra_exposed` marks an execution where the agent saw an infra fault on
  its own `cg-al` calls (a BC fault is returned to the agent as a tool
  error, like a real developer would see). It is kept and scored; the report
  shows the count per arm and never drops only one arm's affected blocks.
- A BC fault during the verdict re-judges the same artifact on another
  container (existing infra-retry and health monitor). The agent is never
  re-run for a verdict-side fault.
- Rejudging adds a judgment; rerunning adds an execution. Neither becomes a
  new repeat silently. For an automatic infra-retry chain the final attempt
  counts; a manual rerun never silently replaces a scored result and the
  report states which execution was used
  (`H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`).
- Sandbox cleanup runs in `finally`. Orphans named `cg-harness-<id>-*` are
  swept at start. `acquireBenchLock` is held for harness runs, since BC
  containers are shared.

## 9. Report

`centralgauge harness report <experiment>`, per variant against baseline.

**Statistics.** Inference is about this task set, with tasks as the unit:
per task, compute each arm's mean over its repeats, then compare arms over
tasks with a task-level bootstrap (resampling tasks, keeping each task's
repeats together). Every task has equal weight. Task count and execution
count are shown separately. When a CI includes zero the report says "not
distinguishable", and it never presents that as "equal". Metrics other than
the declared primary metric are labelled exploratory. Time to first green
build is censored for executions that never got a green build and is
reported as a survival-style share, not as a missing median. A
baseline-variant comparison uses only (task, repeat) cells eligible in both
arms (matched pairs); each arm's raw spend and exclusions are reported
separately. When any bootstrap resample is undefined (zero solves), the CI
and the distinguishable verdict are suppressed and the undefined share is
reported (`H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`).

Sections in this order:

1. **Header**: hypothesis, primary metric, component diff between baseline
   and each variant, campaign(s) used, coverage (judged executions /
   planned), incomplete-telemetry count and infra-exposed count per arm.
2. **Primary**: cost per solved task per arm (sum of per-task mean cost /
   sum of per-task pass rates) and the delta with CI, next to pass rate per
   arm and its delta. Cost counts every attempt of the arm, including
   failed, usage-limited and retried ones; pending spend is disclosed and the
   headline is marked provisional while cells are pending
   (`H:\cg-coord\decisions\2026-09-25-m1-metric-rules.md`).
3. **Efficiency** (exploratory), per arm over all executions:
   - tool calls total and by transport, skill and agent
   - tool errors total and by `error_class`
   - backend: logical build requests, per-app compiles, test runs,
     diagnostics per build, queue wait, time to first green build
   - calls by `category`, with in-container compiles (classified trace)
     and backend compiles (host log) as separate columns
   - turns, compactions, tokens (uncached in, cache read, cache write, out,
     reasoning), result bytes per tool, cost, wall time split into agent
     time and backend wait
   - available / loaded / invoked rate for every skill and MCP server
   - the both-pass view (task and repeat passed in both arms) as a
     descriptive table only, never used to declare a winner
4. **Outcome**: pass rate (mean of per-repeat pass rates, cohort rule),
   pass^k (share of tasks passing in all k repeats), per-task flip table.
5. **Slices** by task `kind` and `coupling` tag, exploratory.

Output: console and JSON in 1a. HTML later.

## 10. CLI

```
centralgauge harness run <experiment> [--dry-run] [--sample N] [--repeats N] [--reuse-history]
centralgauge harness cell <config> <task> [--repeat N]
centralgauge harness rejudge <experiment|artifact>
centralgauge harness report <experiment>
centralgauge harness images build <harness>
```

Cliffy, following the existing `--no-X` rule.

## 11. Testing

- Unit: Zod schemas for task, config, experiment, records; manifest and
  hash canonicalization with a fixture (versioned rules); termination and
  validity classifier; task-level bootstrap; verdict-workspace
  reconstruction and validation.
- Contract: a `mock` harness image whose `run.ps1` applies a scripted patch
  (correct, naive, crash, timeout). Exercises the full pipeline on real
  containers. The same image gates each task: correct passes, naive fails.
- Hostile contract tests with the `mock` harness: edit a shipped test to
  always pass, ship a hand-made `.app`, add a junction to a host path,
  change an app id, try to reach the oracle or another workspace through the
  backend, leave state behind for the next execution. Each must be caught.
- Categorization: rule fixtures per category and per toolchain command
  shape; redaction of known secrets; a small blind-labelled sample of real
  calls to measure rule accuracy once.
- Trace parser fixtures per harness: recorded raw logs covering tool call,
  tool error, skill invocation, MCP call, sub-agent, retry, compaction and a
  hard kill, with expected `trace.jsonl` and `telemetry.json`.
- Per real harness: smoke task end to end; correlation ids line up between
  trace and host call log.
- `vary` enforcement: arms whose resolved manifests differ outside `vary`
  are refused.

## 12. Scope

In spec 1a, in this order:

1. base image with the `cg-al` client; backend; `mock` harness
2. `claude-code` harness (primary)
3. `pi` harness, after the spike has proven its telemetry (needed for the
   Directions talk head-to-head)
4. al-tools MCP component (Claude Code only: pi 0.87.1 has no native MCP,
   spike findings 2026-09-29 section 4), AL Tools NuGet toolchain component,
   call categorization (rules only)
5. runner with campaigns and blocks, staging, verdict workspace, records,
   report (console + JSON)
6. a minimal refapp slice (Core, Rental, Test) and 2 tasks, enough to prove
   multi-app build, pass_to_pass, fail_to_pass and mutant_kill

Cut from 1a: priority scheduling, GitHub plugin sources, HTML report, the
`git` task source beyond its interface.

In spec 1b: the full refapp and the v1 task set.

Later specs: process scorers, leaderboard ingest, private task overlays,
more harnesses, LLM judge, the `git` task source (BC-Bench adapter), a
contamination probe (context-free "which files does the fix touch" question,
as BC-Bench does), egress restriction.

## 13. First spike

Before planning 1a in detail, prove on real containers:

- publish + test time for a 3-app and a 7-app workspace
- the refapp's acyclic dependency graph, including the Rental/Fleet
  interaction, compiles and publishes
- Claude Code and pi in the Windows sandbox, non-interactive, pinned
  versions: structured output captured through a hard kill; retries,
  compaction, sub-agent and MCP calls visible in the logs; which usage
  fields each actually reports; whether pi loads project resources in
  non-interactive mode without an interactive trust prompt
- a `cg-al` round trip through the backend with a scoped token
- AL Tools NuGet compiling inside the Windows sandbox against pre-seeded
  `.alpackages` with no BC access
- Laya running locally on a sample of real tool calls: accuracy on the
  residue the rules miss, and latency

## 14. Task source for the Directions talk (resolved 2026-09-24)

The talk runs on the refapp task set only. The existing CentralGauge tasks
are too easy to separate harness configs, so no `centralgauge` task source is
added. Consequences:

- Spec 1b content is on the critical path for 2026-10-27, not after it. The
  1a refapp slice (Core, Rental, Test, 2 tasks) grows into the full refapp
  and a first batch of tasks in parallel with the 1a infra work.
- Target: refapp v1 plus at least 6 gated tasks ready for campaign runs by
  2026-10-16, leaving time for the Claude Code and pi campaigns and slides.
- The submission line "the same tasks now also run through coding harnesses"
  no longer matches. Reword it in the slides (or the abstract, if still
  editable) to "the same compiler, containers and scoring".
