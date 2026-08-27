"""Split a reference solution's multi-object .al file into one object per file.

LethAL refuses to instrument a project whose single .al file declares more than
one object type, failing with `assertNoUnsupportedObjectMix` and a bare `Error`
carrying no message. That looked at first like an object-type blocklist, but it
is not: enum, page, query, report and tableextension all appear in projects
LethAL instruments happily. The discriminator is per FILE - every refused
project had one file holding two or more objects, and every instrumented one had
exactly one object per file.

That is a layout convention, not a capability limit. AL does not care which file
an object lives in, so splitting is semantically inert and unblocks the task.

The seeded reference solutions hit this because they were lifted verbatim from
model output, and a model asked for one solution writes one file.

Usage:
    python scripts/split-al-objects.py CG-AL-H004 CG-AL-M001 ...
    python scripts/split-al-objects.py --check CG-AL-H004      # report only
"""

import os
import re
import sys

ROOT = "reference/solutions"

# Top-level AL object declarations. `extends` and quoted names are handled by
# stopping at the opening brace rather than trying to parse the whole header.
OBJECT_RE = re.compile(
    r"^\s*(table|tableextension|page|pageextension|codeunit|report|reportextension|"
    r"enum|enumextension|interface|query|xmlport|controladdin|permissionset|"
    r"permissionsetextension|profile|pagecustomization|entitlement|dotnet)\b",
    re.IGNORECASE,
)


def split_objects(text):
    """Return [(kind, name_hint, source), ...] for each top-level object.

    Brace counting rather than a grammar: AL string literals use single quotes
    and cannot contain an unescaped brace that would unbalance the count, and
    comments carrying braces are rare enough that a mismatch is reported rather
    than silently mis-split.
    """
    lines = text.splitlines(keepends=True)
    out, i = [], 0
    while i < len(lines):
        m = OBJECT_RE.match(lines[i])
        if not m:
            i += 1
            continue
        start, depth, seen = i, 0, False
        while i < len(lines):
            depth += lines[i].count("{") - lines[i].count("}")
            if "{" in lines[i]:
                seen = True
            i += 1
            if seen and depth <= 0:
                break
        body = "".join(lines[start:i])
        # A usable filename hint: the quoted name, else the bare identifier.
        hdr = lines[start]
        q = re.search(r'"([^"]+)"', hdr)
        if q:
            hint = q.group(1)
        else:
            parts = hdr.split()
            hint = parts[2] if len(parts) > 2 else parts[-1]
        out.append((m.group(1).lower(), re.sub(r"[^A-Za-z0-9]", "", hint), body))
    return out


def process(task, check_only):
    d = os.path.join(ROOT, task)
    if not os.path.isdir(d):
        print(f"  {task}: no reference solution")
        return False
    changed = False
    for name in sorted(os.listdir(d)):
        if not name.endswith(".al"):
            continue
        path = os.path.join(d, name)
        text = open(path, encoding="utf-8", errors="replace").read()
        objs = split_objects(text)
        if len(objs) <= 1:
            continue
        kinds = ", ".join(k for k, _, _ in objs)
        print(f"  {task}/{name}: {len(objs)} objects ({kinds})")
        if check_only:
            changed = True
            continue
        # Which object keeps the task-id filename is cosmetic to LethAL but not
        # to a reader: prefer the codeunit, since that is the logic under test
        # and what the mutation operators actually target. Fall back to the
        # longest object, then to the first.
        base = name[:-3]
        keep = next((o for o in objs if o[0] == "codeunit"), None)             or max(objs, key=lambda o: len(o[2]))
        rest = [o for o in objs if o is not keep]
        open(path, "w", encoding="utf-8", newline="\n").write(
            keep[2].rstrip() + "\n",
        )
        for kind, hint, body in rest:
            out = os.path.join(d, f"{base}.{hint or kind}.al")
            n = 2
            while os.path.exists(out):
                out = os.path.join(d, f"{base}.{hint or kind}{n}.al")
                n += 1
            open(out, "w", encoding="utf-8", newline="\n").write(
                body.rstrip() + "\n",
            )
            print(f"      -> {os.path.basename(out)}")
        changed = True
    return changed


def main(argv):
    check = "--check" in argv
    tasks = [a for a in argv if not a.startswith("--")]
    if not tasks:
        print(__doc__)
        return 2
    n = sum(1 for t in tasks if process(t, check))
    print(f"\n{n} task(s) {'would be' if check else ''} split")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
