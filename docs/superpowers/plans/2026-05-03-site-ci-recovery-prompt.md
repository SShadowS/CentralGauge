# Resume Prompt — Site CI Recovery

Copy the section below into a fresh Claude Code session to continue the Site CI work.

---

## Prompt to paste

> Continue Site CI recovery work in `U:\Git\CentralGauge`. Full context is in `docs/superpowers/plans/2026-05-03-site-ci-recovery.md` — read it first.
>
> **Current state:** `unit-and-build` job is green (commit `66356b0`). `e2e` and `lighthouse` jobs still red on two pre-existing app bugs. Latest local commit is `8223df1` (recovery doc), not yet pushed. The recovery doc enumerates everything that was fixed and everything that remains.
>
> **Tasks (in priority order):**
>
> ### Task 1 — Fix Bug A: transcript page returns 500 from 308 redirect
>
> File: `site/src/routes/runs/[id]/transcripts/[taskId]/[attempt]/+page.server.ts`
>
> The page calls `await fetch('/api/v1/runs/${params.id}')`. SvelteKit's server-internal fetch returns 308 (probably trailing-slash canonicalization). Then line 12 does `if (!runRes.ok) throw error(runRes.status, ...)` — `error(308, ...)` crashes because SvelteKit only accepts 400-599.
>
> Steps:
> 1. Investigate why `/api/v1/runs/run-0000` returns 308 in the first place. Look at `site/src/routes/api/v1/runs/[id]/+server.ts` and any `hooks.server.ts` redirect logic. Check `svelte.config.js` for `kit.trailingSlash` setting.
> 2. If the 308 is a real bug (e.g., unintended trailing-slash redirect on API routes), fix at the root cause.
> 3. Otherwise, defensive-fix the page: clamp the status before throwing, e.g. `throw error(runRes.status >= 400 && runRes.status <= 599 ? runRes.status : 502, ...)`. Same fix applies to the second `fetch()` at line 29 (`/api/v1/transcripts/...`).
> 4. Verify locally: `cd site && npm run build && npm run preview` then `curl -i http://127.0.0.1:4173/runs/run-0000/transcripts/CG-AL-E001/1` (after `npm run seed:e2e`). Should not be 500.
>
> ### Task 2 — Fix Bug B: extend `seed-e2e.ts` to write R2 transcript blobs
>
> File: `site/scripts/seed-e2e.ts`
>
> Current script seeds D1 only. Tests + lighthouse URLs that read transcripts from R2 fail because `attempt.transcript_key` resolves to a missing blob.
>
> Steps:
> 1. Add a transcript_key naming scheme. Convention: `transcripts/${run_id}/${task_id}/${attempt}.txt` (verify by reading the actual schema and existing producer code in `src/ingest/`).
> 2. Verify `results` table has a `transcript_key` column; if not, the schema needs alignment too. Look at `site/migrations/*.sql`.
> 3. Update the seeded `INSERT INTO results` rows in `seed-e2e.ts` to populate `transcript_key`.
> 4. Create a fixture file under `site/scripts/fixtures/sample-transcript.txt` (a few hundred bytes of realistic transcript text — copy a snippet from a real one if available).
> 5. After the existing D1 seed, add a loop that calls `wrangler r2 object put centralgauge-blobs <key> --local --file=./scripts/fixtures/sample-transcript.txt` for each seeded transcript_key. Verify the bucket name in `site/wrangler.toml`.
> 6. Verify locally: `cd site && npm run seed:e2e && npm run build && npm run preview` then visit `http://127.0.0.1:4173/runs/run-0000/transcripts/CG-AL-E001/1` — page should render, not 500.
>
> ### Task 3 (optional) — Restore the transcript URL to lighthouserc.json
>
> File: `site/lighthouserc.json`
>
> After Bug A + B are fixed, restore `"http://127.0.0.1:4173/runs/run-0000/transcripts/CG-AL-E001/1"` to the `collect.url` array (was at position 7 between `/runs/run-0000` and `/families` — see commit `66356b0`). This brings lighthouse back to its original 14 URLs.
>
> ### Verification + push
>
> After Tasks 1-2:
>
> 1. From `site/`: `npm run check` (zero errors), `npm run build` (success), `npm run test:main` (all pass), `npm run seed:e2e && npx playwright test` (all pass).
> 2. Commit each task as its own commit per CLAUDE.md style.
> 3. Push: `git push origin master`. Watch `gh run list --workflow="Site CI" --limit 1`.
>
> ### Constraints
>
> - Stay on master, commit on master (authorized).
> - Do NOT run `deno fmt` on `site/` — site uses prettier (`cd site && npx prettier --write <file>`).
> - Site tests need a fresh build (`npm run build`) before `npm test` — see CLAUDE.md.
> - Do NOT re-add `baseUrl`/`paths` to `site/tsconfig.json` — breaks `wrangler types && vite dev` silently. SvelteKit owns paths via `kit.alias` in `svelte.config.js`. The cross-boundary zod issue is solved by `<repo>/package.json` (already committed at `8223df1`'s parent).
> - The local commit `8223df1` (recovery doc) is unpushed — push it as part of your first commit OR push it standalone first; either is fine.
>
> ### Reference docs in this repo
>
> - `docs/superpowers/plans/2026-05-03-site-ci-recovery.md` — what was already fixed, what remains, with file:line refs.
> - `docs/superpowers/plans/2026-05-03-persistent-pwsh-session-followups.md` — separate I3/I4/S1 follow-ups, NOT in scope here.
> - `CLAUDE.md` — project conventions, especially the "Worker tests (`site/`)" section.
>
> Report back with: per-task status, commit SHAs, CI run URL after push.

---

## End of prompt
