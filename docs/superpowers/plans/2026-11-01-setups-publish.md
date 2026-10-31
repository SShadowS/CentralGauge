# Setups Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner publish a finished, reviewed harness campaign arm to the site as a ranked setup run, link it to its submission (deleting the submitter key), and promote a setup task set to current.

**Architecture:**
- **CLI (Deno).** `centralgauge harness publish-setup` reuses `harnessReport` to get the arm summary and cells, and builds one publish payload. It is a dry run by default; `--apply` posts the payload signed with the admin key.
- **Site.** An admin endpoint validates the payload and writes all setup tables in one `db.batch` with a forced data-epoch bump. A second command and endpoint promote a task set.
- **Shared contract.** The payload type lives in one shared file, used by both runtimes.

**Tech Stack:** Deno + Cliffy (harness CLI), `@noble/ed25519` signing (`src/ingest/`), SvelteKit on Cloudflare Workers + D1, vitest pool-workers, Deno test.

**Spec:** `docs/superpowers/specs/2026-10-30-setups-leaderboard-design.md` (part 3 of the build order: "From backend runs to the site"). Parts 1 and 2 are in master (`bc097ae2`, `8d042972`).

## Global Constraints

- Score = the harness report's per-arm `pass_rate`, published exactly as computed. The site never recomputes it.
- Price per solved task = the report's `cost_per_solved_task`. It may be null, and then a `price_note` gives the reason.
- Only a complete report is published. A report with `partial` (`provisional` or `repeat_cut`) is refused.
- Results reach the site only when the owner publishes them with an explicit command. Nothing ingests automatically. The command is a dry run unless `--apply` is given.
- Agent tools are exactly `claude-code`, `codex`, `pi`, `opencode`, `cursor`, `antigravity`. The `mock` arms are never published.
- `hx_tasks.description_sha` = sha256 hex of `normalizeHxPrompt(prompt.md text)` (`shared/task-summaries.ts`).
- When a run for a submission is published, call `deleteSubmissionKey` (`site/src/lib/server/setup-submissions.ts`) and set `setup_submissions.setup_id`.
- Signed admin calls to these endpoints sign `canonicalJSON({ payload, path, signed_at })`, the same rule part 2's `adminRoute` enforces.
- Every write is one `db.batch` that includes `forceBumpDataEpochStmt(db)`, because this is an operator action.
- Setup ids match `^[a-z0-9][a-z0-9-]{1,62}$`.
- No prod deploy, migration apply, `--apply` against prod, or push. Tests use local D1 and mocked HTTP only.
- New harness test files must be classified in `scripts/harness/test-fast.ts` (T-09 makes the fast suite fail on unclassified files).
- No em dashes in output, copy or docs. No `deno fmt` on `site/`.

Values decided while planning (Claude's calls, reviewable):
- **Task-set hash.** The setups task-set hash is the campaign's harness `task_set` identity hash (`campaign.task_set.identity`). Its `display_name` defaults to `HX set <first 8 hex>` and can be set with a flag.
- **Run id.** `<campaign_id>:<arm>`. Publishing the same run id twice gives 409 `already_published`.
- **Cell outcomes.** A scored cell maps to `pass` or `fail` by its verdict. An unscored cell maps to `infra`. The harness has no separate env-blocked class today; `env_blocked` stays reserved.
- **Tool version.** The single distinct `observed.harness_version` across the arm's counted executions. More than one distinct version refuses publish with a message listing them.
- **Setup metadata.**
  - `agent_tool` = config `harness`.
  - `base_model` = `models.main`, or else the first slot.
  - `roles` = one row per model slot, `{role: slot, model, effort: null}`.
  - `ingredients` = instructions file (name and content), skill names, MCP names, hook names, `rules: []`, `settings: null`.
  - With `--submission <id>`, the site takes `description`, `visibility`, `roles` and `flow` from the submission row instead. Without it, `--description` is required and `--visibility` defaults to `public`.
- **Price note** when the cost is null: `"Price not available: N cells with unknown cost."` when the arm has unknown-spend cells, else `"Price not available."`.

## Review Focus

- Re-running publish for the same campaign and arm must not duplicate rows. It gives 409, with nothing written. (Task 1)
- A payload whose cell count does not equal tasks times repeats, or that names a task missing from `hx_tasks`, is refused with 400. (Task 1)
- A dry run never sends anything, and `--apply` with no admin key configured fails before any network call. (Task 4)
- Promoting an unknown hash gives 404, and promoting leaves exactly one current set. (Task 2)
- Publishing with `--submission` for a submission whose status is not `approved` is refused with 409. (Task 1)

---

### Task 1: Shared publish contract and the publish endpoint

**Files:**
- Create: `site/src/lib/shared/setup-publish.ts`, `site/src/lib/shared/setup-publish.test.ts`, `site/src/routes/api/v1/admin/setups/publish/+server.ts`, `site/src/lib/server/setup-publish.ts`, `site/tests/api/admin-setups-publish.test.ts`

**Interfaces:**
- Consumes: `adminRoute` from `site/src/lib/server/setup-submissions.ts` (signed path-bound or CF Access; gives `{env, actor, args}`). If `adminRoute` only supports `[id]` routes, generalise it minimally without changing part 2 behaviour. Also `deleteSubmissionKey(db, id, actor)`, `forceBumpDataEpochStmt(db)`, `appendAudit`, and `AGENT_TOOLS`, `Role`, `Ingredients` from `$lib/shared/setups`.
- Produces in `setup-publish.ts`, pure, importable by Deno through a relative path:

```ts
export interface SetupPublishPayload {
  setup: { id: string; agent_tool: AgentTool; base_model: string; description: string | null; visibility: 'public' | 'private' | null;
           roles: Role[]; ingredients: Ingredients };
  submission_id: string | null;
  task_set: { hash: string; display_name: string; tasks: { task_id: string; description_sha: string }[] };
  run: { id: string; tool_version: string; score: number; cost_per_solved_usd: number | null; price_note: string | null;
         excluded_cells: number; repeats: number;
         cells: { task_id: string; repeat: number; outcome: 'pass' | 'fail' | 'env_blocked' | 'infra'; cost_usd: number | null; duration_ms: number | null }[] };
}
export function validatePublishPayload(x: unknown): { ok: true; value: SetupPublishPayload } | { ok: false; errors: string[] };
```

  Validation rules:
  - The setup id pattern; agent tool in `AGENT_TOOLS`; score in [0, 1].
  - `cells.length === tasks.length * repeats`, each (task, repeat) exactly once, each task in `task_set.tasks`.
  - A 64-hex hash, and 64-hex `description_sha` values.
  - `description` is required when `submission_id` is null.
  - Strings are capped (description 200, display_name 100, tool_version 50, price_note 200).

- Endpoint `POST /api/v1/admin/setups/publish` (args = `SetupPublishPayload`) returns `201 { run_id, setup_id, task_set_hash }`. One `db.batch`:
  1. `INSERT OR IGNORE` into `setup_task_sets` with `is_current = 0`.
  2. `INSERT OR IGNORE` into `hx_tasks`.
  3. An upsert of `setups`.
  4. An insert of `setup_runs`, with `published_at` = now.
  5. Multi-row inserts of `setup_cells`, chunked so no statement exceeds D1's bound-parameter limit.
  6. With a submission: `UPDATE setup_submissions SET setup_id`, plus the key deletion and audit statements from `deleteSubmissionKey` (refactor it to return statements if it executes its own batch).
  7. `appendAudit` `setup.published`, and `forceBumpDataEpochStmt(db)`.
- With a submission, the setups row takes `description`, `visibility`, `roles_json` and `flow` from the submission row. The submission must exist (404) and be `approved` (409 `submission_not_approved`).
- Errors:
  - an existing run id gives 409 `already_published`;
  - validation failures give 400 `invalid_publish` with `details: errors`;
  - anything else gives a generic 500.

- [ ] **Step 1: Failing tests:**
  - Unit (`setup-publish.test.ts`): a valid payload passes. A bad id, `mock` tool, score 1.2, a missing cell, a duplicate cell, a cell for an unknown task, and a null description without a submission are each an error.
  - API, using the signed path-bound pattern from `tests/api/admin-setup-submissions.test.ts`:
    - A publish writes one `setup_runs` row, all cells, `hx_tasks` and the task set with `is_current = 0`, and the data epoch is bumped.
    - A second publish of the same run id gives 409, and the row counts are unchanged.
    - Publish with an approved submission sets `setup_id`, the submission's key columns are null, `key_deleted_at` is set, and the setup's description and visibility come from the submission.
    - A `new` submission gives 409.
    - An unsigned call gives 401.
    - `GET /api/v1/setups?set=<hash>` then lists the setup with the published score.
- [ ] **Step 2:** `cd site && npm run build && npx vitest run tests/api/admin-setups-publish.test.ts`, plus `npx vitest run --config vitest.unit.config.ts src/lib/shared/setup-publish.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run both. Expected: PASS. Run `tests/api/admin-setup-submissions.test.ts`; it is still green.
- [ ] **Step 5:** Commit `feat(site): admin setup publish endpoint`.

### Task 2: Promote endpoint

**Files:**
- Create: `site/src/routes/api/v1/admin/setups/task-sets/promote/+server.ts`, `site/tests/api/admin-setups-promote.test.ts`
- Modify: `site/src/lib/server/setup-publish.ts`

**Interfaces:**
- `POST /api/v1/admin/setups/task-sets/promote` with args `{ hash }` returns `200 { hash, promoted_at }`.
- One batch: `UPDATE setup_task_sets SET is_current = 0 WHERE is_current = 1`, then `UPDATE ... SET is_current = 1, promoted_at = now WHERE hash = ?`, an audit row `setup_task_set.promoted`, and `forceBumpDataEpochStmt`.
- An unknown hash gives 404 `not_found`, with nothing written.

- [ ] **Step 1: Failing tests:**
  - Promote set A, then set B: exactly one row has `is_current = 1`, and it is B.
  - An unknown hash gives 404.
  - An unsigned call gives 401.
  - After the promote, `GET /api/v1/setups` (no set) returns set B's ranking.
- [ ] **Step 2:** Build, run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): promote a setup task set`.

### Task 3: CLI signing and posting

**Files:**
- Create: `src/ingest/setups.ts`, `tests/unit/ingest/setups.test.ts`
- Modify: `src/ingest/sign.ts`

**Interfaces:**
- Produces:

```ts
// sign.ts
export async function signPathBound(payload: unknown, path: string, privateKey: Uint8Array, keyId: number, now?: Date): Promise<Signature>; // signs canonicalJSON({ payload, path, signed_at })
// setups.ts
export async function postSetupPublish(config: AdminConfig, key: Uint8Array, payload: SetupPublishPayload, opts?: RetryOptions): Promise<{ run_id: string; setup_id: string; task_set_hash: string }>;
export async function postSetupPromote(config: AdminConfig, key: Uint8Array, hash: string, opts?: RetryOptions): Promise<{ hash: string; promoted_at: string }>;
```

- The body is `{ signature, payload }`, posted with `postWithRetry` to `${url}/api/v1/admin/setups/publish` and `.../task-sets/promote`, with `maxAttempts: 3`. Do not retry a 409.
- A non-2xx response throws a `CentralGaugeError` carrying the server's error code.
- Use the same `canonicalJSON` the site uses (shared), so both sides agree byte for byte.
- `SetupPublishPayload` is imported from `site/src/lib/shared/setup-publish.ts` as a type only, following how other Deno code imports site shared types. If that is not possible, mirror the type and add a parity test.

- [ ] **Step 1: Failing tests (Deno, stubbed `fetch`):**
  - `signPathBound` verifies with `@noble/ed25519` against `canonicalJSON({payload, path, signed_at})`, and fails against `canonicalJSON(payload)` alone.
  - `postSetupPublish` posts to the publish path, and the signature verifies for that path.
  - A 409 response throws with code `already_published` after exactly one request.
  - A 500 is retried up to 3 attempts.
- [ ] **Step 2:** `deno test --allow-all tests/unit/ingest/setups.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS. Then `deno check`, `deno lint` and `deno fmt` on the changed files.
- [ ] **Step 5:** Commit `feat(ingest): path-bound admin signing and setup publish client`.

### Task 4: Build the payload from a campaign

**Files:**
- Create: `src/harness/publish-setup.ts`, `tests/unit/harness/publish-setup.test.ts`
- Modify: `scripts/harness/test-fast.ts` (classify the new test file)

**Interfaces:**
- Consumes:
  - `HarnessReport` and `CellRecord` (from `harnessReport` in `cli/commands/harness-command.ts:463`);
  - the campaign and execution records (`RecordStore`, `loadCampaignData`);
  - `loadConfig(harnessRoot, id)`;
  - `normalizeHxPrompt` from `shared/task-summaries.ts`, and a sha256 hex helper.
- Produces:

```ts
export interface PublishOptions { arm: string; setupId: string; submissionId: string | null; description: string | null; visibility: 'public' | 'private' | null; displayName: string | null; repoRoot: string; }
export async function buildSetupPublishPayload(report: HarnessReport, records: CampaignRecords, opts: PublishOptions): Promise<SetupPublishPayload>;
export class PublishRefused extends CentralGaugeError {} // code "PUBLISH_REFUSED", message names the reason
```

- Refusals, each with a clear message:
  - `report.partial` not null;
  - the arm not in `report.arms`;
  - the arm's `pass_rate` null;
  - the arm's config `harness` not in `AGENT_TOOLS`;
  - more than one distinct `observed.harness_version` among the arm's used executions;
  - a task `prompt.md` missing.
- Mapping per the Global Constraints' decided values:
  - `cells` come from `report.cells` for the arm: `cost_usd = spend_usd`, `duration_ms` = the sum of the used executions' `telemetry.wall_ms`, or null when any is null;
  - `excluded_cells` = the arm's `unscored_cells`;
  - `repeats` = `report.repeats.reported`;
  - task shas come from `harness-tasks/tasks/<id>/prompt.md` under `repoRoot`;
  - instructions content is read from the config's instructions component file.

- [ ] **Step 1: Failing tests.** Use the existing harness test fixtures; look in `tests/unit/harness/` for a helper that builds `CampaignRecords` and a report, and reuse it.
  - A complete two-task, two-repeat campaign maps to 4 cells, with pass/fail matching the verdicts and an unscored cell becoming `infra`.
  - The score equals the arm's `pass_rate`, and the cost equals `cost_per_solved_task`.
  - A null cost with unknown-spend cells gives `price_note` "Price not available: 1 cells with unknown cost.".
  - A partial report throws `PublishRefused`.
  - Two harness versions throw.
  - A `mock` arm throws.
  - `description_sha` equals the sha of the LF-normalised prompt, and the same file with CRLF gives the same sha.
  - The output passes `validatePublishPayload`.
- [ ] **Step 2:** `deno test --allow-all tests/unit/harness/publish-setup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Add the file to `CLASSES` in `scripts/harness/test-fast.ts`, picking the chunk by measured runtime.
- [ ] **Step 4:** Re-run. Expected: PASS. Run `deno task test:harness:fast` and confirm it passes, including the classification check. Then check, lint and fmt the changed files.
- [ ] **Step 5:** Commit `feat(harness): build setup publish payload from a campaign`.

### Task 5: CLI commands

**Files:**
- Modify: `cli/commands/harness-command.ts` (two small registrations calling into new code)
- Create: `cli/commands/harness-publish-setup.ts`, `tests/unit/cli/harness-publish-setup.test.ts`
- Modify: `scripts/harness/test-fast.ts`, if the new test is a harness test by its classification rules

**Interfaces:**
- `centralgauge harness publish-setup <experiment> --arm <id> --setup-id <slug> --judging campaign|current [--campaign <id>] [--submission <id>] [--description <text>] [--visibility public|private] [--display-name <text>] [--results-dir <dir>] [--apply]`.
  - It calls `harnessReport` with the same options `harness report` uses, then `buildSetupPublishPayload`.
  - Without `--apply` it prints a plain summary and exits 0, sending nothing. The summary covers setup id, tool, base model, version, task set hash, task count, repeats, score, price or note, excluded cells and submission.
  - With `--apply` it loads `loadAdminConfig` and `readPrivateKey` before anything else, then calls `postSetupPublish` and prints the result.
- `centralgauge harness promote-setup-set <hash> [--apply]`: a dry run prints what would be promoted; `--apply` calls `postSetupPromote`.
- Output uses `[Tag]` prefixes with `@std/fmt/colors`. `PublishRefused` prints `[FAIL] <reason>` and exits 1.

- [ ] **Step 1: Failing tests (stub `harnessReport` and the post functions through the command's injectable seams, the way existing harness command tests do; check `tests/unit/cli/` for the pattern):**
  - Without `--apply`, the summary contains the score and setup id, and the post stub is never called.
  - With `--apply` and no admin key configured, the command fails before calling the post stub.
  - With `--apply`, the stub receives a payload whose `run.id` is `<campaign>:<arm>`.
  - A refused build exits 1 with `[FAIL]`.
  - `promote-setup-set` without `--apply` does not post.
- [ ] **Step 2:** `deno test --allow-all tests/unit/cli/harness-publish-setup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the edits to `harness-command.ts` to the two registrations.
- [ ] **Step 4:** Re-run. Then `deno task test:harness:fast`, and `deno test --allow-all --ignore=tests/unit/container tests/unit/` once (never the container tests). Expected: PASS. Check, lint and fmt the changed files.
- [ ] **Step 5:** Commit `feat(cli): harness publish-setup and promote-setup-set`.

### Task 6: Docs

**Files:**
- Modify: `docs/cli/commands.md` (the two commands), `docs/site/setup-submissions.md` (a "Publishing a run" section: approve, translate by hand, run, `harness report`, publish dry run, `--apply`, promote the set, and that the key is deleted on publish)

- [ ] **Step 1:** Write the docs from the code. Plain sentences, no em dashes.
- [ ] **Step 2:** Commit `docs: publishing setup runs`.

## Not in this plan

- Adapters for Codex, OpenCode, Cursor and Antigravity (one plan each, when a submission needs one).
- An env-blocked cell class in the harness (`env_blocked` stays reserved on the site).
- Automatic key deletion on expiry.
- Prod: migrations 0024 and 0025, deploy, and any `--apply` against the live site (owner).
