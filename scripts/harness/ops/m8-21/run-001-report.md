# M8-21 run 001 report: freeze qualification (lane ops)

2026-11-14 to 2026-11-17. Task commit (M8-20) 2fb244fef52548979754541f471d44d089f3d3f3, harness d32bb274, lineage
golden-o09-v2, env_fp 2552e6986e78. Full record: `H:\Temp3\harness-spike\M8\freeze\pipeline.md`. Ops notes and logs:
`H:\cg-coord\tasks\M8-21\ops\` (`deviations-step3.md`, `gates-Cronus28N.log`, `qualify-*.log`, `step2-validate.log`,
`step4.tsv`, `m821-step4.ts`).

## Outputs

| File | sha256 |
| --- | --- |
| `H:\Temp3\harness-spike\M8\freeze\task-set.json` | 3d48fbd50fbb067398b95f2b607f37a9fc27d26afb4154350fe07ca64c3c225c |
| `H:\Temp3\harness-spike\M8\freeze\pipeline.md` | 79f7226af352ea986273839d24674356d8969e926dfcaf3508dd1b57c76cbc91 |

## Steps

1. **Re-gate.** 43 tasks at `--rev 2fb244fe`: every latest promoted report has `.source_commit` 2fb244fe,
   `tag_status: match`, `promoted: true`.
2. **Identity.** `[OK] 152 tasks, task set 098ffb70afae` (not provisional).
3. **Real pipeline.** Three qualify indexes over the frozen manifest e01239c17e42... (200 variants):

   | Part | Manifest / index sha256 | Container | Variants | Result |
   | --- | --- | --- | --- | --- |
   | front | 52086e5c0956... | Cronus281 | 114 | 114/114 as expected, EXIT 0 09:18:18Z |
   | b1 | 1f581c84904edd7e00ba6b5ee3ff2fe362547624d62c7a1cf156b44aa280b34b | Cronus281 | 42 | 42/42, EXIT 0 19:10:35Z |
   | b2 | 3a0457e34fa6e43e31ceafaa6b7260113cb96b078728d82004a86c17eda0026d | Cronus282 | 44 | 44/44, EXIT 0 18:31:55Z |

   `verify-indexes.ps1`: ACCEPTED, 0 bad each, union 200 of 200 e01239c1 variants, 0 uncovered, 0 extra, one
   harness_commit (d32bb274), lineage and env_fp in all three. Re-run by the orchestrator with the same result.
4. **New-requirement rows.** `[OK] 43 tasks, 0 differ` against the sealed `partial_credit.weights` keys.
5. **Freeze record.** `task-set.json`: n 39, 39 confirmatory + 4 held-out (43 tasks), 7 seals, `excluded_experiments`
   v2-screen-1..5, r1, r2, 200 pipeline rows with 0 verdict mismatches. Acceptance (bound form, deviation 11):
   `jq -e '. as $r | [.tasks[] | select(.promoted and ([.pipeline[] | select(.verdict != .expected)] | length == 0))] | length == ($r.confirmatory | length) + ($r.held_out | length)'`
   prints `true`, exit 0.
6. **Hand-offs.** Held for the orchestrator: refapp-v2 push and the M11-17b binding wait on the owner's go; M9-12
   Step 4 and `graphify update .` after acceptance.

## Deviations

The full text is in `pipeline.md` (12 items) and `task-set.json` `deviations` (14 strings). Short list:

1. Step 1 HX-021: refapp publish_fail infra cell; Cronus283 recreated (owner); one rerun promoted.
2. Step 1 HX-059: refapp publish_fail, 4 cells never ran; Cronus281 recreated (owner); one rerun promoted.
3. Step 1 container restarts every 4 tasks; no verdict affected.
4. Step 3 run as three indexes (front, b1, b2) instead of one (decisions 2026-11-15 split, 2026-11-17 back resplit).
5. Step 3 results root `H:\cg-coord\results\harness`, not M8-16a (orchestrator 2026-11-15).
6. Step 3 harness refreeze at d32bb274 (decision 2026-11-16); task rev unchanged.
7. Step 3 Cronus282 recreated after a Windows Update L4 quarantine (decision 2026-11-17).
8. Step 3 resume did not apply (H-104 marker path bug); stopped parts judged again in full; fix filed as H-109.
9. N=39, not 40 (owner, decision 2026-11-14-n39-selection).
10. NST egress unenforced in golden-o09-v2; `--unverified-bc-egress-ok` under the owner grant, no models, no ingest,
    empty secrets dir.
11. Acceptance jq bound form: the plan form cannot exit 0 (jq parses `A | length == B` as `A | (length == B)`).
    Orchestrator approval 2026-11-17; plan file unedited.
12. `excluded_experiments`: screens 2 and 4 come from the store campaigns; the repo at 2fb244fe has yml files only
    for 1, 3, 5, r1 and r2.

## Container and lease end state

- Cronus281: stopped (exited 2026-11-17 19:18:28Z), ops lease released (holder null).
- Cronus282: stopped (exited 19:11:22Z), ops lease released (holder null).
- Cronus283: not touched by this run's end (left up for H-100 on 2026-11-15).
- No M8-21 lease, run row, stop bridge or hostwatch target remains.

## Scripts in this folder

Copies of the scripts that produced the evidence (originals in `H:\cg-coord\tasks\M8-21\ops\`): `run-qualify.sh`,
`run-qualify-front.sh`, `run-qualify-back.sh`, `run-qualify-b1.sh`, `run-qualify-b2.sh`, `launch-b1-b2.ps1`,
`verify-indexes.ps1`, `build-task-set.ps1`. No harness code changed.
