# Sweep A3 — basics-* volotests triage

Slice: all 25 `docs/volotests/basics-*` dirs. Read metadata.yaml + task.md for
every dir, skimmed every solution/ file, checked starter/ where it changed the
verdict, and grepped `tasks/` + `tests/al/` for keyword overlap against the
X-series to flag dedup risk. No container work performed; nothing outside this
report was modified.

**Structural note (applies to every dir in this slice, not repeated per-row):**
`starter/` in these volotests is a TODO-stub or partial-fixture, never a
"plausible-wrong" naive implementation (the one partial exception is
`basics-enum-wire-mapping`, called out below). None of these convert into a
reasoning-suite diagnose task by reusing `starter/` as the naive fixture —
every "convert" verdict below assumes hand-authoring a fresh naive fixture
from the domain, using `solution/` as reference-correct and the prose gotchas
already spelled out in `task.md`/`metadata.yaml` hints as the defect menu.

## Summary table

| Dir | Convert | Category angle | Reasoning 1-5 | Distractor |
|---|---|---|---|---|
| basics-add-page-field | NO | — | 1 | GOOD |
| basics-add-table-field | NO | — | 1 | GOOD |
| basics-archive-copy | MAYBE | 1 (TransferFields/FlowField gap) | 4 | GOOD |
| basics-block-negative-credit | NO | — | 1 | GOOD |
| basics-collection-deep-copy | MAYBE | 1/8 (reference-type shallow copy) | 3 | GOOD |
| basics-confirm-when-needed | MAYBE | 8 (3-branch spec inference) | 3 | GOOD |
| basics-datetime-sql-tolerance | YES | 8/9 (boundary + 0DT induction) | 4 | GOOD |
| basics-enum-wire-mapping | YES | 1 (starter's case-stmt is a ready-made naive) | 4 | GOOD |
| basics-field-translations | YES | 1 (wrong Delete overload, Get-before-Set) | 4 | OK |
| basics-hello-world | NO | — | 1 | GOOD |
| basics-image-thumbnail | MAYBE | 8/9 (rounding direction, clamp) | 4 | OK |
| basics-insert-defaults | NO | — | 1 | GOOD |
| basics-item-priority-enum | NO | — | 1 | GOOD |
| basics-line-default-from-item | YES | 1+6 (event subscriber choreography) | 4 | GOOD |
| basics-number-series | YES | 1 (GetNextNo/PeekNextNo confusion) | 4 | OK |
| basics-record-copy-semantics | YES | 1 (Copy ShareTable semantics) | 4 | GOOD |
| basics-record-link-notes | YES | 1 (CalcFields/Type-filter/Company-scope gotchas) | 4 | OK |
| basics-runtrigger-contract | MAYBE | 1 (RunTrigger dual-path) | 4 | GOOD |
| basics-safe-code-copy | NO | — | 1 | GOOD |
| basics-stream-line-reader | YES | 1/8 (byte-level CRLF/LF parsing) | 4 | GOOD |
| basics-systemid-crossref | MAYBE | 1 (idempotent migration + rename-survival) | 4 | OK |
| basics-timezone-unix | NO | — | 2 | OK |
| basics-uri-builder-endpoints | MAYBE | 1 (SetPath vs AddQueryParameter escaping) | 3 | GOOD |
| basics-validate-recalc | NO | — | 1 | GOOD |
| basics-variant-dispatch | YES | 1 (probe-ordering hazard) | 4 | GOOD |

**Totals: YES 9 / MAYBE 7 / NO 9. Distractor: GOOD 19 / OK 6 / POOR 0.**

---

## Per-dir verdicts

### basics-add-page-field
Page ext + table ext binding a `"Custom Field"` control to the Customer Card.
Object shape: 2 objects (page ext, table ext), trivial 1:1 binding.
- convert: **NO** — no interaction beyond declarative binding; nothing to plant a defect in.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD** — clean, self-contained, standard CRUD-binding pattern.
- dedup notes: shares its table-ext piece verbatim with `basics-add-table-field`; don't use both in the same composite prompt (near-identical filler).

### basics-add-table-field
Table ext adding one `Text[50]` field to Customer.
- convert: **NO** — single field declaration, zero interaction.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD** — about as minimal as filler gets.
- dedup notes: see above (add-page-field).

### basics-archive-copy
Codeunit `"Contract Archiver"` + 3 tables (`Rental Contract`, `Rental Charge`,
`Rental Contract Archive`). `Archive()` does `CalcFields` → `TransferFields`
→ manual `"Total Charges"`/`"Archived On"` stamp → `Delete`. Real 4-object
choreography with two documented TransferFields gotchas (never calculates a
FlowField, never runs OnValidate) plus a negative-legacy-fee edge case.
- convert: **MAYBE**, category 1. Angle: plant the defect in the
  FlowField-not-recalculated or OnValidate-skip corner specifically (e.g.
  archiver reads `"Total Charges"` before `CalcFields`, or omits the manual
  reassignment so the archive silently keeps 0).
  Oracle sketch: seed a contract with charge lines + a negative legacy fee,
  call `Archive`, add another charge line after, assert archive `"Total
  Charges"` didn't move and negative fee round-tripped raw.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD** — realistic, self-contained archive pattern.
- dedup notes: **real overlap** with `tasks/hard/CG-AL-X033-transferfields-bynumber.yml`
  (TransferFields-by-field-number, already shipped) and
  `tasks/hard/CG-AL-X046-borrowed-identity.yml` (TransferFields + SystemId
  preservation). Neither X033 nor X046 touches the FlowField-not-calculated
  or OnValidate-skipped angles this app's task.md documents — if converting,
  restrict the defect to those two specifically or the task duplicates
  existing suite content.

### basics-block-negative-credit
Table ext + single `OnValidate` trigger rejecting negative decimals.
- convert: **NO** — one field, one trigger, no interaction to corrupt.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD**.

### basics-collection-deep-copy
Codeunit with `CopyMatrix`/`CopyGroups` over `List of [List of [...]]]` /
`Dictionary of [Code, List of [Text]]`. Point: `List`/`Dictionary` are
reference types, so `:=` or `GetRange` produce a shallow copy that leaks
mutations back to the source.
- convert: **MAYBE**, category 1/8. Angle: naive fixture uses `Result :=
  Source` or `Result := Source.GetRange(1, Source.Count())` for the outer
  copy — passes a same-shape-count assertion but fails the
  mutate-one-side-check-the-other assertion (a strong hidden-superset
  design: shown examples don't reveal the sharing bug, mutation tests do).
- reasoning-vs-syntax: 3/5 (single codeunit, but genuine AL reference-semantics reasoning, not syntax recall).
- composite/distractor potential: **GOOD**.
- dedup notes: none found (`List of`/`Dictionary of` hits in tasks/ are all unrelated JSON/RecordRef/fluent-API tasks).

### basics-confirm-when-needed
Codeunit `"Order Release Manager"`, one procedure, three branches (blank ext.
doc no. + Yes/No, filled ext. doc no. = no dialog) via `Confirm Management`.
- convert: **MAYBE**, category 8. The three-branch policy is exactly the
  "shown a subset, oracle runs the superset" shape, and the clean-path test
  (no ConfirmHandler declared) is already a strict "did you ask when you
  shouldn't" trap. Thin as a single-procedure task, though.
- reasoning-vs-syntax: 3/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found for `Confirm Management`.

### basics-datetime-sql-tolerance
Codeunit `"DateTime Change Detector"`: `IsSameMoment` (10ms SQL-rounding
tolerance, 0DT edge cases) + `ShouldResync` built on it.
- convert: **YES**, category 8/9. Very clean boundary-induction material:
  prompt could show 0/3/9ms-same, 10/20ms-different, plus the 0DT rule, and
  let the oracle probe undisclosed boundary values (exactly-10ms, both
  argument orders, both-0DT). Naive fixture = strict `=`/`<>` (which is
  literally the starter).
  Oracle sketch: table of (drift ms, expect same-moment) pairs including the
  boundary, both 0DT combinations, and a `ShouldResync` sweep with a
  never-synced record.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found.

### basics-enum-wire-mapping
Enum `"Carrier Status"` (`Extensible = true`) + codeunit `"Carrier Status
Mapper"` with 4 procedures built on `Ordinals()`/`Names()`/`FromInteger()`
reflection instead of hardcoding.
- convert: **YES**, category 1. This is the strongest single candidate in
  the slice: **the shipped starter's `FromWire` already contains a real
  naive-but-plausible bug** — a hardcoded `case` statement that works for
  every value declared today and silently returns `Unknown` for a value an
  `enumextension` adds later. That is close to a ready-made diagnose fixture:
  symptom "a carrier status the API added last month always logs as
  Unknown," naive = case-statement lookup, correct = `Ordinals()`-based
  discovery. `ToWireName` also has a real caption-vs-name trap
  (`Format(Status)` would return the translated caption, not the wire name).
  Oracle sketch: compile a test-app-local `enumextension` adding a new
  value with its own ordinal + a caption that differs from its name, assert
  all four procedures handle it with zero code awareness of it.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found (`enumextension`/`Ordinals()` hits elsewhere are unrelated ErrorInfo/E003 material).

### basics-field-translations
Table `"Localized Product"` + codeunit `"Product Translations"` wired to the
System App `Translation` module (per-record/field/language store keyed by
SystemId). Multiple documented gotchas: must `Insert` before attaching
translations, 3-arg `Get`/`Set` (language-specific) vs 2-arg (session
language) overload confusion, and — the sharpest one — `Translation.Delete`
has an overload that takes a table ID and wipes **every** record's
translations, vs the record overload that scopes to one row.
- convert: **YES**, category 1. Angle: plant the wrong-overload bug in
  `OnDelete` (`Translation.Delete(Database::"Localized Product")` instead of
  `Translation.Delete(Rec)`) — symptom "deleting one product wiped every
  other product's translations too." Alternative angle: `GetDescription`
  using the 2-arg session-language overload instead of the 3-arg one, so a
  German lookup silently returns the session-language translation instead.
  Oracle sketch: insert 2 products each with 2 languages, delete one,
  assert the other product's translations (queried via the module's own
  `GetTranslations`) are untouched while the deleted one's are gone.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **OK** — self-contained but pulls in the System Application `Translation` module, a heavier dependency footprint than most of this slice.
- dedup notes: none found (`Codeunit Translation` unused elsewhere in tasks/tests).

### basics-hello-world
Single-procedure greeter codeunit.
- convert: **NO** — as syntax-trivial as the suite gets.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD** — maximally safe, recognizable filler.

### basics-image-thumbnail
Codeunit `"Thumbnail Generator"` over the System App `Image` codeunit:
proportional resize, half-up rounding, 1-pixel floor clamp, no-upscale rule,
error on non-image input.
- convert: **MAYBE**, category 8/9. Rich boundary-condition menu already
  spelled out with worked numeric examples (64→26, 15→8, 41→16 — a fraction
  just under one half must round down). Good hidden-superset material: show
  2-3 worked cases, let the oracle probe a random `MaxDimension` plus the
  1-pixel-floor and exact-square edge cases.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **OK** — needs the System App `Image` codeunit + real PNG fixture bytes for its own tests, more setup than most filler.
- dedup notes: none found.

### basics-insert-defaults
Table ext + `OnBeforeInsert` stamping two blank-only defaults.
- convert: **NO** — one trigger, two independent `if`s, no interaction.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD**.

### basics-item-priority-enum
Enum + table ext field with `InitValue`.
- convert: **NO** — pure declarative wiring.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD**.

### basics-line-default-from-item
Two table exts (Item, Sales Line both add `"Quality Grade"`) + a codeunit
subscribing to `"Sales Line".OnAfterAssignItemValues` to copy the grade
**unconditionally** — including clearing it when the new item has none.
- convert: **YES**, category 1 and 6 (event-driven wiring). 3-object
  choreography via an integration event, and the task.md explicitly
  telegraphs the naive mistake: a subscriber that only copies when the
  item's grade is non-blank (a very plausible "why would I copy nothing"
  instinct) fails the "re-validating to a grade-less item must clear the
  line" case while passing everything else.
  Oracle sketch: create item A (grade "PREMIUM") and item B (no grade),
  validate a sales line "No." to A then to B, assert the line's grade
  follows exactly (set, then cleared) — plus a third re-validation back to
  A to catch a subscriber that only fires once.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found (`OnAfterAssignItemValues` not used elsewhere in tasks/tests).

### basics-number-series
Table `"Workshop Order"` + Business Foundation `"No. Series"` module.
`OnInsert` draws a number only when `"No."` is blank; `PeekNextOrderNo` must
use `PeekNextNo`, not `GetNextNo` — the hint literally says "if you reach for
GetNextNo there instead, every peek consumes a number... the tests catch
exactly that."
- convert: **YES**, category 1. About as crisp a single-defect diagnosis
  task as this slice offers: naive = `PeekNextOrderNo` implemented with
  `GetNextNo`, correct = `PeekNextNo`. Symptom: "an order inserted right
  after a UI preview call gets a later number than the preview showed."
  Oracle sketch: create the WORKSHOP series with a random starting number,
  call `PeekNextOrderNo()` twice (must return the same value both times),
  then insert a blank-numbered order and assert it got exactly that peeked
  number.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **OK** — needs Business Foundation dependency + a `"No. Series"`/`"No. Series Line"` seed in every test, heavier setup than most filler.
- dedup notes: none found (no other task touches `"No. Series"`).

### basics-record-copy-semantics
Codeunit `"Buffer Copy Service"` over temporary `"Name/Value Buffer"`:
`TakeSnapshot` (must deep-copy row by row) vs `AttachSharedView` (must use
`Copy(..., true)`). The task.md itself names the exact bug: "a teammate
implemented both with the same one-liner."
- convert: **YES**, category 1. Naive fixture = both procedures call
  `Copy(Source, true)` — passes a same-content-right-now check, fails the
  "mutate source after snapshot, snapshot must not move" check. Strong
  hidden-superset shape (surface behavior identical until the follow-up mutation).
  Oracle sketch: seed rows into `Source`, call `TakeSnapshot`, insert/modify/delete in
  `Source` afterward, assert `Snapshot` unchanged; call `AttachSharedView`,
  write through `SharedView`, assert `Source` shows it.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found (`ShareTable` unused elsewhere in tasks/tests).

### basics-record-link-notes
Codeunit `"Record Note Manager"`, 5 procedures over the system `"Record
Link"` table + base `"Record Link Management"` codeunit: BLOB note
encoding, `CalcFields(Note)` required before read, `Type`-filtering for
counts, `Company`-scoped dangling-link sweep via `RecordRef.Get`.
- convert: **YES**, category 1. Richest single-object candidate in the
  slice — at least three independently plantable defects: (a) `ReadNote`
  omits `CalcFields(Note)` before handing the record to the module reader
  (returns empty for a real note), (b) `CountNotes` forgets the `Type =
  Note` filter (counts web links too), (c) `DeleteDanglingLinks` sweeps
  without the `Company` filter (deletes another company's live links) or
  checks only `Customer` records instead of any table via `RecordRef`.
  Oracle sketch: write a note, read it back via the *module's own* `ReadNote`
  as an independent oracle (task.md already does this — good practice to
  keep); seed a foreign-company dangling link and a same-company live link,
  sweep, assert exactly the right one is gone.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **OK** — touches the system `"Record Link"` table directly, a more exotic/global object than most filler; fine standalone but avoid stacking two dirs that both poke system tables in one composite.
- dedup notes: none found.

### basics-runtrigger-contract
Table `"Loyalty Member"` (unconditional `OnInsert`/`OnModify` stamps) +
codeunit `"Member Registration"` with 4 procedures, each choosing `RunTrigger
= true` or `false` on `Insert`/`Modify`.
- convert: **MAYBE**, category 1. Natural fit on its face — swap one call's
  boolean (e.g. `MigrateMember` calls `Insert(true)` instead of `false`, so
  imported audit dates get silently overwritten) — but real dedup risk (see
  below). If converted, the differentiator should be the **4-method dual
  contract in one codeunit** (register/migrate/update/patch all coexisting,
  with the table's triggers doing unconditional stamping either way), not
  the single "did you pass RunTrigger at all" question X009 already tests.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: **real overlap** with `tasks/medium/CG-AL-X009-insert-runtrigger.yml`
  (RunTrigger boolean deciding whether `OnInsert` computes a field). X009
  tests one insert path; this app's unique value is the 4-call dual-path
  matrix across both Insert and Modify — narrow to that if authored.

### basics-safe-code-copy
Codeunit, one procedure, `CopyStr(Input.Trim(), 1, 20)`.
- convert: **NO** — a single expression, no interaction, no branch.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD**.

### basics-stream-line-reader
Codeunit `"Stream Line Reader"`: byte-level `InStream` walk distinguishing
LF/CRLF, blank lines, and a present-vs-absent trailing terminator. Task.md
explicitly documents the naive bug: `while not EOS do ReadText(Line)` can't
tell a blank line from end-of-stream.
- convert: **YES**, category 1/8. Naive fixture = the `ReadText`/`EOS` loop
  named in the prose — passes simple LF-only, single-line cases, fails
  blank-line and no-trailing-terminator cases. Strong hidden-superset shape.
  Oracle sketch: payloads for CRLF-only, LF-only, mixed, single blank line,
  consecutive blanks, trailing-terminator-present vs absent, empty stream,
  bare-LF (one empty line) — exactly what the shipped tests already cover,
  reusable near-verbatim as the oracle superset.
- reasoning-vs-syntax: 4/5 (stream-API knowledge is syntax-adjacent, but the edge-case enumeration is genuine reasoning).
- composite/distractor potential: **GOOD**.
- dedup notes: none found.

### basics-systemid-crossref
Table `"Customer Bookmark"` + codeunit `"Customer Bookmarks"`, 4 procedures:
`AddBookmark`/`ResolveCustomer` (SystemId survives rename),
`ImportBookmark` (caller-supplied SystemId via 2-bool `Insert` overload),
`MigrateLegacyBookmarks` (idempotent: `IsNullGuid` guard so already-migrated
or already-stale-but-migrated rows are never re-touched).
- convert: **MAYBE**, category 1. Rich 4-procedure table+codeunit
  choreography with a genuinely subtle idempotency invariant ("a migrated
  row whose stale number now belongs to a different customer must NOT be
  repointed"), but real dedup risk (below). If converted, anchor the defect
  in the migration-idempotency or rename-survival angle specifically —
  neither is covered by the existing overlapping task.
  Oracle sketch: seed one legacy row resolvable to a customer, one pointing
  at a vanished customer, one already-migrated row whose stored number was
  since taken by a different customer; migrate; assert exactly the first is
  counted+filled, the vanished one stays empty and uncounted, the
  already-migrated one is untouched even though its stale number now
  resolves to someone else.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **OK** — medium complexity, more elaborate than typical filler but still self-contained.
- dedup notes: **real overlap** with `tasks/hard/CG-AL-X046-borrowed-identity.yml`,
  which already tests "copy a row's SystemId onto a new row via the 2-bool
  `Insert` overload." This app's `ImportBookmark` is the same mechanic.
  The non-overlapping angles are `ResolveCustomer`'s rename-survival lookup
  and `MigrateLegacyBookmarks`'s idempotency guard — narrow to those.

### basics-timezone-unix
Codeunit `"Time Zone Toolkit"`, 5 procedures, each a near-1-line wrapper
around System App `"Time Zone"` / `"Unix Timestamp"` codeunits.
- convert: **NO** — every procedure is "call the one right SDK method";
  correctness is almost entirely "did you know the API exists" rather than
  multi-step reasoning. A sign-flip defect (`ToLocalTime` subtracting the
  offset instead of adding) is plausible but thin as a standalone task.
- reasoning-vs-syntax: 2/5
- composite/distractor potential: **OK** — clean but pulls in two System App codeunits; fine as filler, not spectacular.

### basics-uri-builder-endpoints
Codeunit `"Endpoint Url Builder"`, 3 procedures over System App `"Uri
Builder"`/`Uri`. Core trap: `AddQueryParameter`/`AddQueryFlag`
percent-encode automatically, but `SetPath` treats its argument as raw path
syntax — a value spliced into a path segment needs `EscapeDataString` by
hand.
- convert: **MAYBE**, category 1. Naive fixture = `ItemCardUrl` passing
  `ItemNo` straight to `SetPath` without escaping (every other call site in
  the same codeunit is auto-encoded, so this omission is easy to miss and
  matches difficulty lever #2 — a red herring that "reads suspicious but is
  correct" elsewhere in the same file makes the real gap easy to skip).
  Oracle sketch: `ItemCardUrl` with an item number containing `&`, `=`, `+`,
  and a non-ASCII letter; assert the returned URL matches the exact
  percent-encoded path segment.
- reasoning-vs-syntax: 3/5
- composite/distractor potential: **GOOD**.
- dedup notes: none found.

### basics-validate-recalc
Table ext, one `OnValidate` trigger recalculating `"Suggested Price"` with
half-up rounding to 0.01.
- convert: **NO** as a standalone task — single trigger, single formula, too
  small to host a planted interaction defect. The two worked rounding
  examples (36.663→36.66, 39.996→40.00) are decent raw ingredient for a
  category-9 (rounding/allocation invariants) task if combined with other
  material, but not on their own.
- reasoning-vs-syntax: 1/5
- composite/distractor potential: **GOOD**.

### basics-variant-dispatch
Codeunit `"Variant Formatter"`: `FormatValue`/`TryFormatValue` dispatch a
`Variant` via `Is<Type>()` probes to a canonical `"<Type>: <payload>"`
string. Task.md flags the exact hazard: probes are not mutually exclusive
(`IsCode` also answers `IsText` true; `IsOption` also answers `IsInteger`
true), so probe order determines correctness.
- convert: **YES**, category 1. Textbook match for difficulty lever #2
  ("two candidate causes where only one is real"): naive fixture checks
  `IsInteger` before `IsOption`, or `IsText` before `IsCode` — passes every
  case except a Code or Option payload, which get mistagged. Also a
  `Format(Value)` (1-arg, locale-sensitive) vs `Format(Value, 0, 9)`
  (invariant) trap for Decimal/Date.
  Oracle sketch: format an Option value from a 2-member and a 5-member
  option list at different positions, a Code value assigned from lowercase
  text, and a Decimal — assert exact tagged strings; separately assert
  `TryFormatValue` on an unsupported type clears stale `FormattedValue` to
  empty rather than leaving it untouched.
- reasoning-vs-syntax: 4/5
- composite/distractor potential: **GOOD**.
- dedup notes: `tasks/easy/CG-AL-E056-totext-simple-types.yml` also formats
  simple types via `Format(..., 0, 9)` for invariant text, but its
  parameters are statically typed (no `Variant`, no probe-ordering
  ambiguity) — different mechanism, no real overlap.
