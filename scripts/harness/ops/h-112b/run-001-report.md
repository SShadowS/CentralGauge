# H-112b run 001 report: golden-o09-v3 baselines on Cronus281-283 (lane ops)

2026-11-17. Lineage `infra\harness-reset\lineages\golden-o09-v3.json` (H-112, master 7cf16d4d). Harness from the
clean worktree `H:\cg-coord\jobs\W2-05-gates`, detached at 7cf16d4d. Script: `run-baselines.ps1`; full log:
`run-baselines.log` (lease tokens never logged).

**Result: one admissible v3 env_fp on all three containers, b9ba30b0855c.** No quarantine record; all three Exited;
every lease released (coord holder null).

## Commands (per container, one at a time, >= 18 GB free, ops lease)

```
deno task start harness baseline create <c> --lineage infra\harness-reset\lineages\golden-o09-v3.json \
  --symbol-store H:\cg-coord\jobs\M8-16a\results\harness\symbols --results-dir H:\cg-coord\results\harness
deno task start harness env check --lineage infra\harness-reset\lineages\golden-o09-v3.json --containers <c> \
  --symbol-store H:\cg-coord\jobs\M8-16a\results\harness\symbols --results-dir H:\cg-coord\results\harness \
  --unverified-bc-egress-ok "owner grant decisions/2026-11-17-egress-grant-m12.md: M12 setup, smoke and confirmatory campaign, no ingest, NST egress unenforced in golden-o09-v3 (disclosed)"
```

## Results (UTC)

| Container | Lease (attempt) | Baseline started / up / created | Baseline output | Env check | Env check output |
| --- | --- | --- | --- | --- | --- |
| Cronus281 | 225, then for the env check a new lease | 22:20:05 / 22:24:35 / 22:26:05 | [OK] baseline of golden-o09-v3, env_fp b9ba30b0855c | 22:32:55 | [OK] Cronus281 env_fp b9ba30b0855c (baseline 22:26:05.194Z) |
| Cronus282 | 149, then a new lease | 22:27:52 / 22:28:23 / 22:29:33 | [OK] baseline of golden-o09-v3, env_fp b9ba30b0855c | 22:33:42 | [OK] Cronus282 env_fp b9ba30b0855c (baseline 22:29:33.390Z) |
| Cronus283 | new lease | about 22:30 / - / 22:31:30 | [OK] baseline of golden-o09-v3, env_fp b9ba30b0855c | 22:34:29 | [OK] Cronus283 env_fp b9ba30b0855c (baseline 22:31:30.670Z) |

Each container was stopped right after its step and its lease released (log lines "stopped (rc 0)" and "lease
released"); the last one stopped at 22:34:36Z.

## Course of the run

1. 22:20Z, all three with baseline and env check: 281's baseline was [OK], its env check failed with "[FAIL] NST
   egress is unenforced in this lineage: declare it with --unverified-bc-egress-ok <reason>". The script stopped
   there by design (281 stopped, lease released). The M8-21 grant's text was not reused; the orchestrator asked
   the owner.
2. 22:27Z, baseline only (`-SkipEnvCheck`) on 282 and 283, on the orchestrator's go: the first launch passed
   "Cronus282,Cronus283" to `pwsh -File` as one string, so the lease request failed and nothing was leased or
   started; the script now splits on commas. The re-run baselined both.
3. 22:32Z, env check only (`-EnvOnly`) on all three with the owner grant `decisions/2026-11-17-egress-grant-m12.md`
   (owner-approved 23:15Z per the file) and its exact reason text: all [OK], one env_fp.

The v2 env_fp was 2552e6986e78; v3's is b9ba30b0855c, as expected (env_fp hashes the whole lineage).
