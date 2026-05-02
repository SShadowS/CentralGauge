# P6 — Stabilization (production hotfixes, type system, interface alignment, test hardening, custom-domain readiness) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P6 closes the remaining gaps surfaced by the post-P5.5-cutover production audit. The site is live at `https://centralgauge.sshadows.workers.dev`, indexed, with the leaderboard at `/`. Three production bugs were found (search 500, tasks empty, canary scope leak); a dozen type system issues exist (loose `passthroughLoader<T>` generics, missing `label` props on Input atoms, Lucide `aria-hidden` typing conflict, snippet typing in `*.test.svelte.ts`); several interface drift issues exist (`RunDetail.completed_at` non-nullable but API emits `''`, dead `LimitationItem` interface, terse empty states); plus minor cleanup (stale wrangler.toml comment, TaskDetailPanel unused CSS). After P6 lands:

1. **`/search` works in production.** Null `snippet` from contentless FTS5 stops crashing `SearchResultRow.svelte:18`. The FTS5 schema gains a precomputed `snippet_text` column on `results` that `snippet()` references — additive migration, no rebuild risk; old rows backfilled in-place; new ingest writes it via the existing trigger.
2. **`/tasks` and `/tasks/[id]` populate correctly.** A one-time `sync-catalog --apply` operator action backfills the `tasks` table; a new READ-ONLY health endpoint `/api/v1/health/catalog-drift` (NOT under `/admin/` — admin endpoints require signature gating) plus a daily INLINE cron probe (no HTTP self-fetch) surface any future drift early; empty-state messaging makes "0 rows" diagnostic instead of mysterious.
3. **Canary `/_canary/<sha>/<route>` stops escaping its scope.** The reverse-proxy at `_canary/[sha]/[...path]/+page.server.ts` injects a `<base href="/_canary/<sha>/">` tag into the wrapped HTML before serving it via the iframe `srcdoc`. All relative links (and link-click navigation inside the iframe) resolve under canary scope; absolute `href="/foo"` links are also rewritten to `/_canary/<sha>/foo` for safety. (Server-side `Location` rewriting is moot — the wrapped `event.fetch()` follows redirects automatically and returns target HTML; the leak vector is link-click navigation INSIDE the iframe, not the proxy fetch.)
4. **`redirect-sunset.test.ts` is a real CI guard, not a doc lie.** The file already exists (verified at audit time — earlier audit text was wrong on this point). P6 confirms it runs in CI, adds a CI-step assertion, and documents the deletion playbook.
5. **`passthroughLoader<TKey, TVal>` returns the precise type** `{[K in TKey]: TVal}` instead of the loose `Record<string, TVal>`. 17+ typecheck errors across 5 routes resolve in a single edit.
6. **Lucide icons share a typed `IconBase.svelte`.** ~30 `aria-hidden` Booleanish typing errors collapse to zero. All 25+ icon components become 1-line wrappers around `IconBase`.
7. **Type debt eliminated.** Snippet typing in `*.test.svelte.ts`, health-test body narrowing, unused `@ts-expect-error` directives, missing `label` props on Input atoms — all fixed at the helper level so they don't recur.
8. **Test hardening.** `@cf-wasm/og` cold-init flake on parallel CI is fixed via `beforeAll` warmup; visual-regression baseline captures the first Ubuntu reference set; OG kv-writes invariants documented.
9. **Custom-domain flip is fully prepared but NOT executed.** Phase G is held until explicit user trigger. Operator playbook + verification scripts staged in `docs/site/operations.md`.

**Architecture:** Five mostly-additive domains:

- **D1 schema** — one new column on `results` (`snippet_text TEXT`), one migration (`0004_snippet_text.sql`); FTS5 schema unchanged at the SQL level. The new `snippet_text` is read by the application from `results` (NOT by the FTS5 trigger) — so trigger order between `results_fts_au` and `results_snippet_text_au` is impl-defined but irrelevant for correctness. One new health endpoint (`/api/v1/health/catalog-drift`) using read-only D1 queries.
- **Type system** — one helper signature change (`passthroughLoader`), one new shared component (`IconBase.svelte`), one widening in `tests/setup-unit.ts`. No runtime behavior change.
- **Component patches** — `SearchResultRow.svelte` null-snippet guard; canary proxy `<base href>` injection (and absolute-link rewrite) into wrapped HTML before iframe `srcdoc`; Input `label` props on /runs + /compare; TaskDetailPanel CSS pruning; empty-state messaging on /tasks + /limitations.
- **Test hardening** — OG warmup in `beforeAll`; CI catalog-drift invariant test; visual-regression baseline first-capture playbook.
- **DNS-flip readiness** — wrangler.toml `SITE_BASE_URL` swap path documented; verification scripts staged; G phase NOT executed in this plan.

> **Design rationale: hotfixes are layered, not stacked.** The audit identifies four critical bugs (search 500, tasks empty, redirect-sunset, canary scope). Each has a "minimal patch" path and an "architectural fix" path. Plan v1 would patch all four in their existing locations and call it done. Plan v2 (this one) treats each as two-layer:
>
> - **Layer 1 (hotfix)**: stop the bleeding. `SearchResultRow.svelte` guards null. `_canary/+page.server.ts` rewrites Location. `tasks` table backfilled by operator. Each is 1–10 LOC.
> - **Layer 2 (architectural)**: prevent recurrence. FTS5 `snippet_text` column means snippet ownership is explicit. Catalog-drift admin endpoint + cron probe means tasks-empty-but-results-present surfaces in 24h, not 30d. Canary Location rewrite is a generic redirect normalizer, not a one-off. `passthroughLoader<TKey, TVal>` precise-type fix prevents the next "Record<string, T>" drift.
>
> Layer 1 ships in the same commit as Layer 2 — they're not phase-staged. The phasing is by _file family_, not by safety. Architect concerns about half-states are addressed by making each mini-phase atomic: each commit leaves the working tree in a green state.

> **Design rationale: FTS5 architectural choice — precomputed `snippet_text` column.** The FTS5 contentless mode (`content=''` in `migrations/0002_fts.sql:5`) is the ROOT cause of the search 500. With `content=''`, the FTS table indexes tokens but stores no copy of the source text — so `snippet()` returns `NULL`. Two options:
>
> - **(a) Drop contentless mode**: switch to `content='results'` + `content_rowid='id'`, which makes FTS5 reach back into `results` for snippet text. **Risk**: requires `INSERT INTO results_fts(results_fts) VALUES('rebuild')` to re-tokenize all 1135 existing rows; on D1 the rebuild is single-statement and ~few-second blocking; doable but a one-shot operator action with rollback complexity.
> - **(b) Precompute snippet_text**: add a `snippet_text TEXT` column on `results`; populate it in the trigger via the same `group_concat(...)` SQL that today writes to `compile_errors_text`/`failure_reasons_text` in the FTS table; have `snippet()` reference column index `0` (the precomputed column). **Risk**: storage overhead (~1KB/row × 1135 = ~1MB extra). No rebuild needed — additive. Reversible.
>
> P6 picks (b). Rationale: additive migrations are operator-friendlier; the storage cost is trivial; and a future P7 can switch to (a) if we want richer per-column snippeting (each FTS column getting its own `snippet()` call). Today we don't need that — one snippet per row is enough for the search results UI.

> **Design rationale: catalog-drift is a CI invariant + a 24h cron, not just an operator runbook.** The `tasks` table being empty while `results.task_id` references rows is a classic "documented gap that bites you in 6 months" situation. The audit found it because someone clicked `/tasks` in production. We add three layers:
>
> - **Layer 1 (operator)**: `centralgauge sync-catalog --apply` after every task-set ingest. Already exists as a CLI command — bench's CONTRIBUTING.md and operations.md will gain explicit reminders.
> - **Layer 2 (data integrity)**: a new READ-ONLY health endpoint `/api/v1/health/catalog-drift` returns `{ tasks_referenced: N, tasks_in_catalog: M, drift: N > M }`. Plain D1 reads; no signature gating (every existing `/api/v1/admin/*` endpoint requires `verifySignedRequest` — putting an unsigned read-only path under `/admin/` would be inconsistent. Architect verified.).
> - **Layer 3 (alerting)**: a daily cron that runs the same drift query INLINE (NOT via HTTP self-fetch — see `src/cron/catalog-drift.ts:runDailyDriftProbe`) and writes a row into a new `catalog_health` D1 table (`drift_detected_at` if non-zero). Surfaced in operations.md as "if you see drift_detected_at non-null, run sync-catalog --apply within 24h". Cron is a no-op when drift = 0 (cheap). No shared secret, no `INTERNAL_CRON_TOKEN`, no rate-limit interaction.
>
> Why all three? Because layer 1 alone failed (we shipped the bug). Layer 2 alone would let us self-diagnose but only when someone remembers to check. Layer 3 turns it into a passive alert path. None of the three is expensive — total D1 cost is ~3 SELECTs per day.

> **Design rationale: canary scope leak is fixed at the iframe boundary, not by rewriting Location headers.** The wrapped page is rendered inside an `<iframe srcdoc={data.wrappedHtml}>` (verified at `_canary/[sha]/[...path]/+page.svelte:21`). The wrapped `event.fetch(wrapped)` already follows redirects automatically (`redirect: 'follow'` is the default), so any 3xx from the wrapped route is resolved server-side BEFORE the HTML reaches the proxy — Location-header rewriting on the proxy boundary is moot. The actual leak vector is **link-click navigation INSIDE the iframe**: a user clicks an absolute `<a href="/runs">` and the browser navigates the iframe's top frame to production `/runs`. Plan v1's "switch to `{@html}` + meta-refresh" idea was wrong: it would (i) collide head tags between canary chrome and the wrapped page, (ii) break the noindex isolation we get from the iframe boundary, (iii) execute the inner page's scripts in the parent context. The correct, minimal fix is to inject `<base href="/_canary/<sha>/">` into the wrapped HTML's `<head>` before serving it via `srcdoc`. The browser then resolves relative links — and the absolute `/runs` clicks (because `<base>` only affects relative URLs) — against the canary scope. Belt-and-braces: also rewrite `href="/foo"` → `href="/_canary/<sha>/foo"` in the wrapped HTML so absolute internal links stay scoped even if the user opens them in a new tab (where `<base>` doesn't apply). External `https://...` and protocol-relative `//host/...` URLs pass through unchanged.

> **Design rationale: `passthroughLoader<TKey, TVal>` is a single-edit win.** Plan v1 considered widening each consumer to cast its return at call site. That's wrong — it spreads the type problem across 5 files and 17 errors instead of fixing the root. The correct fix is the helper signature: `function passthroughLoader<TKey extends string, TVal>(opts: { resultKey: TKey; ... }): (event) => Promise<{[K in TKey]: TVal}>`. Default `TKey = 'data'` keeps backward compat. Each call site already passes `resultKey` as a string literal (`'results'`, `'tasks'`, etc.) — TypeScript infers the literal type. After the edit, every consumer's return is precisely typed without any consumer-side change.

> **Design rationale: `IconBase.svelte` is a real-component refactor, not just a typing patch.** Plan v1 considered: cast `aria-hidden="true"` to `'true' as 'true'` at every icon site (~30 files). Plan v2 picks the architectural fix: extract `IconBase.svelte` that owns the SVG container + ariaProps logic; each icon becomes a 4-line wrapper passing only `viewBox`, `paths` (the inner SVG markup as a snippet), `size`, `label`. Total LOC change: -380 (most icon files shrink by ~50%) plus +60 in `IconBase.svelte`. Net reduction. **And** the typing issue resolves once at the IconBase level. Future icons added in P7+ inherit the fix.

> **Design rationale: empty-state messaging is data-driven.** Five routes can render "0 rows" today: `/tasks` (catalog drift), `/limitations` (no shortcomings detected yet), `/runs` (filter too tight), `/compare` (no models selected), `/models/<slug>/limitations` (model-specific empty state). Each has different "why" and different "what next". P6 introduces `<EmptyState>` (a small UI atom — title, body, optional CTA) and threads it through all five callsites with route-specific messaging. The atom is reusable for P7+ surfaces.

> **Design rationale: visual-regression baseline lives on Ubuntu CI, NOT Windows local.** The P5.4 visual-regression spec captures via `playwright.config` against `chromium`. Local dev is Windows; CI is Ubuntu — different font rendering, anti-aliasing, sub-pixel offsets. Committing local Windows PNGs creates a baseline that Ubuntu CI fails against. The fix: **the first baseline capture happens on Ubuntu CI** via a one-shot manually-triggered workflow that commits the snapshots. Subsequent runs compare. Local development uses `--update-snapshots` with `--project=chromium-ubuntu` (Docker-pinned Chromium image) when a baseline edit is intentional. Documented in `operations.md`.

> **Design rationale: custom-domain flip is in this plan but NOT executed.** Phase G provides the complete playbook: (1) Cloudflare DNS A/CNAME record creation (operator); (2) Worker dashboard "Add custom domain" (operator); (3) `wrangler.toml [vars] SITE_BASE_URL` swap (commit); (4) `wrangler deploy` (commit-deploy); (5) verification scripts (curl assertions for both old + new domain). The plan does NOT include `git commit`/`wrangler deploy` steps — those execute only when the user explicitly says "go". Until then, Phase G is read-only documentation. This avoids the "user asked for the plan, plan accidentally flips DNS during execution" failure mode.

> **Design rationale: the order of mini-phases is the order they ship — but commits are per-mini-phase, not per-task.** Architect I7 (P5.5) established the principle: a commit's working tree must be coherent (build green, all tests green, no half-states). P6 follows: every mini-phase's tasks share a single commit. Mini-phase A is "Phase A — Critical hotfixes" with sub-tasks A1...A5; the commit lands when A1...A5 are all green. Same for B, C, D, E, F. Phase G is special — it ships in its own commit ONLY when the user triggers G.

**Tech Stack:** Same as P5.5. No new runtime deps. One new dev/test util (`tests/setup-unit.ts` Snippet helper widening — pure TypeScript). One new admin endpoint pattern. One new D1 column + migration.

**Spec:** `docs/superpowers/specs/2026-04-27-p5-site-ui-design.md` §11.7 (custom domain), §13 (P5 done-criteria — confirm met), §5.7 (404), §5.8 (SEO + structured data — already shipped P5.5). P6 has no new spec; this plan is _post-shipping correctness_.

**Audit map:** Each finding from the audit appears in exactly one mini-phase. Cross-reference table below — every audit ID maps to a Task ID:

| Audit ID                                     | Severity                              | Mini-phase / Task                                             | Notes                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 (search 500, null snippet)               | Critical                              | A1 (hotfix) + A2 (FTS schema)                                 | Two-layer; both same commit                                                                                                                                 |
| C-2 (tasks empty)                            | Critical                              | A4 (operator) + A5 (health endpoint) + A6 (inline cron probe) | Three-layer; A5 path is `/api/v1/health/catalog-drift` (NOT `/admin/`); A6 calls `runDailyDriftProbe(env)` directly from `scheduled()` — no HTTP self-fetch |
| C-3 (redirect-sunset.test.ts)                | Critical (audit said "doesn't exist") | A3 (verify exists; CI step assert)                            | **Audit was wrong — file exists at `site/tests/build/redirect-sunset.test.ts`**. P6 confirms it runs in CI and documents the playbook.                      |
| C-4 (canary scope leak)                      | Critical                              | A7                                                            | `<base href>` injection in canary proxy + absolute-link rewrite in wrapped HTML                                                                             |
| I-1 (passthroughLoader Record<string,T>)     | Important                             | B1                                                            | Single-edit fix, 17+ errors resolve                                                                                                                         |
| I-2 (Input missing label on /runs, /compare) | Important                             | B2                                                            | 2 callsites                                                                                                                                                 |
| I-3 (Lucide aria-hidden ~30 errors)          | Important                             | B3 (IconBase) + B4 (migrate icons)                            | Architectural                                                                                                                                               |
| I-4 (Snippet typing in *.test.svelte.ts)     | Important                             | B5                                                            | `tests/setup-unit.ts` widening                                                                                                                              |
| I-5 (health.test.ts body unknown)            | Important                             | B6                                                            | Type guard                                                                                                                                                  |
| I-6 (CommandPalette unused @ts-expect-error) | Important                             | B7                                                            | Trivial                                                                                                                                                     |
| L-1 (RunDetail.completed_at nullable)        | Latent                                | C1                                                            | Type fix + API change                                                                                                                                       |
| L-2 (ModelLimitations.LimitationItem dead)   | Latent                                | C2                                                            | Drop dead path                                                                                                                                              |
| L-3 (empty-state UX)                         | Latent                                | C3 (atom) + C4 (callsites)                                    | New `<EmptyState>` atom                                                                                                                                     |
| M-1 (wrangler.toml stale comment)            | Minor                                 | D1                                                            | One-line edit                                                                                                                                               |
| M-2 (TaskDetailPanel unused CSS)             | Minor                                 | D2                                                            | CSS pruning                                                                                                                                                 |
| T-1 (OG WASM cold-init flake)                | Test                                  | E1                                                            | `beforeAll` warmup                                                                                                                                          |
| (catalog-drift invariant)                    | Test                                  | E2                                                            | New CI test                                                                                                                                                 |
| (visual-regression baseline)                 | Test                                  | E3                                                            | Ubuntu workflow                                                                                                                                             |
| (DNS playbook)                               | Pre-flip                              | F1, F2, F3                                                    | Documentation only                                                                                                                                          |
| D-1 (custom domain flip)                     | FINAL                                 | G1, G2, G3                                                    | **Held until user trigger**                                                                                                                                 |

**Prior plans:**

- `docs/superpowers/plans/2026-04-30-p5-5-cutover.md` (P5.5 — completed; cutover live)
- `docs/superpowers/plans/2026-04-29-p5-4-live-and-polish.md` (P5.4 — completed; SSE + DO live)
- `docs/superpowers/plans/2026-04-28-p5-3-cross-cuts.md` (P5.3 — completed; 8 cross-cut surfaces)
- `docs/superpowers/plans/2026-04-27-p5-2-detail-surfaces.md` (P5.2 — completed; detail pages)
- `docs/superpowers/plans/2026-04-27-p5-1-foundation-leaderboard.md` (P5.1 — completed; foundation)

**Out of scope:**

- P7+ structured-data per-page schemas (Article, Dataset, SoftwareApplication) — deferred from P5.5
- P7+ FTS5 contentless → explicit-content migration (option (a) above) — only if per-column snippets become a UX need
- P7+ RUM regression alerting (Workers Analytics Engine + alarm)
- Open Graph image audit per page (P5.4 shipped 4 endpoints; per-page coverage audit deferred)
- `<link rel="alternate" hreflang>` (single-language site)
- `robots.txt Disallow: /api/` (currently allowed; documented intentional in P5.5)
- Marketing / launch announcement post (P5.5 was the technical launch; the marketing post is a P7 deliverable)

---

## File map

### New files

| Path                                                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/migrations/0004_snippet_text.sql`                  | Add `snippet_text TEXT` column to `results`; backfill from existing `compile_errors_json` + `failure_reasons_json`; rewrite `results_fts` triggers to write the value (not derive on the fly).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `site/src/lib/components/ui/IconBase.svelte`             | Shared SVG container component. Receives `viewBox`, `size`, optional `label`, and a children snippet for the inner SVG markup. Owns the `aria-hidden` / `role="img"` + `aria-label` switch. All 25+ Lucide icons delegate to it.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `site/src/lib/components/ui/IconBase.test.svelte.ts`     | Unit test: `aria-hidden="true"` when no label; `role="img" aria-label="..."` when label set; `width`/`height` reflect `size`; viewBox passes through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `site/src/lib/components/ui/EmptyState.svelte`           | Empty-state atom: title, body slot, optional CTA `<a>` slot. Used by /tasks, /limitations, /runs (filter-empty), /compare (no-selection), /models/<slug>/limitations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `site/src/lib/components/ui/EmptyState.test.svelte.ts`   | Unit test: renders title; renders body slot; CTA slot renders only when href provided; aria-labelledby ties heading to region.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `site/src/routes/api/v1/health/catalog-drift/+server.ts` | New read-only health endpoint (NOT under `/admin/` because every admin endpoint requires `verifySignedRequest` — verified across `keys/`, `keys/[id]/`, `catalog/models/`, `catalog/pricing/`, `catalog/task-sets/`). Path-namespace is `/api/v1/health/*`: read-only, operator-friendly, auto-exempt from rate limiting (the rate limiter at `hooks.server.ts:71` only gates `WRITE_METHODS`). Returns `{ tasks_referenced: N, tasks_in_catalog: M, drift: N > M, drift_count: N - M, generated_at: ISO }`.                                                                                                                                                               |
| `site/tests/api/health-catalog-drift.test.ts`            | Worker-pool test: seeds 5 results referencing 3 task IDs but 1 row in `tasks`; asserts response shape; asserts drift = true when N > M, false when N = M. Uses the established `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` pattern from `cloudflare:test` (verified used by `tests/fts.test.ts`, `tests/signature.test.ts`, etc.) — NOT a fictional `tests/helpers/migrations` module.                                                                                                                                                                                                                                                                                |
| `site/migrations/0005_catalog_health.sql`                | Create `catalog_health` table: `(drift_detected_at TEXT, tasks_referenced INTEGER, tasks_in_catalog INTEGER)`. Single-row table — UPSERT pattern. Cron writes; admin endpoint reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `site/src/lib/server/canary-scope.ts`                    | Pure helpers: `injectBaseHref(html: string, sha: string): string` (inserts `<base href="/_canary/<sha>/">` into `<head>`; idempotent if a `<base>` tag already exists for the same sha) and `rewriteAbsoluteLinks(html: string, sha: string): string` (rewrites `href="/foo"` → `href="/_canary/<sha>/foo"` for internal absolute paths only — external `https://`, protocol-relative `//`, mailto/tel/data/javascript URIs, and already-canary paths pass through unchanged). Pure string transforms; unit-testable without spinning the proxy.                                                                                                                           |
| `site/src/lib/server/canary-scope.test.ts`               | Unit tests: (a) `injectBaseHref` — with `<head>` present (insertion point), without `<head>` (graceful no-op or `<html><head>...</head></html>` synthesis), idempotency when `<base>` already present; (b) `rewriteAbsoluteLinks` — internal `/foo`, internal `/foo?x=1` (query preserved), root `/`, external `https://github.com/...` (unchanged), protocol-relative `//cdn.example.com/...` (unchanged), `mailto:`, `tel:`, `javascript:`, `data:` (all unchanged), already-canary `/_canary/<sha>/foo` (idempotent — unchanged), `href` with double quotes vs single quotes vs no quotes (cover the parsing cases the regex must handle), case sensitivity of `HREF=`. |
| `site/tests/api/canary-scope.test.ts`                    | Worker-pool integration test: `GET /_canary/<sha>/leaderboard` returns 200 with HTML body containing `<base href="/_canary/<sha>/">`; absolute `<a href="/runs">` in the wrapped HTML emerges as `<a href="/_canary/<sha>/runs">`; external `<a href="https://github.com/...">` is preserved unchanged. Hits the full proxy round-trip end-to-end.                                                                                                                                                                                                                                                                                                                         |
| `site/tests/build/catalog-drift-invariant.test.ts`       | CI invariant: queries production endpoint at build time (only when `CI_PROD_PROBE=1`); fails if drift > 0. Off by default — enabled in a dedicated GitHub workflow that runs daily, not per-PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `site/tests/build/og-wasm-warmup.test.ts`                | Documents the warmup pattern; asserts that `og` import resolves (smoke). The actual warmup lives in `tests/api/og-*.test.ts` `beforeAll`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `site/scripts/verify-domain-flip.sh`                     | Operator script (Phase F2): curl-tests both old (workers.dev) and new (custom domain) domains post-flip. Asserts 200 on `/`, correct canonical URL, sitemap reachable, X-Robots-Tag absent. **NOT executed in this plan** — staged for Phase G.                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Modified files

| Path                                                           | Change                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/src/lib/components/domain/SearchResultRow.svelte`        | Null-snippet guard: `function sanitizeSnippet(s: string \| null): string { if (!s) return ''; return s.replace(/<(?!\/?mark>)[^>]*>/g, ''); }`; `safe = $derived(sanitizeSnippet(item.snippet))` (no .replace on null); `{@html safe}` unchanged.                                                                                       |
| `site/src/lib/shared/api-types.ts`                             | `SearchResultItem.snippet: string` → `string \| null`; `RunDetail.completed_at: string` → `string \| null`; `LimitationItem` interface deleted (dead code, see C2).                                                                                                                                                                     |
| `site/src/routes/api/v1/runs/[id]/+server.ts`                  | Emit `completed_at: null` (not `''`) when run not yet finished. Mirror change in any other endpoint that returns `''` for a nullable timestamp.                                                                                                                                                                                         |
| `site/src/lib/server/loader-helpers.ts`                        | `passthroughLoader<TKey extends string, TVal>(opts: { resultKey: TKey; ... })` → returns `Promise<{[K in TKey]: TVal}>` (default `TKey = 'data'`). Single edit; consumer code unchanged.                                                                                                                                                |
| `site/src/routes/_canary/[sha]/[...path]/+page.server.ts`      | After fetching wrapped HTML, run `injectBaseHref(html, sha)` then `rewriteAbsoluteLinks(html, sha)` before returning to the page component. The wrapped iframe then renders scope-locked content. (No `+page.svelte` change needed — the existing `<iframe srcdoc={data.wrappedHtml}>` is preserved.)                                   |
| `site/src/routes/runs/+page.svelte`                            | Add `label="Model slug"` (or `labelHidden: true`) to `<Input ...>` at line ~144.                                                                                                                                                                                                                                                        |
| `site/src/routes/compare/+page.svelte`                         | Add `label="Model slug"` to `<Input ...>` at line ~78.                                                                                                                                                                                                                                                                                  |
| `site/src/lib/components/domain/TaskDetailPanel.svelte`        | Remove unused `.attempt.pass` and `.attempt.fail` selectors (lines ~125–126); they are not referenced in the markup. Confirm via `npm run build` — Svelte CSS-warning gone.                                                                                                                                                             |
| `site/src/routes/tasks/+page.svelte`                           | `if filteredRows.length === 0` block uses `<EmptyState>` with route-specific messaging: "Task catalog populates after `centralgauge sync-catalog --apply`. If you're an operator, see `docs/site/operations.md`."                                                                                                                       |
| `site/src/routes/limitations/+page.svelte`                     | `if items.length === 0` uses `<EmptyState>` with body "Limitations are derived from compile errors and accumulate as runs land. None observed yet."                                                                                                                                                                                     |
| `site/src/routes/models/[slug]/limitations/+page.svelte`       | (if exists per audit; verify) — uses `<EmptyState>`.                                                                                                                                                                                                                                                                                    |
| `site/src/lib/components/ui/icons/Activity.svelte`             | Refactor to wrap `<IconBase>`. (Pattern: 25+ icons all change.)                                                                                                                                                                                                                                                                         |
| `site/src/lib/components/ui/icons/AlertCircle.svelte`          | Same refactor.                                                                                                                                                                                                                                                                                                                          |
| `site/src/lib/components/ui/icons/AlertTriangle.svelte`        | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Check.svelte`                | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/CheckCircle.svelte`          | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/ChevronDown.svelte`          | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/ChevronRight.svelte`         | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/ChevronUp.svelte`            | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Code.svelte`                 | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Command.svelte`              | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Copy.svelte`                 | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/CornerDownLeft.svelte`       | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Download.svelte`             | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/ExternalLink.svelte`         | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Eye.svelte`                  | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/GitCompare.svelte`           | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Github.svelte`               | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Image.svelte`                | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Info.svelte`                 | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Layers.svelte`               | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/ListChecks.svelte`           | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Lock.svelte`                 | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Maximize2.svelte`            | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Minimize2.svelte`            | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Moon.svelte`                 | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Search.svelte`               | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/SearchX.svelte`              | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/Sun.svelte`                  | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/components/ui/icons/X.svelte`                    | Same.                                                                                                                                                                                                                                                                                                                                   |
| `site/tests/api/health.test.ts`                                | Tighten `body` narrowing: `const body = (await resp.json()) as { ok: boolean; service: string; now: string };` or zod parse.                                                                                                                                                                                                            |
| `site/src/lib/components/domain/CommandPalette.test.svelte.ts` | Remove unused `@ts-expect-error` on lines 23 and 60 — the `global.fetch = ...` pattern is type-correct under modern jsdom typings.                                                                                                                                                                                                      |
| `site/tests/setup-unit.ts`                                     | Widen Snippet typing: add a type-erase helper for SNIPPET_PROPS so `*.test.svelte.ts` consumers don't need per-test casts.                                                                                                                                                                                                              |
| `site/wrangler.toml`                                           | Update `LeaderboardBroadcaster is in-memory only` comment block (lines 61–66) — clarify that P5.4 added persistence.                                                                                                                                                                                                                    |
| `site/tests/api/og-images.test.ts`                             | Add a single `beforeAll` to the existing top-level `describe` (all OG tests live in this one file — verified `ls tests/api/og-*` returns only `og-images.test.ts`): render a throwaway image so the `@cf-wasm/og` ~600ms cold-init is paid once per test isolate.                                                                       |
| `site/src/hooks.server.ts`                                     | Extend the existing `scheduled` handler. On `event.cron === '0 3 * * *'`, dispatch to `runDailyDriftProbe(env)` (imported from `src/cron/catalog-drift.ts`) via `ctx.waitUntil(...)`. No HTTP self-fetch — the drift query runs inline against `env.DB`. No new endpoint, no shared secret, no rate-limit interaction.                  |
| `site/wrangler.toml`                                           | Add second cron entry: `crons = ["0 2 * * *", "0 3 * * *"]` (catalog-drift probe at 03:00 UTC, 1 hour after the existing backup cron).                                                                                                                                                                                                  |
| `site/src/cron/catalog-drift.ts`                               | New module exporting `runDailyDriftProbe(env: { DB: D1Database }): Promise<void>`. Inline drift query (same SQL as the `/api/v1/health/catalog-drift` endpoint) → if `drift_count > 0`, INSERT into `catalog_health`. No HTTP indirection. Mirrors the existing `src/cron/nightly-backup.ts` pattern (verified at `hooks.server.ts:5`). |
| `docs/site/architecture.md`                                    | Update FTS5 section to document the precomputed `snippet_text` column; add catalog-drift section.                                                                                                                                                                                                                                       |
| `docs/site/operations.md`                                      | Add §"Catalog drift detection" with operator runbook; add §"Custom-domain flip playbook" with Phase F/G content; add §"Visual-regression baseline first-capture"; add §"OG WASM warmup invariant" note.                                                                                                                                 |
| `site/CONTRIBUTING.md`                                         | Add P6 lessons section: "When adding a new D1 migration that fixes a production bug, prefer additive (new column) over destructive (rebuild). When adding loose generic helpers, use literal-typed generics not Record<string, T>."                                                                                                     |
| `site/CHANGELOG.md`                                            | Add P6 entry.                                                                                                                                                                                                                                                                                                                           |

### Deleted files

| Path   | Reason                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none) | P6 is additive + corrective; no file deletions. The audit's `LimitationItem` interface is removed but the type lives inside `api-types.ts` — type-deletion only, no file deletion. |

### Out of scope (deferred to P7+)

- FTS5 contentless → explicit-content migration (option (a) — only if per-column snippets become a UX need)
- Per-page JSON-LD schemas (Article, Dataset, SoftwareApplication)
- Sitemap submission to webmaster tools
- Open Graph per-page audit
- RUM regression alerting

---

## Mini-phase A — Critical hotfixes (production bugs)

Lays the groundwork for production correctness. Each task addresses a specific audit finding (C-1, C-2, C-3, C-4). The hotfix layer (immediate user-facing correctness) and architectural layer (preventing recurrence) are bundled per task — same commit.

### Task A1: Hotfix `/search` HTTP 500 — null-snippet guard in `SearchResultRow.svelte`

**Files:**

- Modify: `site/src/lib/components/domain/SearchResultRow.svelte`
- Modify: `site/src/lib/shared/api-types.ts`
- Modify: `site/src/lib/components/domain/SearchResultRow.test.svelte.ts`

The audit confirms `/search` returns HTTP 500 in production. Root cause:

1. FTS5 contentless mode (`migrations/0002_fts.sql:5`) makes `snippet()` return `NULL`.
2. `SearchResultRow.svelte:18` does `s.replace(...)` — crashes on null.
3. `SearchResultItem.snippet: string` (api-types.ts:358) is a type lie.

> **Note for IM-7 cleanup:** the current `SearchResultItem` interface and the `/api/v1/search` endpoint also return `compile_errors_text` and `failure_reasons_text`, but `SearchResultRow.svelte` does NOT render these fields (verified — only the test fixture references them). Drop both fields from the `SearchResultItem` interface AND from the search endpoint's row projection in Task A2 — they would be `NULL` after the FTS contentless re-architecting (the FTS columns are read-only references; they don't carry source text). Keep the test fixture green by removing those fields from its mock object too.

This task is the **hotfix** — narrow the type, guard the function, prevent the crash. Task A2 fixes the FTS5 schema so non-null snippets actually arrive.

> **Design rationale: type-narrow before runtime-guard.** If we just add `if (!s) return ''` to `sanitizeSnippet` and leave `snippet: string`, future callers will pass non-null assertions (`item.snippet!`) and crash again. The right fix is `snippet: string | null` at the type level — every caller must handle null, every test asserts both branches, and `tsc` enforces it forever.

- [ ] **Step 1: Update type in `site/src/lib/shared/api-types.ts`**

Find the `SearchResultItem` interface (line ~350) and change:

```ts
export interface SearchResultItem {
  result_id: number;
  run_id: string;
  task_id: string;
  model_slug: string;
-  compile_errors_text: string;
-  failure_reasons_text: string;
  started_at: string;
-  snippet: string;       // contains <mark>…</mark> already-substituted by FTS5
+  snippet: string | null;   // contains <mark>…</mark> already-substituted by FTS5; null when FTS5 is in
+                            // contentless mode (no source text to snippet from). Hotfix until A2.
}
```

> **Why drop `compile_errors_text`/`failure_reasons_text`?** They aren't rendered by `SearchResultRow.svelte` (verified: the only consumers are `api-types.ts`, the search endpoint, and the test fixture). After A2's contentless-mode work the FTS columns won't carry source text (they're search-only — the body lives on `results.snippet_text`). Removing the fields from the interface keeps the wire schema honest. Update the test fixture to drop those keys as well.

- [ ] **Step 2: TDD — add a null-snippet test to `SearchResultRow.test.svelte.ts`**

Add a new test case to the existing describe block (preserve existing tests):

```ts
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SearchResultRow from "./SearchResultRow.svelte";

describe("SearchResultRow", () => {
  // ... existing tests (do not modify) ...

  it("renders without crashing when snippet is null", () => {
    const item = {
      result_id: 1,
      run_id: "run-1",
      task_id: "CG-AL-E001",
      model_slug: "sonnet-4-7",
      started_at: "2026-04-28T00:00:00Z",
      snippet: null,
    };
    const { container } = render(SearchResultRow, { props: { item } });
    // Snippet paragraph renders empty, but the row itself renders.
    const p = container.querySelector("p.snippet");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("");
    // The header (task/model/run links) still renders.
    expect(container.querySelector("a.task")).not.toBeNull();
  });

  it("still sanitizes script tags when snippet is non-null", () => {
    const item = {
      result_id: 1,
      run_id: "run-1",
      task_id: "CG-AL-E001",
      model_slug: "sonnet-4-7",
      started_at: "2026-04-28T00:00:00Z",
      snippet: "<mark>ok</mark><script>x</script>",
    };
    const { container } = render(SearchResultRow, { props: { item } });
    const p = container.querySelector("p.snippet");
    expect(p?.innerHTML).toContain("<mark>ok</mark>");
    expect(p?.innerHTML).not.toContain("<script>");
  });
});
```

Also remove the `compile_errors_text`/`failure_reasons_text` fields from the existing test fixture(s) at the top of the same file — they no longer exist on `SearchResultItem` (run `grep -n 'compile_errors_text' site/src/lib/components/domain/SearchResultRow.test.svelte.ts` to find them).

- [ ] **Step 3: Verify failure**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/SearchResultRow.test.svelte.ts 2>&1 | tail -10
```

Expected: test "renders without crashing when snippet is null" FAILS — current code calls `s.replace` on null.

- [ ] **Step 4: Patch `SearchResultRow.svelte`**

```svelte
<script lang="ts">
  import type { SearchResultItem } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';

  interface Props { item: SearchResultItem; }
  let { item }: Props = $props();

  /**
   * Sanitize an FTS snippet to a tiny allowlist (mark only). The FTS5
   * `snippet()` function emits `<mark>` and plain text for our tokenizer
   * config, but we still strip anything else as defense-in-depth so a
   * malicious failure_reasons string can never inject markup.
   *
   * Returns '' when snippet is null (FTS5 contentless mode pre-A2 fix).
   */
  function sanitizeSnippet(s: string | null): string {
    if (s === null || s === undefined) return '';
    return s.replace(/<(?!\/?mark>)[^>]*>/g, '');
  }

  const safe = $derived(sanitizeSnippet(item.snippet));
</script>

<article class="row">
  <header>
    <a class="task" href="/tasks/{item.task_id}">{item.task_id}</a>
    <span class="sep">·</span>
    <a class="model" href="/models/{item.model_slug}">{item.model_slug}</a>
    <span class="sep">·</span>
    <a class="run text-muted" href="/runs/{item.run_id}">run {item.run_id.slice(0, 8)}…</a>
    <span class="ts text-muted">{formatRelativeTime(item.started_at)}</span>
  </header>
  <p class="snippet">{@html safe}</p>
</article>

<style>
  /* unchanged */
</style>
```

- [ ] **Step 5: Verify tests pass**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/SearchResultRow.test.svelte.ts 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 6: Verify typecheck — find any other consumer that assumes `snippet: string`**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -i "snippet" | head -20
```

Expected: zero hits — only `SearchResultRow.svelte` uses `item.snippet` in source.

- [ ] **Step 7: Stage (atomic Mini-phase A — no commit yet, see A-COMMIT)**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/shared/api-types.ts \
  site/src/lib/components/domain/SearchResultRow.svelte \
  site/src/lib/components/domain/SearchResultRow.test.svelte.ts
```

---

### Task A2: FTS5 schema — precomputed `snippet_text` column on `results`

**Files:**

- Create: `site/migrations/0004_snippet_text.sql`
- Modify: `site/src/routes/api/v1/search/+server.ts`

The architectural fix for the search 500. Instead of the contentless FTS5 trying (and failing) to snippet from text it doesn't store, we precompute the snippet source on `results.snippet_text` and have FTS5 reference it. Additive — no rebuild risk.

> **Design rationale: snippet_text is a `TEXT` column, not a generated/virtual column.** SQLite supports generated columns (`GENERATED ALWAYS AS ...`), but they have edge cases under FTS5 indexing. A plain TEXT column with explicit trigger writes is boring and reliable. Storage is ~1KB/row × 1135 = 1MB total; D1 free tier is 5GB.

> **Design rationale: backfill is one statement, not a loop.** `UPDATE results SET snippet_text = (...subquery...)` runs in O(rows). On 1135 rows it's <1s. D1 supports it.

> **Architecture decision: don't use FTS5's `snippet()` at all.** The simplest path that avoids both the FTS5 contentless rebuild AND any FTS-trigger ordering question: in the search SELECT, return `results.snippet_text` directly and apply `<mark>` highlighting in application code (Worker JavaScript). FTS5 still does the search via its `MATCH ?` predicate against the existing contentless index; only the snippet rendering moves to the application layer. Trigger ordering between `results_fts_au` and `results_snippet_text_au` is therefore irrelevant for correctness — neither reads what the other writes; both fire AFTER UPDATE on `results`; trigger order in SQLite is implementation-defined and we don't depend on it.

- [ ] **Step 1: Author `site/migrations/0004_snippet_text.sql`**

```sql
-- 0004_snippet_text.sql — Precomputed snippet source for /search
--
-- The FTS5 contentless schema (0002_fts.sql) prevents snippet() from
-- returning text. Adding a snippet_text column on results (populated by
-- trigger and backfilled) lets the search endpoint return raw text;
-- application code wraps the matched terms with <mark>.
--
-- No trigger-ordering dependency: snippet_text is read by the application
-- from results, NOT by the FTS5 trigger. Both results_fts_au and
-- results_snippet_text_au fire AFTER UPDATE on results; neither reads
-- the column the other writes; SQLite trigger order is impl-defined but
-- irrelevant here.

ALTER TABLE results ADD COLUMN snippet_text TEXT;

-- Backfill 1135 existing rows.
UPDATE results SET snippet_text = (
  SELECT TRIM(
    COALESCE((
      SELECT group_concat(
        COALESCE(json_extract(value, '$.code'), '') || ' ' ||
        COALESCE(json_extract(value, '$.message'), ''),
        ' '
      )
      FROM json_each(compile_errors_json)
      WHERE json_valid(compile_errors_json)
    ), '')
    || ' ' ||
    COALESCE((
      SELECT group_concat(value, ' ')
      FROM json_each(failure_reasons_json)
      WHERE json_valid(failure_reasons_json)
    ), '')
  )
);

-- Triggers (INSERT + UPDATE) — see prior step's body; same logic.
CREATE TRIGGER results_snippet_text_ai AFTER INSERT ON results BEGIN
  UPDATE results SET snippet_text = (
    SELECT TRIM(
      COALESCE((SELECT group_concat(
        COALESCE(json_extract(value, '$.code'), '') || ' ' ||
        COALESCE(json_extract(value, '$.message'), ''), ' ')
        FROM json_each(NEW.compile_errors_json)
        WHERE json_valid(NEW.compile_errors_json)), '')
      || ' ' ||
      COALESCE((SELECT group_concat(value, ' ')
        FROM json_each(NEW.failure_reasons_json)
        WHERE json_valid(NEW.failure_reasons_json)), '')
    )
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER results_snippet_text_au AFTER UPDATE ON results
WHEN (NEW.compile_errors_json IS NOT OLD.compile_errors_json
   OR NEW.failure_reasons_json IS NOT OLD.failure_reasons_json)
BEGIN
  UPDATE results SET snippet_text = (
    SELECT TRIM(
      COALESCE((SELECT group_concat(
        COALESCE(json_extract(value, '$.code'), '') || ' ' ||
        COALESCE(json_extract(value, '$.message'), ''), ' ')
        FROM json_each(NEW.compile_errors_json)
        WHERE json_valid(NEW.compile_errors_json)), '')
      || ' ' ||
      COALESCE((SELECT group_concat(value, ' ')
        FROM json_each(NEW.failure_reasons_json)
        WHERE json_valid(NEW.failure_reasons_json)), '')
    )
  ) WHERE id = NEW.id;
END;
```

- [ ] **Step 2: Extract `applyMarkHighlighting` into a unit-testable module**

Non-trivial logic deserves dedicated tests (today there are zero tests for the regex-meta + HTML-escape interplay). Put the helper in `site/src/lib/server/search-highlight.ts`:

```ts
// site/src/lib/server/search-highlight.ts

/**
 * Wrap matched query tokens with <mark> in a snippet text. Returns at most
 * `maxLen` chars centered around the first match; otherwise the head of
 * the snippet_text.
 *
 * Replicates FTS5 snippet() behavior at the application layer because the
 * D1 FTS5 schema is contentless (migrations/0002_fts.sql:5) and FTS5
 * snippet() returns NULL for contentless tables. See P6 plan A2 design
 * rationale.
 */
export function applyMarkHighlighting(
  text: string,
  tokens: string[],
  maxLen = 200,
): string {
  if (!text) return "";
  // Find earliest match in text (case-insensitive); center window there.
  let earliest = -1;
  const lowerText = text.toLowerCase();
  for (const t of tokens) {
    const idx = lowerText.indexOf(t.toLowerCase());
    if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx;
  }
  let window = text;
  if (text.length > maxLen) {
    const start = earliest === -1 ? 0 : Math.max(0, earliest - 30);
    const end = Math.min(text.length, start + maxLen);
    window = (start > 0 ? "…" : "") + text.slice(start, end) +
      (end < text.length ? "…" : "");
  }
  // Escape HTML in the window first; then wrap exact (case-insensitive) token matches.
  const escaped = window
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  let result = escaped;
  for (const t of tokens) {
    const escTok = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(escTok, "gi"),
      (m) => `<mark>${m}</mark>`,
    );
  }
  return result;
}
```

Add `site/src/lib/server/search-highlight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyMarkHighlighting } from "./search-highlight";

describe("applyMarkHighlighting", () => {
  it("returns empty string for empty input", () => {
    expect(applyMarkHighlighting("", ["foo"])).toBe("");
  });

  it("returns escaped text unchanged when no tokens match", () => {
    expect(applyMarkHighlighting("hello world", ["xyz"])).toBe("hello world");
  });

  it("wraps a literal match with <mark>", () => {
    expect(applyMarkHighlighting("hello world", ["world"])).toBe(
      "hello <mark>world</mark>",
    );
  });

  it("wraps case-insensitively but preserves source case", () => {
    expect(applyMarkHighlighting("Hello World", ["world"])).toBe(
      "Hello <mark>World</mark>",
    );
  });

  it("HTML-escapes the text BEFORE wrapping", () => {
    // Adversarial: query text is already escaped inside the source.
    // Make sure the caller cannot inject <script> by matching escaped-form text.
    const out = applyMarkHighlighting("<script>alert(1)</script>", ["script"]);
    expect(out).not.toContain("<script>"); // raw < > are escaped
    expect(out).toContain("&lt;");
    expect(out).toContain("<mark>script</mark>"); // mark wraps the literal token
  });

  it("treats regex-metachar tokens as literals (no regex injection)", () => {
    // ".*" must match the literal ".*" — not "any chars".
    const out = applyMarkHighlighting("foo.*bar", [".*"]);
    expect(out).toBe("foo<mark>.*</mark>bar");
  });

  it("handles parens and brackets in tokens", () => {
    const out = applyMarkHighlighting("AL0132 (E001)", ["(E001)"]);
    expect(out).toContain("<mark>(E001)</mark>");
  });

  it("handles unicode tokens (multibyte boundary)", () => {
    const out = applyMarkHighlighting("café résumé", ["résumé"]);
    expect(out).toContain("<mark>résumé</mark>");
  });

  it("truncates around the first match with ellipsis when text exceeds maxLen", () => {
    const long = "x".repeat(500) + " MATCHTOKEN " + "y".repeat(500);
    const out = applyMarkHighlighting(long, ["MATCHTOKEN"], 100);
    expect(out.length).toBeLessThan(200); // tight bound; allow for ellipsis + <mark>
    expect(out).toContain("<mark>MATCHTOKEN</mark>");
    expect(out).toMatch(/^…/); // leading ellipsis
    expect(out).toMatch(/…$/); // trailing ellipsis
  });

  it("starts from index 0 when no token matches and text is long", () => {
    const long = "x".repeat(500);
    const out = applyMarkHighlighting(long, ["nope"], 100);
    expect(out).not.toMatch(/^…/);
    expect(out).toMatch(/…$/);
    expect(out.startsWith("xxx")).toBe(true);
  });

  it("handles multiple tokens", () => {
    const out = applyMarkHighlighting("alpha bravo charlie", [
      "alpha",
      "charlie",
    ]);
    expect(out).toContain("<mark>alpha</mark>");
    expect(out).toContain("<mark>charlie</mark>");
    expect(out).not.toContain("<mark>bravo</mark>");
  });
});
```

- [ ] **Step 3: Modify `site/src/routes/api/v1/search/+server.ts`**

The endpoint imports the extracted helper, drops the FTS column reads (`compile_errors_text`/`failure_reasons_text` are NULL on contentless schema and unused by the UI — verified `SearchResultRow.svelte` only renders `task_id`/`model_slug`/`run_id`/`started_at`/`snippet`).

```ts
import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { applyMarkHighlighting } from "$lib/server/search-highlight";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) throw new ApiError(400, "missing_query", "q is required");
    if (q.length > 200) {
      throw new ApiError(400, "query_too_long", "q must be ≤ 200 chars");
    }

    const tokens = q.split(/\s+/).filter(Boolean);
    const matchExpr = tokens
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" ");

    // Note: FTS columns (compile_errors_text, failure_reasons_text) are NULL
    // under contentless mode and are NOT rendered by SearchResultRow.svelte —
    // dropped from the projection (P6 IM-7).
    const rows = await getAll<{
      result_id: number;
      run_id: string;
      task_id: string;
      model_slug: string;
      started_at: string;
      snippet_text: string | null;
    }>(
      env.DB,
      `SELECT r.id AS result_id, r.run_id, r.task_id,
              m.slug AS model_slug,
              runs.started_at,
              r.snippet_text AS snippet_text
       FROM results_fts fts
       JOIN results r ON r.id = fts.rowid
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE results_fts MATCH ?
       ORDER BY runs.started_at DESC
       LIMIT 100`,
      [matchExpr],
    );

    const data = rows.map((r) => ({
      result_id: r.result_id,
      run_id: r.run_id,
      task_id: r.task_id,
      model_slug: r.model_slug,
      started_at: r.started_at,
      snippet: r.snippet_text === null
        ? null
        : applyMarkHighlighting(r.snippet_text, tokens, 200),
    }));

    return cachedJson(request, { query: q, data });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Apply migration locally**

```bash
cd /u/Git/CentralGauge/site && npx wrangler d1 migrations apply DB --local
```

Expected: migration `0004_snippet_text.sql` reports applied; backfill UPDATE shows ~1135 rows touched (in CI/dev — local count may differ).

- [ ] **Step 5: Run search smoke test**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx wrangler dev --local --persist-to=.wrangler/state &
sleep 5
curl -s 'http://localhost:8787/api/v1/search?q=AL0132' | head -c 1000
# Look for: "snippet": "...something with <mark>..." (or null if no hits)
kill %1 2>/dev/null || true
```

Expected: 200 response with non-null snippets containing `<mark>` wrapping the matched token.

- [ ] **Step 6: Verify migration also applies in production deploy**

The deploy runs migrations automatically via `wrangler deploy`. We do NOT include the production deploy in this commit — that's at the end of P6 (or each phase). This step is a paper check:

```bash
cd /u/Git/CentralGauge/site && cat migrations/0004_snippet_text.sql | head -10
```

Expected: file exists, content matches Step 1.

- [ ] **Step 7: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/migrations/0004_snippet_text.sql \
  site/src/lib/server/search-highlight.ts \
  site/src/lib/server/search-highlight.test.ts \
  site/src/routes/api/v1/search/+server.ts
```

---

### Task A3: Wire `redirect-sunset.test.ts` (and the rest of `tests/build/`) into CI

**Files:**

- Modify: `.github/workflows/site-ci.yml`
- Modify: `site/CONTRIBUTING.md` (operator playbook)

`redirect-sunset.test.ts` exists at `site/tests/build/redirect-sunset.test.ts` (verified — also `rum-beacon.test.ts` and `worker-exports.test.ts` live in the same dir). But the build-pool config is **NOT wired into CI**: `.github/workflows/site-ci.yml:27` only runs `npm run test:main`, which (per `package.json:17`) is `vitest run && vitest run --config vitest.unit.config.ts` — the `vitest.build.config.ts` config defined at line 16 (`test:build`) is never invoked. Architect verified this gap; A3 is mandatory, not conditional.

- [ ] **Step 1: Confirm the gap**

```bash
cd /u/Git/CentralGauge && grep -n "test:build" .github/workflows/site-ci.yml || echo "[CONFIRMED GAP] test:build not in CI"
```

Expected: the echo fires (no match in workflow). If the line already exists, skip the workflow edit and proceed to Step 4.

- [ ] **Step 2: Verify the test runs locally**

```bash
cd /u/Git/CentralGauge/site && npm run test:build 2>&1 | tail -10
```

Expected: green (3 files: `redirect-sunset.test.ts`, `rum-beacon.test.ts`, `worker-exports.test.ts`).

- [ ] **Step 3: Add `test:build` to `.github/workflows/site-ci.yml`**

In the `unit-and-build` job, add a step after `npm run test:main`:

```yaml
      - run: npm run test:main
+     - run: npm run test:build
      - run: npm run build
```

Verify post-edit:

```bash
cd /u/Git/CentralGauge && grep -n "test:build" .github/workflows/site-ci.yml
```

Expected: at least one line matches.

- [ ] **Step 4: Update `site/CONTRIBUTING.md` — add a sunset playbook section**

Append:

```markdown
## /leaderboard redirect sunset (2026-05-30)

The P5.5 cutover left a 302 redirect at `src/routes/leaderboard/+server.ts`
to preserve external bookmarks for 30 days. Sunset deadline: **2026-05-30**.

CI guard: `tests/build/redirect-sunset.test.ts` fails 14 days BEFORE sunset
(2026-05-16) if the redirect file still exists. When that happens:

1. Open a PR titled `chore(site): retire /leaderboard 302 redirect (sunset)`
2. Delete `site/src/routes/leaderboard/+server.ts`
3. Delete `site/tests/api/leaderboard-redirect.test.ts` (the test of the redirect itself)
4. Delete `site/tests/build/redirect-sunset.test.ts` (this guard, having served its purpose)
5. Verify the build passes: `cd site && npm run build && npm run test:main && npm run test:build`
6. Land + deploy.

If the sunset window must be extended (an undocumented external system
still depends on `/leaderboard`):

1. Edit `tests/build/redirect-sunset.test.ts` and bump `SUNSET_ISO`.
2. Update `docs/site/operations.md` to reflect the new deadline.
3. Land — the guard re-arms.
```

- [ ] **Step 5: Stage (workflow edit + playbook)**

```bash
git -C /u/Git/CentralGauge add \
  .github/workflows/site-ci.yml \
  site/CONTRIBUTING.md
```

---

### Task A4: Backfill `tasks` table — operator action `centralgauge sync-catalog --apply`

**Files:**

- Modify: `docs/site/operations.md` (operator runbook)

The audit confirms `tasks` is empty in production despite 1135 result rows referencing task IDs. This is an operator action (run a CLI command), not a code change. This task documents it; A5 + A6 add detection/prevention.

> **Design rationale: this is an "execute now" task, not a code commit.** Plan v1 considered automating the sync via the worker's cron. That's wrong: the catalog sync is deliberately operator-driven because the bench is the source of truth (`site/catalog/*.yml` is hand-edited). A worker cron pulling FROM the worker's own D1 INTO the worker's own D1 doesn't help — the bench-side YAML is what changed. The operator runs the bench CLI; the CLI POSTs signed admin requests to the worker. P6 documents the runbook; A5/A6 add post-facto detection so future drift surfaces fast.

- [ ] **Step 0: Confirm idempotency (read-only verification)**

Before running the sync, verify it's safe to re-run:

```bash
cd /u/Git/CentralGauge && grep -n "ON CONFLICT\|REPLACE INTO" site/src/routes/api/v1/admin/catalog/models/+server.ts
```

Expected: at least one match (e.g. `ON CONFLICT(slug, api_model_id) DO UPDATE SET` — verified). The other catalog admin endpoints (`pricing`, `task-sets`) should follow the same UPSERT pattern. If any one does NOT, file a follow-up task before running `--apply` against production. Sync-catalog itself supports a dry-run by default (omit `--apply`):

```bash
cd /u/Git/CentralGauge && deno task start sync-catalog 2>&1 | tail -20
# (without --apply; preview only)
```

Expected: prints model/pricing rows that WOULD be synced; no writes occur. Use this as the operator pre-check before applying.

- [ ] **Step 1: Run the sync (operator action — verify bench env first)**

```bash
cd /u/Git/CentralGauge && deno task start sync-catalog --apply 2>&1 | tail -20
```

Expected: output shows N task rows upserted; admin-rate-limit (10 req/min) may force a pause; the script handles this. If the sync fails with a 4xx, escalate — don't proceed.

- [ ] **Step 2: Verify the worker now sees tasks**

```bash
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/tasks?set=current' | head -c 500
```

Expected: `data: [...]` array non-empty. If still empty, escalate.

- [ ] **Step 3: Update `docs/site/operations.md`**

Append a section:

````markdown
## Catalog drift remediation

### Symptom

`/tasks` and `/tasks/<id>` render 0 rows (or 404) despite results existing.

### Cause

The `tasks` D1 table is empty while `results.task_id` references rows.
This happens when `centralgauge sync-catalog --apply` is missed after a
new task-set is ingested.

### Detection

The `/api/v1/health/catalog-drift` endpoint (P6 Task A5) returns
`{ tasks_referenced: N, tasks_in_catalog: M, drift: bool }`. The daily
cron (P6 Task A6 — inline, no HTTP indirection) writes a `catalog_health`
row when drift > 0.

To check manually:

```bash
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/health/catalog-drift'
```
````

Expected response: `{"tasks_referenced": 38, "tasks_in_catalog": 38, "drift": false, ...}`.

### Remediation

```bash
cd /u/Git/CentralGauge && deno task start sync-catalog --apply
```

Then verify:

```bash
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/tasks?set=current' | jq '.data | length'
```

Expected: > 0.

````
- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
````

---

### Task A5: Health endpoint `/api/v1/health/catalog-drift`

**Files:**

- Create: `site/src/routes/api/v1/health/catalog-drift/+server.ts`
- Create: `site/tests/api/health-catalog-drift.test.ts`

Read-only endpoint that surfaces drift on demand. Path-namespace choice: `/api/v1/health/*` (NOT `/api/v1/admin/*`).

> **Why NOT `/admin/`?** Architect verified: every existing `/api/v1/admin/*` endpoint requires `verifySignedRequest` (confirmed across `keys/+server.ts`, `keys/[id]/+server.ts`, `catalog/models/+server.ts`, `catalog/pricing/+server.ts`, `catalog/task-sets/+server.ts`). Putting an unsigned read-only endpoint under `/admin/` would be an inconsistency that future contributors trip on. Drift-status is read-only and operator-friendly — it belongs in the health namespace. The rate limiter at `hooks.server.ts:71` already exempts non-WRITE methods so GETs to this path do NOT count against the per-IP write quota.

- [ ] **Step 1: TDD — write `site/tests/api/health-catalog-drift.test.ts`**

Use the established `applyD1Migrations` pattern from `cloudflare:test` (verified used in `tests/fts.test.ts`, `tests/signature.test.ts`, `tests/cron/nightly-backup.test.ts`, `tests/utils/seed-fixtures.test.ts`, `tests/server/model-aggregates.test.ts`). NOT a fictional `tests/helpers/migrations` import.

```ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("GET /api/v1/health/catalog-drift", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.prepare("DELETE FROM results").run();
    await env.DB.prepare("DELETE FROM tasks").run();
    await env.DB.prepare("DELETE FROM runs").run();
    await env.DB.prepare("DELETE FROM models").run();
    await env.DB.prepare("DELETE FROM task_sets").run();
  });

  async function seedRun(taskIds: string[], catalogIds: string[]) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES('h1', '2026-01-01T00:00:00Z', ${catalogIds.length}, 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO models(slug, display_name, api_model_id, family_slug, generation, added_at) VALUES('m1', 'Model 1', 'm1', 'f1', 1, '2026-01-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id, model_id, tier, status, machine_id, task_set_hash, pricing_version, started_at) VALUES('run1', 1, 'verified', 'completed', 'mach1', 'h1', '2026-01-01', '2026-01-01T00:00:00Z')`,
      ),
    ]);
    for (const tid of catalogIds) {
      await env.DB.prepare(
        `INSERT INTO tasks(id, difficulty, content_hash, task_set_hash) VALUES(?, 'easy', 'ch1', 'h1')`,
      ).bind(tid).run();
    }
    for (const tid of taskIds) {
      await env.DB.prepare(
        `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success) VALUES('run1', ?, 1, 1, 1, 1)`,
      ).bind(tid).run();
    }
  }

  it("returns drift=false when every task_id in results is in tasks", async () => {
    await seedRun(["T1", "T2", "T3"], ["T1", "T2", "T3"]);
    const res = await SELF.fetch(
      "http://localhost/api/v1/health/catalog-drift",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
      drift_count: number;
    };
    expect(body.tasks_referenced).toBe(3);
    expect(body.tasks_in_catalog).toBe(3);
    expect(body.drift).toBe(false);
    expect(body.drift_count).toBe(0);
  });

  it("returns drift=true when results reference tasks not in catalog", async () => {
    await seedRun(["T1", "T2", "T3"], ["T1"]);
    const res = await SELF.fetch(
      "http://localhost/api/v1/health/catalog-drift",
    );
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
      drift_count: number;
    };
    expect(body.tasks_referenced).toBe(3);
    expect(body.tasks_in_catalog).toBe(1);
    expect(body.drift).toBe(true);
    expect(body.drift_count).toBe(2);
  });

  it("returns drift=false when both tables are empty (clean install)", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/v1/health/catalog-drift",
    );
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
    };
    expect(body.tasks_referenced).toBe(0);
    expect(body.tasks_in_catalog).toBe(0);
    expect(body.drift).toBe(false);
  });

  it("emits ISO 8601 generated_at", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/v1/health/catalog-drift",
    );
    const body = await res.json() as { generated_at: string };
    expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns content-type application/json", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/v1/health/catalog-drift",
    );
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("GETs are NOT rate-limited (sanity — verify hooks.server.ts:71 only gates WRITE_METHODS)", async () => {
    // Hammer the endpoint 70x in a row (exceeds the 60/60 ratelimit binding limit).
    // GETs should pass through because shouldLimit = WRITE_METHODS.has(method) && path.startsWith('/api/').
    for (let i = 0; i < 70; i++) {
      const res = await SELF.fetch(
        "http://localhost/api/v1/health/catalog-drift",
      );
      expect(res.status).toBe(200);
    }
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run tests/api/health-catalog-drift.test.ts 2>&1 | tail -10
```

Expected: 6 failures — endpoint not implemented.

- [ ] **Step 3: Implement `site/src/routes/api/v1/health/catalog-drift/+server.ts`**

```ts
import type { RequestHandler } from "./$types";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";

/**
 * Catalog drift probe (read-only health endpoint).
 *
 * Returns the count of distinct task IDs referenced by `results` (`tasks_referenced`),
 * the count of rows in `tasks` (`tasks_in_catalog`), and a boolean
 * `drift: tasks_referenced > tasks_in_catalog`.
 *
 * Consumers:
 *   1. Operators running `curl /api/v1/health/catalog-drift` to verify post-deploy.
 *   2. The daily cron (Task A6) which calls `runDailyDriftProbe(env)` directly
 *      (no HTTP indirection — see src/cron/catalog-drift.ts).
 *
 * Path-namespace choice: `/api/v1/health/*` (NOT `/admin/`) because every
 * `/admin/*` endpoint requires verifySignedRequest. Drift-status is read-only
 * and operator-friendly, so it belongs alongside the existing health surface.
 */
export const GET: RequestHandler = async ({ platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const refRow = await db.prepare(
      `SELECT COUNT(DISTINCT task_id) AS n FROM results`,
    ).first<{ n: number }>();
    const catRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM tasks`,
    ).first<{ n: number }>();

    const tasks_referenced = refRow?.n ?? 0;
    const tasks_in_catalog = catRow?.n ?? 0;
    const drift_count = Math.max(0, tasks_referenced - tasks_in_catalog);
    const drift = drift_count > 0;
    const generated_at = new Date().toISOString();

    return jsonResponse({
      tasks_referenced,
      tasks_in_catalog,
      drift,
      drift_count,
      generated_at,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run tests/api/health-catalog-drift.test.ts 2>&1 | tail -10
```

Expected: 6 green.

- [ ] **Step 5: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/routes/api/v1/health/catalog-drift/+server.ts \
  site/tests/api/health-catalog-drift.test.ts
```

---

### Task A6: Daily catalog-drift cron probe (inline — no HTTP indirection)

**Files:**

- Create: `site/migrations/0005_catalog_health.sql`
- Create: `site/src/cron/catalog-drift.ts`
- Create: `site/tests/cron/catalog-drift.test.ts`
- Modify: `site/src/hooks.server.ts`
- Modify: `site/wrangler.toml`

The daily cron is the third defense layer. When drift > 0, write a row to `catalog_health` so operators see the alert during their next dashboard glance.

> **Design rationale: inline drift query, NOT HTTP self-fetch.** Plan v1 added a `/api/v1/internal/catalog-drift-cron/+server.ts` endpoint behind a shared secret, called via `fetch('https://centralgauge.sshadows.workers.dev/...')` from the cron handler. Three problems with that:
>
> 1. **Hardcoded URL** — breaks at Phase G (custom domain flip; the cron would still call `centralgauge.sshadows.workers.dev`).
> 2. **External fetch when internal call would suffice** — adds a network hop for an in-process operation.
> 3. **Rate-limit exposure** — even if the rate limiter currently exempts GETs, future hardening could trip the cron.
>
> Inlining the drift query eliminates all three. Pattern: mirror `src/cron/nightly-backup.ts` (verified at `hooks.server.ts:5`). Export `runDailyDriftProbe(env)` from `src/cron/catalog-drift.ts`; call it from `scheduled()` via `ctx.waitUntil(...)`. No new endpoint, no shared secret, no HTTP indirection.

- [ ] **Step 1: Migration `0005_catalog_health.sql`**

```sql
-- 0005_catalog_health.sql — Daily catalog drift health table

CREATE TABLE catalog_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drift_detected_at TEXT NOT NULL,
  tasks_referenced INTEGER NOT NULL,
  tasks_in_catalog INTEGER NOT NULL,
  drift_count INTEGER NOT NULL
);

-- For "show me the most recent N drift events" query.
CREATE INDEX idx_catalog_health_detected_at ON catalog_health(drift_detected_at DESC);
```

- [ ] **Step 2: Apply migration locally**

```bash
cd /u/Git/CentralGauge/site && npx wrangler d1 migrations apply DB --local
```

Expected: 0005 applied.

- [ ] **Step 3: Implement `site/src/cron/catalog-drift.ts`**

```ts
// site/src/cron/catalog-drift.ts

interface DriftEnv {
  DB: D1Database;
}

/**
 * Daily drift probe. Mirrors src/cron/nightly-backup.ts pattern: pure
 * function over the env binding, callable from scheduled() via
 * ctx.waitUntil(). No HTTP indirection, no shared secret.
 *
 * On drift > 0, INSERTs a catalog_health row. The /api/v1/health/catalog-drift
 * endpoint (Task A5) reads the same SQL for ad-hoc operator checks.
 */
export async function runDailyDriftProbe(env: DriftEnv): Promise<void> {
  const refRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT task_id) AS n FROM results`,
  ).first<{ n: number }>();
  const catRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tasks`,
  ).first<{ n: number }>();

  const tasks_referenced = refRow?.n ?? 0;
  const tasks_in_catalog = catRow?.n ?? 0;
  const drift_count = Math.max(0, tasks_referenced - tasks_in_catalog);

  if (drift_count > 0) {
    await env.DB.prepare(
      `INSERT INTO catalog_health(drift_detected_at, tasks_referenced, tasks_in_catalog, drift_count) VALUES(?, ?, ?, ?)`,
    )
      .bind(
        new Date().toISOString(),
        tasks_referenced,
        tasks_in_catalog,
        drift_count,
      )
      .run();
  }
}
```

- [ ] **Step 4: Wire cron into `src/hooks.server.ts`**

Extend the existing `scheduled` handler (currently dispatches to `runNightlyBackup`). Branch on `controller.cron`:

```ts
import type { Handle } from "@sveltejs/kit";
import { isRateLimited, type RateLimitBinding } from "$lib/server/rate-limit";
import { resetIdCounter } from "$lib/client/use-id";
import { isCanary } from "$lib/server/canary";
import { runNightlyBackup } from "./cron/nightly-backup";
import { runDailyDriftProbe } from "./cron/catalog-drift"; // P6 A6

export { LeaderboardBroadcaster } from "./do/leaderboard-broadcaster";

interface ScheduledEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
}

export async function scheduled(
  controller: ScheduledController,
  env: ScheduledEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (controller.cron === "0 2 * * *") {
    ctx.waitUntil(
      runNightlyBackup(env).catch((err) => {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "nightly_backup_failed",
          err: err instanceof Error ? err.message : String(err),
        }));
      }),
    );
    return;
  }
  if (controller.cron === "0 3 * * *") {
    ctx.waitUntil(
      runDailyDriftProbe(env).catch((err) => {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "catalog_drift_probe_failed",
          err: err instanceof Error ? err.message : String(err),
        }));
      }),
    );
    return;
  }
}
```

> **Note:** No `INTERNAL_CRON_TOKEN`, no `wrangler secret put`, no shared secret anywhere. The cron triggers run inside the same isolate as the worker; we get the `env.DB` binding directly.

- [ ] **Step 5: Update `wrangler.toml`**

```toml
# Cron triggers
[triggers]
crons = ["0 2 * * *", "0 3 * * *"]
```

- [ ] **Step 6: Test the cron path (unit test on the pure function)**

Add `site/tests/cron/catalog-drift.test.ts` (sibling pattern to `tests/cron/nightly-backup.test.ts` which already uses `applyD1Migrations`):

```ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runDailyDriftProbe } from "../../src/cron/catalog-drift";

describe("runDailyDriftProbe", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.prepare("DELETE FROM catalog_health").run();
    await env.DB.prepare("DELETE FROM results").run();
    await env.DB.prepare("DELETE FROM tasks").run();
    await env.DB.prepare("DELETE FROM runs").run();
    await env.DB.prepare("DELETE FROM models").run();
    await env.DB.prepare("DELETE FROM task_sets").run();
  });

  async function seedDrift(referenced: number, inCatalog: number) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES('h1', '2026-01-01T00:00:00Z', ${inCatalog}, 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO models(slug, display_name, api_model_id, family_slug, generation, added_at) VALUES('m1', 'Model 1', 'm1', 'f1', 1, '2026-01-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id, model_id, tier, status, machine_id, task_set_hash, pricing_version, started_at) VALUES('run1', 1, 'verified', 'completed', 'mach1', 'h1', '2026-01-01', '2026-01-01T00:00:00Z')`,
      ),
    ]);
    for (let i = 0; i < inCatalog; i++) {
      await env.DB.prepare(
        `INSERT INTO tasks(id, difficulty, content_hash, task_set_hash) VALUES(?, 'easy', 'ch1', 'h1')`,
      ).bind(`T${i}`).run();
    }
    for (let i = 0; i < referenced; i++) {
      await env.DB.prepare(
        `INSERT INTO results(run_id, task_id, attempt, passed, score, compile_success) VALUES('run1', ?, 1, 1, 1, 1)`,
      ).bind(`T${i}`).run();
    }
  }

  it("writes a catalog_health row when drift > 0", async () => {
    await seedDrift(5, 2);
    await runDailyDriftProbe(env);
    const rows = await env.DB.prepare(
      `SELECT tasks_referenced, tasks_in_catalog, drift_count FROM catalog_health`,
    ).all<
      {
        tasks_referenced: number;
        tasks_in_catalog: number;
        drift_count: number;
      }
    >();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].tasks_referenced).toBe(5);
    expect(rows.results[0].tasks_in_catalog).toBe(2);
    expect(rows.results[0].drift_count).toBe(3);
  });

  it("does NOT write a catalog_health row when drift = 0", async () => {
    await seedDrift(3, 3);
    await runDailyDriftProbe(env);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM catalog_health`,
    ).first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });

  it("does NOT write a catalog_health row when both tables empty", async () => {
    await runDailyDriftProbe(env);
    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM catalog_health`,
    ).first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });
});
```

- [ ] **Step 7: Verify tests pass**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run tests/cron/catalog-drift.test.ts 2>&1 | tail -10
```

Expected: 3 green.

- [ ] **Step 8: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/migrations/0005_catalog_health.sql \
  site/src/cron/catalog-drift.ts \
  site/tests/cron/catalog-drift.test.ts \
  site/src/hooks.server.ts \
  site/wrangler.toml
```

---

### Task A7: Canary scope leak — `<base href>` injection + absolute-link rewrite

**Files:**

- Create: `site/src/lib/server/canary-scope.ts`
- Create: `site/src/lib/server/canary-scope.test.ts`
- Modify: `site/src/routes/_canary/[sha]/[...path]/+page.server.ts`
- Create: `site/tests/api/canary-scope.test.ts`

> **Architect verification:** the existing `_canary/[sha]/[...path]/+page.svelte:21` renders `<iframe srcdoc={data.wrappedHtml}>`. The wrapped `event.fetch(wrapped)` call follows redirects automatically (`redirect: 'follow'` is the default), so any 302 from `/leaderboard` → `/` is resolved server-side BEFORE the HTML reaches the iframe. Server-side `Location` rewriting is therefore moot. The actual leak vector is **link-click navigation INSIDE the iframe**: the user clicks an `<a href="/runs">` and the browser navigates the iframe's top frame to production `/runs`.

> **Design rationale: belt-and-braces fix.** Two complementary transforms applied to the wrapped HTML before it lands in `srcdoc`:
>
> 1. **`<base href="/_canary/<sha>/">` injection** — the canonical browser-native primitive for scoping a document's relative URLs. Catches all `<a href="runs">`, `<form action="search">`, etc. without any string surgery on the page body.
> 2. **Absolute-link rewrite** — `<base>` does NOT affect absolute paths (`<a href="/runs">`). Belt-and-braces: also rewrite `href="/foo"` → `href="/_canary/<sha>/foo"` for internal absolute paths only. Pass-through for external (`https://...`), protocol-relative (`//host`), `mailto:`, `tel:`, `javascript:`, `data:`, and already-canary paths.

> **Step 0: Reproduce the leak first (before writing code).** The architect requested validating the leak repro before fixing.
>
> ```bash
> cd /u/Git/CentralGauge/site && npm run build && npx wrangler dev --local --persist-to=.wrangler/state &
> sleep 5
> # Find a recent canary URL or seed one
> curl -s 'http://localhost:8787/_canary/sha-test/leaderboard' | grep -E '<a [^>]*href="' | head -10
> # Expected (BEFORE fix): href="/runs", href="/models", etc. — absolute paths that would escape canary scope on click.
> kill %1 2>/dev/null || true
> ```
>
> Document the captured URL(s) in the commit message.

- [ ] **Step 1: TDD — write `site/src/lib/server/canary-scope.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { injectBaseHref, rewriteAbsoluteLinks } from "./canary-scope";

describe("injectBaseHref", () => {
  it("inserts <base> after <head> tag", () => {
    const html =
      "<!DOCTYPE html><html><head><title>X</title></head><body></body></html>";
    const out = injectBaseHref(html, "sha-abc123");
    expect(out).toContain('<base href="/_canary/sha-abc123/">');
    // Inserted as the first child of <head>.
    expect(out).toMatch(/<head>\s*<base href="\/_canary\/sha-abc123\/">/);
  });

  it("is idempotent when matching <base> already present", () => {
    const html =
      '<!DOCTYPE html><html><head><base href="/_canary/sha-abc123/"><title>X</title></head><body></body></html>';
    const out = injectBaseHref(html, "sha-abc123");
    // Only one <base> tag.
    expect(out.match(/<base href="\/_canary\/sha-abc123\/">/g)?.length).toBe(1);
  });

  it("replaces a different <base> with the canary one (single-base policy)", () => {
    const html =
      '<!DOCTYPE html><html><head><base href="/other/"><title>X</title></head><body></body></html>';
    const out = injectBaseHref(html, "sha-abc123");
    expect(out).toContain('<base href="/_canary/sha-abc123/">');
    expect(out).not.toContain('<base href="/other/">');
  });

  it("handles HTML without <head> by leaving body unchanged but logging (no throw)", () => {
    // Pragmatic: malformed input; do not throw. Return source unchanged.
    const html = "<p>fragment</p>";
    expect(() => injectBaseHref(html, "sha-abc123")).not.toThrow();
  });
});

describe("rewriteAbsoluteLinks", () => {
  it('rewrites href="/foo" to href="/_canary/<sha>/foo"', () => {
    const html = '<a href="/foo">x</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toContain(
      'href="/_canary/sha-abc123/foo"',
    );
  });

  it("preserves query string", () => {
    const html = '<a href="/foo?bar=1">x</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toContain(
      'href="/_canary/sha-abc123/foo?bar=1"',
    );
  });

  it("rewrites root / to /_canary/<sha>/", () => {
    const html = '<a href="/">home</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toContain(
      'href="/_canary/sha-abc123/"',
    );
  });

  it("does NOT rewrite external https URLs", () => {
    const html = '<a href="https://github.com/anthropics/claude-code">gh</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toBe(html);
  });

  it("does NOT rewrite protocol-relative URLs", () => {
    const html = '<a href="//cdn.example.com/asset.js">cdn</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toBe(html);
  });

  it("does NOT rewrite mailto:, tel:, javascript:, data:", () => {
    const html =
      '<a href="mailto:x@y.z">m</a><a href="tel:123">t</a><a href="javascript:void(0)">j</a><a href="data:text/plain,abc">d</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toBe(html);
  });

  it("does NOT rewrite relative paths", () => {
    const html = '<a href="foo">x</a><a href="../bar">y</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toBe(html);
  });

  it("is idempotent — already-canary paths unchanged", () => {
    const html = '<a href="/_canary/sha-abc123/foo">x</a>';
    expect(rewriteAbsoluteLinks(html, "sha-abc123")).toBe(html);
  });

  it("handles single-quoted href", () => {
    const html = "<a href='/foo'>x</a>";
    const out = rewriteAbsoluteLinks(html, "sha-abc123");
    expect(out).toContain("href='/_canary/sha-abc123/foo'");
  });

  it("handles HREF= (uppercase) attribute", () => {
    const html = '<a HREF="/foo">x</a>';
    const out = rewriteAbsoluteLinks(html, "sha-abc123");
    // Either preserve uppercase or normalize — both acceptable as long as URL is rewritten.
    expect(out.toLowerCase()).toContain('href="/_canary/sha-abc123/foo"');
  });

  it("rewrites multiple links in the same document", () => {
    const html = '<a href="/a">1</a><a href="/b">2</a><a href="/c">3</a>';
    const out = rewriteAbsoluteLinks(html, "sha-abc123");
    expect(out).toContain('href="/_canary/sha-abc123/a"');
    expect(out).toContain('href="/_canary/sha-abc123/b"');
    expect(out).toContain('href="/_canary/sha-abc123/c"');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/server/canary-scope.test.ts 2>&1 | tail -10
```

Expected: many failures — module not found.

- [ ] **Step 3: Implement `site/src/lib/server/canary-scope.ts`**

```ts
/**
 * Inject `<base href="/_canary/<sha>/">` as the first child of <head>.
 *
 * The <base> element scopes all RELATIVE URLs in the wrapped page to the
 * canary path so an `<a href="runs">` resolves under /_canary/<sha>/runs.
 * Absolute paths (`<a href="/runs">`) are unaffected by <base> — those are
 * handled by `rewriteAbsoluteLinks` separately.
 *
 * Idempotent: an existing canary <base> is not duplicated; a non-canary
 * <base> is replaced (single-base policy — having two <base> elements is
 * undefined behavior in the HTML spec, last one wins, so we collapse to one).
 *
 * @see P6 plan A7 design rationale
 */
export function injectBaseHref(html: string, sha: string): string {
  const baseTag = `<base href="/_canary/${sha}/">`;
  const baseRegex = /<base\s[^>]*\bhref=["'][^"']*["'][^>]*>/i;
  if (baseRegex.test(html)) {
    return html.replace(baseRegex, baseTag);
  }
  // Insert as the first child of <head>. If no <head>, leave unchanged.
  return html.replace(/<head\b[^>]*>/i, (m) => `${m}${baseTag}`);
}

/**
 * Rewrite internal absolute `href="/foo"` (and `href='/foo'`, `HREF="/foo"`)
 * to `href="/_canary/<sha>/foo"`. Belt-and-braces complement to <base href>.
 *
 * Pass-through:
 *   - external URLs (https://, http://, ftp://, etc.)
 *   - protocol-relative (//host)
 *   - mailto:, tel:, javascript:, data:
 *   - already-canary (/_canary/<sha>/...)
 *   - relative paths (no leading /)
 */
export function rewriteAbsoluteLinks(html: string, sha: string): string {
  const canaryPrefix = `/_canary/${sha}/`;
  // href= followed by single or double quote, captured separately.
  return html.replace(
    /\b(href|HREF|Href)=(["'])([^"']+)(["'])/g,
    (full, attr: string, q1: string, value: string, q2: string) => {
      // Skip non-internal-absolute paths.
      if (!value.startsWith("/")) return full; // relative
      if (value.startsWith("//")) return full; // protocol-relative
      if (value.startsWith(canaryPrefix)) return full; // already canary
      if (value === `/_canary/${sha}`) return full; // bare canary root

      const newValue = `${canaryPrefix}${value.slice(1)}`;
      return `${attr}=${q1}${newValue}${q2}`;
    },
  );
}
```

> **Note: regex-based HTML rewriting is intentional, not parser-based.** The wrapped HTML is already SvelteKit-rendered and well-formed (no script-content edge cases that trip simple regexes; SvelteKit doesn't emit `<a href="/foo">` inside JavaScript string literals at the document level). A full HTML parser (e.g. `linkedom`) would be safer in theory but adds ~50KB to the worker bundle for marginal correctness gain. If we ever surface an XSS scenario through this code path, revisit.

- [ ] **Step 4: Verify unit tests pass**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/server/canary-scope.test.ts 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 5: Modify `site/src/routes/_canary/[sha]/[...path]/+page.server.ts`**

Apply the two transforms before returning to the page component:

```ts
import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { extractCanaryPath } from "$lib/server/canary";
import { injectBaseHref, rewriteAbsoluteLinks } from "$lib/server/canary-scope";

export const prerender = false;
export const ssr = true;
export const csr = true;

export const load: PageServerLoad = async ({ url, fetch, setHeaders }) => {
  const parts = extractCanaryPath(url);
  if (!parts) throw error(400, "Invalid canary URL");

  // event.fetch follows redirects automatically (default redirect: 'follow').
  // Any 3xx from the wrapped route is resolved here; we only see the final
  // 200 HTML. The canary scope leak is at the iframe link-click boundary,
  // NOT here — see P6 A7 design rationale.
  const wrapped = `${parts.path}${parts.search}`;
  const res = await fetch(wrapped);
  if (!res.ok) {
    throw error(res.status, `Canary fetch of ${wrapped} failed`);
  }

  const rawHtml = await res.text();
  // Two-pass transform: <base> for relative URLs + absolute-link rewrite.
  const withBase = injectBaseHref(rawHtml, parts.sha);
  const html = rewriteAbsoluteLinks(withBase, parts.sha);

  const wrappedCache = res.headers.get("cache-control");
  setHeaders({
    "cache-control": wrappedCache ?? "no-store",
    "x-canary": "1",
  });
  return {
    canary: { sha: parts.sha, path: parts.path },
    wrappedHtml: html,
  };
};
```

> **No change to `+page.svelte`:** the existing `<iframe srcdoc={data.wrappedHtml}>` is preserved. The wrapped HTML now arrives pre-scoped.

- [ ] **Step 6: TDD — `site/tests/api/canary-scope.test.ts`**

End-to-end: confirm the served canary HTML has both transforms applied.

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("canary scope: link-click stays inside /_canary/<sha>/", () => {
  it('serves wrapped HTML with <base href="/_canary/<sha>/">', async () => {
    const res = await SELF.fetch(
      "http://localhost/_canary/sha-test/leaderboard",
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<base href="/_canary/sha-test/">');
  });

  it("rewrites internal absolute hrefs to canary scope", async () => {
    const res = await SELF.fetch(
      "http://localhost/_canary/sha-test/leaderboard",
    );
    const body = await res.text();
    // The leaderboard page links to /runs, /models, etc.; verify all are canary-scoped.
    // (Adjust the asserted hrefs to match real leaderboard markup.)
    expect(body).toMatch(/href="\/_canary\/sha-test\/(runs|models|tasks)"/);
    // Sanity: no naked /runs href escaped through.
    expect(body).not.toMatch(/<a [^>]*href="\/runs"/);
  });

  it("preserves external https links unchanged", async () => {
    const res = await SELF.fetch("http://localhost/_canary/sha-test/about");
    const body = await res.text();
    // The site's footer/header has a github link; verify it's unchanged.
    if (body.includes("https://github.com/")) {
      expect(body).toContain('href="https://github.com/');
    }
  });

  it("the canary banner remains rendered (regression: not stripped by transforms)", async () => {
    const res = await SELF.fetch(
      "http://localhost/_canary/sha-test/leaderboard",
    );
    const body = await res.text();
    expect(body).toContain("canary-banner");
  });
});
```

- [ ] **Step 7: Verify integration tests pass**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run tests/api/canary-scope.test.ts 2>&1 | tail -15
```

Expected: green.

- [ ] **Step 8: Manual link-click smoke (post-fix)**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx wrangler dev --local --persist-to=.wrangler/state &
sleep 5
# Confirm the iframe HTML has <base href> + rewritten links.
curl -s 'http://localhost:8787/_canary/sha-test/leaderboard' | grep -E '<base href|<a [^>]*href="/_canary' | head -5
kill %1 2>/dev/null || true
```

Expected: `<base href="/_canary/sha-test/">` line + multiple canary-scoped `<a href>` lines.

- [ ] **Step 9: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/server/canary-scope.ts \
  site/src/lib/server/canary-scope.test.ts \
  site/src/routes/_canary/[sha]/[...path]/+page.server.ts \
  site/tests/api/canary-scope.test.ts
```

---

### Task A-COMMIT: Single atomic commit for Mini-phase A

**Files:** none — verification + commit only.

Per architect I7: Mini-phase A is one atomic semantic unit (production hotfixes). Land the entire mini-phase as one commit so the working tree is coherent at every revision.

- [ ] **Step 1: Verify all A sub-tasks staged**

```bash
cd /u/Git/CentralGauge && git status --short | grep "^[AMD]"
```

Expected files:

- A site/migrations/0004_snippet_text.sql (A2)
- A site/migrations/0005_catalog_health.sql (A6)
- A site/src/lib/server/search-highlight.ts (A2)
- A site/src/lib/server/search-highlight.test.ts (A2)
- A site/src/lib/server/canary-scope.ts (A7)
- A site/src/lib/server/canary-scope.test.ts (A7)
- A site/src/cron/catalog-drift.ts (A6)
- A site/src/routes/api/v1/health/catalog-drift/+server.ts (A5)
- A site/tests/api/health-catalog-drift.test.ts (A5)
- A site/tests/api/canary-scope.test.ts (A7)
- A site/tests/cron/catalog-drift.test.ts (A6)
- M .github/workflows/site-ci.yml (A3 — add `npm run test:build` step)
- M site/CONTRIBUTING.md (A3)
- M site/src/lib/components/domain/SearchResultRow.svelte (A1)
- M site/src/lib/components/domain/SearchResultRow.test.svelte.ts (A1)
- M site/src/lib/shared/api-types.ts (A1)
- M site/src/routes/_canary/[sha]/[...path]/+page.server.ts (A7)
- M site/src/hooks.server.ts (A6)
- M site/src/routes/api/v1/search/+server.ts (A2)
- M site/wrangler.toml (A6)
- M docs/site/operations.md (A4)

If any is missing, stage it before committing.

- [ ] **Step 2: Build smoke**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -10
```

Expected: green build.

- [ ] **Step 3: Run all unit + worker tests**

```bash
cd /u/Git/CentralGauge/site && npx vitest run 2>&1 | tail -20
```

Expected: green.

- [ ] **Step 4: Run all build-pool tests**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.build.config.ts 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
fix(site/p6): production hotfixes — search 500, tasks empty, canary scope, FTS schema

Mini-phase A of P6 stabilization. Closes 4 critical audit findings:

- C-1: /search HTTP 500 — null-snippet guard in SearchResultRow.svelte;
  type narrowed to string | null; SearchResultItem also drops dead
  compile_errors_text/failure_reasons_text fields (IM-7); FTS5 schema
  gains precomputed results.snippet_text column with backfill
  (migration 0004); search endpoint now uses application-side <mark>
  highlighting via extracted, unit-tested applyMarkHighlighting helper
  (FTS5 contentless mode left intact, deferred to P7+).
- C-2: tasks empty — operator runbook in operations.md (with idempotency
  pre-check); new READ-ONLY health endpoint /api/v1/health/catalog-drift
  (NOT /admin/ because admin namespace requires verifySignedRequest);
  daily inline cron probe at 03:00 UTC writes catalog_health rows when
  drift > 0 (migration 0005). Cron calls runDailyDriftProbe(env)
  directly via ctx.waitUntil — no HTTP self-fetch, no shared secret.
- C-3: tests/build/redirect-sunset.test.ts already exists from P5.5 but
  was NOT wired into CI (.github/workflows/site-ci.yml runs only
  test:main); P6 adds the missing `npm run test:build` step. Operator
  playbook for sunset day landed in CONTRIBUTING.md.
- C-4: canary scope leak — root cause is link-click navigation INSIDE
  the iframe (event.fetch follows redirects automatically; Location
  rewrite was a wrong layer). Fix: inject <base href="/_canary/<sha>/">
  into wrapped HTML's <head> (catches relative URLs) PLUS rewrite
  internal absolute href="/foo" → href="/_canary/<sha>/foo" (catches
  absolute paths that <base> doesn't). External, protocol-relative,
  mailto/tel/javascript/data, and already-canary URLs pass through.

Tests: ~13 unit (canary-scope: injectBaseHref + rewriteAbsoluteLinks),
~12 unit (search-highlight: HTML-escape, regex-meta, multibyte,
truncation), 6 worker (health-catalog-drift incl. rate-limit sanity),
3 worker (catalog-drift cron), 4 worker (canary-scope integration),
updated SearchResultRow tests for null-snippet path + dropped FTS
columns. All green locally.
EOF
)"
```

- [ ] **Step 6: Verify commit**

```bash
git -C /u/Git/CentralGauge log --oneline -1
git -C /u/Git/CentralGauge status
```

Expected: working tree clean; commit message preview as above.

---

## Mini-phase B — Type system stabilization

Eliminates type debt that the audit identified across 5 routes (`passthroughLoader`), 30 icon components (`aria-hidden` Booleanish conflict), 17+ test files (Snippet typing), 2 callsites (Input `label`), 1 test (health body), 2 test directives (CommandPalette unused `@ts-expect-error`).

### Task B1: `passthroughLoader<TKey, TVal>` precise typing

**Files:**

- Modify: `site/src/lib/server/loader-helpers.ts`

The current signature returns `Record<string, T>` — a wide type that requires every consumer to cast back to `{X: T}`. Single-edit fix: literal-typed `TKey extends string` generic.

> **Design rationale: default `TKey = 'data'` for backward compat.** Existing call sites that don't pass `resultKey` (and thus defaulted to `'data'`) keep working. Call sites that DO pass `resultKey` infer the precise literal type.

- [ ] **Step 1: Verify current typecheck error count**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -c "is not assignable to type"
```

Expected: ~17 (the audit number; may vary with codebase state).

- [ ] **Step 2: Modify `site/src/lib/server/loader-helpers.ts`**

```ts
import type { ServerLoadEvent } from "@sveltejs/kit";
import { error } from "@sveltejs/kit";

interface PassthroughOpts<TKey extends string = "data"> {
  depTag: string | ((params: Record<string, string>) => string);
  fetchPath: string | ((url: URL, params: Record<string, string>) => string);
  /** When set, only these query params are forwarded to the API; otherwise all are. */
  forwardParams?: string[];
  /**
   * Key under which the parsed JSON is exposed to the page. Defaults to `'data'`.
   *
   * Pass a string LITERAL (not a string variable) so TypeScript infers the
   * literal type and the return type is `{[K in TKey]: TVal}`. If you pass a
   * non-literal string, TKey widens to `string` and you lose the precise type.
   */
  resultKey?: TKey;
}

/**
 * DRY helper for the dozen+ P5.3 +page.server.ts loaders that all share the
 * shape: depends() → fetch /api/v1/... → propagate cache-control →
 * throw error() on non-OK → return parsed JSON.
 *
 * Returns a generic `ServerLoadEvent` consumer rather than a typed
 * `PageServerLoad` because `PageServerLoad` is a per-route generated type
 * (from `./$types`) and isn't exported by `@sveltejs/kit`. Each consumer
 * route should annotate its `load` export with its own `PageServerLoad`
 * from `./$types` — assignment is structurally compatible because the
 * generated type IS a specialization of `ServerLoadEvent`.
 *
 * Returns `Promise<{[K in TKey]: TVal}>` — precisely typed via TypeScript
 * literal-type inference on the `resultKey` argument. Default `TKey = 'data'`.
 *
 * **Type-inference caveat:** TypeScript only infers `TKey` as a string literal
 * when `resultKey` is passed as a string LITERAL at the call site. If a
 * variable typed as `string` is passed, `TKey` widens to `string` and the
 * return type degrades to `Record<string, TVal>` — same as plan v1 pre-fix.
 * In practice every existing call site passes a literal (`'results'`,
 * `'tasks'`, etc.); the literal-type inference is what lets us drop the
 * 17 consumer-side casts.
 *
 * **Rare collision case:** if a future call site assigns `resultKey: 'data'`
 * AND the page expects `data.<something else>`, the TKey default ('data')
 * silently matches — no compile error, but the page sees an unexpected
 * shape. Mitigation: always pass `resultKey` explicitly when not 'data'.
 */
export function passthroughLoader<TVal, TKey extends string = "data">(
  opts: PassthroughOpts<TKey>,
) {
  // Cast inside the helper — externally the return type is precise.
  const key = (opts.resultKey ?? "data") as TKey;
  return async (event: ServerLoadEvent): Promise<{ [K in TKey]: TVal }> => {
    const { url, params, fetch, setHeaders, depends } = event;
    const tag = typeof opts.depTag === "function"
      ? opts.depTag(params)
      : opts.depTag;
    depends(tag);

    let path = typeof opts.fetchPath === "function"
      ? opts.fetchPath(url, params)
      : opts.fetchPath;
    if (opts.forwardParams) {
      const sp = new URLSearchParams();
      for (const k of opts.forwardParams) {
        const v = url.searchParams.get(k);
        if (v !== null && v !== "") sp.set(k, v);
      }
      const qs = sp.toString();
      if (qs) path += `?${qs}`;
    } else {
      const qs = url.searchParams.toString();
      if (qs && !path.includes("?")) path += `?${qs}`;
    }

    const res = await fetch(path);
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      throw error(
        res.status,
        (body as { error?: string }).error ?? `${path} failed`,
      );
    }

    const apiCache = res.headers.get("cache-control");
    if (apiCache) setHeaders({ "cache-control": apiCache });

    return { [key]: (await res.json()) as TVal } as { [K in TKey]: TVal };
  };
}
```

- [ ] **Step 3: Verify typecheck error count drops**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -c "is not assignable to type"
```

Expected: < 17 (most of the 17 dropped). Remaining errors are the OTHER audit items (Lucide aria-hidden, Snippet, etc.) which Mini-phase B subsequent tasks resolve.

- [ ] **Step 4: Run unit tests to confirm no behavior regression**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run tests/api/leaderboard.test.ts tests/api/runs-list.test.ts 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 5: Stage**

```bash
git -C /u/Git/CentralGauge add site/src/lib/server/loader-helpers.ts
```

---

### Task B2: Add missing `label` props to Input atoms on /runs and /compare

**Files:**

- Modify: `site/src/routes/runs/+page.svelte`
- Modify: `site/src/routes/compare/+page.svelte`

The `Input.svelte:7` declares `label: string` as required. Two callsites instantiate without it — empty `<span class="label"></span>` rendered, a11y degradation.

- [ ] **Step 1: Patch `runs/+page.svelte`**

Find the line `<Input type="search" placeholder="slug…" value={modelVal} oninput={onModelInput} />` (~line 144) and change to:

```svelte
<Input label="Model slug" labelHidden type="search" placeholder="slug…" value={modelVal} oninput={onModelInput} />
```

- [ ] **Step 2: Patch `compare/+page.svelte`**

Find the line `<Input type="search" placeholder="Add model slug…" value={addInput} oninput={(e) => (addInput = (e.target as HTMLInputElement).value)} onkeydown={onAddKey} />` (~line 78) and change to:

```svelte
<Input label="Model slug" labelHidden type="search" placeholder="Add model slug…" value={addInput} oninput={(e) => (addInput = (e.target as HTMLInputElement).value)} onkeydown={onAddKey} />
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -A1 -i "Input" | head -10
```

Expected: zero `label` errors on these two callsites.

- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/routes/runs/+page.svelte \
  site/src/routes/compare/+page.svelte
```

---

### Task B3: Create `IconBase.svelte` — shared SVG container

**Files:**

- Create: `site/src/lib/components/ui/IconBase.svelte`
- Create: `site/src/lib/components/ui/IconBase.test.svelte.ts`

The architectural fix for the Lucide `aria-hidden` Booleanish typing conflict (~30 errors). One shared component owns the `aria-hidden` / `role="img" aria-label` switch with correct typing; all 25+ icons delegate to it.

> **Design rationale: snippet-driven inner SVG.** The icons differ only in their inner `<path>`/`<circle>`/`<polyline>` markup. Pass a Svelte snippet that renders inside `<svg>`. Every icon becomes 4 lines: imports, viewBox=24x24, snippet definition, render `<IconBase>`.

- [ ] **Step 1: TDD — write `site/src/lib/components/ui/IconBase.test.svelte.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import IconBase from "./IconBase.svelte";
import IconBaseTestHarness from "./IconBase.test.harness.svelte";

describe("IconBase", () => {
  it('emits aria-hidden="true" when no label is provided', () => {
    const { container } = render(IconBaseTestHarness, {
      props: { label: undefined },
    });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.getAttribute("role")).toBe(null);
    expect(svg!.getAttribute("aria-label")).toBe(null);
  });

  it('emits role="img" + aria-label when label is provided', () => {
    const { container } = render(IconBaseTestHarness, {
      props: { label: "Search icon" },
    });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBe("Search icon");
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-hidden")).toBe(null);
  });

  it("reflects size on width/height", () => {
    const { container } = render(IconBaseTestHarness, { props: { size: 32 } });
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("32");
    expect(svg!.getAttribute("height")).toBe("32");
  });

  it("passes through viewBox", () => {
    const { container } = render(IconBaseTestHarness, {
      props: { viewBox: "0 0 16 16" },
    });
    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 16 16");
  });
});
```

(The harness `IconBase.test.harness.svelte` is needed because Svelte 5 components with snippet props can't be directly rendered without a parent — the harness wraps `<IconBase>` with a fixed snippet.)

- [ ] **Step 2: Create `site/src/lib/components/ui/IconBase.test.harness.svelte`**

```svelte
<script lang="ts">
  import IconBase from './IconBase.svelte';
  let { label, size = 20, viewBox = '0 0 24 24' }: { label?: string; size?: number; viewBox?: string } = $props();
</script>

<IconBase {label} {size} {viewBox}>
  {#snippet children()}
    <circle cx="12" cy="12" r="8" />
  {/snippet}
</IconBase>
```

- [ ] **Step 3: Verify failure**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/IconBase.test.svelte.ts 2>&1 | tail -10
```

Expected: 4 failures — IconBase.svelte not found.

- [ ] **Step 4: Implement `site/src/lib/components/ui/IconBase.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Visual size in pixels (width AND height). Default 20. */
    size?: number;
    /**
     * Accessible label. When set, the icon emits `role="img"` + `aria-label`.
     * When omitted, the icon emits `aria-hidden="true"` (decorative-only).
     */
    label?: string;
    /** SVG viewBox. Default `0 0 24 24` (Lucide's standard). */
    viewBox?: string;
    /** Inner SVG markup snippet (e.g., `<path>`, `<circle>`). */
    children: Snippet;
  }

  let { size = 20, label, viewBox = '0 0 24 24', children }: Props = $props();
</script>

{#if label}
  <svg
    width={size}
    height={size}
    {viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    role="img"
    aria-label={label}
  >
    {@render children()}
  </svg>
{:else}
  <svg
    width={size}
    height={size}
    {viewBox}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {@render children()}
  </svg>
{/if}
```

> **Note: two SVG branches instead of one with conditional attributes.** Svelte 5 + TypeScript treat dynamic `aria-hidden` (via `{...ariaProps}`) as `string` — which conflicts with the `Booleanish` typing of native HTML attributes. Splitting into two branches keeps each `aria-hidden="true"` literal-typed, which TS narrows correctly. The cost is duplicated `<svg>` markup but it's localized to this one file.

- [ ] **Step 5: Verify tests pass**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/IconBase.test.svelte.ts 2>&1 | tail -10
```

Expected: 4 green.

- [ ] **Step 6: Stage (continues into Task B4)**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/components/ui/IconBase.svelte \
  site/src/lib/components/ui/IconBase.test.svelte.ts \
  site/src/lib/components/ui/IconBase.test.harness.svelte
```

---

### Task B4: Migrate all 25+ Lucide icons to delegate to IconBase

**Files:**

- Modify: 25+ files in `site/src/lib/components/ui/icons/`

Each icon becomes 4 lines. The `aria-hidden` Booleanish error vanishes.

- [ ] **Step 1: Refactor `Search.svelte` (template for all icons)**

```svelte
<script lang="ts">
  import IconBase from '../IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  {/snippet}
</IconBase>
```

- [ ] **Step 2: Refactor `Activity.svelte`**

```svelte
<script lang="ts">
  import IconBase from '../IconBase.svelte';
  let { size = 20, label }: { size?: number; label?: string } = $props();
</script>

<IconBase {size} {label}>
  {#snippet children()}
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  {/snippet}
</IconBase>
```

- [ ] **Step 3: Refactor remaining 23 icons identically**

Apply the same pattern to:

- `AlertCircle.svelte`
- `AlertTriangle.svelte`
- `Check.svelte`
- `CheckCircle.svelte`
- `ChevronDown.svelte`
- `ChevronRight.svelte`
- `ChevronUp.svelte`
- `Code.svelte`
- `Command.svelte`
- `Copy.svelte`
- `CornerDownLeft.svelte`
- `Download.svelte`
- `ExternalLink.svelte`
- `Eye.svelte`
- `GitCompare.svelte`
- `Github.svelte`
- `Image.svelte`
- `Info.svelte`
- `Layers.svelte`
- `ListChecks.svelte`
- `Lock.svelte`
- `Maximize2.svelte`
- `Minimize2.svelte`
- `Moon.svelte`
- `SearchX.svelte`
- `Sun.svelte`
- `X.svelte`

The inner SVG markup of each is preserved — only the wrapper changes.

- [ ] **Step 4: Verify typecheck**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -c "aria-hidden"
```

Expected: 0.

- [ ] **Step 5: Smoke — render an icon-using page**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -10
```

Expected: green build.

- [ ] **Step 6: Visual smoke — verify icons render**

```bash
cd /u/Git/CentralGauge/site && npx wrangler dev --local --persist-to=.wrangler/state &
sleep 5
curl -s 'http://localhost:8787/' | grep -c "<svg"
kill %1 2>/dev/null || true
```

Expected: > 0 — icons still render in the leaderboard.

- [ ] **Step 7: Stage**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/icons/
```

---

### Task B5: Snippet typing helper in `tests/setup-unit.ts` — extend existing mock

**Files:**

- Modify: `site/tests/setup-unit.ts`

> **Architect verification:** the existing `tests/setup-unit.ts:32–52` already vi-mocks `@testing-library/svelte`'s `render` and auto-converts `children`/`header`/`footer` string props to real snippets via `createRawSnippet`. A NEW `renderWithSnippets()` helper would be redundant — extend the existing mock instead. The remaining ~17 typecheck errors in `*.test.svelte.ts` files mostly stem from snippet-typed props with names that aren't in `SNIPPET_PROPS` yet, OR per-call casts on parameterized snippets (`Snippet<[string]>`).

- [ ] **Step 1: Audit which snippet-typed props are still casting**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -B1 "Snippet" | grep -oE 'children|header|footer|prefix|suffix|panels|title|leading|trailing|description|empty' | sort -u
```

Capture the prop names that appear. For each NEW prop name (not already in `SNIPPET_PROPS`), extend the set.

- [ ] **Step 2: Extend `SNIPPET_PROPS` in `site/tests/setup-unit.ts`**

```ts
// Existing line 32:
- const SNIPPET_PROPS = new Set(['children', 'header', 'footer']);
+ const SNIPPET_PROPS = new Set([
+   'children', 'header', 'footer',
+   // Added in P6 B5 — covers the ~17 audit cases. Add more here as new
+   // atoms with snippet-typed props are introduced.
+   'prefix', 'suffix', 'leading', 'trailing', 'description', 'empty', 'cta',
+ ]);
```

- [ ] **Step 3: Add `asSnippet()` helper for the parameterized-snippet escape hatch**

For the rare `Snippet<[string]>` (or other parameterized) cases that the auto-conversion can't handle, append a minimal helper to `setup-unit.ts`:

```ts
import type { Snippet } from "svelte";

/**
 * Type-erase a value to Snippet<[]>. For per-test escape hatches when a
 * test passes an already-built snippet whose type would otherwise widen
 * incorrectly. Prefer the SNIPPET_PROPS auto-conversion above for the
 * common case (string → Snippet<[]>).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asSnippet = <T extends unknown[] = []>(v: unknown): Snippet<T> =>
  v as Snippet<T>;
```

- [ ] **Step 4: Verify error count**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -c "Snippet"
```

Expected: drops materially from the audit baseline.

- [ ] **Step 5: Stage**

```bash
git -C /u/Git/CentralGauge add site/tests/setup-unit.ts
```

---

### Task B6: Tighten body narrowing in `tests/api/health.test.ts`

**Files:**

- Modify: `site/tests/api/health.test.ts`

Pre-existing `body unknown` warnings (3 errors). Cast or zod-parse.

- [ ] **Step 1: Modify**

```ts
import { describe, expect, it } from "vitest";
import { GET } from "../../src/routes/health/+server";

interface HealthBody {
  ok: boolean;
  service: string;
  now: string;
}

describe("GET /health", () => {
  it("returns 200 with ok:true", async () => {
    const resp = await GET({} as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("centralgauge");
    expect(typeof body.now).toBe("string");
  });
});
```

- [ ] **Step 2: Verify**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep "health" | head -5
```

Expected: zero errors on health.test.ts.

- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add site/tests/api/health.test.ts
```

---

### Task B7: Drop unused `@ts-expect-error` directives in CommandPalette test

**Files:**

- Modify: `site/src/lib/components/domain/CommandPalette.test.svelte.ts`

Trivial — 2 unused directives on lines 23 and 60.

- [ ] **Step 1: Modify**

Remove the comment lines:

```ts
// @ts-expect-error - jsdom stub
global.fetch = vi.fn(async () =>
  new Response(JSON.stringify(fakeIndex), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
);
```

becomes:

```ts
global.fetch = vi.fn(async () =>
  new Response(JSON.stringify(fakeIndex), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
);
```

(Same edit on line 60.)

- [ ] **Step 2: Verify**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/CommandPalette.test.svelte.ts 2>&1 | tail -10
```

Expected: all tests still pass.

- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/CommandPalette.test.svelte.ts
```

---

### Task B-COMMIT: Single atomic commit for Mini-phase B

- [ ] **Step 1: Verify all B sub-tasks staged**

```bash
cd /u/Git/CentralGauge && git status --short | grep "^[AMD]"
```

Expected files (~30):

- M site/src/lib/server/loader-helpers.ts (B1)
- M site/src/routes/runs/+page.svelte (B2)
- M site/src/routes/compare/+page.svelte (B2)
- A site/src/lib/components/ui/IconBase.svelte (B3)
- A site/src/lib/components/ui/IconBase.test.svelte.ts (B3)
- A site/src/lib/components/ui/IconBase.test.harness.svelte (B3)
- M site/src/lib/components/ui/icons/Activity.svelte (B4)
- ... (24 other icons)
- M site/tests/setup-unit.ts (B5)
- M site/tests/api/health.test.ts (B6)
- M site/src/lib/components/domain/CommandPalette.test.svelte.ts (B7)

- [ ] **Step 2: Build smoke**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 3: Run all tests**

```bash
cd /u/Git/CentralGauge/site && npx vitest run 2>&1 | tail -10
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
refactor(site/p6): type system stabilization — passthroughLoader, IconBase, snippet typing

Mini-phase B of P6 stabilization. Closes I-1 through I-6 audit findings:

- I-1: passthroughLoader<TVal, TKey extends string> returns precise type
  {[K in TKey]: TVal} instead of loose Record<string, TVal>; default
  TKey='data' preserves backward compat. Resolves 17+ typecheck errors
  across 5 routes (/runs, /models, /families/:slug, /search, /limitations).
- I-2: Input atoms on /runs and /compare gain label="Model slug" labelHidden;
  resolves a11y degradation (empty <span class="label">).
- I-3: New IconBase.svelte shared SVG container owns aria-hidden vs
  role="img"+aria-label switch with literal-typed branches (resolves
  ~30 Booleanish typing errors); 28 Lucide icon components migrate to
  4-line wrappers.
- I-4: tests/setup-unit.ts SNIPPET_PROPS extended (existing mock at
  setup-unit.ts:32-52 already auto-converts string-typed snippet props;
  adding more prop names + a thin asSnippet() escape hatch eliminates
  the remaining per-test "as unknown as Snippet<[]>" casts).
- I-5: tests/api/health.test.ts body narrowed via HealthBody interface.
- I-6: 2 unused @ts-expect-error directives removed from CommandPalette test.

Net LOC: -380 in icons (each shrunk ~50%), +60 in IconBase, +40 in
loader-helpers/setup-unit. Pre-fix typecheck count (verified via
`cd site && npm run check 2>&1 | tail -3` on 2026-04-29): 88 errors,
8 warnings, 51 files-with-problems. Target post-B: <15 errors with
the remainder tracked in Mini-phase C (RunDetail nullable, dead
LimitationItem) and D (TaskDetailPanel CSS).

Verify pre-fix count BEFORE editing:
  cd /u/Git/CentralGauge/site && npm run check 2>&1 | tail -3
Verify post-fix count AFTER B-COMMIT:
  cd /u/Git/CentralGauge/site && npm run check 2>&1 | tail -3
Capture both numbers in the actual commit message at land time.
EOF
)"
```

---

## Mini-phase C — Interface alignment

Closes the latent interface-drift findings (L-1, L-2, L-3). No production bugs today, but each is a footgun for P7+ work.

### Task C1: `RunDetail.completed_at` → `string | null`

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`
- Modify: `site/src/routes/api/v1/runs/[id]/+server.ts` (verify; emit null instead of '')
- Modify: any consumer that reads `completed_at`

The audit notes API yields `''` for incomplete runs but interface is non-nullable. Type lie.

- [ ] **Step 1: Update interface**

```ts
export interface RunDetail {
  // ...
-  completed_at: string;
+  completed_at: string | null;
  // ...
}
```

- [ ] **Step 2: Update API endpoint**

Verify `+server.ts` returns `null` (not `''`) when run not yet finished. Find the SQL/projection that emits `completed_at`; ensure `(row.completed_at ?? null) as string | null`.

- [ ] **Step 3: Find consumers (full scope — incl. test directories)**

```bash
cd /u/Git/CentralGauge && grep -rn "completed_at" site/src/lib site/src/routes site/tests 2>&1 | head -30
```

For each consumer, verify it handles null (e.g., display "running" vs formatted timestamp). Check tests too: any `expect(body.completed_at).toBe('')` assertion needs to flip to `.toBeNull()`.

- [ ] **Step 4: Update tests**

Find `tests/api/runs-detail.test.ts` (or similar) and assert null is preserved on the wire.

- [ ] **Step 5: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/shared/api-types.ts \
  site/src/routes/api/v1/runs/[id]/+server.ts
```

---

### Task C2: Drop dead `LimitationItem` interface

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`
- Modify: any consumer (likely zero — that's why it's dead)

The audit notes `ModelLimitations.LimitationItem` interface is dead code (no consumer; page uses markdown branch).

- [ ] **Step 1: Confirm dead**

```bash
cd /u/Git/CentralGauge && grep -rn "LimitationItem" site/ 2>&1 | head -10
```

Expected: only api-types.ts itself plus possibly a zero-import declaration. If a consumer exists, ALIGN the interface to the actual API shape and skip Step 2.

- [ ] **Step 2: Delete interface**

In `api-types.ts`, remove the entire `LimitationItem` interface. Also remove `ModelLimitations` if it references `LimitationItem` and has no consumer. Leave a comment:

```ts
// LimitationItem / ModelLimitations interfaces removed in P6 (Task C2) —
// dead code; the limitations page uses the markdown response path.
// See docs/superpowers/plans/2026-04-28-p6-stabilization.md.
```

- [ ] **Step 3: Verify build still green**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add site/src/lib/shared/api-types.ts
```

---

### Task C3: Create `<EmptyState>` UI atom

**Files:**

- Create: `site/src/lib/components/ui/EmptyState.svelte`
- Create: `site/src/lib/components/ui/EmptyState.test.svelte.ts`

Reusable empty-state pattern. Title + body + optional CTA.

- [ ] **Step 1: TDD — `EmptyState.test.svelte.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import EmptyState from "./EmptyState.svelte";
import EmptyStateHarness from "./EmptyState.test.harness.svelte";

describe("EmptyState", () => {
  it("renders title", () => {
    const { container } = render(EmptyStateHarness, {
      props: { title: "No tasks yet" },
    });
    expect(container.textContent).toContain("No tasks yet");
  });

  it("renders body slot", () => {
    const { container } = render(EmptyStateHarness, {
      props: { title: "X", body: "The catalog populates after sync." },
    });
    expect(container.textContent).toContain(
      "The catalog populates after sync.",
    );
  });

  it("renders CTA when href provided", () => {
    const { container } = render(EmptyStateHarness, {
      props: {
        title: "X",
        ctaLabel: "See operator runbook",
        ctaHref: "/operations",
      },
    });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/operations");
    expect(link?.textContent).toContain("See operator runbook");
  });

  it("omits CTA when ctaHref is undefined", () => {
    const { container } = render(EmptyStateHarness, { props: { title: "X" } });
    expect(container.querySelector("a")).toBeNull();
  });
});
```

- [ ] **Step 2: Test harness `EmptyState.test.harness.svelte`**

```svelte
<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  let { title, body, ctaLabel, ctaHref }: { title: string; body?: string; ctaLabel?: string; ctaHref?: string } = $props();
</script>

<EmptyState {title} {ctaLabel} {ctaHref}>
  {#if body}{body}{/if}
</EmptyState>
```

- [ ] **Step 3: Implement `EmptyState.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Heading shown above the body. */
    title: string;
    /** Optional CTA label. */
    ctaLabel?: string;
    /** Optional CTA link. Both ctaLabel and ctaHref must be set for the CTA to render. */
    ctaHref?: string;
    /** Body slot (children). */
    children?: Snippet;
  }

  let { title, ctaLabel, ctaHref, children }: Props = $props();
</script>

<section class="empty" role="region" aria-labelledby="empty-state-title">
  <h2 id="empty-state-title">{title}</h2>
  {#if children}
    <p class="body text-muted">{@render children()}</p>
  {/if}
  {#if ctaLabel && ctaHref}
    <a class="cta" href={ctaHref}>{ctaLabel}</a>
  {/if}
</section>

<style>
  .empty {
    padding: var(--space-7) var(--space-5);
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  h2 {
    margin: 0 0 var(--space-3) 0;
    font-size: var(--text-lg);
  }
  .body {
    margin: var(--space-3) 0 var(--space-4) 0;
    line-height: var(--leading-base);
    max-width: 50ch;
    margin-left: auto;
    margin-right: auto;
  }
  .cta {
    display: inline-block;
    padding: var(--space-3) var(--space-5);
    border: 1px solid var(--accent);
    border-radius: var(--radius-2);
    color: var(--accent);
    text-decoration: none;
  }
  .cta:hover { background: var(--accent-soft); }
</style>
```

- [ ] **Step 4: Verify tests pass**

```bash
cd /u/Git/CentralGauge/site && npx vitest run --config vitest.unit.config.ts src/lib/components/ui/EmptyState.test.svelte.ts 2>&1 | tail -10
```

Expected: 4 green.

- [ ] **Step 5: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/components/ui/EmptyState.svelte \
  site/src/lib/components/ui/EmptyState.test.svelte.ts \
  site/src/lib/components/ui/EmptyState.test.harness.svelte
```

---

### Task C4: Wire `<EmptyState>` into /tasks, /limitations, /runs, /compare

**Files:**

- Modify: `site/src/routes/tasks/+page.svelte`
- Modify: `site/src/routes/limitations/+page.svelte`
- Modify: `site/src/routes/runs/+page.svelte` (filter-empty case)
- Modify: `site/src/routes/compare/+page.svelte` (no-selection case)
- Modify: `site/src/routes/models/[slug]/limitations/+page.svelte` (if exists)

- [ ] **Step 1: `/tasks`**

Replace the existing `{#if filteredRows.length === 0}` empty block with:

```svelte
{#if filteredRows.length === 0}
  <EmptyState
    title="No tasks match the current filters"
    ctaLabel="Clear filters"
    ctaHref={page.url.pathname}
  >
    {#if allRows.length === 0}
      Task catalog populates after <code>centralgauge sync-catalog --apply</code>.
      If you're an operator, see the
      <a href="/docs/site/operations.md#catalog-drift-remediation">drift runbook</a>.
    {:else}
      No tasks match the current filters. Try clearing them.
    {/if}
  </EmptyState>
{:else}
  ...
{/if}
```

- [ ] **Step 2: `/limitations`**

```svelte
{#if items.length === 0}
  <EmptyState title="No shortcomings recorded yet">
    Limitations are derived from compile errors and accumulate as runs land.
    None have surfaced for the current dataset.
  </EmptyState>
{:else}
  <ShortcomingsTable items={items} />
{/if}
```

- [ ] **Step 3: `/runs` (filter-empty case)**

If runs page has an `{#if rows.length === 0}` block, swap it for an `<EmptyState>` with body "No runs match the current filters" plus a Clear filters CTA.

- [ ] **Step 4: `/compare` (no-selection case)**

Replace the current `<section class="empty">` block:

```svelte
{:else}
  <EmptyState title="Add at least two model slugs to compare">
    Try: <code class="text-mono">?models=sonnet-4-7,gpt-5</code>
  </EmptyState>
{/if}
```

- [ ] **Step 5: Verify tests + visual smoke**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run 2>&1 | tail -10
```

- [ ] **Step 6: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/routes/tasks/+page.svelte \
  site/src/routes/limitations/+page.svelte \
  site/src/routes/runs/+page.svelte \
  site/src/routes/compare/+page.svelte
```

---

### Task C-COMMIT: Single atomic commit for Mini-phase C

- [ ] **Step 1: Verify staged**

```bash
cd /u/Git/CentralGauge && git status --short
```

- [ ] **Step 2: Build smoke + tests**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
fix(site/p6): interface alignment + empty-state UX

Mini-phase C of P6 stabilization. Closes L-1, L-2, L-3 audit findings:

- L-1: RunDetail.completed_at narrowed to string | null; API endpoint
  emits null (not '') for incomplete runs; consumers updated.
- L-2: Dead LimitationItem / ModelLimitations interfaces removed
  (no consumer; page uses markdown response path).
- L-3: New EmptyState atom (title + body slot + optional CTA); wired
  into /tasks (catalog-drift hint), /limitations (no-shortcomings
  body), /runs (filter-empty CTA), /compare (no-selection hint).
EOF
)"
```

---

## Mini-phase D — Documentation cleanup

Closes M-1 (wrangler.toml stale comment) and M-2 (TaskDetailPanel unused CSS). Plus a sweep for any other stale doc references.

### Task D1: Update wrangler.toml DO storage comment

**Files:**

- Modify: `site/wrangler.toml`

The comment on lines 61–66 says "LeaderboardBroadcaster is in-memory only ... never writes to state.storage". P5.4 added persistence. Comment now contradicts code.

- [ ] **Step 1: Modify**

Find and replace:

```toml
# LeaderboardBroadcaster is in-memory only (Set<WritableStreamDefaultWriter>
# + recent BroadcastEvent[]) and never writes to state.storage. On the
# Cloudflare free plan, however, all new DO classes MUST be declared with
# `new_sqlite_classes` — `new_classes` (KV-backed storage) requires the
# Workers Paid plan. We pay the SQLite-WAL cost locally in exchange for
# being deployable without a billing tier bump.
new_sqlite_classes = ["LeaderboardBroadcaster"]
```

with:

```toml
# LeaderboardBroadcaster persists subscribers + recent BroadcastEvents
# via SQLite (state.storage). P5.4 added durable subscriber tracking so
# that DO-isolate restarts don't sever client SSE streams. On the
# Cloudflare free plan, all new DO classes MUST be declared with
# `new_sqlite_classes` — `new_classes` (KV-backed storage) requires the
# Workers Paid plan. We pay the SQLite-WAL cost in exchange for being
# deployable without a billing tier bump.
new_sqlite_classes = ["LeaderboardBroadcaster"]
```

- [ ] **Step 2: Stage**

```bash
git -C /u/Git/CentralGauge add site/wrangler.toml
```

---

### Task D2: TaskDetailPanel — remove unused CSS selectors

**Files:**

- Modify: `site/src/lib/components/domain/TaskDetailPanel.svelte`

Lines ~125–126 declare `.attempt.pass` and `.attempt.fail` selectors that aren't referenced in the markup (the markup uses `<AttemptCell>`, which has its own scoped CSS).

- [ ] **Step 1: Modify**

Find the `<style>` block and remove:

```css
.attempt.pass {
  color: var(--success);
}
.attempt.fail {
  color: var(--danger);
}
```

- [ ] **Step 2: Verify**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | grep -i "TaskDetailPanel"
```

Expected: zero CSS-warning lines.

- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/TaskDetailPanel.svelte
```

---

### Task D3: Cross-doc audit for any other stale references

**Files:**

- Modify: `docs/site/architecture.md`
- Modify: `docs/site/operations.md`
- Modify: `docs/site/design-system.md` (if needed)

Pass: search docs for any reference to behaviors that have changed in P5.x or P6.

- [ ] **Step 1: Sweep — bounded scope (target ~20 minutes max)**

Search docs for specific stale patterns. Stop after this one pass; this is intentionally bounded:

```bash
cd /u/Git/CentralGauge && \
  grep -rn "in-memory only\|never writes" docs/site/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "noindex\|X-Robots-Tag" docs/site/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "FTS5 contentless\|snippet()" docs/site/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "tests/api/redirect-sunset\|redirect-sunset.test" docs/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "applyMigrations from.*helpers\|tests/helpers/migrations" docs/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "_internal/catalog-drift-cron\|admin/catalog-drift" docs/ 2>&1 | head -10
cd /u/Git/CentralGauge && \
  grep -rn "INTERNAL_CRON_TOKEN" docs/ 2>&1 | head -10
```

Expected: any matches that contradict P5.x/P6 reality get edited. After all 7 greps return clean (or matched stale doc lines have been edited), STOP — do not expand to other doc patterns.

- [ ] **Step 2: For each match, update doc to reflect current behavior**

For example, in `docs/site/architecture.md`, the FTS5 section likely needs:

```markdown
## Search (FTS5)

The search endpoint queries `results_fts` (an FTS5 virtual table created
in `migrations/0002_fts.sql`). The FTS5 schema is contentless
(`content=''`); a precomputed `results.snippet_text` column provides the
source text for snippets (P6 migration `0004_snippet_text.sql`). The
search endpoint applies `<mark>` highlighting in JavaScript rather than
via FTS5's `snippet()` function, because the contentless schema returns
null for snippet().

If P7+ wants per-column snippets (e.g. separate snippets for
`compile_errors_text` vs `failure_reasons_text`), switch FTS5 to
contentful mode (`content='results' content_rowid='id'`) and use
`snippet(results_fts, N, ...)`. That migration requires
`INSERT INTO results_fts(results_fts) VALUES('rebuild')` and is single-statement
on D1 but blocking — schedule during a low-traffic window.
```

- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/
```

---

### Task D-COMMIT: Single atomic commit for Mini-phase D

- [ ] **Step 1: Verify staged**

```bash
cd /u/Git/CentralGauge && git status --short
```

- [ ] **Step 2: Build smoke**

```bash
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
docs(site/p6): cleanup — wrangler comment, TaskDetailPanel CSS, doc sweep

Mini-phase D of P6. Closes M-1 and M-2 audit findings:

- M-1: wrangler.toml DO comment updated — P5.4 added persistence;
  comment no longer claims "in-memory only".
- M-2: TaskDetailPanel.svelte unused .attempt.pass/.attempt.fail
  selectors removed; Svelte CSS-warnings gone.
- Cross-doc sweep: architecture.md FTS5 section documents the P6
  snippet_text column and the deferred contentful-mode migration.
EOF
)"
```

---

## Mini-phase E — Test hardening

Closes T-1 (OG WASM cold-init flake), adds catalog-drift CI invariant, captures visual-regression baseline on Ubuntu CI.

### Task E1: OG WASM `beforeAll` warmup

**Files:**

- Modify: `site/tests/api/og-images.test.ts` (single file — verified `ls tests/api/og-*.test.ts` returns only this one file)

`@cf-wasm/og` cold-init is ~600ms per fresh isolate. Under parallel test load this flakes. `beforeAll` warmup at the top-level describe block amortizes the cost across all OG test cases in the same isolate.

- [ ] **Step 1: Locate the existing top-level describe**

```bash
cd /u/Git/CentralGauge && grep -n "^describe\(" site/tests/api/og-images.test.ts | head -3
```

- [ ] **Step 2: Add `beforeAll` warmup**

Add `beforeAll` to the imports and to the existing top-level `describe('OG images', ...)` block:

```ts
-import { describe, it, expect } from 'vitest';
+import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('OG images', () => {
+ beforeAll(async () => {
+   // WASM cold-init for @cf-wasm/og is ~600ms per isolate. Pre-render a
+   // throwaway image so subsequent test cases don't pay the cost
+   // serially. Without this warmup, parallel test runs flake under CI.
+   // The actual route doesn't matter — any /og/* endpoint triggers the
+   // same WASM init path. (P6 Task E1)
+   await SELF.fetch('http://localhost/og/leaderboard?warmup=1');
+ });

  // ... existing test cases unchanged ...
});
```

- [ ] **Step 3: Run OG tests under repeated invocations to verify no flake**

```bash
cd /u/Git/CentralGauge/site && npm run build && for i in 1 2 3 4 5; do npx vitest run tests/api/og-images.test.ts 2>&1 | tail -3; done
```

Expected: 5 green runs.

- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add site/tests/api/og-images.test.ts
```

---

### Task E2: Catalog-drift CI invariant test

**Files:**

- Create: `site/tests/build/catalog-drift-invariant.test.ts`

Optional gate (off by default; on in dedicated daily workflow). When `CI_PROD_PROBE=1`, queries production endpoint at build time; fails if drift > 0.

- [ ] **Step 1: Create**

```ts
import { describe, expect, it } from "vitest";

const PROBE_URL =
  "https://centralgauge.sshadows.workers.dev/api/v1/health/catalog-drift";
const ENABLED = process.env.CI_PROD_PROBE === "1";

describe("Catalog drift CI invariant", () => {
  it("production catalog is in sync with results table", async () => {
    if (!ENABLED) {
      console.log("[catalog-drift-invariant] CI_PROD_PROBE != 1, skipping");
      return;
    }
    const res = await fetch(PROBE_URL);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
      drift_count: number;
    };
    if (body.drift) {
      throw new Error(
        `[CATALOG DRIFT] tasks_referenced=${body.tasks_referenced}, ` +
          `tasks_in_catalog=${body.tasks_in_catalog}, drift_count=${body.drift_count}. ` +
          `Run \`centralgauge sync-catalog --apply\` and re-deploy.`,
      );
    }
  });
});
```

- [ ] **Step 2: Document the dedicated workflow**

In `docs/site/operations.md`, add:

````markdown
### Daily catalog-drift CI probe

A dedicated GitHub Actions workflow (`.github/workflows/catalog-drift.yml`)
runs at 04:00 UTC daily. It sets `CI_PROD_PROBE=1` and runs
`npx vitest run tests/build/catalog-drift-invariant.test.ts`. On
failure, the workflow opens an issue tagged `ops:catalog-drift`.

The workflow file:

```yaml
name: Daily catalog drift probe
on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd site && npm ci
      - name: Run catalog-drift invariant
        env:
          CI_PROD_PROBE: "1"
        run: cd site && npx vitest run --config vitest.build.config.ts tests/build/catalog-drift-invariant.test.ts
```
````

````
- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/tests/build/catalog-drift-invariant.test.ts \
  docs/site/operations.md
# (optional: stage the workflow file when adding it)
````

---

### Task E3: Visual-regression baseline first-capture (Ubuntu CI)

**Files:**

- Modify: `docs/site/operations.md` (playbook only — actual capture happens via CI workflow_dispatch)

The P5.4 visual-regression spec captures on chromium; local Windows vs CI Ubuntu have different font rendering. Plan: first baseline is captured on Ubuntu CI via a manual workflow trigger, committed to the repo. Subsequent runs compare.

> **Sequencing note (IM-8):** the icon migration in B4 may produce sub-pixel SVG differences (whitespace, attribute order) that flake against any baseline captured before B-COMMIT. Capture the baseline AFTER B-COMMIT lands so the canonical reference set already reflects the IconBase output. Concretely: E3 in the task ordering executes after B-COMMIT (and thus after C/D/E1/E2 staging too) — see Plan summary phase order. If a baseline was already captured pre-B4, accept the post-B4 set as the new canonical and re-commit; do NOT try to diff old vs new because micro-pixel SVG differences will dominate.

- [ ] **Step 1: Document the playbook**

Append to `operations.md`:

````markdown
## Visual-regression baseline capture (one-time, Ubuntu CI)

The P5.4 `tests/e2e/visual-regression.spec.ts` captures PNG snapshots of
public pages and diffs against committed baselines. Local Windows and CI
Ubuntu render fonts differently — committing local Windows PNGs creates
a baseline that Ubuntu CI fails against on every PR.

**The first baseline must be captured on Ubuntu CI.** P6 stages the
playbook here; execute when ready.

### One-time capture

1. Ensure the visual-regression test exists and is correctly configured for
   `chromium`. Confirm:

   ```bash
   cd /u/Git/CentralGauge/site && grep -n "chromium" tests/e2e/visual-regression.spec.ts
   ```
````

2. Add a manual GitHub Actions workflow (`.github/workflows/visual-regression-baseline.yml`):

   ```yaml
   name: Capture visual-regression baseline (manual)
   on:
     workflow_dispatch:

   jobs:
     capture:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: cd site && npm ci
         - run: cd site && npx playwright install --with-deps chromium
         - name: Capture baseline
           run: cd site && npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
         - name: Upload artifacts
           uses: actions/upload-artifact@v4
           with:
             name: visual-regression-baselines
             path: site/tests/e2e/visual-regression.spec.ts-snapshots/
   ```

3. Run the workflow via the GitHub UI ("Run workflow" button).

4. Download the artifact, commit the PNGs to `site/tests/e2e/visual-regression.spec.ts-snapshots/`,
   open a PR titled `chore(site): visual-regression baseline (Ubuntu CI capture)`.

5. Subsequent CI runs compare against the committed baselines. Local
   development uses `--update-snapshots` only when an intentional UI
   change is being baselined — and the new baseline must be re-captured
   on Ubuntu CI before merging.

````
- [ ] **Step 2: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
````

---

### Task E-COMMIT: Single atomic commit for Mini-phase E

- [ ] **Step 1: Verify**

```bash
cd /u/Git/CentralGauge && git status --short
```

- [ ] **Step 2: Tests**

```bash
cd /u/Git/CentralGauge/site && npx vitest run 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
test(site/p6): test hardening — OG warmup, catalog-drift invariant, visual-regression baseline

Mini-phase E of P6. Closes T-1 audit finding plus operational layers:

- T-1: OG WASM cold-init warmup via beforeAll() in og-*.test.ts;
  amortizes ~600ms WASM cold-init across test cases per isolate.
- New tests/build/catalog-drift-invariant.test.ts (gated by
  CI_PROD_PROBE=1); paired with daily workflow .github/workflows/
  catalog-drift.yml that fails CI when production drift > 0.
- Visual-regression baseline first-capture playbook documented in
  operations.md — execute via manual workflow_dispatch when ready.
EOF
)"
```

---

## Mini-phase F — Pre-DNS-flip readiness

Comprehensive checklist + operator playbook for the custom-domain flip. **NO code changes that touch DNS or wrangler [vars] SITE_BASE_URL** — those are Phase G, held until user trigger.

### Task F1: Pre-flip checklist

**Files:**

- Modify: `docs/site/operations.md`

- [ ] **Step 1: Add a §"Custom-domain flip pre-flight checklist"**

Before flipping the SITE_BASE_URL, confirm:

````markdown
## Custom-domain flip pre-flight checklist

Before executing the SITE_BASE_URL change in Phase G, verify ALL of:

- [ ] **DNS prep**: Cloudflare DNS record for the new domain (A or CNAME)
      points at the Worker. Verify with `dig +short <domain>`.
- [ ] **Worker custom domain binding**: Cloudflare dashboard → Workers &
      Pages → centralgauge → Custom Domains → `<domain>` is in the list
      with status `Active`.
- [ ] **SSL Mode**: Cloudflare → SSL/TLS → Mode → Full (strict).
- [ ] **Sitemap regeneration**: Plan: after flipping SITE_BASE_URL, the
      next deploy regenerates `.svelte-kit/cloudflare/sitemap.xml` with
      the new domain. Verify by running `npm run build` AFTER the flip
      and checking the artifact:

      ```bash
      # SITEMAP_ROUTES is a 9-entry array exported from
      # site/scripts/build-sitemap.ts:37 (verified). After build, the
      # sitemap.xml has one <loc> per route.
      grep -c "<loc>https://<new-domain>/" .svelte-kit/cloudflare/sitemap.xml
      # Expected: 9 (matches SITEMAP_ROUTES.length at site/scripts/build-sitemap.ts:37)
      ```

- [ ] **Canonical URL**: After deploy, verify SSR-emitted canonical:

      ```bash
      curl -s https://<new-domain>/ | grep '<link rel="canonical"'
      # Expected: <link rel="canonical" href="https://<new-domain>/" />
      ```

- [ ] **JSON-LD**: After deploy, verify WebSite + Organization JSON-LD
      schemas reference the new domain (not the old workers.dev):

      ```bash
      curl -s https://<new-domain>/ | grep -A2 '"@type":"WebSite"' | grep "url"
      # Expected: "url":"https://<new-domain>"
      ```

- [ ] **Cloudflare Web Analytics token**: If RUM (P5.4 Task L1) was
      tied to the old workers.dev domain, update the token's
      `monitored_domains` to include the new domain.

- [ ] **Old-domain redirect (optional)**: Decide whether
      `*.workers.dev` should 301-redirect to the new domain. If yes,
      add a Cloudflare Page Rule.

- [ ] **Lighthouse + Playwright**: Re-baseline e2e specs that hardcode
      `localhost:4173` (none should — verify) or any external domain.

- [ ] **Search Console resubmission**: After deploy, submit the new
      sitemap URL to Google Search Console (one-time operator action).
````

- [ ] **Step 2: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
```

---

### Task F2: Verification script `scripts/verify-domain-flip.sh`

**Files:**

- Create: `site/scripts/verify-domain-flip.sh`

Curl-tests both old (workers.dev) and new (custom domain) domains post-flip.

- [ ] **Step 1: Author**

```bash
#!/usr/bin/env bash
# verify-domain-flip.sh — Post-flip smoke for custom-domain rollout (P6 Phase G)
#
# Usage:
#   ./verify-domain-flip.sh <new-domain> [<old-workers-dev-url>]
#
# Example:
#   ./verify-domain-flip.sh ai.sshadows.dk centralgauge.sshadows.workers.dev
#
# Exit code 0: all checks passed.
# Exit code != 0: at least one check failed; see stderr.

set -euo pipefail

NEW="${1:?Usage: $0 <new-domain> [<old-workers-dev-url>]}"
OLD="${2:-centralgauge.sshadows.workers.dev}"

PASS=0
FAIL=0
log_pass() { echo "[PASS] $*"; PASS=$((PASS+1)); }
log_fail() { echo "[FAIL] $*" >&2; FAIL=$((FAIL+1)); }

echo "=== Verifying custom-domain flip: ${NEW} (was ${OLD}) ==="

# 1. New domain returns 200 on /
if curl -sf -o /dev/null "https://${NEW}/"; then
  log_pass "https://${NEW}/ returns 200"
else
  log_fail "https://${NEW}/ does NOT return 200"
fi

# 2. New domain canonical points at itself
if curl -s "https://${NEW}/" | grep -q "rel=\"canonical\".*https://${NEW}/"; then
  log_pass "Canonical URL on / matches new domain"
else
  log_fail "Canonical URL on / does NOT match new domain"
fi

# 3. New domain sitemap reachable
if curl -sf -o /dev/null "https://${NEW}/sitemap.xml"; then
  log_pass "https://${NEW}/sitemap.xml returns 200"
else
  log_fail "https://${NEW}/sitemap.xml does NOT return 200"
fi

# 4. New domain sitemap entries reference new domain
if curl -s "https://${NEW}/sitemap.xml" | grep -q "<loc>https://${NEW}/"; then
  log_pass "Sitemap entries reference new domain"
else
  log_fail "Sitemap entries do NOT reference new domain"
fi

# 5. New domain robots.txt has Allow + Sitemap entries
if curl -s "https://${NEW}/robots.txt" | grep -q "^Sitemap: https://${NEW}/sitemap.xml"; then
  log_pass "robots.txt has Sitemap pointer"
else
  log_fail "robots.txt does NOT have Sitemap pointer"
fi

# 6. New domain X-Robots-Tag absent (i.e., indexable)
xrt=$(curl -s -I "https://${NEW}/" | grep -i "X-Robots-Tag" || true)
if [[ -z "${xrt}" ]]; then
  log_pass "No X-Robots-Tag (page is indexable)"
else
  log_fail "X-Robots-Tag present: ${xrt}"
fi

# 7. Optional: old domain still returns 200 (or redirects to new)
old_status=$(curl -sf -o /dev/null -w "%{http_code}" "https://${OLD}/" || echo "000")
if [[ "${old_status}" == "200" || "${old_status}" == "301" || "${old_status}" == "302" ]]; then
  log_pass "Old domain ${OLD}/ returns ${old_status} (still functional)"
else
  log_fail "Old domain ${OLD}/ returns ${old_status} (unexpected)"
fi

echo ""
echo "=== Verification: ${PASS} passed, ${FAIL} failed ==="
[[ "${FAIL}" == "0" ]] || exit 1
```

- [ ] **Step 2: Make executable**

```bash
chmod +x /u/Git/CentralGauge/site/scripts/verify-domain-flip.sh
```

- [ ] **Step 3: Stage**

```bash
git -C /u/Git/CentralGauge add site/scripts/verify-domain-flip.sh
```

---

### Task F3: Operator runbook for Phase G

**Files:**

- Modify: `docs/site/operations.md`

- [ ] **Step 1: Append**

````markdown
## Custom-domain flip operator runbook (Phase G)

When ready to flip from `centralgauge.sshadows.workers.dev` to a custom
domain:

### Pre-flip (operator, ~30 min)

1. Add DNS record (Cloudflare DNS): `<domain>` → CNAME `centralgauge.sshadows.workers.dev`,
   Proxy enabled, TTL Auto.

2. Cloudflare Workers dashboard → centralgauge → Custom Domains →
   "Add Custom Domain" → `<domain>`. Wait for SSL provisioning (~5 min).

3. Confirm SSL Mode: Cloudflare → SSL/TLS → Full (strict).

4. Run pre-flight checklist from §"Custom-domain flip pre-flight checklist".

### Code change (developer, ~5 min)

1. Edit `site/wrangler.toml` `[vars]` block:

   ```toml
   [vars]
   SITE_BASE_URL = "https://<domain>"
   ```
````

2. Run `cd site && npm run build` — verify the new sitemap regenerates
   with `<domain>` URLs.

3. Commit:

   ```bash
   git -C /u/Git/CentralGauge add site/wrangler.toml
   git -C /u/Git/CentralGauge commit -m "feat(site): custom-domain flip — SITE_BASE_URL → https://<domain>"
   ```

### Deploy + verify (developer, ~10 min)

1. Deploy: `cd site && npx wrangler deploy`.

2. Run verification script:

   ```bash
   cd site && bash scripts/verify-domain-flip.sh <domain> centralgauge.sshadows.workers.dev
   ```

3. Expected: 7 PASS, 0 FAIL.

### Post-flip (operator, ~5 min)

1. Submit new sitemap to Google Search Console: <https://search.google.com/search-console>.

2. (Optional) Add Cloudflare Page Rule: `centralgauge.sshadows.workers.dev/*` →
   301 redirect to `https://<domain>/$1`. Saves SEO juice.

3. Update Cloudflare Web Analytics token's `monitored_domains` to include
   `<domain>`.

4. Update internal docs (CONTRIBUTING.md, README.md) to reference the new domain.

````
- [ ] **Step 2: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
````

---

### Task F-COMMIT: Single atomic commit for Mini-phase F

- [ ] **Step 1: Verify staged**

```bash
cd /u/Git/CentralGauge && git status --short
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
docs(site/p6): pre-DNS-flip readiness — playbook, verification script

Mini-phase F of P6. Documents the Phase G operator playbook for
custom-domain flip (NOT executed in this phase).

- operations.md: §"Custom-domain flip pre-flight checklist" + §"Custom-
  domain flip operator runbook (Phase G)"
- scripts/verify-domain-flip.sh: post-flip curl smoke (7 checks)

Phase G holds until user explicit trigger. The wrangler.toml
SITE_BASE_URL swap is NOT in this commit.
EOF
)"
```

---

## Mini-phase G — Custom domain flip (FINAL — held until user trigger)

> **EXECUTION GATE:** Phase G is held until the user explicitly says "execute Phase G" or equivalent. Without that trigger, the steps below are read-only documentation. The plan file describes them so any agent picking up the work later has the complete sequence; nothing in Phase G runs during normal P6 execution.

### Task G1: Edit `wrangler.toml` `SITE_BASE_URL`

**Files:**

- Modify: `site/wrangler.toml`

- [ ] **Step 1 (HELD): Edit SITE_BASE_URL**

Replace `${SITE_BASE_URL_NEW}` with the operator-chosen domain at flip time (e.g. `ai.example.com`, `centralgauge.dev`). Concrete example shape:

```toml
[vars]
# Example: SITE_BASE_URL = "https://ai.example.com"
SITE_BASE_URL = "https://${SITE_BASE_URL_NEW}"
```

- [ ] **Step 2 (HELD): Build + verify sitemap regenerates with new domain**

```bash
cd /u/Git/CentralGauge/site && npm run build
grep -c "<loc>https://${SITE_BASE_URL_NEW}/" .svelte-kit/cloudflare/sitemap.xml
# Expected: 9
```

- [ ] **Step 3 (HELD): Stage + commit (single atomic commit for G)**

```bash
git -C /u/Git/CentralGauge add site/wrangler.toml
git -C /u/Git/CentralGauge commit -m "feat(site): custom-domain flip — SITE_BASE_URL → https://${SITE_BASE_URL_NEW}"
```

---

### Task G2: Operator action — Cloudflare DNS + custom domain binding

**Files:** none — Cloudflare dashboard actions.

- [ ] **Step 1 (HELD, OPERATOR): Add DNS record**

Cloudflare DNS → Add → CNAME `${SITE_BASE_URL_NEW}` → `centralgauge.sshadows.workers.dev`, Proxy enabled.

- [ ] **Step 2 (HELD, OPERATOR): Add custom domain to Worker**

Cloudflare Workers & Pages → centralgauge → Custom Domains → "Add Custom Domain" → `${SITE_BASE_URL_NEW}`.

- [ ] **Step 3 (HELD, OPERATOR): SSL Mode**

Cloudflare → SSL/TLS → Full (strict).

---

### Task G3: Deploy + verify

- [ ] **Step 1 (HELD): Deploy**

```bash
cd /u/Git/CentralGauge/site && npx wrangler deploy
```

- [ ] **Step 2 (HELD): Run verification script**

```bash
cd /u/Git/CentralGauge/site && bash scripts/verify-domain-flip.sh ${SITE_BASE_URL_NEW} centralgauge.sshadows.workers.dev
```

Expected: 7 PASS, 0 FAIL.

- [ ] **Step 3 (HELD): Update Cloudflare Web Analytics token**

Cloudflare → Analytics → Web Analytics → token → Add `${SITE_BASE_URL_NEW}` to monitored domains.

- [ ] **Step 4 (HELD): Update CHANGELOG.md**

```markdown
## P6.G — Custom-domain flip

- Site moved from `centralgauge.sshadows.workers.dev` to `${SITE_BASE_URL_NEW}`
- Old domain remains accessible (no redirect at this time; consider a
  Page Rule if SEO juice loss is observed).
- Sitemap, canonical URLs, JSON-LD all reference the new domain.
```

- [ ] **Step 5 (HELD): Stage + commit**

```bash
git -C /u/Git/CentralGauge add site/CHANGELOG.md
git -C /u/Git/CentralGauge commit -m "docs(site): record custom-domain flip in CHANGELOG"
```

---

## Summary

P6 closes every audit finding through 7 mini-phases:

- **A** — Critical hotfixes (production bugs)
- **B** — Type system stabilization
- **C** — Interface alignment
- **D** — Documentation cleanup
- **E** — Test hardening
- **F** — Pre-DNS-flip readiness (read-only)
- **G** — Custom domain flip (HELD until user trigger)

Total: ~7 atomic commits (one per mini-phase A through F; G is one additional commit when triggered). No commit produces an inconsistent working tree. Each task includes TDD steps where applicable, file paths are absolute, and design rationales accompany every architectural choice.

The plan respects the gate on Phase G: nothing in this plan flips DNS or changes `SITE_BASE_URL` unless the user explicitly triggers it after the rest of P6 is reviewed.
