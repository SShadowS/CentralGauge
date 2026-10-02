# Harness Bench v2: bigger task set, realistic setups, AL LSP arm

Status: DRAFT for owner review (2026-10-03). Builds on 1a
(`2026-09-24-harness-bench-design.md`), 1b (`2026-09-24-harness-refapp-design.md`) and the
M6 freeze (`H:\cg-coord\m6\handoff.md`). Nothing here touches the frozen v1 data.

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
limit, M4-17a). The bootstrap over 6 tasks has undefined resamples, so the pre-registered
interval is suppressed. v1's setups are also thin: one CLAUDE.md, an MCP server with three
tools, four skills. Real teams run richer setups (rules, skills that wrap environment tools,
review/test subagents, an AL language server), and that is what the talk audience uses.

## 2. Goals

G1. A task set where the baseline solves most tasks sometimes and few tasks always or never,
so comparisons have signal.
G2. Arms that look like a real BC team's Claude Code setup, built from parts, so each part's
effect can be isolated.
G3. Measure what the AL language server changes: cost, tokens, turns, tool mix, and whether
the agent's changes rest on better knowledge of the code base (fewer wrong-symbol errors,
fewer compile loops, better quality of the final code), not only pass rate.
G4. Metrics that explain a result, not only score it.

Non-goals: new harnesses beyond Claude Code and pi; new models beyond one Anthropic and one
OpenRouter model per campaign; any public scoreboard ingest.

## 3. Task set v2

- Size: 15 to 20 qualified tasks (HX-007 onward), plus the v1 tasks that pass calibration.
- Calibration band: a task stays only if the plain baseline (`cc-sonnet-plain`) solves it in
  20% to 80% of 5 pilot repeats (1 to 4 of 5). Saturated or dead tasks are retired from v2,
  never softened (CLAUDE.md task rules apply: no hints, no weakened oracles).
- Bigger tasks: at least half touch 3 or more objects across 2 or more files, need an existing
  procedure found and reused (not reimplemented), or require following an event/interface
  through the refapp. This is where symbol knowledge should matter.
- Coverage: the coupling styles uncovered in v1 (caveat C43: single-instance, temporary
  tables, CommitBehavior) get at least one task each; kinds stay feature, bugfix, refactor,
  test-authoring, with no kind above 40%.
- Refapp: grows as needed (new objects for the bigger tasks) on a new tag `refapp-v2`; v1's
  `refapp-v1` stays frozen.
- Repeats: 5 per cell in campaigns.
- Authoring and qualification reuse the v1 pipeline (gate scripts, naive variants, oracle
  rules, `al-test-auditor` review, mutation check where it applies). Each task gets a human
  summary (CLAUDE.md "Every Task Needs a Human Summary" applies to harness tasks only if they
  reach the site; they do not today).

## 4. Realistic setups

Inspired by a real BC support repo (U:\Git\DO.Support-NewFormat, surveyed 2026-10-03), not
copied: no customer data, internal hosts, credentials or Continia tooling enter the sandbox.
What it shows a real setup holds:

- Instructions: CLAUDE.md with team conventions plus scoped rule files (investigation order
  "LSP first, then search", breaking-change tables, quality references).
- Skills that wrap environment tools: env setup, dependency/symbol download, compile and
  deploy, run tests and parse results.
- Subagents: test writer, code reviewer, "find an existing function before writing one",
  performance/error-pattern analyzers.
- An AL language server plugin for the built-in LSP tool.
- MCP servers for work-item systems (out of scope here: no external systems in the sandbox).

v2 components (each a separate bundle so arms can add one at a time):

| Component | Content | Status in the harness today |
| --- | --- | --- |
| `instructions` | CLAUDE.md v2: team conventions, investigation order | applied |
| `rules` (part of instructions) | `.claude/rules/*.md`: AL conventions, test rules, breaking changes | not applied (new) |
| `skills` | wrappers over the sandbox's `cg-al` backend: compile, test, symbols, a "reuse before write" lookup | applied |
| `agents` | `al-test-writer`, `al-reviewer`, `library-function-finder` | staged, NOT applied by run.ps1 |
| `lsp` | AL language server plugin + symbols in `.alpackages` | schema only; runtimeFacts throws |
| `mcp` | al-tools (v1) | applied |

Arms (Claude Code, one model; pi only where it supports the component):

- `cc-plain` (v1 plain, re-run on v2 tasks: the baseline)
- `cc-lsp` (plain + LSP)
- `cc-realistic` (instructions v2 + rules + skills + agents + al-tools MCP, no LSP)
- `cc-realistic-lsp` (all of it)

## 5. AL LSP arm

- Component: the AL language server exposed to Claude Code's LSP tool (documentSymbol,
  hover, findReferences, diagnostics), the same shape as the owner's local
  `al-language-server-go-windows@claude-code-lsps` plugin.
- Needs in the sandbox: the language server binaries, `app.json` at the workspace root,
  symbols in `.alpackages` (already produced by the staging path), memory headroom.
- Open risks, settled by a spike before any build work (S1 below): it runs in the Windows
  sandbox image as ContainerUser; startup time and RAM per cell; licensing of the AL language
  server binaries for redistribution inside our image (if not allowed, the image downloads it
  at build time from the official source and the image stays private); whether the egress
  policy lets it start offline.
- Experiments: `cc-lsp-vs-plain` (isolates LSP) and `cc-realistic-lsp-vs-realistic` (LSP on
  top of a real setup). Optional: `cc-realistic-vs-plain`.

## 6. Metrics

Already recorded per execution, not yet reported (trace-metrics.ts): tool_calls, tool_errors,
errors_by_class, by_transport, compile_calls, model_requests, subagents,
skill_invocations, mcp_calls; per model: tokens in (uncached, cache read, cache write), out,
reasoning; turns, compactions, wall_ms.

v2 report adds, per arm and as paired deltas (exploratory unless pre-registered):

- Cost: cost per solved task (primary, unchanged), total tokens by type, cache share.
- Effort: turns, wall time, compile calls, test runs, compile-fail loops (consecutive failed
  compiles before the first clean one).
- Tool mix: LSP calls by operation, search/grep/read calls, subagent and skill invocations,
  MCP calls. Share of "lookup" calls (LSP + search) vs edits.
- Knowledge quality: compile errors by class per cell, especially unknown symbol/member
  errors (AL0118, AL0132 and similar), first-compile success rate, reuse of an existing
  procedure where the oracle names one (a scorer check), size of the final diff.
- Code quality of the final workspace: CodeCop/UICop warning count at final compile,
  pass_to_pass regressions, partial credit (fraction of oracle tests passed) as an exploratory
  metric next to the binary verdict.

Primary metric stays cost per solved task with the v1 pre-registration rules. A second
pre-registered metric for the LSP experiments: unknown-symbol compile errors per cell
(lower is better), because that is the direct "better knowledge base" claim.

## 7. Scale and time

- Cells per experiment: tasks x repeats x arms = 18 x 5 x 2 = 180.
- At `--concurrency 1` that is too slow if v1's cell time holds (measure the median cell
  wall time from the frozen archive first; at 15 min a cell, one experiment is 45 hours).
- Concurrency needs the refusal lifted: H-01 (non-admin user, in progress), its C3/C8 proofs
  (owner-approved route: lane-ops in normal mode), and the proxy isolation proofs P1/P2
  (M1-33c). These become a prerequisite milestone.
- Host memory bars (stop below 10 GB, resume at 14 GB) and the 3 Cronus containers bound
  concurrency in practice (likely 2 to 3).

## 8. Cost

Claude Code runs on the Team subscription (usage, not cash). Four Claude Code arms x 90 cells
is about 360 cells per pair of experiments; Team usage limits must be checked with the owner
before the campaign. pi arms are paid (OpenRouter), under the launch contract cap (USD 150,
USD 5.45 spent).

## 9. Milestones

- M7 Concurrency: H-01 accepted, C3/C8 + P1/P2 proofs, lift decision (M5-11 refusal).
- M8 Task set v2: refapp-v2, author and qualify HX-007+, calibration pilot, freeze.
- M9 Realistic components: rules, agents applied in run.ps1 (plus hooks/plugins if cheap),
  v2 bundles, adapter observability.
- M10 LSP: spike S1, then the `lsp` component in image + runtimeFacts + run.ps1, tests.
- M11 Metrics: report rollups and the new knowledge-quality scorers.
- M12 Campaigns and analysis, with a v2 freeze like M6.

M8 to M11 can run in parallel (content, infra, infra2); M12 needs all of them and M7.

## 10. Open questions for the owner

1. Timeline: after the Directions talk, or start M8/M10 spike now?
2. Experiments: confirm `cc-lsp-vs-plain` and `cc-realistic-lsp-vs-realistic`; add
   `cc-realistic-vs-plain`? Keep a pi arm in v2?
3. Team usage budget for about 360 to 720 Claude Code cells.
4. AL language server source and licensing: reuse the binaries behind the owner's local
   plugin, or download from the official AL extension at image build?
5. Model: Sonnet 5 again, or the current Sonnet?
