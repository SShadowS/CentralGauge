# Production Ingest — Setup Walkthrough

This guide walks through setting up CentralGauge to publish benchmark results
to the public scoreboard at `centralgauge.sshadows.workers.dev`.

By the end, `centralgauge bench` finishes a run, signs each `(run × variant)`
result with your Ed25519 key, and POSTs it to the scoreboard API for public
display. No further commands needed.

> **High-level flow.** Generate a key → register it with the worker →
> drop credentials into `~/.centralgauge.yml` → run `bench` and accept the
> interactive pricing prompt the first time each model appears.

---

## Prerequisites

- Deno 1.44+ (for running the CLI + seeder scripts)
- `npx wrangler` available on `PATH` (only needed for first-key seeding)
- A Cloudflare account that already has the scoreboard worker + D1 database
  deployed (see the worker's own README — this guide assumes that part is
  done)

## 1. Generate a machine key

Each machine that pushes runs (your laptop, CI runner, nightly box) should
have its own key. Never commit private keys.

```bash
deno run -A scripts/generate-machine-key.ts
```

Default output:

```
~/.centralgauge/keys/ingest.ed25519       # 32 raw bytes, mode 0600
~/.centralgauge/keys/ingest.ed25519.pub   # base64 public key + newline
```

Custom path:

```bash
deno run -A scripts/generate-machine-key.ts ~/.centralgauge/keys/my-host.ed25519
```

The script prints the base64 public key — you'll need it in the next step.

## 2. Register the key with the worker

For the very first admin key in a fresh environment, seed directly into D1
via Wrangler. Once at least one admin key exists, rotate or add new keys via
the signed admin API instead.

```bash
export CLOUDFLARE_ACCOUNT_ID=<your-account-id>

# Seed an ingest-scope key into the production D1 database.
deno run -A scripts/seed-admin-key.ts \
  centralgauge \
  production-ingest \
  <base64-public-key> \
  --scope ingest
```

Arguments:

| Position | Value                                                          |
| -------- | -------------------------------------------------------------- |
| 1        | D1 database name (e.g. `centralgauge`)                         |
| 2        | `machine_id` — stored with each run (e.g. `production-ingest`) |
| 3        | Base64-encoded Ed25519 public key                              |

Flags:

| Flag      | Default | Description                                   |
| --------- | ------- | --------------------------------------------- |
| `--scope` | `admin` | `admin`, `ingest`, or `verifier`              |
| `--env`   | –       | Wrangler env — omit for prod                  |

The script echoes the `id` D1 assigned to the row — **copy it**. You'll
configure `key_id` in the next step.

For catalog writes (models, pricing, task-sets), repeat with `--scope admin`:

```bash
deno run -A scripts/seed-admin-key.ts \
  centralgauge \
  production-admin \
  <base64-admin-public-key> \
  --scope admin
```

## 3. Configure `~/.centralgauge.yml`

Put ingest credentials in your **home** config file, not the project-root
file. The project-root `.centralgauge.yml` is committed to git and should
never contain secrets. The two files are merged per-field — anything you
don't override in cwd falls through from home.

```yaml
# ~/.centralgauge.yml
ingest:
  url: https://centralgauge.sshadows.workers.dev
  key_path: ~/.centralgauge/keys/ingest.ed25519
  key_id: 1
  machine_id: production-ingest

  # Optional — only needed for `centralgauge sync-catalog --apply`
  admin_key_path: ~/.centralgauge/keys/admin.ed25519
  admin_key_id: 2
```

Field reference:

| Field            | Required              | Description                                |
| ---------------- | --------------------- | ------------------------------------------ |
| `url`            | yes                   | Scoreboard worker URL                      |
| `key_path`       | yes                   | Path to 32-byte Ed25519 private-key file   |
| `key_id`         | yes                   | `machine_keys.id` returned by the seeder   |
| `machine_id`     | yes                   | Human-readable label stored with each run  |
| `admin_key_path` | only for sync-catalog | Admin-scope private key for catalog writes |
| `admin_key_id`   | only for sync-catalog | Admin-scope `machine_keys.id`              |

## 4. Seed the catalog (once per environment)

Before the first bench, push your catalog of models + pricing + task-sets to
the worker. This requires the admin key from step 2.

```bash
# Preview (dry-run) — prints what would change, no writes
deno task start sync-catalog

# Apply — POSTs to /api/v1/admin/catalog/*
deno task start sync-catalog --apply
```

The command reconciles `site/catalog/*.yml` with D1:

- `models.yml` → `POST /api/v1/admin/catalog/models`
- `pricing.yml` → `POST /api/v1/admin/catalog/pricing`
- `task-sets.yml`→ `POST /api/v1/admin/catalog/task-sets`

Families are **not** pushed — they're seeded directly via the D1 migration
(`site/migrations/0001_core.sql`). The sync command logs `[SKIP]` for them.

## 5. Run your first bench

```bash
deno task start bench \
  --llms anthropic/claude-opus-4-7 \
  --tasks "tasks/easy/CG-AL-E001-basic-table.yml" \
  --attempts 1 \
  --runs 1
```

When `bench` finishes, it automatically runs `ingestRun()` for each
`(run × variant)`. The first time a model has no `cost_snapshots` row yet,
you're prompted to register pricing:

```
[REGISTER] anthropic/claude-opus-4-7 has no pricing snapshot.
  Fetch from OpenRouter? (y/n) ... y
  USD per Mtok — input: 15.00, output: 75.00, cache_read: 1.50
  Accept? (y/n)
```

Accepted rows are written to `site/catalog/pricing.yml` (keeping the repo as
the source of truth) and POSTed to `/api/v1/admin/catalog/pricing`.

Flags that change the flow:

| Flag          | Effect                                               |
| ------------- | ---------------------------------------------------- |
| `-y, --yes`   | Auto-accept OpenRouter pricing without prompts       |
| `--no-ingest` | Skip the upload entirely; replay later with `ingest` |

## 6. Verify the run appears

After `bench` completes, check the public scoreboard:

```bash
curl https://centralgauge.sshadows.workers.dev/api/v1/runs?limit=5 | jq
```

You should see the run you just pushed, including:

- `run_id` matching the one printed at the end of `bench`
- `machine_id` matching your `ingest.machine_id`
- `variants[].score` and `variants[].cost_usd`

If the run isn't there, re-run with `--debug` and look for `[INGEST]` lines
in the output — they log every precheck, blob upload, and run POST.

## Replaying a run

If a bench finishes but the upload fails (network blip, worker down), the
run JSON is still on disk. Replay it explicitly:

```bash
deno task start ingest results/benchmark-results-1704067200000.json
```

See [`ingest` command](../cli/commands.md#ingest) for the full flag
reference.

## Rotating keys

Once you have a working admin key, rotate ingest keys via the signed admin
API rather than re-running the seeder:

```bash
# Generate the replacement key
deno run -A scripts/generate-machine-key.ts ~/.centralgauge/keys/ingest-v2.ed25519

# Register it (signed by the current admin key)
centralgauge admin register-key \
  --machine-id my-laptop \
  --scope ingest \
  --pub-file ~/.centralgauge/keys/ingest-v2.ed25519.pub
```

Then update `~/.centralgauge.yml` to point at the new key + new `key_id`,
and deactivate the old row via the admin API.

## Troubleshooting

### `401 unauthorized` on run POST

- Check the `key_id` in `~/.centralgauge.yml` matches the row the seeder
  inserted. `SELECT id, machine_id, scope FROM machine_keys;` via
  `npx wrangler d1 execute centralgauge --remote` lists them.
- Confirm the private key file is 32 bytes: `wc -c ~/.centralgauge/keys/ingest.ed25519`

### `403 scope not allowed` on catalog writes

- Sync-catalog requires an `admin`-scope key. Make sure
  `admin_key_id`/`admin_key_path` point at an admin row, not an ingest one.

### `400 clock skew`

- Blob upload fails if the signed timestamp is more than 60 seconds off the
  worker clock. Sync your machine's clock (`w32tm /resync` on Windows,
  `sudo ntpdate -u pool.ntp.org` on Linux).

### Pricing prompt loops every bench

- You said "no" to writing to `pricing.yml`. Either accept the write once,
  or add the row manually to `site/catalog/pricing.yml` and re-sync.

## Related

- [Ingest Pipeline architecture](../architecture/ingest-pipeline.md) — what
  `ingestRun()` actually does on the wire
- [`ingest` command](../cli/commands.md#ingest) — CLI reference
- [`sync-catalog` command](../cli/commands.md#sync-catalog) — CLI reference
- [Configuration guide](./configuration.md) — full `.centralgauge.yml` reference
