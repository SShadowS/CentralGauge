"""2-of-3 gate verdict per task, classified on ATTEMPT 1 only.

PASS = both models fail attempt 1 behaviourally in >= 2 of 3 trials.
A compile/omission/zero-output attempt-1 cell does NOT count as a failure.
"""
import json, sys
from collections import defaultdict

def a1(rec):
    a = rec['attempts'][0]
    tr = a.get('testResult') or {}
    cr = a.get('compilationResult') or {}
    if a.get('success'): return 'pass'
    if not cr.get('success', True): return 'compile'
    if tr.get('totalTests'):
        return 'behavioural' if tr.get('passedTests', 0) < tr['totalTests'] else 'other'
    return 'other'

tab = defaultdict(lambda: defaultdict(list))
for f in sys.argv[1:]:
    d = json.load(open(f, encoding='utf-8'))
    for r in d['results']:
        m = (r.get('context') or {}).get('llmModel', '?')
        tab[r['taskId']][m].append(a1(r))

print(f"{'task':12s} {'model':16s} attempt-1 verdicts        beh/n")
verdicts = {}
for tid in sorted(tab):
    ok = True
    for m in sorted(tab[tid]):
        v = tab[tid][m]
        beh = sum(1 for x in v if x == 'behavioural')
        print(f"{tid:12s} {m:16s} {str(v):40s} {beh}/{len(v)}")
        if not (beh >= 2 and beh >= (len(v) + 1) // 2 and beh * 3 >= 2 * len(v)): ok = False
        if beh < 2: ok = False
    verdicts[tid] = 'PASS' if ok else 'FAIL'
print()
for tid, v in verdicts.items():
    print(f"  {tid}: GATE {v}")
