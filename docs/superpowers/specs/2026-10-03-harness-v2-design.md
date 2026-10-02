# Harness Bench v2: bigger task set, realistic setups, AL LSP arm

Status: DRAFT rev 2 for owner review (2026-10-03). Rev 1 (99165fa3) was reviewed by
gpt-6.1-sol: REJECT, findings in `H:\cg-coord\reviews\SPEC-v2-001\review-gpt61sol.md`. Rev 2
addresses them (section 11 maps each finding). Builds on 1a
(`2026-09-24-harness-bench-design.md`), 1b (`2026-09-24-harness-refapp-design.md`) and the M6
freeze (`H:\cg-coord\m6\handoff.md`). Nothing here touches the frozen v1 data.

## 1. Why

v1 answered "no verdict" on all three experiments. The task matrix shows why:

| Task | Solved (all 6 arms, 18 cells) |
| --- | --- |
| HX-001 bugfix | 17/18 |
| HX-002 test-authoring | 0/18 |
| HX-003 feature | 18/18 |
| HX-004 feature | 18/18 |
| HX-005 refactor | 13/18 |
| HX-006 feature | 1/18 |

Only HX-005 discriminates. Three tasks are saturated, two are near zero (HX-002 partly a scorer
limit, M4-17a). The bootstrap over 6 tasks had undefined resamples, so the pre-registered
interval was suppressed. v1's setups are also thin: one CLAUDE.md, an MCP server with three
tools, four skills. Real teams run richer setups (rules, skills that wrap environment tools,
review/test subagents, an AL language server).

## 2. Goals and claims

G1. A task set with signal: enough tasks that neither arm saturates or floors the comparison.
G2. Arms that look like a real BC team's Claude Code setup.
G3. Measure what the AL language server changes: cost, tokens, turns, tool mix, compile
workflow, and the quality of the final code, not only pass rate.
G4. Metrics that explain a result, not only score it.

Confirmatory claims (pre-registered, section 7): the LSP effect without and with the realistic
setup, and the realistic-setup effect, on cost per solved task. Everything else is
exploratory and labelled so. Claims hold for the frozen v2 task population (BC/AL tasks of the
stated kinds and coupling styles on the refapp, as selected by the screening pilot), not BC
coding in general.

Non-goals: harnesses beyond Claude Code (pi optional, section 5); more than one model per
campaign; public scoreboard ingest; isolating each component's individual effect (would need
per-component ablations; out of scope unless the owner asks).

## 3. Task set v2

Selection is fixed BEFORE any outcome is seen:

1. Quotas: kinds (feature, bugfix, refactor, test-authoring, none above 40%), coupling styles
   (each v1-uncovered style from caveat C43 at least once: single-instance, temporary tables,
   CommitBehavior), and size (at least half touch 3 or more objects across 2 or more files,
   need an existing procedure found and reused, or follow an event/interface through the
   refapp).
2. Difficulty strata, fixed shares: about 60% intermediate, 20% easy, 20% hard, by the
   author's prior and the screening pilot. Easy and hard tasks stay on purpose (the LSP may help
   most where plain fails).
3. Screening pilot (developmental, never confirmatory): every candidate runs on BOTH the plain
   and the realistic+LSP arm, 3 repeats each. A task is dropped only by a symmetric rule:
   solved in 0 of 6 pilot cells (dead) or in all 6 (saturated), or a broken oracle. No task is
   kept or dropped for an observed arm difference. Pilot executions are excluded from every
   confirmatory result.
4. Held-out: 3 to 4 tasks are authored to the same quotas but not screened; they run in the
   campaign and are reported separately as a transfer check.
5. Freeze: tasks, oracles, scorers, refapp (`refapp-v2` tag; `refapp-v1` stays frozen), bundles,
   images and model are frozen before the first confirmatory cell.

Count and repeats come from the power simulation (section 7), not fixed here. Planning
range: 24 to 40 tasks, 5 repeats.

Authoring and qualification reuse the v1 pipeline (gate scripts, naive variants, oracle rules,
`al-test-auditor`, mutation check where it applies). CLAUDE.md task rules apply: no hints, no
weakened oracles; a too-easy task is redesigned, never softened.

## 4. Realistic setup

Inspired by a real BC support repo (U:\Git\DO.Support-NewFormat, surveyed 2026-10-03), not
copied: no customer data, internal hosts, credentials or Continia tooling enter the sandbox.
A real setup holds team instructions and scoped rules, skills that wrap environment tools
(env, symbols, compile/deploy, tests), subagents (test writer, reviewer, "find an existing
function", analyzers), an AL language server plugin, and MCP servers for external systems
(the last is out of scope: no external systems in the sandbox).

The realistic bundle (one level of the factorial, applied as a whole):

| Part | Content | Harness today |
| --- | --- | --- |
| instructions | CLAUDE.md v2: team conventions, investigation order | applied |
| rules | `.claude/rules/*.md`: AL conventions, test rules, breaking changes | NOT applied (run.ps1 is non-recursive) |
| skills | wrappers over the sandbox `cg-al` backend: compile, test, symbols, "reuse before write" lookup | applied |
| agents | `al-test-writer`, `al-reviewer`, `library-function-finder` | staged, NOT applied |
| mcp | al-tools (v1) | applied |

Requirements:

- Fail-closed component validation: every component an arm declares is proven installed in the
  sandbox (runtime inventory check before the agent starts), and every component it does not
  declare is proven absent. A staged-but-absent component refuses the cell. Positive and
  negative inventory tests per component.
- Leakage audit of every bundle (rules, skills, agents) against the oracles and correct
  solutions before freeze, by `al-test-auditor` plus an orchestrator review: a bundle must not
  name a task's fix, its procedures or its oracle checks.
- Instructions that mention the LSP ("use LSP first") are capability-conditional ("if an LSP
  tool is available") and IDENTICAL in the realistic arm with and without LSP, so the LSP toggle
  changes only the LSP.

## 5. AL LSP

- Component: the AL language server exposed to Claude Code's LSP tool (documentSymbol, hover,
  findReferences, diagnostics), the same shape as the owner's local
  `al-language-server-go-windows@claude-code-lsps` plugin.
- Gate S1 (spike, before build work): end-to-end qualification under ContainerUser, offline:
  writable profile/cache/temp paths, binary discovery, runtime dependencies, path/URI handling,
  symbol loading from `.alpackages`, multi-file references, diagnostics refresh after edits,
  known hover/reference results and known-error diagnostics asserted on a fixture, subprocess
  cleanup on cell timeout, startup time and peak RAM per cell, and NO access to hidden oracle
  material (the server indexes only the workspace and `.alpackages`).
- Licensing: an explicit owner decision on the source of the AL language server binaries and
  their use inside our image is required before S1. No workaround is assumed.
- pi: in v2 only if pi supports the same LSP component; otherwise pi stays out (owner choice).

## 6. Metrics

Primary (confirmatory): cost per solved task (list-price estimate), as in v1.

Exploratory, reported per arm and as paired deltas, each labelled exploratory:

| Metric | Definition (frozen with the task set) |
| --- | --- |
| Pass rate, pass^k | as v1 |
| Tokens | per type (uncached in, cache read, cache write, out, reasoning), incl. subagents |
| Effort | turns, wall time, backend builds (from the backend log, not trace classification), test runs |
| Compile-workflow burden | per cell: distinct AL diagnostics by code across agent builds, deduplicated by (code, file, symbol); unknown-symbol class = a frozen code list (e.g. AL0118, AL0132); cells with no agent build reported separately, never as zero |
| First eligible build | outcome of the first backend build after the agent's first edit; no-build cells separate. Workflow measure, not proof of knowledge |
| Final-code check | a host-controlled compile of every cell's final workspace with pinned compiler and analyzers (CodeCop, UICop, frozen rule set): error count, warning count relative to the task's starting workspace |
| Reuse | for tasks whose spec names a procedure to reuse: symbol-resolved call to it on the executed path (oracle test asserts behaviour through it); alternatives listed per task |
| Partial credit | fraction of new-requirement oracle tests passed, weights frozen per task; pass_to_pass preservation separate; not for test-authoring |
| Tool mix | LSP calls by operation, search/read calls, edits, skill invocations, subagent spawns, MCP calls |

The compile-workflow burden is NOT a measure of "knowledge": the LSP shows diagnostics before
a build, which lowers it by design. The final-code check is the treatment-independent quality
measure.

New telemetry needed (the trace metrics today count failed tool calls by class and
trace-classified compile calls only): a structured backend build log per cell (time, apps,
diagnostic codes with file/symbol), LSP operation counts from the trace, and subagent usage.
Missing or incomplete telemetry stays missing, never zero.

## 7. Statistics (pre-registered before any confirmatory cell)

- Design: one blocked 2x2 factorial campaign, realistic {off, on} x LSP {off, on}, all four arms
  on the same tasks and repeats. Arm order randomized within each task/repeat block with a
  recorded seed; quota windows counterbalanced (section 8).
- Confirmatory contrasts on cost per solved task: (C1) LSP effect at realistic off, (C2) LSP
  effect at realistic on, (C3) realistic effect at LSP off. Holm correction across C1 to C3.
  Interaction (LSP effect differs by realistic level) is exploratory unless the power
  simulation shows it is powered.
- Estimator: paired task bootstrap as v1 (task clusters), replication count and seed
  pre-registered. Zero-solve handling decided BEFORE outcomes with a coverage simulation:
  v1's "suppress if any resample has no solve" rule is kept unless the simulation shows a
  pre-registered alternative (e.g. a defined-resample rule with a minimum defined share) keeps
  nominal coverage. Never changed after outcomes.
- Sample size: a simulation of the exact estimator using v1 data and the screening pilot
  (task heterogeneity, repeat variance, cost-success dependence, arm correlation, missing
  cost). Minimum relevant effect: 20% lower cost per solved task. Compare 24/30/40 tasks x
  3/5/8 repeats; pick the smallest design with about 80% power per contrast after Holm and an
  interval-suppression rate under 5%. If no affordable design meets it, the owner decides
  (fewer contrasts, bigger effect, or exploratory only) before authoring finishes.

## 8. Feasibility gates

Each is a gate with a test or a measured result, before the campaign:

1. Component application (section 4): fail-closed inventory, all arms.
2. LSP S1 (section 5) and licensing decision.
3. Subagent cost completeness: fixtures and a live run prove whether parent usage includes
   child usage (no omission, no double count), incl. child models, cache, retries and cancelled
   agents; subagent model pinned; the cell budget limits aggregate work.
4. Team quota: pilot + campaign + retries + subagents budgeted; quota monitored per cell; on
   exhaustion the whole block pauses and resumes (no arm-specific reruns); terminal policy for
   cells cut by quota. Claude Code cost stays a list-price estimate, not cash.
5. Concurrency: the refusal stays until H-01 C1 to C8 (incl. C3/C8, owner route: lane-ops in
   normal mode) and proxy isolation P1/P2 pass, then a load test with parallel cells and
   subagents: backend routing, app/database isolation, leases, cleanup, proxy limits, combined
   LSP + build + judge peak RAM, disk guards, shared-host jobs. Host RAM bars stay (stop under
   10 GB, resume at 14 GB).
6. Scorer qualification: every new scorer (final-code check, reuse, partial credit) qualified
   on correct and naive variants like v1 scorers.

## 9. Scale and cost

Cells = tasks x repeats x 4 arms (e.g. 30 x 5 x 4 = 600) plus pilot (candidates x 3 x 2). At
`--concurrency 1` and v1's cell time this is weeks; measure the median cell wall time from the
frozen archive first. Concurrency (gate 5) is likely 2 to 3 in practice (3 Cronus containers,
host RAM). Claude Code runs on the Team subscription (usage, not cash); pi arms, if any, are
paid under the launch-contract cap (USD 150, USD 5.45 spent).

## 10. Milestones

- M7 Concurrency: H-01 accepted, C3/C8, P1/P2, lift decision, load test (gate 5).
- M8 Task set v2: quotas and strata, refapp-v2, author candidates + held-out, screening pilot,
  power simulation, freeze.
- M9 Realistic bundle: rules + agents applied in run.ps1, fail-closed inventory (gate 1), bundles,
  leakage audit.
- M10 LSP: licensing decision, S1, `lsp` component in image + runtimeFacts + run.ps1.
- M11 Metrics and statistics: backend build log, telemetry, new scorers (gate 6), report
  rollups, factorial contrasts with Holm, subagent accounting (gate 3), pre-registration file.
- M12 Campaign (gate 4) and analysis, v2 freeze like M6.

M8 to M11 can run in parallel (content, infra, infra2, ops); M12 needs all of them and M7.

## 11. Rev 1 review findings and where they are addressed

| Finding (gpt-6.1-sol, rev 1) | Rev 2 |
| --- | --- |
| Blocking: knowledge metric confounded by LSP diagnostics; definitions, telemetry, multiplicity missing | 6 (burden is exploratory, final-code check), 7 (single primary, Holm) |
| Blocking: components not applied today; subagent cost accounting unproven | 4 (fail-closed inventory), 8.1, 8.3 |
| Blocking: 18x5 unsupported; zero-solve suppression | 7 (power simulation, pre-outcome coverage simulation) |
| Major: calibration and generalization | 3 (quotas, strata, symmetric pilot on both arms, held-out, freeze) |
| Major: blocking/randomization, scorer qualification, licensing, load-tested gates | 7, 8.2, 8.5, 8.6 |

## 12. Round 2 review (gpt-6.1-sol: ACCEPT WITH FINDINGS) carried into the plans

`H:\cg-coord\reviews\SPEC-v2-002\review-gpt61sol.md`. Accepted as a design roadmap, not yet an
analysis protocol. The M11 pre-registration task and the M8 screening task must close these
BEFORE screening:

1. Inference contract: bootstrap p-values and direction, missing-pair rule, Holm-adjusted
   decisions vs reported 95% intervals; the interaction's status decided before outcomes (if
   promoted, it joins the Holm family and the power simulation). C3 is named "realistic effect
   without LSP", not a general main effect.
2. Screening: exact stratum boundaries from which pilot outcomes, rounding, deterministic
   selection and tie-breaking, too-few-candidates rule, redesigned task = new candidate with
   fresh screening. The 0/6 and 6/6 filter is described as a screen, not proof of
   intermediate difficulty. Screening on the diagonal arms selects a population; claims are
   scoped to it.
3. Screening prerequisites: component inventory, LSP S1, fixed model and qualified scorers
   (incl. the existing test-authoring discovery limit, caveat C156 / M4-17a) BEFORE screening,
   so M8 screening waits for M9 to M11 gates.
4. Held-out: 3 to 4 tasks in addition to the confirmatory set, excluded from C1 to C3, reported
   separately as a descriptive robustness check (same refapp, same authors), never as evidence
   for BC coding in general; budgeted in section 9.

## 13. Owner answers (2026-10-03)

- Timeline: start now. M8 authoring, M9 realistic bundle and the M10 LSP spike run in parallel;
  the campaign comes after the Directions talk.
- Arms: the 2x2 factorial, Claude Code only. pi is out of v2.
- AL language server: the same source as the owner's local
  `al-language-server-go-windows@claude-code-lsps` plugin; the owner confirmed its licence allows
  use in our private sandbox image.
- Model: the current Sonnet (verify the id with `models --check`), Team usage budget for about
  1,300 cells is OK.

## 14. Open questions for the owner (asked 2026-10-03, answered in 13)

1. Timeline: start after the Directions talk, or start M8 authoring and the M10 licensing
   question now?
2. Confirm the 2x2 factorial (plain, LSP, realistic, realistic+LSP); pi in or out of v2?
3. Team usage budget for roughly 600 to 1,300 Claude Code cells including the pilot.
4. AL language server binaries: which source, and is their use in our private image allowed?
5. Model: Sonnet 5 again, or the current Sonnet?
