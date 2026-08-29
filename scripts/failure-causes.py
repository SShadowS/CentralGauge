#!/usr/bin/env python3
"""Classify benchmark failures by CAUSE, separating capability from artifact.

Motivation (docs/reasoning-suite/hardening-levers-evidence.md, "VALIDITY
DEFECT"): on the three-model uncapped panel, 33% of failed tasks and 36% of
repair attempts were lost to object omission - the model dropping an object
or a field while re-emitting the whole application under templates/
diagnose.md rule 2. That is transcription fidelity, not diagnostic ability,
and it is SWE-bench Verified's dominant discard category (`false_negative`)
in a different costume.

Causes reported:

  behavioural   compiled, ran, failed the graded assertions.  REAL signal.
  omission      AL0185 "Table 'X' is missing" / AL0132 "does not contain a
                definition for 'X'".  ARTIFACT of the re-emit requirement.
  al_knowledge  any other compile error (syntax, property misuse, enum
                static access, permission kind, operator ambiguity).  REAL.
  zero_tests    published but ran no tests - infra (GH #13), not a verdict.
  other         no usable compilation/test record.

Usage:

    python scripts/failure-causes.py results/benchmark-results-*.json
    python scripts/failure-causes.py --by-task results/*.json
"""

from __future__ import annotations

import argparse
import collections
import json

# The two AL diagnostics a dropped object or field produces. AL0000 ("App
# generation failed") is a downstream cascade and never classifies on its own.
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
            # Mixed. An AL0185 can itself be a CASCADE of a syntax error: a
            # file that fails to parse takes its objects with it, so the
            # table legitimately reads as "missing". Attributing these to
            # omission over-counts the artifact (53% vs 33% on the
            # three-model panel), so they are held out rather than claimed.
            return "mixed_compile"
        return "al_knowledge"
    if not test:
        return "other"
    if (test.get("totalTests") or 0) == 0:
        return "zero_tests"
    if not test.get("success"):
        return "behavioural"
    return "pass"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--by-task", action="store_true",
                    help="also list per-task causes for every failed task")
    args = ap.parse_args()

    per_model_attempts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    per_model_tasks: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    transitions: collections.Counter = collections.Counter()
    lost_repairs: list[tuple[str, str]] = []
    task_rows: list[tuple[str, str, str, str]] = []

    for path in args.runs:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        for res in doc.get("results", []):
            model = (res.get("context") or {}).get("llmModel") or "?"
            attempts = res.get("attempts") or []
            for att in attempts:
                per_model_attempts[model][cause(att)] += 1
            if len(attempts) >= 2:
                first, second = cause(attempts[0]), cause(attempts[1])
                transitions[(first, second)] += 1
                if first == "behavioural" and second == "omission":
                    lost_repairs.append((model, res["taskId"]))
            if not res.get("success") and attempts:
                final = cause(attempts[-1])
                per_model_tasks[model][final] += 1
                task_rows.append((res["taskId"], model,
                                  cause(attempts[0]) if attempts else "?", final))

    print("=== ATTEMPTS by cause ===")
    for model, ctr in sorted(per_model_attempts.items()):
        total = sum(ctr.values())
        body = "  ".join(f"{k}={v} ({v/total:.0%})" for k, v in ctr.most_common())
        print(f"  {model:34s} n={total:4d}  {body}")

    print("\n=== FAILED TASKS by cause of last attempt ===")
    grand: collections.Counter = collections.Counter()
    for model, ctr in sorted(per_model_tasks.items()):
        total = sum(ctr.values())
        grand.update(ctr)
        body = "  ".join(f"{k}={v}" for k, v in ctr.most_common())
        print(f"  {model:34s} failures={total:3d}  {body}")
    gtot = sum(grand.values()) or 1
    print("  " + "-" * 78)
    print(f"  {'ALL MODELS':34s} failures={gtot:3d}  "
          + "  ".join(f"{k}={v} ({v/gtot:.0%})" for k, v in grand.most_common()))
    artifact = grand.get("omission", 0) + grand.get("zero_tests", 0)
    mixed = grand.get("mixed_compile", 0)
    print(f"\n  ARTIFACT share of all failures: {artifact}/{gtot} = {artifact/gtot:.0%}"
          "   (omission + zero_tests; neither measures diagnostic ability)")
    if mixed:
        print(f"  plus {mixed} mixed_compile held out - an omission diagnostic alongside a"
              f" real one,\n  where the missing object may be a cascade of the syntax error."
              f" Upper bound {(artifact+mixed)/gtot:.0%}.")

    print("\n=== TWO-ATTEMPT TRANSITIONS (attempt 1 -> attempt 2) ===")
    for (a, b), c in transitions.most_common():
        print(f"  {a:12s} -> {b:12s} {c}")
    behav_first = sum(c for (a, _), c in transitions.items() if a == "behavioural")
    if behav_first:
        lost = len(lost_repairs)
        print(f"\n  Of {behav_first} tasks failing attempt 1 behaviourally, "
              f"{lost} ({lost/behav_first:.0%}) lost attempt 2 to object omission:")
        for model, task in sorted(lost_repairs, key=lambda r: r[1]):
            print(f"     {task}  {model}")

    if args.by_task:
        print("\n=== FAILED TASKS (task, model, attempt1, final) ===")
        for row in sorted(task_rows):
            print("  {:14s} {:34s} {:12s} {}".format(*row))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
