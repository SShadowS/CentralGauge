"""Post-assembly preparation for a composite batch.

Usage: python scripts/composite-prepare.py <spec.json> <sites> <donor-descriptions-out.json>

For every composite in the spec (already scaffolded with `task new --diagnose`
and assembled with `scripts/composite-assemble.py`):
  - sets correct/app.json to a1b2c3d4-a<NNN>-...-0001 and writes
    starter/app.json as ...-0002
  - fills task.yml metadata (prompt_template diagnose-objects.md, metrics,
    cohort, origin, donors, defect-sites-N tag, authoring model)
  - emits the donor-description input for the description writers:
    {id: {moduleCount, donors: [{id, desc, tests}]}} where tests are the
    merged oracle's [Test] names for that donor
"""
import glob
import json
import os
import re
import sys

import yaml

spec_path, sites, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
spec = json.load(open(spec_path))
dd = {}
for c in spec:
    cid = c['id']
    n = cid.split('-X')[1]
    cp = f'scratch/{cid}/correct/app.json'
    app = json.load(open(cp, encoding='utf-8-sig'))
    app['id'] = f'a1b2c3d4-a{n}-0000-0000-000000000001'
    app['name'] = f'{cid} correct'
    json.dump(app, open(cp, 'w', encoding='utf-8'), indent=2)
    st = dict(app)
    st['id'] = f'a1b2c3d4-a{n}-0000-0000-000000000002'
    st['name'] = f'{cid} starter'
    os.makedirs(f'scratch/{cid}/starter', exist_ok=True)
    json.dump(st, open(f'scratch/{cid}/starter/app.json', 'w', encoding='utf-8'), indent=2)

    tp = f'scratch/{cid}/task.yml'
    t = yaml.safe_load(open(tp, encoding='utf-8'))
    t['prompt_template'] = 'diagnose-objects.md'
    t['metrics'] = ['compile_pass', 'tests_pass', 'pass_attempt']
    t['metadata'] = {
        'category': 'business-logic',
        'tags': ['diagnose', 'composite', 'multi-defect', 'minimal-symptom', f'defect-sites-{sites}'],
        'difficulty': 'hard', 'cohort': 'reasoning-100', 'origin': 'composite-assembled',
        'donors': list(c['donors']), 'authoring_model': 'anthropic',
        'authoring_model_slug': 'anthropic/claude-fable-5-1'}
    yaml.safe_dump(t, open(tp, 'w', encoding='utf-8'), sort_keys=False, allow_unicode=True, width=10000)

    oracle = open(f'scratch/{cid}/correct/{cid}.Test.al', encoding='utf-8-sig').read()
    tests = re.findall(r'\[Test\]\s*(?:\[[^\]]*\]\s*)*procedure\s+(X\d+)_(\w+)', oracle)
    donors = []
    for d in c['donors']:
        tag = 'X' + d.split('-X')[1]
        ymls = glob.glob(f'tasks/hard/{d}-*.yml')
        desc = yaml.safe_load(open(ymls[0], encoding='utf-8'))['description'].strip()
        donors.append({'id': d, 'desc': desc, 'tests': [name for g, name in tests if g == tag]})
    dd[cid] = {'moduleCount': len(donors), 'donors': donors}
    print(cid, 'objs', len(glob.glob(f'scratch/{cid}/starter/*.al')), 'tests', len(tests),
          'per donor', [(d['id'][-4:], len(d['tests'])) for d in donors])
json.dump(dd, open(out_path, 'w', encoding='utf-8'), indent=1)
print('wrote', out_path)
