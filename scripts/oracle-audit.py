"""Find oracles that assert nothing, and tests that assert nothing.

CLAUDE.md forbids `Assert.IsTrue(true, '...')` outright - it always passes and
tests nothing. Eight committed oracles contain it anyway, and two of them
(CG-AL-H011, CG-AL-H017) consist of NOTHING else: every [Test] in them is a
placeholder.

That matters more than a style violation, because the whole gate battery
certified those two as sound:

  * B1 ran "correct leg only" - it verified the reference solution passes and
    never asked whether a wrong one fails, which a hollow oracle also satisfies.
  * B2 passed - a hollow oracle is perfectly deterministic.
  * B4 passed - a hollow oracle accepts every implementation, so two independent
    solutions both pass.
  * B7 was not_runnable - no mutable sites, so no mutants to survive.

Every gate asks "does a correct solution pass?" and none asks "does a wrong one
fail?", so an empty oracle sails through all of them. This check is the missing
question, and it is deliberately cheap and static: no container, no model.

Definitions:
  * placeholder  - an assertion whose truth is a literal, `Assert.IsTrue(true,`
  * hollow test  - a [Test] whose ONLY assertions are placeholders
  * hollow oracle- an oracle whose every [Test] is hollow

Usage:
    python scripts/oracle-audit.py                 # report, exit 1 on any hollow oracle
    python scripts/oracle-audit.py --json out.json
    python scripts/oracle-audit.py --all-tiers     # include easy (excluded by default)
"""

import glob
import json
import os
import re
import sys

PLACEHOLDER = re.compile(r"Assert\.(?:IsTrue|IsFalse)\s*\(\s*(?:true|false)\s*,")
# Every assertion helper the suite actually uses. Counting these against the
# placeholders is what distinguishes "has a placeholder among real asserts"
# from "has nothing but placeholders".
ASSERTION = re.compile(
    r"Assert\.(?:AreEqual|AreNotEqual|ExpectedError|ExpectedErrorCode|IsTrue|IsFalse|"
    r"Fail|RecordCount|TableIsEmpty|KnownFailure|IsSubstring|AreNearlyEqual)\s*\(",
)
# `if not <rec>.Find...() then exit;` ahead of every assertion: the test passes
# without checking anything whenever the fixture is missing.
VACUOUS_GUARD = re.compile(
    r"if\s+not\s+[\w\"'. ]+\."
    r"(?:FindFirst|FindSet|FindLast|Get|IsEmpty)\s*\([^)]*\)\s*then\s+exit\s*;",
    re.IGNORECASE,
)

IN_SCOPE = ("hard", "medium")


def audit_file(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    tests, hollow, vacuous = [], [], []
    # Split on the [Test] attribute: each segment is one test procedure's body
    # plus whatever trails it, which is close enough since assertions inside a
    # helper below the last test would only ever make a test look BETTER, and
    # this check is meant to be conservative about accusing an oracle.
    for seg in re.split(r"\[Test\]", text)[1:]:
        m = re.search(r"procedure\s+(\w+)", seg)
        if not m:
            continue
        name = m.group(1)
        tests.append(name)
        ph = len(PLACEHOLDER.findall(seg))
        real = len(ASSERTION.findall(seg)) - ph
        if ph and real <= 0:
            hollow.append(name)
        # A third way to assert nothing, and the subtlest: bail out before any
        # assertion when a fixture the test depends on is absent. H031's
        # TestCalcIfFlowField_True opens with `if not Customer.FindFirst() then
        # exit;`, so in a company with no Customer rows it passes having checked
        # nothing. Only the guard BEFORE the first assertion counts - the same
        # shape after one is ordinary control flow.
        first_assert = ASSERTION.search(seg)
        head = seg[:first_assert.start()] if first_assert else seg
        if VACUOUS_GUARD.search(head):
            vacuous.append(name)
    return {
        "tests": tests,
        "vacuousTests": vacuous,
        "hollowTests": hollow,
        "placeholders": len(PLACEHOLDER.findall(text)),
        "hollowOracle": bool(tests) and len(hollow) == len(tests),
    }


def main(argv):
    all_tiers = "--all-tiers" in argv
    out_path = None
    if "--json" in argv:
        out_path = argv[argv.index("--json") + 1]

    findings = {}
    for path in sorted(glob.glob("tests/al/*/*.Test.al")):
        tier = path.replace("\\", "/").split("/")[2]
        if not all_tiers and tier not in IN_SCOPE:
            continue
        res = audit_file(path)
        # Report a file for EITHER failure mode: an oracle can be vacuous
        # without containing a single placeholder.
        if not res["placeholders"] and not res["vacuousTests"]:
            continue
        res["tier"] = tier
        res["path"] = path.replace("\\", "/")
        findings[os.path.basename(path).replace(".Test.al", "")] = res

    hollow_oracles = {t: v for t, v in findings.items() if v["hollowOracle"]}
    vacuous_any = {t: v for t, v in findings.items() if v["vacuousTests"]}
    print(f"oracles containing a placeholder assertion : {len(findings)}")
    print(f"oracles that assert NOTHING AT ALL         : {len(hollow_oracles)}")
    print(f"oracles with a vacuously-passing test      : {len(vacuous_any)}")
    print()
    print(f"{'task':<14}{'tier':<8}{'tests':>6}{'hollow':>8}  status")
    for t, v in findings.items():
        status = "HOLLOW ORACLE - rewrite required" if v["hollowOracle"] \
            else f"{len(v['hollowTests'])} hollow test(s)"
        print(f"{t:<14}{v['tier']:<8}{len(v['tests']):>6}"
              f"{len(v['hollowTests']):>8}  {status}")
    for t, v in hollow_oracles.items():
        print(f"\n{t} ({v['path']}) - every test is a placeholder:")
        for n in v["hollowTests"]:
            print(f"    {n}")

    if out_path:
        with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(findings, fh, indent=1)
            fh.write("\n")
        print(f"\n-> {out_path}")

    # A hollow oracle is a hard failure: the task measures nothing, and every
    # other gate will certify it. A stray placeholder among real assertions is
    # reported but does not fail the check.
    return 1 if hollow_oracles else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
