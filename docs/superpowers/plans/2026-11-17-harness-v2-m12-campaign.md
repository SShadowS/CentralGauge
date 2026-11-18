# Harness Bench v2, M12 Confirmatory Campaign and Analysis (gate 4) Implementation Plan

> **Shared interfaces:** every cross-plan name, path, record shape, tag and flag in this plan is defined in `docs/superpowers/plans/2026-10-03-harness-v2-interfaces.md` (the appendix). M12 is a consumer of sections 1, 6, 10 and 12. Where this plan and the appendix differ, the appendix wins and this plan is the bug.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the one pre-registered confirmatory campaign `cc-v2-factorial` (4 arms x 43 tasks x 8 repeats = 1,376 cells), analyse it exactly as `harness/preregistration/cc-v2-factorial.yml` says, freeze the v2 data like M6 froze v1, and hand the owner a write-up in which every number is bound to a hashed snapshot.

**Architecture:** No new statistics. `harness run` creates and resumes the campaign under the two decision files. `harness report` computes C1 to C3 with Holm from the pre-registration, and withholds them unless the design is complete. M12 adds four small things that do not exist yet: a smoke experiment that is not confirmatory, a low-churn campaign watcher, chart and CSV output for contrasts, and a written campaign protocol with a deviations log. Everything else is operations: preflight, launch by the owner, monitoring, resume, close, snapshot, reports, write-up, freeze.

**Tech Stack:** Deno + TypeScript (`cli/commands/harness-command.ts`, `src/harness/campaign.ts`, `prereg.ts`, `report.ts`, `stats.ts`), `scripts/harness/freeze-archive.ts`, `scripts/harness/report-charts.ts`, `scripts/harness/analyze-campaign.ts`, PowerShell 7 watchers (`scripts/harness/ops/h-107/`), `coord`, `jq`.

**Spec:** `docs/superpowers/specs/2026-10-03-harness-v2-design.md`, sections 6, 7, 8 (gate 4), 9 and 10 (M12). Bound inputs: stage-B pre-registration `harness/preregistration/cc-v2-factorial.yml` (tag `harness-v2-prereg-b`), decision files `H:\cg-coord\decisions\2026-10-17-harness-v2-prereg-a.md` and `H:\cg-coord\decisions\2026-11-17-harness-v2-prereg-b.md`, experiment `harness/experiments/cc-v2-factorial.yml`, freeze record `H:\Temp3\harness-spike\M8\freeze\task-set.json` and `pipeline.md` (M8-21 accepted). Freeze precedent: `docs/superpowers/plans/2026-10-14-harness-analysis.md` (M6-01 to M6-08). Runbooks: `docs/superpowers/runbooks/harness-autonomy/README.md`, `lane.md`, `orchestrator.md`.

**Checked against:** master 41567634 (2026-11-17). Every command and flag below was read in `cli/commands/harness-command.ts` or the named script at that commit.

## What exists today (checked 2026-11-17)

- `harness run <experiment>` (`harness-command.ts:4621`): `--dry-run`, `--sample <n>`, `--repeats <n>`, `--concurrency <n>`, `--judge-containers <names|auto>`, `--pool-wait-min`, `--judge-concurrency`, `--seed`, `--max-pause-min`, `--stop-file` (repeatable), `--campaign <id>`, `--rerun <task:repeat:arm>`, `--rerun-file <path>`, `--prereg-decision`, `--prereg-b-decision`, `--unverified-egress-ok <reason>`, `--ignore-usage-reset <reason>`, `--add-accounts-reason <reason>` with `--added-by <who>`. Shared options (`:4402`): `--results-dir`, `--containers`, `--backend-host`, `--backend-port`, `--secrets-dir` (repeat as `label=dir`), `--symbol-store`, `--private-dir`, `--credential-ledger`, `--rev`, `--lineage`, `--unverified-bc-egress-ok <reason>`, `--coord-lease <container>=<token>`, `--key-custody`, `--lane`.
- Campaign creation (`src/harness/campaign.ts:1174-1264`): with a `preregistration` key both decision files are required, `verifyPrereg` must return no problems, and the record stores `preregistration: { path, sha256, protocol_sha256, decision_sha256, stage_b_decision_sha256 }`. A resume re-verifies and refuses a changed document or decision file (`:1369`).
- A run without `--campaign` that finds drift (experiment, task set or arm manifests changed) prints a `[WARN]` and **starts a new campaign** (`campaign.ts:1210`). With `--campaign <id>` it refuses instead.
- Retry policy in code (`src/harness/records.ts:845` `outcomePolicy`): `completed`, `timeout`, `budget_exhausted`, `refusal` are judged, no retry. `harness_crash` without work and `setup_failed` get one automatic retry. `usage_limited` retries after the usage reset. A manual rerun (`--rerun`) is allowed only for a cell that is unscored, once.
- Placed concurrency is capped at 2 (`MAX_PLACED_CONCURRENCY`, `campaign.ts:532`; owner decision `2026-10-03-m7-concurrency.md`).
- `harness report <experiment>` (`:4169`): `--judging campaign|current` (required), `--campaign`, `--results-dir`, `--json`, `--resamples` (default 2000), `--seed` (default 1), `--repeats`, `--root`, `--prereg-decision`, `--prereg-b-decision`. For a pre-registered campaign it re-verifies the pre-registration and the confirmatory block takes resamples, seed, level, alpha, zero-solve rule, family and test from the document (`report.ts:909-960`), not from the flags. The flags drive only the exploratory comparisons.
- The confirmatory block is **withheld** (`confirmatory: { withheld: "<reason>" }`) when judging is not the campaign's, when repeats are cut, when any cell is pending or unrun, or when any terminal cell of a selected task has no cost data (`report.ts:882-908`; ruling `decisions\2026-10-03-m11-11-confirmatory-gate.md`).
- Held-out tasks are excluded from the contrasts and summarised per arm in `confirmatory.held_out` (`report.ts:954`). Exploratory rollups are in `exploratory` (M11-12).
- `harness measure <experiment>` (`:4764`) writes the exploratory measures (final-code check, reuse, partial credit) for judged cells. It opens a harness environment, so it is a container job.
- `harness progress <id>` (`:4229`) is read-only. Its output contains `pass_cells`, `fail_cells` and per-arm cost (`src/harness/progress.ts:31-70`).
- `harness env check`, `harness baseline create`, `harness recover [--recreated <dir>]`, `harness egress verify`, `harness validate`, `harness archive` exist as named.
- `scripts/harness/freeze-archive.ts pack|verify|bind` exists (M6-03). `scripts/harness/report-charts.ts` exists (M6-02) but has no contrast, held-out or exploratory-rollup output, and its `Ledger` schema requires the v1 keys `openrouter_reference` and `pi_stop`.
- Watchers: `scripts/harness/ops/hostwatch.sh`, `watch.sh`, `stops.sh`; low-churn ports `scripts/harness/ops/h-107/hostwatch.ps1`, `stop-bridge.ps1`, `watch-qualify.ps1`. There is no low-churn port of the per-campaign `watch.sh`.
- No smoke experiment for the four v2 arms exists. `--sample` on `cc-v2-factorial` would create the confirmatory campaign itself, so it is not a smoke.

## Size, wall time and cost (from stored records, counts and timings only)

Sources. Wall time: the H-110 measurement, `scripts/harness/ops/h-110/run-001-report.md` (master a52ccd0f); these numbers bind and are not re-derived here. Cost and retries: execution records of the seven `v2-screen-*` campaigns under `H:\cg-coord\jobs\M8-16a\results\harness` (957 executions) and the four-arm pilot `cc-v2-pilot-night2` (264). Pooled over arms and tasks on purpose. No per-arm or per-task figure was read out.

| Quantity | Value |
| --- | --- |
| Cells | 43 tasks x 8 repeats x 4 arms = 1,376 (344 blocks; 1,248 confirmatory + 128 held-out) |
| Cells per arm | 344 |
| Container time per cell (H-110, last screening campaigns) | about 12 to 15 container-minutes |
| Campaign container time (H-110) | 1,376 cells, about 310 container-hours |
| Campaign wall time, running time only (H-110) | about 103 hours on 3 containers (4.3 days). On 2 containers, the D-4 default under the concurrency cap of 2, the same 310 container-hours are about 155 hours (6.5 days) |
| Heavy host use (H-110) | costs about 0.17 hours per hour of use. A busy host for the whole campaign adds about 17.5 hours. Upper bound: model API time may not slow |
| Calendar plan | 7 to 10 days with usage-limit pauses, planned stops and a possible recreate; owner review at 14 days (stop rule h) |
| List-price cost per execution, campaign means | USD 1.02 to 2.30; pooled USD 1.42 (USD 1.59 without the 105 `setup_failed` executions of the Work account) |
| Campaign list-price cost | planned USD 2,000 to 2,200; range USD 1,400 to 3,200 |
| Per arm | 344 cells, about 78 container-hours and about USD 500 to 550 each; range USD 350 to 800. The same figure for each arm: a per-arm split of screening data is blinded |
| Hard ceiling | 1,376 x USD 5 budget = USD 6,880; with the 1.2 overshoot bound USD 8,256 |
| Retries seen in screening | 0 to 2 per campaign, except the campaign that had the Work account in its pool (108) |
| Judging overhead per reset, quiet-host baseline (H-110) | about 62 s golden-restore reset plus about 37 s candidate publish, so about 99 s per reset before tests run |
| Same under a busy host (H-110) | resets about 17 percent slower on every container in step, so about 73 s per reset; it recovers by itself when the host is quiet again |

Cost is a list-price estimate of subscription usage, not cash. The later screening campaigns sit in the upper half of both ranges, so plan for the upper half. The wall-time plan assumes a quiet host (see the host-quiet rule). The 103-hour figure needs three containers working at once, while placed concurrency is capped at 2 in code (`MAX_PLACED_CONCURRENCY`); D-4 decides the layout and M12-08's dry run shows what the code accepts. lane-ops compares the daily medians with the 62 s and 37 s baselines (M12-11 Step 3).

## Global Constraints

- **One confirmatory campaign.** Exactly one campaign record of `cc-v2-factorial` may ever exist. A second one is a deviation that needs the owner before it is created.
- **The owner launches.** The owner starts the smoke campaign, the confirmatory campaign and every resume that follows an unplanned stop. Lanes prepare the command and verify the result. lane-ops' standing grant covers screening campaigns only (`lane.md`, grant 1).
- **Only lane-ops touches containers.** Containers: Cronus281, Cronus282, Cronus283 only. A start needs at least 18 GB free RAM per extra container after the start. A recreate needs the owner.
- **Campaign image:** `centralgauge/harness-claude-code:2.1.282-r3`, `image_revision: "3"`, label `centralgauge.harness.revision=3`. No `-dev-` revision in any arm (`loadExperiment` refuses it).
- **Code freeze.** The campaign runs from one clean checkout, `H:\cg-coord\jobs\M12-run`, at one commit. Nothing is merged into it while the campaign is open. A harness fix during the campaign is a deviation.
- **Blinding during the campaign.** Until M12-12 is accepted nobody runs `harness report` on the confirmatory campaign and nobody reads `pass_cells`, `fail_cells` or per-arm cost from `harness progress`. Monitoring uses the projection in M12-11 Step 2. Smoke results are reported as counts, terminations and timings only.
- **Host-quiet rule.** While a confirmatory cell runs, no heavy interactive app runs on the host (a game, a video encode, a large local build, a second benchmark). H-110 showed that such an app made every container reset about 17 percent slower on both containers at once, and that it recovered without a restart. If one runs anyway, its window (start, end, process name) is logged as a deviation row, class Operational. Cost per solved task does not read wall time, so no cell is excluded or rerun for it; durations stay exploratory.
- **Never the Work account.** No `--secrets-dir` label or directory of the Work account. `MAXWork` only if the owner adds it in D-3.
- **Resume always with `--campaign <id>`.** A resume without it can start a second campaign.
- **Never taskkill a harness process.** Stop with a stop file (`lane.md`, H-59 and H-89).
- **Watchers self-exit and register** in `H:\cg-coord\daemons.tsv` (H-107). One pwsh process that sleeps, no bash loop.
- **No ingest, site, deploy, `sync-catalog --apply` or `publish-setup --apply`.** M12 deliverables go to `H:\cg-coord\m12\`.
- **Analysis is the pre-registration.** Primary metric cost per solved task. Family C1, C2, C3, Holm, alpha 0.05, two-sided bootstrap-t p-values, 10,000 task resamples, seed 20261021, level 0.95. Zero-solve rule `suppress_any_undefined`. Interaction exploratory. Held-out tasks outside the family. No interval-derived verdict anywhere.
- Code tasks: TDD, `deno check`, `deno lint`, `deno fmt` on touched files only, `[OK]`/`[FAIL]` tags, no emoji, no em dash. Container-free tests: `deno task test:unit:no-container` or one file with `deno test --allow-all <file>`. Never the full `test:unit` while a run is live.

## What counts as a deviation

A deviation is anything that makes the campaign differ from the pre-registration, the experiment file, the freeze record or `H:\cg-coord\m12\protocol.md`. Each one gets a row in `H:\cg-coord\m12\deviations.md` before the work continues, and the ones marked "owner" stop the campaign until the owner answers.

| Class | Examples | Who decides |
| --- | --- | --- |
| Protocol | a second campaign record; a change of arms, tasks, repeats, model, image, budget or timeout; `--repeats` or `--sample` on the confirmatory campaign; `--judging current`; any edit of the stage-B file | owner; needs a new stage-B tag and decision |
| Analysis | another estimator, seed, resample count or zero-solve rule; an interim look at outcomes; a metric added to the confirmatory family | owner; reported as post hoc |
| Environment | container recreate; lineage, baseline or compiler identity change; harness code change in `M12-run`; egress mode change; container swap | owner |
| Accounts | a label added or retired; `--ignore-usage-reset` | owner (pre-authorised cases in D-3) |
| Execution | manual rerun; a rejudge; a rederive; a cell cut by quota | orchestrator proposes, owner approves the list (D-10) |
| Operational, no approval needed, still logged | planned pause, usage-limit pause, hostwatch stop, resume with the same command, a host-busy window (heavy interactive app on the host while cells ran) | lane-ops logs it |

Row format: `id | UTC time | class | what happened | cells affected (count, never outcomes) | decided by | decision file | effect on analysis`.

## Owner decision points

| Id | Decision | Task |
| --- | --- | --- |
| D-1 | Approve the campaign protocol (retry, stop and deviation rules) | M12-01 |
| D-2 | Egress mode: sandbox side (`--unverified-egress-ok` or an authorized marker) and BC side (`--unverified-bc-egress-ok`, inner_only, per `2026-11-04-h-36-park-inner-only.md`), with the exact reason texts | M12-01 |
| D-3 | Account pool: labels and directories, and whether lane-ops may add a named reserve label on a resume | M12-01 |
| D-4 | Containers and concurrency: two containers at concurrency 2 with the third as a cold spare, or another layout | M12-01 |
| D-5 | Windows Update: the H-111 mitigation, or accept the exposure with a pre-approved recreate procedure | M12-07 |
| D-6 | Host-quiet rule: the owner keeps heavy interactive apps off the host during the campaign, or accepts that each such window is logged as a deviation; and whether a detected window only logs or also pauses the campaign | M12-07 |
| D-7 | Missing cost data: keep the fail-closed gate and name the fallback now | M12-03 |
| D-8 | Exploratory bootstrap settings | M12-01 |
| D-9 | Launch the smoke campaign; accept or repeat it | M12-09 |
| D-10 | Go or no-go, then launch the confirmatory campaign | M12-10 |
| D-11 | Every resume after an unplanned stop; every deviation marked "owner"; every stop rule that fires | M12-11 |
| D-12 | Approve the manual rerun list; declare the campaign closed | M12-12 |
| D-13 | Sign off the headline wording | M12-17 |
| D-14 | Approve the v2 data freeze and the push of the freeze tag | M12-18 |

## File map

| Path | Task | Lane |
| --- | --- | --- |
| `H:\cg-coord\m12\protocol.md`, `H:\cg-coord\m12\deviations.md` | M12-01 | orchestrator |
| `harness/experiments/cc-v2-smoke.yml`, `tests/unit/harness/v2-configs.test.ts` | M12-02 | infra |
| `tests/unit/harness/report.test.ts`, `H:\cg-coord\m12\missing-data.md` | M12-03 | infra2 |
| `scripts/harness/report-charts.ts`, `tests/unit/harness/report-charts.test.ts`, `tests/fixtures/harness/report-v2-factorial.json` | M12-04 | infra |
| `scripts/harness/ops/h-107/watch-campaign.ps1`, `watch-campaign-test.ps1` | M12-05 | ops |
| `H:\cg-coord\m12\preflight.md` | M12-06 | ops |
| `H:\cg-coord\m12\risks.md` | M12-07 | ops, orchestrator |
| `H:\cg-coord\tasks\M12-08\run.sh`, `dry-cc-v2-factorial.log` | M12-08 | ops |
| `H:\cg-coord\m12\smoke.md` | M12-09 | ops, owner |
| `H:\cg-coord\decisions\<date>-m12-go.md`, `H:\cg-coord\m12\launch.md` | M12-10 | orchestrator, owner |
| `H:\cg-coord\m12\daily\<date>.md` | M12-11 | ops |
| `H:\cg-coord\m12\close.md`, `reruns.txt` | M12-12 | ops, orchestrator |
| `H:\cg-coord\m12\archive\` | M12-13 | ops |
| `H:\cg-coord\m12\reports\`, `charts\`, `ledger.json`, `H:\cg-coord\analysis\cc-v2-factorial\` | M12-14 | ops |
| `H:\cg-coord\m12\analysis-check.md`, `H:\cg-coord\reviews\M12-15\` | M12-15 | orchestrator |
| `H:\cg-coord\m12\caveats.md` | M12-16 | content |
| `H:\cg-coord\m12\writeup-template.md`, `writeup.md` | M12-17 | content |
| `H:\cg-coord\decisions\<date>-v2-data-freeze.md`, tag `harness-v2-data-freeze-<date>` | M12-18 | orchestrator, owner |

## Schedule (planned; start 2026-11-18)

| Window | infra | infra2 | content | ops | orchestrator / owner |
| --- | --- | --- | --- | --- | --- |
| 11-18 to 11-20 | M12-02, M12-04 | M12-03 | M12-16 first version, M12-17 template | M12-05, M12-06, M12-07 | M12-01 (D-1 to D-4, D-8) |
| 11-20 to 11-21 | | | | M12-08, M12-09 | D-5, D-6, D-7, D-9 |
| 11-22 | | | | | M12-10 (D-10) |
| 11-22 to about 12-02 (range to 12-07) | | | | M12-11 | D-11 as needed |
| +1 to +2 days | | | | M12-12, M12-13, M12-14 | D-12, M12-15 |
| +3 to +5 days | | | M12-16 final, M12-17 | | D-13, M12-18 (D-14) |

Deps: M7 to M11 accepted, M8-21 accepted, stage B approved (all true at 41567634). H-110 and H-111 results are inputs to M12-07.

---

### Task M12-01: Campaign protocol and deviations log

**Lane:** orchestrator drafts, owner approves. **Deps:** none. **Window:** 11-18 to 11-20. **Owner decisions:** D-1, D-2, D-3, D-4, D-8.

**Files:** Create `H:\cg-coord\m12\protocol.md`, `H:\cg-coord\m12\deviations.md`, `H:\cg-coord\decisions\<date>-m12-protocol.md`.

- [ ] **Step 1:** Write `protocol.md` with these fixed sections, copied from this plan and made exact: (1) identity: experiment, experiment_hash `1d6b5f6e...`, stage-B sha `e04fe834...`, both decision files, freeze commit `2fb244fe`, task count 43; (2) the launch and resume commands of M12-10 with every value filled; (3) the retry policy (below); (4) the stop rules (below); (5) the deviation table of this plan; (6) blinding rules; (7) analysis settings.
- [ ] **Step 2: Retry policy (D-1).** Automatic retries are the code's and nothing else: one retry for `setup_failed` and for `harness_crash` without work, a retry after the reset for `usage_limited`, none for `completed`, `timeout`, `budget_exhausted`, `refusal`. Manual reruns happen only at close (M12-12), only for cells the report shows as unscored for an infrastructure reason, for every such cell regardless of arm, once per cell (the code allows no second one), from one list the owner approves. Never a rerun of a scored cell. Never a rerun chosen by arm, task or outcome.
- [ ] **Step 3: Stop rules (D-1).** The campaign pauses (stop file, then a `coord ask`) when: (a) hostwatch or the campaign watcher writes a stop; (b) every pool container is quarantined; (c) one container is quarantined, until D-5's procedure is done; (d) `setup_failed` reaches 5 in a row or 20 in total; (e) a refusal of any kind from `harness run`; (f) unknown-cost terminal cells on selected tasks reach 15 in total (D-7, decisions/2026-11-17-m12-missing-data.md: pairs drop per contrast and the family is withheld above 21 of 312 per contrast; 15 cells is the early warning, counted over all arms so blinding holds; owner review, not an abort); (g) list-price spend passes USD 4,000 (owner review, not an abort); (h) elapsed time passes 14 days; (i) the Work account, or any label outside D-3, appears in an execution record; (j) free disk on the results or docker drive falls under 50 GB. The campaign is never stopped or shortened because of outcomes.
- [ ] **Step 4: D-2, D-3, D-4, D-8.** Ask the owner with AskUserQuestion and record the answers in the decision file with an `OWNER-APPROVED: <words> (<ISO time>)` line each:
  - D-2: the sandbox egress mode. Run `deno task start harness egress verify` (read-only) and quote it. If it is not authorized, the confirmatory run needs `--unverified-egress-ok "<reason>"` (owner only; it also records `calibration_waived`). The BC side needs `--unverified-bc-egress-ok "<reason>"` because `golden-o09-v2` has no enforced NST egress (inner_only, owner 2026-11-04). The egress grants so far end 2026-11-17T23:59Z and exclude confirmatory runs, so the reasons must cite a new decision.
  - D-3: pool labels and secret directories (screening used `max` and `maxpriv2`, earlier also `maxpriv`), whether `MAXWork` joins, and which one reserve label lane-ops may add on a resume with `--add-accounts-reason "<reason>" --added-by lane-ops`.
  - D-4: default `--containers Cronus281,Cronus282 --concurrency 2`, Cronus283 stopped as a cold spare (about 155 running hours). Alternative: three containers (H-110's 103 hours). That needs `--concurrency 3`, which the code refuses today in a placed or enforced egress environment (cap 2, owner decision 2026-10-03), so it needs a new owner decision and a code change before launch, or a third container used for judging only (`--judge-containers`), whose gain is unmeasured.
  - D-8: exploratory comparisons use `--resamples 10000 --seed 20261021` (the same as the confirmatory block) or the CLI defaults 2000 and 1. Recommended: the same as the confirmatory block, so one setting is disclosed.
- [ ] **Step 5:** Create `deviations.md` with the header row of "What counts as a deviation" and no rows. Carry over as row 0 the pre-campaign items already approved (the three stage-B amendments and the protocol change), marked "pre-registered, not a deviation".

**Acceptance (orchestrator):** the decision file has one `OWNER-APPROVED` line per decision; `protocol.md` contains no placeholder (`grep -n "<" protocol.md` shows only quoted flag syntax); `deviations.md` exists.

---

### Task M12-02: Smoke experiment that is not confirmatory

**Lane:** infra. **Deps:** none. **Window:** 11-18 to 11-19.

**Files:** Create `harness/experiments/cc-v2-smoke.yml`. Modify `tests/unit/harness/v2-configs.test.ts`.

The smoke uses the four campaign arm configs unchanged, two tasks that are in neither the selected nor the held-out list, 2 repeats (16 cells), and no `preregistration`, `contrasts` or `interaction` key. Task rule, fixed before looking at anything else: the two lowest ids in `harness-tasks/v2/selection.json` `candidates` whose `status` is `saturated`.

- [ ] **Step 1: Failing test** appended to `tests/unit/harness/v2-configs.test.ts` (follow the file's existing imports and root helper):

```typescript
Deno.test("cc-v2-smoke: the four campaign arms, no frozen task, never pre-registered", async () => {
  const smoke = (await loadExperiment("harness", "cc-v2-smoke")).experiment;
  const real = (await loadExperiment("harness", "cc-v2-factorial")).experiment;
  assertEquals(
    [smoke.baseline, ...smoke.variants],
    [real.baseline, ...real.variants],
  );
  assertEquals(
    [smoke.preregistration, smoke.contrasts, smoke.interaction],
    [undefined, undefined, undefined],
  );
  const sel = JSON.parse(
    await Deno.readTextFile("harness-tasks/v2/selection.json"),
  );
  const frozen: string[] = [...sel.selection.selected, ...sel.held_out];
  const ids = [...smoke.tasks.matchAll(/HX-\d+/g)].map((m) => m[0]);
  assertEquals(ids.length, 2);
  assertEquals(ids.filter((id) => frozen.includes(id)), []);
  assertEquals(smoke.repeats, 2);
});
```

Run `deno test --allow-all tests/unit/harness/v2-configs.test.ts`. Expected: FAIL (experiment file missing). If `loadExperiment` returns another shape than `{ experiment }`, adapt the two access lines to what `src/harness/config.ts:277` returns, nothing else.
- [ ] **Step 2:** Write `harness/experiments/cc-v2-smoke.yml`: `id: cc-v2-smoke`, a hypothesis line that says "operational smoke, not confirmatory, never reported with outcomes", `primary_metric: cost_per_solved_task`, the same `baseline`, `variants` and `vary` as `cc-v2-factorial.yml`, `tasks: "harness-tasks/tasks/{<id1>,<id2>}"`, `repeats: 2`.
- [ ] **Step 3:** Test passes. `deno task start harness validate` prints `[OK]`. Prove the confirmatory experiment did not move: `deno task start harness run cc-v2-factorial --dry-run --secrets-dir <any dir> --prereg-decision 'H:\cg-coord\decisions\2026-10-17-harness-v2-prereg-a.md' --prereg-b-decision 'H:\cg-coord\decisions\2026-11-17-harness-v2-prereg-b.md'` raises no pre-registration refusal (other refusals of a dry run without containers are fine; quote the output).
- [ ] **Step 4:** `deno check`, `deno lint`, `deno fmt` on the test file. Commit `feat(harness): cc-v2-smoke, a non-confirmatory four-arm smoke experiment (M12-02)`.

**Acceptance (orchestrator):** test green; `git diff 41567634 -- harness/experiments/cc-v2-factorial.yml harness/preregistration harness-tasks` is empty; both tags `harness-v2-prereg-a` and `harness-v2-prereg-b` still resolve to the objects in the decision files.

---

### Task M12-03: Pin the missing-data behaviour before the first cell

**Lane:** infra2. **Deps:** none. **Window:** 11-18 to 11-20. **Owner decision:** D-7.

**Files:** Modify `tests/unit/harness/report.test.ts` (only if a test below is missing). Create `H:\cg-coord\m12\missing-data.md`.

The pre-registration says `missing_pairs: per_contrast_matched`. The report is stricter: one terminal cell of a selected task without cost data withholds every confirmatory decision (`report.ts:894-908`). For the cost metric an unscored terminal cell is eligible and counts as unsolved with its spend (`stats.ts:118-125`); only `spend_usd === null` is "no data". A scored cell cannot be rerun, so one unreconciled cell could withhold the whole family for good.

- [ ] **Step 1:** `grep -n "withheld" tests/unit/harness/report*.test.ts`. List which of these four cases already have a test: (a) one pending cell; (b) `--repeats` below planned; (c) one unknown-spend terminal cell on a selected task; (d) one unknown-spend terminal cell on a held-out task (must NOT withhold).
- [ ] **Step 2:** For each missing case write the failing test first with the file's existing record builders, asserting the exact `withheld` text (`"1 cells without cost data"` for (c)) or, for (d), that `confirmatory` has `results`. Run, see it fail or pass, and report which. A test that passes at once is kept as a pin. No change to `src/` in this task.
- [ ] **Step 3:** Write `missing-data.md`: the behaviour per case, how often screening produced a cell with unknown cost (a count from `usage_reconciliation` statuses in the stored screening executions, pooled, no arm split), and the routes back to data: `harness rederive <campaign> --execution <ids> --reason "<text>"` when the parser refused a log, nothing else.
- [ ] **Step 4 (orchestrator, D-7):** Ask the owner to choose now, before any outcome: (A, recommended) keep the fail-closed gate; if an unknown-cost cell on a selected task survives the close, the contrasts are reported as withheld, the same analysis is shown as exploratory in the write-up with the cell count, and the deviation is logged; (B) implement per-contrast matched dropping for unknown-cost cells before the campaign (a new TDD task on lane-infra2, a Sol review, and a note that the M11-13 simulation assumed the full design). Record the answer in `decisions\<date>-m12-missing-data.md`.

**Acceptance (orchestrator):** four cases pinned by named tests; decision file with the owner's line; if B was chosen, its task is accepted before M12-10.

---

### Task M12-04: Charts and CSVs for the pre-registered contrasts

**Lane:** infra. **Deps:** none. **Window:** 11-18 to 11-20.

**Files:** Modify `scripts/harness/report-charts.ts`, `tests/unit/harness/report-charts.test.ts`. Create `tests/fixtures/harness/report-v2-factorial.json`.

`renderCharts(reports, ledger?)` (`report-charts.ts:685`) writes `arms.csv`, `comparisons.csv`, `provenance.csv`, `ledger.csv` and three SVGs per report. It knows nothing of `confirmatory`, `held_out` or `exploratory`, and `Ledger` requires `openrouter_reference` and `pi_stop`.

**Interfaces added (nothing existing changes its output for a report without `confirmatory`):**
- `contrasts.csv`: `experiment,campaign,id,name,confirmatory,baseline,variant,pairs,tasks,delta,ratio,ci_lo,ci_hi,level,bonferroni_lo,bonferroni_hi,undefined_share,p,p_holm,alpha,decision,verdict_text,method,ci_ratio_lo,ci_ratio_hi,bonferroni_ratio_lo,bonferroni_ratio_hi,theta` (the last six added by M12-04b). One row per entry of `confirmatory.results` (C1, C2, C3 and the interaction). `verdict_text`: `variant lower`, `variant higher` or `no decision`, with ` (CI suppressed)` appended when the percentile CI is null (M12-04b: the decision is never replaced). When the report has `confirmatory.withheld`, one row with `id` `withheld` and the reason in `verdict_text`. Null prints `n/a`.
- `held_out.csv`: one row per arm from `confirmatory.held_out.arms` with the `arms.csv` columns, plus `tasks` (the four ids joined by a space). Every row is labelled `descriptive`.
- `exploratory.csv`: one row per arm and metric from `exploratory.arms`, and one per delta from `exploratory.deltas`, with a `missing` count column. Label column `exploratory` on every row.
- `<prefix>-contrasts.svg`: C1 to C3 as ratio with the unadjusted interval, the Holm decision as text, the interaction below a rule, labelled exploratory. The caption states the task count, 10,000 resamples and the seed from `confirmatory.bootstrap`.
- `Ledger`: `openrouter_reference`, `openrouter_balance_readings`, `openrouter_actual_usd` and `pi_stop` become optional as one group. A v1 ledger still parses and renders byte-identically. A v2 ledger has `paid_total_usd: 0`, `claude_code_cash_usd: 0`, `experiments`, `manual_reruns`, `rejudges`.

- [ ] **Step 1: Fixture.** Build `report-v2-factorial.json` by hand as a minimal `HarnessReport`: copy `tests/fixtures/harness/report-mock-contract.json`, rename the arms to the four v2 arm ids, and add a `confirmatory` block with three results (one `variant_lower`, one `no_decision`, one with `ci: null` and `undefined_share: 0.01`), an exploratory interaction row, `held_out` with four ids and four arm summaries, and an `exploratory` block with two metrics. Invented numbers only. Never copy a number from a stored campaign.
- [ ] **Step 2: Failing tests** in `report-charts.test.ts`: (1) `contrasts.csv` has the header above and four rows with the exact decisions and `CI suppressed` for the suppressed one; (2) a report with `confirmatory: { withheld: "3 pending and 0 unrun cells" }` gives one `withheld` row and no contrasts SVG; (3) `held_out.csv` has four rows, each `descriptive`; (4) `exploratory.csv` rows all carry `exploratory` and a missing value prints `n/a`, never `0`; (5) the existing mock-contract fixture renders exactly the files it rendered before (no `contrasts.csv`); (6) a ledger without the four v1 keys parses, and a v1 ledger renders the same `ledger.csv` as before. Run `deno test --allow-all tests/unit/harness/report-charts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three CSV writers and the SVG beside the existing ones, reusing the file's `csv` and `esc` helpers and `verdictText` pattern. No new dependency.
- [ ] **Step 4:** Tests pass; `deno check`, `deno lint`, `deno fmt` on the two `.ts` files; commit `feat(harness): contrast, held-out and exploratory outputs in report-charts (M12-04)`.

**Acceptance (orchestrator):** tests green; `deno run --allow-read --allow-write scripts/harness/report-charts.ts --out <scratch> --report tests/fixtures/harness/report-v2-factorial.json` exits 0 and writes the four new files; the v1 rehearsal reports under `H:\cg-coord\m6\reports\` still render to the same bytes as `H:\cg-coord\m6\charts\` (diff quoted).

---

### Task M12-05: Low-churn campaign watcher

**Lane:** ops. **Deps:** none. **Window:** 11-18 to 11-20.

**Files:** Create `scripts/harness/ops/h-107/watch-campaign.ps1`, `scripts/harness/ops/h-107/watch-campaign-test.ps1`.

`scripts/harness/ops/watch.sh` is a bash loop that forks every 60 s. Over a 7 to 15 day campaign that feeds the kernel token leak (H-107). `harness run` reads its stop files itself, so no bridge is needed, only the watcher's own stop.

- [ ] **Step 1: Failing dry test** `watch-campaign-test.ps1`, modelled on `hostwatch-dry-test.ps1` and `watchers-test.ps1`, with dummy targets in a scratch dir and injected readings. Cases, each named as in the `watch.sh` section of `hostwatch-dry-test.sh` (the nine `w-*` checks): fresh heartbeat and registry listing: no stop; free RAM under 4 GB: `<P>.watch` written; no good RAM reading for 90 s: written; heartbeat older than 180 s or missing: written; target missing from the registry: written; every pool container quarantined: written; one of two quarantined: not written, an `ALERT` line logged; a second instance refuses (exit 3); the watcher exits on the run log's `EXIT ` line, on its own stop file `<prefix dir>\watch.STOP` (outside the `<P>.*` namespace, so `stops.sh` active_stops never counts it; orchestrator, M12-05 run 001 review), and at `-MaxHours`. Run it: FAIL (script missing).
- [ ] **Step 2: Implement** as one pwsh process with no child per poll: parameters `-Prefix <stop prefix> -RunLog <path> -Pool <names> -Results <root> [-EverySeconds 60] [-MaxHours 400] [-Heartbeat <path>] [-Registry <path>] [-QuarantineDir <path>] [-NoRegister]`. It writes only `<Prefix>.watch` (the `watch` name of `stops.sh`), logs total list-price cost every 20 executions as one number (never per arm), registers with `Register-Daemon` and unregisters on exit.
- [ ] **Step 2b: Host-busy detection (log only, never a stop).** The memory log (`H:\cg-coord\jobs\W2-10\memlog`, 15 s samples with the top processes) already shows a heavy interactive app. Add to the dry test first: a memlog sample whose top-process list holds a process outside the allow-list (`-QuietAllow`, default: docker, vmmem, the BC and SQL service processes, deno, pwsh, claude, node) above `-BusyMb` working set or `-BusyCpu` percent for three samples in a row gives one `HOST-BUSY start <process> <UTC>` line, and three quiet samples give `HOST-BUSY end <UTC>`; a missing or stale memlog gives `HOST-BUSY unknown`, never silence. Then implement it by reading the newest memlog file in-process. The exact column names come from a real memlog file; read one before writing the parser. lane-ops turns each start and end pair into a deviation row.
- [ ] **Step 3:** Dry test passes; `pwsh -NoProfile -File scripts/harness/ops/h-107/watch-campaign-test.ps1` output quoted. Commit `feat(harness-ops): low-churn campaign watcher (M12-05)`.

**Acceptance (orchestrator):** dry test output with zero failures; the script has no `bash`, `Start-Process` or child `pwsh` call in its loop (`grep` quoted); a 10-minute run against a dummy target adds one row to `daemons.tsv` and removes it on exit.

---

### Task M12-06: Preflight

**Lane:** ops. **Deps:** M12-01 (D-2 to D-4). **Window:** 11-19 to 11-21. Repeat Steps 2 to 9 on launch day (M12-10 Step 1).

**Files:** Create `H:\cg-coord\m12\preflight.md` (one section per step, output quoted).

- [ ] **Step 1: Run checkout.** `git worktree add H:\cg-coord\jobs\M12-run <campaign commit>` (the commit the orchestrator names: master with M12-02 merged). Clean tree. `git diff 2fb244fe HEAD -- harness-tasks/refapp` and the same for the 43 task folders is empty. `git rev-parse harness-v2-prereg-a harness-v2-prereg-b` equals the `tag_object` lines of the two decision files.
- [ ] **Step 2: Image.** `DOCKER_CONTEXT=desktop-windows docker image inspect centralgauge/harness-claude-code:2.1.282-r3 --format '{{.Id}} {{index .Config.Labels "centralgauge.harness.revision"}} {{index .Config.Labels "centralgauge.lsp.al"}}'`. The revision label is `3`, the LSP label is present, and the id equals the id recorded at M9-17 (`results\harness\image-builds`). The four arm configs say `image_revision: "3"` and `harness_version: "latest"`: the dry run in M12-08 must show all four arms resolving to this image id.
- [ ] **Step 3: Model.** `deno task start models anthropic/claude-sonnet-5 --check` green (the id in all four configs).
- [ ] **Step 4: Lineage and baselines.** No bench live (`find results/.bench-running.json -mmin -2` prints nothing). For the D-4 containers plus the spare: `deno task start harness env check --lineage 'infra\harness-reset\lineages\golden-o09-v2.json' --containers <names> --results-dir 'H:\cg-coord\results\harness' --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols' --unverified-bc-egress-ok "<D-2 reason>"`. Expected: one admissible `env_fp` (`2552e6986e78` at M8-21). No quarantine record for them in `H:\cg-coord\harness-quarantine`.
- [ ] **Step 5: Compiler identity.** Repeat M11-17b Step 2 on each of those containers: the backend `Microsoft.Dynamics.Nav.CodeAnalysis.dll` sha256 equals `lineage.backend.sha256` in `harness/images/claude-code/lsp/al-lsp.json`, and the compiler identity string equals the pre-registered `compiler_identity` (`...sandbox/28.4.53241.53758/dk|bccontainerhelper 6.1.14`). Cronus282 was recreated on 2026-11-17, so it is checked again whatever the stage-B note says. A mismatch: stop, `coord ask`.
- [ ] **Step 6: Accounts.** Every D-3 secrets directory exists and no file in it starts with `REPLACE_ME` (never print a value). The label list contains no `work`. `H:\cg-coord\ledgers\credential-runs.jsonl` is writable and has no open reservation of another lane. Ask the owner for the current usage headroom of each label (the lane does not read it).
- [ ] **Step 7: Leases and holders.** `coord holder Cronus281`, `Cronus282`, `Cronus283` free; `coord doctor` clean; `H:\cg-coord\allocation.json` lists them for this project; `H:\cg-coord\bch-roots.json` lists every one that has its own BCH root.
- [ ] **Step 8: RAM and disk.** Free RAM with every pool container up and nothing else of ours running: at least 18 GB per extra container at start, and at least 14 GB free after the last start (spec gate 5 resume bar). Host is 93.7 GB; the budget is two BC containers plus two 3 GB sandboxes plus judging. Free disk: at least 200 GB on `H:`, and at least 100 GB on the drive Docker keeps Windows images and sandboxes on (record which drive that is).
- [ ] **Step 9: Watchers.** The registered hostwatch (`daemons.tsv`) is alive and its heartbeat is younger than 180 s. `daemons.tsv` holds no dead pid. The kernel pool reading (`scripts/harness/ops/h-107/pooltags2.ps1`) is recorded as the start value. `scripts/harness/ops/h-107/hostwatch-dry-test.ps1 -SkipChurn` passes.
- [ ] **Step 10: Egress.** `deno task start harness egress verify` output quoted and consistent with D-2.

**Acceptance (orchestrator):** every step has quoted output and `[OK]`; any `[FAIL]` is a `coord ask`, never worked around.

---

### Task M12-07: Windows Update mitigation and the host-quiet rule

**Lane:** ops proposes, orchestrator asks, owner decides. **Deps:** H-110 (done: the slowdown is host load, owner confirmed) and the H-111 report (if it is not accepted by 11-20, this task uses what it has and says so). **Window:** 11-19 to 11-21. **Owner decisions:** D-5, D-6.

**Files:** Create `H:\cg-coord\m12\risks.md`.

- [ ] **Step 1: Windows Update (risk 1).** State the exposure in numbers from the M8-21 record only: one quarantine in about three days of two-container qualification. Over a 7 to 15 day campaign on two containers, expect two to five. List the options from H-111 with their cost: (A) stop the trigger inside the containers and re-baseline (changes the container state; needs the lineage and `env_fp` to stay admissible, and a decision that this is not a judging-environment change); (B) accept the exposure and pre-approve the recreate. For B write the exact runbook, taken from `H:\cg-coord\tasks\M8-21\ops\quarantine-282-20261117.md` and the `2026-11-17-cronus282-recreate.md` decision: planned stop, wait for exit, recreate under the ops lease with the container's own BCH root, `harness recover <container> --lineage <path> --recreated <evidence dir>`, `harness baseline create`, M12-06 Steps 4 and 5 again, deviation row, then the owner resumes. State how the pool behaves meanwhile: with two containers the run stops; with the cold spare, see M12-09 Step 5 for whether a resume accepts a changed `--containers` list.
- [ ] **Step 2: Host load (risk 2).** H-110 result: the M8-21 slowdown came from an interactive desktop app (a game) on the host. Every container reset was about 17 percent slower, on both containers in step, and it recovered by itself with no restart. So no container restart is planned and none is a mitigation. Quiet-host baselines: about 62 s per golden-restore reset and about 37 s candidate publish per reset. What already limits the effect: arm order is randomised inside every block, so a busy window hits all four arms of a block alike; cost per solved task does not read wall time; the cell timeout is 60 min. The residual risk is a slow reset or build pushing a cell into `timeout`. Proposal for D-6: the host-quiet rule of the Global Constraints; a detected window is logged as a deviation and the campaign continues. Alternative the owner may pick: a detected window writes the planned stop and the campaign resumes when the host is quiet.
- [ ] **Step 3:** The timing log: lane-ops records per day the median and p90 `telemetry.wall_ms` over all executions of that day (pooled, no arm split), the median reset and candidate-publish times from the host logs against the 62 s and 37 s baselines, and every `HOST-BUSY` window of the watcher (M12-05 Step 2b) in the daily note (M12-11). A day whose median reset is more than 10 percent over the baseline with no logged window is reported to the orchestrator. It all goes into the caveats register.
- [ ] **Step 4 (orchestrator):** Ask D-5 and D-6; write `decisions\<date>-m12-risks.md`; copy the chosen procedures into `protocol.md`.

**Acceptance (orchestrator):** decision file with both owner lines; `protocol.md` updated; the recreate runbook names every command.

---

### Task M12-08: Launch kit and dry run

**Lane:** ops. **Deps:** M12-01, M12-02, M12-05, M12-06. **Window:** 11-20 to 11-21.

**Files:** Create `H:\cg-coord\tasks\M12-08\run.sh` (a copy of `H:\cg-coord\tasks\M8-18b\run.sh`, changed as below), `dry-cc-v2-factorial.log`, `dry-cc-v2-smoke.log`.

- [ ] **Step 1:** `run.sh <experiment: cc-v2-smoke|cc-v2-factorial> <mode: dry|full|resume> [campaign id]`. Changes against the M8-18b script: checkout `H:\cg-coord\jobs\M12-run` at the campaign commit, clean; results root `H:\cg-coord\results\harness`; `--private-dir 'H:\cg-coord\m12\private-<experiment>'`; stop prefix `H:\cg-coord\tasks\M12-08\STOP-<experiment>` through `stop_args` (five `--stop-file` arguments; the count check stays); the D-3 `--secrets-dir label=dir` list; the D-2 reasons; `--lineage 'infra\harness-reset\lineages\golden-o09-v2.json'`; `--symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols'`; `--credential-ledger 'H:\cg-coord\ledgers\credential-runs.jsonl'`; `--concurrency 2`; `--max-pause-min 120`; for `cc-v2-factorial` the two `--prereg-decision` flags; mode `resume` requires the campaign id and adds `--campaign <id>`; mode `full` on `cc-v2-factorial` refuses when `H:\cg-coord\results\harness\campaigns\` already holds a record of that experiment. The script prints `START`, the HEAD and `EXIT <rc>` lines like the M8-21 scripts.
- [ ] **Step 2: Dry run of the smoke:** `bash run.sh cc-v2-smoke dry > dry-cc-v2-smoke.log`. No refusal; 16 cells in 4 blocks.
- [ ] **Step 3: Dry run of the campaign:** `bash run.sh cc-v2-factorial dry > dry-cc-v2-factorial.log`. `--dry-run` takes no lock, touches no container and writes nothing. Expected: no pre-registration refusal, 344 blocks, 1,376 cells, four arms on the r3 image, 43 tasks. Check afterwards that no campaign record of `cc-v2-factorial` exists (`grep -l '"cc-v2-factorial"' campaigns/*.json` prints nothing).
- [ ] **Step 4:** Register the stop prefixes in the hostwatch registry (`targets.tsv`) with the priority the orchestrator gives (the confirmatory campaign is the highest: stopped last).

**Acceptance (orchestrator):** both dry logs without a refusal; the cell counts; no record written; `run.sh` diff against the M8-18b script reviewed line by line.

---

### Task M12-09: Smoke campaign (not confirmatory)

**Lane:** ops prepares and verifies, **the owner launches (D-9)**. **Deps:** M12-08, M12-07. **Window:** 11-20 to 11-21. About 16 cells, 2 to 4 hours, USD 15 to 40 list price.

**Files:** Create `H:\cg-coord\m12\smoke.md`.

- [ ] **Step 1:** Lease the D-4 containers (`coord lease <container> ops`, heartbeat every 5 min), start `watch-campaign.ps1` headless as its header says, and hand the owner one line: `cd /h/cg-coord/tasks/M12-08 && bash run.sh cc-v2-smoke full`.
- [ ] **Step 2 (owner):** run it.
- [ ] **Step 3: Resume drill (risk 3).** After the fourth finished cell, lane-ops writes the planned stop (`<prefix>.planned`). The run exits non-zero at the next cell boundary. Quote the exit line. On the orchestrator's go rename the stop to `<prefix>.cleared-<UTC stamp>`; `stops_clear` must print `CLEAR`. The owner runs `bash run.sh cc-v2-smoke resume <campaign id>`. Expected: no finished cell runs again, the execution count grows only by the remaining cells, the same campaign id.
- [ ] **Step 4: Rerun dry check.** `deno task start harness run cc-v2-smoke --campaign <id> --rerun <task:repeat:arm of one scored cell> --dry-run ...` is refused or skipped with the cell's status (a scored cell is never rerun). Quote it.
- [ ] **Step 5: Container swap check.** `bash run.sh cc-v2-smoke resume <id>` in dry mode with the spare in place of one pool container (edit `POOL` only). Record whether the resume accepts a changed container list. This decides whether the cold spare can replace a quarantined container without a new decision.
- [ ] **Step 6: Evidence in `smoke.md`, counts and timings only:** cells planned, finished, judged; terminations by kind; executions by `run_kind`; `jq '.accounts'` of the campaign record (no `work`); per account label the number of executions; all four arms have 4 finished cells; every execution's `usage_reconciliation.status` count; median wall time; total list-price cost as one number; the inventory line `cg_inventory ok` count per arm equals the arm's cells; the watcher wrote no stop of its own; `daemons.tsv` is clean after exit. No pass or fail figure, no per-arm cost.
- [ ] **Step 7:** `harness measure cc-v2-smoke --campaign <id> --yes` with the same environment flags on the pool containers. Expected: every judged cell measured, and the recorded analyzer `compiler` equals the pre-registered `compiler_identity` (`jq` over the `measures` side files; quote the distinct values).
- [ ] **Step 7b: Concurrency measurement (owner, 2026-11-17; only if H-113's change is accepted and D-4 allows more than 2).** Run the smoke (or a second smoke campaign) at the highest concurrency D-4 allows (target 4), on that many v3-baselined containers. Record from memlog/hostwatch: minimum free RAM and when, peak commit, per-cell wall time and per-reset time against the 2-container smoke, any hostwatch stop or pause, any account pause, and the proxy-isolation evidence H-113 names. Counts and timings only. The result sets the confirmatory `--concurrency` at D-10.
- [ ] **Step 8:** Release the leases; stop the watcher by its stop file.

**Acceptance (orchestrator, then D-9):** 16 of 16 cells terminal and judged or policy-unscored; the resume drill added no duplicate; no Work label; Step 5 answered; one compiler identity. A failed smoke is fixed and repeated under a new experiment id suffix (`cc-v2-smoke-2`), never by reusing the record.

---

### Task M12-10: Go decision and launch of the confirmatory campaign

**Lane:** orchestrator prepares, **the owner decides and launches (D-10)**. **Deps:** M12-01 to M12-09 accepted, M12-03's decision. **Window:** 11-22.

**Files:** Create `H:\cg-coord\decisions\<date>-m12-go.md`, `H:\cg-coord\m12\launch.md`.

- [ ] **Step 1 (ops):** Repeat M12-06 Steps 2 to 9 on the day. Start the pool containers under grant 3 if they are stopped. Lease them. Start `watch-campaign.ps1` for the confirmatory prefix. `stops_clear` on the prefix prints `CLEAR`.
- [ ] **Step 2 (orchestrator):** Checklist in the go decision, each with its evidence path: stage B approved; M8-21 accepted; smoke accepted; D-1 to D-9 recorded; preflight green today; no other campaign or gate pool registered at a higher priority; `deviations.md` has only row 0.
- [ ] **Step 3 (owner, D-10):** Answer go or no-go. On go, run in the owner's terminal:

```bash
cd /h/cg-coord/tasks/M12-08 && bash run.sh cc-v2-factorial full
```

which expands to (values from D-2 to D-4; tokens from the lease files):

```bash
cd /h/cg-coord/jobs/M12-run
CG_LANE=ops deno task start harness run cc-v2-factorial \
  --prereg-decision 'H:\cg-coord\decisions\2026-10-17-harness-v2-prereg-a.md' \
  --prereg-b-decision 'H:\cg-coord\decisions\2026-11-17-harness-v2-prereg-b.md' \
  --results-dir 'H:\cg-coord\results\harness' \
  --private-dir 'H:\cg-coord\m12\private-cc-v2-factorial' \
  --containers Cronus281,Cronus282 \
  --coord-lease "Cronus281=<token>" --coord-lease "Cronus282=<token>" \
  --backend-port 3250 \
  --secrets-dir 'max=H:\Temp3\harness-spike\secrets' \
  --secrets-dir 'maxpriv2=H:\Temp3\harness-spike\secrets-MaxPriv2' \
  --lineage 'infra\harness-reset\lineages\golden-o09-v2.json' \
  --unverified-bc-egress-ok '<D-2 BC reason>' \
  --unverified-egress-ok '<D-2 sandbox reason, only if D-2 says so>' \
  --symbol-store 'H:\cg-coord\jobs\M8-16a\results\harness\symbols' \
  --credential-ledger 'H:\cg-coord\ledgers\credential-runs.jsonl' \
  --concurrency 2 --max-pause-min 120 \
  --stop-file 'H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial' \
  --stop-file 'H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial.watch' \
  --stop-file 'H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial.host-low' \
  --stop-file 'H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial.host-all' \
  --stop-file 'H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial.planned'
```

No `--seed` (the block order seed is drawn and stored in the record), no `--sample`, no `--repeats`, no `--rev`.
- [ ] **Step 4 (ops, within 10 minutes of the first cell):** Write `launch.md`: campaign id; `created_at`; `seed`; `jq '.preregistration'` (its three hashes equal the stage-B sha `e04fe834...` and the sha256 of the two decision files); `jq '.accounts'`; `jq '.blocks | length'` = 344; `jq '.task_set.tasks | length'` = 43; `egress_override`, `bc_egress_override`, `calibration_waived` as D-2 expects; HEAD of `M12-run`; image id. The first execution of every arm has `cg_inventory ok`. Any mismatch: planned stop, `coord ask`.

**Acceptance (orchestrator):** go decision with the owner's line; `launch.md` complete; exactly one `cc-v2-factorial` campaign record exists.

---

### Task M12-11: Monitoring, resume and stop rules

**Lane:** ops. **Deps:** M12-10. **Window:** the whole campaign (planned 7 to 10 days, review at 14). **Owner decisions:** D-11.

**Files:** Create `H:\cg-coord\m12\daily\<UTC date>.md` per day. Append to `H:\cg-coord\m12\deviations.md`.

- [ ] **Step 1: Leases.** Heartbeat every 5 minutes from one pwsh process that sleeps (`scripts/harness/ops/h-107/heartbeat.ps1`), registered in `daemons.tsv`, with a stop file and a max lifetime.
- [ ] **Step 2: Blinded progress, at most every 30 minutes:**

```bash
deno task start harness progress cc-v2-factorial --campaign <id> --results-dir 'H:\cg-coord\results\harness' --json \
  | jq '{planned_cells, finished_cells, judged_cells, unscored_cells, unscored_policy_cells, awaiting_judgment_cells, unknown_cells, executions, terminations, eta, unreadable, finished_by_arm: (.arms | map_values(.finished)), cost_missing: ([.arms[].cost_missing] | add), cost_total: ([.arms[].cost_usd] | add)}'
```

  Never print the unprojected JSON, `pass_cells`, `fail_cells` or a per-arm cost. `harness report` is not run on this campaign before M12-12 is accepted.
- [ ] **Step 3: Daily note:** the Step 2 projection; executions and retries of the day; terminations by kind; pauses with cause and length; pooled median and p90 `wall_ms` of the day, median reset and publish times against the 62 s and 37 s baselines, and every `HOST-BUSY` window with its deviation row (timing log, M12-07 Step 3); free RAM low-water mark; free disk; kernel pool reading; `daemons.tsv` row count; quarantine records; usage-limit pauses per account label; stop rules checked one by one. Send the path to the orchestrator.
- [ ] **Step 4: A stop fired.** Record which stop file and why. Wait for the run's `EXIT` line; never kill. Then by cause:
  - usage limit with `--max-pause-min 120` exceeded: the run exits with a resume line. Operational. Resume after the reset.
  - planned pause (a host-busy window, if D-6 says a window pauses): wait until the watcher logs `HOST-BUSY end`, clear the stop by renaming it to `.cleared-<UTC stamp>` on the orchestrator's go, resume. No container restart.
  - hostwatch or watcher stop: find what took the memory; resume only when free RAM is at least 14 GB.
  - quarantine: D-5's procedure. Recreate only with the owner's approval. Deviation row, class Environment.
  - a `harness run` refusal or any stop rule (d) to (j): `coord ask`; nothing resumes until the owner answers.
- [ ] **Step 5: Resume (risk 3).** The owner runs `cd /h/cg-coord/tasks/M12-08 && bash run.sh cc-v2-factorial resume <campaign id>`; for a usage-limit or planned pause lane-ops may run it if D-1 says so. Always with the campaign id. Before it: `stops_clear` prints `CLEAR`, leases held, watcher alive, preflight Steps 4, 7, 8 again. After it: the execution count did not jump, the campaign id is the same, no second record of the experiment exists.
- [ ] **Step 6: Accounts.** A label is added only as D-3 pre-authorised, on a resume, with `--add-accounts-reason "<reason>" --added-by lane-ops`. Anything else is the owner's. `--ignore-usage-reset` is never used (it is refused on a pool anyway).
- [ ] **Step 7: Never during the campaign:** a merge into `M12-run`; the full `test:unit`; a gate or qualify job on a pool container; `harness rejudge`; `harness report`; a container start, stop or restart outside D-5; a heavy interactive app on the host without a deviation row.

**Acceptance (orchestrator):** a daily note for every campaign day; every pause and resume has a deviation or operational row; the campaign reaches Step 1 of M12-12.

---

### Task M12-12: Close the campaign

**Lane:** ops, orchestrator. **Deps:** M12-11. **Window:** +1 day. **Owner decision:** D-12.

**Files:** Create `H:\cg-coord\m12\close.md`, `H:\cg-coord\m12\reruns.txt`.

- [ ] **Step 1: Run to the end.** The last `harness run` exits 0 with nothing pending. The Step 2 projection shows `finished_cells` 1,376, `awaiting_judgment_cells` 0, `unknown_cells` 0.
- [ ] **Step 2: Unscored cells, blinded.** List every unscored cell with its termination chain and the infrastructure cause, as `task:repeat:arm` lines without any outcome of other cells. Classify each: (i) infrastructure (`setup_failed` twice, `harness_crash` without work twice, a judging environment failure); (ii) policy outcome that stays as it is. The orchestrator checks five at random against their host logs.
- [ ] **Step 3 (D-12):** The owner approves `reruns.txt` (every class (i) cell, all arms, one per line, `#` comments allowed). Then the owner runs `bash run.sh cc-v2-factorial resume <id>` with `--rerun-file 'H:\cg-coord\m12\reruns.txt'` appended (extra arguments pass through `run.sh`). A run with reruns runs only the named cells. A cell still unscored after its one manual rerun stays unscored and counts as unsolved with its spend. Each rerun is a deviation row, class Execution.
- [ ] **Step 4: Unknown cost.** Count terminal cells with no cost on selected tasks (the report would say `<n> cells without cost data`). For a log the parser refused: `deno task start harness rederive <campaign id> --execution <ids> --reason "<text>" --results-dir 'H:\cg-coord\results\harness'`, a deviation row. What remains follows D-7.
- [ ] **Step 5: Measures.** `deno task start harness measure cc-v2-factorial --campaign <id> --yes` with the campaign's environment flags, on the pool containers, under the leases. Expected: every judged cell measured; one analyzer compiler identity, equal to the pre-registered one.
- [ ] **Step 6:** Release the leases, stop the watchers by their stop files, stop the containers (grant 3). `close.md`: the final projection, rerun and rederive counts, the measure count, the D-7 state. The owner declares the campaign closed (D-12). From here on the blinding ends.

**Acceptance (orchestrator):** 1,376 terminal cells; zero pending and unrun; rerun list approved and executed once; measures complete; closure recorded in `decisions\<date>-m12-closed.md`.

---

### Task M12-13: Quiesce and snapshot

**Lane:** ops. **Deps:** M12-12. **Window:** same day. Mirrors M6-06.

- [ ] **Step 1: Quiesce.** The orchestrator writes the confirmatory stop prefix file itself (`STOP-cc-v2-factorial`) and leaves it in place, so no resume chain can start. Quote: no `harness` process running; `coord holder` free for Cronus281 to 283; no file under `H:\cg-coord\results\harness` written in the last 10 minutes.
- [ ] **Step 2: Pack and verify** (secret files: every file in every D-3 secrets directory and the generation files M5-00 lists that still exist; a listed file that is gone is written in the evidence):

```bash
cd /h/cg-coord/jobs/M12-run
deno run --allow-all scripts/harness/freeze-archive.ts pack 'H:\cg-coord\results\harness' 'H:\cg-coord\m12\archive' \
  --secret-file <each file> --meta git=<M12-run sha> --meta task_set=098ffb70afae \
  --meta freeze_commit=2fb244fe --meta image=<r3 image id> --meta campaign=<id> \
  --meta prereg_stage_b=e04fe8349652f176dc7d0d496d2a6b87e691cfc61e2e6c1715c0caa74e5f5d59
deno run --allow-all scripts/harness/freeze-archive.ts verify 'H:\cg-coord\m12\archive'
```

  Exit 1 or 2: stop, `coord ask`, no reports. The pack walks the whole shared root, so the snapshot also holds the screening and v1 campaigns; the write-up reads only the one campaign id.

**Acceptance (orchestrator):** both exit codes 0; `sums_sha256` quoted; the scan count equals the listed secret files.

---

### Task M12-14: Reports, analysis outputs and charts from the snapshot

**Lane:** ops. **Deps:** M12-13, M12-04. **Window:** +1 day. Mirrors M6-07.

**Files:** Create `H:\cg-coord\m12\reports\cc-v2-factorial.campaign.json` and `.txt`, `H:\cg-coord\m12\ledger.json`, `H:\cg-coord\m12\charts\`, `H:\cg-coord\analysis\cc-v2-factorial\`.

- [ ] **Step 1: The report, from the snapshot, in the `M12-run` checkout:**

```bash
deno task start harness report cc-v2-factorial --campaign <id> --judging campaign \
  --results-dir 'H:\cg-coord\m12\archive\results' --root . \
  --prereg-decision 'H:\cg-coord\decisions\2026-10-17-harness-v2-prereg-a.md' \
  --prereg-b-decision 'H:\cg-coord\decisions\2026-11-17-harness-v2-prereg-b.md' \
  --resamples <D-8> --seed <D-8> --json > 'H:\cg-coord\m12\reports\cc-v2-factorial.campaign.json'
```

  and the same without `--json` into `.txt`. Never `--repeats`, never `--judging current`. The report refuses a changed pre-registration or decision file; a refusal is a `coord ask`.
- [ ] **Step 2: Shape checks with `jq`, quoted:** `.confirmatory.withheld` is absent (or D-7's fallback applies and says so); `.confirmatory.family` is `["C1","C2","C3"]`; `.confirmatory.alpha` 0.05; `.confirmatory.bootstrap` is `{resamples: 10000, seed: 20261021, level: 0.95}`; `.confirmatory.zero_solve.rule` is `suppress_any_undefined`; `.confirmatory.tasks | length` 39; `.confirmatory.held_out.tasks` are the four held-out ids; four entries in `.confirmatory.results`, the interaction with `confirmatory: false`; every result's `distinguishable` is null; `.preregistration.amendments | length` 3; `.provisional` false; per arm `unscored_cells`, `pending_cells`, `unknown_spend_terminal_cells`, `manual_reruns`; `.exploratory.usage_reconciliation` per arm.
- [ ] **Step 3: Post-campaign analysis (runbook README):** `deno run --allow-all scripts/harness/analyze-campaign.ts <campaign id> --results 'H:\cg-coord\m12\archive\results' --rev 2fb244fe --out 'H:\cg-coord\analysis\cc-v2-factorial'`. Exploratory only, never a headline.
- [ ] **Step 4 (orchestrator):** Write `ledger.json` in the v2 form of M12-04: cash 0, the Claude Code list-price total labelled an estimate, every manual rerun and rederive with its decision path. Check it against `deviations.md` row by row.
- [ ] **Step 5: Charts:** `deno run --allow-read --allow-write scripts/harness/report-charts.ts --out 'H:\cg-coord\m12\charts' --ledger 'H:\cg-coord\m12\ledger.json' --report 'H:\cg-coord\m12\reports\cc-v2-factorial.campaign.json'`. A ledger mismatch stops the task.
- [ ] **Step 6: Bind, in this order:** `freeze-archive.ts bind 'H:\cg-coord\m12\archive' <both report files>`; then every SVG and CSV and `ledger.json`; then the pre-registration inputs (M11 plan, "M12 binds"): `harness/preregistration/cc-v2-factorial.yml`, `cc-v2-factorial.sim-c37.json`, `harness-tasks/v2/selection.json`, both decision files, `H:\Temp3\harness-spike\M8\freeze\task-set.json`, `protocol.md`, `deviations.md`. `verify` prints `[OK]`.

**Acceptance (orchestrator):** report, charts, the three new CSVs, `derived.json` listing every bound file, verify `[OK]`, Step 2 output quoted.

---

### Task M12-15: Analysis check and review

**Lane:** orchestrator. **Deps:** M12-14. **Window:** +1 to +2 days.

**Files:** Create `H:\cg-coord\m12\analysis-check.md`, `H:\cg-coord\reviews\M12-15\`.

- [ ] **Step 1: Holm by hand.** From `.confirmatory.results` take the three family p-values. Sort ascending; adjusted values are `max` over the running sequence of `p(1) x 3`, `p(2) x 2`, `p(3) x 1`, capped at 1. They must equal `p_holm`. A contrast is decided when `p_holm <= 0.05`; the direction is the sign of its delta (`variant_lower` or `variant_higher`); otherwise `no_decision`. A contrast whose interval is suppressed by the zero-solve rule has no p-value and no decision; say so, with its undefined share. Write the table.
- [ ] **Step 2: Pre-registration conformance, one line each:** primary metric; family; alpha; sides; bootstrap unit task, 10,000 resamples, seed 20261021, level 0.95; reported intervals per contrast unadjusted with the Bonferroni interval beside them from the same draws; zero-solve rule and which contrasts it hit; missing pairs (pairs and tasks per contrast, tasks dropped, and the D-7 state); interaction reported as exploratory; held-out excluded from the family and reported per arm as a descriptive robustness check, never pooled with the 39 and never read as evidence for BC coding in general; `lsp_shell_calls` reported per arm, no cell excluded for it; every exploratory metric of the pre-registration list present or listed as missing with the reason.
- [ ] **Step 3: Effect size against the design.** The minimum detectable effect was 0.37 at 39 x 8 (confirmation power 0.81 to 0.84). A `no_decision` is worded "not shown at this design", never "no effect".
- [ ] **Step 4: Rerun determinism.** Run Step 1 of M12-14 a second time into a scratch file. The two JSON files are equal apart from a generation time, if any. Quote the diff.
- [ ] **Step 5: Review.** Freeze the report JSON, the pre-registration, `protocol.md`, `deviations.md` and `analysis-check.md` into `H:\cg-coord\reviews\M12-15\` and ask gpt-6.1-sol (runbook "Reviews"): does every decision follow from the pre-registered rule; is anything reported as confirmatory that is not in the family; are the deviations complete. At most two rounds. Verdict into `decisions\<date>-m12-analysis.md`.

**Acceptance:** Holm table equal to the report; conformance list complete; review verdict recorded.

---

### Task M12-16: Caveats register v2

**Lane:** content. **Deps:** first version none; final after M12-15. **Window:** first version 11-18 to 11-20, final +3 days. Mirrors M6-01.

**Files:** Create `H:\cg-coord\m12\caveats.md`.

- [ ] **Step 1: Inventory.** Start from `H:\cg-coord\m6\caveats.md` (which rows still apply to v2). Then read every decision file since 2026-10-03, whatever words it uses, and `grep -il "caveat\|accepted risk\|owner-accepted\|residual\|limit\|disclos\|deviation" H:\cg-coord\decisions\*.md` for anything missed.
- [ ] **Step 2: One table:** `id | caveat (one sentence) | applies to (all, arm, contrast) | status (open, reduced, closed, dropped) | source path | owner action`. Rows that must be present: population scoped to the screened set (screening on the two diagonal arms); the 0/6 and 6/6 filter is a screen; N = 39 of 40 with the stratum deviation; effect 0.37 instead of 0.30; the simulation script change; held-out is same refapp and same authors; cost is a list-price estimate of subscription usage; the credential is readable by the agent, so cost is a lower bound for a cell that spends outside the guard (spec 6); NST egress not enforced (inner_only) and the sandbox egress mode of D-2; `calibration_waived` if set; compile-workflow burden is not knowledge; `lsp_shell_calls` is a best-effort audit; LSP passive diagnostics are not observable; concurrency 2 and host load (H-110: a heavy interactive app slows every reset by about 17 percent; each logged window; durations exploratory); container recreates during the campaign; account pool and usage-limit pauses; manual reruns; unknown-cost cells; the test-authoring discovery limit (C156 / M4-17a).
- [ ] **Step 3 (final):** add every row of `deviations.md` as a caveat or cite it under "checked, no caveat".

**Acceptance (orchestrator):** every source path exists (`test -f` loop quoted); every decision file since 2026-10-03 is cited or listed under "checked, no caveat"; every deviation row is mapped.

---

### Task M12-17: Write-up

**Lane:** content. **Deps:** template: M12-04 accepted; final: M12-14, M12-15, M12-16. **Window:** template 11-18 to 11-20, draft +3 days. **Owner decision:** D-13. Mirrors M6-04 and M6-08 Step 1.

**Files:** Create `H:\cg-coord\m12\writeup-template.md`, `H:\cg-coord\m12\writeup.md`.

- [ ] **Step 1: Template sections:** (1) question and design: the 2x2, the population, 39 x 8, the pre-registration identity and its three amendments; (2) confirmatory result: C1, C2, C3 with delta, ratio, unadjusted interval, Bonferroni interval, Holm-adjusted p and the decision text, over N pairs and tasks, and nothing else under this heading; (3) interaction, labelled exploratory; (4) held-out, labelled descriptive, per arm; (5) exploratory metrics per arm and as paired deltas, each labelled exploratory, missing shown as missing; (6) coverage: cells planned, scored, unscored, unknown cost, manual reruns, per arm; usage reconciliation status counts; (7) charts with captions; (8) deviations, the full table; (9) top caveats and a link to `caveats.md`; (10) spend: cash 0, list-price estimate labelled as an estimate; (11) reproducibility: `M12-run` sha, freeze commit, image id, campaign id, seed, archive `sums_sha256`, `derived.json`; (12) owner follow-ups.
- [ ] **Step 2:** Every number in the template is a placeholder `{{<csv>:<key columns>:<column>}}` naming a column of `arms.csv`, `comparisons.csv`, `contrasts.csv`, `held_out.csv`, `exploratory.csv`, `provenance.csv` or `ledger.csv`. No number is typed by hand.
- [ ] **Step 3 (final):** Fill `writeup.md` from the CSVs. Wording rules: a decided contrast says which arm has the lower cost per solved task; `no_decision` says "not shown at this design (minimum detectable effect 0.37)"; a suppressed interval says "CI suppressed" with the undefined share; never "equal", never "no effect", never a verdict from an interval. C3 is "realistic effect without LSP", never a general main effect. Claims are scoped to the frozen, screened task population. Plain sentences, no em dash.
- [ ] **Step 4:** `freeze-archive.ts bind 'H:\cg-coord\m12\archive' 'H:\cg-coord\m12\writeup.md' 'H:\cg-coord\m12\caveats.md'`; `verify` `[OK]`.
- [ ] **Step 5 (D-13):** the owner reads section 2 and signs off the headline wording.

**Acceptance (orchestrator):** sections 1 to 12 present; every placeholder resolves to an existing column; the orchestrator diffs every number in `writeup.md` against the CSVs and the report JSON with `jq`; both documents bound.

---

### Task M12-18: v2 data freeze

**Lane:** orchestrator, **owner approves (D-14)**. **Deps:** M12-15, M12-17. **Window:** +5 days. Mirrors M6-08 Steps 2 and 3.

**Files:** Create `H:\cg-coord\decisions\<date>-v2-data-freeze.md`.

- [ ] **Step 1:** `freeze-archive.ts verify 'H:\cg-coord\m12\archive'` prints `[OK]` on the day. `derived.json` lists the reports, charts, CSVs, ledger, pre-registration inputs, protocol, deviations, caveats and write-up.
- [ ] **Step 2:** Review by gpt-6.1-sol with frozen inputs: does every claim in the write-up follow from the bound report; is every caveat sourced; is every deviation disclosed. At most two rounds.
- [ ] **Step 3:** Decision file: master sha, `M12-run` sha, campaign id, `sums_sha256`, the sha256 of `derived.json`, stage-B sha, review path, and the freeze statement: the campaign record is closed, `STOP-cc-v2-factorial` stays in place, no rerun, rejudge, rederive or measure on this campaign without a new owner decision, and `--judging current` is used only after an owner-approved oracle fix and is reported beside, never instead of, the campaign judging.
- [ ] **Step 4 (D-14):** the owner approves the freeze and the push. Then: annotated tag `harness-v2-data-freeze-<date>` on master with the message line `sums_sha256: <hex>`, pushed (this tag kind is outside the orchestrator's standing push grant, so the approval must name it). `coord ask` plus a push notification with the write-up path.
- [ ] **Step 5:** Clean-up owed to the owner, listed in the decision: stop Cronus281 to 283; `harness archive` is not needed (the campaign ran on the shared root); the `M12-run` worktree stays until the owner says otherwise; credential rotation; the `.old-*` container roots.

**Acceptance:** review verdict recorded; owner's `OWNER-APPROVED` line; tag pushed; owner notified.

---

## Risk register (the six known risks and where they are handled)

| # | Risk | Handling |
| --- | --- | --- |
| 1 | Windows Update writes to `C:\Windows\Temp` in a BC container and trips the L4 quarantine; recovery needs a recreate and the owner | M12-07 (D-5), stop rule (c), M12-11 Step 4, deviation class Environment, compiler identity re-check after every recreate (M12-06 Step 5) |
| 2 | Per-variant wall time rises when a heavy interactive desktop app (a game) runs on the host: every container reset about 17 percent slower, on all containers in step, recovering by itself without a restart (H-110, owner confirmed) | The host-quiet rule (Global Constraints, D-6), `HOST-BUSY` detection from memlog's top-process samples (M12-05 Step 2b), each window a deviation row, the timing log against the 62 s reset and 37 s publish baselines (M12-07 Step 3, M12-11 Step 3), block-level arm randomisation, durations stay exploratory, caveat row |
| 3 | Resume correctness (qualify resume bug fixed in H-109) | M12-09 Step 3 exercises a stop and a resume on the smoke; every resume names `--campaign`; M12-11 Step 5 checks counts after each resume |
| 4 | Kernel token leak from git-bash process churn | M12-05 (pwsh watcher), heartbeat in one sleeping pwsh process, `daemons.tsv` checks in preflight, daily and after the smoke, the pool reading in the daily note |
| 5 | The Work account in the pool (`setup_failed`) | D-3, M12-06 Step 6, `jq '.accounts'` at smoke and launch, stop rules (d) and (i) |
| 6 | Host RAM ceiling of 93.7 GB | D-4 (two containers, concurrency 2), M12-06 Step 8, hostwatch and the campaign watcher, resume bar 14 GB |

## Open questions for the owner

1. **Egress mode (D-2).** The egress grants ended 2026-11-17T23:59Z and exclude confirmatory runs. Does the confirmatory campaign run with `--unverified-egress-ok` on the sandbox side, as screening did, or does it wait for an authorized marker? The first also records `calibration_waived` on the campaign.
2. **Missing-data rule (D-7).** The pre-registration says per-contrast matched pairs; the report withholds every decision if one selected-task cell has no cost. Keep the stricter code and name the fallback, or change the code before the campaign?
3. **Windows Update (D-5).** Change the containers (and re-baseline), or accept two to five recreates during the campaign with a pre-approved runbook?
4. **Host-quiet rule (D-6).** Will the host stay free of heavy interactive apps for the 7 to 15 days, or do we log each window as a deviation? Should a detected window only be logged, or also pause the campaign?
5. **Account pool (D-3).** Which labels, is `MAXWork` in, and may lane-ops add one named reserve label on a resume? Is about USD 2,000 to 3,200 of list-price usage over 7 to 15 days within the weekly limits of the pool?
6. **Containers (D-4).** Two containers with a cold spare, or three?
7. **Who resumes.** May lane-ops resume after a usage-limit pause or a planned pause, or does the owner run every resume?
8. **Exploratory bootstrap settings (D-8).** The pre-registered 10,000 and 20261021 for the exploratory comparisons too, or the CLI defaults?
9. **RAM bars.** Spec gate 5 says stop under 10 GB and resume at 14 GB. Hostwatch stops the lowest priority at 8 GB free and everything at 4 GB. Which bars bind for this campaign?
10. **Freeze tag push (D-14)** and whether any v2 result goes to the site later (`publish-setup`). This plan publishes nothing.
