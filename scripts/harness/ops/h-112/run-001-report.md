# H-112 run 001 report: lineage golden-o09-v3 (lane ops)

2026-11-17. H-111 option (c), owner-approved in `decisions/2026-11-17-wuauserv-lineage-v3.md`. Branch from master
1160cbfc. No change to v2, reset.ts or any guard. Baselines and env check wait for the orchestrator's review
(run 002).

## Diff against v2

`infra/harness-reset/lineages/golden-o09-v3.json` is a byte copy of `golden-o09-v2.json` with two edits:

```diff
-  "id": "golden-o09-v2",
+  "id": "golden-o09-v3",
@@ fs.exclude, after the last entry @@
+      },
+      {
+        "disposition": "platform_cache",
+        "base": "C:\\Windows",
+        "files": "^(?!)$",
+        "dirs": "^Temp$",
+        "dir_time_only": true,
+        "reason": "H-111/H-112 (owner, decisions/2026-11-17-wuauserv-lineage-v3.md): a trigger-started Windows Update service creates and deletes a temp file in C:\\Windows\\Temp, moving only the folder's own last-write time (Cronus282, 2026-11-17); only that time may move (same spelling and attributes); every entry inside stays compared"
       }
```

`git diff --no-index --stat`: 9 insertions, 1 deletion. The entry mirrors v2's existing `C:\Run` / `^my$`
dir_time_only entry (addendum 6). Everything else, including `golden_path_template` (the v2 golden .bak), the
survey, inventory and content references, is unchanged, so v3 restores the same golden and only its L4 tolerance and
id (hence env_fp) differ.

## Tests (written first; both failed before v3 existed)

`tests/unit/harness/lineage.test.ts`:

- "H-112: golden-o09-v3 differs from v2 only in its id and one dir_time_only C:\Windows\Temp exclusion": parses
  both files, checks the added entry field by field, then restores the id and drops the entry and asserts v3 deep-equals
  v2.
- "H-112: under v3 a C:\Windows\Temp last-write-time-only change is tolerated; ...": loads both lineages through
  `loadLineage` and `goldenReset` (the production path to `fsCaches`) and runs `fsDiff` on the measured Cronus282
  ticks (639251370082521312 -> 639304808398689679):
  - v3: the timestamp-only change is no difference; v2: the same change is one difference;
  - v3: a new file in C:\Windows\Temp, a changed silconfig.log, a new subfolder, or the folder's attributes changing
    (16 -> 18) each stay a difference.

Result: `lineage.test.ts` 21 passed, 0 failed. `deno check` and `deno lint` clean on the test file, `deno fmt` clean
on the test file. `deno fmt --check` flags the lineage JSON, as it already flags v2 (the shipped lineage files are not
deno-formatted); v3 keeps v2's formatting so the diff stays exactly the two edits.

## Next (run 002, after the review)

Per container (Cronus281, 282, 283, one at a time, >= 18 GB free, ops lease): `harness baseline create` with v3,
then `harness env check --lineage golden-o09-v3`; record the env_fp (one admissible value across the three) and stop
each container again.
