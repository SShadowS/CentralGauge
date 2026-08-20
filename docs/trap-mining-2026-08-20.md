# Trap-task mining run, 2026-08-20

Source: DevOpsWorker pipeline Postgres (`postgres://pipeline:pipeline@localhost:5432/pipeline`).
Scope: candidate discovery only. No task YAML, no AL, no container time.
Next free ids: **X055 and up** (`scratch/CG-AL-X053` and `X054` are scaffolded but empty).

## Headline

The vein named in the brief runs thin, and one third of it does not exist. But the corpus
as a whole is **more productive than the brief expects**, because the useful signal is not
where the brief points. It is in the 2178 unclassified reviewer findings, and the test that
matters is recurrence across unrelated repos rather than any human verdict.

Net result: **nine candidates worth building now**, one strong unverified lead, nine more
that are real but thinner, nothing left blocked on measurement, and two strong candidates
that turned out to be traps the suite already ships.

All three open questions have since been settled, two of them by a container probe
(`scratch/probe-testenv/`, run on Cronus28, cleaned up afterwards). Both flagging agents
guessed the wrong way on both: `AutoRollback` is not the default, and `GuiAllowed` is false
in the test runner. The probe also measured Tier 1 candidate #8's kernel as a by-product and
turned up a benchmark-hygiene problem that is worth its own audit.

The single best candidate by attempt-2 resistance (#9) was not found in the database at all.
It came from chasing down an agent's doubt about whether a finding was even coherent. Worth
remembering: the corpus is a source of *questions* as much as of answers.

The corpus is now closed out. Every multi-round PR has been read, including the three
largest, and the single-round surface has been swept by topic slice.

## Three corrections to the brief's map of the data

**1. `pr_reviews.inline_threads` holds no thread content.** It is a posting-stats counter:
`{stale, failed, created, updated, suggested, suggestionDropped}`. The brief's largest
proposed surface ("1777 rows ... look inside `inline_threads` for human replies") is not
reachable that way. Human reply text exists in this database only as
`finding_outcomes.said_quote`, which is **124 rows, not 1777**.

Confirmed independently against live Azure DevOps on two PRs (52971, 52312): every thread
still `active`, only the bot's comment, zero human replies. The silence is real, not a
classification gap.

**2. Vein 2 is barren.** All 64 quoted `rejected-wontfix` and `unclear` rows were read.
Project context almost without exception: "not relevant", "table was never released", "this
is by design", "we usually do not have many participation per company".

**3. There is a fourth labelled source the brief does not mention.** `reflection_proposals`
(id 1, 35-day window) holds 34 adjudications where the pipeline judged its own findings,
`verdictLabel` of `reviewer-wrong` (4), `both-defensible` (17), `unclear` (13), plus six
clustered failure modes including one named `platform-api-semantics-unchecked`. Of the four
reviewer-wrong rows, three are prior-state project context. Exactly one is platform
semantics.

## What the strongest signals actually are

**Recurrence beats severity, and beats the `said` label.** The same platform semantic
written wrong by different developers in unrelated repos is the closest thing this corpus
offers to proof that a fact is genuinely non-obvious. Severity tracks blast radius, not
difficulty. The highest-recurrence items below appear three to five times across four
repos.

**Cross-round self-retraction is the sharpest reviewer-error signal**, and no label
captures it. Only 22 of 260 PRs have more than one review round, so the seam is thin, but
it produced three reviewer errors that `finding_outcomes` would never surface. The
productive filter is round-referencing language restricted to multi-round PRs, not
retraction words.

**Retractions only happen when rounds are days apart and an author pushed back.** This is
the most useful methodological finding of the run. PR 45792 has 17 rounds, but all 17 land
inside seven hours over an unchanged diff; PR 43408's 8 rounds fall inside two hours. Both
produce consistent restatements with reworded titles, which is reviewer *variance*, not
correction, and neither contains a single retraction. PR 49388's 48 rounds span June to
August with real author pushback in between, and that is where its retraction lives. **When
mining this corpus in future, filter multi-round PRs by round spacing before reading them.**
Same-day re-runs are noise.

**The reasoning shape is more diagnostic than the retraction.** In the one case where a
platform claim was asserted, escalated, then reversed on the merits, the stated basis was
"AL does not document them as ..." plus "every other use in this repo ...". Both are
absence-of-evidence arguments, and both were wrong. Searching for that shape finds the
claims that were wrong and were never caught, which sit in `finding_outcomes` as NULL
forever.

---

## Tier 1: build these first

Each is verified, self-contained in one AL object with no Continia dependencies, plausible
as fresh output, and not already covered.

### 1. `JsonToken.IsValue()` returns true for JSON `null`

**Source:** PR 52882, a 29-minute self-correction within one PR. Found independently by
three agents.

**False belief:** `Get(key, tok) and tok.IsValue()` is a sufficient guard before
`tok.AsValue().AsText()`, because `IsValue()` screens out null.

**Correct:** null is a scalar, so `IsValue()` is true for it. `JsonValue.IsNull()` exists
("Indicates whether the JsonValue contains the JSON value of NULL"), which is only
meaningful because null tokens reach `AsValue()`. Correct guard is
`Get` then `IsValue()` then `not AsValue().IsNull()`.

**Why the gap is durable:** the `IsValue()` page says only "true if the JsonToken represents
a JSON value; otherwise, false". It never mentions null. A model reading the reference page
cannot learn the answer.

**Plausibility:** the reviewer itself recommended the naive guard in round 1 before
correcting itself in round 2. Direct evidence a capable model writes it.

**Task shape:** zero tables. `ReadTableNo(JObj: JsonObject): Integer` returning 0 when the
key is absent, when its value is null, or when it is not an integer. Oracle feeds all three.
CentralGauge already has a settled convention for the missing-key case (M020, M027), so
requiring null to behave the same states what to build without hinting at mechanism.

**The blocking unknown is RESOLVED twice over: documented, and measured on a container.**
`JsonValue.AsText()` Remarks state it outright: "**The operation will fail with a run-time
error if the JsonValue contains NULL or UNDEFINED.**" Measured on Cronus28 (BC
28.4.53241.53758-DK) against payload `{"TableNo": null, ...}`, the platform error is:

```
Unable to convert from Microsoft.Dynamics.Nav.Runtime.NavJsonValue
                    to Microsoft.Dynamics.Nav.Runtime.NavText.
```

Measured raising on null: `AsText`, `AsCode`, `AsInteger`, `AsDecimal`, `AsBoolean`.
`AsDate` was not measured but raises by its documented type-conversion clause.

**Two measured details that shape the task.** `AsValue()` itself does *not* raise on a null
token, so a naive solution runs all the way to the typed getter before dying. And every
typed getter returned its type's zero value in the `TryFunction` out-param when it raised,
which is an uninitialised out-param and must not be misread as "AsText returned empty".

**Build on `AsText()` or `AsCode()`.** Those two carry the explicit documented
NULL/UNDEFINED Remark, so the task rests on documentation rather than on one measurement.
`AsInteger`/`AsDecimal`/`AsDate` raise too, but their docs justify it through type-conversion
wording rather than naming null.

**Canonical guard, all three checks load-bearing:**

```al
if not Source.Get(PropertyName, Token) then exit('');  // absent
if not Token.IsValue() then exit('');                  // object or array
if Token.AsValue().IsNull() then exit('');             // present but JSON null
exit(Token.AsValue().AsText());
```

Microsoft documents no such pattern anywhere. Drop the third line and `{"TableNo": null}`
walks into the raise.

**The doc-silence asymmetry is what makes this durable.** The failure is documented on the
`AsText()` page. The guard is chosen on the `IsValue()` page, which never mentions null. A
model writing the guard reads the page that does not tell it, and a model debugging the
crash reads the page that does. That is a gap an error message on attempt 2 does not
obviously close, which is the property the brief asks for.

`JsonObject.Get` also returns true for a present-but-null key ("The operation will fail if
the object does not contain a property with the given Key"), so `Get` alone cannot
distinguish present-but-null from a real value.

**Dedup:** confirmed clear on a wider sweep than my own. JSON is heavily covered (M020, M021,
M024, M027, M036, H014, plus H015, H023, M005, M033) and every one tests the *missing key*.
`M027` is the closest miss: it already establishes the return-zero-rather-than-raise contract
across 18 typed getters, but only for **absence**. A null-value task is its natural sibling
and does not overlap. Repo-wide, **no committed oracle exercises `JsonValue.IsNull` at all**,
and committed oracles use the unguarded shape throughout, for example
`tests/al/hard/CG-AL-H023.Test.al`:

```al
Assert.IsTrue(JsonResult.Get('Code', JsonToken), 'Should have Code field');
TextValue := JsonToken.AsValue().AsText();
```

That is fine there, because those payloads are author-controlled and never contain null. It
does mean the suite has no existing oracle that would catch the gap.

**Why the docs keep this alive, precisely.** The `IsValue()` page is 67 words with no Remark,
no example, and no mention of null. The one disambiguating sentence lives on a different page
("A default JsonToken object contains the JSON value of NULL", on the JsonToken data-type
overview), which nobody looking up a guard would read. `JsonToken` also has no `IsNull()`
predicate to sit alongside `IsValue`/`IsObject`/`IsArray`, so the API's own shape suggests
three exhaustive cases when there are four.

**Secondary, undocumented, and worth knowing but not worth building on alone:** a `JsonToken`
left over from a *failed* `Get`, and a never-assigned `JsonToken`, both report `IsValue()` =
true. So `IsValue()` screens out neither null nor absence. This is a weaker trap than it
first appears, because a bare `Obj.Get(k, tok);` with the return value discarded *raises* on
a missing key, so reaching a default token requires the less natural
`Ok := Obj.Get(k, tok); if tok.IsValue() then ...`. Note that this is the same
consumed-return-value rule as Tier 1 candidate #4, reached from a third API family.

### 2. `Round(x)` with no precision argument rounds to a whole number

**Source:** PR 52797 (critical + major, human fixed), corroborated by PR 53419 in the same
repo with a different author. Found independently by two agents.

**False belief:** `Round()` with no second argument rounds sensibly for the value at hand.

**Correct:** the default precision is 1, so it rounds to the nearest integer and destroys
every decimal.

**Recurrence:** four instances. The reviewer notes it is house style in that codebase:
"the nearby VAT-amount scaling uses the same precision-less `Round()`, so this may be
following existing house style, but the house style is losing cents on currency fields."

**Plausibility:** very high. A discount rate `(1000 + 20) / 1000 = 1.02` stores as `1`.
Every realistic discount produces exactly 1. A paid BC developer shipped this twice.

**Task shape:** pure arithmetic in one codeunit, zero tables, asserted against exact
decimals. A proportional-split or rate calculation where the naive `Round(x)` collapses the
answer.

**Dedup:** `CG-AL-H009` covers currency rounding but *tells* the model to use precision
fields and even names `Round(Amount, Precision, Direction)`. It teaches the argument rather
than testing whether the model knows the default. Not a duplicate; arguably H009's existence
is why this gap is worth probing.

### 3. `MaxStrLen` on an unbounded `Text` returns the platform maximum

**Source:** PR 52855.

**False belief:** `CopyStr(value, 1, MaxStrLen(TargetVar))` bounds the value safely whatever
`TargetVar` is declared as.

**Correct:** on an unbounded `Text`, `MaxStrLen` returns the platform maximum, so the
`CopyStr` is a no-op and the value lands unguarded in the sized destination. The bound must
come from the sized destination, not an intermediate variable.

**Plausibility:** the defensive-truncation idiom is written from scratch constantly, and
which variable to measure is a fresh decision every time. The bug is invisible: the code
looks correct and contains the right function.

**Task shape:** one codeunit, one unbounded `Text` local, one `Text[n]` target, assert the
resulting length or the overflow. No tables.

**Dedup:** zero coverage. No task references `MaxStrLen`. `X013` is Code[10] concatenation
overflow, a different mechanism.

### 4. A consumed return value suppresses the runtime error on Boolean built-ins

**Source:** PR 52304 (`Insert()`), PR 52473 (`ChangeCompany`, and this one is a
**reviewer-error** with a `rejected-wrong` human verdict), PRs 52747 and 49388 (`Evaluate`,
asserted in two consecutive rounds).

**False belief:** the failure mode of these built-ins does not depend on how they are
called.

**Correct:** when the Boolean return value is consumed (assignment, `if`, `exit(...)`), AL
suppresses the error and returns false. The bare-statement form raises. The human's
correction on 52473: "ChangeCompany() in this case would raise a runtime error, it does not
silently stay on the old company."

**Why this is Tier 1:** it fires in both directions and both are documented in the corpus.
The reviewer got the *unguarded* case backwards while stating the guarded rule correctly two
paragraphs earlier in the same finding. That is a model holding half the rule.

**Companion fact, same family:** a failed `Evaluate` leaves the target holding its
*previous* value rather than clearing or throwing. PR 52747: "a malformed entry for
iteration *i* makes the task silently refresh iteration *i-1*'s record a second time, and
report success."

**Independent documentary confirmation that this is a general AL calling convention, not a
per-method quirk.** `JsonObject.Get`'s own return-value documentation states the rule
explicitly: "**If you omit this optional return value and the operation does not execute
successfully, a runtime error will occur.**" That is the same semantic reached from a
completely different API family, which makes the rule safe to build a task on even before
any container work.

**Task shape:** one codeunit plus `asserterror`. No tables required.

**Verify first:** confirm on a container that `ChangeCompany` to a nonexistent company
raises in the statement form. The general rule is documented, but the human's claim is the
only evidence for that specific built-in, and the guarded/unguarded distinction is the whole
trap.

### 5. `Find()` positions on the current key, not on the non-key field you just assigned

**Source:** PR 52953, restated in four consecutive rounds and never retracted. Found
independently by two agents.

**False belief:** assigning a field and calling `Find()` looks the record up by that field.

**Correct:** `Find()` positions using the current key and active filters. A value assigned
to a non-key field is ignored. On `Name/Value Buffer` (table 823, keyed on `ID`) the call
matched unconditionally after the first insert, so "only the first combine group in a run
was ever dispatched". Non-key lookup needs `SetRange` plus `FindFirst`.

**Plausibility:** very high, and it fails silently rather than erroring. "Skip keys already
processed using a buffer table" invites `Buffer.Name := Key; if not Buffer.Find() then ...`
as fresh output.

**Task shape:** an invented two-field table with the lookup field outside the key. Assert
the dedup actually dedups.

**Note:** severity triage buried this at minor because the reviewer was arguing about a code
comment. The platform fact underneath is sharp and survived four rounds of pushback. This is
the clearest case in the corpus of severity being the wrong ranking signal.

### 6. `TestField(Field, Value)` asserts equality, and `TestField(Field, '')` inverts

**Source:** PR 52927, `rejected-wrong`, **and an explicit reviewer self-retraction**.
Verified verbatim against Microsoft Learn.

**This is the strongest-evidenced item in the set.** The reviewer did not merely get
corrected by a human; it retracted in writing a day later: "the author's rebuttal is correct
and **my earlier reasoning was inverted**: `TestField(field, 0)` asserts equality with zero,
so those guards show zero-valued rows exist rather than that the field is mandatory. ... No
finding here." A model stating its own inverted belief and then naming the inversion is as
clean a knowledge-gap record as this corpus produces.

**False belief:** a `TestField(field, 0)` guard proves the field is mandatory. The reviewer:
"the proposal line table's own `TestField("ID Applied-Entry", 0)` guards show it is
mandatory."

**Correct:** "If the test fails, that is, if the field doesn't contain the specified value,
an error message is displayed." So `TestField(f, 0)` asserts f **equals** zero. The
single-argument form separately "Tests that the content of the field is not zero or blank".

**The sharper documented inversion:** "**If the value that you test against is an empty
string, the field must have a value other than blank or 0 (zero).**" So `TestField(f, '')`
means "must NOT be blank", the opposite of how the call reads. On an Option or Enum,
`TestField(EnumField)` errors when the ordinal is 0, so it rejects exactly the records that
hold the first enum value.

**Task shape:** one invented table plus an enum. Oracle asserts both directions.

**Dedup:** zero two-argument `TestField` calls anywhere in `tests/al/`.

### 7. `Get()` always populates primary-key fields regardless of `SetLoadFields`

**Source:** PR 49388, which holds **three mutually exclusive positions on one API in a
single review log**. Corroborated independently in PR 52882.

**The three-way spread**, in order:
1. "`Name` is the PSP Agreement's primary key field ... Because it was not included in
   `SetLoadFields`, it will be empty at runtime ... the entire PSP import pipeline silently
   does nothing." Posted at **Critical**.
2. "In AL, `Get()` always retrieves all fields regardless of `SetLoadFields`, the restriction
   only applies to `FindSet`/`FindFirst`/`FindLast`. The call is harmless but misleading."
3. The surviving position: `SetLoadFields` does narrow `Get()`, **but primary-key fields ride
   along regardless**. Position 1 was withdrawn explicitly as "a **false positive**, in AL
   `Record.Get()` always populates primary key fields".

Corroborated from a different PR: "`RecRef.SetLoadFields(RecRef.SystemIdNo())` ... won't
break anything downstream because the platform always includes primary-key fields."

**Why this is Tier 1:** a model holding three incompatible beliefs about one API across one
conversation is unusually strong evidence that the semantic is genuinely unlearned rather
than merely misremembered. Two of the three positions are wrong in opposite directions.

**Task shape:** an invented table with a Code primary key plus two data fields.
`SetLoadFields` one data field, `Get()`, then read the PK and the omitted field. Assert the
PK is populated and the omitted field is not.

**Dedup:** `CG-AL-M023` exists but is a guided demo that instructs "Use SetLoadFields to load
only the Name field" at every step. It never probes whether `Get()` honours it or whether PK
fields are exempt. Not a duplicate.

### 8. `IsInWriteTransaction()` and what actually opens a write transaction

**Source:** PR 52110, a separate finding and a separate round from the marks item.

**False belief:** "Report generation only writes to a temporary record, and **temporary-table
writes do not open a database write transaction**, so nothing in the loop makes that guard
fire." Posted as a real issue and restated across three rounds.

**Correct:** the reviewer retracted the mechanism while keeping the conclusion: "**The
mechanism behind Finding 2 was wrong**, though the conclusion holds. Report creation *does*
perform real database writes; they simply commit immediately, which is why
`IsInWriteTransaction()` never latches. 'Temporary tables open no transaction' was only part
of the picture."

**Why this matters for ranking:** this sits in the **Commit family**, which the brief names
as the only proven attempt-2-resistant class (`X037`, `X040`, `X041`). It is the one new
candidate that lands in the class the brief actually asks to aim at.

**The kernel is now MEASURED, so this candidate needs no further verification.** Same probe,
Cronus28, BC 28.4: `IsInWriteTransaction: atEntry=No afterTempInsert=No afterRealInsert=Yes`.
A temporary-record `Insert` does **not** open a write transaction; a real `Insert` does.

Note what this does and does not vindicate. The reviewer's *general rule* ("temporary-table
writes do not open a database write transaction") is correct as stated. Its retraction was
narrower than it sounds: what was wrong was the claim that *nothing in the production loop*
performed real writes. Both halves are useful, and the measured three-point sequence is the
part a task should assert.

**Task shape:** invented table plus a temporary record variable. Assert
`IsInWriteTransaction()` is false at entry, still false after a temp `Insert`, and true after
a real `Insert`. Base app only, no prereq. Avoid asserting the post-`Commit()` state in the
same method unless the task carries `[TransactionModel(AutoCommit)]`, since under other
models a `Commit()` inside a test can itself error.

**Dedup:** zero coverage. No task or test references `IsInWriteTransaction`.

### 9. A `continue;` statement silently calls a procedure named `Continue` if one is in scope

**Source:** not a finding. Found while checking PR 52873's `continue` claim, which one agent
flagged as suspect on the grounds that "AL has no `continue` statement at all". It does, and
chasing that produced a better candidate than the finding did.

**The fact**, verbatim from Microsoft Learn: "Due to backwards compatibility, the `continue`
statement is designed to be backwards compatible with other elements like procedures and
variables, which have the same name. For example, **if there's a procedure named `Continue`
in scope, the statement `continue` will be interpreted as invoking that procedure.** This
backwards compatibility will be removed in the future."

**Why this is a first-class trap:**
- **Deterministic and documented**, so no measurement is needed.
- **Completely silent.** The loop does not skip, the procedure is called instead, and nothing
  errors. There is no diagnostic pointing at the cause.
- **Good attempt-2 resistance**, which most of this set lacks. The failure presents as "my
  loop did not skip the row". An assertion message saying the wrong rows were processed does
  not hint that `continue` resolved to a method call, so an error message does not teach the
  answer. This is the property the brief asks for and that `LockTimeoutDuration` conspicuously
  does not have.
- No model would predict it, because every other C-family language treats `continue` as a
  reserved word that cannot be shadowed.

**Task shape:** one codeunit exposing a small workflow API that legitimately includes a
procedure named `Continue` (alongside, say, `Start` and `Stop`), plus a processing procedure
that must skip rows meeting a condition. The description states the required procedure names
and the required skip behaviour, which is what to build, never how. A model writes `continue;`
inside the loop and silently invokes its own method. The oracle asserts which rows were
processed.

**Version gate:** `continue` requires runtime 15.0 (BC 2025 wave 1, v26) or later. The
containers are BC 28.x and prereq manifests already target runtime 16.0, so this is safe. Note
the doc says the backwards-compatible shadowing "will be removed in the future", so this trap
has a shelf life and the task should record the runtime it was verified against.

**Dedup:** clean. No procedure named `Continue` or `Break` exists anywhere in `tests/al/`,
`infra/`, or `tasks/`, and no committed AL uses either statement.

### 10. Cross-extension object references bind by NAME, not by a compile-time object id

**Source:** not the database. An accidental experiment during the LethAL id renumber
(2026-08-20), reported by the agent doing that work.

**The observation.** `LethAL Control` was renumbered 71000-71010 to 91000-91010 and
republished, but the first gate pass ran against a **stale symbol file** still declaring the
71000 ids while the server ran 91000. Every gate passed regardless. A cross-app
`Codeunit "LC Control State"` reference resolved through the app dependency by name. Had it
bound to an id baked in at compile time, every mutant would have come back `survived`
instead of erroring, which is a loud and unmistakable signature.

**Why it is a strong trap shape.** "An object reference compiles down to an object id" is
close to universal intuition, and AL reinforces it: object ids are declared, `Database::`
and `Codeunit::` literals look exactly like id constants, and `Page::"..."` resolves to a
number at runtime. A model asked to reason about whether renumbering a dependency's objects
breaks a dependent extension would very likely say yes. The measured answer, at least for
this reference shape, is no.

**Testability here is unusually good.** This needs two apps, and CentralGauge already has
exactly that structure: `tests/al/dependencies/<task-id>/` is a real prereq app compiled and
published ahead of the candidate. A task can have the candidate reference a prereq codeunit
by name and assert behaviour that would differ under id binding.

**GATE BEFORE AUTHORING — this is not yet verified.** The run that produced it was not
designed to isolate the question; passing gates are *consistent* with name binding but were
not a controlled test of it, and the finding covers one reference shape (a cross-app codeunit
call through a declared dependency) rather than the general case. Before any AL is written:

1. Reproduce deliberately: publish a prereq app, compile a candidate against its symbols,
   renumber the prereq's objects, republish the prereq only, and re-run the candidate.
2. Establish the boundary. `Codeunit::"X"` / `Database::"X"` literals, `RecordRef.Open(id)`,
   event subscriber bindings, and permission-set `tabledata` references may each behave
   differently. A trap built on the wrong one measures nothing.

Treat this as the most promising unverified lead in the file, not as a settled fact.

**Dedup:** no task covers cross-extension binding semantics. `X001` (manual subscription) and
`X041` (protected residue) are the nearest neighbours and are unrelated.

---

## Tier 2: real, thinner, or with a caveat

| Gap | Source | Why it is not Tier 1 |
| --- | --- | --- |
| A `var` record parameter shares the caller's filters and position; a helper's `Reset`/`SetFilter` wipes the caller's loop | 52841, 52724, 52196, plus 3 latent instances | Strongest recurrence in the whole corpus (5 instances, silently wrong money twice), but overlaps conceptually with X050 borrowed-cursor. Check that first. |
| `Database.LockTimeoutDuration` takes seconds, not milliseconds | 52663, adjudicated `reviewer-wrong`, plus an explicit reviewer withdrawal | **Low attempt-2 resistance**: "expected 10, got 10000" hands over the answer. Attempt-1 catcher in the X035/X046 class, not the X037 class the brief asks for. See the gating note below. |
| `SetAutoCalcFields` arms later reads only; it never fills a record already in the buffer | 53398 | Silent wrong answer, good shape, single instance. |
| `OnPreReport` runs *after* the request page, so seeding defaults there discards user input | 52798, human fixed | Needs a report object; heavier than a codeunit but still self-contained. |
| `temporary` is part of the *type* of a `var Record` parameter, so a subscriber declaring it fails to match | 52657 | Compile-only oracle. Bonus paired rule: a subscriber may declare a prefix of the publisher's parameter list. |
| `BindSubscription` binds the whole codeunit instance; every subscriber in it goes live at once | 52225, human fixed | No per-subscriber switch. Clean oracle (two subscribers, assert both fire). |
| `Rename()` cascades only through `TableRelation`; a plain copied key field silently keeps the old value | 52675, 52677, 52841 | High recurrence, and the team wrote a CLAUDE.md about it after being bitten and still under-implemented it. Partially overlaps X012 tablerelation-cascade and X043 field-cascade. |
| `RecordRef.Field(n)` hard-errors unless guarded by `FieldExist(n)` | 52521 | Half the source finding is project context. |
| Record marks and `MarkedOnly` survive `Duplicate()` and by-value passing | 52110, the cleanest cross-round retraction in the corpus | Deep verified gap, zero repo coverage, but **the trap mechanics do not work**: a model that disbelieves mark survival routes around it with a temp table or a `List of [RecordId]` and gets the right answer anyway. A trap only fires when the false belief forces a wrong output. See the correction note below. |
| AL supports procedure overloading on differing parameter lists | 52953 | Now has real task shapes (see below), but the belief is *intermittent*, which weakens it. |

### Correction on the marks candidate

My earlier read said the docs were silent on whether `Duplicate()` preserves marks. **That
was wrong, and it inverts the story.** `RecordRef.Duplicate()` states it verbatim, three
times on one page: "A RecordRef that refers to a new record with the same filters, current
keys, and marks as the original RecordRef." `Record.Copy` says the same. The reviewer
claimed silence about the single point the documentation states most explicitly.

What the docs *are* silent on: whether a by-value parameter copy carries marks (the clause
the reviewer got right, and the only thing the team's test genuinely settles), whether
`Duplicate()` carries the `MarkedOnly` flag itself, whether `SetRange`/`Find` clear marks,
and any mark lifetime finer than "when the current session ends".

Also worth recording: `Record` has no `Duplicate` method at all. Only `RecordRef` does.

### On overloading, the shape matters more than the fact

Verified two ways: Microsoft Learn documents procedure overloading explicitly ("multiple
procedures with the same name, but with different signatures, on the same application
object", with number of parameters part of the signature), and it was compiled against this
machine's own `alc.exe` with the exact 4-arg plus 6-arg shape from the disputed file. Clean
compile. The genuine-duplicate control produced `AL0440: ... already defines a method called
'SameSig' with the same parameter types`.

The reviewer's error almost certainly comes from C/AL, the pre-AL language, where
overloading genuinely did not exist. There is no AL version where it was rejected.

Two exceptions found by compiling, both good trap material on their own:
- Handler-attributed methods cannot be overloaded even with different parameter lists:
  `AL0518: A method with name 'MyHandler' possessing one Handler attribute is already
  defined in this test codeunit.`
- `[Test]` procedures must be parameterless, so two same-named `[Test]` procedures are
  identical signatures and hit AL0440.

The belief is also **unstable within a single PR**: at 11:52 the reviewer called the same
file's overloads ordinary working AL at nitpick severity, and at 14:06 it asserted at
critical that "AL has no method overloading". A task probing this must present both
declarations in one object, which is when the fact drops.

---

## Already shipped: two strong candidates that are existing traps

Worth recording, because it is a calibration signal rather than a loss.

**SetFilter value interpolation is parsed as filter syntax.** Found independently in four
unrelated repos (53398, 52809, 52690, 49388), the highest recurrence of anything in the
corpus. This is **`CG-AL-X014`**, already shipped, tags `[setfilter, setrange,
filter-substitution, special-characters]`. The corpus independently rediscovering a trap the
suite already has is evidence the mining method is well calibrated.

**`SetRange(Field, '')` is an exact match on blank, not "no filter".** Found in 52692. This
is **`CG-AL-X026`**, already shipped.

---

## Rejections, with premise notes

**Job Task default dimensions (PR 53146).** My earlier note called this unverified. It is
not: it was settled from Microsoft's shipped base-application source. The human is right.
Job Task Dimension is table 1002, `DimensionManagement` carries the comment `// Table 1001
"Job Task" is an exception`, Job Task is excluded by name from the Default Dimension table
list, and table 352's `Table ID` `OnValidate` raises `FieldError` so an account-type default
dimension for Job Task cannot be entered at all. **Still rejected**, on self-containment
only: it needs base-application Job and Dimension tables, so it measures base-app domain
recall rather than a language or runtime semantic, and `CG-AL-X047` already occupies
dimension ground.

**All 64 `rejected-wontfix` and `unclear` rows with quotes.** Project context, not knowledge
gaps. No model could know any of them from a task description.

**Internal / `[InternalEvent]` cross-app subscription.** Appears in four PRs, strong
evidence, but **structurally untestable here**: an internal event is freely subscribable
from within the same app, and the oracle compiles into the same app as the candidate, so
naive and correct both pass.

**Page background tasks run in a read-only session** (PR 52747). Real and non-obvious, but
PBTs need a client session to dispatch and are asynchronous, so the SOAP harness cannot
exercise one and a TestPage route is not deterministically assertable.

**`SingleInstance` codeunit state surviving a company switch** (PR 52307). Real, but there
is no way to drive a company switch from inside a test codeunit.

**`AutoSplitKey` derives from display order** (52345). Genuine and human-fixed, but needs a
TestPage, which routes to the slow legacy runner rather than SOAP.

**Performance-only findings, dropped in bulk.** Missing `SetLoadFields`, n-squared
`CalcTotals`, per-row sweeps, missing indexes. These are optimisation preferences where the
semantics do not change the result, so no pass/fail oracle exists.

**PR branch authorship.** I checked whether the reviewed code was itself LLM-written, which
would have made every `fixed` row direct evidence of a model producing the naive form. It is
not: branch names carry developer initials and work-item numbers
(`user/tcha/72576_association_no`, `bug/geus/69656_...`). Hypothesis dead.

---

## Must be measured before anyone writes AL

Three items where the evidence points the wrong way or runs out. All are cheap on a free
Cronus container.

**RESOLVED, and the doubt was misplaced: AL does have a `continue` statement.** An agent
flagged PR 52873's finding as suspect because it did not believe the statement existed. It
does, from runtime 15.0 (BC 2025 wave 1). `break` exists too, and is distinct from the Break
Method for Report/XMLport. Chasing this produced Tier 1 candidate #9 above, which is a better
trap than the finding that prompted the check.

**RESOLVED BY MEASUREMENT: `AutoRollback` is NOT the default.** Measured on Cronus28, BC
28.4.53241.53758, SOAP harness path. Two independent signals from one probe agree:

- A test method with no `[TransactionModel]` attribute inserted a row; the *next* test method
  in the same codeunit read it back: `survivedFromTestA=Yes rowCount=1`. Nothing was rolled
  back.
- `IsInWriteTransaction()` at test-method entry was **No**. Under either `AutoRollback` or
  `AutoCommit` the docs say the method "starts a write transaction", so entry would be Yes.

The default therefore behaves like `None`. **PR 52225's reviewer was right and the human's
fix was a real fix, not a false confirmation.** The agent that flagged this as "evidence
points the wrong way" had it backwards.

**This has a benchmark-hygiene consequence beyond the candidate.** Writes made by one test
method persist into later methods in the same codeunit under this harness. Any oracle that
inserts rows and relies on implicit rollback is wrong, and cross-test contamination is
possible in existing tests. That is worth a separate audit pass.

**RESOLVED BY MEASUREMENT: `GuiAllowed` is FALSE in the test runner.** Same probe:
`GuiAllowed=No ClientType=[SOAP]`. **PR 52110's round 6 was right and its round 5 advice was
wrong**; an `Assert.IsTrue(GuiAllowed())` would indeed fail every run. Candidates gated on
`GuiAllowed` can now be written.

**Scope limit, stated honestly:** all of the above was measured on the **SOAP path only**
(`CG WS Test Runner` to `Test Suite Mgt.RunAllTests` to `Test Runner - Isol. Codeunit`). The
legacy `Run-TestsInBcContainer` path was not measured and could differ, since `TestIsolation`
on the runner codeunit participates. Re-measure before relying on these under
`CENTRALGAUGE_SOAP_TEST_RUNNER=0`.

**Operational gotcha worth recording.** Ad-hoc probes only work on a container that already
has `CG Test Harness` published. Cronus281, Cronus282 and Cronus283 hold **no CentralGauge
apps at all** and every probe against them died at `prepareCandidateApp` with an opaque
`"prepareCandidateApp failed"` that names no cause. Only Cronus28 is primed. The mining
brief's advice to "probe in parallel across different containers" does not hold for the SOAP
path; either run `ensureTestHarness` on the others first, or serialise on Cronus28.

### A standing caution about retracted-to positions

Of the five reviewer self-retractions found, **only the marks case (52110) was settled by
running AL**. The others were settled by an author's rebuttal, by documentation, or by the
reviewer re-reading source. The retracted-to position is therefore the *team's* position,
not measured ground truth, and a benchmark task pins whichever answer it encodes.

This matters most for `LockTimeoutDuration`, where the two positions differ by a factor of
1000. I am less worried than the sweep agent was, because the evidence there is stronger
than a rebuttal plus one doc page: the seconds reading appears in three separate places on
the method page (description, parameter, return value) and again on the `Database` data type
page, and the parameter is typed `Integer`, not `Duration`. But it is still worth one
measurement before shipping a task, because a wrong pin here is invisible and permanent.

### A pattern in the legacy suite worth noticing

Three Tier 1 and Tier 2 candidates sit directly adjacent to an existing task that names the
same API and never tests the trap:

| Candidate | Adjacent existing task | What the existing task does instead |
| --- | --- | --- |
| `Round(x)` default precision | `CG-AL-H009` | Tells the model to use precision fields, and names `Round(Amount, Precision, Direction)` |
| `LockTimeoutDuration` units | `CG-AL-M038` | "call Database.LockTimeoutDuration with the NewValue argument and return its Integer result" |
| `Get()` and `SetLoadFields` | `CG-AL-M023` | "Use SetLoadFields to load only the Name field" at every step |

In each case the legacy task hands the model the API and the calling convention, so it
measures whether the model can follow instructions rather than whether it knows the
semantic. That is a systematic gap in the pre-X suite, and it means "an API already appears
in a task" is a weak dedup signal. Check what the task *asserts*, not what it mentions.

Also unsettled, and not worth blocking on: BC's actual default lock timeout. Microsoft
documents no default for the AL method. The only documented lock-timeout default anywhere in
the server settings reference is `SqlLockTimeoutOverride`, default `00:03:00`, which is a
different thing. The reviewer's "10000" has no documentary basis and is self-refuting when
read in the unit the API actually takes (10000 seconds is 2h46m).

---

## Honest read on yield

The brief asked to say plainly if the vein runs thin. **The vein it names does. The corpus
does not.**

The `rejected-wrong` label produced roughly four usable items, as the brief predicted. Two
independent measurements agree the reviewer-error rate is about one platform-semantics error
per 35 days of review traffic. Anyone re-running only the queries in the brief will find
nothing new.

The productive surface is the **2178 unclassified reviewer findings**, where the value is
recurrence rather than any single item, and the **subset of multi-round PRs whose rounds are
days apart**, where the value is self-retraction. Between them they produced eight Tier 1
candidates against the brief's stated hope of three, plus a ninth found by fact-checking an
agent's objection rather than by any query.

Five reviewer self-retractions exist in the whole corpus: `TestField` polarity (52927),
`SetLoadFields` and `Get` (49388), marks across `Duplicate()` (52110), `IsInWriteTransaction`
(52110, separate finding), and `LockTimeoutDuration` units (52663). Four of the five became
candidates. That is the complete set; the sweep is exhaustive, not sampled.

Weight one caveat properly: because the classified slice is nearly all `fixed`/`deferred`,
most Tier 1 and Tier 2 items are **author-error shape**. They are evidence about what
competent BC developers write naively, which satisfies the plausibility half of the premise
gate, but they are not direct evidence of what an LLM gets wrong. The reviewer-error items
(#1, #4, plus marks and `WorkDate`) are the ones with that direct evidence.

Worth re-running when the corpus roughly doubles. The query that matters is the cross-round
one, and the filter that works is round-referencing language restricted to multi-round
`pr_id`s, not retraction words.

## Process notes

**Container time was used, outside this run's stated scope.** The brief said candidate
discovery only, no container work. One verification agent nonetheless built a probe app and
ran it on Cronus28 to settle the `AsText()`-on-null question. It confirmed no bench was live,
published, measured, unpublished, and left the container holding only `CG Test Harness`. The
data is good and is what upgraded candidate #1 from "documented" to "documented and
measured", but it was not authorised by the brief. Probe source is kept and re-runnable at
`scratch/jsonnull/correct/` (it borrows id `CG-AL-X099`, which is outside the X-series
two-digit convention and should be renumbered or deleted rather than promoted).

**One agent claim not adopted.** That agent reported the reviewer's cited "sibling code" as
living in `docs/volotests/`, which is gitignored and outside the task-set hash, and argued
the reviewer's evidence was therefore weaker than presented. The reviewer actually cited two
Azure DevOps paths in the Continia `delivery-network` repo
(`DocumentLoader.Codeunit.al:196-202` and `ParticipationService.Codeunit.al:192-194`), not a
local CentralGauge file. Different files; the agent appears to have matched on a local
lookalike. The verdict is unaffected either way, since the measurement settles it.

**The subagent fan-out was slow to deliver but ultimately produced most of the value.** Ten
agents; none returned through the normal channel and all had to be prompted directly. Three
could not load the `postgres` MCP tool and worked around it via Deno with `npm:pg` or
`docker exec psql` against the same database. One reported another agent overwriting its
files in the shared session scratchpad, which is worth knowing before running this pattern
again.

---

## Separate defect found while dedup-checking, not a mining result

`tests/al/**` contains **36 `Assert.IsTrue(true, ...)` placeholder assertions**, the exact
form CLAUDE.md forbids:

| File | Count |
| --- | --- |
| `tests/al/medium/CG-AL-M005.Test.al` | 13 |
| `tests/al/hard/CG-AL-H011.Test.al` | 5 |
| `tests/al/easy/CG-AL-E007.Test.al` | 5 |
| `tests/al/medium/CG-AL-M009.Test.al` | 3 |
| `tests/al/hard/CG-AL-H019.Test.al` | 3 |
| `tests/al/hard/CG-AL-H017.Test.al` | 3 |
| `tests/al/easy/CG-AL-E008.Test.al` | 3 |
| `tests/al/medium/CG-AL-M010.Test.al` | 1 |

Plus `tests/al/medium/CG-AL-M038.Test.al:23`, tautological by construction:
`Assert.IsTrue((Captured = Captured), 'LockTimeoutDuration returned an Integer')`.

On these tasks a model's runtime score measures only that the app compiled and published.
M038's own comment is candid: "the exact previous-value semantics ('returns previous' vs
'returns new current') are not stated on MS Learn, so no direction-specific assertion is
made here". The semantics were left unsettled and an empty assertion shipped instead. Note
that M038's LockTimeoutDuration semantics are now settled: the parameter is `Integer`,
documented as seconds, runtime 16.0, and the return is documented as "The lock timeout
duration in seconds".

Point `al-test-auditor` at these eight files. Fixing any of them edits `tests/al/**` and
therefore moves the task-set hash.
