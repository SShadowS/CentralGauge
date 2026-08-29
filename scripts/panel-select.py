#!/usr/bin/env python3
"""Aider-polyglot-style difficulty selection against a measured model panel.

Nothing in the SWE-bench literature filters on difficulty at CONSTRUCTION
time; difficulty is imposed afterwards by selecting tasks a measured panel
mostly fails. Aider polyglot kept the 225 of 697 problems "solved by 3 or
fewer models" out of a 7-model panel (32% retention, target band 5-50%).
BigCodeBench-Hard used measured solve_rate < 50 plus complexity predicates
(13% retention). This script is our version of that step.

Usage:

    python scripts/panel-select.py results/benchmark-results-*.json
    python scripts/panel-select.py --max-solvers 3 --emit-tasks r1.json r2.json

Truncation guard: an attempt whose completionTokens lands exactly on a
round cap (4000/8000/16000/32000) is a suspected `bench --max-tokens`
truncation, which manufactures FALSE FAILURES only. Runs carrying any such
attempt are reported and excluded by default -- a capped run silently
understates every model and corrupts the solver counts the whole selection
rests on. See docs/reasoning-suite/hardening-levers-evidence.md.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys

ROUND_CAPS = (4000, 8000, 16000, 32000)


def load_run(path: str) -> tuple[dict, int]:
    """Return {(model, taskId): outcome} plus the count of capped attempts."""
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    out: dict[tuple[str, str], dict] = {}
    capped = 0
    for res in doc.get("results", []):
        model = (res.get("context") or {}).get("llmModel") or "?"
        truncated = False
        for att in res.get("attempts") or []:
            usage = ((att.get("llmResponse") or {}).get("usage")) or {}
            if usage.get("completionTokens") in ROUND_CAPS:
                truncated = True
                capped += 1
        out[(model, res["taskId"])] = {
            "pass2": bool(res.get("success")),
            "pass1": res.get("passedAttemptNumber") == 1,
            "truncated": truncated,
        }
    return out, capped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", help="benchmark-results-*.json files")
    ap.add_argument(
        "--max-solvers",
        type=int,
        default=None,
        help="retain tasks solved by at most N models (default: sweep all)",
    )
    ap.add_argument(
        "--metric",
        choices=("pass2", "pass1"),
        default="pass2",
        help="which outcome counts as 'solved' (default pass2 = best-of-2)",
    )
    ap.add_argument(
        "--allow-capped",
        action="store_true",
        help="include runs with round-cap attempts (they understate scores)",
    )
    ap.add_argument(
        "--emit-tasks",
        action="store_true",
        help="print the retained task ids, one per line, to stdout",
    )
    args = ap.parse_args()

    panel: dict[tuple[str, str], dict] = {}
    for path in args.runs:
        run, capped = load_run(path)
        if capped and not args.allow_capped:
            print(
                f"[SKIP] {path}: {capped} attempt(s) on a round token cap "
                f"-- suspected truncation, excluded. Use --allow-capped to override.",
                file=sys.stderr,
            )
            continue
        if capped:
            print(f"[WARN] {path}: {capped} capped attempt(s) included", file=sys.stderr)
        panel.update(run)

    models = sorted({m for m, _ in panel})
    if not models:
        print("[FAIL] no usable runs", file=sys.stderr)
        return 1

    tasks = sorted({t for _, t in panel})
    complete = [t for t in tasks if all((m, t) in panel for m in models)]
    partial = len(tasks) - len(complete)

    print(f"panel: {len(models)} models -- {', '.join(models)}")
    print(f"tasks: {len(complete)} with full panel coverage"
          + (f" ({partial} dropped for partial coverage)" if partial else ""))
    print(f"metric: {args.metric}\n")

    def solvers(task: str) -> int:
        return sum(panel[(m, task)][args.metric] for m in models)

    hist = collections.Counter(solvers(t) for t in complete)
    print("solvers per task: "
          + "  ".join(f"{k}/{len(models)}={hist.get(k, 0)}" for k in range(len(models) + 1)))

    thresholds = ([args.max_solvers] if args.max_solvers is not None
                  else list(range(len(models) - 1, -1, -1)))
    for thr in thresholds:
        keep = [t for t in complete if solvers(t) <= thr]
        pct = len(keep) / len(complete) if complete else 0
        print(f"\n-- retain tasks solved by <= {thr} of {len(models)}: "
              f"n={len(keep)}  retention={pct:.0%}")
        if not keep:
            continue
        for m in models:
            p1 = sum(panel[(m, t)]["pass1"] for t in keep)
            p2 = sum(panel[(m, t)]["pass2"] for t in keep)
            print(f"   {m:26s} pass@1={p1:3d}/{len(keep)}={p1/len(keep):5.0%}"
                  f"   best-of-2={p2:3d}/{len(keep)}={p2/len(keep):5.0%}")
        spread = max(sum(panel[(m, t)]["pass2"] for t in keep) for m in models) - \
            min(sum(panel[(m, t)]["pass2"] for t in keep) for m in models)
        print(f"   top-to-bottom spread: {spread} tasks ({spread/len(keep):.0%})")
        if args.emit_tasks and args.max_solvers is not None:
            for t in keep:
                print(t)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
