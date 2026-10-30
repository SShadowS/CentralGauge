# Setup Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, private-by-default form where people submit an agent setup (form fields, one zip, an optional short-lived key), a secret edit link for later changes, and an admin-only page where the owner reviews submissions.

**Architecture:** Submissions live in a new D1 table, never exposed by any public read. The zip goes to the existing R2 bucket `BLOBS` under `setup-submissions/`. A submitter key is AES-GCM encrypted with a worker secret and stored apart from the zip. The public endpoints are protected by Turnstile, a per-IP daily cap and size caps. The admin API uses the existing `authenticateAdminRequest` (Cloudflare Access or signed CLI), and the admin pages sit under the existing `/admin` gate.

**Tech Stack:** SvelteKit (Svelte 5), Cloudflare Workers + D1 + R2, WebCrypto, Cloudflare Turnstile, vitest (pool-workers and jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-setups-leaderboard-design.md` (section "Submissions", part 2 of the build order). Part 1 is merged in master (`bc097ae2`).

## Global Constraints

- Required fields: agent tool (exactly `claude-code`, `codex`, `pi`, `opencode`, `cursor`, `antigravity`), base model, instructions file (CLAUDE.md or AGENTS.md), description, visibility (`public` default, or `private`).
- Optional fields: a roles table (role, model, effort) and a free-text flow.
- Everything else comes as one zip in the tool's normal project layout.
- A key goes in a separate secret field, never in the zip. It should expire at most 7 days after submission. It is stored encrypted, apart from the zip, and deleted when the run finishes (the run-finish trigger is part 3; this plan provides the delete).
- The submitter gets a secret edit link: the only way to send a fresh key or change visibility. There are no accounts.
- The public upload is protected by Turnstile, a rate limit and a zip size cap.
- The owner reviews every submission and triggers runs by hand. There are no status notifications.
- The form accepts all six tools, including tools the harness cannot run yet.
- No submission data appears on any public page or public API, except to the holder of that submission's edit token.
- No `deno fmt` on `site/` files. No em dashes in UI copy.
- No prod deploy, D1 migration apply, `wrangler secret put` or ingest: those stay with the owner.

Values decided while planning (Claude's calls, reviewable):
- Zip cap: 10 MiB. Instructions file cap: 200 KiB. Description: 1 to 200 characters. Flow: up to 4000 characters. Roles: up to 12 rows.
- Per-IP cap: 5 submissions per rolling 24 hours, counted in D1 by IP hash.
- Key expiry: when a key is given, a "key expires on" date is required and must be no later than 7 days after submission.
- Submission statuses: `new`, `approved`, `rejected`. Rejecting deletes the stored key.
- The edit token travels in the URL fragment (`/submit/edit/<id>#<token>`), so it never reaches server logs. Only its SHA-256 hash is stored.

## Review Focus

- A forged or replayed edit token, or another submission's token, must never read or change a submission. (Task 6)
- An oversized or non-zip upload is rejected with 413/400 before anything is written to R2 or D1. (Task 5)
- A missing or failed Turnstile token rejects the submission, and Turnstile being unreachable fails closed. (Task 3, Task 5)
- The plaintext key never appears in any response, log line or D1 column, except in the audited admin reveal. (Tasks 2, 5, 6, 8)
- Missing worker secrets (`TURNSTILE_SECRET_KEY`, `SUBMISSION_KEY_SECRET`) give a clear 503 `submissions_unavailable`, never a 500 with a stack and never an unprotected accept. (Task 5)

---

### Task 1: Migration 0025 for submissions

**Files:**
- Create: `site/migrations/0025_setup_submissions.sql`
- Modify: `site/tests/utils/reset-db.ts`, `site/tests/migrations.test.ts`

**Interfaces:**
- Produces:

```sql
CREATE TABLE setup_submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  agent_tool TEXT NOT NULL CHECK (agent_tool IN ('claude-code','codex','pi','opencode','cursor','antigravity')),
  base_model TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  instructions_name TEXT NOT NULL CHECK (instructions_name IN ('CLAUDE.md','AGENTS.md')),
  instructions_md TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  flow TEXT,
  zip_key TEXT NOT NULL, zip_bytes INTEGER NOT NULL, zip_sha256 TEXT NOT NULL,
  key_ciphertext BLOB, key_iv BLOB, key_expires_on TEXT, key_deleted_at TEXT,
  edit_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','rejected')),
  review_note TEXT, reviewed_at TEXT,
  setup_id TEXT REFERENCES setups(id),
  updated_at TEXT NOT NULL);
CREATE INDEX idx_setup_submissions_ip ON setup_submissions(ip_hash, created_at);
CREATE INDEX idx_setup_submissions_status ON setup_submissions(status, created_at);
```

`setup_id` links a submission to its ranked setup; plan 3 fills it.

- [ ] **Step 1:** Add `setup_submissions` to the expected list in `tests/migrations.test.ts`. Add a test that inserting `instructions_name = 'README.md'` fails the CHECK.
- [ ] **Step 2:** `cd site && npm run build && npx vitest run tests/migrations.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. Add `setup_submissions` to `resetDb()` before `setups` (it references `setups`).
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): setup submissions table (migration 0025)`.

### Task 2: Key encryption and edit tokens

**Files:**
- Create: `site/src/lib/server/submission-crypto.ts`, `site/tests/server/submission-crypto.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SealedKey { ciphertext: Uint8Array; iv: Uint8Array; }
export async function sealKey(plaintext: string, secretB64: string): Promise<SealedKey>;   // AES-256-GCM, fresh 12-byte iv
export async function openKey(sealed: SealedKey, secretB64: string): Promise<string>;
export function newEditToken(): string;                                                    // 32 random bytes, base64url
export async function hashToken(token: string): Promise<string>;                         // sha256 hex
export async function tokenMatches(token: string, storedHash: string): Promise<boolean>; // constant-time compare of hashes
export async function hashIp(ip: string): Promise<string>;                               // sha256 hex of ip
```

`secretB64` is the worker secret `SUBMISSION_KEY_SECRET`: base64 of 32 random bytes. A secret that does not decode to 32 bytes throws `ApiError(503, 'submissions_unavailable', ...)`.

- [ ] **Step 1: Failing tests:**
  - `openKey(await sealKey('sk-test-123', S), S) === 'sk-test-123'`.
  - Two seals of the same text give different `iv` and `ciphertext`.
  - `openKey` with a different secret rejects.
  - A tampered ciphertext byte rejects.
  - A 16-byte secret throws with code `submissions_unavailable`.
  - `newEditToken()` is 43 characters of `[A-Za-z0-9_-]`, and two calls differ.
  - `tokenMatches(t, await hashToken(t))` is true, and false for a different token.
- [ ] **Step 2:** `cd site && npm run build && npx vitest run tests/server/submission-crypto.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement with WebCrypto only (no new dependency).
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): submission key sealing and edit tokens`.

### Task 3: Turnstile verification

**Files:**
- Create: `site/src/lib/server/turnstile.ts`, `site/tests/server/turnstile.test.ts`

**Interfaces:**
- Produces: `export async function verifyTurnstile(token: string | null, secret: string, ip: string | null, fetchFn: typeof fetch = fetch): Promise<boolean>`. It POSTs form fields `secret`, `response`, and `remoteip` (when present) to `https://challenges.cloudflare.com/turnstile/v0/siteverify` and returns `json.success === true`. An empty or null token, a non-2xx response, a network error or invalid JSON all return `false` (fail closed).

- [ ] **Step 1: Failing tests** with a stub `fetchFn`:
  - success true gives true, and the stub received `secret`, `response` and `remoteip`;
  - success false gives false;
  - a null token gives false without calling fetch;
  - a stub that throws gives false;
  - a 500 response gives false.
- [ ] **Step 2:** Run `npx vitest run tests/server/turnstile.test.ts` (after build). Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): turnstile verification`.

### Task 4: Submission validation

**Files:**
- Create: `site/src/lib/shared/setup-submission.ts`, `site/src/lib/shared/setup-submission.test.ts`

**Interfaces:**
- Consumes: `AGENT_TOOLS`, `Role` from `$lib/shared/setups`.
- Produces:

```ts
export const SUBMISSION_LIMITS = { zipBytes: 10 * 1024 * 1024, instructionsBytes: 200 * 1024, descriptionMax: 200, flowMax: 4000, rolesMax: 12, keyMaxDays: 7, perIpPerDay: 5 } as const;
export interface SubmissionFields {
  agent_tool: AgentTool; base_model: string; description: string; visibility: 'public' | 'private';
  instructions_name: 'CLAUDE.md' | 'AGENTS.md'; roles: Role[]; flow: string | null;
  key: string | null; key_expires_on: string | null; // YYYY-MM-DD
}
export type FieldErrors = Partial<Record<keyof SubmissionFields | 'zip' | 'instructions', string>>;
export function parseSubmissionFields(raw: Record<string, string>, today: string /* YYYY-MM-DD */): { ok: true; value: SubmissionFields } | { ok: false; errors: FieldErrors };
export function isZip(bytes: Uint8Array): boolean; // starts with PK\x03\x04 (or PK\x05\x06 for an empty zip)
```

- Raw roles arrive as `roles_json` (a JSON array of `{role, model, effort}`).
- Trim all strings.
- `visibility` defaults to `public` when absent.
- A key without `key_expires_on`, or with an expiry before `today` or more than 7 days after it, is an error on `key_expires_on`.
- An expiry without a key is ignored (set to null).
- Error messages are plain sentences with no em dashes.

- [ ] **Step 1: Failing tests** (one assertion group each):
  - a valid minimal input passes, with visibility defaulting to `public`;
  - each required field missing gives an error on that field;
  - `agent_tool: 'vscode'` is an error;
  - `instructions_name: 'README.md'` is an error;
  - a 201-character description is an error;
  - 13 roles is an error;
  - malformed `roles_json` is an error on `roles`;
  - a key with expiry `today + 8 days` is an error, and `today + 7` passes;
  - a key without an expiry is an error;
  - `isZip` is true for `PK\x03\x04...` and false for `%PDF`.
- [ ] **Step 2:** `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/setup-submission.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): submission field validation`.

### Task 5: Create-submission endpoint

**Files:**
- Create: `site/src/routes/api/v1/setup-submissions/+server.ts`, `site/src/lib/server/setup-submissions.ts`, `site/tests/api/setup-submissions.test.ts`
- Modify: `site/vitest.config.ts` (test bindings `TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA'`, plus `SUBMISSION_KEY_SECRET` set to a fixed base64 of 32 bytes), `site/wrangler.toml` (comment documenting the two new secrets, following the existing secret comments; add var `TURNSTILE_SITE_KEY` with Cloudflare's always-pass test site key `1x00000000000000000000AA` and a comment saying the owner replaces it).

**Interfaces:**
- Consumes: Tasks 2, 3 and 4. `ApiError` and `errorResponse` from `src/lib/server/errors.ts`. `env.BLOBS`, `env.DB`.
- Produces: `POST /api/v1/setup-submissions`, multipart, with:
  - fields from `SubmissionFields`, sent as strings;
  - `instructions` (file);
  - `zip` (file);
  - `cf-turnstile-response`.

  Response `201 { id, edit_path }`, where `edit_path = '/submit/edit/<id>#<token>'`.
- Order, each failing early:
  1. Secrets present (else 503 `submissions_unavailable`).
  2. `content-length` over `zipBytes + instructionsBytes + 64 KiB` gives 413 `payload_too_large` before reading the body.
  3. Turnstile fails: 403 `captcha_failed`.
  4. More than 5 submissions from `hashIp(cf-connecting-ip)` in the last 24 h: 429 `submission_limit`.
  5. Field errors: 400 `invalid_submission` with `details: FieldErrors`.
  6. Instructions file over cap or not UTF-8 text: 400.
  7. Zip over cap: 413. Not a zip: 400 on `zip`.
  8. R2 put `setup-submissions/<id>.zip` (validate with `validateR2Key`).
  9. D1 insert. A key, when given, is sealed into `key_ciphertext` and `key_iv`.
- `id` = 16 random bytes as hex. `zip_sha256` = sha256 hex of the zip bytes.
- Produces in `setup-submissions.ts`: `insertSubmission(db, row)`, `countRecentByIp(db, ipHash, sinceIso): Promise<number>`, `getSubmission(db, id)` (full row, server-only), `SubmissionRow` type. Later tasks add to this module.
- Turnstile in tests: the test secret `1x...AA` always passes, but the worker test cannot rely on network access. Intercept the siteverify fetch with the mechanism this `@cloudflare/vitest-pool-workers` version supports (check `fetchMock` from `cloudflare:test` first). If none works, inject `verifyTurnstile` through a module the route imports, and test the route with the real module mocked at that seam. Never add an env flag that skips verification.

- [ ] **Step 1: Failing tests** (`SELF.fetch` with a same-origin `Origin` header; seed R2 in `beforeAll` where needed, per the deadlock note in `tests/api/transcripts.test.ts`):
  - A valid submission gives 201. The D1 row exists with `status = 'new'`, the R2 object exists with the uploaded bytes, `edit_path` matches `/submit/edit/<id>#<43 chars>`, and `edit_token_hash` is not the token.
  - With a key: `key_ciphertext` is not null, and no D1 column or response body contains the plaintext key.
  - Turnstile failure gives 403, with nothing written to R2 or D1.
  - The 6th submission from the same IP within 24 h gives 429.
  - A `.pdf` as zip gives 400 with `details.zip`. An 11 MiB zip gives 413.
  - Missing `SUBMISSION_KEY_SECRET`: cover through the unit seam if the env cannot be changed per test; 503 `submissions_unavailable`.
  - A field error gives 400 with `details.description`.
- [ ] **Step 2:** `cd site && npm run build && npx vitest run tests/api/setup-submissions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS. Then run `tests/rate-limit.test.ts` (unchanged, still green).
- [ ] **Step 5:** Commit `feat(site): create setup submission endpoint`.

### Task 6: Edit-link endpoints

**Files:**
- Create: `site/src/routes/api/v1/setup-submissions/[id]/status/+server.ts`, `site/src/routes/api/v1/setup-submissions/[id]/edit/+server.ts`, `site/tests/api/setup-submission-edit.test.ts`
- Modify: `site/src/lib/server/setup-submissions.ts`

**Interfaces:**
- Consumes: `tokenMatches`, `sealKey`, `parseSubmissionFields` rules for key and expiry, `bumpDataEpochStmt` (`src/lib/server/data-epoch.ts`).
- Produces:
  - `POST .../status` with JSON `{ token }` returns `200 { id, status, created_at, agent_tool, base_model, description, visibility, has_key: boolean, key_expires_on, setup_id }`. Never the key, never the instructions content.
  - `POST .../edit` with JSON `{ token, visibility?, key?, key_expires_on? }` returns the same shape after the update.
- Rules:
  - A wrong token or unknown id gives 404 `not_found` for both: do not reveal which.
  - A new key replaces the old sealed key and clears `key_deleted_at`. It needs a valid expiry, at most 7 days from today.
  - A visibility change also updates `setups.visibility` when `setup_id` is set, in one `db.batch` with `bumpDataEpochStmt(db)`.
  - `updated_at` is set on every edit.

- [ ] **Step 1: Failing tests:**
  - The right token gives 200 with `has_key`, and the body has no `instructions_md` or key.
  - A wrong token gives 404. Submission A's token on submission B's id gives 404.
  - Changing visibility to `private` persists.
  - A new key with a valid expiry gives `has_key: true`, and the ciphertext changed.
  - A key with expiry today + 8 gives 400.
  - With `setup_id` linked to a seeded `setups` row, a visibility edit updates that row too.
- [ ] **Step 2:** Build, then `npx vitest run tests/api/setup-submission-edit.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): submission edit link endpoints`.

### Task 7: Public submit and edit pages

**Files:**
- Create: `site/src/routes/submit/+page.server.ts` (passes `TURNSTILE_SITE_KEY`), `site/src/routes/submit/+page.svelte`, `site/src/routes/submit/edit/[id]/+page.svelte`, `site/src/lib/components/domain/SubmitForm.svelte`, `site/src/lib/components/domain/SubmitForm.test.svelte.ts`, `site/tests/e2e/submit.spec.ts`
- Modify: `site/src/lib/components/layout/Nav.svelte` (add "Submit" after "Setups"), `site/scripts/build-sitemap.ts` (`/submit`), the command-palette search index (as Task 6 of plan 1 did for `/setups`)

**Interfaces:**
- Consumes: the Task 5 and Task 6 endpoints; `SUBMISSION_LIMITS`; `AGENT_TOOLS`.
- `SubmitForm` props: `{ siteKey: string; onsubmitted(result: { id: string; edit_path: string }): void }`. It renders:
  - a select for agent tool with all six tools;
  - base model and description text fields;
  - a visibility radio, public by default, with one line explaining private: hidden from the chart unless a visitor turns it on, and the files are never shown;
  - an instructions file input (accept `.md`) with a name select CLAUDE.md or AGENTS.md;
  - a roles table with add and remove buttons;
  - a flow textarea;
  - a zip input (accept `.zip`) stating the 10 MiB limit;
  - an optional key field (`type=password`, `autocomplete=off`) with an expiry date input and the sentence "Use a key that expires within 7 days. Setups that need no key are preferred.";
  - the Turnstile widget (`https://challenges.cloudflare.com/turnstile/v0/api.js`, explicit render).
- It posts `FormData` with `fetch`. Field errors from a 400 `details` show next to their fields.
- After success the page shows the edit link as a full URL with a copy button and the sentence "Save this link. It is the only way to change visibility or send a fresh key, and it cannot be recovered."
- `/submit/edit/[id]` reads the token from `location.hash` and loads status via POST. It shows the status, a visibility switch, and a fresh-key field with expiry. With no hash it shows "This link is missing its secret part."
- Copy has no em dashes. Every input has a label.

- [ ] **Step 1: Failing component tests:**
  - all six tools appear in the select;
  - submitting with a 400 whose `details.description` is set shows that message next to the description field;
  - on 201, `onsubmitted` is called with the id and edit path;
  - the key input has `type="password"`.
- [ ] **Step 2:** `npx vitest run --config vitest.unit.config.ts SubmitForm`. Expected: FAIL.
- [ ] **Step 3:** Implement the component, pages, nav entry, sitemap and search entries.
- [ ] **Step 4:** Re-run. Then `npm run check` gives 0 errors. Then write `submit.spec.ts`: `/submit` renders the form and all six tools, the nav has "Submit", and axe on `/submit` finds no serious or critical issues. Run `npm run test:e2e:ci`. Clear `site/.wrangler/state/v3/cache` first, because wrangler serves stale asset hashes after a rebuild. Expected: the new spec passes.
- [ ] **Step 5:** Commit `feat(site): submit and edit pages`.

### Task 8: Admin API

**Files:**
- Create: `site/src/routes/api/v1/admin/setup-submissions/+server.ts` (list), and under `[id]/`: `+server.ts` (detail), `zip/+server.ts`, `key/+server.ts`, `review/+server.ts`, `delete-key/+server.ts`. Create `site/tests/api/admin-setup-submissions.test.ts`.
- Modify: `site/src/lib/server/setup-submissions.ts`

**Interfaces:**
- Consumes: `authenticateAdminRequest`, `actorIdFromAuth` (`src/lib/server/cf-access.ts`), `openKey`. The audit mechanism used by `src/routes/api/v1/admin/runs/exclude/+server.ts`: use the same table and helper, with event names `submission.key_revealed`, `submission.reviewed` and `submission.key_deleted`.
- All are POST with a JSON body, so the signed CLI path works. Copy the body-signature pattern from `admin/lifecycle/review/[id]/decide/+server.ts`.
  - list `{ status?: 'new'|'approved'|'rejected' }` returns `{ submissions: [{ id, created_at, agent_tool, base_model, description, visibility, status, has_key, key_expires_on, zip_bytes }] }`, newest first, at most 200.
  - detail returns the row without key columns, plus `instructions_md`, `roles`, `flow`, `zip_sha256` and `review_note`.
  - zip streams the R2 object with `content-type: application/zip` and `content-disposition: attachment; filename="<id>.zip"`.
  - key returns `{ key, key_expires_on }`, decrypted, and writes the audit event. It returns 404 `no_key` when there is none or it was deleted.
  - review `{ status: 'approved'|'rejected', note? }` sets status, note and `reviewed_at`. Rejecting also deletes the key (nulls `key_ciphertext` and `key_iv`, sets `key_deleted_at`). Audited.
  - delete-key nulls the key columns and sets `key_deleted_at`. It is idempotent. Audited. Plan 3 calls the same server function, `deleteSubmissionKey(db, id, actor)`, when a run finishes.
- Unauthenticated calls give 401/403, per `authenticateAdminRequest`.

- [ ] **Step 1: Failing tests** using the signed-payload pattern (`tests/fixtures/keys.ts` `createSignedPayload`, `registerMachineKey`, as in `tests/api/lifecycle-review-decide.test.ts`):
  - an unsigned list call is rejected;
  - signed list returns the seeded submissions, and no list entry has key or instructions fields;
  - the key reveal returns the plaintext of a sealed seed key and writes one audit row;
  - a review with `rejected` sets the status and deletes the key, after which the key reveal gives 404 `no_key`;
  - delete-key twice gives 200 both times;
  - zip returns the seeded bytes with the attachment header.
- [ ] **Step 2:** Build, then `npx vitest run tests/api/admin-setup-submissions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(site): admin API for setup submissions`.

### Task 9: Admin review pages

**Files:**
- Create: `site/src/routes/admin/submissions/+page.server.ts`, `+page.svelte`, `site/src/routes/admin/submissions/[id]/+page.server.ts`, `+page.svelte`, `site/tests/api/admin-submissions-ssr-gate.test.ts`

**Interfaces:**
- Consumes: the Task 8 endpoints. Copy the load and fetch pattern of `site/src/routes/admin/lifecycle/review/+page.server.ts` and `+page.svelte` exactly, including how the browser posts to the admin API.
- The list page shows a status filter (new by default) and a table of id, date, tool, base model, description, visibility, key yes/no with expiry, and zip size, linking to the detail.
- The detail page shows:
  - all fields and the roles table;
  - flow as escaped text;
  - the instructions rendered with `MarkdownRenderer` (it sanitises);
  - a "Download zip" link;
  - a "Reveal key" button, which shows the key only after the click, with a note that the reveal is logged;
  - "Approve" and "Reject" with a note box, plus "Delete key".
- [ ] **Step 1: Failing test:** `GET /admin/submissions` and `GET /admin/submissions/x` without Access give 403 or 500 exactly as `tests/api/admin-ssr-gate.test.ts` asserts for lifecycle pages.
- [ ] **Step 2:** Build, then run it. Expected: FAIL (404 before the routes exist).
- [ ] **Step 3:** Implement both pages.
- [ ] **Step 4:** Re-run, then `npm run check` gives 0 errors, then `npm test` passes in full.
- [ ] **Step 5:** Commit `feat(site): admin review pages for setup submissions`.

### Task 10: Owner runbook

**Files:**
- Create: `docs/site/setup-submissions.md`

- [ ] **Step 1:** Write the operator note:
  - Deploy order: apply migration 0025, then deploy. `wrangler secret put TURNSTILE_SECRET_KEY` and `wrangler secret put SUBMISSION_KEY_SECRET`; the latter is base64 of 32 random bytes, with the one-line `openssl rand -base64 32` command. Set `TURNSTILE_SITE_KEY` in `wrangler.toml` to the real site key, and create the Turnstile widget for `ai.sshadows.dk` in the Cloudflare dashboard.
  - Review flow: list, detail, download zip, reveal key (logged), approve or reject.
  - The hand translation from zip to run config is the owner's job (spec).
  - Rotating `SUBMISSION_KEY_SECRET` makes stored keys unreadable, so delete keys first.
  - No em dashes.
- [ ] **Step 2:** Commit `docs(site): setup submissions runbook`.

## Not in this plan

- Linking a submission to a ranked setup and deleting the key when its run finishes (plan 3, using `setup_id` and `deleteSubmissionKey`).
- Unpacking or inspecting the zip on the server (the owner reviews it by hand).
- Notifications to submitters (spec: none for now).
- Prod migration, secrets and deploy (owner).
