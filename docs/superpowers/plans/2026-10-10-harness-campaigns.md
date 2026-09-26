# Harness Bench M5: talk campaigns (operator runbook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 4** applies the round-3 corrections of gpt-6-astra (`H:\cg-coord\reviews\M5-M6-plans\review3-gpt6astra.md`) as the owner directed: accepted with findings, no further review round. Earlier rounds: `review-gpt6astra.md`, `review2-gpt6astra.md`. Changes per round are listed at the end. Owner decision OD-1 is written in (no top-up).

**Goal:** Between 2026-10-10 and 2026-10-13 run the three talk campaigns (Claude Code MCP arm vs plain, Claude Code skill arm vs plain, Claude Code vs pi on the same model) inside the paid budget and the egress rules, with the 10-14/15 rerun allowance, so M6 can report the primary metric on 10-16.

**Architecture:** `harness run` already runs campaigns (seeded blocks, recorded arm order, automatic retry, usage-limit stop, resume). This plan adds small runner gaps (estimate in `--dry-run`, stop file, campaign-identity pin, manual rerun, report over repeats 1..N), the head-to-head arm, and a staged runbook: pre-flight, stage A (`--sample 1`), stage B (`--repeats 1`), stage C (all repeats), then resume, rejudge and rerun queues.

**Tech Stack:** Deno + TypeScript, Cliffy, Zod 4, `@std/assert`; `src/harness/campaign.ts`, `records.ts`, `outcome.ts`, `report.ts`, `stats.ts`, `cli/commands/harness-command.ts`.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a sections 6, 8, 9, 10). Binding: `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`; `H:\cg-coord\decisions\`: `2026-09-25-m1-metric-rules.md`, `2026-09-25-egress.md` (all addenda), `2026-09-25-five-runs-allocation.md`, `2026-09-26-m1-33s-accepted.md`, `2026-09-26-openrouter-backstop.md`, `2026-09-26-arm-configs.md`, `2026-09-26-m2-13-run1.md`, `2026-09-26-m4-freeze-loaded.md`, `2026-09-25-container-allocation.md`, `spend.md`.

## Global Constraints

- Containers: Cronus281, Cronus282, Cronus283 only, through `coord lease` (lane-ops only). Never start, stop or restart a BC container; a stopped one is `coord ask`.
- Campaigns run only with the `authorized` marker. `harness run` refuses credential-bearing arms without enforcement. A supervised run (M3-09 Branch B, any ledger slot) never authorizes a campaign, and there are no supervised campaigns.
- Concurrency 1 while egress is placed (RULE in `m1-33s-accepted`; the runner refuses `--concurrency > 1` with a placed marker). A raise needs M5-11's preconditions.
- Paid spend: hard stop USD 150 total (aggregate over every provider), owner notified at USD 120. OpenRouter holds USD 60 with no auto-refill and no top-up (owner, OD-1), owner notified at USD 45. Only pi arms spend money. Claude Code arms use the Team OAuth token: their `cost_usd` is a list-price estimate, not money.
- Stopping: `H:\cg-coord\pause.json` is the owner's global pause (README "Global pause") and is never created by this plan. Campaign stops use campaign stop files under `H:\cg-coord\m5\` (template below); every invocation checks both.
- Only the orchestrator writes `H:\cg-coord\decisions\` (including `spend.md`).
- Nothing is ingested: no `bench`, no `sync-catalog --apply`, no `wrangler`, no D1. Records stay under the campaign checkout's `results/harness/` until M6 archives them.
- A usage limit is never a model failure; `harness_crash` before work and `setup_failed` get one automatic retry; a manual rerun never replaces a scored result; a verdict-side fault is rejudged on the same artifact, never repaired by rerunning the agent (metric rules 3, 5; spec 1a section 8).
- Code tasks: TDD, `deno test --allow-all <file>` (never `--parallel`, never `tests/unit/container/`), `deno check`/`lint`/`fmt` on touched files only, `[OK]`/`[FAIL]`/`[PAUSE]` tags, no emoji, no em dash.

## Owner decisions

- **OD-1 OpenRouter (DECIDED by the owner, round 3):** no top-up. cc-vs-pi stops once measured OpenRouter spend projects past USD 45 (paid protocol, rule P3). Recorded by the orchestrator in `decisions/` with the owner's words.

Open (not decided by this plan):

- **OD-2 Campaign checkout:** run from the checkout that holds the M1-34 `authorized` marker (detached at the frozen SHA), or from a fresh job checkout where the marker is re-established per M1-34. Asked at M5-06 Step 1.
- **OD-3 Merge the two Claude Code experiments** into one 3-arm experiment (saves 18 baseline cells; changes the O-1 audited experiment files). Must be decided before stage A; default is the two existing experiments. If merged, the orchestrator first revises M5-01 (experiment file and audit), M5-06 Step 5 and M5-07 to M5-09 (experiment names, commands, cell counts: 54 cells, 18 per arm) before GO.

## Schedule and gate chain (B5)

| Chain | Order | Due |
| --- | --- | --- |
| Credentials | M5-00 ruling: every generation-1 run (slots 1, 2, 3, and slot 5 if Branch B runs before rotation) ends, then M1-34 Step 10 rotates | ruling by 10-03 |
| Egress | M1-34c, then M1-34 Steps 6 to 9, Step 10 rotation (generation 2), Step 11 (slot 4, generation 2, starts after the rotation as the authorization code requires), Step 12 `authorized` | 10-08 |
| pi | M3-08 (base and pi images after M1-33), then M3-09 (Branch A if authorized, else Branch B in slot 5) | 10-09 morning |
| Claude image | M2-13 Step 8 on M3-08's base (run 1 was developmental, not qualification) | 10-09 afternoon |
| Tasks | M4-17 pilot, hardening rulings, M4-14, M4-15 (six qualified, `refapp-v1` pushed) | 10-09 |
| Arms | M5-01 Step 4 on the final image ids | 10-09 evening |
| Pre-flight | M5-06 | 10-09 evening |

Slack is zero on 10-09. Escalation: a link slipping reaches the orchestrator the same day; a projected stage-A start later than 10-11 09:00 (a slip of more than one day) is `coord ask` to the owner with the cut order (items 2 and 3 already applied; item 4 does not shorten campaigns; fewer tasks or dropping pi need the owner).

## Capacity (B2)

Measured inputs:

| Input | Value | Source |
| --- | --- | --- |
| Real Claude Code cell, HX-001: sandbox wall | 8 min 49 s (`wall_ms` 528974); execution record span 8 min 54 s (setup included) | `H:\cg-coord\tasks\M1-29\runs\001\evidence.md` line 39; `H:\cg-coord\jobs\M1-29-1\results\harness\cells\executions\b7af048a-...\4b6764b7-....json` |
| Its verdict | 2 min 0 s (12:19:12.113 to 12:21:11.923) | `H:\cg-coord\jobs\M1-29-1\results\harness\cells\judgments\4b6764b7-...\36218ee1-....json` |
| One `cg-al` compile / test | 10.2 to 10.9 s / 78 to 81 s (single backend operations, not cells) | `H:\cg-coord\tasks\M3-07\runs\00{1,2}\evidence.md` |
| Cell timeout | 30 min | `harness/configs/cc-sonnet-*.yml` |

Limits of these inputs: M1-29 is "GATE NOT CLEAN" (log refused, `harness_crash`, `infra_exposed`, the agent never reached `cg-al`); its USD 0.4269 is in the raw stream only, the published cost is null. HX-001's 2 min verdict is not a bound for HX-002 (mutant scoring), infra retries, staging, cleanup or egress verification. M3-09 measures pi with Flash, not Sonnet. No pi/Sonnet cell exists before stage A.

Cells (planned, before retries): 108 = 3 experiments x 6 tasks x 3 repeats x 2 arms; 90 Claude Code (Team quota), 18 pi (paid). At concurrency 1 they run one after another; the three containers add no parallel workers.

| Scenario per cell | 108 cells | + 15 % retry reserve | Latest start to end by 10-13 20:00 |
| --- | --- | --- | --- |
| 11 min | 19.8 h | 22.8 h | 10-12 21:12 |
| 20 min | 36.0 h | 41.4 h | 10-12 02:36 |
| 32 min | 57.6 h | 66.2 h | 10-11 01:48 |

None of these includes Team usage-limit waits, which are unknown. With stage A at 10-10 09:00, the 32 min scenario ends 10-13 03:12 (16.8 h spare); after a one-day gate slip it ends 10-14 03:12 and eats the rerun allowance. The hard stop for campaign work is 10-15 12:00 (M6-06 needs the data). The go rule uses the measured means from M5-02 with a floor of 20 min per cell until stage B has sampled every task.

## Stop files

| File | Created by | Effect |
| --- | --- | --- |
| `H:\cg-coord\pause.json` | owner only (`containers.ps1 pause`) | global pause, README rules for every lane |
| `H:\cg-coord\m5\stop-all.json` | orchestrator (campaign freeze, M6-06) | every campaign stops at the next cell boundary; other lanes keep working |
| `H:\cg-coord\m5\stop-<experiment>.json` | orchestrator or lane-ops (paid rules P3/P5) | that experiment stops; the others continue |

## Run template (B1, B6, B7)

Every `harness run` invocation, dry runs included, follows this, in the checkout named by OD-2:

1. Write the exact command into the `coord checkpoint` note (side effect recorded first).
2. `DOCKER_CONTEXT=desktop-windows docker inspect -f "{{.State.Running}}" Cronus281 Cronus282 Cronus283` all `true`; otherwise `coord ask`, stop. Skip for `--dry-run`.
3. `coord lease <c> ops` for all three (skip for `--dry-run`); heartbeat each every 5 min until step 5.
4. Run:

```bash
DOCKER_CONTEXT=desktop-windows deno task start harness run <exp> <stage flags> --campaign <id> \
  --concurrency 1 --max-pause-min 0 \
  --stop-file 'H:\cg-coord\pause.json' --stop-file 'H:\cg-coord\m5\stop-all.json' \
  --stop-file 'H:\cg-coord\m5\stop-<exp>.json' \
  --containers Cronus281,Cronus282,Cronus283 --results-dir results/harness \
  --secrets-dir <generation-2 secrets dir from M5-00> \
  2>&1 | tee 'H:\cg-coord\tasks\<task>\runs\<nnn>\<exp>-<stage>-<n>.log'
```

   `--campaign <id>` is omitted only in the stage-A invocation that creates the campaign. For `cc-vs-pi`, `<stage flags>` is always a `--sample <n>` from the paid protocol, never absent, except for a full-plan `--dry-run` (the P2 forecast), which executes nothing. `--max-pause-min 0` makes a usage limit stop the run with a resume line instead of sleeping while leases are held; a stop file ends the run at the next cell boundary (a running cell always finishes).
5. On any exit (OK, stop file, usage stop, error): release all three leases, checkpoint with the summary line. A usage stop: checkpoint `--wait usage` with the reset time; after the reset repeat from step 1.

## Rejudge template (B1, B7)

`harness rejudge` takes neither `--concurrency`, `--max-pause-min` nor `--stop-file`. Steps 1, 2, 3 and 5 of the run template apply; before step 3, lane-ops checks that none of the three stop files exists (a rejudge is one short verdict). Step 4:

```bash
DOCKER_CONTEXT=desktop-windows deno task start harness rejudge <exp> --campaign <id> \
  --execution <execution id> --yes \
  --containers Cronus281,Cronus282,Cronus283 --results-dir results/harness \
  --secrets-dir <generation-2 secrets dir from M5-00> \
  2>&1 | tee 'H:\cg-coord\tasks\<task>\runs\<nnn>\<exp>-rejudge-<execution>.log'
```

`--campaign` on `rejudge` is added by M5-03: it refuses when the id is not the campaign the execution belongs to, and when the visible inputs (task visible-input hashes, arm manifests) differ from the campaign's. An oracle-only change is allowed, since that is what a rejudge is for, provided the orchestrator's decision quotes the owner's approval of the oracle fix (launch contract).

## Paid protocol (B4)

Four separate things, never mixed: the **actual** spend (balance), the **forecast** (an estimate, never a limit), the **reservation** (nominal admission budget) and the **backstop** (the only hard limit).

- **P1 Actual and reconciliation.** Actual OpenRouter spend = USD 60 minus the console balance, read by lane-ops (value quoted, key never shown) before and after every cc-vs-pi invocation. The records sum is `telemetry.reported_cost_usd` of pi executions. The orchestrator writes both into `spend.md`; when they differ by more than USD 1, the larger counts and the difference is noted (other OpenRouter users, M4-17 and M3-09, are in the same balance). `cost_usd` (list price) is never used as money.
- **P2 Forecast.** `forecast = outstanding pi cells x attempts per cell x mean known reported cost per execution`, from M5-02 (`projected_paid_usd` of a cc-vs-pi dry run with `--campaign` and no `--sample`, so it covers every remaining pi cell of the plan). It is labelled a forecast everywhere. `INCOMPLETE` (any unknown paid cost) makes the forecast unusable: P3 then uses the reservation figure (USD 10 per remaining pi cell), which normally fires P3, so an unknown paid cost is first settled from the balance delta of that invocation (P1).
- **P3 Owner stop rule (OD-1).** Before each chunk: if actual + forecast for every remaining pi cell of the plan > USD 45, cc-vs-pi ends with the disposition **stopped (OD-1)**: create `H:\cg-coord\m5\stop-cc-vs-pi.json` and report to the orchestrator, who records the stop time and the last complete repeat. This is a successful terminal disposition of the pi branch, not a failure and not a gate: it never blocks the Claude Code experiments, whose stages, GO rule and acceptance are judged on their own. After the stop no paid execution of any kind (chunk, resume, retry, manual rerun) runs without a **new owner decision**. The last complete repeat is the largest N such that every cell of both cc-vs-pi arms in repeats 1..N is terminal (scored or unscored). Reporting (M6-07): N >= 1 gives a balanced cc-vs-pi-only subset (`--repeats N`) with the excluded work disclosed; no complete repeat gives no pi headline, only a report marked partial and provisional, never `--repeats 0`.
- **P4 Reservation (admission).** A chunk admits `k` new pi cells only if actual + reservation <= USD 60, with reservation = USD 10 for each pi cell in the chunk window that is new or owes a retry (USD 5 `max_budget_usd` for the planned attempt plus USD 5 for one retry). `k` is the largest value <= 3 with actual + USD 10 x (k + owed retries in the window) <= USD 60; `k` = 0 stops cc-vs-pi as in P3. Chunk bounds are cumulative `--sample` values: stage A `--sample 1`, then each chunk `--sample <previous bound + k>`, up to 18. Blocks are repeat-major, so a bound covers the first N blocks. The reservation is nominal: the in-sandbox guard is bypassable (accepted risk), so it is not a hard bound.
- **P5 Backstop.** The USD 60 balance with no auto-refill is the only hard limit. If it runs out, provider errors end cells unscored or pending (never agent failures); lane-ops creates `stop-cc-vs-pi.json`, and cc-vs-pi ends as **stopped (OD-1)** exactly as in P3. Affected cells keep their spend; they are not resumed, rejudged by rerun or manually rerun without a new owner decision.
- **P6 Aggregate cap.** Actual paid spend over every provider + open reservations <= USD 150 at all times; the owner is notified at USD 120 and at OpenRouter USD 45 (launch contract). With no top-up, OpenRouter cannot pass USD 60.
- Nominal ceiling of the whole pi arm: 18 cells x (USD 5 + one USD 5 retry) = USD 180 nominal, far above the balance: P3 and P4 are what keep cc-vs-pi inside USD 60, and P3 is expected to fire if Sonnet cells average above about USD 2.50 (USD 45 / 18).

## Team quota (B6)

90 Claude Code cells draw on the Team account; builders use Max. The Team window and remaining quota are not readable by the harness: M5-06 records them as "unknown" unless the owner gives numbers. After every usage stop, lane-ops recomputes the projection (remaining cells x measured mean + the known wait); if it ends after 10-13 20:00, tell the orchestrator at once (owner escalation if the slip exceeds one day).

## Review Focus

1. **Owner pauses mid-campaign.** Expected: the running cell finishes, no new cell starts, leases released, resume keeps campaign id, seed and block order. Pinned in M5-03.
2. **Resume after a config or task change.** Expected: refused with the drifted field named, never a silent new campaign. Pinned in M5-03 (`--campaign`).
3. **Manual rerun aimed at a scored, pending or unrun cell.** Expected: refused before any container work. Pinned in M5-04.
4. **Estimate with unknown paid costs, open retries or a late rejudge.** Expected: `INCOMPLETE`, retries counted, rejudges ignored, never USD 0 for no data. Pinned in M5-02.
5. **Repeats cut after a shortfall.** Expected: reported and excluded cells and spend both shown. Pinned in M5-05.

---

### Task M5-00 (orchestrator): credential generation ruling (B5)

**Lane:** orchestrator. **Deps:** none. **Date:** by 10-03. **Startable now.**

Contradiction to resolve: the orchestrator handoff says rotate after Step 11 and the pilot slots; the core-part2 plan and the authorization code put the rotation before Step 11. The code decides: `authorizationProblems` (`cli/commands/harness-command.ts:1403-1487`) takes a rotation record `{ v: 1, credentials: [{ name, revoked_at, created_at }] }` naming both `claude-oauth` and `openrouter` (`ROTATED_CREDENTIALS`), computes `rotatedAt` = the latest `revoked_at` or `created_at` in it, and refuses a Step 11 cell that started before `rotatedAt`. So Step 11 runs on generation 2, after the rotation.

- [ ] **Step 1:** Write `H:\cg-coord\decisions\<date>-credential-generations.md`:
  - generation 1 = the pre-enforcement Claude OAuth token and OpenRouter key; its exposures are ledger slots 1, 2, 3 and, only if it runs before the rotation, slot 5 (M3-09 Branch B);
  - the rotation (M1-34 Step 10) happens after the last generation-1 exposure has ended and before Step 11; it revokes generation 1 and creates generation 2 (the rotation record above, names and times only);
  - Step 11 (slot 4) and every campaign use generation 2;
  - M3-09 Branch B after the rotation: only with generation 2 under a `qualified` marker (sandbox placed behind the proxy); without one, `coord ask` (no generation-1 fallback, no sixth slot). This **amends the Branch B credential instructions of the M3 plan** (`docs/superpowers/plans/2026-10-06-harness-pi.md`, Task M3-09 Step 1 "the current pre-rotation OpenRouter benchmark key file" and Step 2B `--secrets-dir <pre-rotation secrets dir>`): those hold only while generation 1 is unrevoked; the ruling names this amendment;
  - the handoff note "rotate after Step 11" is superseded (the ruling says so and cites the code).
  Review with gpt-6-sol (it corrects an orchestrator note, not an accepted plan).
- [ ] **Step 2: Check (used by M5-06 Step 6).** For each generation-1 exposure (ledger line reserved before `rotatedAt`), take the matching execution record's `ended_at` (`results/harness/cells/executions/...`); `last_g1` = the latest. Required: every `created_at` and `revoked_at` in the rotation record >= `last_g1`; the Step 11 cell's `started_at` >= `rotatedAt` (already enforced by the marker); no ledger line after `rotatedAt` except slot 4 and, if used, slot 5 under the Branch B rule above; the campaign `--secrets-dir` holds generation 2 (file modification times >= the matching `created_at`, values never shown).

**Acceptance:** decision file with review path.

---

### Task M5-01 (orchestrator): head-to-head arm, experiment and catalog row

**Lane:** orchestrator (precedent O-1). **Deps:** Steps 1 to 3 none (**startable now**); Step 4 needs the final image ids (M2-13 Step 8, M3-08). **Date:** Steps 1 to 3 by 10-06, Step 4 10-09.

**Files:** Create `harness/configs/pi-sonnet-plain.yml`, `harness/experiments/cc-vs-pi.yml`; modify `site/catalog/models.yml`, `site/catalog/pricing.yml` (local rows, never `sync-catalog --apply`).

- [ ] **Step 1:** Check the slug live: `deno task start models -p openrouter --live`, then `deno task start models <slug> --check` for the OpenRouter route of `anthropic/claude-sonnet-5`. Add the rows with list prices equal to the Anthropic row of that model and a source comment.
- [ ] **Step 2:** `pi-sonnet-plain.yml` = `pi-flash-plain.yml` with `id: pi-sonnet-plain`, `models.main: <checked slug>`, `limits: { timeout_min: 30, max_budget_usd: 5 }` (equal to `cc-sonnet-plain`).
- [ ] **Step 3:** `cc-vs-pi.yml`:

```yaml
# Talk head-to-head: same model, same instructions bundle, same limits; harness differs.
id: cc-vs-pi
hypothesis: "On the HX tasks with the same model and instructions, pi and Claude Code differ in cost per solved task."
primary_metric: cost_per_solved_task
baseline: cc-sonnet-plain
variants: [pi-sonnet-plain]
vary: [harness, harness_version, models]
tasks: "harness-tasks/tasks/*"
repeats: 3
```

- [ ] **Step 4 (final images):** `harness validate` `[OK]` for the three talk experiments; resolve all arms against the final images (O-1 resolver) and quote manifest hashes, `diffManifests`, `assertVaryHolds`. A difference outside `vary` is a reviewed decision, never a silent widening.

**Acceptance:** validate `[OK]`; decision `<date>-cc-vs-pi-arm.md` with hashes and gpt-6-sol review path.

---

### Task M5-02: estimate in `harness run --dry-run` (B3, spec 1a section 6)

**Lane:** infra2 (first of M5-02, M5-03, M5-04; same files, integrate in that order). **Deps:** none. **Date:** 10-02 to 10-05. **Startable now.**

**Files:** Create `src/harness/estimate.ts`, `tests/unit/harness/estimate.test.ts`; modify `src/harness/campaign.ts` (dry-run branch), `src/harness/records.ts` (`RecordStore.allExecutions()`), `tests/unit/harness/campaign.test.ts`.

**Interfaces (produces):**

```typescript
export interface PriorExecution {
  arm_manifest_hash: string;
  cell: string;                 // `${campaign_id}:${task}#${repeat}`
  exec_ms: number;              // ended_at - started_at of the execution
  verdict_ms: number | null;    // FIRST judgment of the execution only (a later rejudge is ignored)
  list_cost_usd: number | null; // telemetry.cost_usd
  paid_cost_usd: number | null; // telemetry.reported_cost_usd
}
export interface ArmPlan { arm: string; manifest_hash: string; paid: boolean; outstanding_cells: number }
export interface ArmEstimate extends ArmPlan {
  samples: number; cells_sampled: number; attempts_per_cell: number | null;
  exec_ms_mean: number | null; verdict_ms_mean: number | null;
  unknown_list_cost: number; unknown_paid_cost: number;
  projected_ms: number | null; projected_paid_usd: number | null;
  complete: boolean; // samples > 0, verdict mean known, and (paid => unknown_paid_cost === 0)
}
export function estimateArms(arms: ArmPlan[], prior: PriorExecution[]): ArmEstimate[];
export function renderEstimate(es: ArmEstimate[]): string[];
```

`projected_ms = outstanding x attempts_per_cell x (exec_ms_mean + verdict_ms_mean)`; `projected_paid_usd = outstanding x attempts_per_cell x mean(known paid_cost_usd)` for paid arms, else null. `outstanding_cells` = selected cells whose status is `unrun` or `pending` (`cellsFromRecords`), so open retries and missing judgments count.

- [ ] **Step 1: Failing tests** (`estimate.test.ts`):

```typescript
import { assert, assertEquals } from "@std/assert";
import { estimateArms, renderEstimate } from "../../../src/harness/estimate.ts";

const arm = (o = {}) => ({ arm: "a", manifest_hash: "h1", paid: false, outstanding_cells: 10, ...o });
const ex = (o = {}) => ({ arm_manifest_hash: "h1", cell: "c:T#1", exec_ms: 600_000, verdict_ms: 120_000, list_cost_usd: 1, paid_cost_usd: 1, ...o });

Deno.test("estimate: other manifests ignored; retries raise attempts per cell", () => {
  const [e] = estimateArms([arm()], [ex(), ex({ cell: "c:T#2" }), ex({ cell: "c:T#2" }), ex({ arm_manifest_hash: "x" })]);
  assertEquals([e!.samples, e!.cells_sampled, e!.attempts_per_cell], [3, 2, 1.5]);
  assertEquals(e!.projected_ms, 10 * 1.5 * 720_000);
});

Deno.test("estimate: paid arm with all or some unknown paid cost is INCOMPLETE", () => {
  const [all] = estimateArms([arm({ paid: true })], [ex({ paid_cost_usd: null })]);
  assertEquals([all!.projected_paid_usd, all!.complete], [null, false]);
  const [some] = estimateArms([arm({ paid: true })], [ex(), ex({ cell: "c:T#2", paid_cost_usd: null })]);
  assertEquals([some!.unknown_paid_cost, some!.complete], [1, false]);
  assert(renderEstimate([some!]).join("\n").includes("INCOMPLETE"));
});

Deno.test("estimate: no samples is no estimate, never $0; zero outstanding is an explicit 0", () => {
  const [none] = estimateArms([arm()], []);
  const text = renderEstimate([none!]).join("\n");
  assert(text.includes("no prior executions") && !text.includes("$0"));
  const [done] = estimateArms([arm({ outstanding_cells: 0 })], [ex()]);
  assertEquals([done!.projected_ms, done!.complete], [0, true]);
});
```

Plus in `campaign.test.ts`: a late rejudge (second judgment hours later) does not change `verdict_ms_mean`; a pending cell (owed automatic retry after `mock-crash`) counts as outstanding; a second experiment sharing the baseline manifest borrows its samples through `allExecutions()`.
- [ ] **Step 2: Implement** `estimate.ts` (pure) and the dry-run wiring. `paid` = the arm's config names a model under `openrouter/` (`// ponytail: provider prefix as the paid flag; add a config field if a paid non-OpenRouter route appears`). Lines: `[DRY] estimate <arm>: <outstanding> cells x <attempts> attempts x <min> min = <h> h; paid $<p> | INCOMPLETE (<reason>) | no prior executions of this manifest`, then `[DRY] total <h> h at concurrency 1; paid projected $<sum> | unknown`.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): estimate in harness run --dry-run`.

**Acceptance (orchestrator):** tests and `tests/unit/harness/` green (`--ignore=tests/unit/container`); a dry run with `--results-dir H:\cg-coord\jobs\M1-30-1\results\harness --secrets-dir <any empty dir>` on `mock-contract` prints estimate lines with 2 samples per arm.

---

### Task M5-03: `--stop-file` and `--campaign` on run and rejudge (B6, B7)

**Lane:** infra2, after M5-02. **Deps:** none. **Date:** 10-04 to 10-06. **Startable now** (after M5-02 on the same lane).

**Files:** modify `src/harness/campaign.ts` (`RunOptions.stopFiles?: string[]`, `RunOptions.campaign?: string`, `CampaignSummary.stopped: boolean`), `cli/commands/harness-command.ts` (`--stop-file <path>` repeatable and `--campaign <id>` on `run`; `--campaign <id>` on `rejudge`, forwarded to `harnessRejudge`), `tests/unit/harness/campaign.test.ts`, `tests/unit/cli/commands/harness-command.test.ts`.

- [ ] **Step 1: Failing tests:**

```typescript
Deno.test("a stop file stops between cells; present at start runs nothing; resume keeps id, seed and order", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"], "[settings]", 2);
  const pause = join(t.repo.root, "pause.json"); // never created: the global pause is only checked
  const stop = join(t.repo.root, "stop-contract.json");
  await Deno.writeTextFile(stop, "{}");
  const idle = await runCampaign(t.env, "contract", opts({ stopFiles: [pause, stop] }), io());
  assertEquals([idle.ran, idle.stopped, t.docker.runs.length], [0, true, 0]);
  await Deno.remove(stop);
  let n = 0;
  t.env.hooks = { beforeDraft: async () => { if (++n === 1) await Deno.writeTextFile(stop, "{}"); } };
  const out = io();
  const s = await runCampaign(t.env, "contract", opts({ stopFiles: [pause, stop] }), out);
  assertEquals([s.ran, s.stopped], [1, true], "the running cell finished, no new one started");
  assert(out.lines.some((l) => l.includes("resume with: centralgauge harness run contract")));
  const before = (await t.env.store.campaigns("contract"))[0]!;
  await Deno.remove(stop);
  t.env.hooks = {};
  const again = await runCampaign(t.env, "contract", opts({ stopFiles: [pause, stop], campaign: before.id }), io());
  const after = (await t.env.store.campaigns("contract"))[0]!;
  assertEquals([again.stopped, after.id, after.seed, after.blocks], [false, before.id, before.seed, before.blocks]);
});

Deno.test("--campaign refuses drift and unknown ids before any write", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"]);
  await runCampaign(t.env, "contract", opts(), io());
  const c = (await t.env.store.campaigns("contract"))[0]!;
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"], "[settings]", 2); // experiment hash changes
  await assertRejects(() => runCampaign(t.env, "contract", opts({ campaign: c.id }), io()), ConfigurationError, "experiment_hash");
  await assertRejects(() => runCampaign(t.env, "contract", opts({ campaign: "00000000-0000-0000-0000-000000000000" }), io()), ConfigurationError, "no campaign");
  assertEquals((await t.env.store.campaigns("contract")).length, 1);
});
```

Rejudge pin (`harness-command.test.ts`, two campaigns of one experiment built with the existing fixtures):
  - `harnessRejudge(exp, { campaign: <older id>, execution: <id in the older campaign> })` judges that execution although a newer campaign exists (today the newest is picked);
  - `--campaign <older id> --execution <id of the newer campaign>` is refused with `is not in campaign` before any container work;
  - `--campaign <unknown id>` is refused with `no campaign`.

CLI tests: `harnessRun` forwards two `--stop-file` values and `--campaign` into `runCampaign`; `harness rejudge` parses and forwards `--campaign` (existing planner-injection pattern at `harness-command.test.ts:1170`). Run: FAIL.
- [ ] **Step 2: Implement.** Stop files: each checked before each `runCell` and before the first block; log `[PAUSE] stop file <path> present; resume with: centralgauge harness run <experiment> --campaign <id>`. Rejudge: with `--campaign`, `harnessRejudge` uses that campaign of the experiment instead of the newest, and refuses an `--execution` outside it. Campaign pin: when `o.campaign` is set, the campaign found by the existing lookup must have that id; otherwise refuse, naming each of `experiment_hash`, `task_set.identity`, `arms[].manifest_hash` that differs from the named campaign's record (or `no campaign <id>`). Never create a campaign when `campaign` is set.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): --stop-file and --campaign for run, --campaign for rejudge`.

**Acceptance:** tests green; `tests/unit/harness/` and the CLI test file green.

---

### Task M5-04: manual rerun of an unscored cell (B8)

**Lane:** infra2, after M5-03. **Deps:** none. **Date:** 10-06 to 10-07. **Startable now** (lane order).

`runCell` already takes `runKind: "manual_rerun"` and the report shows the execution each cell used; only the entry point is missing.

**Files:** modify `src/harness/campaign.ts` (`RunOptions.rerun?: { task: string; repeat: number; arm: string }`), `cli/commands/harness-command.ts` (`--rerun <task:repeat:arm>`), both test files.

- [ ] **Step 1: Failing tests:**
  - `--rerun` on an exhausted `mock-crash` cell writes exactly one new root `[3, "manual_rerun"]` (plus its owed automatic retry only), no other cell gets an execution, records validate, and `buildReport` keeps both attempts' spend in the cell and names the used execution.
  - Refusals before any container run, each with its message: scored pass (`is scored`), scored fail (`is scored`), pending (a `usage_limited` tail with a future reset: `is pending`), unrun (`--sample 1` then a cell of block 2: `is unrun`), unknown (`no such cell`).
  - CLI: `--rerun HX-001:1:mock-crash` parses; `HX-001:x:arm` and `HX-001:1` are refused by the parser.
- [ ] **Step 2: Implement:** resolve block and arm or refuse; status from `cellsFromRecords` on the loaded campaign; only `unscored` passes; run that cell with `{ attempt: max(prior attempt) + 1, runKind: "manual_rerun", retryOf: null }`; nothing else runs in that invocation.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): harness run --rerun for an unscored cell`.

**Acceptance:** tests green; `tests/unit/harness/` green.

---

### Task M5-05: report over repeats 1..N (capacity-cut contingency)

**Lane:** infra, strictly after M1-34c (critical path). **Deps:** none. **Date:** by 10-09. **Startable now, low priority.** M6-02 consumes the fields below.

**Files:** modify `src/harness/report.ts` (`ReportOptions.repeats?: number`), `cli/commands/harness-command.ts` (`report --repeats <n>`), `tests/unit/harness/report.test.ts`.

**Produces (JSON):** `repeats: { planned: number; reported: number }` at top level; per arm in `coverage`: `excluded_cells: number`, `excluded_known_spend_usd: number`, `campaign_raw_spend_usd: number` (all repeats). Metrics (`arms`, `comparisons`, `flips`, `efficiency`, `slices`, `both_pass`) and the rest of `coverage` use repeats 1..N only.

- [ ] **Step 1: Failing tests:** records with `repeats: 3`; arm A has repeats 1 to 3 scored, arm B repeats 1 and 2 scored and 3 unrun, and A's repeat-3 attempts cost USD 2. With `{ repeats: 2 }`: `provisional` false, `repeats` `{3, 2}`, A `excluded_cells` 6 and `excluded_known_spend_usd` 2, `campaign_raw_spend_usd` = reported spend + 2, pass^k over k = 2, coverage executions count repeats 1..2 only. Without the option: `provisional` true. `repeats: 0` or `4`: `ValidationError`.
- [ ] **Step 2: Implement:** filter cells and executions by repeat before summaries; compute the excluded figures from the rest; the rendered header prints `Repeats reported: N of <planned>; excluded <cells> cells, $<spend> spend` when N is below the plan.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): harness report --repeats with excluded work disclosed`.

**Acceptance:** tests green. Used in two cases only: (1) an owner decision to cut repeats for capacity, applied to all arms of every experiment alike; (2) cc-vs-pi alone after its OD-1 stop with N >= 1 complete repeats (P3), which cuts only that experiment, both arms alike. `--repeats 0` is never used.

---

### Task M5-06 (ops): pre-flight

**Lane:** ops. **Deps:** M5-00 (ruling and rotation done), M1-34 (marker `authorized`), M3-08, M3-09, M2-13 (Step 8 accepted), M4-15, M5-01 (Step 4 done), M5-02, M5-03, M5-04 (integrated). **Date:** 10-09 evening.

Evidence `H:\cg-coord\tasks\M5-06\runs\<nnn>\preflight.md`, one quoted output per check.

- [ ] **Step 1: Checkout (OD-2).** Quote the owner's answer, `git rev-parse HEAD` (the SHA the orchestrator names) and `git status --short` (empty apart from `results/`).
- [ ] **Step 2: Marker.** `jq -r .state results/harness/egress-verified.json` is `authorized`; `deno task start harness egress verify` prints `[OK]` non-elevated.
- [ ] **Step 3: Images by id.** `DOCKER_CONTEXT=desktop-windows docker image inspect -f "{{.Id}}" centralgauge/harness-base:1 centralgauge/harness-claude-code:2.1.282 centralgauge/harness-pi:0.87.1` equals the ids in the M2-13 Step 8 and M3-08 acceptance decisions and M5-01 Step 4.
- [ ] **Step 4: Tasks.** `deno task start harness validate` prints `[OK] 6 tasks, task set <hash>` without `provisional`; `<hash>` equals `task_set_hash` in `H:\Temp3\harness-spike\M4\freeze\task-set.json`.
- [ ] **Step 5: Dry runs** (run template, `--dry-run`, no `--campaign`) for the experiments of OD-3: 36 planned cells each (54 for a merged experiment), a new campaign each, estimate lines present (no prior samples yet except M1-29 if in the same results root).
- [ ] **Step 6: State.** Containers running; `coord holder` free for all three; owner-label `docker ps -a` empty; no `results/.bench-running.json` younger than 2 min; the M5-00 Step 2 check; `spend.md` totals and the OpenRouter console balance (P1); Team quota line ("unknown" or the owner's numbers); `H:\cg-coord\m5\` exists and holds no stop file; disk free on the results drive at least 50 GB.

**Acceptance (orchestrator):** decision `2026-10-09-campaign-preflight.md` with SHA, image ids, task-set hash, OD-2 and OD-3 answers, budget and balance.

---

### Task M5-07 (ops): stage A and the go decision

**Lane:** ops. **Deps:** M5-06 accepted, OD-3 answered. **Date:** 10-10 from 09:00.

- [ ] **Step 1:** Run template with `--sample 1` for each experiment, order `cc-mcp-vs-plain`, `cc-skills-vs-plain`, `cc-vs-pi` (P1 and P4 before the last). New cells: 6 (5 Claude Code, 1 pi); cumulative 2 per experiment.
- [ ] **Step 2:** Record each new campaign id and seed; from here every invocation passes `--campaign <id>`.
- [ ] **Step 3:** Dry run (run template) per experiment without `--sample`; save the estimate lines to `estimate.md` with the pi actual spend (P1), the pi forecast labelled as a forecast (P2), and hours for all outstanding cells using max(measured mean, 20 min) per cell.
- [ ] **Step 4:** Per stage-A execution quote termination, verdict, `cost_usd`, `reported_cost_usd`, `infra_exposed`, `incomplete_telemetry`; owner-label `docker ps -a` empty.
- [ ] **Step 5: Go rule.** Per experiment: GO for stage B when (a) every arm's time estimate is known (an arm line saying "no prior executions" or `INCOMPLETE` for time blocks GO; for cc-vs-pi paid cost an `INCOMPLETE` or "no prior executions" paid figure is handled only through the P2 reservation below, never read as zero; M5-02 review finding), (b) projected hours with the 15 % reserve end before 10-13 20:00 and (c) no cell is terminally unscored; otherwise `coord ask` with `estimate.md`. For cc-vs-pi, P3 is also evaluated (an `INCOMPLETE` forecast is replaced by the reservation figure, P2): if it fires, cc-vs-pi takes the disposition **stopped (OD-1)** and the Claude Code experiments still get their GO on (b) and (c).

**Acceptance (orchestrator):** stage-A spend in `spend.md`; decision `2026-10-10-campaign-go.md` with the campaign ids and, per experiment, GO, the question, or (cc-vs-pi) stopped (OD-1).

---

### Task M5-08 (ops): stage B, repeat 1

**Lane:** ops. **Deps:** M5-07 GO. **Date:** 10-10 to 10-11.

- [ ] **Step 1:** Run template with `--repeats 1` for the two Claude Code experiments; cc-vs-pi in P4 chunks up to `--sample 6` (P1, P3, P4 before each). New cells: 30; cumulative 12 per experiment (6 per arm), fewer for cc-vs-pi if P3 fired.
- [ ] **Step 2:** Usage stop, stop file, errors: per run-template step 5; recompute the Team projection after each usage stop.
- [ ] **Step 3: Capacity check** after each experiment (dry-run estimate); a projection past 10-13 20:00 goes to the orchestrator at once. Levers: M5-11 if its preconditions hold, then an owner decision to cut repeats (M5-05).
- [ ] **Step 4: Evidence** per experiment `<exp>-B.md`: campaign id, seed, planned cells, executions (planned, automatic retries), cells by status (scored, unscored, pending, unrun), usage stops with times, `infra_exposed` per arm, paid spend and balance, `harness report <exp> --campaign <id> --judging campaign` text and `--json`, owner-label containers 0.

**Acceptance (orchestrator):** each Claude Code experiment: 12 planned cells attempted (6 per arm); cc-vs-pi: 12 planned cells attempted or its recorded **stopped (OD-1)** disposition with the cells attempted before the stop; executions may exceed planned cells by retries; pending and unscored cells listed; spend recorded.

---

### Task M5-09 (ops): stage C, repeats 2 and 3

**Lane:** ops. **Deps:** M5-08 accepted. **Date:** 10-11 to 10-13.

- [ ] **Step 1:** Run template without `--sample`/`--repeats` for the Claude Code experiments; cc-vs-pi in P4 chunks up to `--sample 18` (P1, P3, P4 before each). New cells: 72; cumulative 36 per experiment (18 per arm), fewer for cc-vs-pi if P3 fired.
- [ ] **Step 2:** Same handling and evidence as M5-08 (`<exp>-C.md`).

**Acceptance (orchestrator):** 36 planned cells per experiment attempted (cc-vs-pi: up to its P3 stop, recorded); statuses listed; decision `2026-10-13-campaigns-done.md`.

---

### Task M5-10 (ops): resume, rejudge and rerun queues (B8)

**Lane:** ops. **Deps:** M5-09. **Date:** 10-14 to 10-15 12:00.

- [ ] **Step 1: Classify** every non-scored cell from `harness report <exp> --campaign <id> --judging campaign --json` (`cells`) plus its last execution:
  - **Resume:** `unrun`, or `pending` with a `usage_limited` tail or an owed automatic retry. Action: the run template. Claude Code experiments: no selection flags. cc-vs-pi: first the interrupted chunk with its own `--sample` bound, then further P4 chunks computed from the outstanding pi cells including owed retries; never without `--sample`. After a **stopped (OD-1)** disposition nothing paid runs in any queue without a new owner decision.
  - **Rejudge:** `pending` whose last execution was judged-eligible but has no scored judgment (verdict-side fault). Action: the rejudge template (`--campaign <id> --execution <id>`); the agent is never rerun for this.
  - **Manual rerun:** `unscored` (automatic retry spent: `setup_failed` or pre-work `harness_crash` twice). Action: orchestrator approval per cell in a decision file, then the run template with `--rerun <task>:<repeat>:<arm>` (P1, P3, P4 for a pi cell, counted as one new cell; none after the OD-1 stop without a new owner decision).
- [ ] **Step 2:** Work the queues in that order; rerender the reports; evidence lists every action with the execution the report now uses. Every attempt's spend stays in the cell.

**Acceptance (orchestrator):** each queue's list and outcome; approvals for manual reruns; handover to M6-06 by 10-15 12:00.

---

### Task M5-11 (ops, conditional): concurrency raise

**Lane:** ops. **Deps:** M1-33d accepted, lane-ops proofs P1 and P2 accepted, orchestrator decision lifting the refusal (PROXY_ISOLATION gate). **Date:** only when M5-08 Step 3 shows a shortfall.

- [ ] **Step 1:** Stop at a cell boundary with `H:\cg-coord\m5\stop-<exp>.json`, remove it, rerun the run template with `--concurrency 3`.
- [ ] **Step 2:** Evidence: per-execution proxy registrations of the first concurrent cells (M1-33d records), no cross-execution violation, `order_in_block` unchanged, the switch time (the report evidence notes both load levels).

**Acceptance (orchestrator):** decision naming the switch time.

---

## Acceptance case: P3 fires right after stage A

Walked through at M5-07 by the orchestrator (a tabletop check on the plan, and repeated with mock records in M6-05). Assume the stage-A pi execution reports about USD 3, so the P2 forecast for the 17 remaining pi cells is about USD 51 and P3 fires before the first stage-B chunk. Expected:

| Step | Expected outcome |
| --- | --- |
| M5-07 Step 5 | cc-vs-pi: stopped (OD-1), `stop-cc-vs-pi.json` created, stop time recorded, last complete repeat none. Claude Code experiments: GO on (b) and (c) alone. |
| M5-08, M5-09 | Claude Code experiments run to 12, then 36 cells and meet their acceptance; cc-vs-pi runs nothing (its stop file ends any invocation at once) and is accepted as stopped (OD-1) with its 2 stage-A cells. |
| M5-10 | No cc-vs-pi queue work; no paid execution without a new owner decision. |
| M6-07 | cc-vs-pi report generated without `--repeats`, provisional, marked partial; no pi headline and no pi chart in `charts\`; `ledger.json` `pi_stop` fired with `last_complete_repeat: null`; the handoff states that the head-to-head stopped after stage A under OD-1 and gives the stage-A spend. |
| Spend | OpenRouter actual about USD 3; nothing reserved after the stop. |

## Startable now

- M5-00 (orchestrator).
- M5-01 Steps 1 to 3 (orchestrator); Step 4 waits for the final image ids.
- M5-02 (already loaded), then M5-03, then M5-04 (infra2, one lane in this order: they touch the same runner and CLI files).
- M5-05 (infra, only behind M1-34c).

## Findings addressed (round 1)

B1: run template with `--secrets-dir` on every command, per-stage cell counts (M5-07 to M5-09). B2: corrected inputs and limits, scenario table with reserve and latest start. B3: M5-02 rewritten (outstanding cells, attempts per cell, first judgment only, paid basis, `INCOMPLETE`). B4: paid protocol. B5: M5-00 and the schedule table. B6: template (lease per invocation, `--max-pause-min 0`), Team quota section. B7: `--campaign` in M5-03 and in every command. B8: M5-10 queues and M5-04 refusals. N1: startable-now qualifiers. N2: tests added in M5-02 to M5-05.

## Review round 1: not adopted

- B6, "make usage waits pause-aware": adopted by a different mechanism. Campaigns run with `--max-pause-min 0`, so the runner never sleeps on a usage limit; it exits, leases are released, and the next invocation resumes. The in-process wait stays unused, so no code change to the sleep.
- B4 (round 1 text withdrawn in rev 3): the claim that chunks bound exposure to USD 15 was wrong; see the paid protocol P1 to P6.
- N2, "stop file during usage sleep" test: not written, because campaigns no longer sleep (see B6 above).

## Review round 2: changes (rev 3)

- Blocker 1 / B4 (paid): paid protocol rewritten as P1 actual and reconciliation, P2 forecast (labelled, never a limit), P3 owner stop rule at USD 45 (OD-1 decided: no top-up), P4 retry-inclusive reservation (USD 10 per new or owed pi cell) sizing the chunks, P5 balance backstop, P6 USD 150 aggregate cap.
- Blocker 2 / B5 (credentials): M5-00 follows the authorization code (rotation before Step 11, Step 11 on generation 2); its check compares the rotation times with the last generation-1 exposure, not the whole ledger; Branch B after the rotation only with generation 2 under a `qualified` marker.
- Blocker 3 / B1, B7 (rejudge): separate rejudge template; M5-03 adds `--campaign` to `rejudge` with tests; `DOCKER_CONTEXT=desktop-windows` prefixes both harness commands.
- New N1: M5-06 lists its predecessor tasks explicitly.
- New N2: M5-10 resume for cc-vs-pi goes through bounded P4 chunks, interrupted chunk first, never an unbounded paid run.
- New N3: campaign stop files under `H:\cg-coord\m5\` (per experiment and `stop-all`); `pause.json` is only checked, never created by this plan; `--stop-file` is repeatable (M5-03).
- OD-3: a merge now requires revised names, commands and counts before GO.
- M5-02 (loaded task): unchanged. P2 and P3 use its existing `projected_paid_usd` from a dry run over the whole plan (no `--sample`).

## Review round 2: not adopted

None.

## Review round 3: changes (rev 4, owner-directed, no further review)

- OD-1 stop: P3 and P5 make **stopped (OD-1)** a successful terminal disposition of the pi branch that never blocks the Claude Code experiments; no complete repeat means no pi headline and a partial, provisional report (never `--repeats 0`); N >= 1 complete repeats means a balanced cc-vs-pi-only subset with excluded work disclosed; no paid execution after the stop without a new owner decision (orchestrator reopen removed from P5 and M5-10). M5-05 acceptance, M5-07 Step 5 and acceptance, M5-08 acceptance updated; new "Acceptance case: P3 fires right after stage A".
- Rejudge wording: pinning and visible-input checks stay; an owner-approved oracle-only change is allowed.
- Run template: full-plan `--dry-run` exempt from the cc-vs-pi `--sample` rule.
- M5-00: names the amendment of the M3-09 Branch B credential instructions.
- M5-02 (implemented): unchanged.
