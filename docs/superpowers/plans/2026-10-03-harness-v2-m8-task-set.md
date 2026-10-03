# Harness Bench v2, M8 Task Set v2 Implementation Plan (revision 3)

> **Shared interfaces:** every cross-plan name, path, record shape, tag and date in this plan is defined in `H:\cg-coord\plans-v2\2026-10-03-harness-v2-interfaces.md` (the appendix). Where this plan and the appendix differ, the appendix wins and this plan is the bug.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author, gate, seal, screen and freeze the v2 harness task set: a candidate pool HX-007 onward on a new `refapp-v2`, four held-out tasks designated by a pre-registered rule from beacon randomness, a symmetric screening pilot on the plain and realistic+LSP arms, a deterministic pre-specified selection to the task count M11 stage B picks, and a qualified freeze, with `refapp-v1` and the v1 tasks untouched.

**Architecture:** lane-content grows `harness-tasks/refapp` into refapp v2 and authors candidates in four waves under `harness-tasks/tasks/HX-NNN/` (v1 layout plus `measures/` and measurement-only `fixture/<name>/` folders for M11; appendix section 7). lane-ops runs every container job (premise probes, gates, screening campaigns, freeze qualification). lane-infra writes one script, `scripts/harness/screening.ts`, which holds the screening protocol in code: registry and seal schemas, a hash-chained seal ledger anchored by seal and ledger tags, per-seal append-only and task-tree binding, campaign-to-identity binding and campaign chronology, held-out pick with quotas, screening history with the one-rescreen rule, pooled tally, stratum boundaries, greedy selection with final-set quota accounting. Candidates enter screening only through a **seal**: a tag on the commit that fixes their registry entries and task trees, followed by a public drand beacon round drawn after the tag was published; the beacon value seeds the ranks of the candidates first sealed there, and the ledger entry recording it is itself tagged (appendix section 9).

**Tech Stack:** AL (BC 28.4, runtime 17.0, `NoImplicitWith`), Library Assert, the SOAP test harness; Deno + TypeScript (zod, `@std/yaml`, `@std/cli/parse-args`), existing `src/harness` records (`CampaignRecordSchema`, `RecordStore`, `loadCampaignData`, `validateCampaignRecords`, `cellsFromRecords`, `taskSetIdentity`), the M4 gate (`scripts/harness/gate-*.ts`), `harness run`, `harness validate`, `harness qualify`; drand (`https://api.drand.sh`) for public randomness.

**Spec:** `docs/superpowers/specs/2026-10-03-harness-v2-design.md` (on master 2f8d2fca; `git show master:docs/superpowers/specs/2026-10-03-harness-v2-design.md`). Sections 3, 7, 10, 12 (round 2 findings 2, 3 and 4 are acceptance items here) and 13. Process precedent: `docs/superpowers/plans/2026-09-30-harness-refapp-v1.md` (M4). Cross-plan rulings: `H:\cg-coord\reviews\PLANS-v2-002\cross-plan-rulings.md` (1 to 10). Owner decisions: `H:\cg-coord\decisions\2026-10-03-v2-plans-round3.md`. Sibling plans: M9 `2026-10-03-harness-v2-m9-realistic.md`, M10 `...-m10-lsp.md`, M11 `...-m11-metrics.md`.

**Revision 2 inputs:** review `H:\cg-coord\reviews\PLANS-v2-001\review-m8.md` (REJECT, nine findings, all accepted; see "Review responses" at the end) and the cross-plan rulings 1, 5 and 8. **Revision 3 inputs:** review `H:\cg-coord\reviews\PLANS-v2-002\review-m8.md` (REJECT) and the shared interfaces appendix; see "Review responses (round 2)" and "Round 3 changes" at the end.

## Global Constraints

- Selection is fixed before any outcome is seen (spec 3). The rules in `harness-tasks/v2/screening.yml` are frozen at the first seal (`harness-v2-screen-start`). A candidate is screened only after a seal fixed its registry entry and its whole task folder tree; after that, its entry never changes except `broken`, and its folder never changes. `screening.ts status|select` refuses otherwise.
- Randomness for held-out designation and ranks comes from a public drand round fixed by rule AFTER the seal tag is published (pushed to origin); no author can predict or grind it.
- Never keep or drop a candidate for an observed arm difference. The tally pools both arms; the selection sees stratum, kind, coupling and size only; the broken-oracle triage reads judgments (no arm) and workspaces stripped of every arm-identifying file.
- Drop rule (spec 3 item 3): dead (0/6), saturated (6/6), confirmed broken oracle. Additional missingness rule `unscreenable` (incomplete after the one allowed rescreen): owner-approved 2026-10-03 (`decisions\2026-10-03-v2-plans-round3.md`) and pre-registered in stage A. The 0/6 and 6/6 filter is a screen, not proof of intermediate difficulty; screening on the two diagonal arms selects a population and every claim is scoped to it.
- Pilot executions are never confirmatory: screening experiments are `v2-screen-*`; one campaign per experiment; the freeze record lists them as excluded.
- A redesign is a new candidate (new id, gate, audit, its own seal, fresh screening, `supersedes: <old id>`); only a dead, saturated or broken candidate may be redesigned.
- Screening waits for (round 2 finding 3, rulings 1 and 5): the campaign image `centralgauge/harness-claude-code:2.1.282-r3` built after M9 and M10 merged (M9-17), with M9 gate 1 (inventory, M9-17) and M10 S1 proven on that image (M10-09); both screening configs reference `image_revision: "3"` (never a `-dev-` revision; `loadExperiment` refuses them, appendix section 1); M9-12 leakage audit clean on every candidate of the seal being screened and the bundle lock committed; the model fixed and `models --check` green; M11 gate 6 (measures qualified, M11-14) incl. the test-authoring discovery decision (C156 / M4-17a); M11 stage A frozen (tag `harness-v2-prereg-a` and decision file `H:\cg-coord\decisions\*-harness-v2-prereg-a.md`, planned `2026-10-24-harness-v2-prereg-a.md`; appendix section 10).
- `refapp-v1`, the `refapp-v1-rcN` tags and `harness-tasks/tasks/HX-001` to `HX-006` never change. v1 tasks are not v2 candidates.
- No task in this plan needs H-01 (ruling 8): M8 code touches only the gate scripts and a new script; it reads, never changes, image or ContainerUser code.
- lane-content never touches a container (host `gate-task.ts compile` is allowed). lane-ops owns `scripts/harness/gate-*.ts`. Every container job: bench-live check (`find results/.bench-running.json -mmin -2` prints nothing), a lease on Cronus281 to Cronus283 only, never kill a process by image name, only a PID you started.
- Task authoring (CLAUDE.md): ticket-style prompts, no hints; oracles assert every requirement, boundaries on both sides, only what the prompt or a refapp contract states; never weakened. Measurement-only fixtures live in `fixture/<name>/`, never in `naive/`, so no oracle is bent to fit them.
- M4 oracle rules carry over (own keys, Setup and work date per procedure; no state assertion after `asserterror` in the same procedure; no literal AutoIncrement; `Subtype = Test;`, `TestPermissions = Disabled;`).
- Id bands: refapp modules as v1; visible tests 80000-84999 (never 80013); oracle of HX-N: N <= 6 keeps 85000+(N-1)*100 .. +99, N >= 7 owns `85600 + (N-7)*20 .. +19` (M8-01), last possible task HX-226. Oracle app id `c6a1e000-0000-4000-8001-000000000NNN`, name `CGR Oracle HX-NNN`.
- Codeunit 80000 `"CGR Skeleton Tests"` keeps its five procedures.
- Refapp frozen at the start seal: `git diff harness-v2-screen-start HEAD -- harness-tasks/refapp` stays empty to the freeze; later candidates are overlay-only.
- Evidence under `H:\Temp3\harness-spike\M8\...`; gate reports stay where `gate-task.ts` writes them (`H:\Temp3\harness-spike\M4\<task>\`).
- `deno check`, `deno lint`, `deno fmt` on changed `.ts` files only. No em dash in committed text. `graphify update .` after code lands.

## Review Focus

1. **Registry or task content changes after sealing** (prior, size, supersedes, a task file, or a discarded candidate edited to shift ranks or quotas). Expected: refused with the id named. Pinned in M8-02 (`appendOnlyProblems: ...`, `treeProblems and identityProblems bind tasks and campaigns to the sealed contents`).
2. **Selective reruns**: an experiment run twice, a complete candidate rescreened, a third screen, a duplicated campaign. Expected: refused; only an incomplete candidate gets one rescreen. Pinned in M8-02 (`screeningHistory: selective reruns are refused`, `... one rescreen of an incomplete task replaces its cells`).
3. **A pending or infra-unscored cell counts as unsolved.** Expected: `incomplete`, never dead. Pinned in M8-02 (`tally pools both arms; a pending cell makes the task incomplete, never a fail`).
4. **Quota accounting is stale or order-dependent.** Expected: quotas judged on the final set after borrowing; same set in any input order; rank decides ties. Pinned in M8-02 (`select: quotas are judged on the final set, after borrowing`, `select: input order never changes the result`, `select: rank breaks a tie`).
5. **A held-out task is screened, or the held-out set misses the quotas.** Expected: contamination refused; held-out set has 2+ large tasks and every required coupling style. Pinned in M8-02 (`contaminationProblems: ...`, `pickHeldOut: the odometer moves ...`).
6. **The seal ledger is rewritten, a seal tag is moved, or a campaign predates its seal's beacon.** Expected: refused naming the seal or campaign. Pinned in M8-02 (`ledgerProblems: ...`, `chronologyProblems: ...`).

---

## Decisions argued from the spec

- **Seals and randomness (finding 7; round 2 finding 3).** A seal is: (1) the registry entries and task folders committed; (2) the commit tagged `harness-v2-screen-<name>` (annotated) and the tag pushed to origin (GitHub records the push time; ruling 10); (3) the drand round fixed by rule: the first round of the default chain (`https://api.drand.sh/info`: `period`, `genesis_time`, `hash`) whose time is at least 10 minutes after the push time, i.e. `round = ceil((push_unix + 600 - genesis_time) / period) + 1`; (4) its `randomness` from `https://api.drand.sh/public/<round>` recorded in a ledger entry appended to `harness-tasks/v2/seals.yml` (`v: 2`), whose `prev` is the hash of the previous entry; (5) the commit that appends the entry tagged `<seal tag>-ledger` and pushed. The seed of the seal is `<tag commit id>:<randomness>`. A candidate's rank is sha256(`<seed of its first seal>:<id>`). Ids are allocated and content is committed before the beacon exists, so neither commit grinding nor id choice helps. The ledger is append-only and verifiable: `ledgerProblems` walks the chain and checks each entry against the ledger file committed at its seal tag (entries before it) and at its ledger tag (entries up to it), and each tag against the recorded tag object and commit; `chronologyProblems` refuses a screening campaign created before the beacon round of the seal that first sealed its tasks (appendix section 9).
- **Screening protocol (round 2 finding 2).**
  - *Pilot outcome:* pooled solved cells over 2 arms x 3 repeats of the newest screen of the candidate; a cell is solved when its final verdict is `pass` (`cellsFromRecords`). Fewer than 6 scored: `incomplete`, one rescreen of all six cells; still incomplete: `unscreenable` (owner-approved missingness rule, excluded, never redesigned).
  - *Strata:* 0/6 dead, 6/6 saturated (dropped); 5/6 easy; 2/6 to 4/6 intermediate; 1/6 hard. Held-out tasks keep the author prior as their label and never enter selection.
  - *Sizes:* easy = round(0.2 N), hard = round(0.2 N) half up, intermediate the rest (24: 5/14/5, 30: 6/18/6, 40: 8/24/8).
  - *Quotas:* each kind at most floor(0.4 N) and at least 2; each of `single-instance`, `temporary-table`, `commit-behavior` at least once; at least ceil(N/2) large (3+ objects across 2+ files, a procedure to reuse, or an event/interface to follow).
  - *Selection:* candidates visited in rank order (task id as last tie-break); phases kind minimum, coupling, large, fill; a candidate fits while its stratum and kind have room; then a short stratum borrows (easy <- intermediate; intermediate <- hard, easy; hard <- intermediate), each borrow a recorded deviation. Every quota is evaluated once on the final set (finding 5). Greedy: a reported shortfall may hide a feasible combination; disclosed and pre-registered.
  - *Too few:* `select` exits 2 naming the shortfalls; lane-content authors replacements aimed at them (new ids, gate, own seal, fresh screening); `select` runs again. Still short at the replacement cutoff: `coord ask` to the owner (a smaller N from the M11 grid, or an accepted quota deviation).
  - *Held-out (spec 3 item 4, finding 9, round 2 finding 9):* at the start seal, one per kind; combinations tried in rank order (odometer, last kind fastest), the first with at least 2 large tasks and every required coupling style (`single-instance`, `temporary-table`, `commit-behavior`) wins; none: `heldout` exits non-zero and the orchestrator asks the owner before stage A. Not screened; a screened held-out is refused as contamination. Excluded from C1 to C3; descriptive robustness check (same refapp, same authors).
- **Pre-registration order (finding 1, ruling 5, round 2 finding 1; appendix section 11).** The start seal comes first: the start seal and held-out designation need no M11 input (M8-15a, 10-21); M11 stage A (M11-16, 10-22..24) records the four held-out ids from M8-15a; screening (M8-15b, 10-25) needs stage A. After the pilots, M11-17a produces the provisional design (N, R; not binding) from `sim-b.json`; M8-19 selects with that N; the freeze follows; M11-17b binds selection and design in stage B. No step waits on a later one.
- **Pool size and capacity (finding 8, round 2 finding 4; appendix section 12).** v1 retention under this screen would have been 2 of 6; the first revision's 2/3 assumption was optimistic. `pool_factor = 2.0` (also M11's): pool = ceil(2.0 x N_prelim) screened candidates + 4 held-out, N_prelim from M11-15 (`H:\cg-coord\m11\sim-a.md`, 10-13): N=24 gives 52 candidates (HX-007 to HX-058), N=30 gives 64 (to HX-070), N=40 gives 84 (to HX-090). The start seal holds waves 1 to 3 (HX-007 to HX-042, 36 candidates); wave 4 (16, 28 or 48 candidates) is sealed separately and takes 6, 10 or 16 authoring days at the planned 3 gated candidates per day. Cells: pilot 6 x screened (+10% rescreen allowance) plus campaign (N + 4) x R x 4 with R from stage B; at R = 5 that is 877, 1,076 or 1,408 cells. The N=40 path freezes about 11-15 and is over 1,300 cells: M8-07b sends it to the owner (cap at 30 or accept the slip).
- **Measures for M11 (finding 2, round 2 finding 2; appendix section 7).** Every non-test-authoring candidate carries `measures/measures.yml` (M11 `TaskMeasuresSchema`): partial-credit weight 1 per NEW-REQUIREMENT row and every other `fail_to_pass` procedure in `hidden_regressions`, the split taken from the candidate's first promoted gate report BEFORE the seal (A9; a row failing on `baseline` is new-requirement), a `reuse` block with `targets` (`codeunit`, `procedure`, `signature`, `file`, `perturb`) and `tests` when the candidate is reuse-flagged, and `expect` per variant (`correct`: partial_credit 1, final_errors 0, `reuse_executed: true, reuse: true` when flagged; every `naive/<x>`: its measured partial credit over the weights). Measurement-only fixtures live in `fixture/<name>/` (variant id `fixture/<name>`; overlay + fixture, judged only by M11-14, never in the gate matrix): `duplicated-logic`, `dead-call`, `comment-only` (`reuse_executed: false, reuse: false`) and `token-call` (`reuse_executed: true, reuse: false`) on at least 3 reuse-flagged tasks, `caught-call` on at least one of them, and one `unused-variable` (expect `new_warning_codes: [AA0137]`, partial credit 1).
- **Final count.** M11 stage B picks N; M8 never picks it.
- **Test-authoring** prompts state that the tests go in a new test codeunit in the Test app (as frozen HX-002, C156) until M11 qualifies procedure-level discovery.
- **refapp-v2 and gating at freeze (finding 3).** Candidates pin `refapp-v2-rcN` while authored; M8-14 re-pins the start set to `refapp-v2`, the orchestrator creates the local `refapp-v2` tag on the start-seal commit, and every later candidate pins `refapp-v2` directly. The freeze re-gates every frozen task at `--rev <freeze commit>` and separately proves `git rev-parse refapp-v2:harness-tasks/refapp` equals `git rev-parse <freeze commit>:harness-tasks/refapp`.

## Cross-lane dependencies and requests

| M8 task | Needs from | What |
| --- | --- | --- |
| M8-07b, M8-12 | M11-15 | `H:\cg-coord\m11\sim-a.md` provisional design (N_prelim), 10-13 |
| M8-15a | none | start seal, ledger and held-out; sends the four held-out ids to M11-16 (stage A `held_out.tasks`) |
| M8-15b | M9-17, M10-09 | image `centralgauge/harness-claude-code:2.1.282-r3` (ruling 1) with gate 1 and S1 proven on it; screening configs `cc-v2-plain`, `cc-v2-realistic-lsp` with `image_revision: "3"` |
| M8-15b, M8-16b, M8-18 | M9-12 | leakage audit clean on every candidate of the seal being screened (a rerun per seal, not only at freeze); bundle lock before the first pilot cell |
| M8-15b | M11-14, M11-16 | gate 6 qualified incl. test-authoring discovery decision; stage A tag `harness-v2-prereg-a` and decision file; model `models --check` green |
| M8-16 | M7 | concurrency for the pilot window, else 1 |
| M8-19 | M11-17a | provisional design N from `sim-b.json` (binding only after M11-17b) |
| M11-17b | M8-19, M8-21 | committed `selection.json` (`status: ok`) and the freeze record |
| M11-14 | M8-06, M8-07 | wave 1 candidates with `measures/` (split from the gate) and `fixture/` folders gated by 10-12 (appendix section 7) |
| M12 | M8 | `harness-tasks/v2/selection.json` globs and the freeze record |

Settled since revision 2 (no longer requests): M11 uses the `fixture/<name>` folder and variant (appendix section 7); M9-12 runs per seal; the screening config ids are `cc-v2-plain` and `cc-v2-realistic-lsp` (M9-08); the owner approved `unscreenable` and accepted that the N=40 path may slightly exceed 1,300 cells (round 3 decisions); ruling 10 lets the orchestrator push seal and ledger tags.

## Schedule (rebaselined, finding 8; round 3 per appendix sections 11 to 13)

Target freeze **2026-11-05** (N_prelim 24); **11-09** for N_prelim 30; **11-15** for N_prelim 40; add about 4 days if a replacement round is needed. Reasons: M11 stage A is frozen 10-24 after the start seal (screening cannot start before 10-25), M11-15 gives N_prelim on 10-13, wave 4 is 16, 28 or 48 candidates at about 3 gated candidates per day (three authoring threads, owner-accepted). M8-07b recomputes the schedule from measured rates on 10-12 (and again on 10-13 with N_prelim); a projected freeze after 11-12 goes to the owner with the option to cap N_prelim at 30 (or 24).

| Days | lane-infra | lane-content | lane-ops |
| --- | --- | --- | --- |
| 10-03 to 10-05 | M8-02 | M8-04 starts | M8-01, M8-03 |
| 10-04 to 10-07 | | M8-04 (refapp v2 + HX-007) | M8-05 (rc1) 10-07 |
| 10-07 to 10-11 | | M8-06 wave 1 (incl. M11 fixtures) | M8-07 10-09 to 10-12 |
| 10-12, 10-13 | M8-07b capacity checkpoint (orchestrator; rerun with N_prelim) | | |
| 10-11 to 10-15 | | M8-08 wave 2 | M8-09 to 10-16 |
| 10-15 to 10-19 | | M8-10 wave 3 | M8-11 to 10-20 |
| 10-20 to 10-21 | | M8-14 (start set) | |
| 10-21 | M8-15a start seal, ledger, held-out ids to M11-16 | | |
| 10-20 to 10-25 (N=24) | | M8-12 wave 4 | M8-13 to 10-26 |
| 10-27 | M8-15c wave 4 seal | | |
| 10-25 | M8-15b (after stage A 10-24, r3 gates 10-21) | | |
| 10-25 to 10-28 | | | M8-16a start-seal pilot |
| 10-28 to 10-31 | | | M8-16b wave 4 pilot, rescreens, triage |
| 11-01 | M11-17a provisional design (M11) | | |
| 11-02 | M8-19 | | |
| 11-03 | M8-20 | | |
| 11-03 to 11-05 | | | M8-21 |
| 11-06 | M11-17b stage B binding (M11) | | |
| if short: 11-03 to 11-09 | M8-19r rerun 11-09 | M8-17 11-03 to 11-05 | M8-18 11-05 to 11-08; M8-21 11-10 to 11-12 |

For N_prelim 30 or 40, every row from M8-15c onward shifts by 4 or 10 days (appendix section 12). Capacity formulas used at the 10-12 checkpoint (identical to the appendix): authoring days = remaining candidates / measured gated candidates per day; gate hours = candidates x measured gate wall time (M8-07 Step 2) / 3 containers; pilot cells = 6 x screened candidates x 1.1 (rescreen allowance); pilot hours = pilot cells x median cell wall time (frozen v1 archive) / concurrency; campaign cells = (N + 4) x R x 4 with R from stage B (5 until then).

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `scripts/harness/gate-stage.ts` | `oracleBandOf`; `fixture/` layers get the static checks | M8-01 |
| `tests/unit/harness/gate-stage.test.ts`, `gate-fixtures.ts` | band and fixture tests | M8-01 |
| `tests/unit/harness/task-set-v1.test.ts` | pins exactly HX-001 to HX-006 | M8-01 |
| `scripts/harness/screening.ts`, `tests/unit/harness/screening.test.ts` | screening protocol and CLI | M8-02 |
| `harness-tasks/v2/screening.yml` | rules + candidate registry | M8-02, waves |
| `harness-tasks/v2/seals.yml` | hash-chained seal ledger (`v: 2`, appendix section 9) | created at M8-15a, appended at M8-15c and M8-18 |
| `harness-tasks/refapp/**` | refapp v2 | M8-04 |
| `harness-tasks/tasks/HX-NNN/**` | candidates incl. `measures/`, `fixture/` | M8-04, waves, M8-17 |
| `harness/experiments/v2-screen-*.yml` | screening experiments | M8-15b, M8-16b, M8-18 |
| `harness-tasks/v2/selection.json` | selection (committed only with `status: ok`) | M8-19 |
| `tests/unit/harness/task-set-v2.test.ts` | frozen v2 set pins `refapp-v2` | M8-20 |
| `H:\Temp3\harness-spike\M8\...` | cards, audits, probes, seals, pilot notes, freeze record | evidence |

---

### Task M8-01: oracle bands past HX-050, static checks for fixtures, v1 set test

**Lane:** ops (owner of `gate-*.ts`). **Deps:** none. **Target:** 10-03.

**Files:**
- Modify: `scripts/harness/gate-stage.ts` (band block in `checkTask`; `layerRoots` in `checkTask`)
- Modify: `tests/unit/harness/gate-fixtures.ts`, `tests/unit/harness/gate-stage.test.ts`, `tests/unit/harness/task-set-v1.test.ts`

**Interfaces:**
- Produces: `export function oracleBandOf(taskNo: number): readonly [number, number] | null`; `checkTask` applies every static layer rule to `fixture/<name>/` (the measurement-only fixture folder of appendix section 7; gate runs never include fixtures: `gatePlan` takes only `naive/` names).

- [ ] **Step 1: Write the failing tests.** Add `oracleBandOf` to the import from `../../../scripts/harness/gate-stage.ts` in `gate-stage.test.ts` and append:

```typescript
Deno.test("oracleBandOf: v1 keeps 100 ids, HX-007 on own 20 up to HX-226", () => {
  assertEquals(oracleBandOf(1), [85000, 85099]);
  assertEquals(oracleBandOf(6), [85500, 85599]);
  assertEquals(oracleBandOf(7), [85600, 85619]);
  assertEquals(oracleBandOf(51), [86480, 86499]);
  assertEquals(oracleBandOf(226), [89980, 89999]);
  assertEquals(oracleBandOf(227), null);
  assertEquals(oracleBandOf(0), null);
});

Deno.test("checkTask: HX-051 oracle lives in its own 20-id band", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-051", "# Bug\n");
  let r = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  assertEquals(r.problems, []);
  await write(dir, "oracle/src/P.al", TEST_CU(85000, "Other"));
  r = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  assertStringIncludes(
    r.problems.join("\n"),
    "object id 85000 outside Oracle range 86480-86499",
  );
});

Deno.test("checkTask: a fixture/ layer gets the static layer rules", async () => {
  const root = await tmp();
  const dir = await writeTask(root, "HX-007", "# Bug\n");
  await write(dir, "fixture/unused-variable/Test/src/X.al", TEST_CU(80010, "X"));
  const r = await checkTask(
    await loadTask(dir),
    join(root, "harness-tasks/refapp"),
    root,
  );
  assertStringIncludes(
    r.problems.join("\n"),
    "fixture/unused-variable/Test/src/X.al: correct/, naive/ and mutants/ must not touch Test/",
  );
});
```

In `gate-fixtures.ts`, `writeTask` uses the shared rule:

```typescript
import { oracleBandOf } from "../../../scripts/harness/gate-stage.ts";
// ...
  // Each task owns its oracle band (gate-stage oracleBandOf).
  const [band, bandTo] = oracleBandOf(Number(id.slice(3)))!;
// ...
      idRanges: [{ from: band, to: bandTo }],
```

Replace the body of `task-set-v1.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { loadTaskSet } from "../../../src/harness/task.ts";

Deno.test("v1 task set: six tasks, kinds and refapp version", async () => {
  const set = (await loadTaskSet("harness-tasks/tasks"))
    .filter((t) => /^HX-00[1-6]$/.test(t.task.id));
  assertEquals(
    set.map((t) => `${t.task.id}:${t.task.kind}:${t.task.refapp_version}`),
    [
      "HX-001:bugfix:refapp-v1",
      "HX-002:test-authoring:refapp-v1",
      "HX-003:feature:refapp-v1",
      "HX-004:feature:refapp-v1",
      "HX-005:refactor:refapp-v1",
      "HX-006:feature:refapp-v1",
    ],
  );
});
```

- [ ] **Step 2: Run to verify failure.** `deno test --allow-all tests/unit/harness/gate-stage.test.ts`. Expected: FAIL, `oracleBandOf` is not exported.

- [ ] **Step 3: Implement.** In `gate-stage.ts`:

```typescript
/**
 * Oracle object band of task HX-N: HX-001..HX-006 keep their v1 100 ids;
 * HX-007 onward own 20 ids from 85600 (v2 pool, spec 2026-10-03 section 3).
 * null past 89999 (HX-227 and up).
 */
export function oracleBandOf(taskNo: number): readonly [number, number] | null {
  if (!Number.isInteger(taskNo) || taskNo < 1) return null;
  const from = taskNo <= 6 ? 85000 + (taskNo - 1) * 100 : 85600 + (taskNo - 7) * 20;
  const to = from + (taskNo <= 6 ? 99 : 19);
  return to > 89999 ? null : [from, to];
}
```

Replace the band block in `checkTask`:

```typescript
  const taskNo = Number(task.id.slice(3));
  const band = oracleBandOf(taskNo);
  if (!band) problems.push(`${task.id}: no oracle band inside 85000-89999`);
  // An empty range when there is no band: every oracle id is reported.
  const oracleBand: readonly [number, number] = band ?? [85000, 84999];
```

and extend `layerRoots` with the fixtures (static checks only; nothing plans a gate run for them):

```typescript
  const fixtures = await subdirs(join(dir, "fixture"));
  const layerRoots = [
    "overlay",
    "correct",
    "reference-tests",
    ...naive.map((n) => `naive/${n}`),
    ...fixtures.map((n) => `fixture/${n}`),
    ...task.mutants.map((m) => `mutants/${m}`),
  ];
```

(`subdirs` returns `[]` for a missing folder, so tasks without fixtures are unaffected.)

- [ ] **Step 4: Run to verify pass.** `deno test --allow-all tests/unit/harness/gate-stage.test.ts tests/unit/harness/gate-core.test.ts tests/unit/harness/gate-task.test.ts tests/unit/harness/task-set-v1.test.ts`. Expected: all pass. `deno check`, `deno lint`, `deno fmt` on the four files.

- [ ] **Step 5: Commit.** `git add scripts/harness/gate-stage.ts tests/unit/harness/gate-fixtures.ts tests/unit/harness/gate-stage.test.ts tests/unit/harness/task-set-v1.test.ts && git commit -m "feat(harness-gate): 20-id oracle bands from HX-007; fixtures get static checks; v1 set test pins HX-001..006"`

**Acceptance:** the four test files pass; `oracleBandOf(7)` is `[85600, 85619]`; a fixture touching `Test/` is a problem.

---

### Task M8-02: screening protocol in code and the rules file

**Lane:** infra. **Deps:** none. **Target:** 10-05.

**Files:**
- Create: `scripts/harness/screening.ts`, `tests/unit/harness/screening.test.ts`, `harness-tasks/v2/screening.yml`

**Interfaces:**
- Consumes: `Cell` (`src/harness/stats.ts`), `cellsFromRecords`, `CampaignRecordSchema`, `RecordStore`, `loadCampaignData`, `validateCampaignRecords`, `taskSetIdentity`, `loadSymbolsLock`, `TaskIdentity`, `sha256Hex`, `HarnessTaskSchema`, `loadTask`, `TASK_KINDS`, `readYaml`.
- Produces:
  - `deno run --allow-all scripts/harness/screening.ts heldout`: reads `harness-tasks/v2/seals.yml` at HEAD; prints `held_out: <4 ids>` and `tasks: "<glob of the start candidates minus held-out>"`.
  - `... screening.ts status [--results-dir results/harness]`: refuses a dirty `harness-tasks`; loads every seal, every `v2-screen-*` campaign; prints every problem (exit 1) or one line per candidate `<id> <status> [<solved>/<scored>]` and `next screen tasks: "<glob>"` (incomplete and sealed-unscreened candidates).
  - `... screening.ts select --n <N> [--out harness-tasks/v2/selection.json]`: as `status`, then writes the selection JSON; exit 0 ok, 1 problems, 2 too few.
  - Selection JSON: `{ v: 1, status: "ok" | "too_few", head, seals: [{tag, commit}], campaigns: [{id, experiment}], held_out, confirmatory_tasks, held_out_tasks, candidates: { <id>: { status, solved?, scored?, complete? } }, selection: { n, targets, selected, by_stratum, deviations, shortfalls } }`.
  - `seals.yml` (appendix section 9): `{ v: 2, seals: [{ tag, tag_object, commit, pushed_at, drand_chain, drand_round, round_time, randomness, prev }] }`, first tag `harness-v2-screen-start`, `prev` chained by `entryHash`; each seal tag has a `<tag>-ledger` tag on the commit that appends its entry.
  - `entryHash(e): Promise<string>`, `ledgerProblems(head, anchors): Promise<string[]>`, `chronologyProblems(campaigns, firstRoundTime): string[]`.
  - Exports M11-13/15 import (appendix section 8, unchanged names): `RulesSchema`, `Rules`, `Kind`, `STRATA`, `Stratum`, `Eligible`, `Selection`, `stratumOf`, `select`.

- [ ] **Step 1: Write the failing tests** `tests/unit/harness/screening.test.ts` (verified against master `src/harness` during planning: the 25 cases below other than the registry case pass with the Step 4 code; the round 3 cases `ledgerProblems` and `chronologyProblems` are new, 28 in all):

```typescript
import { assert, assertEquals, assertThrows } from "@std/assert";
import type { Cell } from "../../../src/harness/stats.ts";
import { ValidationError } from "../../../src/errors.ts";
import { readYaml } from "../../../src/harness/yaml.ts";
import {
  appendOnlyProblems,
  type Candidate,
  chronologyProblems,
  classify,
  contaminationProblems,
  type Eligible,
  entryHash,
  identityProblems,
  isLarge,
  type Kind,
  ledgerProblems,
  pickHeldOut,
  type SealEntry,
  ranks,
  REGISTRY_PATH,
  type Rules,
  RulesSchema,
  type Screening,
  screeningHistory,
  ScreeningSchema,
  SealsSchema,
  seedOf,
  select,
  type Status,
  type Stratum,
  stratumOf,
  supersedeProblems,
  tally,
  targets,
  tasksGlob,
  treeProblems,
} from "../../../scripts/harness/screening.ts";

const RULES: Rules = RulesSchema.parse({
  arms: ["cc-v2-plain", "cc-v2-realistic-lsp"],
  repeats: 3,
  easy_share: 0.2,
  hard_share: 0.2,
  kind_min: 2,
  kind_max_share: 0.4,
  required_coupling: ["single-instance", "temporary-table", "commit-behavior"],
  coupling_min: 1,
  large_min_share: 0.5,
  borrow: {
    easy: ["intermediate"],
    intermediate: ["hard", "easy"],
    hard: ["intermediate"],
  },
});

const C = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  prior: "intermediate",
  size: { objects: 3, files: 2, reuse: null, traces: null },
  supersedes: null,
  broken: null,
  ...extra,
});
const S = (candidates: Candidate[], rules: Rules = RULES): Screening =>
  ScreeningSchema.parse({ v: 1, rules, candidates });

const cell = (
  task: string,
  arm: string,
  repeat: number,
  pass: boolean | null,
): Cell => ({
  task,
  arm,
  repeat,
  status: pass === null ? "pending" : "scored",
  pass,
  spend_usd: 0,
  known_spend_usd: 0,
  attempts: 1,
});
const six = (task: string, solved: number): Cell[] =>
  [0, 1, 2, 3, 4, 5].map((i) =>
    cell(task, RULES.arms[i % 2]!, Math.floor(i / 2) + 1, i < solved)
  );
const incomplete = (task: string): Cell[] => [
  ...six(task, 0).slice(0, 5),
  cell(task, RULES.arms[1], 3, null),
];

const E = (
  id: string,
  stratum: Stratum,
  kind: Kind,
  extra: Partial<Eligible> = {},
): Eligible => ({ id, stratum, kind, coupling: [], large: false, ...extra });
const rankOf = (pool: { id: string }[]) =>
  new Map(pool.map((e, i) => [e.id, String(i).padStart(4, "0")]));
const KINDS4: Kind[] = ["feature", "bugfix", "refactor", "test-authoring"];

/** HX-101..110 intermediate, 111..114 easy, 115..118 hard; kinds cycle by id. */
function basePool(): Eligible[] {
  const out: Eligible[] = [];
  let n = 100;
  const add = (stratum: Stratum, count: number) => {
    for (let i = 0; i < count; i++) {
      n++;
      out.push(E(`HX-${n}`, stratum, KINDS4[n % 4]!, { large: n % 2 === 0 }));
    }
  };
  add("intermediate", 10);
  add("easy", 4);
  add("hard", 4);
  out[0]!.coupling = ["single-instance"];
  out[1]!.coupling = ["temporary-table"];
  out[10]!.coupling = ["commit-behavior"];
  return out;
}
const loose = (extra: Partial<Rules> = {}): Rules => ({
  ...RULES,
  kind_min: 0,
  required_coupling: ["single-instance"],
  large_min_share: 0,
  ...extra,
});

Deno.test("committed registry: rules are the pre-registered values", async () => {
  const s = await readYaml(REGISTRY_PATH, ScreeningSchema);
  assertEquals(s.rules, RULES);
});

Deno.test("targets: easy and hard round half up, the rest intermediate", () => {
  assertEquals(targets(24, RULES), { easy: 5, intermediate: 14, hard: 5 });
  assertEquals(targets(30, RULES), { easy: 6, intermediate: 18, hard: 6 });
  assertEquals(targets(40, RULES), { easy: 8, intermediate: 24, hard: 8 });
});

Deno.test("stratumOf: exact boundaries on six pooled cells", () => {
  assertEquals([0, 1, 2, 3, 4, 5, 6].map((s) => stratumOf(s, 6)), [
    "dead",
    "hard",
    "intermediate",
    "intermediate",
    "intermediate",
    "easy",
    "saturated",
  ]);
});

Deno.test("tally pools both arms; a pending cell makes the task incomplete, never a fail", () => {
  const t = tally([...six("HX-007", 4), ...incomplete("HX-008")], RULES);
  assertEquals(t.get("HX-007"), { solved: 4, scored: 6, complete: true });
  assertEquals(t.get("HX-008"), { solved: 0, scored: 5, complete: false });
  const sealed = new Set(["HX-007", "HX-008"]);
  const st = classify(
    S([C("HX-007"), C("HX-008")]),
    sealed,
    [],
    t,
    new Map([["HX-007", 1], ["HX-008", 1]]),
  );
  assertEquals(st.get("HX-007"), "intermediate");
  assertEquals(st.get("HX-008"), "incomplete");
  assertEquals(
    classify(S([C("HX-008")]), sealed, [], t, new Map([["HX-008", 2]])).get(
      "HX-008",
    ),
    "unscreenable",
  );
});

Deno.test("tally refuses a cell of a foreign arm", () => {
  assertThrows(
    () => tally([cell("HX-007", "cc-v2-mcp", 1, true)], RULES),
    ValidationError,
    "not a screening arm",
  );
});

Deno.test("classify: held-out, broken and unsealed win over any tally", () => {
  const done = { solved: 3, scored: 6, complete: true };
  const st = classify(
    S([
      C("HX-007"),
      C("HX-008", { broken: "decisions/x.md" }),
      C("HX-009"),
      C("HX-010"),
    ]),
    new Set(["HX-007", "HX-008", "HX-009"]),
    ["HX-007"],
    new Map([["HX-007", done], ["HX-008", done], ["HX-010", done]]),
    new Map(),
  );
  assertEquals([...st.values()], [
    "held_out",
    "broken",
    "unscreened",
    "unsealed",
  ]);
});

Deno.test("contaminationProblems: a screened held-out, unsealed or unknown task is refused", () => {
  const st = new Map<string, Status>([
    ["HX-007", "held_out"],
    ["HX-008", "unsealed"],
    ["HX-009", "intermediate"],
  ]);
  assertEquals(
    contaminationProblems(st, ["HX-007", "HX-008", "HX-009", "HX-099"]),
    [
      "HX-007 is held out but was screened",
      "HX-008 was screened before it was sealed",
      "HX-099 was screened but is not a registry candidate",
    ],
  );
});

Deno.test("screeningHistory: one rescreen of an incomplete task replaces its cells", () => {
  const h = screeningHistory([
    {
      id: "c2",
      experiment: "v2-screen-2",
      created_at: "2026-10-27T00:00:00Z",
      cells: six("HX-008", 3),
    },
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: "2026-10-25T00:00:00Z",
      cells: [...six("HX-007", 2), ...incomplete("HX-008")],
    },
  ], RULES);
  assertEquals(h.problems, []);
  assertEquals(h.screens, new Map([["HX-007", 1], ["HX-008", 2]]));
  assertEquals(tally(h.cells, RULES).get("HX-008")!.solved, 3);
});

Deno.test("screeningHistory: selective reruns are refused", () => {
  const at = (d: number) => `2026-10-2${d}T00:00:00Z`;
  const h = screeningHistory([
    {
      id: "c1",
      experiment: "v2-screen-1",
      created_at: at(1),
      cells: [...six("HX-007", 0), ...incomplete("HX-008")],
    },
    {
      id: "c2",
      experiment: "v2-screen-1",
      created_at: at(2),
      cells: six("HX-007", 3),
    },
    {
      id: "c3",
      experiment: "v2-screen-2",
      created_at: at(3),
      cells: incomplete("HX-008"),
    },
    {
      id: "c4",
      experiment: "v2-screen-3",
      created_at: at(4),
      cells: six("HX-008", 3),
    },
    { id: "c4", experiment: "v2-screen-4", created_at: at(5), cells: [] },
  ], RULES);
  assertEquals(h.problems, [
    "duplicate campaign id",
    "experiment v2-screen-1 has more than one campaign",
    "HX-007 rescreened in v2-screen-1 after a complete screen",
    "HX-008 screened 3 times (at most one rescreen)",
  ]);
});

Deno.test("ScreeningSchema refuses duplicate ids and an unknown supersedes", () => {
  assert(
    !ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [C("HX-007"), C("HX-007")],
    }).success,
  );
  assert(
    !ScreeningSchema.safeParse({
      v: 1,
      rules: RULES,
      candidates: [C("HX-008", { supersedes: "HX-099" })],
    }).success,
  );
});

const SEAL0: SealEntry = {
  tag: "harness-v2-screen-start",
  tag_object: "1".repeat(40),
  commit: "2".repeat(40),
  pushed_at: "2026-10-21T10:00:00Z",
  drand_chain: "c".repeat(64),
  drand_round: 100,
  round_time: "2026-10-21T10:10:30Z",
  randomness: "a".repeat(64),
  prev: "genesis",
};
const sealW4 = async (prev: SealEntry): Promise<SealEntry> => ({
  ...SEAL0,
  tag: "harness-v2-screen-w4",
  tag_object: "3".repeat(40),
  commit: "4".repeat(40),
  pushed_at: "2026-10-27T10:00:00Z",
  drand_round: 300,
  round_time: "2026-10-27T10:10:30Z",
  randomness: "b".repeat(64),
  prev: await entryHash(prev),
});

Deno.test("SealsSchema: the start seal comes first; randomness is 64 hex; ledger tags are not seals", () => {
  assert(SealsSchema.safeParse({ v: 2, seals: [SEAL0] }).success);
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [{ ...SEAL0, tag: "harness-v2-screen-w4" }],
    }).success,
  );
  assert(
    !SealsSchema.safeParse({ v: 2, seals: [{ ...SEAL0, randomness: "x" }] })
      .success,
  );
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [SEAL0, { ...SEAL0, tag: "harness-v2-screen-start-ledger" }],
    }).success,
  );
  assert(
    !SealsSchema.safeParse({
      v: 2,
      seals: [{ ...SEAL0, round_time: "2026-10-21T10:05:00Z" }],
    }).success,
    "the round must be at least 10 minutes after the push",
  );
  assertEquals(seedOf("abc", SEAL0.randomness), `abc:${SEAL0.randomness}`);
});

Deno.test("ledgerProblems: the seal ledger is append-only, hash-chained and anchored by its tags", async () => {
  const w4 = await sealW4(SEAL0);
  const anchors = (head: SealEntry[]) => ({
    refs: new Map(head.map((e) => [e.tag, { tag_object: e.tag_object, commit: e.commit }])),
    atSeal: new Map<string, SealEntry[] | null>([[SEAL0.tag, null], [w4.tag, [SEAL0]]]),
    atLedger: new Map<string, SealEntry[] | null>([[SEAL0.tag, [SEAL0]], [w4.tag, [SEAL0, w4]]]),
    published: new Map<string, SealEntry[] | null>([
      [`${SEAL0.tag}-ledger`, [SEAL0]],
      [`${w4.tag}-ledger`, [SEAL0, w4]],
    ]),
  });
  assertEquals(await ledgerProblems([SEAL0, w4], anchors([SEAL0, w4])), []);
  // Round 3: truncation. Both ledger tags are published, HEAD drops w4 to re-seal
  // its candidates under a new beacon. Must be refused.
  const p0 = await ledgerProblems([SEAL0], anchors([SEAL0, w4]));
  assert(p0.includes("harness-v2-screen-w4: published harness-v2-screen-w4-ledger but the HEAD ledger has no harness-v2-screen-w4 entry"), p0.join("\n"));
  assert(p0.includes("harness-v2-screen-w4-ledger: HEAD ledger does not extend the ledger committed at harness-v2-screen-w4-ledger"), p0.join("\n"));
  // An earlier entry rewritten at HEAD (randomness ground after the fact).
  const forged = { ...SEAL0, randomness: "f".repeat(64) };
  const p1 = await ledgerProblems([forged, w4], anchors([SEAL0, w4]));
  assert(p1.includes("harness-v2-screen-w4: prev does not hash the entry before it"), p1.join("\n"));
  assert(p1.includes("harness-v2-screen-start: entry differs from harness-v2-screen-start-ledger"), p1.join("\n"));
  // Rewritten AND re-chained: the ledger tags still hold the original bytes.
  const rechained = await sealW4(forged);
  const p2 = await ledgerProblems([forged, rechained], anchors([SEAL0, w4]));
  assert(p2.includes("harness-v2-screen-start: entry differs from harness-v2-screen-start-ledger"), p2.join("\n"));
  assert(p2.includes("harness-v2-screen-w4: ledger before it differs from the one committed at harness-v2-screen-w4"), p2.join("\n"));
  // A moved seal tag, and an entry without its ledger tag.
  const moved = anchors([SEAL0, w4]);
  moved.refs.set(w4.tag, { tag_object: w4.tag_object, commit: "9".repeat(40) });
  moved.atLedger.set(w4.tag, null);
  const p3 = await ledgerProblems([SEAL0, w4], moved);
  assert(p3.includes("harness-v2-screen-w4: tag does not resolve to the recorded tag object and commit"), p3.join("\n"));
  assert(p3.includes("harness-v2-screen-w4: no harness-v2-screen-w4-ledger tag"), p3.join("\n"));
});

Deno.test("chronologyProblems: a campaign created before its tasks' seal beacon is refused", () => {
  const first = new Map([["HX-007", SEAL0.round_time], ["HX-043", "2026-10-27T10:10:30Z"]]);
  assertEquals(
    chronologyProblems([{ id: "c1", created_at: "2026-10-25T08:00:00Z", tasks: ["HX-007"] }], first),
    [],
  );
  assertEquals(
    chronologyProblems([{ id: "c2", created_at: "2026-10-25T08:00:00Z", tasks: ["HX-007", "HX-043"] }], first),
    ["campaign c2 (2026-10-25T08:00:00Z) ran HX-043 before its seal beacon (2026-10-27T10:10:30Z)"],
  );
  assertEquals(
    chronologyProblems([{ id: "c3", created_at: "2026-10-25T08:00:00Z", tasks: ["HX-099"] }], first),
    ["campaign c3 ran HX-099, which no seal holds"],
  );
});

Deno.test("appendOnlyProblems: only appends and broken are allowed after a seal", () => {
  const sealed = S([C("HX-007"), C("HX-008")]);
  assertEquals(
    appendOnlyProblems(
      "harness-v2-screen-start",
      sealed,
      S([C("HX-007", { broken: "decisions/b.md" }), C("HX-008"), C("HX-009")]),
    ),
    [],
  );
  assertEquals(
    appendOnlyProblems(
      "harness-v2-screen-start",
      sealed,
      S([C("HX-007", { prior: "hard" })], { ...RULES, kind_min: 1 }),
    ),
    [
      "rules changed after harness-v2-screen-start",
      "HX-007 changed after harness-v2-screen-start (only broken may be set)",
      "HX-008 removed after harness-v2-screen-start",
    ],
  );
});

Deno.test("treeProblems and identityProblems bind tasks and campaigns to the sealed contents", () => {
  assertEquals(
    treeProblems(
      "harness-v2-screen-w4",
      new Map([["HX-043", "t1"], ["HX-044", "t2"]]),
      new Map([["HX-043", "t1"], ["HX-044", "t9"]]),
    ),
    ["HX-044 task folder changed after harness-v2-screen-w4"],
  );
  const id = (v: string) => ({
    id: "HX-007",
    refapp_commit: "c",
    visible: v.repeat(64),
    oracle: "b".repeat(64),
  });
  assertEquals(identityProblems("c1", [id("a")], [id("a")]), []);
  assertEquals(identityProblems("c1", [id("a")], [id("c")]), [
    "HX-007: campaign c1 ran other task contents",
  ]);
});

Deno.test("supersedeProblems: a redesign may replace only a dead, saturated or broken candidate", () => {
  const s = S([
    C("HX-007"),
    C("HX-008"),
    C("HX-009", { supersedes: "HX-007" }),
    C("HX-010", { supersedes: "HX-008" }),
  ]);
  const st = new Map<string, Status>([["HX-007", "dead"], [
    "HX-008",
    "intermediate",
  ]]);
  assertEquals(supersedeProblems(s, st), [
    "HX-010 supersedes HX-008, which is intermediate: only a dead, saturated or broken candidate may be redesigned",
  ]);
});

Deno.test("isLarge: objects and files together, or reuse, or traces", () => {
  const sz = (
    objects: number,
    files: number,
    reuse: string | null = null,
    traces: string | null = null,
  ) => isLarge(C("HX-007", { size: { objects, files, reuse, traces } }));
  assertEquals(
    [
      sz(3, 2),
      sz(3, 1),
      sz(2, 2),
      sz(1, 1, "CGR Date Mgt.WorkingDays"),
      sz(1, 1, null, "OnAfterVehicleReturned"),
    ],
    [true, false, false, true, true],
  );
});

Deno.test("ranks: deterministic per seed, different across seeds", async () => {
  const a = await ranks("seed-a", ["HX-007", "HX-008"]);
  assertEquals(a, await ranks("seed-a", ["HX-008", "HX-007"]));
  assert(a.get("HX-007") !== (await ranks("seed-b", ["HX-007"])).get("HX-007"));
  assertEquals(a.get("HX-007")!.length, 64);
});

Deno.test("pickHeldOut: first-ranked per kind when it meets the quotas; a missing kind is refused", () => {
  const m = (id: string, kind: Kind, coupling: string[] = []) => ({
    id,
    kind,
    coupling,
    large: true,
  });
  const meta = [
    m("HX-007", "feature"),
    m("HX-008", "feature", ["single-instance"]),
    m("HX-009", "bugfix", ["temporary-table"]),
    m("HX-010", "refactor", ["commit-behavior"]),
    m("HX-011", "test-authoring"),
  ];
  const rank = new Map([["HX-007", "b"], ["HX-008", "a"], ["HX-009", "c"], [
    "HX-010",
    "d",
  ], ["HX-011", "e"]]);
  assertEquals(pickHeldOut(meta, rank, RULES), [
    "HX-008",
    "HX-009",
    "HX-010",
    "HX-011",
  ]);
  assertThrows(
    () => pickHeldOut(meta.slice(0, 4), rank, RULES),
    ValidationError,
    "test-authoring",
  );
});

Deno.test("pickHeldOut: the odometer moves to the next-ranked set that meets size and every required coupling style", () => {
  const m = (
    id: string,
    kind: Kind,
    large: boolean,
    coupling: string[] = [],
  ) => ({ id, kind, coupling, large });
  const meta = [
    m("HX-007", "feature", false, ["single-instance"]),
    m("HX-008", "bugfix", false, ["commit-behavior"]),
    m("HX-009", "refactor", true, ["temporary-table"]),
    m("HX-010", "test-authoring", false),
    m("HX-011", "test-authoring", true),
  ];
  const rank = new Map(meta.map((x, i) => [x.id, String(i)]));
  assertEquals(pickHeldOut(meta, rank, RULES), [
    "HX-007",
    "HX-008",
    "HX-009",
    "HX-011",
  ]);
  assertThrows(
    () => pickHeldOut(meta.slice(0, 4), rank, RULES),
    ValidationError,
    "no held-out set meets the quotas",
  );
});

Deno.test("select: fills every stratum and quota, pinned ids", () => {
  const pool = basePool();
  const sel = select(pool, 10, RULES, rankOf(pool));
  assertEquals(sel.selected, [
    "HX-101",
    "HX-102",
    "HX-104",
    "HX-105",
    "HX-106",
    "HX-108",
    "HX-111",
    "HX-112",
    "HX-115",
    "HX-116",
  ]);
  assertEquals(sel.by_stratum.easy, ["HX-111", "HX-112"]);
  assertEquals(sel.by_stratum.hard, ["HX-115", "HX-116"]);
  assertEquals(sel.deviations, []);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: input order never changes the result", () => {
  const pool = basePool();
  const rank = rankOf(pool);
  assertEquals(
    select([...pool].reverse(), 10, RULES, rank),
    select(pool, 10, RULES, rank),
  );
});

Deno.test("select: the kind cap holds", () => {
  const pool = [
    ...["HX-201", "HX-202", "HX-203", "HX-204", "HX-205", "HX-206"].map((id) =>
      E(id, "intermediate", "feature")
    ),
    E("HX-207", "intermediate", "bugfix"),
    E("HX-208", "easy", "refactor"),
    E("HX-209", "hard", "refactor"),
  ];
  pool[0]!.coupling = ["single-instance"];
  assertEquals(select(pool, 5, loose(), rankOf(pool)).selected, [
    "HX-201",
    "HX-202",
    "HX-207",
    "HX-208",
    "HX-209",
  ]);
});

Deno.test("select: rank breaks a tie", () => {
  const rules = loose({ kind_max_share: 1 });
  const pool = [
    E("HX-301", "intermediate", "feature", { coupling: ["single-instance"] }),
    E("HX-302", "intermediate", "feature", { coupling: ["single-instance"] }),
  ];
  assertEquals(
    select(pool, 1, rules, new Map([["HX-301", "b"], ["HX-302", "a"]]))
      .selected,
    ["HX-302"],
  );
  assertEquals(
    select(pool, 1, rules, new Map([["HX-301", "a"], ["HX-302", "b"]]))
      .selected,
    ["HX-301"],
  );
});

Deno.test("select: a short stratum borrows from intermediate and records it", () => {
  const pool = [
    ...basePool().filter((e) => e.stratum === "intermediate"),
    E("HX-111", "easy", "feature"),
  ];
  const sel = select(pool, 5, loose(), rankOf(pool));
  assertEquals(sel.selected, [
    "HX-101",
    "HX-102",
    "HX-103",
    "HX-104",
    "HX-111",
  ]);
  assertEquals(sel.by_stratum.hard, ["HX-104"]);
  assertEquals(sel.deviations, [
    "HX-104 (intermediate) fills the hard stratum",
  ]);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: quotas are judged on the final set, after borrowing", () => {
  // Easy-large candidates exceed easy capacity, intermediate is empty,
  // hard-small fill hard; borrowing easy into intermediate meets "large".
  const rules = loose({ kind_max_share: 1, large_min_share: 0.5 });
  const pool = [
    E("HX-401", "easy", "feature", {
      large: true,
      coupling: ["single-instance"],
    }),
    E("HX-402", "easy", "feature", { large: true }),
    E("HX-403", "easy", "feature", { large: true }),
    E("HX-404", "easy", "feature", { large: true }),
    E("HX-405", "hard", "feature"),
    E("HX-406", "hard", "feature"),
  ];
  const sel = select(pool, 5, rules, rankOf(pool));
  assertEquals(sel.selected, [
    "HX-401",
    "HX-402",
    "HX-403",
    "HX-405",
    "HX-406",
  ]);
  assertEquals(sel.deviations, [
    "HX-406 (hard) fills the intermediate stratum",
    "HX-402 (easy) fills the intermediate stratum",
    "HX-403 (easy) fills the intermediate stratum",
  ]);
  assertEquals(sel.shortfalls, []);
});

Deno.test("select: too few candidates is a shortfall, never a smaller set reported as ok", () => {
  const pool = basePool().slice(0, 5);
  const sel = select(pool, 10, RULES, rankOf(pool));
  assert(sel.shortfalls.some((s) => s.startsWith("stratum intermediate")));
  assert(sel.shortfalls.includes("coupling commit-behavior: 0 of 1"));
  assert(sel.selected.length < 10);
});

Deno.test("tasksGlob: exact ids", () => {
  assertEquals(
    tasksGlob(["HX-009", "HX-007"]),
    "harness-tasks/tasks/{HX-007,HX-009}",
  );
  assertEquals(tasksGlob(["HX-007"]), "harness-tasks/tasks/HX-007");
});
```

- [ ] **Step 2: Run to verify failure.** `deno test --allow-all tests/unit/harness/screening.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Rules file** `harness-tasks/v2/screening.yml`:

```yaml
# Task set v2 screening registry (spec 2026-10-03-harness-v2-design.md section 3, section 12
# finding 2; protocol in scripts/harness/screening.ts and plan 2026-10-03-harness-v2-m8-task-set.md).
# rules: frozen at the first seal (tag harness-v2-screen-start).
# candidates: appended by lane-content with each task. Once a seal holds an entry, the entry is
# fixed (only `broken` may be set) and its task folder never changes.
# The 0/6 and 6/6 filter is a screen, not proof of intermediate difficulty; screening on the two
# diagonal arms selects a population, and every claim is scoped to it.
v: 1
rules:
  arms: [cc-v2-plain, cc-v2-realistic-lsp]
  repeats: 3
  easy_share: 0.2
  hard_share: 0.2
  kind_min: 2
  kind_max_share: 0.4
  required_coupling: [single-instance, temporary-table, commit-behavior]
  coupling_min: 1
  large_min_share: 0.5
  borrow:
    easy: [intermediate]
    intermediate: [hard, easy]
    hard: [intermediate]
candidates: []
```

- [ ] **Step 4: Write `scripts/harness/screening.ts`:**

```typescript
// Task set v2 screening (spec 2026-10-03-harness-v2-design.md sections 3
// and 12 finding 2): candidate registry, seals, held-out pick, screening
// history, pilot tally, strata and the pre-specified selection.
// Owner: lane-infra.
//
// Nothing here reads an arm difference: a tally pools both arms, and select()
// sees only stratum, kind, coupling and size.

import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { z } from "zod";
import type { TaskIdentity } from "../../src/harness/identity.ts";
import type { JudgmentRecord } from "../../src/harness/records.ts";
import type { Cell } from "../../src/harness/stats.ts";
import { ValidationError } from "../../src/errors.ts";
import { loadCampaignData } from "../../src/harness/campaign.ts";
import { hashJson, sha256Hex } from "../../src/harness/hash.ts";
import {
  loadSymbolsLock,
  taskSetIdentity,
} from "../../src/harness/identity.ts";
import { validateCampaignRecords } from "../../src/harness/integrity.ts";
import { cellsFromRecords } from "../../src/harness/outcome.ts";
import {
  CampaignRecordSchema,
  RecordStore,
} from "../../src/harness/records.ts";
import {
  HarnessTaskSchema,
  loadTask,
  TASK_KINDS,
} from "../../src/harness/task.ts";

export type Kind = (typeof TASK_KINDS)[number];
export const STRATA = ["easy", "intermediate", "hard"] as const;
export type Stratum = (typeof STRATA)[number];
export type Status =
  | Stratum
  | "dead"
  | "saturated"
  | "broken"
  | "incomplete"
  | "unscreenable"
  | "unscreened"
  | "unsealed"
  | "held_out";

export const REGISTRY_PATH = "harness-tasks/v2/screening.yml";
export const SEALS_PATH = "harness-tasks/v2/seals.yml";
export const START_TAG = "harness-v2-screen-start";
export const SCREEN_PREFIX = "v2-screen-";

const taskId = z.string().regex(/^HX-\d{3}$/, "must look like HX-007");
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase slug");

export const RulesSchema = z.strictObject({
  /** The two screening arms (plain, realistic+LSP); order is irrelevant. */
  arms: z.tuple([slug, slug]),
  repeats: z.number().int().positive(),
  easy_share: z.number().min(0).max(1),
  hard_share: z.number().min(0).max(1),
  kind_min: z.number().int().min(0),
  kind_max_share: z.number().gt(0).max(1),
  required_coupling: z.array(z.string().min(1)).min(1),
  coupling_min: z.number().int().min(1),
  large_min_share: z.number().min(0).max(1),
  /** Strata a short stratum borrows from, in order. */
  borrow: z.strictObject({
    easy: z.array(z.enum(STRATA)),
    intermediate: z.array(z.enum(STRATA)),
    hard: z.array(z.enum(STRATA)),
  }),
});
export type Rules = z.output<typeof RulesSchema>;

export const CandidateSchema = z.strictObject({
  id: taskId,
  /** Author's difficulty prior, recorded before any pilot outcome. */
  prior: z.enum(STRATA),
  size: z.strictObject({
    objects: z.number().int().min(1),
    files: z.number().int().min(1),
    /** "<Object>.<Procedure>" the solution must find and reuse, or null. */
    reuse: z.string().min(1).nullable(),
    /** Event or interface the agent must follow through the refapp, or null. */
    traces: z.string().min(1).nullable(),
  }),
  /** A dropped candidate this one redesigns (new id, fresh screening). */
  supersedes: taskId.nullable().default(null),
  /** Decision file confirming a broken oracle: the one field set after sealing. */
  broken: z.string().min(1).nullable().default(null),
});
export type Candidate = z.output<typeof CandidateSchema>;

export const ScreeningSchema = z.strictObject({
  v: z.literal(1),
  rules: RulesSchema,
  candidates: z.array(CandidateSchema).default([]),
}).superRefine((s, ctx) => {
  const ids = s.candidates.map((c) => c.id);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  if (dup.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `duplicate candidate ${dup.join(", ")}`,
      path: ["candidates"],
    });
  }
  for (const c of s.candidates) {
    if (c.supersedes !== null && !ids.includes(c.supersedes)) {
      ctx.addIssue({
        code: "custom",
        message: `${c.id} supersedes unknown ${c.supersedes}`,
        path: ["candidates"],
      });
    }
  }
});
export type Screening = z.output<typeof ScreeningSchema>;

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));

/**
 * One ledger entry per seal (appendix section 9): the seal tag as published
 * (tag object, commit, push time), the drand chain and round fixed by rule
 * AFTER the push, its randomness, and the hash of the previous entry.
 * Appended, never edited; the first is START_TAG.
 */
export const SealEntrySchema = z.strictObject({
  tag: z.string().regex(/^harness-v2-screen-[a-z0-9-]+$/)
    .refine((t) => !t.endsWith("-ledger"), "a -ledger tag is not a seal"),
  tag_object: hex(40),
  commit: hex(40),
  pushed_at: z.iso.datetime(),
  drand_chain: hex(64),
  drand_round: z.number().int().positive(),
  round_time: z.iso.datetime(),
  randomness: hex(64),
  prev: z.union([z.literal("genesis"), hex(64)]),
}).refine(
  (e) => Date.parse(e.round_time) >= Date.parse(e.pushed_at) + 600_000,
  "the drand round must be at least 10 minutes after the push",
);
export type SealEntry = z.output<typeof SealEntrySchema>;

export const SealsSchema = z.strictObject({
  v: z.literal(2),
  seals: z.array(SealEntrySchema).min(1),
}).superRefine((s, ctx) => {
  if (s.seals[0]!.tag !== START_TAG) {
    ctx.addIssue({
      code: "custom",
      message: `first seal must be ${START_TAG}`,
      path: ["seals"],
    });
  }
  const tags = s.seals.map((x) => x.tag);
  if (new Set(tags).size !== tags.length) {
    ctx.addIssue({
      code: "custom",
      message: "duplicate seal",
      path: ["seals"],
    });
  }
});
export type Seals = z.output<typeof SealsSchema>;

/** Rank seed of a seal: the sealed commit plus the beacon drawn after it. */
export const seedOf = (commit: string, randomness: string): string =>
  `${commit}:${randomness}`;

/** Chain link: the next entry's `prev` (appendix section 9). */
export const entryHash = (e: SealEntry): Promise<string> =>
  hashJson({ seal_entry: e });

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** What the repository says about each seal, read by loadLedgerAnchors. */
export interface LedgerAnchors {
  /** `git rev-parse <tag>` and `<tag>^{commit}`; absent when the tag is missing. */
  refs: Map<string, { tag_object: string; commit: string }>;
  /** seals.yml entries at the seal tag's commit; null when the file is absent there. */
  atSeal: Map<string, SealEntry[] | null>;
  /** seals.yml entries at `<tag>-ledger`; null when that tag is missing. */
  atLedger: Map<string, SealEntry[] | null>;
  /**
   * Round 3: every `harness-v2-screen-*-ledger` tag found on origin or locally,
   * discovered independently of HEAD, mapped to seals.yml at that tag (null if absent).
   */
  published: Map<string, SealEntry[] | null>;
}

/**
 * The ledger at HEAD is append-only and anchored (round 2 finding 3): each
 * entry hashes its predecessor; each seal tag still names the recorded tag
 * object and commit; the ledger committed at the seal tag holds exactly the
 * entries before it; the ledger committed at its -ledger tag holds this
 * entry byte for byte. Rewriting, re-chaining or reordering any entry, or
 * moving any tag, is reported.
 */
export async function ledgerProblems(
  head: SealEntry[],
  a: LedgerAnchors,
): Promise<string[]> {
  const out: string[] = [];
  for (const [i, e] of head.entries()) {
    const prev = i === 0 ? "genesis" : await entryHash(head[i - 1]!);
    if (e.prev !== prev) {
      out.push(`${e.tag}: prev does not hash the entry before it`);
    }
    const r = a.refs.get(e.tag);
    if (!r || r.tag_object !== e.tag_object || r.commit !== e.commit) {
      out.push(`${e.tag}: tag does not resolve to the recorded tag object and commit`);
    }
    const before = a.atSeal.get(e.tag) ?? null;
    if (
      i === 0 ? before !== null && before.length > 0 : !sameJson(before, head.slice(0, i))
    ) {
      out.push(`${e.tag}: ledger before it differs from the one committed at ${e.tag}`);
    }
    const led = a.atLedger.get(e.tag) ?? null;
    if (led === null) out.push(`${e.tag}: no ${e.tag}-ledger tag`);
    else if (led.length !== i + 1 || !sameJson(led[i], e)) {
      out.push(`${e.tag}: entry differs from ${e.tag}-ledger`);
    }
  }
  // Round 3 (orchestrator): anchors are discovered independently of HEAD, so a
  // truncated ledger (a published seal dropped to re-seal under a new beacon) is
  // refused. Every published `<seal>-ledger` tag must be a prefix of HEAD.
  for (const [ledgerTag, led] of a.published) {
    const seal = ledgerTag.replace(/-ledger$/, "");
    if (!head.some((e) => e.tag === seal)) {
      out.push(`${seal}: published ${ledgerTag} but the HEAD ledger has no ${seal} entry`);
    }
    if (led === null || !sameJson(led, head.slice(0, led.length))) {
      out.push(`${ledgerTag}: HEAD ledger does not extend the ledger committed at ${ledgerTag}`);
    }
  }
  return out;
}

/**
 * A screening campaign may run a task only after the beacon round of the
 * seal that first sealed it (publication before screening, round 2 finding 3).
 */
export function chronologyProblems(
  campaigns: { id: string; created_at: string; tasks: string[] }[],
  firstRoundTime: Map<string, string>,
): string[] {
  return campaigns.flatMap((c) =>
    c.tasks.flatMap((t) => {
      const at = firstRoundTime.get(t);
      if (at === undefined) return [`campaign ${c.id} ran ${t}, which no seal holds`];
      return Date.parse(c.created_at) > Date.parse(at) ? [] : [
        `campaign ${c.id} (${c.created_at}) ran ${t} before its seal beacon (${at})`,
      ];
    })
  );
}

/** Spec section 3 quota 1, size clause. */
export const isLarge = (c: Candidate): boolean =>
  (c.size.objects >= 3 && c.size.files >= 2) || c.size.reuse !== null ||
  c.size.traces !== null;

/** Problems when `now` is not an append-only extension of the registry at seal `tag`. */
export function appendOnlyProblems(
  tag: string,
  sealed: Screening,
  now: Screening,
): string[] {
  const out: string[] = [];
  if (JSON.stringify(sealed.rules) !== JSON.stringify(now.rules)) {
    out.push(`rules changed after ${tag}`);
  }
  const byId = new Map(now.candidates.map((c) => [c.id, c]));
  for (const c of sealed.candidates) {
    const n = byId.get(c.id);
    if (!n) {
      out.push(`${c.id} removed after ${tag}`);
    } else if (
      JSON.stringify({ ...n, broken: null }) !==
        JSON.stringify({ ...c, broken: null })
    ) {
      out.push(`${c.id} changed after ${tag} (only broken may be set)`);
    }
  }
  return out;
}

/** Every task folder sealed at `tag` must have the same git tree now. */
export function treeProblems(
  tag: string,
  sealed: Map<string, string>,
  now: Map<string, string>,
): string[] {
  return [...sealed].filter(([id, tree]) => now.get(id) !== tree)
    .map(([id]) => `${id} task folder changed after ${tag}`);
}

/** A campaign ran exactly the current (sealed) task contents. */
export function identityProblems(
  campaign: string,
  ran: TaskIdentity[],
  current: TaskIdentity[],
): string[] {
  const cur = new Map(current.map((t) => [t.id, t]));
  return ran.flatMap((t) => {
    const c = cur.get(t.id);
    return c && c.visible === t.visible && c.oracle === t.oracle
      ? []
      : [`${t.id}: campaign ${campaign} ran other task contents`];
  });
}

const enc = new TextEncoder();

/** Rank key per id: sha256("<seed>:<id>"), compared as hex strings. */
export async function ranks(
  seed: string,
  ids: string[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const id of ids) m.set(id, await sha256Hex(enc.encode(`${seed}:${id}`)));
  return m;
}

function byRank(rank: Map<string, string>) {
  return (a: string, b: string): number => {
    const ra = rank.get(a), rb = rank.get(b);
    if (ra === undefined || rb === undefined) {
      throw new ValidationError(`no rank for ${ra === undefined ? a : b}`, [
        a,
        b,
      ]);
    }
    return ra < rb ? -1 : ra > rb ? 1 : a.localeCompare(b);
  };
}

export interface TaskMeta {
  id: string;
  kind: Kind;
  coupling: string[];
  large: boolean;
}

/**
 * One held-out task per kind (task.ts order). Combinations are tried in
 * rank order (an odometer over each kind's ranked list, the last kind
 * turning fastest); the first one with at least ceil(4 * large_min_share)
 * large tasks and every required coupling style wins (spec 3 item 4: the
 * held-out tasks follow the same quotas).
 */
export function pickHeldOut(
  meta: TaskMeta[],
  rank: Map<string, string>,
  rules: Rules,
): string[] {
  const lists = TASK_KINDS.map((k) => {
    const l = meta.filter((m) => m.kind === k)
      .sort((a, b) => byRank(rank)(a.id, b.id));
    if (l.length === 0) {
      throw new ValidationError(`no ${k} candidate for the held-out set`, [k]);
    }
    return l;
  });
  const largeMin = Math.ceil(lists.length * rules.large_min_share);
  const idx = lists.map(() => 0);
  for (;;) {
    const set = idx.map((i, k) => lists[k]![i]!);
    if (
      set.filter((m) => m.large).length >= largeMin &&
      rules.required_coupling.every((c) =>
        set.some((m) => m.coupling.includes(c))
      )
    ) {
      return set.map((m) => m.id);
    }
    let k = idx.length - 1;
    while (k >= 0 && ++idx[k]! === lists[k]!.length) idx[k--] = 0;
    if (k < 0) {
      throw new ValidationError("no held-out set meets the quotas", [
        "held_out",
      ]);
    }
  }
}

export interface Tally {
  solved: number;
  scored: number;
  complete: boolean;
}

/** Pooled solved/scored per task over both arms, repeats 1..rules.repeats. */
export function tally(cells: Cell[], rules: Rules): Map<string, Tally> {
  const out = new Map<string, Tally>();
  for (const c of cells) {
    if (!rules.arms.includes(c.arm)) {
      throw new ValidationError(
        `cell ${c.task}/${c.repeat}/${c.arm}: arm is not a screening arm`,
        [c.arm],
      );
    }
    const t = out.get(c.task) ?? { solved: 0, scored: 0, complete: false };
    if (c.status === "scored" && c.repeat <= rules.repeats) {
      t.scored++;
      if (c.pass) t.solved++;
    }
    out.set(c.task, t);
  }
  const want = rules.arms.length * rules.repeats;
  for (const t of out.values()) t.complete = t.scored === want;
  return out;
}

export interface ScreenCampaign {
  id: string;
  experiment: string;
  created_at: string;
  cells: Cell[];
}

/**
 * Every screening campaign, oldest first. One campaign per experiment, no
 * duplicate ids. A task may be screened again only while its previous screen
 * is incomplete, and at most twice; the newest screen replaces all its cells.
 */
export function screeningHistory(
  campaigns: ScreenCampaign[],
  rules: Rules,
): { cells: Cell[]; screens: Map<string, number>; problems: string[] } {
  const problems: string[] = [];
  const ids = campaigns.map((c) => c.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate campaign id");
  const exps = campaigns.map((c) => c.experiment);
  for (const x of new Set(exps.filter((e, i) => exps.indexOf(e) !== i))) {
    problems.push(`experiment ${x} has more than one campaign`);
  }
  const latest = new Map<string, Cell[]>();
  const screens = new Map<string, number>();
  const order = [...campaigns].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
  for (const c of order) {
    for (const t of new Set(c.cells.map((x) => x.task))) {
      const prev = latest.get(t);
      if (prev && tally(prev, rules).get(t)!.complete) {
        problems.push(
          `${t} rescreened in ${c.experiment} after a complete screen`,
        );
      }
      const n = (screens.get(t) ?? 0) + 1;
      if (n > 2) {
        problems.push(`${t} screened ${n} times (at most one rescreen)`);
      }
      screens.set(t, n);
      latest.set(t, c.cells.filter((x) => x.task === t));
    }
  }
  return { cells: [...latest.values()].flat(), screens, problems };
}

/** Stratum boundaries on the pooled count of `total` scored cells. */
export function stratumOf(
  solved: number,
  total: number,
): Stratum | "dead" | "saturated" {
  if (solved === 0) return "dead";
  if (solved === total) return "saturated";
  if (solved === total - 1) return "easy";
  if (solved === 1) return "hard";
  return "intermediate";
}

export function classify(
  s: Screening,
  sealed: Set<string>,
  heldOut: string[],
  tallies: Map<string, Tally>,
  screens: Map<string, number>,
): Map<string, Status> {
  const total = s.rules.arms.length * s.rules.repeats;
  const status = new Map<string, Status>();
  for (const c of s.candidates) {
    const t = tallies.get(c.id);
    status.set(
      c.id,
      heldOut.includes(c.id)
        ? "held_out"
        : c.broken !== null
        ? "broken"
        : !sealed.has(c.id)
        ? "unsealed"
        : !t
        ? "unscreened"
        : !t.complete
        ? ((screens.get(c.id) ?? 0) >= 2 ? "unscreenable" : "incomplete")
        : stratumOf(t.solved, total),
    );
  }
  return status;
}

/** A held-out task, or a task never sealed, must have no pilot cell. */
export function contaminationProblems(
  status: Map<string, Status>,
  screened: Iterable<string>,
): string[] {
  return [...screened].flatMap((t) => {
    const s = status.get(t);
    return s === undefined
      ? [`${t} was screened but is not a registry candidate`]
      : s === "held_out"
      ? [`${t} is held out but was screened`]
      : s === "unsealed"
      ? [`${t} was screened before it was sealed`]
      : [];
  });
}

const REDESIGNABLE = new Set<Status>(["dead", "saturated", "broken"]);

/** Only a dropped candidate may be redesigned (round 2 finding 2). */
export function supersedeProblems(
  s: Screening,
  status: Map<string, Status>,
): string[] {
  return s.candidates.flatMap((c) => {
    if (c.supersedes === null) return [];
    const st = status.get(c.supersedes);
    return st !== undefined && REDESIGNABLE.has(st) ? [] : [
      `${c.id} supersedes ${c.supersedes}, which is ${st}: only a dead, saturated or broken candidate may be redesigned`,
    ];
  });
}

export interface Eligible {
  id: string;
  stratum: Stratum;
  kind: Kind;
  coupling: string[];
  large: boolean;
}

export interface Selection {
  n: number;
  targets: Record<Stratum, number>;
  selected: string[];
  by_stratum: Record<Stratum, string[]>;
  deviations: string[];
  shortfalls: string[];
}

/** Stratum sizes for n: easy and hard rounded half up, the rest intermediate. */
export function targets(n: number, r: Rules): Record<Stratum, number> {
  const easy = Math.round(r.easy_share * n);
  const hard = Math.round(r.hard_share * n);
  return { easy, intermediate: n - easy - hard, hard };
}

/**
 * The pre-specified greedy selection. Candidates are visited in rank order;
 * phases: kind minimum, required coupling styles, size share, fill, then a
 * short stratum borrows from its listed strata. A candidate fits while its
 * stratum and its kind (cap floor(kind_max_share * n)) have room. Every
 * quota is evaluated once, on the final selection.
 * ponytail: greedy, not exhaustive; a shortfall it reports may have a
 * feasible combination. Pre-registered as is; the too-few rule handles it.
 */
export function select(
  pool: Eligible[],
  n: number,
  r: Rules,
  rank: Map<string, string>,
): Selection {
  const target = targets(n, r);
  const kindMax = Math.floor(r.kind_max_share * n);
  const largeMin = Math.ceil(r.large_min_share * n);
  const order = [...pool].sort((a, b) => byRank(rank)(a.id, b.id));
  const chosen: Eligible[] = [];
  const slot = new Map<string, Stratum>();
  const deviations: string[] = [];
  const count = (f: (e: Eligible) => boolean) => chosen.filter(f).length;
  const inStratum = (s: Stratum) => count((e) => slot.get(e.id) === s);
  const kindRoom = (e: Eligible) => count((x) => x.kind === e.kind) < kindMax;
  const fits = (e: Eligible) =>
    !chosen.includes(e) && kindRoom(e) &&
    inStratum(e.stratum) < target[e.stratum];
  const add = (e: Eligible, s: Stratum) => {
    chosen.push(e);
    slot.set(e.id, s);
  };
  const fill = (need: () => boolean, pred: (e: Eligible) => boolean) => {
    while (need()) {
      const e = order.find((x) => fits(x) && pred(x));
      if (!e) return;
      add(e, e.stratum);
    }
  };
  const quotas: [string, (e: Eligible) => boolean, number][] = [
    ...TASK_KINDS.map((k): [string, (e: Eligible) => boolean, number] => [
      `kind ${k}`,
      (e) => e.kind === k,
      r.kind_min,
    ]),
    ...r.required_coupling.map((
      s,
    ): [string, (e: Eligible) => boolean, number] => [
      `coupling ${s}`,
      (e) => e.coupling.includes(s),
      r.coupling_min,
    ]),
    ["large", (e) => e.large, largeMin],
  ];
  for (const [, pred, min] of quotas) fill(() => count(pred) < min, pred);
  fill(() => chosen.length < n, () => true);
  for (const s of STRATA) {
    for (const from of r.borrow[s]) {
      while (inStratum(s) < target[s]) {
        const e = order.find((x) =>
          !chosen.includes(x) && x.stratum === from && kindRoom(x)
        );
        if (!e) break;
        add(e, s);
        deviations.push(`${e.id} (${from}) fills the ${s} stratum`);
      }
    }
  }
  const shortfalls = [
    ...quotas.filter(([, pred, min]) => count(pred) < min)
      .map(([what, pred, min]) => `${what}: ${count(pred)} of ${min}`),
    ...STRATA.filter((s) => inStratum(s) < target[s])
      .map((s) => `stratum ${s}: ${inStratum(s)} of ${target[s]}`),
  ];
  const ids = (f: (e: Eligible) => boolean) =>
    chosen.filter(f).map((e) => e.id).sort();
  return {
    n,
    targets: target,
    selected: ids(() => true),
    by_stratum: {
      easy: ids((e) => slot.get(e.id) === "easy"),
      intermediate: ids((e) => slot.get(e.id) === "intermediate"),
      hard: ids((e) => slot.get(e.id) === "hard"),
    },
    deviations,
    shortfalls,
  };
}

/** `tasks:` glob of an experiment that runs exactly these ids. */
export const tasksGlob = (ids: string[]): string =>
  ids.length === 1
    ? `harness-tasks/tasks/${ids[0]}`
    : `harness-tasks/tasks/{${[...ids].sort().join(",")}}`;

// ---- I/O ----

async function git(root: string, args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new ValidationError(
      `git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr).trim()}`,
      args,
    );
  }
  return new TextDecoder().decode(out.stdout);
}

export const commitOf = async (root: string, rev: string): Promise<string> =>
  (await git(root, ["rev-parse", "--verify", `${rev}^{commit}`])).trim();

async function yamlAt<T extends z.ZodType>(
  root: string,
  rev: string,
  path: string,
  schema: T,
): Promise<z.output<T>> {
  const r = schema.safeParse(
    parse(await git(root, ["show", `${rev}:${path}`])),
  );
  if (!r.success) {
    const errors = r.error.issues.map((i) =>
      `${i.path.join(".")}: ${i.message}`
    );
    throw new ValidationError(
      `${path} at ${rev}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return r.data;
}

/** Tree id of every task folder at `rev`. */
export async function treesAt(
  root: string,
  rev: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (
    const line of (await git(root, ["ls-tree", rev, "harness-tasks/tasks/"]))
      .split("\n")
  ) {
    const m = line.match(
      /^040000 tree ([0-9a-f]+)\tharness-tasks\/tasks\/(HX-\d{3})$/,
    );
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}

/** kind, coupling and size of each candidate at `rev`. */
export async function metaAt(
  root: string,
  rev: string,
  s: Screening,
  ids: string[],
): Promise<TaskMeta[]> {
  const out: TaskMeta[] = [];
  for (const id of ids) {
    const t = HarnessTaskSchema.parse(
      parse(
        await git(root, ["show", `${rev}:harness-tasks/tasks/${id}/task.yml`]),
      ),
    );
    const c = s.candidates.find((x) => x.id === id)!;
    out.push({ id, kind: t.kind, coupling: t.coupling, large: isLarge(c) });
  }
  return out;
}

export interface SealState {
  tag: string;
  commit: string;
  seed: string;
  round_time: string;
  screening: Screening;
  trees: Map<string, string>;
}

async function tryGit(root: string, args: string[]): Promise<string | null> {
  try {
    return (await git(root, args)).trim();
  } catch (err) {
    if (err instanceof ValidationError) return null;
    throw err;
  }
}

/** Tag resolutions and the ledger as committed at each seal tag and -ledger tag. */
export async function loadLedgerAnchors(
  root: string,
  head: SealEntry[],
): Promise<LedgerAnchors> {
  const a: LedgerAnchors = { refs: new Map(), atSeal: new Map(), atLedger: new Map(), published: new Map() };
  const ledgerAt = async (rev: string): Promise<SealEntry[] | null> => {
    const text = await tryGit(root, ["show", `${rev}:${SEALS_PATH}`]);
    return text === null ? null : SealsSchema.parse(parse(text)).seals;
  };
  // Independent of HEAD: every ledger tag on origin AND locally (union). A tag on
  // origin that is missing locally is fetched first (`git fetch origin tag <t>`);
  // if origin cannot be reached the check throws (never treated as "no tags").
  const remote = await git(root, ["ls-remote", "--tags", "origin", "refs/tags/harness-v2-screen-*-ledger"]);
  const local = (await git(root, ["tag", "-l", "harness-v2-screen-*-ledger"])).split("\n");
  const names = new Set([
    ...remote.split("\n").map((l) => l.split("refs/tags/")[1]?.replace(/\^\{\}$/, "")),
    ...local,
  ].filter((t): t is string => !!t && t.endsWith("-ledger")));
  for (const t of [...names].sort()) {
    if (await tryGit(root, ["rev-parse", "--verify", `refs/tags/${t}`]) === null) {
      await git(root, ["fetch", "origin", "tag", t, "--no-tags"]);
    }
    const c = await tryGit(root, ["rev-parse", "--verify", `${t}^{commit}`]);
    a.published.set(t, c === null ? null : await ledgerAt(c));
  }
  for (const e of head) {
    const obj = await tryGit(root, ["rev-parse", "--verify", `refs/tags/${e.tag}`]);
    const commit = await tryGit(root, ["rev-parse", "--verify", `${e.tag}^{commit}`]);
    if (obj !== null && commit !== null) a.refs.set(e.tag, { tag_object: obj, commit });
    a.atSeal.set(e.tag, commit === null ? null : await ledgerAt(commit));
    const led = await tryGit(root, ["rev-parse", "--verify", `${e.tag}-ledger^{commit}`]);
    a.atLedger.set(e.tag, led === null ? null : await ledgerAt(led));
  }
  return a;
}

/** Every seal of the HEAD ledger, plus every ledger problem (never trusted unverified). */
export async function loadSeals(
  root: string,
): Promise<{ seals: SealState[]; problems: string[] }> {
  const ledger = (await yamlAt(root, "HEAD", SEALS_PATH, SealsSchema)).seals;
  const problems = await ledgerProblems(
    ledger,
    await loadLedgerAnchors(root, ledger),
  );
  const out: SealState[] = [];
  for (const s of ledger) {
    // The recorded commit; ledgerProblems reports it when the tag disagrees.
    const commit = s.commit;
    const screening = await yamlAt(
      root,
      commit,
      REGISTRY_PATH,
      ScreeningSchema,
    );
    const all = await treesAt(root, commit);
    out.push({
      tag: s.tag,
      commit,
      seed: seedOf(commit, s.randomness),
      round_time: s.round_time,
      screening,
      trees: new Map(
        screening.candidates.map((c) => [c.id, all.get(c.id) ?? "(missing)"]),
      ),
    });
  }
  return { seals: out, problems };
}

/** Every campaign of every v2-screen-* experiment, with cells and the identities it ran. */
export async function loadScreenCampaigns(
  resultsDir: string,
  rules: Rules,
): Promise<{ campaigns: ScreenCampaign[]; ran: Map<string, TaskIdentity[]> }> {
  const store = new RecordStore(resultsDir);
  const campaigns: ScreenCampaign[] = [];
  const ran = new Map<string, TaskIdentity[]>();
  const dir = join(resultsDir, "campaigns");
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".json")) continue;
    const c = CampaignRecordSchema.parse(
      JSON.parse(await Deno.readTextFile(join(dir, e.name))),
    );
    if (!c.experiment.id.startsWith(SCREEN_PREFIX)) continue;
    const arms = [c.experiment.baseline, ...c.experiment.variants].sort();
    if (
      arms.join() !== [...rules.arms].sort().join() ||
      c.experiment.repeats !== rules.repeats
    ) {
      throw new ValidationError(
        `campaign ${c.id} (${c.experiment.id}) does not run the screening arms x ${rules.repeats}`,
        [c.id],
      );
    }
    const data = await loadCampaignData(store, c);
    await validateCampaignRecords(data);
    const byExecution = new Map<string, JudgmentRecord[]>();
    for (const j of data.judgments) {
      byExecution.set(j.execution_id, [
        ...(byExecution.get(j.execution_id) ?? []),
        j,
      ]);
    }
    campaigns.push({
      id: c.id,
      experiment: c.experiment.id,
      created_at: c.created_at,
      cells: cellsFromRecords(c, data.executions, byExecution),
    });
    ran.set(c.id, c.task_set.tasks);
  }
  return { campaigns, ran };
}

async function main(): Promise<number> {
  const a = parseArgs(Deno.args, {
    string: ["results-dir", "out", "n"],
    default: {
      "results-dir": "results/harness",
      out: "harness-tasks/v2/selection.json",
    },
  });
  const cmd = String(a._[0] ?? "");
  const root = Deno.cwd();
  if (
    (await git(root, ["status", "--porcelain", "--", "harness-tasks"])).trim()
  ) {
    console.error(colors.red("[FAIL] harness-tasks has uncommitted changes"));
    return 1;
  }
  const { seals, problems: ledgerIssues } = await loadSeals(root);
  if (ledgerIssues.length > 0) {
    for (const p of ledgerIssues) console.error(colors.red(`[FAIL] ${p}`));
    return 1;
  }
  const start = seals[0]!;
  const startIds = start.screening.candidates.map((c) => c.id);
  const heldOut = pickHeldOut(
    await metaAt(root, start.commit, start.screening, startIds),
    await ranks(start.seed, startIds),
    start.screening.rules,
  ).sort();
  if (cmd === "heldout") {
    console.log(`held_out: ${heldOut.join(", ")}`);
    console.log(
      `tasks: "${tasksGlob(startIds.filter((id) => !heldOut.includes(id)))}"`,
    );
    return 0;
  }
  if (cmd !== "status" && cmd !== "select") {
    console.error("usage: screening.ts heldout | status | select --n <N>");
    return 1;
  }
  const head = await commitOf(root, "HEAD");
  const now = await yamlAt(root, head, REGISTRY_PATH, ScreeningSchema);
  const headTrees = await treesAt(root, head);
  // The seal where each candidate first appears fixes its metadata and seed.
  const firstSeal = new Map<string, SealState>();
  for (const s of seals) {
    for (const c of s.screening.candidates) {
      if (!firstSeal.has(c.id)) firstSeal.set(c.id, s);
    }
  }
  const sealedIds = [...firstSeal.keys()];
  const current = await taskSetIdentity(
    root,
    await Promise.all(
      sealedIds.map((id) => loadTask(join(root, "harness-tasks", "tasks", id))),
    ),
    await loadSymbolsLock(root),
  );
  const { campaigns, ran } = await loadScreenCampaigns(
    a["results-dir"],
    now.rules,
  );
  const hist = screeningHistory(campaigns, now.rules);
  const tallies = tally(hist.cells, now.rules);
  const status = classify(
    now,
    new Set(sealedIds),
    heldOut,
    tallies,
    hist.screens,
  );
  const problems = [
    ...seals.flatMap((s) => [
      ...appendOnlyProblems(s.tag, s.screening, now),
      ...treeProblems(s.tag, s.trees, headTrees),
    ]),
    ...[...ran].flatMap(([id, t]) => identityProblems(id, t, current.tasks)),
    ...chronologyProblems(
      campaigns.map((c) => ({
        id: c.id,
        created_at: c.created_at,
        tasks: (ran.get(c.id) ?? []).map((t) => t.id),
      })),
      new Map([...firstSeal].map(([id, s]) => [id, s.round_time])),
    ),
    ...hist.problems,
    ...contaminationProblems(status, tallies.keys()),
    ...supersedeProblems(now, status),
  ];
  for (const p of problems) console.error(colors.red(`[FAIL] ${p}`));
  if (problems.length > 0) return 1;
  for (const [id, s] of status) {
    const t = tallies.get(id);
    console.log(`${id} ${s}${t ? ` ${t.solved}/${t.scored}` : ""}`);
  }
  const rescreen = [...status].filter(([, s]) =>
    s === "incomplete" || s === "unscreened"
  ).map(([id]) => id);
  if (rescreen.length > 0) {
    console.log(`next screen tasks: "${tasksGlob(rescreen)}"`);
  }
  if (cmd === "status") return 0;
  const n = Number(a.n);
  if (!Number.isInteger(n) || n < 1) {
    console.error(colors.red("[FAIL] --n must be a positive integer"));
    return 1;
  }
  if (rescreen.length > 0 || [...status.values()].includes("unsealed")) {
    console.error(
      colors.red("[FAIL] select needs every candidate sealed and screened"),
    );
    return 1;
  }
  const pool: Eligible[] = [];
  const rank = new Map<string, string>();
  for (const s of seals) {
    const ids = s.screening.candidates.map((c) => c.id).filter((id) =>
      firstSeal.get(id) === s &&
      (STRATA as readonly string[]).includes(status.get(id)!)
    );
    for (const m of await metaAt(root, s.commit, s.screening, ids)) {
      pool.push({ ...m, stratum: status.get(m.id) as Stratum });
    }
    for (const [id, k] of await ranks(s.seed, ids)) rank.set(id, k);
  }
  const selection = select(pool, n, now.rules, rank);
  const ok = selection.shortfalls.length === 0;
  await Deno.writeTextFile(
    a.out,
    JSON.stringify(
      {
        v: 1,
        status: ok ? "ok" : "too_few",
        head,
        seals: seals.map((s) => ({ tag: s.tag, commit: s.commit })),
        campaigns: campaigns.map((c) => ({
          id: c.id,
          experiment: c.experiment,
        })),
        held_out: heldOut,
        confirmatory_tasks: tasksGlob(selection.selected),
        held_out_tasks: tasksGlob(heldOut),
        candidates: Object.fromEntries(
          [...status].map((
            [id, s],
          ) => [id, { status: s, ...(tallies.get(id) ?? {}) }]),
        ),
        selection,
      },
      null,
      2,
    ) + "\n",
  );
  for (const d of selection.deviations) {
    console.log(colors.yellow(`[WARN] ${d}`));
  }
  for (const s of selection.shortfalls) {
    console.error(colors.red(`[FAIL] ${s}`));
  }
  console.log(
    ok
      ? colors.green(`[OK] ${selection.selected.length} tasks -> ${a.out}`)
      : colors.red(`[FAIL] too few candidates -> ${a.out}`),
  );
  return ok ? 0 : 2;
}

if (import.meta.main) Deno.exit(await main());
```

- [ ] **Step 5: Run to verify pass.** `deno test --allow-all tests/unit/harness/screening.test.ts`. Expected: `ok | 28 passed | 0 failed`. Then `deno check`, `deno lint`, `deno fmt` on both `.ts` files.
- [ ] **Step 5b: Ledger I/O tamper smoke (scratch repo, no push).** In a scratch git repo (`git init` under the session scratchpad) with a minimal `harness-tasks/v2/screening.yml` and one task folder: commit, `git tag -a harness-v2-screen-start -m s`, append a ledger entry whose `tag_object`/`commit` are the real `git rev-parse` values (any 64-hex randomness, `pushed_at` now, `round_time` now + 11 min), commit, `git tag -a harness-v2-screen-start-ledger -m l`; `ROOT=<scratch repo> deno eval 'import { loadSeals } from "file:///U:/Git/CentralGauge/scripts/harness/screening.ts"; console.log(JSON.stringify((await loadSeals(Deno.env.get("ROOT")!)).problems))'` prints `[]`. Then edit the entry's `randomness` and commit: the same command prints a list containing `harness-v2-screen-start: entry differs from harness-v2-screen-start-ledger`. Then `git tag -f -a harness-v2-screen-start -m moved HEAD`: the list contains `harness-v2-screen-start: tag does not resolve to the recorded tag object and commit`. Record the three outputs in `H:\Temp3\harness-spike\M8\ledger-smoke.md`.
- [ ] **Step 6: Smoke the refusal path:** `deno run --allow-all scripts/harness/screening.ts heldout` exits non-zero naming `harness-tasks/v2/seals.yml` (no seal yet, so nothing can be designated or selected before M8-15a).
- [ ] **Step 7: Commit.** `git add scripts/harness/screening.ts tests/unit/harness/screening.test.ts harness-tasks/v2/screening.yml && git commit -m "feat(harness): v2 screening protocol, seals, registry rules and selection"`

**Acceptance:** 28 tests pass; Step 5b shows the clean, rewritten-entry and moved-tag outcomes; check, lint, fmt clean; the rules test pins the Decisions values; `heldout` refuses before the first seal. The reviewer reads `select`, `screeningHistory`, `pickHeldOut`, `ledgerProblems` and `chronologyProblems` against the Decisions section line by line. `loadScreenCampaigns` is covered by M8-16a Step 6 (cross-check against `harness report`), `loadSeals`/`loadLedgerAnchors` by Step 5b.

---

### Task M8-03: premise probes for the new coupling styles

**Lane:** ops. **Deps:** none. **Target:** 10-04 to 10-05. Use the `premise-probe` skill; check `docs/reasoning-suite/decisions.md` first and skip any premise already measured.

| Probe | Question | Consumer |
| --- | --- | --- |
| P1 | Does a `SingleInstance = true` codeunit keep state across procedures of one test codeunit, across test codeunits of one SOAP run, across two SOAP runs? Does `ClearAll` or a new session reset it? | single-instance oracles (state reset per procedure) |
| P2 | Under TestIsolation = Codeunit, what does `Commit()` inside code under test do (error, ignored, committed)? Is the rollback still complete? | commit-behavior tasks; any refapp path that commits |
| P3 | `[CommitBehavior(CommitBehavior::Ignore)]` and `::Error` on BC 28.4: scope (method or callees), nesting, exact error text | commit-behavior tasks; gate classification |
| P4 | Temporary records: does `Insert(true)` on a temp record run OnInsert; does a temp record passed by value share the table; does `DeleteAll` on a temp var touch the database; AutoIncrement on temp tables | temporary-table tasks |
| P5 | Does `classifyTestFailure` classify P2/P3 errors as `runtime_error` and a lost expected error as `assertion`? | gate decisions |

- [ ] **Step 1:** Bench-live check and lease. One probe app per probe, objects in 84900-84999 (never 75000-79999, never 80013); remove each app after its probe.
- [ ] **Step 2:** Run each probe; record verbatim messages and observed values.
- [ ] **Step 3:** `H:\Temp3\harness-spike\M8\probes\results.md`: one section per probe with the observation and an authoring rule; final line: probe apps removed.

**Acceptance:** five sections with verbatim observations and rules; apps removed; lease released. lane-content reads the rules before M8-04 Step 1 finishes the coupling-style objects.

---

### Common procedure A: author one candidate

For `HX-NNN` (oracle band `85600 + (NNN-7)*20 .. +19`):

- [ ] **A1. Card** `H:\Temp3\harness-spike\M8\HX-NNN\card.md`, before any AL:

```markdown
# HX-NNN card (author-only; never copied into prompt.md)
- kind: feature | bugfix | refactor | test-authoring
- prior: easy | intermediate | hard (immutable once sealed)
- touches: [modules]
- coupling: [from: events, internal, interface, queries, facade, ishandled, core-facade, single-instance, temporary-table, commit-behavior]
- size: objects <n> (AL objects correct/ adds or changes), files <n> (files in correct/), reuse <Object.Procedure or none>, traces <event/interface or none>
- premises: <M8-03 probe ids, or other measured source>
- defect or requirement (author-only): <paragraph>
- why a competent AL developer can solve it from prompt + refapp: <paragraph>
- oracle table (normative): | Procedure | Arrange / act | Assert |
- predicted baseline outcome per row: new-requirement | regression
- naive variants (>= 2; >= 3 for prior hard): | Name | Plausible wrong idea | Rows it loses by assertion |
- reuse-flagged only: reuse targets (named procedure first, then accepted alternatives: codeunit id, procedure, declared signature, file, perturb statements giving a non-throwing wrong result) and the oracle procedures that assert behaviour through them
- measurement fixtures (if assigned, `fixture/<name>`): | Name | What it does | Expected measure |
- test-authoring only: mutants (>= 5) | Name | Change | ; naive suites (>= 2) | Name | Mutant it leaves alive |
```

- [ ] **A2. Premise check.** Any platform behaviour not in M8-03 results or `docs/reasoning-suite/decisions.md` goes to lane-ops as a premise-probe request before the oracle is written.
- [ ] **A3. Task files.** `task.yml`:

```yaml
id: HX-NNN
refapp_version: refapp-v2-rc<latest>        # refapp-v2 for candidates authored after the start seal
kind: <kind>
prompt: prompt.md
touches: [<modules>]
coupling: [<tags>]
source: refapp
attachments: []
scorers: [build, pass_to_pass, fail_to_pass]          # test-authoring: [build, pass_to_pass, mutant_kill]
pass_to_pass:
  - { codeunit: <visible 80000-84999>, procedures: [<visible procedures on the touched path>] }
fail_to_pass:                                         # test-authoring: null, plus mutants: [<names>]
  depends_on: [<modules the oracle needs>]
  tests:
    - { codeunit: <85600+(NNN-7)*20>, procedures: [<every oracle row of the card>] }
mutants: []
contamination: null
limits: { timeout_min: 30 }
```

`prompt.md` ticket style (`# <Bug|Feature|Task> <4-digit number>: <symptom or requirement>`, reporter line, observed vs expected or the requirement, required public names and signatures, a reproduction for bugs; test-authoring: tests go in a new test codeunit in the Test app). `overlay/`, `correct/`, `naive/<name>/` per card row, `oracle/app.json` (band, app id, deps only `CGR <module>` of `depends_on` plus Library Assert) and `oracle/src/<Name>Oracle.Codeunit.al`. Test-authoring: `mutants/<name>/`, `reference-tests/Test/src/<Name>Tests.Codeunit.al` (new codeunit), naive suites as new `Test/` files only. Assigned measurement fixtures: `fixture/<name>/` with the same layer rules as `naive/` (never under `Test/`; variant id `fixture/<name>`, appendix section 7).
- [ ] **A4. Measures** (non-test-authoring only) `measures/measures.yml` (M11 `TaskMeasuresSchema`). Until the gate (A9) every `fail_to_pass` procedure is provisionally weighted; A9 moves the rows that pass on the gate baseline to `hidden_regressions` before the seal:

```yaml
v: 1
partial_credit:
  weights:                                   # weight 1 for every NEW-REQUIREMENT row (A9)
    "<85600+(NNN-7)*20>/<Procedure>": 1
  hidden_regressions: []                     # A9: oracle rows that pass on the gate baseline
reuse: null                                  # reuse-flagged tasks:
# reuse:
#   targets:
#     - { codeunit: <id>, procedure: <Name>, signature: "(<params>): <Return>", file: <Module>/src/<File>.al, perturb: "<AL statements, non-throwing wrong result>" }
#   tests:
#     - { codeunit: <oracle id>, procedures: [<procedures that assert through the target>] }
expect:
  correct: { partial_credit: 1, final_errors: 0 }   # add reuse_executed: true, reuse: true when reuse-flagged
```

(The commented `reuse` lines are the shape to use for a reuse-flagged task; a non-flagged task keeps `reuse: null` and no comment block. `signature` is the declared parameter list and return type as in the source; `perturb` must compile in the target's body.)
- [ ] **A5. Host compile** each variant: `deno run --allow-all scripts/harness/gate-task.ts compile harness-tasks/tasks/HX-NNN <variant>` for `baseline`, `correct`, each `naive/<name>`, each mutant and `reference-tests` for test-authoring. Fixtures: compile through `naive/<name>` is not possible; lane-ops compiles them in M11-14. Expected `[OK]` for seven apps and the oracle. A compile error is fixed in the AL, never by removing an oracle row.
- [ ] **A6. Commit, then audit** with `al-test-auditor`:

> Audit harness task `U:\Git\CentralGauge\harness-tasks\tasks\HX-NNN` at task tree `<git rev-parse HEAD:harness-tasks/tasks/HX-NNN>`. The specification is `prompt.md` plus `task.yml`; the oracle is `oracle/src/*.al` (hidden, 85000-89999); visible tests are `harness-tasks/refapp/Test`. Apply rule sets A, B, C and E to (prompt.md, oracle). Also: (1) compare the oracle with the normative table in `H:\Temp3\harness-spike\M8\HX-NNN\card.md`; (2) report any prompt requirement with no assertion; (3) report any assertion neither the prompt nor a refapp contract states; (4) report state shared between procedures or inherited from the session (work date, Setup, single-instance state); (5) check each naive variant against the card's kill mapping; (6) report any hint in the prompt; (7) confirm the card's size, coupling and reuse claims against `correct/`; (8) confirm `measures/measures.yml` weights plus `hidden_regressions` cover exactly the `fail_to_pass` procedures, and the reuse tests assert through the listed targets with the listed signatures; (9) confirm every `fixture/` variant does what the card says. Read-only. First line `TASK TREE: <id>`. Last line `VERDICT: clean` or `VERDICT: <n> critical, <m> major`.

Save `H:\Temp3\harness-spike\M8\HX-NNN\audit-<k>.md`; fix critical and major findings (never by weakening an oracle row), commit, re-audit until clean.
- [ ] **A7. Static check:** `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-NNN`. Expected `[OK]`.
- [ ] **A8. Registry entry** appended to `harness-tasks/v2/screening.yml`:

```yaml
  - id: HX-NNN
    prior: <card>
    size: { objects: <n>, files: <n>, reuse: <"Object.Procedure" or null>, traces: <"Event or Interface" or null> }
```

`deno test --allow-all tests/unit/harness/screening.test.ts` passes. Commit `feat(harness-tasks): HX-NNN <kind> candidate`. Request the gate from lane-ops (Common procedure G).
- [ ] **A9. After the gate, before the seal: the split and measured expectations** (round 2 finding 2; appendix section 7). From the first promoted gate report of the candidate:
  1. New-requirement rows: `jq -r '[.runs[] | .result | select(.variant=="baseline" and .repeat==1) | .tests[] | select(.codeunit >= 85000 and (.passed | not)) | "\(.codeunit)/\(.procedure)"] | unique' <report>` (a baseline whose oracle did not compile: every `fail_to_pass` procedure). Keep weight 1 for exactly these keys; move every other `fail_to_pass` key to `hidden_regressions`. A candidate with no new-requirement row is a broken design: redesign it (new id), never weight a passing row.
  2. For each `naive/<x>`: `jq --argjson w '<the JSON array printed by item 1>' '[.runs[] | .result | select(.variant=="naive/<x>" and .repeat==1) | .tests[] | select("\(.codeunit)/\(.procedure)" as $k | $w | index($k))] | (map(select(.passed)) | length) / length' <report>` and add `naive/<x>: { partial_credit: <value> }` under `expect` (a naive that does not compile the oracle gets 0).
  Commit `chore(harness-tasks): HX-NNN measure split and measured expectations`; metadata-only re-attestation by `al-test-auditor` ("only `measures/measures.yml` weights, `hidden_regressions` and `expect` changed, from gate report <path>"), saved as `reattest-measures.md`. After the candidate's seal this file never changes (it is in the oracle hash and the sealed tree).

**Candidate acceptance:** `check` `[OK]`; latest audit names the committed tree and ends `VERDICT: clean`; oracle has every card row; naive folders match the card; registry entry loads; after A9, the weights equal the gate's new-requirement rows and `measures.yml` parses with M11's `loadTaskMeasures` once M11-04 is merged (`deno eval 'import { loadTask } from "./src/harness/task.ts"; import { loadTaskMeasures } from "./src/harness/measures.ts"; console.log(await loadTaskMeasures(await loadTask("harness-tasks/tasks/HX-NNN")) ? "[OK]" : "[FAIL]")'`).

### Common procedure G: gate job

The M4-03 procedure: bench-live check; lease Cronus281-283; `deno run --allow-all scripts/harness/gate-task.ts gate <container> HX-NNN --rev <sha>`; record wall time (`jq '[.runs[].result.ms] | add' <report>`); exit 1 sends `reasons` to lane-content (ops never edits AL); exit 3 reruns once on another container, a second infra exit goes to `coord ask`; release the lease.

**Gate acceptance:** `jq -e '.promoted and .matrix_complete and .source_commit == "<sha>" and .task_tree == "<TASK TREE of the latest audit>" and (.runs | length) == (.plan | length) and .cleanup_error == null' <report>` exits 0.

---

### Task M8-04: refapp v2 and the anchor candidate HX-007

**Lane:** content. **Deps:** M8-01, M8-02; M8-03 rules before the coupling-style objects are final. **Target:** 10-04 to 10-07.

**Files:**
- Create in `harness-tasks/refapp/Core/src/`: a `SingleInstance` session context codeunit (cached Setup and current branch; public `Reset()`); a date helper codeunit (working days between two dates, next working day); an amount rounding codeunit (precision from Setup). Ids 70007-70019.
- Create in `harness-tasks/refapp/Rental/src/`: invoice preview into a `TableType = Temporary` buffer table; batch posting with `Commit()` per contract and an error log; one `[CommitBehavior(CommitBehavior::Ignore)]` procedure on the per-contract path, shaped by P2/P3. Ids from 70210.
- Create in `harness-tasks/refapp/Leasing/src/`: lease invoicing with `OnBeforeCreateInvoiceLine` / `OnAfterCreateInvoiceLine`. Ids from 70310.
- Create in `harness-tasks/refapp/Integration/src/`: outbox retry with a commit before the simulated send. Ids from 70410.
- Create in `harness-tasks/refapp/Fleet/src/`: a service plan table and management codeunit behind the maintenance strategy interface. Ids from 70110.
- Create in `harness-tasks/refapp/Reporting/src/`: one query object (revenue by vehicle and month). Ids from 70510.
- Create in `harness-tasks/refapp/Test/src/`: one visible test codeunit per new slice (80020 onward, never 80013), helpers in `TestLibrary`. Codeunit 80000 unchanged.
- Create: `harness-tasks/tasks/HX-007/...` (Common procedure A), crossing at least two new slices.

- [ ] **Step 1:** Slices and visible tests.
- [ ] **Step 2:** HX-007 by Common procedure A (pin `refapp-v2-rc1`; A7 warns the tag does not resolve yet).
- [ ] **Step 3:** `deno run --allow-all scripts/harness/gate-task.ts compile harness-tasks/tasks/HX-007 baseline`: `[OK]` for seven apps.
- [ ] **Step 4:** `git diff --quiet refapp-v1 HEAD -- harness-tasks/tasks/HX-001 harness-tasks/tasks/HX-002 harness-tasks/tasks/HX-003 harness-tasks/tasks/HX-004 harness-tasks/tasks/HX-005 harness-tasks/tasks/HX-006` exits 0.
- [ ] **Step 5:** Commit `feat(harness-tasks): refapp v2 slices and HX-007 anchor candidate`; request the gate.

**Acceptance:** candidate acceptance for HX-007; Steps 3 and 4; `task-set-v1.test.ts` passes.

### Task M8-05: gate HX-007 (refapp v2 rc1)

**Lane:** ops. **Deps:** M8-04. **Target:** 10-07.

- [ ] **Step 1:** Common procedure G for HX-007.
- [ ] **Step 2:** `jq -e '[.runs[] | .result | select(.variant=="baseline") | .tests[] | select(.codeunit < 85000 and (.passed | not))] | length == 0' <report>` (every visible procedure green on the new refapp).

**Acceptance:** gate acceptance; Step 2 exits 0. The orchestrator tags `refapp-v2-rc1`. A later refapp change needs a new rc, `check` on every earlier candidate, and re-derive, re-audit, re-gate of any whose replaced files changed, all before M8-14.

### Task M8-06: wave 1 candidates HX-008 to HX-018 (incl. M11 fixtures)

**Lane:** content. **Deps:** M8-05. **Target:** 10-07 to 10-11 (gated with A9 by 10-12; M11-14 starts 10-16).

Eleven candidates by Common procedure A. Wave quota (with HX-007, 12): 4 feature, 3 bugfix, 2 refactor, 3 test-authoring; one each of the three new coupling styles; at least 8 large; priors about 2/8/2. **M11 fixtures (appendix section 7):** at least 3 reuse-flagged non-test-authoring candidates, each with `fixture/duplicated-logic` (target never called; `expect: { reuse_executed: false, reuse: false }`), `fixture/dead-call` (target called on a branch the reuse tests never take; `false, false`), `fixture/comment-only` (call only in a comment; `false, false`), `fixture/token-call` (target called, result ignored; `reuse_executed: true, reuse: false`); on at least one of them `fixture/caught-call` (target called inside a `[TryFunction]` whose error is swallowed, result used; expectation written by the author under M11-06's rule "executed = probe marker observed OR effective"); one candidate with `fixture/unused-variable` (`expect: { new_warning_codes: [AA0137], partial_credit: 1 }`).

**Acceptance:** eleven candidates pass candidate acceptance; registry lists HX-007 to HX-018; the six fixture kinds exist as stated; quota table in the submit note.

### Task M8-07: gate wave 1

**Lane:** ops. **Deps:** M8-06 (per candidate). **Target:** 10-09 to 10-12.

- [ ] **Step 1:** Common procedure G for HX-008 to HX-018.
- [ ] **Step 2:** Per-gate wall time and the authoring dates of each candidate (commit times) in `H:\Temp3\harness-spike\M8\capacity.md`.

**Acceptance:** gate acceptance for all eleven; `capacity.md` filled.

### Task M8-07b: capacity checkpoint

**Lane:** orchestrator. **Deps:** M8-07. **Target:** 10-12.

- [ ] **Step 1:** From `capacity.md`, compute gated candidates per day and gate hours per candidate; project the date waves 2 to 4 finish for N_prelim 24, 30, 40 (pool 52, 64, 84; wave 4 of 16, 28, 48) and the cells and pilot hours with the appendix section 12 formulas (pilot cells = 6 x screened x 1.1; campaign cells = (N + 4) x R x 4 for R in 3, 5, 8; hours = cells x median v1 cell wall time from `H:\cg-coord\m6\archive` / concurrency). On 10-13, rerun with N_prelim from `H:\cg-coord\m11\sim-a.md`.
- [ ] **Step 2:** If the projected freeze for N_prelim is after 11-12 or its cells exceed 1,300 by more than the owner's "slightly", `coord ask` to the owner: cap N_prelim at 30 (or 24), accept the slip, or add authoring threads. Record the answer in `H:\cg-coord\decisions\`.

**Acceptance:** the projection table and, if triggered, the owner's decision.

### Task M8-08: wave 2 candidates HX-019 to HX-030

**Lane:** content. **Deps:** M8-07 started. **Target:** 10-11 to 10-15. Twelve candidates; quota 4 feature, 3 bugfix, 3 refactor, 2 test-authoring; one each new coupling style; at least 8 large; priors about 2/8/2. **Acceptance:** as M8-06 for HX-019 to HX-030 (no fixtures required).

### Task M8-09: gate wave 2

**Lane:** ops. **Deps:** M8-08. **Target:** to 10-16. Common procedure G for HX-019 to HX-030, then A9 hand-off of reports to lane-content. **Acceptance:** gate acceptance for all twelve.

### Task M8-10: wave 3 candidates HX-031 to HX-042

**Lane:** content. **Deps:** M8-09 started. **Target:** 10-15 to 10-19. Quota as wave 2. **Acceptance:** as M8-08 for HX-031 to HX-042.

### Task M8-11: gate wave 3

**Lane:** ops. **Deps:** M8-10. **Target:** to 10-20. Common procedure G for HX-031 to HX-042. **Acceptance:** gate acceptance for all twelve.

### Task M8-12: wave 4 candidates to the pool size

**Lane:** content. **Deps:** M11-15 `H:\cg-coord\m11\sim-a.md` (N_prelim, 10-13; default 24 if absent on 10-20, or the M8-07b owner cap); M8-07b; M8-11 started. **Target:** 10-20 to 10-25 (N=24), 10-29 (N=30), 11-04 (N=40).

Pool end = HX-(6 + ceil(2.0 x N_prelim) + 4): HX-058 (24), HX-070 (30), HX-090 (40) (`pool_factor` 2.0, appendix section 12). Candidates pin `refapp-v2` (the local tag exists from M8-15a) and are overlay-only. Quota: fill whichever pool count is below target (each kind 15% to 35% of the pool, each new coupling style at least 3, large at least 60%). **Acceptance:** as M8-08 for the wave's ids; pool-level quota table in the submit note.

### Task M8-13: gate wave 4

**Lane:** ops. **Deps:** M8-12 (per candidate). **Target:** 10-21 to 10-26 (N=24; +4 or +10 days otherwise). Common procedure G for every wave 4 id, then A9. **Acceptance:** gate acceptance for each.

---

### Task M8-14: start set ready to seal (re-pin to refapp-v2)

**Lane:** content. **Deps:** M8-05, M8-07, M8-09, M8-11 (HX-007 to HX-042 gated, A9 done). **Target:** 10-20 to 10-21.

- [ ] **Step 1:** `deno run --allow-all scripts/harness/gate-task.ts check harness-tasks/tasks/HX-NNN` for HX-007 to HX-042 at their rc pins; save to `H:\Temp3\harness-spike\M8\seal-start\pre-repin-check.txt`; fix any drift problem first (re-derive, re-audit, re-gate).
- [ ] **Step 2:** `refapp_version: refapp-v2` in each of those `task.yml`; `git diff <latest audited sha> -- harness-tasks/tasks/HX-NNN` shows only that line.
- [ ] **Step 3:** Registry equals the gated start set: `deno eval 'import { parse } from "@std/yaml"; const s = parse(await Deno.readTextFile("harness-tasks/v2/screening.yml")) as { candidates: { id: string }[] }; const want = Array.from({ length: 36 }, (_, i) => `HX-${String(i + 7).padStart(3, "0")}`); console.log(JSON.stringify(s.candidates.map((c) => c.id).sort()) === JSON.stringify(want) ? "[OK] registry matches" : "[FAIL] registry differs");'` prints `[OK] registry matches` (wave 4 entries are appended only after M8-15a).
- [ ] **Step 4:** Commit `chore(harness-tasks): v2 start set pinned to refapp-v2`.
- [ ] **Step 5:** Re-attestation per candidate (only the `refapp_version` line changed), `H:\Temp3\harness-spike\M8\HX-NNN\reattest-seal.md`.

**Acceptance:** Step 2 diff holds for all 36; Step 3 `[OK]`; every re-attestation `VERDICT: clean`.

### Task M8-15a: start seal and held-out designation

**Lane:** infra; tags and push by the orchestrator (ruling 10). **Deps:** M8-02, M8-14. **Target:** 10-21. No M9 to M11 dependency (finding 1); M11-16 (stage A) follows and depends on this task (appendix section 11).

- [ ] **Step 1: Seal tag.** The orchestrator tags the M8-14 commit `harness-v2-screen-start` (annotated) and `refapp-v2` (local, provisional), and pushes `harness-v2-screen-start` to origin. Record `git rev-parse harness-v2-screen-start` (tag object) and `git rev-parse harness-v2-screen-start^{commit}` (commit). Record the push time from GitHub: `gh api repos/{owner}/{repo}/git/refs/tags/harness-v2-screen-start` confirms the ref, and the push time is taken from `gh api repos/{owner}/{repo}/events --jq '[.[] | select(.type=="CreateEvent" and .payload.ref=="harness-v2-screen-start")][0].created_at'`. Write all three to `H:\Temp3\harness-spike\M8\seal-start\seal.md`.
- [ ] **Step 2: Beacon round.** `curl -s https://api.drand.sh/info` gives `period`, `genesis_time` and the chain `hash`; `round = ceil((push_unix + 600 - genesis_time) / period) + 1`, `round_time = genesis_time + (round - 1) x period`. After that time has passed: `curl -s https://api.drand.sh/public/<round>`; take `randomness`. Write both commands and outputs to `seal.md`.
- [ ] **Step 3: Ledger entry** `harness-tasks/v2/seals.yml` (appendix section 9):

```yaml
# Seal ledger of the v2 screening registry (scripts/harness/screening.ts).
# Append only: each entry's prev hashes the entry before it; each entry is
# anchored by its seal tag and by <seal tag>-ledger on the commit that appends it.
v: 2
seals:
  - tag: harness-v2-screen-start
    tag_object: "<40 hex from Step 1>"
    commit: "<40 hex from Step 1>"
    pushed_at: "<ISO push time>"
    drand_chain: "<64 hex chain hash>"
    drand_round: <round>
    round_time: "<ISO round time>"
    randomness: "<64 hex>"
    prev: genesis
```

Commit `chore(harness-tasks): v2 start seal ledger entry`. The orchestrator tags this commit `harness-v2-screen-start-ledger` (annotated) and pushes it.
- [ ] **Step 4: Held-out.** `deno run --allow-all scripts/harness/screening.ts heldout` (it verifies the ledger first). Expected `held_out: <4 ids, one per kind>` and the `tasks:` line; save both to `seal.md`. A refusal (no set with 2 large tasks and all three coupling styles): `coord ask` to the owner before M11-16.
- [ ] **Step 5: Hand-off.** Send the four ids to M11-16 (stage A `held_out.tasks`, appendix section 10) and the orchestrator.

**Acceptance:** `seal.md` holds tag object, commit, push time, the round computation and the beacon response; `seals.yml` loads and `heldout` reports no ledger problem; both tags are on origin; `heldout` prints one id per kind; M11-16 has the list.

### Task M8-15b: screening authorization and the start-seal experiment

**Lane:** infra. **Deps:** M8-15a; M11-16 stage A (tag `harness-v2-prereg-a`, decision file `H:\cg-coord\decisions\*-harness-v2-prereg-a.md`, planned `2026-10-24-harness-v2-prereg-a.md`); M9-17 and M10-09 (image `centralgauge/harness-claude-code:2.1.282-r3` with gate 1 and S1 proven on it); screening configs `cc-v2-plain`, `cc-v2-realistic-lsp` with `image_revision: "3"`; M9-12 leakage audit clean on the 36 start candidates and the bundle lock committed; M11-14 gate 6 incl. the test-authoring discovery decision; `models --check` green; `unscreenable` approved (owner, 2026-10-03). **Target:** 10-25.

**Files:**
- Create: `harness/experiments/v2-screen-1.yml`

- [ ] **Step 1:** List each prerequisite file in `H:\Temp3\harness-spike\M8\screening\authorization.md` with its path, plus `deno task start models <screening model slug> --check` output, `grep -h image_revision harness/configs/cc-v2-plain.yml harness/configs/cc-v2-realistic-lsp.yml` (both `"3"`), `git rev-parse harness-v2-prereg-a` equal to the `tag_object:` line of the stage-A decision file, and the stage-A file's `held_out.tasks` equal to the M8-15a list. Any missing or differing item: stop, `coord ask`.
- [ ] **Step 2:** `rules.arms` equals the two config ids; a difference here is a protocol break (rules are frozen at the start seal): `coord ask` to the owner, never edit.
- [ ] **Step 3:** `harness/experiments/v2-screen-1.yml`:

```yaml
# M8-15b: task set v2 screening pilot of the start seal (developmental, never confirmatory).
# Symmetric: both diagonal arms, 3 repeats each; drop rule and strata in harness-tasks/v2/screening.yml.
id: v2-screen-1
hypothesis: "Screening pilot of the v2 start-seal candidates on the plain and realistic+LSP arms; developmental, excluded from every confirmatory result."
primary_metric: pass_rate
baseline: <rules.arms plain id>
variants: [<rules.arms realistic+LSP id>]
vary: [<exactly the component keys that differ between the two configs>]
tasks: "<the tasks line printed by M8-15a Step 4>"
repeats: 3
```

- [ ] **Step 4:** `deno task start harness validate`: `[OK] <n> tasks, task set <hash>` without `(provisional ...)`, `v2-screen-1` loads. Quote it.
- [ ] **Step 5:** Commit `chore(harness): v2 screening experiment v2-screen-1`; `deno run --allow-all scripts/harness/screening.ts status` exits 0 (no campaigns yet: every start candidate `unscreened`, held-out `held_out`).

**Acceptance:** `authorization.md` complete; the glob equals the M8-15a line and excludes the held-out ids; Step 5 output.

### Task M8-15c: wave 4 seal

**Lane:** infra; tags and push by the orchestrator. **Deps:** M8-13; wave 4 entries appended (Common procedure A8/A9). **Target:** 10-27 (N=24; 10-31 or 11-06 otherwise).

- [ ] **Step 1:** As M8-15a Steps 1 to 3 with tag `harness-v2-screen-w4` (no held-out step); append the entry to `seals.yml` with `prev` = `entryHash` of the start entry (`deno eval 'import { parse } from "@std/yaml"; import { entryHash } from "./scripts/harness/screening.ts"; const s = parse(await Deno.readTextFile("harness-tasks/v2/seals.yml")) as { seals: never[] }; console.log(await entryHash(s.seals.at(-1)!))'`); commit; the orchestrator tags that commit `harness-v2-screen-w4-ledger` and pushes both tags.
- [ ] **Step 2:** `screening.ts status` exits 0 and lists the wave 4 ids as `unscreened`; the `next screen tasks:` line names them (plus any incomplete start candidate). Save to `H:\Temp3\harness-spike\M8\seal-w4\seal.md`.

**Acceptance:** seal recorded as for the start seal; status as stated.

---

### Task M8-16a: start-seal pilot

**Lane:** ops. **Deps:** M8-15b; M7 concurrency decision (else `--concurrency 1`). **Target:** 10-25 to 10-28.

- [ ] **Step 1: Estimate.** Cells (start candidates minus held-out) x 6 x median cell wall time (frozen v1 archive) / concurrency; Team usage per cell from v1; cells used so far against 1,300. Write `H:\Temp3\harness-spike\M8\screening\plan.md`. Over budget: `coord ask` before Step 2.
- [ ] **Step 2: Run.** Bench-live check; `deno task start harness run v2-screen-1 --concurrency <c>` (on a usage-limit pause the whole block pauses and resumes; no arm-specific reruns; never a second campaign for this experiment).
- [ ] **Step 3: Status.** `deno run --allow-all scripts/harness/screening.ts status > H:\Temp3\harness-spike\M8\screening\status-1.txt`. Exit 0.
- [ ] **Step 4: Arm-blind broken-oracle triage.** From judgments of this campaign's executions (judgments carry no arm): `jq -c 'select(.verdict=="fail") | {judgment: .id, task: .task_id, failing: ([.scorers[] | .tests[] | select(.outcome != "pass") | .procedure] | unique)} | select(.failing | length == 1)' results/harness/judgments/<execution>/*.json`, ordered by judgment id (a random uuid, independent of arm). For each line, copy ONLY `<Module>/src/**/*.al` and `<Module>/app.json` of the judged workspace (never `.claude/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, plugin or LSP folders, traces or logs) into `H:\Temp3\harness-spike\M8\triage\<judgment id>\`, and dispatch `al-test-auditor`: "Prompt: <prompt.md>. Oracle procedure: <procedure source>. Workspace: <folder>. Is this assertion stated by the prompt or an existing refapp contract, and does this workspace meet the prompt? Last line `VERDICT: oracle sound` or `VERDICT: oracle broken: <reason>`." A `broken` verdict goes to the orchestrator; on its decision file lane-content sets `broken: <decision path>` (the one allowed registry change) and commits.
- [ ] **Step 5:** Send the status file to the orchestrator and to M11 (stage B input). No per-arm, per-task difference is computed or circulated.
- [ ] **Step 6: Cross-check the I/O.** For every candidate screened once, `deno task start harness report v2-screen-1` per-task pass counts summed over both arms equal its `solved` in `status-1.txt`. A difference: stop, `coord ask` with both files.

**Acceptance:** every start candidate has a status; Step 6 holds; `plan.md` records estimate and actual cells; every `broken` has an auditor verdict and an orchestrator decision.

### Task M8-16b: wave 4 pilot and the one rescreen

**Lane:** ops. **Deps:** M8-15c; M9-12 leakage audit clean on wave 4; M8-16a. **Target:** 10-28 to 10-31.

- [ ] **Step 1:** `harness/experiments/v2-screen-2.yml` (copy of `v2-screen-1.yml`, `id: v2-screen-2`, `tasks:` = the `next screen tasks:` line of `screening.ts status`: wave 4 ids plus incomplete start candidates); `harness validate`; commit; run.
- [ ] **Step 2:** `screening.ts status > status-2.txt`. Any `incomplete` line now is a candidate screened only once (wave 4): if any, `v2-screen-3.yml` with the new `next screen tasks:` line, run, `status > status-3.txt`. The script refuses any other rerun.
- [ ] **Step 3:** Triage (M8-16a Step 4) for the new campaigns; cross-check (M8-16a Step 6) per experiment.

**Acceptance:** every sealed candidate has a final status (stratum, dead, saturated, broken, unscreenable, held_out); `status` exits 0.

---

### Task M8-17: replacement and redesigned candidates (conditional)

**Lane:** content. **Deps:** M8-19 Step 1 exit 2, or an orchestrator-requested redesign of a dead, saturated or broken candidate. **Target:** 11-03 to 11-05.

- [ ] **Step 1:** For each named shortfall (`kind <k>`, `coupling <s>`, `large`, `stratum <s>`), a new candidate (next free id) by Common procedure A, pinned `refapp-v2`, overlay-only (`git diff harness-v2-screen-start HEAD -- harness-tasks/refapp` empty). A redesign adds `supersedes: <old id>`.
- [ ] **Step 2:** `screening.ts status` exits 0 and lists the new ids as `unsealed`.

**Acceptance:** candidate acceptance for each; Step 2; refapp diff empty.

### Task M8-18: seal, gate and screen the replacements (conditional)

**Lane:** ops (seal tags by the orchestrator, seal entry by infra). **Deps:** M8-17; M9-12 leakage audit of the new candidates. **Target:** 11-05 to 11-08.

- [ ] **Step 1:** Common procedure G for each new id, then A9.
- [ ] **Step 2:** Seal as M8-15c with tag `harness-v2-screen-r<k>`.
- [ ] **Step 3:** `harness/experiments/v2-screen-r<k>.yml` with the `next screen tasks:` line; run; one rescreen if incomplete (`v2-screen-r<k>b`); status.

**Acceptance:** gate acceptance for each; each new id has a final status.

---

### Task M8-19: selection

**Lane:** infra. **Deps:** M8-16b (and M8-18 if it ran, as the rerun M8-19r); M11-17a provisional design naming N (`harness/preregistration/cc-v2-factorial.sim-b.json` `decision.design.tasks`; binding only after M11-17b). **Target:** 11-02 (M8-19r 11-09 after a replacement round).

- [ ] **Step 1: Verify the seals.** `screening.ts status` reports no ledger problem (chain, seal tags, ledger tags, chronology). For each `seals.yml` entry, re-fetch `https://api.drand.sh/public/<round>` and compare `randomness`; check `https://api.drand.sh/info` `hash` equals `drand_chain`; recompute the round and `round_time` from the tag's GitHub push time (M8-15a Step 1 commands) and compare `pushed_at`; check `git ls-remote origin refs/tags/<tag> refs/tags/<tag>-ledger` equals the local tag objects. Record in `H:\Temp3\harness-spike\M8\selection\seals-verified.md`. A mismatch: stop, `coord ask`.
- [ ] **Step 2:** `deno run --allow-all scripts/harness/screening.ts select --n <N>`.
  - Exit 0: `harness-tasks/v2/selection.json` with `status: "ok"`.
  - Exit 2: shortfalls printed; first time, start M8-17/M8-18; after the replacement round, `coord ask` to the owner with the Decisions options. Do not commit a `too_few` file.
- [ ] **Step 3:** `jq -e '.status == "ok" and (.selection.selected | length) == .selection.n and (.held_out | length) == 4 and ([.selection.selected[] as $s | .held_out | index($s)] | all(. == null))' harness-tasks/v2/selection.json` exits 0.
- [ ] **Step 4:** Commit `chore(harness-tasks): v2 selection, N=<N>`; deviations in the submit note.

**Acceptance:** Steps 1 and 3; N equals M11-17a's `decision.design.tasks`; every screening campaign listed in `.campaigns`. Hand-off: the committed `selection.json` path and sha256 to M11-17b.

### Task M8-20: freeze candidate

**Lane:** infra. **Deps:** M8-19. **Target:** 11-03.

**Files:**
- Create: `tests/unit/harness/task-set-v2.test.ts`

- [ ] **Step 1: Test:**

```typescript
import { assertEquals } from "@std/assert";
import { loadTaskSet } from "../../../src/harness/task.ts";

Deno.test("v2 task set: frozen selection and held-out tasks pin refapp-v2", async () => {
  const sel = JSON.parse(
    await Deno.readTextFile("harness-tasks/v2/selection.json"),
  );
  assertEquals(sel.status, "ok");
  const ids: string[] = [...sel.selection.selected, ...sel.held_out].sort();
  assertEquals(ids.length, sel.selection.n + 4);
  const set = new Map(
    (await loadTaskSet("harness-tasks/tasks")).map((t) => [t.task.id, t.task]),
  );
  assertEquals(
    ids.filter((id) => set.get(id)?.refapp_version !== "refapp-v2"),
    [],
  );
});
```

Run `deno test --allow-all tests/unit/harness/task-set-v2.test.ts`: `ok | 1 passed`.
- [ ] **Step 2: Freeze checks.** `deno run --allow-all scripts/harness/screening.ts status` exits 0 (every seal's entries and trees unchanged, every campaign bound to the current identities, no contamination). `git diff --quiet harness-v2-screen-start HEAD -- harness-tasks/refapp` exits 0. `test "$(git rev-parse refapp-v2:harness-tasks/refapp)" = "$(git rev-parse HEAD:harness-tasks/refapp)"` exits 0. Record in `H:\Temp3\harness-spike\M8\freeze\diff-check.txt`.
- [ ] **Step 3: Qualification manifest:**

```bash
REV=$(git rev-parse HEAD) deno eval '
import { loadTask } from "./src/harness/task.ts";
const sel = JSON.parse(await Deno.readTextFile("harness-tasks/v2/selection.json"));
const rev = Deno.env.get("REV")!;
const tasks: Record<string, unknown> = {};
for (const id of [...sel.selection.selected, ...sel.held_out].sort()) {
  const { task } = await loadTask(`harness-tasks/tasks/${id}`);
  const naive: string[] = [];
  for await (const e of Deno.readDir(`harness-tasks/tasks/${id}/naive`)) if (e.isDirectory) naive.push(e.name);
  tasks[id] = { rev, positive: task.kind === "test-authoring" ? "reference-tests" : "correct", naive: naive.sort() };
}
await Deno.mkdir("H:/Temp3/harness-spike/M8/freeze", { recursive: true });
await Deno.writeTextFile("H:/Temp3/harness-spike/M8/freeze/qualify-manifest.json", JSON.stringify({ v: 1, refapp_version: "refapp-v2", tasks }, null, 2) + "\n");
'
```

Then `deno eval 'import { loadQualifyManifest } from "./src/harness/qualify.ts"; await loadQualifyManifest("H:/Temp3/harness-spike/M8/freeze/qualify-manifest.json"); console.log("[OK]")'` prints `[OK]`.
- [ ] **Step 4:** check/lint/fmt the test; commit `test(harness): v2 frozen task set pins refapp-v2`.

**Acceptance:** Step 1 passes; every Step 2 command exits 0; the manifest loads and names every naive folder of every frozen task.

### Task M8-21: freeze qualification

**Lane:** ops. **Deps:** M8-20. **Target:** 11-03 to 11-05.

- [ ] **Step 1: Re-gate** every frozen task (confirmatory and held-out, start, wave 4 and replacements alike) at `--rev <M8-20 commit>` with Common procedure G. Expected: gate acceptance with `.source_commit` the M8-20 commit, `.task_tree` equal to the latest audit or re-attestation tree, and `tag_status: match` (the `refapp-v2` refapp tree equals the gated refapp tree, also proven in M8-20 Step 2).
- [ ] **Step 2: Identity.** `deno task start harness validate` prints `[OK] <n> tasks, task set <hash>` without `(provisional ...)`.
- [ ] **Step 3: Real pipeline.** `deno task start harness qualify --manifest H:\Temp3\harness-spike\M8\freeze\qualify-manifest.json`: positive `pass`, each naive `fail` with an oracle assertion failure (test-authoring: a surviving mutant). Record in `H:\Temp3\harness-spike\M8\freeze\pipeline.md`. Disagreement with Step 1: `coord ask`; neither side edited to agree.
- [ ] **Step 4: New-requirement rows re-derived** per task from its Step 1 report: `jq -r '[.runs[] | .result | select(.variant=="baseline" and .repeat==1) | .tests[] | select(.codeunit >= 85000 and (.passed | not)) | "\(.codeunit)/\(.procedure)"] | unique' <report>`; a baseline whose oracle did not compile makes every `fail_to_pass` procedure a new-requirement row. The list must equal the keys of `partial_credit.weights` in the sealed `measures/measures.yml` (fixed at A9 before the seal; this step verifies, never sets). A difference: stop, `coord ask` (the split is never edited after sealing).
- [ ] **Step 5: Freeze record** `H:\Temp3\harness-spike\M8\freeze\task-set.json`: `{ "refapp_version": "refapp-v2", "commit": "<M8-20 sha>", "refapp_tree": "<git rev-parse refapp-v2:harness-tasks/refapp>", "task_set_hash": "<validate hash>", "n": <N>, "confirmatory": [...], "held_out": [...], "by_stratum": {...}, "deviations": [...], "seals": [...], "excluded_experiments": ["v2-screen-1", ...], "tasks": [{ "id", "gate_report", "promoted", "pipeline": [{ "variant", "verdict", "expected" }], "new_requirement_procedures": [...] }] }`.
- [ ] **Step 6:** All qualified: the orchestrator pushes `refapp-v2` (seal and ledger tags were pushed at creation), triggers M9-12 Step 4 (freeze leakage rerun), hands the freeze record to M11-17b and runs `graphify update .`. A task not qualified: a broken oracle found after screening; the orchestrator and owner decide (drop and rerun M8-19 with the same N, or slip) BEFORE M11-17b binds stage B; `refapp-v2` is never moved silently.

**Acceptance:** `jq -e '[.tasks[] | select(.promoted and ([.pipeline[] | select(.verdict != .expected)] | length == 0))] | length == (.confirmatory | length) + (.held_out | length)' task-set.json` exits 0; every gate report's `.source_commit` is the M8-20 commit; `pipeline.md` quotes the non-provisional validate line; `excluded_experiments` lists every `v2-screen-*` experiment.

---

## Integration check (orchestrator)

Per candidate: candidate acceptance, gate acceptance, A9 re-attestation (split and expectations). Per seal: tag object, commit, push time, beacon round and value recorded in the ledger; seal and ledger tags pushed; `screening.ts status` exits 0 (no ledger or chronology problem). Before M8-15b: every prerequisite file present. After each pilot: only pooled status files circulated. After M8-19: selection committed only with `status: ok`. After M8-21: freeze acceptance, tags pushed, `graphify update .`.

## Open questions

Answered for round 3: `unscreenable` approved and three authoring threads accepted (owner, 2026-10-03); ruling 10 allows pushing seal and ledger tags; the `fixture/<name>` form is in the appendix. Still open:

1. Owner (at M8-07b, only if N_prelim is 40): the path freezes about 11-15 with about 1,408 cells at R = 5; cap N_prelim at 30, or accept.
2. Owner (only if M8-15a `heldout` refuses): no held-out set with 2 large tasks and all three coupling styles exists in the start set.

## Review responses (round 1, `review-m8.md`)

All nine findings accepted; none rejected.

1. Cycle: split into M8-15a (seal and held-out, no M11 dependency, feeds stage A) and M8-15b (authorization after stage A).
2. M11 inputs: Common procedure A4/A9 author `measures/measures.yml` with measured expectations; M8-06 authors the reuse and final-code fixtures in a separate `fixtures/` category that the gate checks statically but never requires to fail (M8-01); request to M11 for the `fixture/<name>` variant form.
3. Replacements at freeze: M8-21 re-gates at the M8-20 commit; M8-20 proves the `refapp-v2` refapp tree equals the freeze commit's.
4. Append-only: every seal pins its registry entries and task trees (`appendOnlyProblems` and `treeProblems` per seal), metadata and seed come from a candidate's first seal, and every campaign is bound to the current task identities (`identityProblems`); this covers discarded candidates too.
5. Stale shortfalls: `select` evaluates every quota once, on the final set; new test for the reviewer's example.
6. Campaign handling: `loadScreenCampaigns` reads every `v2-screen-*` campaign from the store (no experiment arguments); `screeningHistory` refuses duplicate ids, two campaigns per experiment, a rescreen of a complete candidate and a third screen; the eligibility transition is computed from the earlier campaigns.
7. Randomness: per-seal drand beacon fixed by rule after a published tag push; ranks of later candidates use their own seal's beacon. Triage workspaces are stripped to AL sources and app.json; order is by judgment id, not `sort` of arm-bearing lines.
8. Schedule: rebaselined against M11 dates (N_prelim 10-20, stage A 10-24), selection after stage B, replacement round after selection, pool factor 2.0, budget arithmetic, and a measured capacity checkpoint (M8-07b). Freeze 11-05 (11-12 with replacements).
9. Held-out (superseded in round 3: every required coupling style): quota-aware pick (2+ large, a new coupling style) and a contamination refusal; `unscreenable` goes to the owner as a missingness rule; M9-12 leakage audit per seal before screening; screening requires the combined r3 image with gate 1 and S1 proven on it (ruling 1).

## Review responses (round 2, `H:\cg-coord\reviews\PLANS-v2-002\review-m8.md`)

| Finding | Response | Where |
| --- | --- | --- |
| R1-1 PARTLY / new 1 BLOCKING: sequencing (selection waits for stage B, stage B waits for selection; 10-24 vs 10-21 decision file; stage A before or after the start tag) | Accepted. One order for all plans (appendix section 11): start seal (M8-15a, 10-21) -> stage A (M11-16, 10-22..24, records the held-out ids) -> screening (M8-15b) -> provisional design M11-17a (11-01) -> M8-19 selection -> freeze -> M11-17b stage-B binding (11-06). One decision-file name: `*-harness-v2-prereg-a.md`, planned `2026-10-24-harness-v2-prereg-a.md`. | Decisions, cross-lane table, M8-15a, M8-15b, M8-19, M8-21 |
| R1-2 PARTLY / new 2 BLOCKING: fixtures incompatible; reuse targets lack `signature`/`perturb`; no token/caught-call fixtures; weights over every oracle row; split decided at final qualification | Accepted. One folder and variant, `fixture/<name>` (M11 changes to it too); A4 targets carry `signature` and `perturb`; M8-06 adds `token-call` and `caught-call`; A9 splits new-requirement vs hidden-regression rows from the first gate report BEFORE the seal; M8-21 Step 4 only verifies the split. | A3, A4, A9, M8-01, M8-06, M8-21 |
| R1-4 PARTLY / new 3 HIGH: ledger mutable; tag resolution trusted; contamination uses present-day membership; chronology unchecked | Accepted. Ledger `v: 2` entries carry tag object, commit, push time, drand chain, round, round time, randomness and `prev` (hash chain); each entry is anchored by its seal tag (ledger before it) and its `-ledger` tag (the entry itself); `ledgerProblems` walks the chain from the tags; `chronologyProblems` refuses a campaign created before its tasks' seal beacon; tamper tests (rewritten entry, rewritten and re-chained entries, moved tag, missing ledger tag) plus a scratch-repo smoke. | Decisions, M8-02 (tests, `SealEntrySchema`, `ledgerProblems`, `chronologyProblems`, `loadSeals`, Step 5b), M8-15a, M8-15c, M8-19 |
| R1-7 PARTLY (seed/ledger immutability, publication before screening) | Accepted; closed by the ledger and chronology checks above. | M8-02 |
| R1-8 PARTLY / new 4 HIGH: pool factor 2.0 vs 1.5; `sim-v1.md` vs `sim-a.md`; 48-candidate wave 4 needs about 16 days; budget assumes 5 repeats | Accepted. Pool factor 2.0 in both plans; `H:\cg-coord\m11\sim-a.md` (10-13); wave 4 takes 6, 10 or 16 days; dates per N_prelim and cell budgets with R from stage B and a 10% rescreen allowance (appendix section 12). | Decisions, Schedule, M8-07b, M8-12 |
| R1-9 PARTLY: held-outs need only one required coupling style | Accepted. `pickHeldOut` requires every required coupling style and 2 large tasks; tests updated; a refusal goes to the owner before stage A. | Decisions, M8-02 |
| (none rejected) | | |

## Round 3 changes

1. Header links the shared interfaces appendix; rulings path is PLANS-v2-002; owner decisions of 2026-10-03 applied (`unscreenable`, three threads, N=40 budget).
2. Seal ledger `v: 2` with hash chain, seal and `-ledger` tags, `ledgerProblems`, `chronologyProblems`, verified `loadSeals`; 28 tests plus Step 5b smoke.
3. `pickHeldOut` requires all three coupling styles.
4. Measurement-only fixtures renamed `fixture/<name>/` (variant `fixture/<name>`); token-call and caught-call fixtures added; reuse targets carry `signature` and `perturb`.
5. Partial-credit split fixed at A9 before the seal; M8-21 Step 4 verifies it.
6. Sequencing: start seal, then stage A (M11-16), then screening; M8-19 takes N from M11-17a; M11-17b binds after the freeze.
7. Pool factor 2.0 shared with M11; capacity and dates per N_prelim (appendix section 12); N_prelim from `sim-a.md` on 10-13.
8. Screening prerequisites name M9-17, M10-09, the r3 revision `"3"` and the stage-A tag and decision file.
