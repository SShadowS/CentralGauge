"""Assemble a multi-defect composite diagnose task from N already-gated donors.

Follows the X175 convention exactly (verified against
scratch/CG-AL-X175/correct/CG-AL-X175.Test.al):
  - donor starter/reference .al files are copied VERBATIM; donors carry their
    own `CG X<NNN>` object names and id blocks, so nothing can collide
  - the donor oracles are merged into ONE test codeunit, every helper and
    test method prefixed with its donor tag (X066_, X072_, ...) so identical
    helper names across suites cannot collide
  - codeunit-level vars are merged and de-duplicated
"""
import os, re, json, sys, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

def read(p):
    with open(p, encoding='utf-8-sig') as f:
        return f.read()

DECL = re.compile(r'^\s*(?:local\s+)?procedure\s+([A-Za-z_]\w*)', re.M)

def split_oracle(src):
    """Return (codeunit_props, var_decls, body) for a donor oracle."""
    i = src.index('{')
    inner = src[i+1:src.rindex('}')]
    lines = inner.split('\n')
    props, var_decls, body = [], [], []
    state = 'props'
    for ln in lines:
        s = ln.strip()
        if state == 'props':
            if re.match(r'^var\b', s):
                state = 'vars'; continue
            if re.match(r'^(\[|local\s+procedure|procedure|trigger)', s):
                state = 'body'; body.append(ln); continue
            if s and not s.startswith('//'):
                props.append(s)
            continue
        if state == 'vars':
            if re.match(r'^(\[|local\s+procedure|procedure|trigger)', s):
                state = 'body'; body.append(ln); continue
            if s:
                var_decls.append(s)
            continue
        body.append(ln)
    return props, var_decls, '\n'.join(body)

def compose(new_id, donors, test_codeunit_id, out_dir):
    tag_of = {d: 'X' + d.split('-X')[1] for d in donors}
    os.makedirs(out_dir, exist_ok=True)
    for sub, src_tpl in (('starter', 'tasks/starter/{d}'),
                         ('correct', 'reference/solutions/{d}')):
        dst = os.path.join(out_dir, sub)
        os.makedirs(dst, exist_ok=True)
        for d in donors:
            sd = os.path.join(ROOT, src_tpl.format(d=d))
            for fn in sorted(os.listdir(sd)):
                if fn.endswith('.al'):
                    shutil.copy2(os.path.join(sd, fn), os.path.join(dst, fn))

    all_props, all_vars, chunks = [], [], []
    for d in donors:
        tag = tag_of[d]
        src = read(os.path.join(ROOT, f'tests/al/hard/{d}.Test.al'))
        props, vars_, body = split_oracle(src)
        for p in props:
            if p not in all_props and not p.lower().startswith('subtype') \
               and not p.lower().startswith('testpermissions'):
                all_props.append(p)
        for v in vars_:
            if v not in all_vars:
                all_vars.append(v)
        # A donor oracle may reference its OWN codeunit by name (e.g. to bind
        # itself as a manual event subscriber). The merge renames the codeunit,
        # so those self-references must be re-pointed or the app will not
        # compile (AL0185, hit by X067 inside X183).
        body = body.replace(f'"{d} Test"', f'"{new_id} Test"')

        names = set(DECL.findall(body))
        for n in sorted(names, key=len, reverse=True):
            body = re.sub(r'(?<![\w."])' + re.escape(n) + r'(?=\s*\()',
                          f'{tag}_{n}', body)
        chunks.append((d, tag, body.strip('\n')))

    hdr = [f'codeunit {test_codeunit_id} "{new_id} Test"', '{',
           '    Subtype = Test;', '    TestPermissions = Disabled;']
    for p in all_props:
        hdr.append('    ' + p)
    hdr += ['',
            f'    // This oracle merges {len(donors)} independent modules\' test suites into one',
            '    // codeunit. Every test and helper procedure is prefixed with the module',
            '    // it belongs to so identical helper names across the source suites cannot',
            '    // collide. Assembled from already-gated donors; see NOTES.md.',
            '', '    var']
    for v in all_vars:
        hdr.append('        ' + v)
    out = '\n'.join(hdr)
    for d, tag, body in chunks:
        out += ('\n\n    // ' + '=' * 58 +
                f'\n    // {tag} - donor {d}\n    // ' + '=' * 58 + '\n\n' + body)
    out += '\n}\n'
    with open(os.path.join(out_dir, 'correct', f'{new_id}.Test.al'), 'w',
              encoding='utf-8', newline='') as f:
        f.write(out)
    return sum(1 for _ in re.finditer(r'\[Test\]', out))

if __name__ == '__main__':
    spec = json.load(open(sys.argv[1]))
    for c in spec:
        n = compose(c['id'], c['donors'], c['testCodeunitId'],
                    os.path.join(ROOT, 'scratch', c['id']))
        print(f"{c['id']}: {len(c['donors'])} donors, {n} tests")
