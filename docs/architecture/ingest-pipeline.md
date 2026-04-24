# Ingest Pipeline — Architecture

**Status:** Shipped. See `docs/superpowers/specs/2026-04-20-cli-ingestion-design.md`
for the full design.

The ingest pipeline lets the CLI push signed benchmark runs to the
scoreboard worker (`centralgauge.sshadows.workers.dev`) after a `bench`
finishes. It lives on top of the results-DB API (see
[`results-db.md`](./results-db.md)).

## End-to-end flow

```
                                +----------------------------+
bench completes  ───────────>   | assembleBenchResultsForVariant |
                                |  (cli/commands/bench/           |
                                |   ingest-assembly.ts)           |
                                +--------------+-----------------+
                                               |
                                               v
(per run × variant)              +-------------+------------+
ingestRun()            ─────>    | src/ingest/mod.ts        |
                                 +-------------+------------+
                                               |
              +--------------------------------+---------------------------------+
              |                                |                                 |
              v                                v                                 v
   (A) precheck blobs             (B) upload missing blobs            (C) POST signed run
   POST /runs/precheck            PUT  /api/v1/blobs/:sha256          POST /api/v1/runs
   ingest-scoped envelope         header-signed (ingest scope)        ingest-scoped envelope
              |
              v
   { missing_blobs: [...] }
   ← server returns subset
     that actually needs upload
```

1. **Precheck** — The client hashes every transcript + generated-code
   blob locally and posts the full list of sha256s to `/api/v1/runs/precheck`.
   The worker replies with only the subset the worker has never seen.
2. **Blob upload** — For each missing sha, the client `PUT`s the body
   to `/api/v1/blobs/:sha256` with three headers (`X-CG-Signature`,
   `X-CG-Key-Id`, `X-CG-Signed-At`). The worker verifies the signature
   covers `sha256:<hex>:<iso-timestamp>` and rejects keys older than 60s.
3. **Run POST** — Once blobs are present, the client posts the signed
   run envelope to `/api/v1/runs`. The worker re-checks that every
   referenced blob exists in R2 before inserting rows.

## The signed envelope

Every non-blob request uses the same envelope:

```json
{
  "version": 1,
  "signature": {
    "alg": "ed25519",
    "key_id": 1,
    "sig_b64": "<base64 ed25519 signature>"
  },
  "payload": {/* canonical JSON */}
}
```

- **Canonicalization** — `payload` is serialized with sorted keys, no
  `undefined` elision, and stable number formatting (see
  [`shared/canonical.ts`](../../shared/canonical.ts) — the source of truth
  used by both the CLI and the worker, with a parity test fixture under
  `tests/fixtures/canonical-parity/`).
- **Signing** — Ed25519 over the canonical JSON bytes.
- **Scope model** — Each key has one of three scopes:
  - `ingest` — push runs + precheck + blob upload
  - `admin` — everything `ingest` can do, plus catalog writes
  - `verifier` — reserved for automated verification pipelines
- **Key lookup** — The worker loads `(key_id, scope, public_key)` from the
  `machine_keys` D1 table. Unknown keys are rejected with 401.

## Blob upload (header-signed)

Blob uploads bypass the JSON envelope — the body is already a raw bytes
hash-validated by the worker, so we only need to authenticate the _request
itself_:

```
PUT /api/v1/blobs/<sha256> HTTP/1.1
X-CG-Signature: base64(ed25519(key_priv, "sha256:<hex>:<iso-timestamp>"))
X-CG-Key-Id: 1
X-CG-Signed-At: 2026-04-22T01:02:03Z
Content-Type: application/octet-stream

<body>
```

The worker:

1. Parses + rejects timestamps outside `±60s`.
2. Looks up the key; rejects non-ingest/admin scopes.
3. Verifies the signature covers the exact sha + timestamp string.
4. Computes sha256 of the body; rejects if it does not match `<sha256>` in URL.
5. Uploads to R2 under `blobs/<sha256>`.

Implementation: `site/src/lib/server/blob-auth.ts` +
`site/src/routes/api/v1/blobs/[sha256]/+server.ts`.

## Admin catalog endpoints

`centralgauge sync-catalog --apply` reconciles `site/catalog/*.yml` with D1:

| Method | Path                              | Scope | Purpose                        |
| ------ | --------------------------------- | ----- | ------------------------------ |
| POST   | `/api/v1/admin/catalog/models`    | admin | Upsert a model row             |
| POST   | `/api/v1/admin/catalog/pricing`   | admin | Upsert a cost_snapshots row    |
| POST   | `/api/v1/admin/catalog/task-sets` | admin | Upsert a task-set row (hashes) |

**Families are not exposed** — they are seeded directly in D1 via
SQL migration (`site/migrations/0001_core.sql`) and the sync command
skips them.

## Pricing registration

The first `bench` run for a new model (slug) has no `cost_snapshots` row
yet, so the client pauses mid-ingest and prompts for pricing:

```
[REGISTER] anthropic/claude-opus-4-7 has no pricing snapshot.
  Fetch from OpenRouter?  (y/n) ... y
  USD per Mtok — input: 15.00, output: 75.00, cache_read: 1.50
  Accept? (y/n)
```

Accepted rows are written back to `site/catalog/pricing.yml` (so the repo
stays the source of truth) and POSTed to `/api/v1/admin/catalog/pricing`.

Use `-y`/`--yes` to auto-accept OpenRouter pricing without prompts.

## File layout

| Path                                      | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `shared/canonical.ts`                     | Canonical JSON (used by CLI + worker)       |
| `src/ingest/sign.ts`                      | Ed25519 sign/verify                         |
| `src/ingest/envelope.ts`                  | Envelope builder + parser                   |
| `src/ingest/client.ts`                    | POST with exponential backoff               |
| `src/ingest/blobs.ts`                     | Header-signed blob upload                   |
| `src/ingest/register.ts`                  | Interactive pricing + task-set registration |
| `src/ingest/catalog/read.ts`              | Load `site/catalog/*.yml`                   |
| `src/ingest/catalog/write.ts`             | Patch pricing back into `pricing.yml`       |
| `src/ingest/catalog/task-set-hash.ts`     | Stable hash of task set                     |
| `src/ingest/pricing-sources/`             | OpenRouter + provider adapters              |
| `src/ingest/config.ts`                    | Merged cwd + home `.centralgauge.yml`       |
| `src/ingest/mod.ts`                       | `ingestRun()` — the orchestrator            |
| `cli/commands/bench/ingest-assembly.ts`   | Bench-result JSON → `BenchResults` payload  |
| `cli/commands/ingest-command.ts`          | `centralgauge ingest <path>`                |
| `cli/commands/sync-catalog-command.ts`    | `centralgauge sync-catalog`                 |
| `site/src/lib/server/blob-auth.ts`        | Worker-side header verification             |
| `site/src/routes/api/v1/runs/precheck/`   | Precheck endpoint                           |
| `site/src/routes/api/v1/admin/catalog/*/` | Admin catalog endpoints                     |

## Related

- [Benchmark Results DB](./results-db.md) — underlying schema + read APIs
- [Production Ingest guide](../guides/production-ingest.md) — setup walkthrough
- [`ingest` command](../cli/commands.md#ingest) — CLI reference
- [`sync-catalog` command](../cli/commands.md#sync-catalog) — CLI reference
