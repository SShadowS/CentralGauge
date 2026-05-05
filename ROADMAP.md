# CentralGauge Roadmap

Tracks not-yet-implemented work that doesn't fit a single PR.
Group by intent, not by date. Move items to a release note (or delete) once they ship.

## CLI

### `centralgauge task-set set-current <hash>`

**Why.** After ingesting runs against a new `task_sets.hash` (every edit
to AL test code, prereq apps, or support files produces a new hash),
the leaderboard still points at the previous hash because
`task_sets.is_current = 0` for the new row. Today the only ways to
flip are (a) raw SQL via `wrangler d1 execute` or (b) a hand-signed
POST to `/api/v1/admin/catalog/task-sets`. Both leak the admin key
flow into the operator's terminal and leave no audit trail in the
CLI.

**Shape.**

```bash
centralgauge task-set list                 # show hash, is_current, run counts
centralgauge task-set set-current <hash>   # signed POST with set_current: true
```

`list` reads `/api/v1/admin/catalog/task-sets` (or D1 directly via
ingest reader). `set-current` POSTs `{ hash, set_current: true,
task_count }` signed with the configured admin key, same path
already used by `sync-catalog --apply`.

**Acceptance.**

* Idempotent: running `set-current <hash>` against the already-current
  hash returns 200 with no DB change.
* Refuses to flip a hash with zero `runs` rows unless `--force` is
  passed (typo guard).
* Honors `CENTRALGAUGE_BENCH_PRECHECK=0` style env opt-out for CI.
* Documented in `docs/cli/commands.md`.

**Out of scope.** Auto-flipping during `bench` or `cycle` — operator
intent matters here, since flipping hides every run from the previous
hash.
