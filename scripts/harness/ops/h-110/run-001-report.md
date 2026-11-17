# H-110 run 001 report: M8-21 in-container slowdown (lane ops)

2026-11-17. Read-only, from existing records; no code change. Step 2 (controlled runs) was skipped on the
orchestrator's ruling once the cause was confirmed: no container run, no egress use, no baseline.

**Cause (owner confirmed 2026-11-17):** an interactive heavy desktop application (Wow.exe) ran on the host from
12:34:42Z to 16:30:52Z. While it ran, every container-side phase on both Cronus281 and Cronus282 took about 17%
longer; it recovered when the application closed, without any container restart. It is host contention, not state
building up inside the containers.

## Data

`phase-table.tsv` (built by `phase-table.ps1` from the M8-21 qualify verdict records): one row per verdict (213),
with the verdict spans (reconstruct, provisioning, compile, candidate publish, test, queue, total) and the summed
golden-restore reset phases (snapshot_guard, quiesce, verify_sha, stop, restore, start, healthy, runner_verify,
postconditions). Ids, kinds and timings only; no verdicts or outcomes. Host memory and processes come from the
memlog (`H:\cg-coord\jobs\W2-10\memlog\memlog-2026-11-17.log`, one sample per 15 s).

## Per-phase table

Test-authoring and naive variants of test-authoring tasks on b1 (Cronus281) and b2 (Cronus282), grouped by whether
the variant ran wholly before, wholly inside, or wholly after the Wow.exe window (4 variants straddling a boundary are
left out):

| Window | n | per reset (s) | publish per reset (s) | postconditions per reset (s) | wall per reset (s) | compile, naive-ta (s) | provisioning (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before (end <= 12:34:42Z) | 11 | 63.2 | 37.1 | 28.3 | 181.9 | 33.7 | 42.8 |
| inside (12:34:42-16:30:52Z) | 14 | 73.4 | 42.1 | 33.5 | 212.5 | 41.7 | 52.6 |
| after (start >= 16:30:52Z) | 3 | 62.4 | 37.6 | 28.6 | 181.5 | 37.7 | 47.9 |
| inside vs before | | +16.1% | +13.5% | +18.4% | **+16.8%** | +23.7% | +22.9% |

- Every phase grows together (reset steps, candidate publish, compile, provisioning), in step on both containers.
  No single phase is responsible, which points at shared host resources rather than one component.
- A test-authoring or naive-ta variant runs 8 or 9 golden-restore resets (one per mutant row) at about 63 s each,
  plus about 37 s of candidate publish per reset.

## Recovery without restart

b2 at 16:42Z ran a naive-ta variant in 23.06 min, the same as at 10:14Z (23.19 min), with no container restart
in between; b1 at 16:55Z was likewise back to 61.2 s per reset. Nothing accumulated inside the containers.

## Memory

Free RAM stayed at about 30 GB all day (window averages 29.9-35.4 GB, minimum 26.4 GB); commit about 89-101 GB.
Not memory pressure.

## Other host events checked

A Defender signature update (12:49Z) and Cronus28 stopping (12:32Z) fall near the start but do not explain the
recovery at 16:30Z; Defender's only scan ran 18:03-18:05Z, after the window. The memlog's top-process lists show
Wow.exe (3.5-11 GB) in 893 samples from 12:34:42Z to 16:30:52Z and in none before or after.

## b1 25 -> 33 min

b1's test-authoring variants went from about 25 min (09:49Z) to about 33 min (13:07Z, 15:52Z). That is task mix
plus the window: from 13:07Z its tasks have 9 mutant rows, so 9 resets instead of 8 (+1/8), and they ran inside the
window (+17%). 25 x 9/8 x 1.17 = 32.9 min.

## M12 implication

A heavy interactive application on the host adds about 17% to every container-side phase while it runs. For the
confirmatory runs, either keep the host quiet, or log the heavy-use windows (start, end) as a deviation so the
affected cells can be identified. It does not change verdicts here (every M8-21 verdict matched), only wall time.

Estimate for a 1376-cell campaign: the last two screening campaigns took about 12-15 container-minutes per cell
(v2-screen-r2: 48 cells in 4.7 h on 2 containers; v2-screen-r1: 48 cells in 6.1 h on 2 containers). 1376 cells x
about 13.5 min is about 310 container-hours, about 103 h (4.3 days) on 3 containers. If the host were busy the whole
time, that becomes about 120 h (+17.5 h). In general each hour of heavy host use during the campaign costs about
0.17 h of wall time, for example 4 h a day over 4.3 days adds about 3 h. This assumes campaign cells slow like
the container-side phases measured here; model API time inside a cell may not slow, so it is an upper bound.

## Files

`phase-table.ps1`, `phase-table.tsv` (copies; live in `H:\cg-coord\tasks\H-110\`).
