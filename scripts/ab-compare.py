#!/usr/bin/env python3
"""Paired A/B comparison of two response-format contracts.

Arm A: `diagnose.md` - the model returns the COMPLETE application and the
harness writes the whole response as the candidate. An omitted object is
destructive.

Arm B: `diagnose-objects.md` - the model returns only the objects it changed,
overlaid onto the starter by type+name (`src/tasks/object-overlay.ts`). An
omitted object is a no-op.

Restricted to the (model, task) pairs present in BOTH arms, so the delta is
paired rather than a comparison of different populations. McNemar's exact test
on the discordant pairs, because the arms are matched by construction and a
two-proportion test would ignore that.

Usage:

    python scripts/ab-compare.py --arm-a a1.json a2.json --arm-b b1.json
"""

from __future__ import annotations

import argparse
import collections
import json
import math

OMISSION_CODES = {"AL0185", "AL0132"}
CASCADE_CODES = {"AL0000"}


def cause(attempt: dict) -> str:
    comp = attempt.get("compilationResult") or {}
    test = attempt.get("testResult") or {}
    if not comp:
        return "other"
    if not comp.get("success"):
        codes = [e.get("code") for e in (comp.get("errors") or [])]
        real = [c for c in codes if c not in CASCADE_CODES]
        if real and all(c in OMISSION_CODES for c in real):
            return "omission"
        if any(c in OMISSION_CODES for c in real):
            return "mixed"
        return "al_knowledge"
    if not test:
        return "other"
    if (test.get("totalTests") or 0) == 0:
        return "zero_tests"
    return "behavioural" if not test.get("success") else "pass"


def is_provider_failure(attempts: list[dict]) -> bool:
    """True when no attempt produced any model output at all.

    A 402 (out of credits), 401 or hard 429 scores as `success: false` in the
    results file, which is indistinguishable from a capability failure unless
    you look. It is not a model outcome and must never enter a rate: an
    exhausted OpenRouter balance silently reported grok-4.3 and deepseek-v4-pro
    at 0/18 during the 2026-08-30 A/B.
    """
    if not attempts:
        return True
    for att in attempts:
        usage = ((att.get("llmResponse") or {}).get("usage")) or {}
        content = (att.get("llmResponse") or {}).get("content") or ""
        if (usage.get("completionTokens") or 0) > 0 or content:
            return False
    return True


def load(paths: list[str]) -> tuple[dict[tuple[str, str], dict], list[tuple[str, str, str]]]:
    out: dict[tuple[str, str], dict] = {}
    dropped: list[tuple[str, str, str]] = []
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        for res in doc.get("results", []):
            model = (res.get("context") or {}).get("llmModel") or "?"
            attempts = res.get("attempts") or []
            if is_provider_failure(attempts):
                reasons = (attempts[0].get("failureReasons") if attempts else None) or []
                dropped.append(
                    (model, res["taskId"], (reasons[0] if reasons else "no model output")),
                )
                continue
            out[(model, res["taskId"])] = {
                "solved": bool(res.get("success")),
                "first_try": res.get("passedAttemptNumber") == 1,
                "causes": [cause(a) for a in attempts],
            }
    return out, dropped


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p-value over the b+c discordant pairs."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / (2 ** n)
    return min(1.0, 2 * tail)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm-a", nargs="+", required=True,
                    help="whole-app (diagnose.md) result files")
    ap.add_argument("--arm-b", nargs="+", required=True,
                    help="changed-objects (diagnose-objects.md) result files")
    ap.add_argument("--metric", choices=("solved", "first_try"),
                    default="solved")
    args = ap.parse_args()

    A, dropped_a = load(args.arm_a)
    B, dropped_b = load(args.arm_b)
    for label, dropped in (("arm A", dropped_a), ("arm B", dropped_b)):
        if dropped:
            print(f"[DROPPED] {label}: {len(dropped)} cell(s) with no model output "
                  f"- provider failure, not a model outcome")
            seen = set()
            for model, task, reason in dropped:
                if model in seen:
                    continue
                seen.add(model)
                n = sum(1 for m, _, _ in dropped if m == model)
                print(f"           {model}: {n} cell(s) - {reason[:80]}")
            print()
    pairs = sorted(set(A) & set(B))
    if not pairs:
        print("[FAIL] no (model, task) pair appears in both arms")
        return 1

    models = sorted({m for m, _ in pairs})
    tasks = sorted({t for _, t in pairs})
    print(f"paired on {len(pairs)} (model, task) cells "
          f"- {len(models)} models x {len(tasks)} tasks")
    print(f"metric: {args.metric}\n")

    print(f"  {'model':30s} {'arm A':>10s} {'arm B':>10s} {'delta':>8s}")
    for model in models:
        cells = [t for m, t in pairs if m == model]
        a = sum(A[(model, t)][args.metric] for t in cells)
        b = sum(B[(model, t)][args.metric] for t in cells)
        n = len(cells)
        print(f"  {model:30s} {a:3d}/{n:<3d}={a/n:4.0%} "
              f"{b:3d}/{n:<3d}={b/n:4.0%} {(b-a)/n:+7.0%}")

    a_tot = sum(A[p][args.metric] for p in pairs)
    b_tot = sum(B[p][args.metric] for p in pairs)
    n = len(pairs)
    print(f"  {'-'*60}")
    print(f"  {'ALL':30s} {a_tot:3d}/{n:<3d}={a_tot/n:4.0%} "
          f"{b_tot:3d}/{n:<3d}={b_tot/n:4.0%} {(b_tot-a_tot)/n:+7.0%}")

    # McNemar over discordant cells.
    b_only = [p for p in pairs if B[p][args.metric] and not A[p][args.metric]]
    a_only = [p for p in pairs if A[p][args.metric] and not B[p][args.metric]]
    p = mcnemar_exact(len(b_only), len(a_only))
    print(f"\n  discordant: B-only {len(b_only)}, A-only {len(a_only)}"
          f"   McNemar exact p = {p:.4f}"
          f"{'  SIGNIFICANT' if p < 0.05 else '  not significant'}")

    if b_only:
        print("\n  fixed by the overlay (failed under whole-app, passes now):")
        for m, t in sorted(b_only, key=lambda x: x[1]):
            print(f"     {t:14s} {m:30s} armA causes={A[(m, t)]['causes']}")
    if a_only:
        print("\n  BROKEN by the overlay (passed under whole-app, fails now):")
        for m, t in sorted(a_only, key=lambda x: x[1]):
            print(f"     {t:14s} {m:30s} armB causes={B[(m, t)]['causes']}")

    # Cause mix, which is the mechanism behind any delta.
    print("\n  cause mix over all attempts:")
    for label, arm in (("arm A", A), ("arm B", B)):
        ctr: collections.Counter = collections.Counter()
        for pair in pairs:
            ctr.update(arm[pair]["causes"])
        tot = sum(ctr.values()) or 1
        body = "  ".join(f"{k}={v} ({v/tot:.0%})" for k, v in ctr.most_common())
        print(f"    {label}: {body}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
