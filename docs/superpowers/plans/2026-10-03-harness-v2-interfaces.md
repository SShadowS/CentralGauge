# Harness Bench v2: shared interfaces appendix (M8 to M11)

Status: round 3 reconciliation, 2026-10-03. This file is the ONLY source of truth for every contract
that crosses a plan boundary. The four plans link here and must quote these names exactly. A plan
that needs a different contract changes this file first (orchestrator), then every consumer.

Plans: `2026-10-03-harness-v2-m8-task-set.md` (M8), `...-m9-realistic.md` (M9), `...-m10-lsp.md`
(M10), `...-m11-metrics.md` (M11), all in `H:\cg-coord\plans-v2\`. Spec:
`H:\cg-coord\reviews\PLANS-v2-002\harness-v2-design.md`. Binding rulings:
`H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md` (1 to 10) and owner decisions
`H:\cg-coord\decisions\2026-10-03-v2-plans-round3.md` (accepted defaults: interaction
exploratory; unknown-symbol codes AL0118, AL0132, AL0185; CodeCop + UICop default rules; budget
overshoot bound 1.2x; compacted runs keep cost with the excess recorded; USD 5 cell budget for all
arms; `unscreenable` dropped under a pre-registered missingness rule; the N=40 path may slightly
exceed 1,300 cells; 3 parallel authoring threads).

Column "P" = producer task, "C" = consumer tasks.

## 1. Images, revisions and tags (ruling 1)

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Campaign image | `centralgauge/harness-claude-code:2.1.282-r3`, config `image_revision: "3"`, label `centralgauge.harness.revision=3` | M9-17 Step 2 (built once) | M8-15b, M9-17, M10-09, M12 |
| Dev image tag | `centralgauge/harness-claude-code:2.1.282-r3-dev-<task id>`, revision string `3-dev-<task id>` | the task named in the tag | probe configs only |
| Revision regex | `IMAGE_REVISION = /^[1-9][0-9]{0,3}(?:-dev-[A-Za-z0-9-]{1,32})?$/` in `src/harness/config.ts` | M9-16 | CLI `--revision`, config, manifest |
| Dev refusal | probe CONFIGS may name `3-dev-*`; `loadExperiment` throws `ConfigurationError` "`<path>: arm <id> names development image revision <rev>`" for any arm whose `image_revision` contains `-dev-` | M9-16 | every experiment, M8-15b screening configs, M12 |
| Allocated dev tags | `3-dev-M9-07`, `3-dev-M9-13` (only on the gate 3 fallback), `3-dev-M10-08`; spike variants `2.1.282-r3-dev-M10-02`, `-M10-02b`, `-M10-02c`, `-M10-02d...` (raw `docker build` on the r2 image, r2 labels, used only with `--image` on an r2 config) | as named | as named |
| Build command | `deno task start harness images build claude-code --version 2.1.282 --revision <rev>` (adds the `centralgauge.lsp.al` label after M10-05) | any build task | |
| Build guard | before every build: `if DOCKER_CONTEXT=desktop-windows docker image inspect <tag> >/dev/null 2>&1; then echo "[FAIL] <tag> exists"; exit 1; fi` | every build recipe | |
| Inventoried images | `inventoried(revision)` = integer prefix of the revision >= `INVENTORY_REVISION = 3` (so `3` and `3-dev-*`) | M9-04 | M9-06, M10-06 |

## 2. Trace parser version (ruling 2)

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Parser string | `CLAUDE_CAPABILITIES.parser = "claude-code-trace@5"` | the FIRST of M9-04 / M10-07 to merge (M11-03 is withdrawn) | M11-12 `lspTotal` |
| Pin test | the capabilities assertion in `tests/unit/harness/claude-code.test.ts` changes `@4` to `@5`, only in the bumping task's commit | first of M9-04 / M10-07 | |
| Later merges | extend @5 without touching the string or its test | the other of M9-04 / M10-07 | |
| After the first v2 pilot cell | any parser change needs `@6` | | |

## 3. Component inventory record and installed-set rules (ruling 3)

`C:\cg-inventory.ps1` (repo `harness/images/claude-code/cg-inventory.ps1`) prints exactly one stdout
line before Claude Code starts and exits 0 (ok) or 5 (refused):

```
{"type":"cg_inventory","v":1,"ok":<bool>,"installed":[<sorted unique tokens>],"problems":[<strings>]}
```

| Rule | Exact value | P | C |
| --- | --- | --- | --- |
| Installed tokens | `agents`, `instructions`, `skills` (byte-for-byte install, M9-02); `lsp:<name>` when the declared LSP's preflight passed (M10-06) | M9-02, M10-06 | M9-04 |
| `ok` | `ok === (problems.length === 0)` | M9-02 | M9-04 |
| Exact installed set (adapter) | on ok: `sort(installed) === sort([...["agents","instructions","skills"].filter(k => manifest[k] !== null), ...manifest.lsp.map(s => "lsp:" + s.name)])`; else problem `cg_inventory installed [<got>] but the arm declares [<want>]` | M9-04 | M9-05, M10-06 |
| Loaded tokens | `observed.loaded_components` holds `instructions`, `skills`, `agents`, `mcp:<server>`, `lsp:<name>` | M9-04 | `observedMismatch`, M9-07, M9-17 |
| LSP positive check (ONE, in `componentInventory`) | `lsp:<name>` loaded iff (a) `installed` has `lsp:<name>`, (b) a `system/init.plugins` entry matches `LSP_PLUGINS[<name>]` (section 4), (c) `system/init.tools` has `LSP`; otherwise problem `lsp:<name> not loaded (preflight <passed\|missing>, plugin <present\|absent>, LSP tool <present\|absent>)` | M9-04 | M10-06 (adds no second loop), M10-08 |
| Plugin allow-list | `BUILTIN_INVENTORY[version].plugins` sources plus the identity of each DECLARED LSP; anything else: `unrequested plugin loaded: <source or name>`; tool `LSP` with no declared LSP: `unrequested LSP tool loaded` | M9-04 | M10-06 tests |
| Inventory problems added by M10 | `lsp:al: plugin missing at <path>`, `lsp:al: preflight failed (exit <n>)`, `unknown LSP component: <name>`, `ENABLE_LSP_TOOL is set in an arm without LSP` | M10-06 | M9-05 (`setup_failed`) |
| Settings | `settings.lsp` = sorted `components.lsp`, written only by `nativeSettings`; a config's own `settings.lsp` is refused (`settings.lsp is reserved`) | M10-06 | run.ps1, cg-inventory.ps1 |
| Refusal outcome | (a) pre-start problem (cg_inventory before any credential is read, exit 5): execution `setup_failed`, cost 0, no credential released, no judgment. (b) post-start problem (detected by the adapter after the agent started, e.g. `system/init` mismatch or an unpinned model seen): execution `setup_failed`, no judgment, the credential WAS released and the run's actual usage and cost are KEPT (never zeroed); cost is missing only if reconciliation fails. Both count in spend totals. | M9-05 | M8 screening, M11 |

## 4. LSP identity constants

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Component slug | `al`; configs say `components: { lsp: [al] }` | M10 | M9-08 |
| Plugin identity | `export const LSP_PLUGINS: Readonly<Record<string, { name: string; source: string; path: string \| null }>>` in `src/harness/adapters/claude-code.ts`. M9-04 declares `al: { name: "al-language-server-go-windows", source: "al-language-server-go-windows@inline", path: "C:\\cg-lsp\\al-language-server-go-windows" }` as provisional values; M10-06 Step 1 replaces all three from the S1 capture `tests/fixtures/harness/claude-code/lsp-init.json` (`path: null` when init entries carry no path) | M9-04 (type, provisional), M10-06 (values) | M9-04 allow-list, M10-06, M10-08 |
| Match rule | `p.name === id.name && p.source === id.source && (id.path === null \|\| p.path === id.path)` | M9-04 | |
| Withdrawn name | `LSP_PLUGIN_SOURCES` (M10 rev 2) does not exist; use `LSP_PLUGINS.al.source` | | |
| Image paths | plugin dir `C:\cg-lsp\al-language-server-go-windows`, probe `C:\cg-lsp\lsp-probe.mjs`, definition `harness/images/claude-code/lsp/al-lsp.json` (copied to `C:\cg-lsp\al-lsp.json`), label `centralgauge.lsp.al` | M10-04, M10-05 | M10-06, M10-09 |
| run.ps1 | LSP arm: `--plugin-dir C:\cg-lsp\al-language-server-go-windows` and `$env:ENABLE_LSP_TOOL = '1'`; other arms remove `ENABLE_LSP_TOOL`; both before the inventory call | M10-06 | M9-03 run.ps1 |

## 5. LSP trace fields (ruling 9) and contamination reporting

| Field | Exact shape | P | C |
| --- | --- | --- | --- |
| Tool event transport | `lsp:<operation>` with `<operation>` matching `^[A-Za-z]{1,40}$`, else `lsp:invalid` | M10-07 | `traceMetrics` |
| Capability marker | `CLAUDE_CAPABILITIES.trace_types` gains `"lsp_call"` at @5 (LSP tool calls carry the transport above) | M10-07 | `traceMetrics` |
| `TraceMetrics.lsp_calls` | `{ total: number; by_op: Record<string, number> } \| null`; null when `trace_types` lacks `"lsp_call"` (reason for consumers: `trace parser before claude-code-trace@5`), never 0 for unobservable; tool errors counted; `total` = sum of `by_op` | M10-07 | M11-12 `lspTotal` |
| `TraceMetrics.lsp_shell_calls` | `number \| null` (null under the same condition): shell calls whose recorded command matches `/cg-lsp\|al-lsp-wrapper\|al-call-hierarchy\|EditorServices\|CodeAnalysis\.dll/i`; a best-effort audit (indirect scripts, aliases and copies are not detected) | M10-07 | M11-12 |
| `raw_usage.lsp_passive_diagnostics` | `number \| null`; LSP arm with nothing observable: null and `raw_usage.incomplete_reasons.lsp_passive_diagnostics = "LSP diagnostics are not in the stream-json output (S1)"`; non-LSP arm: null (not applicable) | M10-07 | M11-12 |
| Contamination rule (pre-registered in stage A text) | `lsp_shell_calls` is reported per arm as an exploratory count; no cell is ever excluded or re-run because of it | M11-16 | M11-12 report |
| M11 reader | `lspTotal(e, m) = parser < @5 \|\| m.lsp_calls === null ? null : m.lsp_calls.total` | M11-12 | |

## 6. Usage reconciliation (gate 3, ruling 4)

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Field | `telemetry.raw_usage.usage_reconciliation`, present only on inventoried images: `{ status: "exact" } \| { status: "compaction_excess"; excess: Record<model, { input; read; write }> } \| { status: "unreconciled"; why: string }` | M9-06 | M11-12, M11-14, M9-13..17 |
| Required source fields (each must be a count, `isCount`; never `num()` zero-filled) | streamed assistant `message.usage`: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`; sub-agent `tool_use_result.usage`: the same four; `result.modelUsage[<model>]`: `inputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `outputTokens`. A missing or non-count field: `unreconciled`, why `<source> <field> missing or not a count` | M9-06 | |
| Model sets | the model set of `modelUsage` must equal the set of streamed message models plus sub-agent models; why `model <m> is only in modelUsage` / `model <m> is only in the stream` | M9-06 | |
| Compaction exception (owner default) | allowed only with >= 1 `compaction` trace event, only for the main-session model, only on input (cache read and cache write excess 0), and never when the input excess equals one sub-agent's streamed or final input (suspected double count); otherwise `unreconciled` | M9-06 | |
| Unreconciled | `telemetry.cost_usd = null`, `telemetry.per_model = []`, reason in `raw_usage.missing` | M9-06 | M11-12 (tokens and cost missing) |
| Gate 3 evidence | only `exact` runs count (M9-13, M9-14, M9-17 Step 4, M11-14 co-sign); `compaction_excess` keeps its cost but never closes gate 3 | M9, M11-14 | |
| Disclosure | the report lists per arm the count of cells per `usage_reconciliation.status` | M11-12 | |
| Budget | `max_budget_usd: 5` all arms; overshoot bound `reported_cost_usd <= 1.2 x max_budget_usd` | M9-08, M9-13 | |

## 7. Task measures and measurement-only fixtures

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Measures file | `harness-tasks/tasks/HX-NNN/measures/measures.yml`, M11 `TaskMeasuresSchema` (`v: 1`); every non-test-authoring candidate; included in `oracleHash` | M8 Common procedure A4/A9 | M11-04 `loadTaskMeasures`, M11-14 |
| Partial credit split | `partial_credit.weights`: weight `1` for each NEW-REQUIREMENT row; `partial_credit.hidden_regressions`: every other `fail_to_pass` procedure. A row is new-requirement when it FAILS on `baseline` in the candidate's first promoted gate report (A9, before the seal; a baseline whose oracle did not compile makes every row new-requirement). Fixed at the seal; M8-21 Step 4 re-derives it from the freeze re-gate and must find the same split (else stop, `coord ask`) | M8 A9 | M11-04, M11-14 |
| Reuse block | `reuse: { targets: [{ codeunit, procedure, signature, file, perturb }], tests: [{ codeunit, procedures }] }` for every reuse-flagged candidate (`size.reuse` non-null), else `reuse: null` | M8 A4 | M11-06 |
| Fixture folder | `harness-tasks/tasks/HX-NNN/fixture/<name>/` (singular, same layer rules as `naive/`, never under `Test/`); static checks only, never in a gate run | M8-01 (`checkTask`), M8 A3 | M11-07 |
| Fixture variant id | `fixture/<name>`; M11 `VARIANT = /^(correct\|reference-tests\|naive\/[A-Za-z0-9_-]+\|fixture\/[A-Za-z0-9_-]+)$/`; qualify manifest task key `fixture: [<names>]`; `variantAllowed` lists `fixture/<n>` | M11-04, M11-07 | M8-06, M11-14 |
| Withdrawn names | `fixtures/` (M8 rev 2) and `measure/` (M11 rev 2) | | |
| Required fixtures (M8-06, wave 1) | on >= 3 reuse-flagged candidates: `fixture/duplicated-logic` `{reuse_executed: false, reuse: false}`, `fixture/dead-call` `{false, false}`, `fixture/comment-only` `{false, false}`, `fixture/token-call` `{reuse_executed: true, reuse: false}`; on >= 1 of them `fixture/caught-call` (target called inside a `[TryFunction]`, result used; expectation written by the author under the M11-06 rule "executed = marker observed OR effective"); on one candidate `fixture/unused-variable` `{new_warning_codes: [AA0137], partial_credit: 1}` | M8-06 | M11-14 |
| `expect` rows | `correct: {partial_credit: 1, final_errors: 0}` plus `reuse_executed: true, reuse: true` when reuse-flagged; each `naive/<x>: {partial_credit: <measured over the weights>}` | M8 A4/A9 | M11-14 |
| Delivery date | wave 1 with measures, split and fixtures gated by 10-12 | M8-06, M8-07 | M11-14 (10-16) |

## 8. Screening exports M11 imports from M8 (`scripts/harness/screening.ts`, M8-02)

```ts
export const RulesSchema;                 // zod; the `rules` key of harness-tasks/v2/screening.yml
export type Rules = z.output<typeof RulesSchema>;
export type Kind = (typeof TASK_KINDS)[number];
export const STRATA = ["easy", "intermediate", "hard"] as const;
export type Stratum = (typeof STRATA)[number];
export interface Eligible { id: string; stratum: Stratum; kind: Kind; coupling: string[]; large: boolean }
export interface Selection { n: number; targets: Record<Stratum, number>; selected: string[];
  by_stratum: Record<Stratum, string[]>; deviations: string[]; shortfalls: string[] }
export function stratumOf(solved: number, total: number): Stratum | "dead" | "saturated";
export function select(pool: Eligible[], n: number, r: Rules, rank: Map<string, string>): Selection;
```

Rules file: `harness-tasks/v2/screening.yml` (`v: 1`, `rules`, `candidates`); M11-13/15 read it with
`--rules harness-tasks/v2/screening.yml`. Selection JSON `harness-tasks/v2/selection.json` (M8-19):
`{ v: 1, status: "ok" | "too_few", head, seals: [{tag, commit}], campaigns: [{id, experiment}],
held_out, confirmatory_tasks, held_out_tasks, candidates, selection: Selection }`; committed only with
`status: "ok"`. M11-10 reads `status`, `held_out`, `selection.selected`, `selection.n`.

## 9. Seals, ledger and tags (M8; ruling 10)

| Item | Exact value |
| --- | --- |
| Seal tags (annotated) | `harness-v2-screen-start`, `harness-v2-screen-w4`, `harness-v2-screen-r<k>` (replacement round k) |
| Ledger tags (annotated) | `<seal tag>-ledger`, on the commit that appends that seal's ledger entry |
| Refapp tag | `refapp-v2` on the start-seal commit (local at M8-15a, pushed at M8-21) |
| Push | the orchestrator pushes every seal and ledger tag to origin at creation (ruling 10) |
| Ledger file | `harness-tasks/v2/seals.yml`, `{ v: 2, seals: [Entry] }` |
| Entry | `{ tag, tag_object: <40 hex>, commit: <40 hex>, pushed_at: <ISO>, drand_chain: <64 hex, /info "hash">, drand_round: <int>, round_time: <ISO>, randomness: <64 hex>, prev: "genesis" \| <64 hex> }` |
| Chain rule | `prev` of entry 0 is `"genesis"`; `prev` of entry i is `hashJson(entry i-1)` |
| Round rule | `round = ceil((pushed_unix + 600 - genesis_time) / period) + 1`; `round_time = genesis_time + (round - 1) * period`; `round_time >= pushed_at + 10 min` |
| Verification (`ledgerProblems`, run by every `screening.ts status/select`) | for each entry i: chain rule; `git rev-parse <tag>` = `tag_object` and `<tag>^{commit}` = `commit`; `seals.yml` at `<tag>` holds exactly entries 0..i-1 (absent for i = 0); `seals.yml` at `<tag>-ledger` holds exactly entries 0..i; a missing ledger tag is a problem |
| Chronology (`chronologyProblems`) | every `v2-screen-*` campaign's `created_at` is later than the `round_time` of the first seal of every task it ran |
| Seed and rank | seed `<commit>:<randomness>` of the candidate's first seal; rank `sha256("<seed>:<id>")` |
| External re-check | M8-19 Step 1 re-fetches each round from `https://api.drand.sh/public/<round>` and recomputes the round from the push time |

## 10. Pre-registration (ruling 5) and its anchors

| Item | Exact value | P | C |
| --- | --- | --- | --- |
| Document | `harness/preregistration/cc-v2-factorial.yml`; experiment key `preregistration: preregistration/cc-v2-factorial.yml` (added to `harness/experiments/cc-v2-factorial.yml` with `contrasts` and `interaction` by M11-16 Step 1) | M11-16, M11-17b | M11-10, M11-11, M12 |
| Simulation outputs | stage A `harness/preregistration/cc-v2-factorial.sim-a.json` + `H:\cg-coord\m11\sim-a.md`; stage B `harness/preregistration/cc-v2-factorial.sim-b.json` + `H:\cg-coord\m11\sim-b.md` | M11-15, M11-17a | M8-07b, M8-12, M8-19, M11-16, M11-17b |
| Stage A held-out | `held_out: { count: 4, rule: <text>, seal: "harness-v2-screen-start", tasks: [<4 ids from M8-15a>], in_family: false }` | M8-15a (ids), M11-16 | M11-10 (`selection.held_out` must equal `tasks`) |
| Stage A tag | `harness-v2-prereg-a`, annotated, message contains the line `protocol_sha256: <64 hex>` | M11-16 | M11-10 `verifyPrereg` |
| Stage A decision file | `H:\cg-coord\decisions\<approval date>-harness-v2-prereg-a.md`, planned `2026-10-24-harness-v2-prereg-a.md`; consumers resolve the glob `*-harness-v2-prereg-a.md` (exactly one match). Lines: `protocol_sha256: <hex>`, `file_sha256: <hex>`, `tag: harness-v2-prereg-a`, `tag_object: <40 hex>`, `OWNER-APPROVED: <words> (<ISO time>)` | M11-16 | M8-15b, M11-10 (via `--prereg-decision`) |
| Anchor verification | `verifyPrereg(..., decisionPath)`: decision file parses; `git rev-parse harness-v2-prereg-a` = `tag_object`; `protocolSha` of the document at the tag commit = decision `protocol_sha256`; `protocolSha(current doc)` and `doc.stage_a.sha256` both = decision `protocol_sha256`. Editing the document AND its `stage_a.sha256` therefore fails | M11-10 | `harness run`, `harness report` |
| CLI | `harness run <exp>` and `harness report <exp>` take `--prereg-decision <stage-A decision>` and `--prereg-b-decision <stage-B decision>`, both required when the experiment has `preregistration` | M11-10, M11-11 | M12 |
| Campaign record | `preregistration: { path, sha256, protocol_sha256, decision_sha256, stage_b_decision_sha256 }`; resume and report refuse a changed document or either decision file | M11-10 | M11-11 |
| Stage B tag | `harness-v2-prereg-b`, annotated, message line `stage_b_sha256: <64 hex>` (sha256 of the yml text with CRLF normalized to LF) | M11-17b | M11-10 |
| Stage B decision file | `H:\cg-coord\decisions\<date>-harness-v2-prereg-b.md`, planned `2026-11-06-harness-v2-prereg-b.md`. Lines: `stage_b_sha256: <hex>`, `tag: harness-v2-prereg-b`, `tag_object: <40 hex>`, one `amendment: <design\|family\|confirmatory>` per owner-approved amendment, `OWNER-APPROVED: ...` | M11-17b | M11-10 (via `--prereg-b-decision`) |
| Stage B anchor verification | current file text and the file at `harness-v2-prereg-b` both hash to `stage_b_sha256`; the tag resolves to `tag_object`; every amendment key in the document is listed in the decision file; approval text inside the document authorizes nothing; the design/simulation waiver needs an externally approved `design` amendment | M11-10 | `harness run`, `harness report` |
| Pool factor | `pool_factor: 2` in `simulation.args` (section 12) | M11-15 | M11-10 tests, M8-12 |

## 11. Sequencing (no cycles)

Stage A versus the start seal: **the start seal comes first.** The seal and held-out designation
need no M11 input; stage A records the held-out ids; screening needs both.

```
M8-14 start set (10-20..21) -> M8-15a start seal + ledger + held-out ids (10-21)
   -> M11-16 stage A freeze (10-22..24; also needs M11-10, M11-14, M11-15, M9-08)
   -> M8-15b screening authorization (10-25; also needs M9-17, M10-09, M9-12 lock)
   -> M8-16a / M8-16b pilots (10-25..31)
   -> M11-17a provisional design: sim-b (N, R), NOT binding (11-01)
   -> M8-19 select --n N (11-02) [-> M8-17/M8-18 -> M8-19 rerun, only on a shortfall]
   -> M8-20 / M8-21 freeze (11-03..05)
   -> M11-17b stage B binding: selection, design, experiment tasks/repeats, approval (11-06)
   -> M12 first confirmatory cell
N_prelim: M11-15 sim-a.md (10-13) -> M8-07b capacity checkpoint (10-12, rerun 10-13) -> M8-12 wave 4 size
```

Stage B is the only binding design; M11-17a's output is provisional until M11-17b. A freeze that drops
a task re-runs M8-19 with the same N before M11-17b, so stage B never binds a selection the freeze
later changes.

## 12. Pool factor and capacity model (M8 and M11 use the same numbers)

- `pool_factor = 2.0`: screened candidates = `ceil(2.0 x N_prelim)`, plus 4 held-out (never screened).
- Authoring rate 3 gated candidates per day (owner: 3 threads), re-measured at M8-07b.
- Pilot cells = 6 x screened candidates, plus rescreens (6 cells per incomplete candidate; budget 10%).
- Campaign cells = (N + 4) x R x 4, R from stage B (table uses R = 5).

| N_prelim | Screened | Pool ids | Wave 4 size | Wave 4 authoring | Wave 4 ends | Pilot cells (+10%) | Campaign cells R=5 | Total | Freeze | Stage B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 48 | HX-007..HX-058 | 16 | 6 days | 10-25 | 288 (317) | 560 | 877 | 11-05 | 11-06 |
| 30 | 60 | HX-007..HX-070 | 28 | 10 days | 10-29 | 360 (396) | 680 | 1,076 | 11-09 | 11-10 |
| 40 | 80 | HX-007..HX-090 | 48 | 16 days | 11-04 | 480 (528) | 880 | 1,408 | 11-15 | 11-16 |

The N=40 row is over 1,300 cells and its freeze is after 11-12: M8-07b sends it to the owner (cap
N_prelim at 30, or accept the slip; the owner already accepts "slightly" over 1,300). With R = 3 or 8
the campaign column scales linearly (R x 112, 136, 176). M11-13's `drawPool` and every M11-15/17a run
use `--pool-factor 2.0`.

## 13. Task dependency table

Dates are planned windows for the N_prelim = 24 path. "ext" = outside M8 to M11 (H-01, M7, M12).
Every dependency ends on or before the dependent task's start; same-day hand-offs are marked `=`.

| Task | Lane | Window | Deps |
| --- | --- | --- | --- |
| M8-01 | ops | 10-03..05 | none |
| M8-02 | infra | 10-03..05 | none |
| M8-03 | ops | 10-04..05 | none |
| M8-04 | content | 10-04..07 | M8-01, M8-02, M8-03 (rules before coupling objects are final) |
| M8-05 | ops | 10-07 | M8-04 = |
| M8-06 | content | 10-07..11 | M8-05 = |
| M8-07 | ops | 10-09..12 | M8-06 (per candidate) |
| M8-07b | orchestrator | 10-12, rerun 10-13 | M8-07 =, M11-15 (rerun) |
| M8-08 | content | 10-11..15 | M8-07 started |
| M8-09 | ops | 10-12..16 | M8-08 (per candidate) |
| M8-10 | content | 10-15..19 | M8-09 started |
| M8-11 | ops | 10-16..20 | M8-10 (per candidate) |
| M8-12 | content | 10-20..25 | M11-15, M8-07b, M8-11 started |
| M8-13 | ops | 10-21..26 | M8-12 (per candidate) |
| M8-14 | content | 10-20..21 | M8-05, M8-07, M8-09, M8-11 = |
| M8-15a | infra + orchestrator | 10-21 | M8-02, M8-14 = |
| M8-15b | infra | 10-25 | M8-15a, M11-16, M11-14, M9-12 (lock), M9-17, M10-09 |
| M8-15c | infra + orchestrator | 10-27 | M8-13 |
| M8-16a | ops | 10-25..28 | M8-15b =, M7 (ext) |
| M8-16b | ops | 10-28..31 | M8-15c, M8-16a =, M9-12 (wave 4 audit) |
| M8-19 | infra | 11-02 | M8-16b, M11-17a |
| M8-17 | content (conditional) | 11-03..05 | M8-19 exit 2 |
| M8-18 | ops (conditional) | 11-05..08 | M8-17, M9-12 |
| M8-19r | infra (conditional rerun) | 11-09 | M8-18 |
| M8-20 | infra | 11-03 | M8-19 (or M8-19r) |
| M8-21 | ops | 11-03..05 | M8-20 = |
| M9-01 | ops | 10-03..04 | H-01 r2 (ext) |
| M9-02 | infra2 | 10-03..04 | none |
| M9-09 | infra2 | 10-03..04 | none |
| M9-16 | infra2 | 10-03..04 | H-01 (ext) |
| M9-10 | content | 10-03..05 | M9-09, M9-01 |
| M9-03 | infra2 | 10-05 | M9-02, M9-01, H-01 (ext) |
| M9-11 | content | 10-05..07 | M9-09, M9-10 |
| M9-04 | infra2 | 10-06..07 | M9-03, M9-16, M9-01 |
| M9-05 | infra2 | 10-07 | M9-04 =, M9-16 |
| M9-06 | infra2 | 10-07..09 | M9-04 = |
| M9-08 | infra2 | 10-07..09 | M9-10, M9-11 =, M9-16 |
| M9-07 | ops | 10-09..10 | M9-03, M9-04, M9-05, M9-08 =, M9-10, M9-11, M9-16 |
| M9-12 | content + orchestrator + infra2 | 10-07..24 (audits per seal; lock 10-24) | M9-11; Step 1 per candidate after its A6 audit; lock after M8-15a |
| M9-13 | ops | 10-10..14 | M9-06, M9-07 =, M9-08 |
| M9-14 | infra2 | 10-14..15 | M9-13 = |
| M9-15 | orchestrator | 10-15..17 | M9-07, M9-12 Steps 1-2, M9-14 = |
| M9-17 | infra2 + ops + orchestrator | 10-18..21 (r3 built 10-18) | M9-15, M10-04..07 merged, M10-08 |
| M10-01 | infra | 10-03..05 | H-01 (ext) |
| M10-02 | ops | 10-04..08 | M10-01 (Steps 4 on), r2 image |
| M10-03 | orchestrator | 10-08 | M10-02 = |
| M10-04 | infra | 10-09..10 | M10-03, M9-03, H-01 (ext) |
| M10-05 | infra | 10-10..11 | M10-04 = |
| M10-07 | infra | 10-09..11 | M10-02 captures, H-01 (ext) |
| M10-06 | infra | 10-11..13 | M10-05 =, M9-02, M9-03, M9-04, M9-05, M9-08, M10-02 captures |
| M10-08 | ops | 10-14 | M10-04..07, M9-02..05, M9-08, M9-16 |
| M10-09 | ops | 10-19..21 | M10-08, M9-17 Step 2 (r3 built 10-18) |
| M11-04 | infra2 | 10-03..05 | H-01 (ext) |
| M11-09 | infra | 10-03..06 | H-01 (ext) |
| M11-08 | infra | 10-06 | H-01 (ext) |
| M11-13 | infra2 | 10-05..09 | M11-09 (=10-06 for the stats imports), M8-02 = |
| M11-01 | infra | 10-07 | H-01 (ext) |
| M11-02 | infra | 10-07..09 | M11-01 = |
| M11-05 | infra2 | 10-09..11 | M11-04 |
| M11-10 | infra | 10-09..12 | M11-08, M11-09, M8-02 |
| M11-15 | ops | 10-10..13 | M11-13, M8-02 |
| M11-06 | infra2 | 10-11..14 | M11-04 |
| M11-11 | infra | 10-12..14 | M11-08, M11-09, M11-10 = |
| M11-07 | infra2 | 10-14..16 | M11-04, M11-05, M11-06 = |
| M11-12 | infra | 10-14..17 | M11-01, M11-02, M11-04, M11-11 =, M10-07, M9-06 |
| M11-14 | ops | 10-16..20 | M11-07 =, M8-06 + M8-07 (fixtures, split), H-01 (ext) |
| M11-16 | orchestrator + owner | 10-22..24 | M11-10, M11-14, M11-15, M8-15a, M9-08 |
| M11-17a | orchestrator + ops | 11-01 | M11-16, M8-16b |
| M11-17b | orchestrator + owner | 11-06 | M11-17a, M8-19, M8-21 |

Cycle check (done 2026-10-03 by ordering the table by window): every edge points from an earlier or
same-day window to a later one, so the graph is acyclic. The only loop in the text (select, then
replacements, then select again) is unrolled as M8-19 then M8-19r. Dependencies on later-dated tasks
found and fixed in round 3: M10-09 needed the r3 image (M9-17, after 10-17) but was dated 10-15..17
(moved to 10-19..21); M9-15 (10-17) needed the M9-12 lock (10-24) (now needs Steps 1-2 only; the lock
gates M8-15b); M11-16 (10-20..21) needed the held-out ids from M8-15a (10-21) (moved to 10-22..24);
M11-17 needed M8-19 while M8-19 needed M11-17 (split into M11-17a and M11-17b).

Critical path (N_prelim 24): M8-02 -> M8-04 -> M8-05 -> waves 1-3 (M8-06..M8-11) -> M8-14 (10-21)
-> M8-15a (10-21) -> M11-16 (10-24) -> M8-15b (10-25) -> M8-16a (10-28) -> M8-16b (10-31) ->
M11-17a (11-01) -> M8-19 (11-02) -> M8-20 (11-03) -> M8-21 (11-05) -> M11-17b (11-06). Infra side
paths with slack: M9-17 and M10-09 finish 10-21 (3 days slack to M8-15b); M11-14 finishes 10-20.
