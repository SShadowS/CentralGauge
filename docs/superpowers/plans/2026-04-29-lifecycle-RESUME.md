# Lifecycle Initiative — Resume Context (2026-05-02)

Session getting too big. This file pins the current state so a fresh
session can pick up exactly where the previous left off.

## Current state (2026-05-02)

**Master at `c5458ca`** — pushed to `origin/master`.

The 7-wave lifecycle initiative is **shipped to production**:

- ✅ D1 schema: `0006_lifecycle.sql` + `0007_family_diffs.sql` applied
  to remote D1 (`centralgauge`). Time Travel rollback bookmark recorded
  in this conversation history if needed.
- ✅ Worker deployed (latest: should be from commit `c5458ca`; verify
  via `npx wrangler deploy` if any post-`05f9bb6` commit needs to be
  live).
- ✅ Backfill: 14 lifecycle events written, 15 model-shortcomings JSONs
  renamed to vendor-prefixed slugs, 7 canonical concepts created.
- ✅ Cloudflare Access gating `/admin/lifecycle/*` and
  `/api/v1/admin/lifecycle/*` via GitHub OAuth + email allowlist.
  Team domain: `sshadows.cloudflareaccess.com`. AUD secret set via
  `wrangler secret put CF_ACCESS_AUD`.
- ✅ All 6 GitHub Actions secrets set: `CLOUDFLARE_API_TOKEN`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`,
  `OPENROUTER_API_KEY`, `ADMIN_KEY_PEM` (base64 of raw 32-byte
  Ed25519 key from `~/.centralgauge/keys/production-admin.ed25519`).
- ✅ Sticky digest issue created: GitHub issue #5 (currently FAILED
  state because the workflow runs hit the bug below).
- ⚠️ **`weekly-cycle.yml` failing at runtime** — see below.

## Pending blocker: weekly-cycle.yml workflow runs failing

Two runs attempted (`25250881199`, `25250948797`). Both failed at:

- `Doctor ingest precheck` step → exit 1
- `Generate digest` step → exit 1

Same error each time:

```
TypeError: Cannot read properties of undefined (reading 'GOOGLE_SDK_NODE_LOGGING')
```

Root cause: `@google/genai@1.50.1` reads `process.env.GOOGLE_SDK_NODE_LOGGING`
at module-init time. On Linux Deno (CI runners) `process` is not yet
wired up by Deno's Node compat layer when the npm dep is being
evaluated. Windows Deno is more permissive, so locally this works.

### Fixes attempted

1. Commit `05f9bb6` — polyfill at top of `cli/centralgauge.ts` body.
   Did NOT work because ES module imports hoist — `@google/genai` was
   evaluated BEFORE the polyfill code ran.
2. Commit `c5458ca` — split polyfill into `cli/_preamble.ts` (no other
   imports) and `import "./_preamble.ts";` as the FIRST statement in
   `centralgauge.ts`. ES module hoisting puts the preamble's top-level
   code before `@cliffy/command`'s import chain → before the
   transitive `@google/genai` load.
3. **Not yet verified** — need to trigger the workflow on master after
   `c5458ca` and watch.

### Next step on resume

```bash
cd U:/Git/CentralGauge
gh workflow run weekly-cycle.yml --ref master
sleep 5
RUN=$(gh run list --workflow=weekly-cycle.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status
```

If it still fails with the same error, the preamble approach didn't
work either. Likely root cause then: Deno itself fails to load the npm
dep at all on Linux (vs the polyfill timing being wrong). Investigate
options:

- Add `--unstable-process-globals` or similar Deno flag to the
  workflow's deno invocations.
- Lazy-load `gemini-adapter.ts` via dynamic `import()` so `@google/genai`
  isn't pulled in unless explicitly used. `doctor` and `lifecycle digest`
  don't need Gemini specifically.
- Pre-set `GOOGLE_SDK_NODE_LOGGING=""` env var on the workflow shell
  (might short-circuit the SDK's read before it crashes).

If it passes:

- Initiative ship is fully complete. Close GitHub issue #5 (delete
  current FAILED comment, post fresh success digest, close issue).
- Optionally fix the cosmetic items flagged in
  `docs/superpowers/plans/2026-04-29-lifecycle-COMPLETE.md` MINOR
  section (stale `lifecycle event-log` reference at line 77 etc).

## Background context

Full architecture + per-phase summary lives in:

- `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md`
  — strategic plan + schema appendix + canonical event types appendix.
- `docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md` — wavefront
  ordering.
- `docs/superpowers/plans/2026-04-29-lifecycle-COMPLETE.md` — final
  initiative ledger with operator handoff checklist.
- `docs/site/lifecycle.md` — operator + reviewer guide.
- `docs/site/operations.md` lines 1013-1257 — runbook entries
  (CF Access setup, force-unlock, concept-split recovery, weekly CI
  manual trigger, Plan E migration apply, stale digest interpretation).

## Production credentials (operator-controlled, NOT in this file)

- Admin signing key path: `C:/Users/SShadowS/.centralgauge/keys/production-admin.ed25519`
- Admin key id: `4` (per `~/.centralgauge.yml`)
- CF account id: `22c8fbe790464b492d9b178cc0f9255b`
- CF API token in shell env (`CLOUDFLARE_API_TOKEN=cfat_...`).
- API keys (OpenAI / Anthropic / Google / OpenRouter) in `.env`.

## Resume prompt (for fresh session)

```
The lifecycle event-sourcing initiative is shipped to production. Master
is at c5458ca on GitHub (SShadowS/CentralGauge). All 7 waves merged.
Production: migrations 0006 + 0007 applied, worker deployed, 14 events
backfilled, 7 concepts backfilled, CF Access gating /admin/lifecycle/*.

Current blocker: GitHub Actions workflow weekly-cycle.yml fails at
"Doctor ingest precheck" and "Generate digest" steps with
`TypeError: Cannot read properties of undefined (reading 'GOOGLE_SDK_NODE_LOGGING')`.

Root cause: @google/genai@1.50.1 reads process.env at module-init on
Linux Deno before Deno's Node compat layer is wired up. Windows Deno
works locally; Linux CI doesn't.

I tried two fixes:
1. Polyfill at top of cli/centralgauge.ts body (didn't help — ES module
   hoisting evaluated @google/genai BEFORE the polyfill ran).
2. Split into cli/_preamble.ts hoisted as the first import (commit
   c5458ca — pushed but not yet verified by re-running the workflow).

Resume by:
1. Triggering the workflow: `gh workflow run weekly-cycle.yml --ref master`
2. Watching: `gh run watch <id> --exit-status`
3. If preamble fixed it → close GitHub issue #5, ship-celebrate.
4. If still failing → try lazy-load gemini-adapter via dynamic import,
   OR add Deno flag (--unstable-process-globals or similar), OR
   pre-set GOOGLE_SDK_NODE_LOGGING="" via workflow env.

Background: read docs/superpowers/plans/2026-04-29-lifecycle-RESUME.md
for full state. Strategic plan at
docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md.

The CLI works locally on Windows (638 deno + 638-ish vitest tests
green). Lifecycle infrastructure is fully operational via CLI signed
paths regardless of CI status.
```
