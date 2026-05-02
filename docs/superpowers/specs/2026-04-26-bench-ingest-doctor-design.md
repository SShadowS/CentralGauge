# Bench ingest doctor — design

**Date:** 2026-04-26
**Status:** Approved (brainstorming)
**Owner:** SShadowS

## Problem

`centralgauge bench` runs for hours, then performs ingest at the very end. If
ingest credentials, catalog state, or worker connectivity is broken, the bench
crashes after the LLM budget is already spent and the user has to manually
investigate, fix, and replay.

Tonight (2026-04-26), a bench finished cleanly after ~3 hours of LLM and BC
container work, then `await ingestBenchResults()` threw because:

- `~/.centralgauge.yml` was missing (so `loadIngestConfig()` couldn't resolve
  `ingest.url`)
- `~/.centralgauge/keys/` was missing (so signing couldn't proceed even if
  config had loaded)

The user discovered the failure only after the run, and then debugging
exposed several adjacent issues:

- `cost_snapshots` rows missing in D1 for the bench's `pricing_version`
- `task_sets.is_current = 0` for the only task-set, so the leaderboard hid
  the run even after successful ingest
- `uploadBlob()` treated 429 as fatal instead of retryable
- `ingestRun()` never called the `/finalize` endpoint, so runs sat at
  `status='running'` indefinitely

A startup precheck would have caught the first three of these in seconds and
saved the LLM spend on a failed run.

## Goals

1. Catch every failure mode that prevents end-of-bench ingest, **before** any
   LLM call.
2. Re-validate light-weight credentials right before ingest fires, so an
   in-flight credential revocation or worker outage during a multi-hour bench
   degrades gracefully instead of losing data.
3. Provide a forward-looking `centralgauge doctor` umbrella for future
   environment health checks (containers, LLM auth, AL toolchain).
4. Stay strictly read-only on the worker side — precheck must never mutate
   D1.

## Non-goals

- End-to-end smoke testing (synthetic mini-ingest). Out of scope for
  defaults; can be added later behind `--smoke` if the level-D checks prove
  insufficient.
- Auto-repair of anything beyond a small explicit allowlist (catalog drift,
  task-set marking).
- Continuous health monitoring or dashboard widgets. Precheck is a discrete
  event at bench start and pre-ingest, plus a standalone CLI command.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Surfaces                                                    │
│  ┌────────────────────────┐    ┌──────────────────────────┐  │
│  │ centralgauge doctor    │    │ bench command (auto)     │  │
│  │   ingest [--repair]    │    │  precheck at start       │  │
│  │   containers           │    │  re-check pre-ingest     │  │
│  │   llm                  │    │  abort → results saved,  │  │
│  │   all                  │    │  replay one-liner shown  │  │
│  │   --json --levels=...  │    │                          │  │
│  └───────────┬────────────┘    └────────────┬─────────────┘  │
│              │                              │                │
│              ▼                              ▼                │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Pure precheck engine — src/doctor/                      ││
│  │   runDoctor(opts) → DoctorReport                         ││
│  │   Each check is a pure async fn: (ctx) → CheckResult     ││
│  │   Composable, testable in isolation, schema-versioned    ││
│  └──────────────────────────────────────────────────────────┘│
│                              │                               │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Worker probe endpoint — POST /api/v1/precheck           ││
│  │   Accepts: signed probe + variants[] + pricing_version + ││
│  │            task_set_hash                                 ││
│  │   Returns: { auth: ok, key_role, missing_models[],       ││
│  │              missing_pricing[], task_set_current: bool } ││
│  │   One round-trip for all level-D catalog state           ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Why this shape

- **Engine ↔ surfaces decoupled.** The pure `runDoctor()` engine is the same
  code path whether `doctor ingest --json` runs from CI or bench calls it
  programmatically. Single source of truth for what "healthy" means.
- **One worker round-trip for level D.** Instead of 4–5 separate D1 reads,
  one signed POST returns everything. The server is authoritative; the
  client doesn't have to assemble truth from disjoint reads.
- **Forward-looking umbrella.** `doctor` becomes the place new health checks
  live. Each section is its own module conforming to the same `Section`
  interface.

## Check matrix (level D, "ingest" section)

| ID              | Level | Requires                   | What it checks                                                                                                                                                                                                                                              | Remediation hint                                                                              |
| --------------- | ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `cfg.present`   | A     | —                          | `~/.centralgauge.yml` and/or project `.centralgauge.yml` parses; merged ingest section has `url`, `key_id`, `key_path`, `machine_id`                                                                                                                        | Run `deno run scripts/provision-ingest-keys.ts` and copy output into `~/.centralgauge.yml`    |
| `cfg.admin`     | A     | `cfg.present`              | If admin actions needed (sync-catalog, model auto-register), `admin_key_id` + `admin_key_path` set                                                                                                                                                          | Add `admin_key_*` to `~/.centralgauge.yml`                                                    |
| `keys.files`    | A     | `cfg.present`              | Both key files exist, exactly 32 raw bytes, owner-readable                                                                                                                                                                                                  | Re-run `scripts/provision-ingest-keys.ts`                                                     |
| `catalog.local` | A     | —                          | `site/catalog/{models,model-families,pricing}.yml` parse cleanly; schema valid                                                                                                                                                                              | Fix YAML syntax; check git status                                                             |
| `clock.skew`    | A     | —                          | Local clock vs. server `Date` header: skew < 60s (signed_at tolerance window)                                                                                                                                                                               | Sync system clock                                                                             |
| `net.health`    | B     | `cfg.present`              | `GET ${url}/health` returns 200 within 5s (AbortController)                                                                                                                                                                                                 | Check URL; check Cloudflare worker dashboard                                                  |
| `auth.probe`    | C     | `keys.files`, `net.health` | Signed `POST /api/v1/precheck` with empty payload; server validates signature; returns `auth: ok` and the public key's `role` matches expected (`ingest` / `admin`)                                                                                         | Public key in D1 doesn't match local private key. Re-provision keys and re-insert into D1.    |
| `catalog.bench` | D     | `auth.probe`               | Same precheck POST also includes the bench's `variants[]` (provider/model/api_model_id) + today's `pricing_version` + the `task_set_hash` bench will use. Server returns `missing_models`, `missing_pricing`, `task_set_current`. All must be empty / true. | Per-failure: `sync-catalog --apply` for catalog drift; SQL UPDATE for task-set current marker |

### Design choices

- **`catalog.bench` is bench-aware.** `doctor ingest` without `--llms` skips
  it (only validates auth-level health). Bench's auto-call always passes its
  actual `variants[]` + `pricing_version` + `task_set_hash`, catching
  tonight's exact failure modes for the actual run that's about to start.
- **`clock.skew`** is cheap and signed-payload auth depends on it — worth
  detecting before it bites.
- **Dependency-skip avoids cascade failures.** If `cfg.present` fails,
  downstream auth/catalog checks come back as `skipped` (not `failed`),
  keeping the report readable.
- **`--repair` allowlist.** Auto-repair is opt-in via `--repair` and limited
  to:
  - `catalog.bench.missing_models` and `catalog.bench.missing_pricing` →
    `sync-catalog --apply`
  - `task_set_current=false` AND exactly one task-set row for the current
    hash → mark current via admin API (TODO: needs admin endpoint, see Open
    Questions)
  - Anything else (missing keys, missing config, auth mismatch, clock skew)
    is **not** auto-repairable.
- **Worker-side check is read-only.** `POST /api/v1/precheck` does not write
  to D1. Asserted in worker test by spying D1 prepare calls.

## Data shapes

### `src/doctor/types.ts`

```ts
export type CheckLevel = "A" | "B" | "C" | "D";
export type CheckStatus = "passed" | "failed" | "warning" | "skipped";

export interface CheckResult {
  id: string; // e.g. "auth.probe"
  level: CheckLevel;
  status: CheckStatus;
  message: string; // one-line human summary
  remediation?: {
    summary: string; // human "what to do"
    command?: string; // exact copy-paste cmd, when applicable
    autoRepairable: boolean;
  };
  details?: Record<string, unknown>; // structured payload (e.g. missing_models[])
  durationMs: number;
}

export interface DoctorReport {
  schemaVersion: 1;
  section: "ingest" | "containers" | "llm" | "all";
  generatedAt: string; // ISO
  ok: boolean; // false if any failed (warnings allowed)
  checks: CheckResult[];
  summary: { passed: number; failed: number; warning: number; skipped: number };
}
```

### Worker endpoint contract

```
POST /api/v1/precheck

Body: {
  version: 1,
  signature: { alg: "Ed25519", key_id, signed_at, value },
  payload: {
    machine_id: string,
    variants?: Array<{ slug, api_model_id, family_slug }>,
    pricing_version?: string,
    task_set_hash?: string
  }
}

200 OK:
{
  schema_version: 1,
  auth: { ok: true, key_role: "ingest" | "admin", key_id: number, key_active: bool },
  catalog?: {
    missing_models: Array<{ slug, reason }>,
    missing_pricing: Array<{ slug, pricing_version }>,
    task_set_current: boolean,
    task_set_known: boolean
  },
  server_time: string  // ISO; client uses for clock-skew check
}

401: signature invalid
410: key revoked

Read-only: never writes to D1.
```

## CLI surfaces

### `centralgauge doctor ingest [--llms <list>] [--json] [--levels A,B,C,D] [--repair]`

```
$ centralgauge doctor ingest --llms anthropic/claude-opus-4-7,openai/gpt-5

[doctor: ingest]                                          0.8s
  ✓ cfg.present       ingest config loaded               (3ms)
  ✓ cfg.admin         admin_key_id=4 configured          (1ms)
  ✓ keys.files        ingest + admin keys 32B each       (4ms)
  ✓ catalog.local     models.yml + pricing.yml ok        (12ms)
  ✓ clock.skew        2.1s                               (1ms)
  ✓ net.health        200 in 187ms                       (190ms)
  ✓ auth.probe        key_id=3 role=ingest               (304ms)
  ✗ catalog.bench     pricing missing for openai/gpt-5
                      → run: deno task start sync-catalog --apply

7/8 passed, 1 failed.  exit 1
```

`--json` emits the `DoctorReport` directly. `--repair` runs the auto-repair
allowlist when applicable, then re-runs the failed check.

### Bench integration

Auto-precheck at startup (after config + variant resolution, before LLM
calls):

```ts
if (options.ingest !== false) {
  const report = await runDoctor({
    section: "ingest",
    variants,
    pricingVersion: todayPricingVersion(),
    tasksDir: `${cwd}/tasks`,
    repair: options.repair ?? false,
  });
  if (!report.ok) {
    formatReportToTerminal(report);
    console.error(colors.red(
      "\n[FAIL] ingest precheck failed — bench aborted. " +
        "Fix above or pass --no-ingest to skip ingest entirely.",
    ));
    Deno.exit(1);
  }
}
```

Pre-ingest re-check (after all runs complete, before
`ingestBenchResults()`):

```ts
if (options.ingest !== false) {
  const recheck = await runDoctor({
    section: "ingest",
    levels: ["B", "C"], // skip static + catalog (already validated at start)
    variants,
    pricingVersion,
    tasksDir,
    repair: false, // never auto-repair pre-ingest
  });
  if (!recheck.ok) {
    console.warn(colors.yellow(
      `[WARN] pre-ingest re-check failed; results saved to ${
        resultFilePaths.join(", ")
      }.`,
    ));
    console.warn(colors.gray(
      `       Replay later: deno task start ingest <path> --yes`,
    ));
    return; // skip ingest, exit cleanly with results on disk
  }
}
```

### `--no-ingest` semantics

If user passes `--no-ingest`, **the precheck is skipped entirely**. The flag
means "I'm explicitly opting out of ingest, don't validate it either." There
is no `--skip-precheck` flag.

## File layout

```
src/doctor/
  types.ts                     # CheckLevel, CheckResult, DoctorReport
  engine.ts                    # runDoctor(opts) — composes + executes checks
  formatter.ts                 # formatReportToTerminal, formatReportAsJson
  repair.ts                    # auto-repair allowlist + executors
  sections/
    ingest/
      mod.ts                   # ingestSection: Section
      check-cfg-present.ts
      check-cfg-admin.ts
      check-keys-files.ts
      check-catalog-local.ts
      check-clock-skew.ts
      check-net-health.ts
      check-auth-probe.ts
      check-catalog-bench.ts
    containers/                # future: doctor containers (bccch pin, container reachability)
    llm/                       # future: doctor llm (provider auth, model availability)

cli/commands/
  doctor-command.ts            # CLI surface

tests/unit/doctor/
  engine.test.ts               # composition, dependency skip, repair flow
  sections/ingest/
    *.test.ts                  # one per check, with mocked Deno.stat / fetch
  formatter.test.ts            # snapshot the terminal + JSON output

tests/integration/doctor/
  ingest-against-prod.test.ts  # opt-in (env DOCTOR_E2E_PROD=1); hits real worker

site/src/routes/api/v1/precheck/+server.ts
site/tests/api/precheck.test.ts                 # worker unit test
```

## Testing strategy

| Layer                       | Approach                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Per-check unit tests**    | Each check pure given `DoctorContext` (config, fetch fn, fs fn). Inject mocks. Snapshot the `CheckResult`.            |
| **Engine composition test** | Three fake checks (one fails, one depends on it, one independent). Verify dependency-skip and the `summary` counters. |
| **Repair test**             | Mock `sync-catalog` exec; assert it's invoked with right args and the `catalog.bench` re-check re-passes.             |
| **Formatter snapshot**      | Lock terminal output and `--json` shape so changes are explicit.                                                      |
| **Worker endpoint test**    | Mirror existing patterns (signed-envelope auth, D1 mocks). Spy D1 prepare to assert read-only.                        |
| **Real-prod E2E**           | `DOCTOR_E2E_PROD=1 deno test tests/integration/doctor/`. Opt-in; CI runs nightly, not per-PR.                         |

## Migration / rollout

1. Land worker endpoint + tests first (additive, no client changes).
2. Land engine + ingest section + CLI command (`centralgauge doctor ingest`)
   — usable standalone, doesn't change bench yet.
3. Wire bench-startup precheck behind a `CENTRALGAUGE_BENCH_PRECHECK=1` env
   flag for one bench cycle to validate it doesn't false-positive.
4. Flip default to on; gate skipping behind `--no-ingest`.
5. Implement `--repair` allowlist (sync-catalog + mark-current).
6. Add `doctor containers` and `doctor llm` sections in future PRs (out of
   scope for this design).

## Open questions

- **Mark-current admin endpoint.** The auto-repair "mark task-set current"
  step needs an admin API surface. Today `task_sets.is_current` is set via
  raw SQL only. We'll need either:
  (a) a new `POST /api/v1/admin/catalog/task-sets/[hash]/current`
  authenticated by admin key, or
  (b) extend the existing `POST /api/v1/admin/catalog/task-sets` to accept
  a `set_current: true` flag.
  Decide during plan-writing.

- **Clock-skew tolerance.** Server's `signed_at` validation window is
  currently TBD — need to read the existing signature verifier to determine
  the actual tolerance and align the precheck threshold with it.

- **Multi-account scoping.** Today, `key_id` uniquely identifies a
  machine_keys row regardless of `machine_id`. The auth probe should also
  verify the row's `machine_id` matches the local config's `machine_id` so a
  user accidentally pointed at someone else's machine_id is caught early.

## Estimated cost

| Item                                 | LoC est.  |
| ------------------------------------ | --------- |
| Worker endpoint + tests              | ~150      |
| Engine + types + formatter           | ~250      |
| Ingest section (8 checks + tests)    | ~600      |
| CLI command                          | ~80       |
| Bench integration + tests            | ~120      |
| Auto-repair (`--repair`) + allowlist | ~150      |
| **Total**                            | **~1350** |
