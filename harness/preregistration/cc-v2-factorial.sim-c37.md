# sim-c37: binding stage-B power simulation, 39-task design, effect 0.37 (H-92 run 001)

Owner ruling: decisions\2026-11-14-n39-prereg-amendment.md, "Owner ruling: effect 0.37". Run by lane-ops for
cg-orchestrator, host only.

## Decision

`decision: {design: {tasks: 39, repeats: 8}, confirmed: true}`. Zero-solve rule `suppress_any_undefined`,
design 39x8. Family C1, C2, C3, alpha 0.05, power gate `fitted`.

## Command

From `H:\cg-coord\jobs\h92-simc2` (HEAD 8a5aea8d, only change: staged `src/harness/prereg.ts` overlaid from
a1549249, blob 25eefcb3bfb39188a7bfb01f95bd4a1ce6ac121e):

```
MERGE=a1549249 PREREG_B=H:/cg-coord/tasks/H-92/sim-c37/prereg-b-input.yml bash /h/cg-coord/tasks/H-97/run-001/run-sim-c37.sh
```

The script guards HEAD, porcelain and the prereg.ts blob, checks the stage-B document carries the approved
simulation amendment (effect 0.37, grid 39 x 3,5,8, one `simulation` amendment), then runs:

```
deno run --allow-read --allow-write scripts/harness/power-sim.ts --prereg "$PREREG_B" \
  --cells <10 reports below> --fit-tasks 'H:\cg-coord\tasks\H-92\sim-c\fit-tasks.json' \
  --arm-prefix cc- --rules harness-tasks/v2/screening.yml --grid 39x3,5,8 \
  --out 'H:\cg-coord\tasks\H-92\sim-c37\cc-v2-factorial.sim-c37.json' --resume
```

Args recorded in the output: sims 1000, resamples 1000, confirm_sims 600, confirm_resamples 10000,
seed 20261003, pool_factor 3, rule_b_share 0.99, effect 0.37, power_gate fitted, grid {tasks [39], repeats [3,5,8]}.

## Inputs (sha256)

| Input | sha256 |
| --- | --- |
| scripts/harness/power-sim.ts (script_sha256) | bc4a1c466e718b4ebe5f1b64e132311f01af933f72c0edf52fe5253831798d55 |
| run-sim-c37.sh (H-97 run-001, unedited) | 590cba8a2d8c1d870b688f42e6c8f52f543849c5fe6aac63e1572438ef4280c8 |
| src/harness/prereg.ts overlay at a1549249 (git blob) | 25eefcb3bfb39188a7bfb01f95bd4a1ce6ac121e |
| prereg-b-input.yml (stage-B document) | dbc3634598e641ff2d16e4738175e65bad7fd83f1a76cadad7963fe85bcb1702 |
| sim-c\fit-tasks.json | 1718b496d6cf2e561eaf1e96ca247263b1653c77cd4bddd5f2fd647c46e9e4b7 |
| harness-tasks/v2/screening.yml (rules) | 77c6a835f12fa1d0404e483083f22d59d753f362ed37235ee49a92ac4c98bb92 |
| m6/reports/cc-mcp-vs-plain.campaign.json | 9dce74d0ac23cfe756495910c72a0ec39c496432cec2de0603f86e6f841eae74 |
| m6/reports/cc-skills-vs-plain.campaign.json | b99b8ad8617732a79417d6c5712fbcbb587c0a9d14daf6b4590fe431362d2432 |
| m6/reports/cc-vs-pi.campaign.json | 6c79ac6ede55efab98423dafdd5f37dc3ba614eb5aba6a6cff486f7fc12d585c |
| tasks/M8-16a/report-v2-screen-1.json | 3dd192b9d2c0f39415308c1747494869e8a11f2ddc424efbb8c6029b4845f6b6 |
| jobs/M8-16b/report-final.json | 930262d064d3efcaffb957c8e292c9a829d3bb6d9dfb2e12857e343734a10e62 |
| tasks/H-92/cells/screen-3-report.json | ba8f1fd5afcd333c6950834da064a497444bcb46cabfb3030c1531f48366830b |
| jobs/W2-12/screen-4-report.json | 343e214d1358ab7ac611cc6494b94513da826dc101ad61c1a32e62205edeb78e |
| tasks/W2-19/screen-5-report.json | 8b3bc0e6498b282caad355fc98202b6fccdfdeef1a4955345fe7ade89e9d386d |
| tasks/M8-18/screen-r1-report.json | f11a0ac5d87f82f938ecc1c3542dec99812bd02626d6bba6b61d0018c605b64e |
| tasks/M8-18b/screen-r2-report.json | 0f9ad6da3da2e6a64f5c2f4a5f95c81f96f886f436ef5a756467d18f621e513b |

Output: cc-v2-factorial.sim-c37.json sha256 1ba43716d4dccbfb0b5fbdb77c8629a3c5671b0739b0857128e77693142ac24e.

## Wall time

START 2026-11-14T21:27:05Z, EXIT 0 2026-11-15T01:18:33Z: 3 h 51 min 28 s. Host free RAM watched by simwatch
(12 GB floor), never tripped. The expected `[WARN] --grid given in stage B: a provisional run, not the frozen
pipeline` line was logged at start.

## Search grid (fitted, power A / fwer A)

| Design | C1 spend | C1 solve | C2 spend | C2 solve | C3 spend | C3 solve |
| --- | --- | --- | --- | --- | --- | --- |
| 39x3 | 0.56 / 0.030 | 0.64 / 0.032 | 0.57 / 0.048 | 0.61 / 0.037 | 0.56 / 0.059 | 0.59 / 0.046 |
| 39x5 | 0.72 / 0.040 | 0.76 / 0.041 | 0.72 / 0.028 | 0.74 / 0.037 | 0.72 / 0.033 | 0.75 / 0.034 |
| 39x8 | 0.81 / 0.035 | 0.81 / 0.035 | 0.82 / 0.039 | 0.80 / 0.028 | 0.82 / 0.043 | 0.82 / 0.030 |

## Confirmation at 39x8 (exact; gated scenario: fitted)

Power A (se) and fwer A per contrast; power B equals power A on every line. Suppression A is 0.000 on every line.

| Contrast | Metric | Power | fwer | Coverage |
| --- | --- | --- | --- | --- |
| null | spend | n/a | 0.045 | 0.942 |
| C1 | spend | 0.81 (0.016) | 0.038 | 0.942 |
| C1 | solve | 0.81 (0.016) | 0.038 | 0.943 |
| C2 | spend | 0.83 (0.015) | 0.037 | 0.942 |
| C2 | solve | 0.84 (0.015) | 0.029 | 0.941 |
| C3 | spend | 0.82 (0.016) | 0.038 | 0.942 |
| C3 | solve | 0.84 (0.015) | 0.032 | 0.954 |

Every gated contrast is at or above 0.8; fwer at or below alpha on every line.

## Ungated scenarios at 39x8 (exact, reported only)

Power A (se) / fwer A.

| Contrast | Metric | stress | skew | arm_missing | hetero |
| --- | --- | --- | --- | --- | --- |
| null | spend | n/a / 0.058 | n/a / 0.030 | n/a / 0.043 | n/a / 0.028 |
| C1 | spend | 0.29 (0.019) / 0.050 | 0.50 (0.020) / 0.028 | 0.81 (0.016) / 0.042 | 0.82 (0.016) / 0.033 |
| C1 | solve | 0.30 (0.019) / 0.048 | 0.50 (0.020) / 0.028 | 0.81 (0.016) / 0.042 | 0.83 (0.015) / 0.035 |
| C2 | spend | 0.28 (0.018) / 0.047 | 0.53 (0.020) / 0.020 | 0.82 (0.016) / 0.037 | 0.81 (0.016) / 0.027 |
| C2 | solve | 0.29 (0.019) / 0.022 | 0.52 (0.020) / 0.037 | 0.83 (0.015) / 0.032 | 0.79 (0.017) / 0.035 |
| C3 | spend | 0.26 (0.018) / 0.040 | 0.51 (0.020) / 0.027 | 0.82 (0.016) / 0.040 | 0.82 (0.016) / 0.035 |
| C3 | solve | 0.27 (0.018) / 0.024 | 0.49 (0.021) / 0.039 | 0.83 (0.016) / 0.027 | 0.80 (0.016) / 0.042 |

The null stress line's fwer 0.058 is the only fwer above alpha, in an ungated scenario.

## Attempt 1 (backslash bug)

Attempt 1 passed `PREREG_B='H:\cg-coord\tasks\H-92\sim-c37\prereg-b-input.yml'`. run-sim-c37.sh interpolates
`$PREREG_B` into a single-quoted JS string inside its `deno eval` guard, so the backslashes were read as escapes
(`\t` became a tab) and the guard exited 4 before any simulation:
`readfile 'H:cg-coord<TAB>asksH-92sim-c37prereg-b-input.yml'` (log: run-attempt1-backslash.log). The orchestrator
ruled: rerun with forward slashes, no other change, script unedited. Attempt 2 (this run) used
`PREREG_B=H:/cg-coord/tasks/H-92/sim-c37/prereg-b-input.yml`, the same file (sha256 above). The bug remains in
the script: any Windows-path PREREG_B with backslashes fails the guard.

Blinding: this record carries no fit parameters, arm_sd or arm offsets, and no per-arm or per-task breakdown.
