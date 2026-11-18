# M12-08 run 001: launch kit and dry runs (lane ops, 2026-11-18)

Kit: `H:\cg-coord\tasks\M12-08\run.sh`, `progress.sh` and `progress.jq`, copied here.
Campaign checkout: `H:\cg-coord\jobs\M12-run` at **0936645c** (master: M12-02, H-115, M12-03b, H-114b), clean.
`run.sh` refuses any other HEAD (`CAMPAIGN_COMMIT`).
Records from 0936645c on carry `load`, so progress, report and resume all run from this commit (orchestrator ruling).

Logs:

- At 0936645c (the dry runs of record): `dry-<exp>-<fixed|dynamic>-0936645c.log`, all four EXIT 0.
- At 82f30dac (first pass, superseded): `dry-cc-v2-smoke.log` and `dry-cc-v2-factorial.log`.

## Step 1: run.sh, diff against tasks\M8-18b\run.sh

| M8-18b | M12-08 | Reason |
| --- | --- | --- |
| `run.sh <exp> <dry\|full> [extra args]` | `run.sh <exp> <dry\|full\|resume> [campaign id]`; no pass-through args | plan; nothing can slip in a `--add-accounts-reason` (D-3: no label added on a resume) |
| experiments v2-screen-r2/r2b | cc-v2-smoke, cc-v2-factorial | plan |
| `POOL=${POOL:-281 283}` | fixed `281 282 283` | D-4 |
| `--concurrency "$n"` (pool size) | `CONC=fixed` (default) -> `--concurrency 3`; `CONC=dynamic` -> `--concurrency 2 --concurrency-max 4 --admit-free-gib 30` | D-4 and task.md: both forms behind one switch. The flag names are confirmed against H-114b (495f6fa8, `cli/commands/harness-command.ts` `--concurrency-max <n:integer>`, `--admit-free-gib <n:number>`), and the dynamic dry runs accept them. The plan's `--concurrency 2` is superseded by D-4 |
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

## Re-run at 0936645c [OK]

Both experiments were run with `CONC=fixed` and with `CONC=dynamic`, at 06:45Z on 2026-11-18. All four runs:

- printed `START ... HEAD 0936645c` and `EXIT 0`, with no refusal;
- planned the same cells as at 82f30dac: smoke `16 cells in a new campaign; nothing written`, factorial `1376 cells`;
- used `latest-r3` on all four arms.

The dynamic runs print `concurrency 2..4: above 2, a block is admitted at >= 30 GiB free (hold 5 min, settle 5 min)`.
Afterwards there were still 14 campaign records, none naming `"cc-v2-factorial"`, and no `m12\private-*` directory.
Steps 2 and 3 below record the first pass at 82f30dac.

## M12-11 blinding allow-list: pooled `load` added

The M12-11 Step 2 projection is now a kit file, `progress.jq`. `progress.sh <exp> <campaign id>` runs it from M12-run.
It is the plan's projection plus the key `load`.
`load` is H-114b's pooled block `{executions, by_cells_in_flight, min_free_ram_gib}`, never split by arm, and absent until an execution records one.

A check on synthetic JSON that included `pass_cells`, `fail_cells` and per-arm `cost_usd` and `pass`:

- None of those came through.
- `load` was kept.
- The cost came through only as the pooled `cost_total`.

No real campaign was projected.

## Step 2: smoke dry run [OK]

`bash run.sh cc-v2-smoke dry` returned EXIT 0 with no refusal. Output: `16 cells in a new campaign; nothing written`. There were 4 blocks (HX-007#1, HX-008#1, HX-007#2, HX-008#2), assigned to accounts in the order max, maxpriv, maxpriv2, max. All four arms resolve to `centralgauge/harness-claude-code:latest-r3`, which is id 0a874646... per M12-06 Step 2.

## Step 3: factorial dry run [OK]

`bash run.sh cc-v2-factorial dry` returned EXIT 0 with no pre-registration refusal. Output: `1376 cells in a new campaign; nothing written`. There were 344 block lines across 43 tasks, assigned to accounts as max 115, maxpriv 115 and maxpriv2 114. All four arms were on `latest-r3`. Before and after the run, `campaigns\*.json` held 14 records, and `grep -l '"cc-v2-factorial"'` printed nothing (rc 1). `m12\private-cc-v2-factorial` was not created.

Two problems with the dry-run estimator, unchanged at 0936645c:

- The total line reads `total unknown at concurrency 1` with `--concurrency 3` and also with the dynamic form. The estimator ignores the concurrency flag.
- The per-arm estimates come from 6 earlier samples: plain 19.4 min/cell and realistic-lsp 708.0 min/cell. The realistic-lsp figure gives 4059 h for 344 cells. It is far above the M12 budget and looks like non-comparable prior executions.

The orchestrator ruled that both are only noted. The M12-09 smoke run measures the real figures.

## Step 4: hostwatch registry [ruled: register at launch]

Orchestrator ruling: each prefix is added to `jobs\W2-10\hostwatch\targets.tsv` when its run starts, not now.
A host-low stop written while a run is idle would otherwise make `run.sh full` refuse.

| Run | Line to add at launch | Removal |
| --- | --- | --- |
| M12-09 smoke | `H:\cg-coord\tasks\M12-08\STOP-cc-v2-smoke	1` | taken off once the smoke run prints `EXIT` |
| M12-10 factorial | `H:\cg-coord\tasks\M12-08\STOP-cc-v2-factorial	1` | stays for the whole campaign |

Both lines get priority 1, because nothing else runs during M12. `targets.tsv` is unchanged by this task.

D-6 is log only. HOST-BUSY windows are logged as Operational rows and do not pause the run. Protocol: `H:\cg-coord\m12\protocol.md`. Deviations: `H:\cg-coord\m12\deviations.md`.
