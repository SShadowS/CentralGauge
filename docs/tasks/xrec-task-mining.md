# Rec/xRec Task Mining — DocumentOutput.Cloud

Tracking doc for benchmark-task candidates harvested from
`u:\Git\DO.Support-Reviewer1\DocumentOutput\Cloud\` first-party AL code.

Goal: produce HARD-tier `tasks/hard/CG-AL-H*` benchmarks that exercise
non-obvious Rec/xRec semantics. Drive task selection from real
production code instead of inventing patterns.

Source scope: 12 first-party files under `Cloud\Al\`, 23 explicit
`xRec` occurrences plus surrounding `Rec` context. Vendor base
(`Cloud\.dependencies\CDO\`) intentionally excluded; revisit if we run
out of first-party material.

## Status legend

- `[ ]` open — not started
- `[~]` in progress — task YAML or spike underway
- `[x]` done — task committed and benched
- `[-]` rejected — investigated and dropped (record reason)

## Aggregate tally

| Bucket | Count |
|---|---|
| TRIVIAL_REC | 105 |
| TRIVIAL_XREC | 8 |
| INTERESTING_XREC | 23 |
| HARD_XREC | 10 |
| UNCLEAR | 14 |

## HARD candidates (verifiable, ready to spec)

| ID | Status | Owner | Source | Pattern | Test sketch |
|----|--------|-------|--------|---------|-------------|
| H1 | `[ ]` | — | `Extension App.al:61` (OnValidate Min) | xRec used on BOTH validated field (Min) and unvalidated field (Max) to preserve span width. `Diff := xRec.Max - xRec.Min; Max := Min + Diff;` | Insert Start=100/End=200; validate Start:=150 → assert End=250. Validate Start:=50 → assert End=150. Then validate End directly → assert Start unchanged. |
| H2 | `[ ]` | — | `Template Line.al:466-470` (OnRename) | OnRename PK cascade. `while FindFirst()` (not `repeat...Next()`) because Rename mutates the filter set. Filter by `xRec`, rename to `Rec` PK. | Parent with 3 children; rename parent; assert 0 rows under old code, 3 under new code, ordering preserved. |
| H3 | `[ ]` | — | `Recipient Setup Page.al:114-115` (OnNewRecord) | Page-level `OnNewRecord(BelowxRec: Boolean)`. xRec populated BEFORE insert (opposite of table OnInsert). Three branches: IsEmpty / BelowxRec=true / BelowxRec=false. | Insert via TestPage in empty filtered view → assert seq='1'. Insert below existing → assert seq=IncStr(prior). Insert above → assert seq derived from FindLast in group. |
| H4 | `[ ]` | — | `CDO Setup Page.al:191` (Log Storage Type OnValidate) | Page-level (NOT table-level) field OnValidate using xRec. `CurrPage.Update(false)` preserves the snapshot; `Update(true)` would clobber it. | Open page on existing row, change value → notification fires once. Change then revert in same session before save → no notification. |
| H5 | `[ ]` | — | `CDO Setup Table.al:297, 321, 534` (Azure account/container OnValidate) | Combined `("" OR xRec<>Rec)` guard + post-guard `LowerCase(Rec)` mutation + cross-company `ChangeCompany` duplicate check. Sequencing-sensitive: lowercase MUST run before the helper. | Seed company B with `("acct1","cont1")`. In company A, validate account="ACCT1" with existing container="cont1" → expect duplicate error AND row in A is lowercased. Reorder lowercase after helper → test fails. |

## UNCLEAR — spiked in BC v28 (Cronus28), verdicts below

Spike app: `spikes/xrec/` + `spikes/xrec/run-spike.ps1`. Runs against
Cronus28. To re-run: `pwsh -File U:\Git\CentralGauge\spikes\xrec\run-spike.ps1`.

| ID | Status | Source | Verdict | Promotion |
|----|--------|--------|---------|-----------|
| U1 | `[x]` spiked | `eDocs Send Code Migration.al:512-521` | **CONFIRMED.** In `Customer.OnAfterModifyEvent`, `xRec.<extField>` is synced with `Rec.<extField>` BEFORE the event fires. Spike showed both `Rec.Ext=NEW; xRec.Ext=NEW` after a modify that changed only the extension field. Author's load-bearing comment is correct. The classic `xRec<>Rec` compare is INERT for tableextension fields. | **→ H-task candidate.** See H6 below. |
| U2 | `[x]` spiked | `Customer tableextension.al:26` | xRec is a stable snapshot. A mid-trigger `Rec.Modify()` does NOT refresh xRec. Spike: `before-Modify: xRec.Watched=1`, `after-Modify: xRec.Watched=1` (Rec.Watched=2 throughout). | **Demoted to INTERESTING.** Worth a M-task on snapshot stability under mid-trigger writes; not HARD. |
| U3 | `[x]` spiked | `E-Seal Setup.al:114-146` | **CONFIRMED LEAK.** `SetSecret` pattern (CreateGuid + IsolatedStorage.Set + no Modify) writes a fresh GUID into IsolatedStorage but does NOT persist the GUID to the row. Re-Get returns null GUID, so the IsolatedStorage entry is orphaned. Compare to `CDO Setup Table.al:580` which DOES call `Modify(false)`. | **Source bug, not a task.** Report upstream to DocumentOutput.Cloud. |
| U4 | `[x]` spiked | `CDO Subscribers.al` × 7 | **CONFIRMED.** BC fires `OnAfterValidateEvent` on no-op revalidate (validating a field to its current value). Spike: 1st Validate fires=2 (val+mod events), 2nd Validate same value also fires=2. xRec.Name=Rec.Name on the no-op call, so `xRec<>Rec` gate WOULD short-circuit correctly. | **→ H-task candidate.** See H7 below. |

## Additional HARD candidates promoted from spiked U's

| ID | Status | Owner | Source / Pattern | Test sketch |
|----|--------|-------|------------------|-------------|
| H6 | `[ ]` | — | U1: `xRec` for tableextension fields in `OnAfterModifyEvent` on a base table is INERT (xRec=Rec at event-fire time). Task asks for an `OnAfterModifyEvent` subscriber that performs a side-effect ONLY when a custom tableextension field actually changed. | Subscribe to `Customer.OnAfterModifyEvent`. Modify only an unrelated base field → assert side-effect did NOT fire. Modify the extension field A→B → assert side-effect fired exactly once. Gating via `xRec.<extField> <> Rec.<extField>` is ALWAYS false → fails. Forces model to use `OnBeforeModifyEvent` snapshot or an explicit before-write capture. |
| H7 | `[ ]` | — | U4: `OnAfterValidateEvent` fires on no-op revalidate. Subscriber must perform work only on actual change. | Subscribe to `Customer.OnAfterValidateEvent` for `Name`. Validate to new value → counter increments. Re-validate same value → counter must NOT increment. Forces `if xRec.Name = Rec.Name then exit;` gate at top of subscriber. Naive subscriber (no gate, like the 7 in CDO Subscribers.al) double-fires. |

## INTERESTING (medium-tier candidates)

| ID | Status | Source | Pattern |
|----|--------|--------|---------|
| I1 | `[ ]` | `Template Line.al:1683-1700` | `CalcFields` ALL BLOBs before `Target := Source` — record-value-copy doesn't auto-load BLOBs. |
| I2 | `[ ]` | `Recipient Setup Page.al:141-163` | MoveUp/MoveDown rename-via-Delete+Insert. `Insert()` no-arg skips OnInsert trigger; `Insert(true)` would fire it. |
| I3 | `[ ]` | `Customer Setup.al:34` & `Customer tableextension.al:131` | Directional Manual→Automatic state transition. Trap: blank-init xRec on Insert defaults to Manual=0 → guard fires on first insert too. |
| I4 | `[ ]` | `CDO Subscribers.al:86, 223` & `CDO Setup Table.al:580+` | `Modify(false)` to break OnModify recursion when modifying inside an event subscriber that fires from another modify. |

## Recommended order

All four U's spiked (`spikes/xrec/`). Verdicts in table above. New work:

1. **H1, H2, H3, H4** — clean specs, well-isolated. One task-pair per
   session (YAML + test + bench).
2. **H6** — promoted from U1 (xRec inert for tableext fields in
   OnAfterModifyEvent). Highest learning value: forces models to
   choose `OnBeforeModifyEvent` snapshot pattern.
3. **H7** — promoted from U4 (OnAfterValidate fires on no-op revalidate).
4. **H5** — cross-company `ChangeCompany` is fiddly to test in a single
   container; defer.
5. **I1-I4 + U2 (demoted)** — medium-tier, batch as M-tier follow-up.
6. **U3** — not a task. File upstream issue against DocumentOutput.Cloud
   for the orphaned-IsolatedStorage leak in E-Seal Setup.

## Per-file detailed findings

Detailed audit records per file (line, snippet, classification reason,
task idea) are in the agent transcripts. If a deeper re-read is needed,
re-spawn the agents with the prompt template documented in the session
transcript at `C:\Users\SShadowS\.claude\projects\U--Git-CentralGauge\ad80f248-edad-483c-ac3a-1429f470853e.jsonl`.

### Per-file tally (totals)

| File | TR | TX | IX | HX | U |
|------|----|----|----|----|---|
| Extension App | 29 | 0 | 0 | 1 | 0 |
| Customer Setup | 0 | 0 | 1 | 0 | 0 |
| E-Seal Setup | 6 | 1 | 2 | 0 | 5 |
| MergeField | 3 | 1 | 1 | 0 | 0 |
| Template Header | 8 | 1 | 1 | 0 | 0 |
| Recipient Setup Page | 3 | 0 | 4 | 2 | 0 |
| Customer tableextension | 1 | 1 | 1 | 0 | 1 |
| Template Line | 24 | 0 | 2 | 3 | 2 |
| CDO Setup Page | 10 | 0 | 3 | 1 | 0 |
| CDO Setup Table | 15 | 0 | 5 | 3 | 0 |
| Send Code Migration | 6 | 0 | 1 | 0 | 2 |
| CDO Subscribers | 0 | 4 | 2 | 0 | 4 |

## Cross-session notes

- Source project `u:\Git\DO.Support-Reviewer1\DocumentOutput\Cloud\` is
  external; we are READING it for inspiration, not modifying it.
  Any production-bug findings (U3 candidate) should be reported
  upstream, not patched here.
- Vendor `.dependencies\CDO\` (8 more files with xRec) excluded from
  this round; revisit if first-party seam runs dry.
- When writing the actual task YAMLs in `tasks/hard/CG-AL-H*-*.yml`,
  follow the no-guiding-notes rule from `CLAUDE.md`. The U/H notes
  here are mining context, NOT task description text.
- Each H task likely needs a prereq app under
  `tests/al/dependencies/CG-AL-H<id>/` (table to extend, parent table
  for cascade, etc.). See `.claude/rules/prereq-apps.md` for the
  convention.
