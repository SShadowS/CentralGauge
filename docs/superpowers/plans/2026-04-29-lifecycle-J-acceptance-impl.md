# Phase J — Lifecycle Acceptance + Docs — Implementation Plan

> **Status:** Closed. Final acceptance summary at
> [`2026-04-29-lifecycle-COMPLETE.md`](./2026-04-29-lifecycle-COMPLETE.md).
> All J1–J6 deliverables shipped in Wave 7 commits on branch
> `lifecycle/wave-7-acceptance`. Sub-step checkboxes below remain
> unchecked in the source plan as a record of the sub-task list; the
> overarching deliverables (J1–J7) are complete per the COMPLETE.md
> ledger and the strategic plan's J phase checkboxes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the model-lifecycle event-sourcing initiative. Land the operator + reviewer documentation, the integration test that exercises the full `cycle` flow against an in-memory D1, the changelog entries (project-level + user-facing), the runbook updates that cover the new admin endpoints + CF Access policy, and the visual-regression baselines for the new admin surfaces. After this plan ships, every phase A–H deliverable has a documented surface, a test, and a place in the changelog.

**Architecture.** This phase is mostly prose + one integration test + visual-regression captures. Six tracks in parallel:

- `docs/site/lifecycle.md` — new operator + reviewer guide (J1).
- `CLAUDE.md` — new `## Lifecycle` section (J2).
- `docs/site/operations.md` — three new runbook entries (J3).
- `tests/integration/lifecycle-cycle.test.ts` — end-to-end synthetic-fixture test (J4).
- `site/CHANGELOG.md` (project-level changelog — single canonical CHANGELOG in this repo) + `docs/site/changelog.md` (user-facing) — one entry each (J5).
- `site/tests/visual/` — baselines for `/admin/lifecycle/*` and `/families/*/diff` (J6).

**Tech Stack:** Markdown (no toolchain change); existing project Deno test runner (`deno task test:integration`) with miniflare-style in-memory D1 used by other integration tests; existing Playwright visual-regression rig (per `site/CHANGELOG.md`'s P5.4 section — "Visual regression suite (5 pages × 2 themes × 2 densities × 1 viewport, 0.1% tolerance)"). No new dependencies.

**Depends on:**
- All of A–H landed and green.
- Phase G — referenced by the operator guide (weekly cycle + digest issue).
- The `centralgauge cycle` command's `--dry-run` flag from Phase C1.
- The `lifecycle_events` D1 schema from Phase A1.
- The `/admin/lifecycle/review` page from Phase F6.5.
- The `/families/*/diff` UI surfaces from Phase E4.

**Strategic context:** Items 9–10 of the strategic plan ("the operator's two surfaces are the CLI matrix and the web review UI"). This phase makes both navigable to a fresh operator who has never seen the system. The CHANGELOG line on the user-facing surface follows the editorial policy ("only new models / new features"); the lifecycle tracking IS a new feature operators see and that policy admits one entry. The project-level CHANGELOG records the engineering history phase-by-phase.

---

## Step 0 — Pre-flight verification

- [ ] **0.1 Confirm all prior phases are merged to master.** `git log --oneline --grep="lifecycle"` shows commits for A, B, C, D-prompt, D-data, E, F, G, H. If any phase is still open, this plan blocks.

- [ ] **0.2 Confirm the production lifecycle endpoints respond.** Plan A defines `/api/v1/admin/lifecycle/state` as GET-only with the canonical signed-headers triple (`X-CG-Signature`, `X-CG-Key-Id`, `X-CG-Signed-At`). The simplest path through this gate is the lifecycle CLI itself:

  ```bash
  centralgauge status --json | jq '.rows | length'
  ```

  Returns a number ≥ 6 (the prod model count). If the operator wants to bypass the CLI and curl the endpoint directly, they must construct all three headers via `signPayload({}, privateKey, keyId)` from `src/ingest/sign.ts`; there is no `x-cg-admin-signature` shorthand header.

- [ ] **0.3 Confirm Cloudflare Access policy is active.** Open `https://centralgauge.sshadows.workers.dev/admin/lifecycle/status` in a fresh browser session — should redirect to GitHub OAuth via Cloudflare Access. If the page renders without auth, Phase F5 was not completed; block.

- [ ] **0.4 Confirm CHANGELOG location.** This repo currently maintains `site/CHANGELOG.md` (the project-level changelog) and `docs/site/changelog.md` (the user-facing changelog rendered at `/changelog`). The strategic plan's J5 mentions "CHANGELOG.md (project) + docs/site/changelog.md (user-facing)"; we treat `site/CHANGELOG.md` as the project changelog (existing convention) and append there. If the operator wants a root-level `CHANGELOG.md` instead, that is a one-line file move and not in scope for this phase.

---

## Step 1 — `docs/site/lifecycle.md` (J1)

The operator + reviewer guide. Tone: runbook, not architecture. Cross-references the strategic plan + the schema appendix; does not restate them.

- [ ] **1.1 Write `docs/site/lifecycle.md`.**

  ```markdown
  # Lifecycle — operator + reviewer guide

  > How to run the bench → analyze → publish pipeline as a single
  > orchestrated cycle, how state transitions are recorded, how to use
  > the web review UI, and how the weekly CI keeps every model current.
  >
  > Strategic plan: `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`.
  > Schema appendix: same file, end of document.

  ## State model

  Every model under every task set passes through four states. State is
  derived by reduction over the `lifecycle_events` table — the table is
  the source of truth, status columns do not exist:

  | State | Predicate (in plain English) |
  |---|---|
  | `BENCHED` | At least one `bench.completed` event under the current `task_set_hash`. |
  | `DEBUGGED` | Most-recent `bench.completed` is paired with a `debug.captured` event whose `r2_key` resolves. |
  | `ANALYZED` | At least one `analysis.completed` event with `payload_hash` referenced by no later `analysis.failed`. |
  | `PUBLISHED` | At least one `publish.completed` event whose `payload_hash` matches the most-recent `analysis.completed`. |

  States are NOT exclusive; a model can be `BENCHED + ANALYZED` without
  `PUBLISHED` (the analyzer wrote rows that are still in the review
  queue). The CLI status command renders this as a per-state column.

  ## The four lifecycle commands

  ### `centralgauge status`

  ```bash
  centralgauge status                       # full matrix
  centralgauge status --model anthropic/claude-opus-4-7
  centralgauge status --json                # machine-readable, used by weekly CI
  ```

  Prints rows for every (model, task_set) with one column per state. The
  next-action hint column suggests the exact command to advance the state.

  ### `centralgauge cycle`

  The orchestrator. Runs bench → debug-capture → analyze → publish under a
  single command, checkpointed against the event log.

  ```bash
  # Full pipeline against the current task set
  centralgauge cycle --llms anthropic/claude-opus-4-7

  # Re-analyze only (skip bench + debug-capture)
  centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze

  # Force re-run of a specific step even if the last event was .completed
  centralgauge cycle --llms anthropic/claude-opus-4-7 --force-rerun analyze

  # Plan-only (writes nothing)
  centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run

  # Pick the analyzer model (default: anthropic/claude-opus-4-6)
  centralgauge cycle --llms openai/gpt-5.5 --analyzer-model anthropic/claude-opus-4-6

  # Non-interactive (CI uses this)
  centralgauge cycle --llms anthropic/claude-opus-4-7 --yes
  ```

  Resume semantics: rerunning a `cycle` command skips steps whose most-recent
  event is `*.completed` and whose envelope (tool versions + task_set_hash +
  settings_hash + git_sha) has not changed. To force a fresh run, use
  `--force-rerun <step>`.

  Concurrency: same-model parallel cycles are gated by a `lock_token` written
  with the `cycle.started` event. The loser writes `cycle.aborted{reason='lost_race'}`
  and exits 1. TTLs are 90 minutes for the cycle, 60 minutes per step.

  Crashed-worker recovery: if a cycle is killed mid-run and the lock has not
  yet expired, run `centralgauge cycle --llms <model> --force-unlock --yes`
  to release the lock by writing `cycle.aborted{reason='manual_unlock'}`.
  The operator must confirm no other process is running for that model.

  ### `centralgauge verify`

  Used standalone when the operator wants to re-analyze an existing debug
  bundle without going through the orchestrator (e.g., experimenting with
  a different analyzer model).

  ```bash
  centralgauge verify debug/2026-04-28T... \
    --shortcomings-only \
    --model anthropic/claude-opus-4-7 \
    --analyzer-model anthropic/claude-opus-4-6
  ```

  Phase B3 made this command write the production-vendor-prefixed slug
  directly into `model-shortcomings/*.json`. There is no longer any slug
  transformation at populate time.

  ### `centralgauge populate-shortcomings`

  Used standalone to upload a previously-generated `model-shortcomings/*.json`
  to production. The orchestrator's `cycle publish` step calls the same code
  path, so calling it directly is only needed for manual replay.

  ```bash
  centralgauge populate-shortcomings --only anthropic/claude-opus-4-7
  ```

  Per Phase B4, the `VENDOR_PREFIX_MAP` is gone. The JSON file's `model` field
  is the production slug; the command is pass-through.

  ## The web review UI at `/admin/lifecycle`

  `https://centralgauge.sshadows.workers.dev/admin/lifecycle`

  Authentication: Cloudflare Access with GitHub OAuth (Phase F5). On first
  access, the operator's GitHub account email must be on the CF Access
  policy allowlist; otherwise a 403 page renders at the edge before the
  worker is invoked. Adding a new operator: see
  `docs/site/operations.md` → "How to authorize a new operator for `/admin/lifecycle/*`".

  Pages:

  - **`/admin/lifecycle/status`** — Same matrix view as the CLI `status`
    command, in browser. Click a cell to see the event timeline for that
    (model, task_set, state).
  - **`/admin/lifecycle/review`** — Pending-review queue. Entries below the
    confidence threshold (default 0.7, configurable via
    `lifecycle.confidence_threshold` in `.centralgauge.yml`) appear here.
    Click a row → side-by-side pane: left pane shows the raw debug excerpt
    with line numbers; right pane shows the LLM rationale plus the proposed
    `correct_pattern` / `incorrect_pattern`. Buttons: **Accept** (writes
    `analysis.accepted` event + INSERTs into `shortcomings`); **Reject**
    (writes `analysis.rejected` event with the operator-supplied reason).
  - **`/admin/lifecycle/events`** — Full event timeline. Filterable by
    model, task_set, event type, time range. Useful for incident
    forensics ("what changed between the good run and the regressed run?").

  All three pages call the admin endpoints with the CF Access cookie
  attached automatically by the browser; no client-side key handling. The
  same admin endpoints accept Ed25519-signed CLI traffic (used by the
  `lifecycle digest` command and the weekly CI workflow); the worker
  middleware tries CF Access first, falls back to signature, fails closed
  if neither validates.

  ## Weekly CI

  The `.github/workflows/weekly-cycle.yml` workflow runs every Monday at
  06:00 UTC and on `workflow_dispatch`. It:

  1. Reads `centralgauge status --json` to identify stale models (no
     `analysis.completed` event under the current task_set within 7 days).
  2. Runs `centralgauge cycle --llms <slug> --analyzer-model anthropic/claude-opus-4-6 --yes`
     for each stale model. Failures do not abort; they are recorded.
  3. Generates a digest via `centralgauge lifecycle digest --since 7d --format markdown`.
  4. Posts the digest to a sticky GitHub issue tagged `weekly-cycle-digest`.
     The issue is auto-closed when all cycles succeed; it stays open
     when any failed. The operator's Monday-morning read is the issue.

  Triggering manually: `gh workflow run weekly-cycle.yml`. Implementation
  detail in `docs/superpowers/plans/2026-04-29-lifecycle-G-ci-impl.md`.

  ## Slug standardization (the rule)

  Every model's slug, in every surface, is **vendor-prefixed**:

  - `anthropic/claude-opus-4-7`
  - `openai/gpt-5.5`
  - `openrouter/deepseek/deepseek-v4-pro`

  The legacy `VENDOR_PREFIX_MAP` and the underscore-separated filenames
  (`deepseek_deepseek-v3.2.json`) were retired in Phase B. New JSON files
  written by `verify` use the production slug as the `model` field; the
  filesystem-safe filename replaces `/` with `_` for readability.

  Adding a new vendor: no code change. The slug `<vendor>/<model>` is
  written by `verify` directly; the catalog row in `site/catalog/models.yml`
  defines the canonical name; `sync-catalog --apply` reconciles to D1.
  No mapping table to update.

  ## Concept registry

  Phase D introduced canonical concepts. The analyzer proposes a
  concept slug per shortcoming entry; the system clusters against
  existing concepts using a three-tier threshold:

  | Cosine similarity | Action |
  |---|---|
  | ≥ 0.85 OR slug-equal | Auto-merge into existing concept (`concept.aliased` event). |
  | 0.70–0.85 | Mandatory review queue (`lifecycle cluster review` interactive CLI; operator decides). |
  | < 0.70 | Auto-create new concept (`concept.created` event). |

  Concepts are append-only — they are never DELETEd. A merge sets
  `superseded_by` on the loser; a split writes a `concept.split` event +
  creates new concept rows. To recover from a bad merge, see
  `docs/site/operations.md` → "How to recover from a bad merge in concept registry".

  ## Configuration (`.centralgauge.yml`)

  | Key | Default | Purpose |
  |---|---|---|
  | `lifecycle.confidence_threshold` | `0.7` | Entries below this are routed to the review queue instead of auto-publishing. |
  | `lifecycle.cross_llm_sample_rate` | `0.2` | Fraction of analyzer entries re-checked by a second LLM. Range 0.0–1.0. |
  | `lifecycle.weekly_stale_after_days` | `7` | Used by the weekly CI to decide which models need re-cycling. |
  | `lifecycle.analyzer_model` | `anthropic/claude-opus-4-6` | Default analyzer model (overridable per-cycle via `--analyzer-model`). The default is set by Plan F's lifecycle config zod schema (`analyzer_model` field). |

  Pricing: at 20% sample rate, the cross-LLM second-pass adds about $3 to
  a typical 150-entry release. Cranking to 1.0 raises this to ~$15.

  ## Recipes

  ### Onboarding a new model

  ```bash
  # 1. Add to the catalog (existing flow):
  vim site/catalog/models.yml      # add the new model row
  centralgauge sync-catalog --apply

  # 2. Run the orchestrator (this is the new flow):
  centralgauge cycle --llms <slug>

  # 3. If anything was routed to the review queue, triage at:
  open https://centralgauge.sshadows.workers.dev/admin/lifecycle/review
  ```

  ### Re-analyzing an old model with a new analyzer

  ```bash
  centralgauge cycle \
    --llms anthropic/claude-opus-4-6 \
    --from analyze \
    --analyzer-model anthropic/claude-opus-4-7 \
    --force-rerun analyze
  ```

  Re-analysis requires the original debug bundle in R2 (Phase C3 uploads
  every debug.captured event's tarball; retention is indefinite). If the
  bundle is missing, the cycle aborts with a clear error.

  ### Investigating a regression

  ```bash
  # 1. Find the most-recent good state from the event timeline:
  open https://centralgauge.sshadows.workers.dev/admin/lifecycle/events

  # 2. Compare envelopes (tool versions, git_sha) between the last good
  #    and first bad event:
  centralgauge lifecycle event-log --model <slug> --json | \
    jq '.[] | {ts, event_type, envelope: .envelope_json}'

  # 3. If the envelopes match (deterministic regression), open an issue
  #    with the two event ids attached.
  ```

  ## See also

  - Strategic plan: `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`
  - **Canonical event-types reference** (the authoritative list of every
    `bench.*`, `analysis.*`, `publish.*`, `concept.*`, `cycle.*` event type
    plus its payload fields): same file → "Event types appendix" near the
    end. When in doubt about whether an event type is real, check there
    first — invented event types (e.g. `bench.dry_run`,
    `analysis.skipped`) will NOT appear in this list and must not be
    introduced.
  - Schema appendix (`lifecycle_events`, `concepts`, `pending_review`
    definitions): same file, end.
  - Weekly CI implementation: `docs/superpowers/plans/2026-04-29-lifecycle-G-ci-impl.md`
  - Operations runbook: `docs/site/operations.md`
  ```

- [ ] **1.2 Add the file to the mkdocs nav.** Edit `mkdocs.yml`. Insert under the existing "Site" section:

  ```yaml
  nav:
    - Site:
        - Architecture: site/architecture.md
        - Design system: site/design-system.md
        - Operations: site/operations.md
        - Lifecycle: site/lifecycle.md      # NEW
        - Changelog: site/changelog.md
  ```

- [ ] **1.3 Lint the markdown.** If `markdownlint-cli` is available, `markdownlint docs/site/lifecycle.md`. Otherwise visual review: every header has a level, every code fence closes, every internal link resolves.

---

## Step 2 — `CLAUDE.md` `## Lifecycle` section (J2)

The project-level instruction file gets a brief operator pointer near the existing "Ingest Pipeline & Site" section.

- [ ] **2.1 Edit `CLAUDE.md`.** Find the heading `## Ingest Pipeline & Site` and insert a new section immediately after the closing block of that section (before `## Code Style`).

  ```markdown
  ## Lifecycle

  Bench → debug → analyze → publish runs as one orchestrated command,
  checkpointed against the `lifecycle_events` table in prod D1. Full
  guide: `docs/site/lifecycle.md`.

  - `centralgauge status` — per-model lifecycle matrix; `--json` for CI.
  - `centralgauge cycle --llms <slug>` — orchestrated bench → analyze →
    publish. Recommended onboarding command for a new model. Resumes from
    the last successful step; rerunnable safely. `--analyzer-model X`
    overrides the default analyzer (default: `anthropic/claude-opus-4-6`).
  - `/admin/lifecycle` — reviewer surface (CF Access + GitHub OAuth).
    Pending-review queue, event timeline, status matrix.
  - Weekly CI: `.github/workflows/weekly-cycle.yml` runs Monday 06:00 UTC,
    re-cycles stale models, posts a digest to a sticky GitHub issue.

  Configuration knobs in `.centralgauge.yml`:

  - `lifecycle.confidence_threshold` (default `0.7`) — entries below
    threshold route to the review queue.
  - `lifecycle.cross_llm_sample_rate` (default `0.2`) — fraction of
    analyzer entries re-checked by a second LLM. ~$3 added per release at
    0.2; ~$15 at 1.0.

  Slug rule: every model is vendor-prefixed end-to-end
  (`anthropic/claude-opus-4-7`). The old `VENDOR_PREFIX_MAP` is gone;
  `verify` writes the prod slug directly.
  ```

- [ ] **2.2 Verify the section reads cleanly when the file is rendered.** No further tooling — `CLAUDE.md` is consumed as plain text by Claude Code.

---

## Step 3 — `docs/site/operations.md` runbook entries (J3)

Three new entries: authorize a new operator, triage a stuck cycle lock, recover from a bad concept merge.

- [ ] **3.1 Edit `docs/site/operations.md`.** Append a new top-level section before the `## P5.4 final-acceptance ledger` section (which is historical):

  ```markdown
  ## Lifecycle runbooks

  > Operator procedures for the lifecycle event log + admin surfaces
  > introduced by the 2026-04-29 lifecycle plan.

  ### How to authorize a new operator for `/admin/lifecycle/*`

  Authentication is Cloudflare Access with GitHub OAuth (per the lifecycle
  Phase F5 design — no browser-resident keys). To grant access:

  1. Open `https://dash.cloudflare.com/<account-id>/access/apps`.
  2. Find the application named **CentralGauge Admin Lifecycle** (host:
     `centralgauge.sshadows.workers.dev`, path prefix: `/admin/lifecycle/*`).
  3. Click **Edit** → **Policies** → the existing policy named
     `Lifecycle reviewers`.
  4. Under **Include**, add the new operator's GitHub email. Save.
  5. Confirm with the operator that
     `https://centralgauge.sshadows.workers.dev/admin/lifecycle/status`
     loads the matrix view (after a fresh GitHub OAuth round-trip).

  Removing access: same flow, remove the email from the Include list.
  No worker redeploy needed; CF Access policy changes propagate at the
  edge within seconds.

  CLI access is unaffected by CF Access changes — the CLI signs requests
  with the Ed25519 admin key and bypasses the CF Access path entirely.
  Revoke a CLI by rotating the admin key (separate procedure).

  ### How to triage a stuck cycle lock

  Symptom: `centralgauge cycle --llms <model>` exits immediately with
  `cycle.aborted{reason='lost_race'}`, but no other cycle is actually
  running. Cause: a previous cycle was SIGKILLed or evicted before it
  could write a terminal event, and the lock is still within its 90-minute
  TTL window.

  Resolution:

  1. Verify no other process is actually running. On the operator's
     workstation:
     ```bash
     ps aux | grep -E "centralgauge.*cycle" | grep -v grep
     ```
     If a process is running, wait for it. Do NOT proceed.

  2. Confirm the stuck lock by reading the event log:
     ```bash
     centralgauge lifecycle event-log --model <slug> --since 2h --json | \
       jq '.[] | select(.event_type | startswith("cycle."))'
     ```
     Expect a `cycle.started` with no matching `cycle.completed`,
     `cycle.failed`, or `cycle.aborted`.

  3. Release the lock:
     ```bash
     centralgauge cycle --llms <slug> --force-unlock --yes
     ```
     Writes `cycle.aborted{reason='manual_unlock', actor_id=<your_key_fp>}`.
     The next `cycle` invocation can claim a fresh lock.

  4. Re-run the cycle:
     ```bash
     centralgauge cycle --llms <slug>
     ```
     The orchestrator resumes from the last successful step (`bench` and
     `debug-capture` typically already completed; `analyze` re-runs).

  When TTL fires automatically (90 min from `cycle.started`), the orchestrator
  emits `cycle.timed_out`. The audit history shows the timeout; no operator
  action is needed for that path.

  ### How to recover from a bad merge in concept registry

  Symptom: two distinct AL pedagogical concepts were collapsed into a single
  row by the clustering step. The `/concepts/<slug>` page now lists models
  that hit the wrong concept; the family-diff page shows phantom "persisting"
  entries that are actually a separate issue.

  The `concepts` table is **append-only** — rows are never DELETEd. Recovery
  uses a `concept.split` event:

  1. Identify the bad merge via the event timeline:
     ```bash
     centralgauge lifecycle event-log --filter event_type=concept.merged --json | \
       jq '.[-10:]'
     ```
     The `concept.merged` event records `winner_concept_id`, `loser_concept_id`,
     and `similarity`. Note the IDs.

  2. Run the cluster-review CLI with the split flow:
     ```bash
     centralgauge lifecycle cluster review --split <winner_concept_id>
     ```
     Interactive prompt: enter slugs for the new daughter concepts; choose
     which existing `shortcomings.concept_id` rows point at each daughter.
     The command writes a `concept.split` event + creates the new concept
     rows + updates the `shortcomings.concept_id` JOIN — all in a single
     D1 transaction (per the Phase D6 atomicity test).

  3. Verify the split landed:
     ```bash
     curl -s "https://centralgauge.sshadows.workers.dev/api/v1/concepts/<original-slug>" \
       | jq '.split_into'
     ```
     Lists the daughter concept slugs.

  4. Cache invalidation: the `concept.split` event triggers
     `invalidateConcept` on the original slug + every alias + every daughter
     (Phase D4). No manual `cache.delete()` needed.

  Never DELETE from `concepts` directly. Direct deletion breaks the foreign-key
  joins from `shortcomings.concept_id` and is impossible to audit. The
  append-only invariant is the ONLY safe recovery path.
  ```

- [ ] **3.2 Verify links resolve.** `grep -E '\(docs/' docs/site/operations.md` lists in-tree references; spot-check that each target file exists.

---

## Step 4 — End-to-end integration test (J4)

A test that runs `cycle --dry-run` against an in-memory D1 and asserts the synthetic event sequence + skip-on-success + lock-token tiebreaker.

**Pre-flight dependency:** This test imports `createTestD1` and `runMigrations` from `tests/utils/d1-test-helpers.ts`. Per the cross-plan audit, those helpers are owned by Plan A's A6 task (unit + integration test scaffolding). If A6 has not landed when J4 runs:

1. File the gap against Plan A's acceptance.
2. As a fallback only, this plan's J4 may extend the existing helper file to add the two functions; they wrap the in-memory D1 setup the existing ingest integration tests already use. Remove the local additions when A6 lands and the canonical helpers are in place — never duplicate the helpers.

- [ ] **4.1 Create `tests/integration/lifecycle-cycle.test.ts`.**

  ```typescript
  /**
   * End-to-end lifecycle cycle integration test.
   *
   * Runs `centralgauge cycle --llms <fixture-model> --dry-run` against an
   * in-memory D1 (matches the existing `tests/integration/` rig used by the
   * ingest tests). Asserts:
   *
   * 1. The synthetic event sequence: cycle.started → bench.* → debug.* →
   *    analysis.* → publish.* → cycle.completed.
   * 2. Skip-on-success: re-running with the same envelope produces only
   *    `*.skipped` events plus a fresh cycle.started/completed pair.
   * 3. Lock-token tiebreaker: two parallel `cycle` invocations against the
   *    same (model, task_set) — exactly one wins; the loser writes
   *    `cycle.aborted{reason='lost_race'}` and exits 1.
   *
   * Strategic plan reference: J4 in
   * `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`.
   *
   * @module tests/integration/lifecycle-cycle.test
   */
  import { assert, assertEquals, assertExists } from "@std/assert";
  import { createTestD1, runMigrations } from "../utils/d1-test-helpers.ts";
  import { runCycle } from "../../src/lifecycle/orchestrator.ts";
  import { queryEvents } from "../../src/lifecycle/event-log.ts";

  const FIXTURE_MODEL = "anthropic/claude-opus-4-7";
  const FIXTURE_TASK_SET = "ts-integration-test";

  Deno.test("cycle --dry-run produces the canonical event sequence", async () => {
    const d1 = await createTestD1();
    try {
      await runMigrations(d1, ["site/migrations/0006_lifecycle.sql"]);

      const result = await runCycle({
        d1,
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: true,
        nonInteractive: true,
      });

      assertEquals(result.exitCode, 0);
      assert(result.plan.includes("bench"));
      assert(result.plan.includes("debug-capture"));
      assert(result.plan.includes("analyze"));
      assert(result.plan.includes("publish"));

      const events = await queryEvents(d1, {
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
      });

      // Dry-run writes `cycle.started`, then short-circuits AFTER bench
      // (which emits `bench.skipped{reason:'dry_run'}`), then writes
      // `cycle.completed{dry_run:true}` without invoking analyze/publish.
      // The strategic plan's Event types appendix admits `bench.skipped` and
      // `publish.skipped` but NOT `analysis.skipped`, `bench.dry_run`,
      // `analysis.dry_run`, or `publish.dry_run` — those would be invented
      // event names. Plan C2 (orchestrator dry-run path) is the source of
      // truth for the exact sequence.
      const types = events.map((e) => e.event_type);
      assertEquals(types[0], "cycle.started");
      assertEquals(types[types.length - 1], "cycle.completed");

      // Bench emits `bench.skipped{reason:'dry_run'}` — assert the event
      // exists AND its payload reason field.
      const benchSkipped = events.find((e) => e.event_type === "bench.skipped");
      assertExists(benchSkipped);
      const benchPayload = JSON.parse(benchSkipped.payload_json ?? "{}");
      assertEquals(benchPayload.reason, "dry_run");

      // The terminal cycle.completed payload carries the dry_run marker.
      const cycleCompleted = events[events.length - 1];
      const cyclePayload = JSON.parse(cycleCompleted.payload_json ?? "{}");
      assertEquals(cyclePayload.dry_run, true);

      // No analyze or publish events at all on the dry-run path — the
      // orchestrator short-circuits after bench.
      assert(!types.some((t) => t.startsWith("analysis.")));
      assert(!types.some((t) => t.startsWith("publish.")));
    } finally {
      await d1.close();
    }
  });

  Deno.test("cycle skip-on-success: second invocation skips bench + publish", async () => {
    const d1 = await createTestD1();
    try {
      await runMigrations(d1, ["site/migrations/0006_lifecycle.sql"]);

      // First run — full pipeline.
      const r1 = await runCycle({
        d1,
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        nonInteractive: true,
        // The orchestrator's internal step runners accept stubs in test mode;
        // see src/lifecycle/orchestrator.ts test-only options.
        stubSteps: {
          bench: { runs_count: 1, tasks_count: 50 },
          debug: { session_id: "fixture-session", r2_key: "lifecycle/debug/.../fixture.tar.zst" },
          analyze: { entries_count: 5, min_confidence: 0.91, payload_hash: "abc123" },
          publish: { upserted: 5, occurrences: 7 },
        },
      });
      assertEquals(r1.exitCode, 0);

      // Second run — same envelope. Per the strategic plan's Event types
      // appendix and Plan C, ONLY `bench.skipped` and `publish.skipped` are
      // canonical. The debug-capture and analyze steps re-execute (cheaply,
      // deterministically) when their inputs are unchanged but they have no
      // `.skipped` event. See Plan C lines 831, 937, 1128 for the design
      // rationale.
      const r2 = await runCycle({
        d1,
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        nonInteractive: true,
        stubSteps: r1.stubSteps,    // identical envelope
      });
      assertEquals(r2.exitCode, 0);

      const events = await queryEvents(d1, {
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
      });

      const skipped = events.filter((e) => e.event_type.endsWith(".skipped"));
      // Exactly two skipped events on the 2nd run: bench.skipped + publish.skipped.
      // No analysis.skipped, no debug.skipped (those event types don't exist).
      const skippedTypes = skipped.map((e) => e.event_type).sort();
      assertEquals(skippedTypes, ["bench.skipped", "publish.skipped"]);

      // Both skipped events carry reason='envelope_unchanged' (or
      // reason='payload_unchanged' for publish — see Event types appendix).
      const benchPayload = JSON.parse(skipped.find((e) => e.event_type === "bench.skipped")!.payload_json ?? "{}");
      assertEquals(benchPayload.reason, "envelope_unchanged");
      const publishPayload = JSON.parse(skipped.find((e) => e.event_type === "publish.skipped")!.payload_json ?? "{}");
      assertEquals(publishPayload.reason, "payload_unchanged");
    } finally {
      await d1.close();
    }
  });

  Deno.test("cycle lock-token tiebreaker: two parallel invocations — exactly one wins", async () => {
    const d1 = await createTestD1();
    try {
      await runMigrations(d1, ["site/migrations/0006_lifecycle.sql"]);

      const args = {
        d1,
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: true,
        nonInteractive: true,
      };

      // Race two invocations.
      const [r1, r2] = await Promise.all([runCycle(args), runCycle(args)]);

      // Exactly one wins.
      const winners = [r1, r2].filter((r) => r.exitCode === 0);
      const losers = [r1, r2].filter((r) => r.exitCode !== 0);
      assertEquals(winners.length, 1);
      assertEquals(losers.length, 1);

      const events = await queryEvents(d1, {
        modelSlug: FIXTURE_MODEL,
        taskSetHash: FIXTURE_TASK_SET,
      });

      const aborted = events.filter((e) => e.event_type === "cycle.aborted");
      assertEquals(aborted.length, 1);
      const payload = JSON.parse(aborted[0].payload_json ?? "{}");
      assertEquals(payload.reason, "lost_race");
      assertExists(payload.winner_lock_token);
    } finally {
      await d1.close();
    }
  });
  ```

- [ ] **4.2 Verify the test runs.** `deno task test:integration --filter "lifecycle-cycle"`. All three tests pass. If `tests/utils/d1-test-helpers.ts` does not yet expose `createTestD1` / `runMigrations`, this is a Phase A test-utility gap that should be filed against Phase A acceptance — but as a fallback, this plan can extend the helper file to add the two functions; they wrap the existing in-memory D1 setup the ingest integration tests already use.

- [ ] **4.3 Lint + format.** `deno check tests/integration/lifecycle-cycle.test.ts && deno lint tests/integration/lifecycle-cycle.test.ts && deno fmt tests/integration/lifecycle-cycle.test.ts`.

---

## Step 5 — Changelog updates (J5)

Two files: `site/CHANGELOG.md` (project-level, all changes) and `docs/site/changelog.md` (user-facing, editorially curated).

- [ ] **5.1 Append the project-level entry to `site/CHANGELOG.md`.** Insert at the very top (above the existing P7 entry):

  ```markdown
  ## Lifecycle event-sourcing (2026-05-XX)

  Closes the gap between bench output and the production scoreboard. Every
  state transition becomes an immutable event in `lifecycle_events`; current
  state is a reduction over the log; web admin + CLI surfaces both read the
  same view.

  ### Added
  - D1 migration `0006_lifecycle.sql` — `lifecycle_events`, `concepts`,
    `concept_aliases`, `pending_review`, `v_lifecycle_state` view; FK
    columns on `shortcomings` (Phase A1).
  - Worker endpoints: `/api/v1/admin/lifecycle/{events,state,review/queue,review/<id>/decide}`,
    `/api/v1/concepts`, `/api/v1/concepts/<slug>`, `/api/v1/families/<slug>/diff`
    (Phases A4, D4, E3, F3, F4).
  - `/admin/lifecycle/{status,review,events}` web admin UI behind Cloudflare
    Access + GitHub OAuth (Phase F5–F7).
  - CLI: `centralgauge status`, `centralgauge cycle`, `centralgauge lifecycle digest`,
    `centralgauge lifecycle cluster review`, `centralgauge lifecycle event-log`
    (Phases A3, C, D7, G3, H).
  - Weekly CI: `.github/workflows/weekly-cycle.yml` (Phase G).
  - Concept registry with three-tier clustering (auto-merge / review-band /
    auto-create), append-only invariants, transactional mutations (Phase D).
  - Per-generation concept diffs (resolved / persisting / regressed / new)
    on `/families/<vendor>/<family>` with analyzer-mismatch warnings
    (Phase E).
  - Quality gating: per-entry confidence score combining schema validity +
    concept-cluster consistency + sampled cross-LLM agreement (Phase F1).
    Below-threshold entries route to the review queue.
  - Reproducibility envelope on every event: deno + wrangler + claude-code +
    BC compiler versions, git_sha, machine_id, task_set_hash, settings_hash
    (Phase A5).
  - R2-resident debug bundles at `lifecycle/debug/<model>/<session>.tar.zst`
    (Phase C3) — replay no longer depends on operator-local `debug/`.
  - Operator + reviewer guide `docs/site/lifecycle.md` (Phase J1).
  - Three new operations runbooks: authorize a new operator, triage a
    stuck cycle lock, recover from a bad concept merge (Phase J3).

  ### Changed
  - `verify` writes the production-vendor-prefixed slug into
    `model-shortcomings/*.json` directly (no transformation at populate
    time) (Phase B3).
  - `populate-shortcomings` is pass-through; the legacy `VENDOR_PREFIX_MAP`
    + the 4 hardcoded mappings + the 6 unmapped legacy snapshots all retired
    (Phase B2 + B4).
  - `/api/v1/shortcomings/batch` accepts `concept_slug_proposed`; resolves
    to `concept_id` server-side; the legacy per-model `concept` field is
    deprecated and accepted only during the transition window (Phase D3).
  - `/api/v1/models/<slug>/limitations` JOINs through `concept_id` and
    filters out superseded concepts.

  ### Backfilled
  - ~64 synthetic lifecycle events for every (model, task_set) pair with
    historical bench / analysis / publish artifacts (Phase B1, B5, B6).
    Pre-P6 runs use sentinel `task_set_hash='pre-p6-unknown'` and surface
    in a separate `--legacy` section.
  - All 15 `model-shortcomings/*.json` files renamed to vendor-prefixed
    slugs (Phase B2). The 6 previously-unmapped files are now uploadable.

  ### Operator
  - `CLAUDE.md` gained a `## Lifecycle` section (Phase J2).
  - `docs/site/operations.md` gained the three runbooks (Phase J3).
  - The recommended onboarding command for a new model is now
    `centralgauge cycle --llms <slug>` (replaces the manual six-step flow).

  ### Out of scope (deferred to follow-up)
  - `/concepts/<slug>` public page (the schema work is done; route + UI
    are a separate plan).
  - Reproduction-bundle download UX.
  - Multi-task-set comparison page.
  ```

- [ ] **5.2 Append the user-facing entry to `docs/site/changelog.md`.** Editorial policy admits one entry — this IS a new feature operators see. Insert at the top:

  ```markdown
  ## Lifecycle tracking (2026-05-XX)

  - `centralgauge cycle --llms <slug>` orchestrates the full
    bench → analyze → publish pipeline as one resumable command.
  - A weekly CI workflow keeps every model in the catalog current and
    posts a digest issue if anything regressed.
  - A new admin surface at `/admin/lifecycle` hosts the analyzer review
    queue, the per-model event timeline, and the lifecycle status matrix.
  ```

- [ ] **5.3 Verify the changelog files render.** Manual check of the markdown — every header, every code fence, every link. The `/changelog` page reads `docs/site/changelog.md` at build time via `?raw` import (per the file's own preamble).

---

## Step 6 — Visual regression baselines (J6)

- [ ] **6.1 Add the new pages to the visual regression suite.** Edit `site/tests/visual/visual-regression.spec.ts` (the existing rig from P5.4). Add to the `pagesToCapture` list:

  ```typescript
  // site/tests/visual/visual-regression.spec.ts (additions)
  const pagesToCapture = [
    // ... existing entries ...
    { path: "/admin/lifecycle/status", auth: "cf-access-fixture" },
    { path: "/admin/lifecycle/review", auth: "cf-access-fixture" },
    { path: "/admin/lifecycle/events", auth: "cf-access-fixture" },
    { path: "/families/anthropic/claude-opus", anchor: "diff" },
  ];
  ```

  The `auth: "cf-access-fixture"` flag instructs the test rig to inject a
  pre-signed CF Access fixture cookie (the same pattern used by P5.4 for
  authenticated admin surfaces; if no such fixture exists yet at this phase,
  it is an F5 acceptance gap to address before J6 captures).

- [ ] **6.2 Generate baselines.** From `site/`:

  ```bash
  cd site
  npm run build
  npm run seed:e2e
  npm run test:visual --update     # captures new baselines
  ```

  Output: 4 new `.png` files under `site/tests/visual/__screenshots__/`
  (one per page × 1 theme × 1 density × 1 viewport — the lifecycle pages
  are admin surfaces and don't need the full 5-pages × 2-themes × 2-densities
  matrix that public pages get).

- [ ] **6.3 Manually verify each rendered screenshot matches design intent
  before committing.** Open each `.png`. Check:
  - `/admin/lifecycle/status` — matrix renders, no missing cells, color
    legend visible.
  - `/admin/lifecycle/review` — pending row visible (seeded by `seed:e2e`),
    side-by-side pane open, accept/reject buttons present.
  - `/admin/lifecycle/events` — timeline list renders, each row shows
    timestamp + event type + model.
  - `/families/anthropic/claude-opus` (anchored at the `diff` section) —
    four buckets (resolved / persisting / regressed / new) render, badges
    visible.

  If any screenshot is wrong, the underlying component is broken — fix
  before re-capturing. Do NOT commit a wrong baseline.

- [ ] **6.4 Stage the baselines.**

  ```bash
  git add site/tests/visual/__screenshots__/admin-lifecycle-*.png \
          site/tests/visual/__screenshots__/families-*-diff.png \
          site/tests/visual/visual-regression.spec.ts
  ```

  **Baseline-capture platform invariant.** Baselines are captured on Ubuntu
  (the CI runner) per the P5.4 visual-regression invariant in
  `site/CHANGELOG.md`. Windows captures will drift due to font-rendering
  differences (anti-aliasing, hinting, native fallback fonts) and must NOT
  be committed. An operator running J6 from a Windows dev machine must use
  the CI workflow's `update-visual-baselines` job (or equivalent
  PR-driven mechanism), NOT a local `npm run test:visual --update` capture.
  If the CI workflow does not yet have a baseline-update path, that is a
  P5.4 gap to address before J6 captures — file it before proceeding.

---

## Step 7 — Final acceptance gate

- [ ] **7.1 Cross-cut acceptance — full A–H sweep.**

  | Phase | Acceptance assertion |
  |---|---|
  | A | `centralgauge lifecycle event-log --model anthropic/claude-opus-4-6` returns events. |
  | B | All 15 `model-shortcomings/*.json` files use vendor-prefixed slugs. `populate-shortcomings --only openrouter/deepseek/deepseek-v3.2` succeeds. |
  | C | `centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run` prints the plan; without `--dry-run` runs end-to-end; killed mid-run + restarted resumes from last successful step. |
  | D | `SELECT COUNT(DISTINCT concept_id) FROM shortcomings` matches `concepts` count. `/api/v1/concepts/flowfield-calcfields-requirement` lists every model that hit it. |
  | E | `/families/anthropic/claude-opus` shows a "Concept trajectory" section when both gen-4-6 and gen-4-7 have analysis events with the same analyzer. |
  | F | A hallucinated entry routes to `/admin/lifecycle/review`; accepting writes `analysis.accepted` event + `shortcomings` row; rejecting writes `analysis.rejected` event. |
  | G | Manual `gh workflow run weekly-cycle.yml` completes; sticky issue created with the digest. |
  | H | `centralgauge status` prints the matrix; `centralgauge status --json` validates against the documented schema. |

- [ ] **7.2 Run the full check suite.**

  ```bash
  deno check
  deno lint
  deno fmt --check    # NOT on site/ files
  deno task test:unit
  deno task test:integration
  cd site && npm run check && npm run test:main && npm run test:build && npm run build
  ```

  All green. The `npm run check:budget` and `npm run check:contrast` from
  `site-ci.yml` also run via the existing site CI workflow on the PR.

- [ ] **7.3 Run a fresh-shell acceptance per the strategic plan's J ledger.**

  ```bash
  # Fresh shell. Verify the canonical promise:
  # "Running centralgauge cycle --llms anthropic/claude-opus-4-7 from a
  #  fresh shell produces a complete event chain in lifecycle_events."
  centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run
  centralgauge lifecycle event-log --model anthropic/claude-opus-4-7 --since 5m --json | \
    jq '[.[] | .event_type] | sort | unique'
  # Expect on the dry-run path (Plan C2 short-circuits after bench): the
  # array is exactly ["bench.skipped", "cycle.completed", "cycle.started"]
  # with bench.skipped.payload.reason === "dry_run" and
  # cycle.completed.payload.dry_run === true. There are NO `*.dry_run`
  # event types (those would be invented — the canonical list lives in the
  # strategic plan's Event types appendix).
  ```

- [ ] **7.4 Commit.**

  ```bash
  git add \
    docs/site/lifecycle.md \
    docs/site/operations.md \
    docs/site/changelog.md \
    CLAUDE.md \
    mkdocs.yml \
    site/CHANGELOG.md \
    tests/integration/lifecycle-cycle.test.ts \
    site/tests/visual/visual-regression.spec.ts \
    site/tests/visual/__screenshots__/admin-lifecycle-status.png \
    site/tests/visual/__screenshots__/admin-lifecycle-review.png \
    site/tests/visual/__screenshots__/admin-lifecycle-events.png \
    site/tests/visual/__screenshots__/families-claude-opus-diff.png

  git commit -m "$(cat <<'EOF'
  docs(lifecycle): operator + reviewer guide + acceptance tests

  - docs/site/lifecycle.md — state model, four lifecycle commands, web
    review UI, weekly CI cadence, slug rule, concept registry.
  - CLAUDE.md — new ## Lifecycle section near ## Ingest Pipeline & Site.
  - docs/site/operations.md — three runbooks (authorize operator, triage
    stuck lock, recover from bad concept merge).
  - tests/integration/lifecycle-cycle.test.ts — dry-run event sequence,
    skip-on-success, lock-token tiebreaker.
  - site/CHANGELOG.md (project) — full phase-by-phase entry.
  - docs/site/changelog.md (user-facing) — single curated entry per
    editorial policy.
  - Visual-regression baselines for /admin/lifecycle/* and /families/*/diff.

  Closes 2026-04-29-model-lifecycle-event-sourcing.md (J1–J6).
  EOF
  )"
  ```

---

## Acceptance

- [ ] `docs/site/lifecycle.md` renders cleanly in mkdocs (no broken links, every section has prose).
- [ ] `CLAUDE.md` ## Lifecycle section is present, references `docs/site/lifecycle.md`.
- [ ] `docs/site/operations.md` has the three runbook entries with explicit
      step lists.
- [ ] `deno task test:integration --filter "lifecycle-cycle"` passes (3 tests).
- [ ] `site/CHANGELOG.md` has the new entry at the top.
- [ ] `docs/site/changelog.md` has exactly one entry for this feature, per
      editorial policy.
- [ ] Visual-regression baselines committed for the four new pages.
- [ ] All A–H acceptance assertions in the cross-cut gate pass.
- [ ] `gh workflow run weekly-cycle.yml` has run at least once successfully
      after this commit lands on master.

## Out of scope

- The deferred items already noted in the strategic plan: `/concepts/<slug>`
  public page, reproduction-bundle download UX, multi-task-set comparison,
  cross-task contamination analysis.
- Marketing copy / announcement post — the editorial-policy changelog entry
  is the user-facing announcement; a blog post is optional and lives outside
  this plan.
- Migration of older `model-shortcomings/*.json` files beyond the 15
  enumerated in Phase B2 — those did not exist at plan-write time.
