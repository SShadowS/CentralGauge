"""Per-attempt module report for composite diagnose tasks.

Usage: python scripts/composite-attempts.py <results.json> <label> [<results.json> <label> ...]

For every task: modules fully fixed (tests grouped by their X<NNN>_ prefix) out of
defect sites, attempt 1 and attempt 2, plus bugs-found, pass@1/pass@2, regressions
and a token-priced cost. Sites come from docs/reasoning-suite/composite-provenance.json.
Complements scripts/composite-verdict.py, which gates on attempt 1 only.
"""
import json, re, sys
from collections import defaultdict
prov = json.load(open('docs/reasoning-suite/composite-provenance.json'))
IN_RATE, OUT_RATE = 10/1e6, 50/1e6  # USD per token; override with CG_IN_RATE/CG_OUT_RATE (per MTok)
import os
IN_RATE = float(os.environ.get('CG_IN_RATE', 10))/1e6; OUT_RATE = float(os.environ.get('CG_OUT_RATE', 50))/1e6
def modules(tr):
    if not tr or not tr.get('results'): return {}
    g = defaultdict(list)
    for t in tr['results']:
        m = re.match(r'(X\d{3})_', t['name'])
        g[m.group(1) if m else '?'].append(bool(t['passed']))
    return {k: all(v) for k, v in g.items()}
def summarize(path, label):
    d = json.load(open(path))
    rows = []
    tot = dict(sites=0, b1=0, b2=0, p1=0, p2=0, t1n=0, t1d=0, t2n=0, t2d=0, cost=0.0, ptok=0, ctok=0, comp_fail=0, regress=0)
    for r in sorted(d['results'], key=lambda r: r['taskId']):
        tid = r['taskId']; sites = prov[tid]['sites']; tot['sites'] += sites
        a = r['attempts']
        def cell(at):
            if at is None: return None
            tr = at.get('testResult') or {}
            cr = at.get('compilationResult') or {}
            mods = modules(tr)
            return dict(ok=bool(at.get('success')), comp=bool(cr.get('success')), fixed=sum(mods.values()), nmod=len(mods),
                        passed=tr.get('passedTests', 0) or 0, total=tr.get('totalTests', 0) or 0)
        c1 = cell(a[0]); c2 = cell(a[1]) if len(a) > 1 else None
        for at in a:
            u = at['llmResponse']['usage']; tot['ptok'] += u['promptTokens']; tot['ctok'] += u['completionTokens']
            tot['cost'] += u['promptTokens']*IN_RATE + u['completionTokens']*OUT_RATE
        tot['b1'] += c1['fixed']; tot['p1'] += c1['ok']
        tot['t1n'] += c1['passed']; tot['t1d'] += c1['total'] if c1['total'] else 0
        final = c2 if c2 else c1
        tot['b2'] += final['fixed']; tot['p2'] += final['ok']
        tot['t2n'] += final['passed']; tot['t2d'] += final['total']
        if not c1['comp']: tot['comp_fail'] += 1
        if c2 and c2['fixed'] < c1['fixed']: tot['regress'] += 1
        rows.append((tid, sites, c1, c2))
    print(f"\n== {label}  ({path})")
    print(f"{'task':12}{'sites':>6}{'a1 fixed':>10}{'a1 tests':>12}{'a2 fixed':>10}{'a2 tests':>12}  note")
    for tid, sites, c1, c2 in rows:
        n1 = f"{c1['fixed']}/{sites}" + ('' if c1['comp'] else ' CF')
        t1 = f"{c1['passed']}/{c1['total']}"
        if c2:
            n2 = f"{c2['fixed']}/{sites}" + ('' if c2['comp'] else ' CF'); t2 = f"{c2['passed']}/{c2['total']}"
            note = 'PASS a2' if c2['ok'] else ('REGRESS' if c2['fixed'] < c1['fixed'] else ('gain' if c2['fixed'] > c1['fixed'] else 'flat'))
        else:
            n2 = t2 = '-'; note = 'PASS a1'
        print(f"{tid:12}{sites:>6}{n1:>10}{t1:>12}{n2:>10}{t2:>12}  {note}")
    T = tot
    print(f"bugs found a1: {T['b1']}/{T['sites']} ({100*T['b1']/T['sites']:.1f}%)   final: {T['b2']}/{T['sites']} ({100*T['b2']/T['sites']:.1f}%)")
    print(f"pass@1: {T['p1']}/22   pass@2: {T['p2']}/22   AUC@2: {(T['p1']+T['p2'])/44:.3f}   attempt-2 regressions: {T['regress']}   a1 compile fails: {T['comp_fail']}")
    print(f"tests a1: {T['t1n']}/{T['t1d']} ({100*T['t1n']/max(T['t1d'],1):.1f}%)   final: {T['t2n']}/{T['t2d']} ({100*T['t2n']/max(T['t2d'],1):.1f}%)")
    print(f"tokens in/out: {T['ptok']:,}/{T['ctok']:,}   cost @ $10/$50: ${T['cost']:.2f}   (file totalCost ${d['stats']['totalCost']:.2f})")
if len(sys.argv) < 3 or len(sys.argv) % 2 == 0:
    sys.exit(__doc__)
for p, l in zip(sys.argv[1::2], sys.argv[2::2]): summarize(p, l)
