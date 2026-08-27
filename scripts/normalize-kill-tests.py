"""Normalize kill-test records into one machine-readable schema.

Triage ran in batches over a long session and the recorder's schema drifted, so
the same fact ended up stored two incompatible ways:

  * task-level  `killTests: [{name, setup, assertion, closes, ...}]`, where
    `closes` is FREE-FORM PROSE - "M0012 (all three die on this one test)",
    "M0004/M0005/M0008-M0017 (PreProcessSalesLines + filters)"
  * per-mutant  `mutants[].killTest: "<prose>"`

Neither is queryable, and a reader of one form silently misses the other. That
matters because the fix round has to answer exactly one question per unreached
mutant - "is there a test written for this?" - and a half-read of the data
answers it wrongly.

This rewrites both into task-level `killTests` entries carrying an explicit
`closes: ["M0008", ...]` array, expanding ranges and slash/comma lists, and
reports every unreached mutant still uncovered. It is idempotent: an entry that
already has a list `closes` is left alone.

Usage:
    python scripts/normalize-kill-tests.py            # report only
    python scripts/normalize-kill-tests.py --apply
"""

import json
import re
import sys

P = "docs/reasoning-suite/survivor-dispositions.json"

CODE = re.compile(r"M(\d{3,4})")


def parse_closes(text, valid):
    """Pull mutant codes out of prose, expanding `M0008-M0017` style ranges.

    `valid` bounds the expansion: a range is only expanded to codes that
    actually exist on the task, so a typo cannot invent mutants.
    """
    if isinstance(text, list):
        return [c for c in text if c in valid]
    s = str(text or "")
    out = []
    # Ranges first, so their endpoints are not also picked up as singletons.
    consumed = set()
    for m in re.finditer(r"M(\d{3,4})\s*(?:-|to|through|\.\.)\s*M?(\d{3,4})", s):
        a, b = int(m.group(1)), int(m.group(2))
        if a <= b:
            for n in range(a, b + 1):
                code = f"M{n:04d}"
                if code in valid:
                    out.append(code)
            consumed.add(m.span())
    for m in CODE.finditer(s):
        if any(lo <= m.start() < hi for lo, hi in consumed):
            continue
        code = f"M{int(m.group(1)):04d}"
        if code in valid:
            out.append(code)
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def main(argv):
    apply = "--apply" in argv
    doc = json.load(open(P, encoding="utf-8"))
    tasks = doc["tasks"]

    covered_total = uncovered_total = 0
    gaps = {}
    for tid, rec in sorted(tasks.items()):
        unreached = [m["code"] for m in rec["mutants"]
                     if m["disposition"] == "unreached"]
        if not unreached:
            continue
        valid = {m["code"] for m in rec["mutants"]}
        entries = []

        for kt in rec.get("killTests") or []:
            closes = parse_closes(kt.get("closes"), valid)
            if not closes:
                # A test with no resolvable target still describes real work, so
                # keep it and let the gap report show what it fails to cover.
                closes = []
            entries.append({**{k: v for k, v in kt.items() if k != "closes"},
                            "closes": closes})

        for m in rec["mutants"]:
            kt = m.get("killTest")
            if not kt or m["disposition"] != "unreached":
                continue
            # The prose may name sibling mutants the same test also kills.
            closes = parse_closes(kt, valid) or []
            if m["code"] not in closes:
                closes.insert(0, m["code"])
            entries.append({"name": None, "assertion": kt, "closes": closes,
                            "source": "per-mutant"})

        covered = {c for e in entries for c in e["closes"]}
        missing = [c for c in unreached if c not in covered]
        covered_total += len(set(unreached) & covered)
        uncovered_total += len(missing)
        if missing:
            gaps[tid] = missing

        if apply:
            rec["killTests"] = entries
            for m in rec["mutants"]:
                m.pop("killTest", None)

    print(f"unreached mutants WITH a kill test : {covered_total}")
    print(f"unreached mutants WITHOUT one      : {uncovered_total}")
    print(f"tasks needing kill tests written   : {len(gaps)}")
    for tid, miss in sorted(gaps.items(), key=lambda kv: -len(kv[1])):
        print(f"   {tid:<14}{len(miss):>3}  {' '.join(miss[:10])}"
              + (" ..." if len(miss) > 10 else ""))

    if apply:
        with open(P, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        print(f"\n-> {P} (killTests normalized, per-mutant killTest folded in)")
        with open("scratch/killtest-gaps.json", "w", encoding="utf-8",
                  newline="\n") as fh:
            json.dump(gaps, fh, indent=1)
        print("-> scratch/killtest-gaps.json")
    else:
        print("\n(report only; pass --apply to rewrite)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
