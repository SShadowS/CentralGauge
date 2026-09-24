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
bundle: bundles/al-skills
mcp: [al-tools]               # named components; empty = CLI toolkit only
limits: { timeout_min: 30, max_budget_usd: 5 }
```

Config hash = canonical hash of the yml, the bundle's file contents, the image
digest and the `cg-al` toolkit version. Editing a skill file produces a new
hash, same semantics as the task-set hash. Model ids come from the catalog,
never hardcoded in code.

## 5. Sandbox runtime contract

Per run cell (config x task x repeat):

1. Host stages a fresh workspace: refapp snapshot + task overlay + `Test\` +
   pre-seeded `.alpackages`.
2. `docker run` the harness image with exactly these mounts:
   - `C:\workspace` read-write
   - `C:\task` read-only: `prompt.md` and agent-visible task metadata
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

`telemetry.json` schema (every field nullable): `harness_version`,
`cost_usd`, `tokens_in`, `tokens_out`, `tokens_cache_read`,
`tokens_cache_write`, `turns`, `per_model[] {model, calls, tokens_in,
tokens_out, cost_usd}`, `wall_ms`, `exit_code`, `stop_reason`,
`refusal_detected`.

Adding a harness means a new image and `run.ps1`. The orchestrator does not
change. A TS parser per harness is allowed only if telemetry needs
post-processing host-side.

### Container throughput

A run publishes 7 apps, heavier than today's single candidate. The container
mutex is held across publish + test. Measure publish cost in the first spike
before choosing concurrency defaults.

## 6. Experiment and storage

```yaml
id: al-skills-vs-plain
baseline: cc-opus-plain
variants: [cc-opus-with-al-skills, pi-sonnet-with-al-skills]
tasks: "harness-tasks/tasks/*"
repeats: 3
```

Run cell path: `results/harness/<configHash>/<taskSetHash>/<taskId>-r<N>.json`,
plus a sibling directory holding the final workspace and raw log.

Running an experiment reuses existing cells and runs only missing ones, so
it is resumable and adding a variant pays only for that variant. Before a run
starts, print the cell count and an estimated cost from prior cells of the
same config where available.

Each cell records the full fingerprint: config hash, image digest, harness
version, toolkit version, task-set hash, refapp version, repeat index, and the
resolved model routing. This is the leaderboard-prep surface.

## 7. Verdict pipeline

Scorers are listed per task in `task.yml`. A cell passes only if every scorer
passes.

1. **build**: compile every app in dependency order. Any failure fails the cell.
2. **regression**: run the shipped visible tests from our pristine copy, plus
   tests the agent added. Edits to shipped test procedures are ignored for this
   check, so an agent cannot pass by weakening a visible test. Any failure
   fails the cell.
3. **oracle** (feature, bugfix, refactor): publish the hidden oracle test app
   and run it. Zero tests after publish is infra, not a fail (GH #13 rule).
4. **mutant_kill** (test-authoring): the agent's tests must pass against the
   reference-correct code and fail against each task-shipped hidden mutant.

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
paired by task:

- pass rate as the mean of per-repeat pass rates (cohort rule)
- paired bootstrap CI on the pass-rate delta
- cost, tokens, wall time medians where reported, with n/a counts
- per-task flip table (baseline fail to variant pass, and the reverse)
- slices by task `kind` and by `coupling` tag

Output: console, JSON, one static HTML file.

## 10. CLI

```
centralgauge harness run <experiment> [--dry-run] [--only-missing]
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
  telemetry.

## 12. Scope

In spec 1a:

- base image with `cg-al`, images for `mock`, `claude-code`, `pi`
- toolkit backend and the al-tools MCP component
- runner, staging, verdict pipeline, outcomes, experiment, report
- a minimal refapp slice (Core, Rental, Test) and 2 tasks, enough to prove
  multi-app build, regression, oracle and mutant_kill

In spec 1b: the full refapp and the ~10-task v1 set.

Later specs: process scorers, leaderboard ingest, private task overlays,
more harnesses, LLM judge.

## 13. First spike

Before planning 1a in detail, measure on a real container: publish + test
time for a 3-app and a 7-app workspace, and whether `alc` inside the Windows
sandbox compiles against pre-seeded `.alpackages` with no BC access.
