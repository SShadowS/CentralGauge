# Site architecture

> Source of truth for how the CentralGauge site runs at the edge.
> Spec: `docs/superpowers/specs/2026-04-27-p5-site-ui-design.md`

## Stack

- **Svelte 5** runes API (`$state`, `$derived`, `$effect`, `$props`)
- **SvelteKit 2** with `+page.server.ts` data loaders
- **`@sveltejs/adapter-cloudflare`** — same worker as the API
- **TypeScript strict** end-to-end via `$shared/api-types.ts`

## Data flow

```
Browser ──► Cloudflare edge (centralgauge.sshadows.workers.dev)
                │
                ├─► +page.server.ts load() ──► /api/v1/<endpoint>
                │                                  │
                │                                  ├─► Cache API (named: cg-<endpoint>)
                │                                  └─► D1 (centralgauge)
                │
                └─► /api/v1/events/live?routes=...
                       │
                       ├─► Durable Object (LeaderboardBroadcaster)
                       │      │
                       │      ├─► writer set (per-route filtered)
                       │      └─► recent buffer (last 100)
                       │
                       ▼
                 SSE frames over text/event-stream
```

## Module organization

```
site/src/
  routes/                         # SvelteKit pages
    +layout.svelte                  # Nav + density + theme + RUM beacon
    +layout.server.ts               # flag loader, build sha, RUM token
    +page.svelte                    # leaderboard home (P5.5 cutover, commit f79bfc9)
    leaderboard/+server.ts          # 302 → / (sunset 2026-05-30, P5.5)
    models/[slug]/                  # /models/:slug + /runs + /limitations
    runs/[id]/                      # /runs/:id + /transcripts + /signature
    families/[slug]/
    tasks/[...id]/
    compare/                        # /compare?models=
    search/                         # /search?q=
    limitations/                    # /limitations
    about/
    og/                             # /og/index.png + /og/models/:slug.png + ...
    _canary/[sha]/[...path]/        # canary path-prefix preview
    api/v1/                         # backend (predates P5)
    api/v1/events/live/             # SSE endpoint
    api/v1/__test_only__/           # gated test-fixture endpoints (CI only)
  lib/
    components/
      ui/                           # 20 design-system atoms
      domain/                       # composed widgets (LeaderboardTable, ...)
      layout/                       # Nav, Footer, SkipToContent
    server/                         # server-only helpers
      flags.ts                       # FLAG_* env loader
      cache.ts                       # named-cache wrappers
      sse-routes.ts                  # event → route-pattern map
      og-render.ts                   # @cf-wasm/og + R2 cache
      canary.ts                      # /_canary/ path utilities
      model-aggregates.ts            # AVG(score) helper (shared by leaderboard + /models/:slug)
      severity.ts                    # shortcoming severity bucket
      loader-helpers.ts              # passthroughLoader factory
    client/                         # browser-only modules
      use-event-source.svelte.ts     # SSE hook with backoff (reactive $state)
      keyboard.ts                    # global chord registry
      density-bus.svelte.ts          # density rune store (client-only)
      palette-bus.svelte.ts          # cmd-K rune store (client-only)
      theme.ts                       # theme controller
      format.ts                      # number/date formatters
      fuzzy.ts                       # cmd-K fuzzy match (~80 LOC)
      use-id.ts                      # SSR-safe id allocator
    shared/
      api-types.ts                  # source-of-truth response types
  do/
    leaderboard-broadcaster.ts      # SSE Durable Object
  styles/
    tokens.css                      # design tokens (light + dark + density)
    base.css                        # reset + typography
    utilities.css                   # tiny utility classes
    print.css                       # @media print rules
```

## Cache layers

| Layer | Where | TTL | Invalidation |
|-------|-------|-----|--------------|
| L1: Cache API named caches (`cg-leaderboard`, `cg-runs`, `cg-models`, `cg-models-detail`, `cg-tasks`, etc.) | Worker per-colo | API-defined `s-maxage` (typically 60 s) | None cross-colo; TTL only |
| L2: SvelteKit `load` deduping | Per-request | Single request | Automatic |
| L3: Browser HTTP cache + ETag | Per-client | `private, max-age=60` | `If-None-Match` 304 |
| L4 (OG only): R2 bucket (`og/v1/<kind>/<slug>/<task-set-hash>.png`) | Global | `max-age=60, swr=86400` | New task-set hash invalidates fresh |

**Invariant:** the leaderboard hot path uses Cache API only; it must never write to the `CACHE` KV namespace (1000-puts/day free-tier limit). Asserted by `site/tests/api/kv-writes.test.ts`.

## SSE per-route subscription

The Durable Object accepts `/subscribe?routes=<comma-list>`. Each writer's
route list is matched against `eventToRoutes(ev)` at fanout time. Default
(no `routes` param) is `['*']` — receives everything. Five routes
subscribe today (§8.5): `/`, `/runs`, `/runs/<id>`,
`/models/<slug>`, `/families/<slug>`. Legacy `/leaderboard` SSE
subscriptions are accepted via the `LEGACY_LEADERBOARD_ROUTES` alias
(I1) until 2026-05-30 sunset.

Wire format: `event: <type>\ndata: <JSON>\n\n` per RFC 6455 EventSource.

## Worker-isolate hazards

Cloudflare Workers run in long-lived V8 isolates. Module-scope state
persists across requests. Required mitigations:

1. **`useId()` reset per request** — `hooks.server.ts` calls
   `resetIdCounter()` to avoid SSR hydration mismatch.
2. **Client-only rune modules** — `palette-bus.svelte.ts` and
   `density-bus.svelte.ts` are imported ONLY by client components.
   Importing from `hooks.server.ts` pulls the Svelte 5 server runtime
   chunk into the worker bundle and breaks vitest pool-workers.
3. **`canonicalJSON` rejects undefined** — when omitting an optional
   field, use a conditional spread (`...(v ? { f: v } : {})`).
4. **Named caches, NOT `caches.default`** — adapter-cloudflare's URL-keyed
   default cache silently serves entries on the next matching request,
   bypassing handler logic. Use `caches.open('cg-<name>')`.
5. **Inline `cache.put`, NOT `ctx.waitUntil`** — guarantees the next
   request observes the entry.

## Build / deploy

`npm run build` produces `.svelte-kit/cloudflare/_worker.js` (worker
bundle) + `.svelte-kit/cloudflare/<assets>` (static). Wrangler reads
`.svelte-kit/cloudflare/` per `wrangler.toml`'s `[assets]` block.

Cron: `[triggers].crons = ["0 2 * * *"]` runs `runNightlyBackup`
(D1 → R2 dump).

## Feature flags

`site/src/lib/server/flags.ts` reads `FLAG_<NAME>` env vars. Defaults are
all `false`. Canary mode (path-prefixed `/_canary/`) flips everything on.
Promotion: edit `wrangler.toml [vars]` + `wrangler deploy`.

| Flag | Phase | Scope |
|------|-------|-------|
| `print_stylesheet` | P5.2 | documentation-only (CSS is unconditionally imported) |
| `trajectory_charts` | P5.3 | always-on consumer (`FamilyTrajectoryChart`) |
| `cmd_k_palette` | P5.4 | gates Nav button + chord listener |
| `sse_live_updates` | P5.4 | gates `useEventSource` consumers |
| `og_dynamic` | P5.4 | gates `/og/...` endpoints |
| `density_toggle` | P5.4 | gates Nav DensityToggle button |
| `rum_beacon` | P5.4 | gates Cloudflare Web Analytics `<script>` |

## P5.5 cutover migration map (COMPLETED 2026-04-30)

The following references were updated atomically as P5.5; see commit
`f79bfc9` (Mini-phase B atomic cutover). The table is preserved for
historical reference. The current architecture uses `/` as the
leaderboard URL; the `/leaderboard` route is a 302 redirect with a
30-day sunset (2026-05-30).

| Surface | Pre-P5.5 value | Post-P5.5 value (DONE) |
|---------|---------------|------------------------|
| Layout-server route | `/leaderboard` | `/` (commit `f79bfc9`) |
| `<LiveStatus>` SSE subscription | `useEventSource(['/leaderboard'])` | `useEventSource(['/'])` plus DO route map (`sse-routes.ts:eventToRoutes`) maps `run_finalized` + `task_set_promoted` → `/` (commit `f79bfc9`) |
| Lighthouse URL list | `127.0.0.1:4173/leaderboard` | `127.0.0.1:4173/` (commit `df6850c`) |
| Nav active-route highlight | `pathname === '/leaderboard'` | `pathname === '/'` (commit `f79bfc9`) |
| Robots meta | `<meta name="robots" content="noindex">` present | removed (commit `ab24b3d`) |
| Sitemap presence | absent | `sitemap.xml` published via `static/robots.txt` + build-time `scripts/build-sitemap.ts` (commits `b6da131`, `c544be2`) |
| Placeholder home | exists at `+page.svelte` | replaced by leaderboard markup; `/leaderboard/+server.ts` is now a 302 redirect (commit `f79bfc9`) |
| Layout-level structured data | absent | `StructuredData.svelte` mounted in layout for site-wide JSON-LD (WebSite + Organization) (commit `0742d22`) |
| Per-page canonical link | absent | `<link rel="canonical">` emitted on every page (commit `682c654`) |

### P5.5 cutover — DONE

Cutover landed 2026-04-30; the table above is preserved for historical
reference. The current architecture uses `/` as the leaderboard URL.
The `/leaderboard` route remains as a 302 redirect until the
2026-05-30 sunset; the SSE `LEGACY_LEADERBOARD_ROUTES` alias accepts
legacy subscriptions during the same window. Both will be removed by
the sunset deadline; CI guard `tests/build/redirect-sunset.test.ts`
fails 14 days before sunset to force operator attention.
