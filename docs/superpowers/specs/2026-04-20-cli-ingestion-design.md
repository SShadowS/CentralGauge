# CLI Ingestion + Production Deploy — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation plan

## Summary

Wire the CentralGauge CLI to the signed ingest API and deploy the leaderboard worker to production. New benchmark runs land in a single production Cloudflare Worker with full artifact archival (transcripts, generated code, reproduction bundle). Reference data (models, pricing, task sets) is catalog-driven from the repo with interactive auto-registration at bench time. Pricing rates never default — they come from a provider API or manual entry.

## Scope

### In scope

- `src/ingest/` CLI library: canonical JSON, signing, envelope construction, catalog read/write, pricing-source adapters, blob upload, HTTP client with retry.
- `centralgauge ingest <path>` replay command.
- `bench` command wiring: inline ingest on every run, opt-out with `--no-ingest`.
- `centralgauge sync-catalog` command as a safety valve for hand edits.
- Server: two new endpoints (`PUT /api/v1/blobs/:sha256`, `POST /api/v1/runs/precheck`). Schema migration `0003_cost_source.sql` to add provenance columns on `cost_snapshots`. Catalog seed tables.
- Shared `shared/canonical.ts` at repo root, imported from both the Deno CLI and the Worker, with a byte-parity golden-fixture test on each side.
- Production deploy of the worker to `centralgauge.sshadows.workers.dev`, plus a deferred cutover of `ai.sshadows.dk` after the first six-model run completes.

### Out of scope (explicit non-goals)

- Legacy 128-result back-fill (`results/benchmark-results-1776393062110.json`). Tests and scoring have drifted; those numbers are not comparable to today's.
- Two environments (preview as a data review queue). The bare preview Worker URL remains as a disposable smoke-test target for worker code changes; its D1 data is ephemeral.
- Multi-user admin UI / role management. Single user.
- Automated catalog PR workflow. Interactive register + manual git commit is enough.
- Dead-letter queue, background ingest daemon, orphan-blob GC. All deferred until measured need.

## Locked architectural decisions

1. **Single environment** (production). Preview stays as a scratch smoke-test target for code changes; its data is not retained.
2. **Pricing comes from a server-side catalog** (`site/catalog/pricing.yml` → D1). No inferred defaults — rates come from a provider API (Anthropic, OpenAI, Gemini, OpenRouter) or manual entry. If neither path produces a rate, bench refuses to continue.
3. **Reference data registration is interactive at bench-time.** Models and task sets auto-register with inferred defaults after user confirmation. Pricing requires API success or manual entry; no fallback ever.
4. **Canonical JSON is a single shared file** imported from both runtimes. A byte-parity golden fixture runs on both sides in CI.
5. **Blobs in v1**: transcripts, generated code, and a reproduction bundle per run. All three content-addressed in R2.
6. **Run outcome ≠ ingest outcome.** Transient ingest failures retry with backoff and print a replay command. 4xx errors fail loudly. A crashed `bench` writes no JSON and therefore ingests nothing.
7. **Prod domain: bare `centralgauge.sshadows.workers.dev`** initially. Cut `ai.sshadows.dk` over once the first six-model run completes and the new UI is verified.

## Architecture overview

```
                    repo (source of truth)
   +-------------------------------------------------+
   |  site/catalog/models.yml      tasks/**/*.yml    |
   |  site/catalog/pricing.yml     shared/canonical.ts|
   +------------------------------+------------------+
                                  | checked in
   +------------------------------+------------------+
   |                    Deno CLI                     |
   |  +------------------------------------------+   |
   |  | bench-command.ts                         |   |
   |  |  -> runs benchmark -> writes JSON        |   |
   |  |      -> src/ingest/                      |   |
   |  |          + catalog.ts    (read yml)      |   |
   |  |          + register.ts   (interactive)   |   |
   |  |          + envelope.ts   (build payload) |   |
   |  |          + sign.ts       (Ed25519)       |   |
   |  |          + blobs.ts      (R2 upload)     |   |
   |  |          + client.ts     (HTTP + retry)  |   |
   |  +------------------------------------------+   |
   +------------------------------+------------------+
                                  | HTTPS (signed)
   +------------------------------+------------------+
   |  Cloudflare Worker (centralgauge.sshadows.*)    |
   |  +------------------------------------------+   |
   |  | PUT  /api/v1/blobs/:sha256               |   |
   |  | POST /api/v1/runs/precheck               |   |
   |  | POST /api/v1/runs                        |   |
   |  | GET  /api/v1/...                         |   |
   |  +------------------------------------------+   |
   |  D1 (catalog + runs + results)                  |
   |  R2 (blobs: transcripts, code, bundles)         |
   |  KV (cache), DO (leaderboard broadcast)         |
   +-------------------------------------------------+
```

**Data flow:** repo holds source-of-truth catalogs. CLI reads them to decide what's known, prompts for anything unknown (pricing must come from a provider API or manual entry), writes updates back to catalog YAMLs AND D1 atomically. Bench produces a signed payload, uploads blobs to R2 by content hash, POSTs the run. Server validates references against D1 catalogs and writes immutable run + results rows.

**Key properties:**

- Repo is the single source of truth for reference data. D1 is a materialized mirror.
- Runs and results rows are immutable. Catalog rows are mutable via sync except for pricing rates, which are immutable by `pricing_version` convention.
- Local results JSON is the durable master — ingest is a pure replay-able function of `(JSON, env config) -> wire bytes`.

## Component: CLI ingest library (`src/ingest/`)

```
src/ingest/
+-- types.ts              # SignedRunPayload, CatalogEntry, PricingRates shapes
+-- canonical.ts          # re-exports shared/canonical.ts
+-- catalog/
|   +-- read.ts           # parse site/catalog/{models,pricing}.yml + tasks/
|   +-- write.ts          # append entries to yml files, preserving comments
|   +-- task-set-hash.ts  # deterministic hash of tasks/**/*.yml
+-- pricing-sources/
|   +-- index.ts          # dispatch by model family
|   +-- anthropic.ts
|   +-- openai.ts
|   +-- gemini.ts
|   +-- openrouter.ts
+-- register.ts           # interactive prompts; writes catalog + D1 atomically
+-- envelope.ts           # build SignedRunPayload from benchmark JSON + catalog
+-- sign.ts               # Ed25519 sign canonical JSON
+-- blobs.ts              # R2 upload helper
+-- client.ts             # HTTP POST with retry logic
+-- config.ts             # resolve URL, key, key_id, machine_id
+-- mod.ts                # barrel export: ingestRun(resultsJson, options)
```

**Single public entry point:** `ingestRun(resultsJson, options)`. Used by both `bench` (inline) and `centralgauge ingest <path>` (replay).

Returns a discriminated union:

```ts
type IngestOutcome =
  | { kind: "success"; runId: string; bytesUploaded: number }
  | { kind: "retryable-failure"; attempts: number; lastError: Error; replayCommand: string }
  | { kind: "fatal-failure"; code: string; message: string };
```

**Pure core, I/O at the edges.** `canonical.ts`, `envelope.ts`, `sign.ts`, `catalog/task-set-hash.ts` are pure and trivially unit-testable. `catalog/read.ts`, `catalog/write.ts`, `blobs.ts`, `client.ts`, `pricing-sources/*` do I/O and are tested with mocks or against a local worker.

**What `bench` calls:**

```ts
if (!flags.noIngest) {
  const outcome = await ingestRun(resultsJson, {
    env: flags.env ?? "production",
    interactive: !flags.yes,
  });
  if (outcome.kind === "retryable-failure") {
    log.warn(`Ingest failed after ${outcome.attempts} retries.`);
    log.info(`Replay: ${outcome.replayCommand}`);
  }
  if (outcome.kind === "fatal-failure") throw outcome;
}
```

## Component: Reference data — catalog + interactive register

### Catalog files (checked in)

```yaml
# site/catalog/models.yml
- slug: anthropic/claude-opus-4-7
  api_model_id: claude-opus-4-7-20251001
  family: claude
  display_name: Claude Opus 4.7
  generation: 47
  released_at: 2026-01-15
  deprecated_at: null

# site/catalog/pricing.yml
- pricing_version: anthropic-2026-04-20
  model_slug: anthropic/claude-opus-4-7
  input_per_mtoken: 15.00
  output_per_mtoken: 75.00
  cache_read_per_mtoken: 1.50
  cache_write_per_mtoken: 18.75
  effective_from: 2026-04-20T00:00:00Z
  source: anthropic-api        # adapter that supplied the numbers
  fetched_at: 2026-04-20T10:15:22Z

# site/catalog/model-families.yml
- slug: claude
  vendor: Anthropic
  display_name: Claude
```

Task sets are not in a catalog file — they are derived. `catalog/task-set-hash.ts` walks `tasks/**/*.yml`, hashes each manifest's content, and produces a stable tree hash (sorted by task_id).

### Schema additions

```sql
-- migrations/0003_cost_source.sql
ALTER TABLE cost_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cost_snapshots ADD COLUMN fetched_at TEXT;
```

### Interactive flow at bench-time

```
$ centralgauge bench --llms anthropic/claude-opus-4-8 ...

[INFO] Checking catalog...
[WARN] Model 'anthropic/claude-opus-4-8' not in site/catalog/models.yml.
[INFO] Inferred defaults:
         family:       claude
         display_name: Claude Opus 4.8
         generation:   48
         released_at:  (leave blank)
[?]   Write to catalog + D1? [Y/n/edit]: y

[INFO] Checking pricing for pricing_version 'anthropic-2026-04-24'...
[INFO] Fetching from anthropic-api...
       input_per_mtoken:        18.00
       output_per_mtoken:       90.00
       cache_read_per_mtoken:    1.80
       cache_write_per_mtoken:  22.50
       source: anthropic-api (fetched 2026-04-24T10:15:22Z)
[?]   Write to catalog + D1? [Y/n]: y

[INFO] Checking task set hash 'a1b2c3...'
[INFO] Not registered. Task count: 50. Auto-registering.
[INFO] Catalog up to date. Starting bench.
```

### Failure modes

- Pricing API returns null AND user declines manual entry: bench exits with a clear error, no partial state written.
- User says `n` to model registration: bench exits, catalog unchanged.
- Non-interactive (`--yes` / CI): accepts API-fetched pricing without prompting; fails hard if no API source covers the model (no silent defaults).

### Atomic write guarantee

`register.ts` writes the catalog YAML first, then inserts into D1. If D1 insert fails, the YAML is rolled back (read-original, write-new, on-error-restore). If YAML write fails, D1 is untouched.

### Sync-catalog command

`centralgauge sync-catalog [--dry-run] [--apply]` exists as a safety valve. Reads all three YAMLs, computes D1 delta, shows it, applies on `--apply`. Useful if you hand-edit a YAML or pull catalog changes from git on another machine.

## Component: Signing + canonical JSON

**Shared file: `shared/canonical.ts` at repo root.** Pure function, no runtime imports. Both sides pull it in via relative path:

```ts
// Worker side: site/src/lib/shared/canonical.ts
export { canonicalJSON } from '../../../../shared/canonical';

// CLI side: src/ingest/canonical.ts
export { canonicalJSON } from '../../shared/canonical.ts';
```

Deno resolves the relative path directly. Vite follows the import at bundle time. One source, zero runtime duplication.

### Parity regression test

`tests/fixtures/canonical-parity/input.json` + `expected.txt`. Two tests reference the same fixture:

- `tests/unit/ingest/canonical_test.ts` (Deno) — asserts `canonicalJSON(input) === expected`.
- `site/src/lib/shared/canonical.test.ts` (Vitest) — same assertion.

If either side drifts, CI fails. If the shared file itself changes, the fixture is updated in the same change.

### Signing (`src/ingest/sign.ts`)

```ts
import * as ed from "npm:@noble/ed25519@3.1.0";
import { canonicalJSON } from "./canonical.ts";

export async function signPayload(
  payload: Record<string, unknown>,
  privateKey: Uint8Array,
  keyId: number,
): Promise<Signature> {
  const canonical = canonicalJSON(payload);
  const bytes = new TextEncoder().encode(canonical);
  const sig = await ed.signAsync(bytes, privateKey);
  return {
    alg: "Ed25519",
    key_id: keyId,
    signed_at: new Date().toISOString(),
    value: base64.encode(sig),
  };
}
```

### Clock skew rule

Server enforces ±300s on `signed_at`. For long benches plus retries, **sign at send time, not at benchmark-complete time.** Each retry re-signs fresh. `envelope.ts` takes the pre-computed canonical and signs it on every send.

## Component: Blob upload flow

### Server endpoints

**`PUT /api/v1/blobs/:sha256`** (already exists from P1 scaffold — MUST ADD auth before production)

- **Existing behavior (P1):** anonymous PUT, server hashes body and rejects on mismatch, puts into R2 at `blobs/:sha256`. Returns 200/201.
- **Gap:** no authentication. Anyone with the URL can fill R2 with arbitrary content. This is a P1 scaffold bug that must be closed before production deploy.
- **Required change:** add Ed25519 signature verification (ingest scope). Signature must cover the URL path and body hash — not the body itself (too large to canonicalize and re-sign on retry). Shape:
  - Headers: `X-CG-Signature`, `X-CG-Key-Id`, `X-CG-Signed-At`
  - Signed bytes: canonical JSON of `{ method: "PUT", path: "/api/v1/blobs/<sha256>", body_sha256: "<sha256>", signed_at: "<iso>" }`
  - Same ±300s clock-skew check as runs endpoint.

**`POST /api/v1/runs/precheck`** (new)

- Same signed payload shape as `POST /api/v1/runs`, but server only verifies the signature and computes `missing_blobs`. Does not write.
- Returns `{ missing_blobs: [...] }`.
- Lets the client skip blobs the server already has.

### Client flow

```
1. Collect all blob hashes from results + reproduction bundle
2. POST /api/v1/runs/precheck  ->  { missing_blobs: [...] }
3. For each missing hash:
     - PUT /api/v1/blobs/:sha256 with body
     - 4xx: fatal (hash mismatch, bad signature)
     - 5xx/network: retry w/ backoff
4. POST /api/v1/runs with the signed payload
5. Server confirms missing_blobs is now empty; inserts rows
```

### Ordering: R2 first, then D1

- R2 upload fails → D1 never knows about the run → safe to retry entire ingest.
- R2 succeeds + D1 fails → orphan blobs in R2. Cheap (~$0.015/GB-month). GC deferred.

### Blob types (all in v1)

- **`transcript_sha256`** — JSON array of LLM API request/response pairs for one task+attempt. Per result, per attempt. UTF-8.
- **`code_sha256`** — generated AL file bytes, exactly as submitted to the compiler. Per result.
- **`reproduction_bundle_sha256`** — gzipped JSON, one per run. Contents:
  - `centralgauge_sha`
  - `task_manifests`: full YAML content of every task in the set (freezes definitions at run time)
  - `settings`: snapshot of settings used
  - `model`: full model metadata as used
  - `container`: image, version, BC version, machine info
  - `prompt_template`: rendered or source content
  - `timings`: rough phase timings for diagnostics

Existing `results.transcript_r2_key`, `results.code_r2_key`, `runs.reproduction_bundle_r2_key` columns cover all three. No schema additions for blobs.

## Component: Error handling + retry

### Three failure categories

| Category | Examples | Response |
|---|---|---|
| **Transient** | 5xx, network timeout, `fetch` throws, 429 | Retry with exponential backoff (3 attempts: 1s, 4s, 16s). All fail → `retryable-failure`; log + replay command; exit 0. |
| **Fatal (client bug)** | 400 bad_version, bad canonical, bad signature, hash mismatch | No retry. Surface the server error verbatim; exit non-zero. Indicates a code bug. |
| **Fatal (reference missing)** | 400 unknown_task_set / unknown_model / unknown_pricing | No retry. Message: "Catalog out of sync — run `centralgauge sync-catalog`, then replay." Exit non-zero. |

### Retry scope is per-request, not per-run

If a single blob PUT fails transiently, retry that PUT. If all 3 retries fail, the whole ingest is `retryable-failure` — but blobs already uploaded stay in R2. Next replay re-PUTs the same hashes and they are no-ops.

### Idempotency

Re-running `centralgauge ingest <path>` on the same JSON is safe:

- Blobs are content-addressed → re-PUTs are no-ops.
- `runs.id` uniqueness → server returns existing row status (`status: 'exists'`).
- `settings_profiles`, catalog tables use `INSERT OR IGNORE`.

### Interactive vs non-interactive surfaces

- Interactive (TTY): colored, formatted, action hints.
- Non-interactive (`--yes` or piped): structured JSON lines to stderr; exit code is the contract.

### Log verbosity

- Default: one line per phase (`Uploaded 43 blobs (12 new, 31 already present)`).
- `--verbose`: per-blob, per-retry, per-statement.

## Testing strategy

### Unit tests (fast, no network)

- `tests/unit/ingest/canonical_test.ts` — golden-fixture parity (Deno side).
- `site/src/lib/shared/canonical.test.ts` — same fixture (Vitest side).
- `tests/unit/ingest/envelope_test.ts` — payload builder edge cases.
- `tests/unit/ingest/sign_test.ts` — Ed25519 round-trip.
- `tests/unit/ingest/catalog/task-set-hash_test.ts` — deterministic + order-independent.
- `tests/unit/ingest/catalog/read_test.ts`, `write_test.ts` — YAML round-trip preserves comments.
- `tests/unit/ingest/pricing-sources/*_test.ts` — mocked against captured HTTP fixtures.

### Integration tests (worker-pool)

- `site/test/integration/runs-precheck.test.ts` — signed precheck returns accurate missing_blobs.
- `site/test/integration/blobs-put.test.ts` — hash verification, replay idempotency, bad-signature rejection.
- `site/test/integration/runs-post.test.ts` — full signed post path, including the three `unknown_*` rejections.
- `site/test/integration/catalog-sync.test.ts` — admin-scoped sync upserts correctly.

### End-to-end smoke

`scripts/smoke-ingest.ts` expanded to cover precheck → blobs → run. Runs against the production worker after each deploy.

## Deployment + cutover plan

### Pre-production checklist

1. Migration `0003_cost_source.sql` committed + applied to prod D1.
2. `site/catalog/*.yml` seeded with first 6 models + their current pricing (rates confirmed from Anthropic / OpenAI / Gemini APIs). Committed.
3. `wrangler.toml` production env validated (all D1 / KV / R2 IDs, DO binding with `new_sqlite_classes`).
4. Prod Ed25519 ingest key generated locally → `~/.centralgauge/keys/production-ingest.ed25519`; pubkey seeded via `scripts/seed-admin-key.ts --env production --scope ingest`. Key file confirmed gitignored.
5. `wrangler deploy --env production` from `site/`.
6. `scripts/smoke-ingest.ts` passes against `https://centralgauge.sshadows.workers.dev`.

### First real bench

1 model × 1 easy task, production, interactive. Verify: scoreboard reflects run, blobs present in R2, `ingest_events` row exists. Spot-check reproduction bundle unpacks cleanly.

### Scaling up

Progressively: 1 model × full task set → 2 models × full → 6 models × full.

### Domain cutover (`ai.sshadows.dk`)

**Trigger:** all 6 models have at least one complete run AND a human has eyeballed the leaderboard + clicked into transcripts to confirm the new UI is serving correctly.

**Steps:**

1. In Cloudflare dashboard, bind `ai.sshadows.dk` as a custom domain to the production worker.
2. Verify SSL provisioning and routing.
3. Retire the legacy site.
4. Update `.centralgauge.yml` default ingest URL from `centralgauge.sshadows.workers.dev` → `ai.sshadows.dk`.
5. Bare `centralgauge.sshadows.workers.dev` stays live indefinitely as a fallback — both resolve to the same worker.

**Rollback:** unbind `ai.sshadows.dk` in the Cloudflare dashboard and re-point it at the legacy site. DNS propagates in minutes. New ingested runs stay in D1.

## Risks

- **Pricing rate drift.** Rates change over time. `cost_snapshots` rows are immutable per `pricing_version`. Re-ingesting old results uses old rates; that's by design (audit trail), not a bug.
- **Clock skew on multi-day benches.** Signatures expire after ±300s. Rule: re-sign at send time, per retry. `envelope.ts` enforces this.
- **Partial blob uploads.** R2-first ordering avoids orphan D1 refs. Orphan R2 blobs are cheap and content-addressed; GC is deferred.
- **Canonical JSON drift.** Mitigated by a shared source file + byte-parity golden fixture tested on both sides.
- **Production key exposure.** Keys gitignored (`~/.centralgauge/keys/*`). Never commit, never log, never interpolate into argv visible in `ps`.
- **Catalog drift between YAML and D1.** `register.ts` writes both atomically. `sync-catalog` reconciles if they diverge (hand edits, fresh clone on a new machine).
- **Pricing API fails silently.** Adapter must distinguish "API returned null" (drop to manual prompt) from "network failed" (retry, then drop to manual). Ambiguous responses are treated as null and surface to the user.
