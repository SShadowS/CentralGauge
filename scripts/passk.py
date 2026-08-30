#!/usr/bin/env python3
"""pass^k over repeated independent trials - the BC-Bench-comparable metric.

`pass@k` asks whether ANY of k attempts succeeded. `pass^k` asks whether ALL k
did. It is the strictness convention Microsoft publishes for BC-Bench (their
top model: 69.1% mean per run, 49.5% pass^5 on the same 101 tasks), so
reporting it makes our headline directly comparable rather than a metric
invented to hit a target.

It is also the one lever that tightens the headline WITHOUT authoring a task,
and the one that can restore separability where selection destroys it: models
that match on accuracy can still differ sharply in consistency.

Two outcome levels are reported per trial, because our runs allow two attempts:
  first_try  - the attempt-1 solve, contract-robust (the changed-objects A/B
               moved it by +6pp, p = 0.73)
  solved     - best-of-2, which the response contract DOES move

Usage:
    python scripts/passk.py results/benchmark-results-*.json
    python scripts/passk.py --subset X067,X074,... results/*.json
"""

from __future__ import annotations

import argparse
import collections
import glob
import json


def load_trial(path: str) -> dict[tuple[str, str], dict]:
    """One results file = one trial. Provider failures are dropped, not scored."""
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    out: dict[tuple[str, str], dict] = {}
    for res in doc.get("results", []):
        attempts = res.get("attempts") or []
        produced = any(
            (((a.get("llmResponse") or {}).get("usage") or {}).get(
                "completionTokens",
            ) or 0) > 0 or ((a.get("llmResponse") or {}).get("content"))
            for a in attempts
        )
        if not produced:
            continue  # 402/401/hard-429: not a model outcome
        model = (res.get("context") or {}).get("llmModel") or "?"
        out[(model, res["taskId"])] = {
            "solved": bool(res.get("success")),
            "first_try": res.get("passedAttemptNumber") == 1,
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--subset", help="comma-separated task-id suffixes, e.g. X067,X074")
    ap.add_argument("--metric", choices=("solved", "first_try"), default="first_try")
    args = ap.parse_args()

    paths: list[str] = []
    for pattern in args.runs:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])
    trials = [load_trial(p) for p in paths]
    trials = [t for t in trials if t]
    if not trials:
        print("[FAIL] no usable trials")
        return 1

    # A (model, task) cell needs an outcome in EVERY trial to be scored: a cell
    # missing from one trial would otherwise make that model look more
    # consistent than it is.
    cells = set(trials[0])
    for t in trials[1:]:
        cells &= set(t)
    models = sorted({m for m, _ in cells})
    tasks = sorted({t for _, t in cells})
    if args.subset:
        want = {s.strip().upper() for s in args.subset.split(",") if s.strip()}
        tasks = [t for t in tasks if t[-4:].upper() in want]
        cells = {(m, t) for (m, t) in cells if t in tasks}

    k = len(trials)
    print(f"trials (k): {k}   from {len(paths)} file(s)")
    print(f"models: {len(models)}   tasks scored in every trial: {len(tasks)}")
    print(f"metric: {args.metric}\n")

    print(f"  {'model':32s} {'mean/trial':>10s} {'pass@k':>8s} {'pass^k':>8s} {'drop':>7s}")
    rows = []
    for m in models:
        mt = [t for t in tasks if (m, t) in cells]
        if not mt:
            continue
        per_trial = [
            sum(tr[(m, t)][args.metric] for t in mt) / len(mt) for tr in trials
        ]
        mean = sum(per_trial) / k
        any_ = sum(1 for t in mt if any(tr[(m, t)][args.metric] for tr in trials))
        all_ = sum(1 for t in mt if all(tr[(m, t)][args.metric] for tr in trials))
        rows.append((m, mean, any_ / len(mt), all_ / len(mt), len(mt)))
    rows.sort(key=lambda r: -r[3])
    for m, mean, at_any, at_all, _n in rows:
        print(f"  {m:32s} {mean:9.1%} {at_any:8.1%} {at_all:8.1%} "
              f"{at_all - mean:+6.1%}")

    if rows:
        top = rows[0]
        print(f"\n  TOP MODEL under pass^{k}: {top[0]} at {top[3]:.1%}"
              f"{'   <= 50% BAR MET' if top[3] <= 0.5 else ''}")
        spread_mean = rows[0][1] - rows[-1][1]
        spread_pk = rows[0][3] - rows[-1][3]
        print(f"  separation top-to-bottom: mean/trial {spread_mean:.1%}"
              f"   pass^{k} {spread_pk:.1%}")
        # Ties are what selection destroyed; pass^k should break them.
        ties = collections.Counter(round(r[3], 3) for r in rows)
        worst = max(ties.values())
        print(f"  largest group of models sharing a pass^{k} score: {worst}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
