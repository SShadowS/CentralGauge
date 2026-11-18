# M12-08 run 001: launch kit and dry runs (lane ops, 2026-11-18)

Kit: `H:\cg-coord\tasks\M12-08\run.sh`, copied here. Logs: `dry-cc-v2-smoke.log` and `dry-cc-v2-factorial.log`.
Campaign checkout: `H:\cg-coord\jobs\M12-run` at 82f30dac (master, includes M12-02, H-115 and M12-03b), clean.
`run.sh` refuses any other HEAD (`CAMPAIGN_COMMIT`).

## Step 1: run.sh, diff against tasks\M8-18b\run.sh

| M8-18b | M12-08 | Reason |
| --- | --- | --- |
| `run.sh <exp> <dry\|full> [extra args]` | `run.sh <exp> <dry\|full\|resume> [campaign id]`; no pass-through args | plan; nothing can slip in a `--add-accounts-reason` (D-3: no label added on a resume) |
| experiments v2-screen-r2/r2b | cc-v2-smoke, cc-v2-factorial | plan |
| `POOL=${POOL:-281 283}` | fixed `281 282 283` | D-4 |
| `--concurrency "$n"` (pool size) | `CONC=fixed` (default) -> `--concurrency 3`; `CONC=dynamic` -> `--concurrency 2 --concurrency-max 4 --admit-free-gib 30` | D-4 and task.md: both forms behind one switch. The dynamic flag names are H-114b's and must be confirmed when it lands. Until then the harness refuses them as unknown options. The plan's `--concurrency 2` is superseded by D-4 |
| stops.sh from jobs\M8-18b; `stop_args "$T\\STOP"`; no count check | stops.sh from jobs\M12-run; `stop_args "$T\\STOP-$exp"`; count check (10 = 5 `--stop-file` pairs) | plan |
| results `jobs\M8-16a\results\harness` | `H:\cg-coord\results\harness` | plan |
| private `m8\screening-m8-18b\private` | `m12\private-<exp>` | plan |
| backend port 3240 | 3270 | unused by any task script (3210 default, 3224-3261 taken) |
| secrets max, maxpriv2 | max, maxpriv, maxpriv2 | D-3 (decisions\2026-11-18-m12-credential-limit-and-pool.md) |
| lineage golden-o09-v2 | golden-o09-v3 | D-5 (c), M12-06 deviation 3 (the plan text still says v2) |
| BC egress reason (M8-18b grant) | exact text of decisions/2026-11-17-egress-grant-m12.md | D-2 |
| sandbox egress reason (M8-18b grant) | exact text of decisions/2026-11-18-m12-concurrency-and-sandbox-egress.md | D-2 |
| (none) | factorial: `--prereg-decision` (stage A, 2026-10-17) and `--prereg-b-decision` (stage B, 2026-11-17) | plan |
| full: leases + `--max-pause-min 120` | same; resume adds `--campaign <id>` | plan |
| (none) | full and resume refuse unless `stops_clear` on the prefix | stops.sh rule (a resume chain refuses on an active stop) |
| (none) | full on cc-v2-factorial refuses when a campaign record names `"cc-v2-factorial"` | plan |
| lease token `jq -r .token`, `exit 3` only on a jq failure | also refuses an empty or `null` token | a missing lease must not pass as `Cronus28x=null` |
| HEAD check: branch harness/lane-ops-m8-18b, clean | detached HEAD must be `CAMPAIGN_COMMIT`, clean | plan ("at the campaign commit, clean") |
| (none) | `START <ts> <exp> <mode> CONC=<form> HEAD <sha>` and `EXIT <rc> <ts>` | plan (as the M8-21 scripts) |

Container starts are not part of `run.sh`: leases and starts come before it. The M12-06 probe finding (probe from a fresh process before declaring a start failed) is written in the header for M12-10.

Refusal checks, all refused with the stated message: an unknown experiment; resume without an id; dry with an id; an unknown mode; `CONC=x`; `full` with no lease file (`no ops lease for Cronus281`).

## Step 2: smoke dry run [OK]

`bash run.sh cc-v2-smoke dry` returned EXIT 0 with no refusal. Output: `16 cells in a new campaign; nothing written`. There were 4 blocks (HX-007#1, HX-008#1, HX-007#2, HX-008#2), assigned to accounts in the order max, maxpriv, maxpriv2, max. All four arms resolve to `centralgauge/harness-claude-code:latest-r3`, which is id 0a874646... per M12-06 Step 2.

## Step 3: factorial dry run [OK]

`bash run.sh cc-v2-factorial dry` returned EXIT 0 with no pre-registration refusal. Output: `1376 cells in a new campaign; nothing written`. There were 344 block lines across 43 tasks, assigned to accounts as max 115, maxpriv 115 and maxpriv2 114. All four arms were on `latest-r3`. Before and after the run, `campaigns\*.json` held 14 records, and `grep -l '"cc-v2-factorial"'` printed nothing (rc 1). `m12\private-cc-v2-factorial` was not created.

The dry-run estimate line reads `total unknown at concurrency 1` even with `--concurrency 3`. The per-arm estimates come from 6 earlier samples for plain (19.4 min) and realistic-lsp (708.0 min/cell). That realistic-lsp figure is far above the M12 budget and looks like non-comparable prior executions. It is noted here for M12-09; the smoke run measures the real figure.

## Step 4: hostwatch registry [open: priority from the orchestrator]

`jobs\W2-10\hostwatch\targets.tsv` has no targets now. The two prefixes to add are `H:\cg-coord\tasks\M12-08\STOP-cc-v2-smoke` and `H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial`. Registering a prefix before its run starts has a side effect: a host-low or host-all stop written while the run is idle makes `run.sh full` refuse until that stop is renamed `.cleared-<stamp>`. The proposal is to add each line when its run starts (M12-09 for the smoke, M12-10 for the factorial), with the priority the orchestrator gives.
