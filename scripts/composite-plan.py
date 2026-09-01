"""Plan a batch of multi-defect composite tasks: pick donor groupings.

Companion to `composite-assemble.py`. Emits the spec JSON that the assembler
consumes: [{"id", "donors", "n", "objs"}].

Donor eligibility (measured exclusions, do not relax without re-measuring):
  - diagnose-format X-series tasks only, with a reference solution
  - NO SessionInformation/SQL-counter oracles: their budgets are calibrated in a
    3-object app and the counters are session-global, so three other modules
    seeding data blows the budget and the correct side fails its own probe
  - NO TestPermissions = Restrictive: that is codeunit-level and a merged oracle
    is ONE codeunit, so it would impose the restricted role on every donor
  - NO companion files: they need renaming/renumbering into the composite
    namespace, which the assembler does not do
  - 1..5 starter objects, so a 5-8 donor merge stays inside ~28 objects

Usage:
  python scripts/composite-plan.py --sites 8 --count 10 --start 269 \
      --inventory scratch/composite-plan/donor-inventory.tsv \
      --out scratch/composite-plan/spec.json
"""
import argparse, csv, json, os, random, re
from collections import Counter, defaultdict


def load_pool(inventory):
    rows = list(csv.DictReader(open(inventory, encoding="utf-8"), delimiter="\t"))
    info = {r["id"]: r for r in rows}
    pool = []
    for r in rows:
        if r.get("tmpl") != "diagnose.md" or not r["id"].startswith("CG-AL-X"):
            continue
        if r.get("sessioninfo", "").strip():        # SQL-counter budgets
            continue
        if "Restrictive" in r.get("testperm", ""):
            continue
        if r.get("companions", "").strip():
            continue
        if "composite" in r.get("tags", "") or "triage" in r.get("slug", ""):
            continue
        if not r.get("nobj", "").isdigit() or not (1 <= int(r["nobj"]) <= 5):
            continue
        if not os.path.isdir(f"reference/solutions/{r['id']}"):
            continue
        pool.append(r["id"])
    return pool, info


def plan(pool, info, sites, count, start, prev, max_reuse, seed, obj_lo, obj_hi):
    by = defaultdict(list)
    for d in pool:
        by[info[d]["category"]].append(d)
    cats = sorted(by, key=lambda k: -len(by[k]))
    random.seed(seed)
    use, groups = Counter(), []
    for _ in range(400000):
        if len(groups) >= count:
            break
        picks = []
        # Deal one donor per category first: composites must mix mechanisms.
        for c in random.sample(cats, len(cats)):
            if len(picks) >= sites:
                break
            avail = [d for d in by[c] if use[d] < max_reuse and d not in picks]
            if avail:
                picks.append(random.choice(avail))
        while len(picks) < sites:
            extra = [d for d in pool if use[d] < max_reuse and d not in picks]
            if not extra:
                break
            picks.append(random.choice(extra))
        if len(picks) < sites:
            continue
        key = frozenset(picks)
        if key in prev:
            continue
        objs = sum(int(info[d]["nobj"]) for d in picks)
        if not (obj_lo <= objs <= obj_hi):
            continue
        prev.add(key)
        groups.append(sorted(picks))
        for d in picks:
            use[d] += 1
    return [
        {"id": f"CG-AL-X{start + i}", "donors": g, "n": len(g),
         "objs": sum(int(info[d]["nobj"]) for d in g)}
        for i, g in enumerate(groups)
    ], use


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", type=int, required=True, help="live defect sites per composite")
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--start", type=int, required=True, help="first CG-AL-X number")
    ap.add_argument("--inventory", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prev", nargs="*", default=[], help="earlier spec files, so donor SETS never repeat")
    ap.add_argument("--max-reuse", type=int, default=5)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--obj-lo", type=int, default=0)
    ap.add_argument("--obj-hi", type=int, default=999)
    a = ap.parse_args()

    pool, info = load_pool(a.inventory)
    prev = set()
    for f in a.prev:
        for c in json.load(open(f)):
            prev.add(frozenset(c["donors"]))
    spec, use = plan(pool, info, a.sites, a.count, a.start, prev,
                     a.max_reuse, a.seed, a.obj_lo, a.obj_hi)
    json.dump(spec, open(a.out, "w"), indent=1)
    print(f"eligible donors {len(pool)}; planned {len(spec)} composites at {a.sites} sites")
    print(f"object counts {sorted(Counter(c['objs'] for c in spec).items())}")
    print(f"max donor reuse {max(use.values()) if use else 0}")
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
