# Harness Bench M5: talk campaigns (operator runbook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2** after gpt-6-astra round 1 (`H:\cg-coord\reviews\M5-M6-plans\review-gpt6astra.md`, REJECT). Blocking findings B1 to B8 are closed in the sections named at the end.

**Goal:** Between 2026-10-10 and 2026-10-13 run the three talk campaigns (Claude Code MCP arm vs plain, Claude Code skill arm vs plain, Claude Code vs pi on the same model) inside the paid budget and the egress rules, with the 10-14/15 rerun allowance, so M6 can report the primary metric on 10-16.

**Architecture:** `harness run` already runs campaigns (seeded blocks, recorded arm order, automatic retry, usage-limit stop, resume). This plan adds small runner gaps (estimate in `--dry-run`, stop file, campaign-identity pin, manual rerun, report over repeats 1..N), the head-to-head arm, and a staged runbook: pre-flight, stage A (`--sample 1`), stage B (`--repeats 1`), stage C (all repeats), then resume, rejudge and rerun queues.

**Tech Stack:** Deno + TypeScript, Cliffy, Zod 4, `@std/assert`; `src/harness/campaign.ts`, `records.ts`, `outcome.ts`, `report.ts`, `stats.ts`, `cli/commands/harness-command.ts`.

**Spec:** `docs/superpowers/specs/2026-09-24-harness-bench-design.md` (1a sections 6, 8, 9, 10). Binding: `docs/superpowers/runbooks/harness-autonomy/launch-contract.md`; `H:\cg-coord\decisions\`: `2026-09-25-m1-metric-rules.md`, `2026-09-25-egress.md` (all addenda), `2026-09-25-five-runs-allocation.md`, `2026-09-26-m1-33s-accepted.md`, `2026-09-26-openrouter-backstop.md`, `2026-09-26-arm-configs.md`, `2026-09-26-m2-13-run1.md`, `2026-09-26-m4-freeze-loaded.md`, `2026-09-25-container-allocation.md`, `spend.md`.

## Global Constraints

- Containers: Cronus281, Cronus282, Cronus283 only, through `coord lease` (lane-ops only). Never start, stop or restart a BC container; a stopped one is `coord ask`.
- Campaigns run only with the `authorized` marker. `harness run` refuses credential-bearing arms without enforcement. A supervised run (M3-09 Branch B, any ledger slot) never authorizes a campaign, and there are no supervised campaigns.
- Concurrency 1 while egress is placed (RULE in `m1-33s-accepted`; the runner refuses `--concurrency > 1` with a placed marker). A raise needs M5-11's preconditions.
- Paid spend: hard stop USD 150 total, owner notified at USD 120. OpenRouter holds USD 60 with no auto-refill, owner notified at USD 45. Only pi arms spend money. Claude Code arms use the Team OAuth token: their `cost_usd` is a list-price estimate, not money.
- Only the orchestrator writes `H:\cg-coord\decisions\` (including `spend.md`).
- Nothing is ingested: no `bench`, no `sync-catalog --apply`, no `wrangler`, no D1. Records stay under the campaign checkout's `results/harness/` until M6 archives them.
- A usage limit is never a model failure; `harness_crash` before work and `setup_failed` get one automatic retry; a manual rerun never replaces a scored result; a verdict-side fault is rejudged on the same artifact, never repaired by rerunning the agent (metric rules 3, 5; spec 1a section 8).
- Code tasks: TDD, `deno test --allow-all <file>` (never `--parallel`, never `tests/unit/container/`), `deno check`/`lint`/`fmt` on touched files only, `[OK]`/`[FAIL]`/`[PAUSE]` tags, no emoji, no em dash.

## Owner decision points (not decided by this plan)

- **OD-1 OpenRouter:** top up the OpenRouter balance, or stop the pi arm when OpenRouter spend plus the next chunk's worst case would pass USD 45. Asked by M5-01 Step 5 before 10-10; re-asked by the paid protocol when the rule fires. The USD 150 aggregate cap stays either way.
- **OD-2 Campaign checkout:** run from the checkout that holds the M1-34 `authorized` marker (detached at the frozen SHA), or from a fresh job checkout where the marker is re-established per M1-34. Asked at M5-06 Step 1.
- **OD-3 Merge the two Claude Code experiments** into one 3-arm experiment (saves 18 baseline cells; changes the O-1 audited experiment files). Must be decided before stage A; default is the two existing experiments.

## Schedule and gate chain (B5)

| Chain | Order | Due |
| --- | --- | --- |
| Credentials | M5-00 ruling, then the rotation it names | ruling by 10-03 |
| Egress | M1-34c, then M1-34 Steps 6 to 9, rotation (M5-00), Step 11 (slot 4), Step 12 `authorized` | 10-08 |
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

## Invocation template (B1, B6, B7)

Every `harness run` / `rejudge` invocation, dry runs included, follows this, in the checkout named by OD-2:

1. Write the exact command into the `coord checkpoint` note (side effect recorded first).
2. `DOCKER_CONTEXT=desktop-windows docker inspect -f "{{.State.Running}}" Cronus281 Cronus282 Cronus283` all `true`; otherwise `coord ask`, stop. Skip for `--dry-run`.
3. `coord lease <c> ops` for all three (skip for `--dry-run`); heartbeat each every 5 min until step 5.
4. Run:

```bash
deno task start harness run <exp> <stage flags> --campaign <id> \
  --concurrency 1 --max-pause-min 0 --stop-file 'H:\cg-coord\pause.json' \
  --containers Cronus281,Cronus282,Cronus283 --results-dir results/harness \
  --secrets-dir <generation-2 secrets dir from M5-00> \
  2>&1 | tee 'H:\cg-coord\tasks\<task>\runs\<nnn>\<exp>-<stage>-<n>.log'
```

   `--campaign <id>` is omitted only in the stage-A invocation that creates the campaign. `--max-pause-min 0` makes a usage limit stop the run with a resume line instead of sleeping while leases are held; the stop file ends the run at the next cell boundary (a running cell always finishes).
5. On any exit (OK, stop file, usage stop, error): release all three leases, checkpoint with the summary line. A usage stop: checkpoint `--wait usage` with the reset time; after the reset repeat from step 1.

## Paid protocol (B4)

- Paid basis: `telemetry.reported_cost_usd` of pi executions (pi's own `usage.cost.total`, what OpenRouter charges), not the list-price `cost_usd`. A null reported cost counts as the cell's `max_budget_usd` (USD 5) until the balance reading reconciles it.
- Before every paid invocation lane-ops quotes the OpenRouter credit balance from the console (never the key) and the records sum; the orchestrator reconciles both into `spend.md` (other OpenRouter users, M4-17 and M3-09, are in the same ledger; the balance is the ground truth).
- cc-vs-pi runs in chunks of at most 3 new pi cells: `--sample 1` (stage A), `--sample 4`, `--sample 6` (stage B end), `--sample 9`, `12`, `15`, `18` (stage C). Blocks are repeat-major, so these are the plan's first N blocks.
- Before each chunk: continue only if OpenRouter spent + worst case of the chunk <= USD 45 and total paid + worst case <= USD 120. Worst case = 3 x USD 5 until 3 pi executions with known cost exist, then 3 x max(1.5 x measured mean, USD 1). Otherwise stop and ask OD-1; the Claude Code experiments continue meanwhile.
- The sandbox budget guard is bypassable (accepted risk); the balance reading, not the guard, is the control. Exhausted balance: provider errors end cells unscored or pending (never agent failures); create the stop file, ask OD-1, resume after a top-up; affected cells go through the M5-10 queues with their spend kept.
- Worst case for the whole pi arm: 18 x USD 5 = USD 90 (stage A's cell is one of the 18), plus at most 18 automatic retries of pre-work failures.

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

Contradiction to resolve: the core-part2 plan puts M1-34 Step 10 (rotation) before Step 11; the orchestrator handoff says rotate after Step 11 and the pilot slots; M3-09 Branch B uses the pre-rotation key.

- [ ] **Step 1:** Write `H:\cg-coord\decisions\<date>-credential-generations.md`: generation 1 (pre-enforcement Claude OAuth token and OpenRouter key) and which ledger slots use it; the exact point of rotation; generation 2 (campaign credentials); revocation time of generation 1 recorded before M1-34 Step 12; the five-slot count unchanged; no fallback after revocation may use generation 1. If the ruling changes the step order of an accepted plan, say so and review with gpt-6-sol.
- [ ] **Step 2:** M5-06 Step 6 checks the result: generation-2 creation time after the last ledger line, generation-1 revocation time quoted, secrets dir path for campaigns.

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
- [ ] **Step 5:** Ask OD-1 before 10-10 with the numbers from the paid protocol (worst case USD 90 against the balance left).

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

### Task M5-03: `--stop-file` and `--campaign` (B6, B7)

**Lane:** infra2, after M5-02. **Deps:** none. **Date:** 10-04 to 10-06. **Startable now** (after M5-02 on the same lane).

**Files:** modify `src/harness/campaign.ts` (`RunOptions.stopFile?: string`, `RunOptions.campaign?: string`, `CampaignSummary.stopped: boolean`), `cli/commands/harness-command.ts` (`--stop-file <path>`, `--campaign <id>` on `run`), `tests/unit/harness/campaign.test.ts`, `tests/unit/cli/commands/harness-command.test.ts`.

- [ ] **Step 1: Failing tests:**

```typescript
Deno.test("a stop file stops between cells; present at start runs nothing; resume keeps id, seed and order", async () => {
  const t = await mockEnv();
  await experiment(t, "contract", "mock-positive", ["mock-naive-a"], "[settings]", 2);
  const stop = join(t.repo.root, "pause.json");
  await Deno.writeTextFile(stop, "{}");
  const idle = await runCampaign(t.env, "contract", opts({ stopFile: stop }), io());
  assertEquals([idle.ran, idle.stopped, t.docker.runs.length], [0, true, 0]);
  await Deno.remove(stop);
  let n = 0;
  t.env.hooks = { beforeDraft: async () => { if (++n === 1) await Deno.writeTextFile(stop, "{}"); } };
  const out = io();
  const s = await runCampaign(t.env, "contract", opts({ stopFile: stop }), out);
  assertEquals([s.ran, s.stopped], [1, true], "the running cell finished, no new one started");
  assert(out.lines.some((l) => l.includes("resume with: centralgauge harness run contract")));
  const before = (await t.env.store.campaigns("contract"))[0]!;
  await Deno.remove(stop);
  t.env.hooks = {};
  const again = await runCampaign(t.env, "contract", opts({ stopFile: stop, campaign: before.id }), io());
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

CLI test: `harnessRun` forwards `stopFile` and `campaign` from `RunCliOptions` into `runCampaign` (existing planner-injection pattern at `harness-command.test.ts:1170`). Run: FAIL.
- [ ] **Step 2: Implement.** Stop file: checked before each `runCell` and before the first block; log `[PAUSE] stop file <path> present; resume with: centralgauge harness run <experiment> --campaign <id>`. Campaign pin: when `o.campaign` is set, the campaign found by the existing lookup must have that id; otherwise refuse, naming each of `experiment_hash`, `task_set.identity`, `arms[].manifest_hash` that differs from the named campaign's record (or `no campaign <id>`). Never create a campaign when `campaign` is set.
- [ ] **Step 3:** Tests pass; check/lint/fmt; commit `feat(harness): harness run --stop-file and --campaign`.

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

**Acceptance:** tests green. Used only after an owner decision to cut repeats (all arms and experiments cut alike).

---

### Task M5-06 (ops): pre-flight

**Lane:** ops. **Deps:** every row of the schedule table, M5-00 to M5-04 integrated. **Date:** 10-09 evening.

Evidence `H:\cg-coord\tasks\M5-06\runs\<nnn>\preflight.md`, one quoted output per check.

- [ ] **Step 1: Checkout (OD-2).** Quote the owner's answer, `git rev-parse HEAD` (the SHA the orchestrator names) and `git status --short` (empty apart from `results/`).
- [ ] **Step 2: Marker.** `jq -r .state results/harness/egress-verified.json` is `authorized`; `deno task start harness egress verify` prints `[OK]` non-elevated.
- [ ] **Step 3: Images by id.** `DOCKER_CONTEXT=desktop-windows docker image inspect -f "{{.Id}}" centralgauge/harness-base:1 centralgauge/harness-claude-code:2.1.282 centralgauge/harness-pi:0.87.1` equals the ids in the M2-13 Step 8 and M3-08 acceptance decisions and M5-01 Step 4.
- [ ] **Step 4: Tasks.** `deno task start harness validate` prints `[OK] 6 tasks, task set <hash>` without `provisional`; `<hash>` equals `task_set_hash` in `H:\Temp3\harness-spike\M4\freeze\task-set.json`.
- [ ] **Step 5: Dry runs** (template, `--dry-run`, no `--campaign`) for the experiments of OD-3: 36 planned cells each (54 for a merged experiment), a new campaign each, estimate lines present (no prior samples yet except M1-29 if in the same results root).
- [ ] **Step 6: State.** Containers running; `coord holder` free for all three; owner-label `docker ps -a` empty; no `results/.bench-running.json` younger than 2 min; M5-00 generation-2 checks; `spend.md` totals and the OpenRouter console balance; Team quota line ("unknown" or the owner's numbers); OD-1 answer; disk free on the results drive at least 50 GB.

**Acceptance (orchestrator):** decision `2026-10-09-campaign-preflight.md` with SHA, image ids, task-set hash, OD answers, budget and balance.

---

### Task M5-07 (ops): stage A and the go decision

**Lane:** ops. **Deps:** M5-06 accepted, OD-3 answered. **Date:** 10-10 from 09:00.

- [ ] **Step 1:** Template with `--sample 1` for each experiment, order `cc-mcp-vs-plain`, `cc-skills-vs-plain`, `cc-vs-pi` (paid protocol checks before the last). New cells: 6 (5 Claude Code, 1 pi); cumulative 2 per experiment.
- [ ] **Step 2:** Record each new campaign id and seed; from here every invocation passes `--campaign <id>`.
- [ ] **Step 3:** Dry run (template) per experiment; save the estimate lines to `estimate.md` with the pi paid cost (reported and balance delta), and hours for all outstanding cells using max(measured mean, 20 min) per cell.
- [ ] **Step 4:** Per stage-A execution quote termination, verdict, `cost_usd`, `reported_cost_usd`, `infra_exposed`, `incomplete_telemetry`; owner-label `docker ps -a` empty.
- [ ] **Step 5: Go rule.** GO for stage B when (a) no estimate line is `INCOMPLETE` for a paid arm (else pi runs only under the worst-case chunk rule), (b) projected hours with the 15 % reserve end before 10-13 20:00, (c) no cell is terminally unscored. Otherwise `coord ask` with `estimate.md`.

**Acceptance (orchestrator):** stage-A spend in `spend.md`; decision `2026-10-10-campaign-go.md` (GO or the question) with the campaign ids.

---

### Task M5-08 (ops): stage B, repeat 1

**Lane:** ops. **Deps:** M5-07 GO. **Date:** 10-10 to 10-11.

- [ ] **Step 1:** Template with `--repeats 1` for the two Claude Code experiments; cc-vs-pi in chunks `--sample 4`, then `--sample 6`, each after the paid check. New cells: 30; cumulative 12 per experiment (6 per arm).
- [ ] **Step 2:** Usage stop, stop file, errors: per the template step 5; recompute the Team projection after each usage stop.
- [ ] **Step 3: Capacity check** after each experiment (dry-run estimate); a projection past 10-13 20:00 goes to the orchestrator at once. Levers: M5-11 if its preconditions hold, then an owner decision to cut repeats (M5-05).
- [ ] **Step 4: Evidence** per experiment `<exp>-B.md`: campaign id, seed, planned cells, executions (planned, automatic retries), cells by status (scored, unscored, pending, unrun), usage stops with times, `infra_exposed` per arm, paid spend and balance, `harness report <exp> --campaign <id> --judging campaign` text and `--json`, owner-label containers 0.

**Acceptance (orchestrator):** 12 planned cells per experiment attempted (6 per arm); executions may exceed that by retries; pending and unscored cells listed; spend recorded.

---

### Task M5-09 (ops): stage C, repeats 2 and 3

**Lane:** ops. **Deps:** M5-08 accepted. **Date:** 10-11 to 10-13.

- [ ] **Step 1:** Template without `--sample`/`--repeats` for the Claude Code experiments; cc-vs-pi chunks `--sample 9`, `12`, `15`, `18` with the paid check before each. New cells: 72; cumulative 36 per experiment (18 per arm).
- [ ] **Step 2:** Same handling and evidence as M5-08 (`<exp>-C.md`).

**Acceptance (orchestrator):** 36 planned cells per experiment attempted; statuses listed; decision `2026-10-13-campaigns-done.md`.

---

### Task M5-10 (ops): resume, rejudge and rerun queues (B8)

**Lane:** ops. **Deps:** M5-09. **Date:** 10-14 to 10-15 12:00.

- [ ] **Step 1: Classify** every non-scored cell from `harness report <exp> --campaign <id> --judging campaign --json` (`cells`) plus its last execution:
  - **Resume:** `unrun`, or `pending` with a `usage_limited` tail or an owed automatic retry. Action: the template run (no flags beyond `--campaign`).
  - **Rejudge:** `pending` whose last execution was judged-eligible but has no scored judgment (verdict-side fault). Action: `harness rejudge <exp> --execution <id>` through the template; the agent is never rerun for this.
  - **Manual rerun:** `unscored` (automatic retry spent: `setup_failed` or pre-work `harness_crash` twice). Action: orchestrator approval per cell in a decision file, then `--rerun <task>:<repeat>:<arm>` (paid check for pi).
- [ ] **Step 2:** Work the queues in that order; rerender the reports; evidence lists every action with the execution the report now uses. Every attempt's spend stays in the cell.

**Acceptance (orchestrator):** each queue's list and outcome; approvals for manual reruns; handover to M6-06 by 10-15 12:00.

---

### Task M5-11 (ops, conditional): concurrency raise

**Lane:** ops. **Deps:** M1-33d accepted, lane-ops proofs P1 and P2 accepted, orchestrator decision lifting the refusal (PROXY_ISOLATION gate). **Date:** only when M5-08 Step 3 shows a shortfall.

- [ ] **Step 1:** Stop at a cell boundary with the stop file; rerun the template with `--concurrency 3`.
- [ ] **Step 2:** Evidence: per-execution proxy registrations of the first concurrent cells (M1-33d records), no cross-execution violation, `order_in_block` unchanged, the switch time (the report evidence notes both load levels).

**Acceptance (orchestrator):** decision naming the switch time.

---

## Startable now

- M5-00 (orchestrator).
- M5-01 Steps 1 to 3 and 5 (orchestrator); Step 4 waits for the final image ids.
- M5-02, then M5-03, then M5-04 (infra2, one lane in this order: they touch the same runner and CLI files).
- M5-05 (infra, only behind M1-34c).

## Findings addressed (round 1)

B1: invocation template with `--secrets-dir` on every command, per-stage cell counts (M5-07 to M5-09). B2: corrected inputs and limits, scenario table with reserve and latest start. B3: M5-02 rewritten (outstanding cells, attempts per cell, first judgment only, paid basis, `INCOMPLETE`). B4: paid protocol. B5: M5-00 and the schedule table. B6: template (lease per invocation, `--max-pause-min 0`), Team quota section. B7: `--campaign` in M5-03 and in every command. B8: M5-10 queues and M5-04 refusals. N1: startable-now qualifiers. N2: tests added in M5-02 to M5-05.

## Review round 1: not adopted

- B6, "make usage waits pause-aware": adopted by a different mechanism. Campaigns run with `--max-pause-min 0`, so the runner never sleeps on a usage limit; it exits, leases are released, and the next invocation resumes. The in-process wait stays unused, so no code change to the sleep.
- B4, "defined within-stage monitoring": adopted without new code. cc-vs-pi runs in chunks of at most 3 pi cells with a balance reading before each chunk, which bounds the exposure between readings to 3 x USD 5.
- N2, "stop file during usage sleep" test: not written, because campaigns no longer sleep (see B6 above).
