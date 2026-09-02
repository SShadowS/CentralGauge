"""Per-donor survival inside composites, from bench results files.

Usage:
  python scripts/composite-survival.py [--since YYYY-MM-DD] [--min-included N]

For every composite in docs/reasoning-suite/composite-provenance.json, every
attempt-1 cell (opus-5 and gpt-5.5) in every results/benchmark-results-*.json
newer than --since is classified as pass / behavioural / compile / provider.
A donor "survives" a cell when at least one of its oracle tests fails in a
behavioural cell. Compile and provider cells are uninformative and skipped.

Also cross-tabulates gated composites (tag `composite` in a committed
tasks/hard yml) by site count and by presence of a high-survival donor.

Measured 2026-09-02 (hardening-levers-evidence.md, "The dose-response was a
confound"): 0 of 70 composites without a high-survival donor ever gated.
"""
import argparse
import collections
import glob
import json
import os
import time

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def load_gated():
    gated = set()
    for y in glob.glob(os.path.join(ROOT, 'tasks', 'hard', 'CG-AL-X*.yml')):
        t = yaml.safe_load(open(y, encoding='utf-8'))
        if 'composite' in (t.get('metadata', {}).get('tags') or []):
            gated.add(t['id'])
    return gated


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default='2026-08-31')
    ap.add_argument('--min-included', type=int, default=4)
    ap.add_argument('--threshold', type=float, default=0.25,
                    help='survival rate that makes a donor "high-survival"')
    a = ap.parse_args()
    since = time.mktime(time.strptime(a.since, '%Y-%m-%d'))

    prov = json.load(open(os.path.join(ROOT, 'docs', 'reasoning-suite', 'composite-provenance.json'), encoding='utf-8'))
    gated = load_gated()
    inc, sur = collections.Counter(), collections.Counter()
    cells = collections.Counter()
    for f in sorted(glob.glob(os.path.join(ROOT, 'results', 'benchmark-results-*.json'))):
        if os.path.getmtime(f) < since:
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        for r in d.get('results', []):
            t = r.get('taskId', '')
            if t not in prov:
                continue
            m = (r.get('context') or {}).get('llmModel', '')
            if not any(k in m for k in ('opus-5', 'gpt-5.5')):
                continue
            at = (r.get('attempts') or [None])[0]
            if not at:
                continue
            comp = at.get('compilationResult') or {}
            if at.get('success'):
                verdict, surv = 'pass', set()
            elif comp.get('success') is None:
                verdict, surv = 'provider', set()
            elif not comp.get('success'):
                verdict, surv = 'compile', set()
            else:
                tr = at.get('testResult') or {}
                tcs = tr.get('testCases') or tr.get('results') or []
                surv = {tc['name'].split('_')[0] for tc in tcs if not tc.get('passed')}
                verdict = 'behavioural' if surv else 'other'
            cells[verdict] += 1
            if verdict in ('compile', 'provider', 'other'):
                continue
            for dn in prov[t]['donors']:
                tag = 'X' + dn.split('-X')[1]
                inc[tag] += 1
                if tag in surv:
                    sur[tag] += 1

    print(f'attempt-1 cells since {a.since}: {dict(cells)}')
    rows = sorted(((sur[k] / inc[k], sur[k], inc[k], k) for k in inc), key=lambda x: (-x[0], -x[2]))
    print('\ndonor   survived/included  rate')
    high = []
    for rate, s, n, k in rows:
        if n >= a.min_included and s > 0:
            print(f'{k:6}  {s:3}/{n:<4}  {rate:5.0%}')
        if n >= 6 and rate >= a.threshold:
            high.append(k)
    zero = [k for _, s, n, k in rows if s == 0 and n >= a.min_included]
    print(f'\nnever survived (n>={a.min_included}): {len(zero)} donors')
    print(f'high-survival (rate>={a.threshold:.0%}, n>=6): {" ".join(high)}')
    print('  --require ' + ','.join('CG-AL-' + k for k in high))

    tab = collections.defaultdict(lambda: [0, 0])
    for k, v in prov.items():
        tags = {'X' + dn.split('-X')[1] for dn in v['donors']}
        key = (v['sites'], bool(tags & set(high)))
        tab[key][1] += 1
        if k in gated:
            tab[key][0] += 1
    print('\nsites  high-survival donor present  gated/screened')
    tot = collections.defaultdict(lambda: [0, 0])
    for (s, h), (g, n) in sorted(tab.items()):
        print(f'{s:5}  {str(h):8}                     {g:2}/{n:<3} {g / n:4.0%}')
        tot[h][0] += g
        tot[h][1] += n
    for h, (g, n) in sorted(tot.items()):
        print(f'all sites, present={h}: {g}/{n} {g / n:.0%}')


if __name__ == '__main__':
    main()
