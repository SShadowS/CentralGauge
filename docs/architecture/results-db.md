# Benchmark Results DB — Architecture

**Status:** P1 shipped. See `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md` for full design.

## What P1 delivers

- D1 schema (migrations `0001_core.sql`, `0002_fts.sql`)
- R2 layout: `blobs/`, `shortcomings/`, `reproductions/`, `backups/`
  (`transcripts/` and `code/` prefixes are reserved; see "R2 layout" below)
- KV leaderboard cache invalidated on finalize / task-set promotion
- Ed25519-signed ingest (scope hierarchy: ingest < verifier < admin)
- Full public read surface: leaderboard, families, models, tasks, runs,
  transcripts, compare, search (FTS), sync/health
- Durable Object SSE broadcaster (`/api/v1/events/live`)
- Nightly D1→R2 backup cron

## Endpoints at a glance

| Method | Path                              | Auth                             |
| ------ | --------------------------------- | -------------------------------- |
| POST   | /api/v1/task-sets                 | ingest                           |
| POST   | /api/v1/task-sets/:hash/current   | admin                            |
| POST   | /api/v1/runs                      | ingest                           |
| PUT    | /api/v1/blobs/:sha256             | (hash-validated; unsigned)       |
| POST   | /api/v1/runs/:id/finalize         | (run-id authoritative; unsigned) |
| POST   | /api/v1/shortcomings/batch        | verifier                         |
| POST   | /api/v1/verify                    | verifier                         |
| POST   | /api/v1/pricing                   | admin                            |
| POST   | /api/v1/admin/keys                | admin                            |
| DELETE | /api/v1/admin/keys/:id            | admin                            |
| GET    | /api/v1/leaderboard               | public                           |
| GET    | /api/v1/families                  | public                           |
| GET    | /api/v1/families/:slug            | public                           |
| GET    | /api/v1/models                    | public                           |
| GET    | /api/v1/models/:slug              | public                           |
| GET    | /api/v1/models/:slug/limitations  | public                           |
| GET    | /api/v1/tasks                     | public                           |
| GET    | /api/v1/tasks/:id                 | public                           |
| GET    | /api/v1/runs                      | public                           |
| GET    | /api/v1/runs/:id                  | public                           |
| GET    | /api/v1/runs/:id/signature        | public                           |
| GET    | /api/v1/runs/:id/reproduce.tar.gz | public                           |
| GET    | /api/v1/transcripts/:key          | public                           |
| GET    | /api/v1/compare                   | public                           |
| GET    | /api/v1/search                    | public                           |
| GET    | /api/v1/sync/health               | public                           |
| GET    | /api/v1/events/live               | public (SSE)                     |

## R2 layout

All ingest content (transcripts, generated code, reproduction bundle bytes) is
content-addressed under a single `blobs/<sha>` prefix. The `blobKey()` helper in
`site/src/lib/server/ingest.ts` is the sole key builder used by the ingest path,
`PUT /api/v1/blobs/:sha256`, and `POST /api/v1/runs/:id/finalize`. Design-spec
line 354 (`transcripts/<sha256>.txt.zst`) is intentionally not implemented as
written — canonical storage is `blobs/<sha>`.

| Prefix           | Contents                                                                                                                                                                                                                                                                                                             | Writer                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `blobs/`         | All content-addressed ingest bytes (transcripts, generated code, reproduction-bundle bodies), sha256-keyed                                                                                                                                                                                                           | `PUT /api/v1/blobs/:sha256` during ingest            |
| `transcripts/`   | _Reserved._ Intended for curated / admin-uploaded transcripts in a later phase; nothing in P1 writes here. The read endpoint (`GET /api/v1/transcripts/<key>`) intentionally falls back to `blobs/<sha>` when the caller-supplied key looks like a bare sha256, so ingested transcripts are readable via this route. | (reserved)                                           |
| `code/`          | _Reserved._ Generated AL source is currently stored under `blobs/<sha>`; the `code/` prefix is held for a future curated-archive use case.                                                                                                                                                                           | (reserved)                                           |
| `shortcomings/`  | Incorrect-pattern snippets attached to a shortcoming row                                                                                                                                                                                                                                                             | `POST /api/v1/shortcomings/batch`                    |
| `reproductions/` | Reproduction tarballs (one per run)                                                                                                                                                                                                                                                                                  | Bench, finalized at `POST /api/v1/runs/:id/finalize` |
| `backups/`       | Nightly `d1-YYYYMMDD.sql` text dumps of every non-FTS user table                                                                                                                                                                                                                                                     | `scheduled` cron in `src/hooks.server.ts`            |

## Cron triggers

| Cron        | Handler                           | Purpose                                  |
| ----------- | --------------------------------- | ---------------------------------------- |
| `0 2 * * *` | `scheduled` -> `runNightlyBackup` | Dump D1 to `backups/d1-<date>.sql` in R2 |

## Next (P2+)

- Scoreboard SvelteKit pages consuming these APIs
- `centralgauge sync` outbox worker (replaces `.pending` sidecars)
- `centralgauge migrate-results` historical import
- Shortcomings analyzer running against finalized runs
- Vectorize semantic search on failure messages (deferred)
