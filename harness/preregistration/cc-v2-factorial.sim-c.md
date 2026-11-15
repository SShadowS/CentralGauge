# sim-c: stage-B power simulation, 39-task design, effect 0.30 (H-92, record only)

Record of the first 39-task run at the frozen effect 0.30 (decisions\2026-11-14-n39-prereg-amendment.md item 2).
It found no design: `decision: {design: null, confirmed: false}`, `[WARN] no design meets the frozen rule: owner
amendment needed`. The owner then ruled effect 0.37; the binding run is sim-c37 (cc-v2-factorial.sim-c37.json).
This file is not a power_simulation input.

## Command

From `H:\cg-coord\jobs\h92-simc2` (HEAD 8a5aea8d, only change: `src/harness/prereg.ts` from 99de5db9, blob
8b49e80533d90f3435da3046da377372a14acdde), `bash H:\cg-coord\tasks\H-92\sim-c\run-sim-c.sh`, which runs:

```
deno run --allow-read --allow-write scripts/harness/power-sim.ts \
  --prereg harness/preregistration/cc-v2-factorial.yml \
  --cells <the same 10 reports as sim-c37> --fit-tasks 'H:\cg-coord\tasks\H-92\sim-c\fit-tasks.json' \
  --arm-prefix cc- --rules harness-tasks/v2/screening.yml --grid 39x3,5,8 \
  --out 'H:\cg-coord\tasks\H-92\sim-c\cc-v2-factorial.sim-c.json' --resume
```

Args recorded: sims 1000, resamples 1000, confirm_sims 600, confirm_resamples 10000, seed 20261003,
pool_factor 3, rule_b_share 0.99, effect 0.30, power_gate fitted, grid {tasks [39], repeats [3,5,8]}.

## Inputs (sha256)

| Input | sha256 |
| --- | --- |
| scripts/harness/power-sim.ts (script_sha256) | bc4a1c466e718b4ebe5f1b64e132311f01af933f72c0edf52fe5253831798d55 |
| run-sim-c.sh | 7dc14de7f8b458137ced4b4aa4448a9c11fa3391d182e8cddeba08c223543f5b |
| harness/preregistration/cc-v2-factorial.yml (working tree at 8a5aea8d) | 745e1758f735e486ef4f6f782f14e2ce319733dc2ed0de9f4f9894bf98362eff |
| fit-tasks.json | 1718b496d6cf2e561eaf1e96ca247263b1653c77cd4bddd5f2fd647c46e9e4b7 |
| harness-tasks/v2/screening.yml | 77c6a835f12fa1d0404e483083f22d59d753f362ed37235ee49a92ac4c98bb92 |
| the 10 --cells reports | identical paths and sha256 to sim-c37.md (recorded in the json `inputs`) |

Output: cc-v2-factorial.sim-c.json sha256 8ea85fd17475a1a1e6bcafc107eae0332f4fb2340a8454d95c3510e4304b6c8e.

## Wall time

START 2026-11-14T18:35:38Z, EXIT 0 2026-11-14T18:46:28Z (10 min 50 s). No confirmation pass ran (no design met
the gate).

## Search grid (fitted, power A / fwer A)

| Design | C1 spend | C1 solve | C2 spend | C2 solve | C3 spend | C3 solve |
| --- | --- | --- | --- | --- | --- | --- |
| 39x3 | 0.34 / 0.027 | 0.41 / 0.029 | 0.35 / 0.046 | 0.38 / 0.043 | 0.35 / 0.057 | 0.37 / 0.045 |
| 39x5 | 0.47 / 0.036 | 0.52 / 0.038 | 0.49 / 0.026 | 0.49 / 0.034 | 0.49 / 0.032 | 0.48 / 0.042 |
| 39x8 | 0.60 / 0.033 | 0.61 / 0.033 | 0.61 / 0.038 | 0.60 / 0.036 | 0.59 / 0.042 | 0.59 / 0.037 |

Blinding: no fit parameters, arm_sd or arm offsets, and no per-arm or per-task breakdown.
