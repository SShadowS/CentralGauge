# Task Authoring Dashboard

Date: 2026-08-09 (revision 2, after adversarial review)
Status: awaiting review

## Problem

Authoring a trap task means answering two different questions, and only one of
them is currently tooled.

**Does the task discriminate?** `centralgauge task probe` answers this: the
`correct/` reference solution must pass the oracle, the `naive/` one must fail
it. Deterministic, no LLM, and the workbench refuses to promote without it.

**Is it calibrated?** Do real models actually fall for the trap — and the right
ones? Is it accidentally trivial, or so hard nobody clears it? Today the only
way to find out is a full `bench` run, by which point the task is committed,
the task-set hash has moved, and changing anything costs a re-bench.

The second question is the expensive one, and it is asked at the wrong time.
This dashboard moves it earlier: ask four models, read what they wrote, and
decide whether the task is worth promoting — before it ships.

Three specific frictions, weighted equally by the author:

1. No fast read on real model behaviour while the task is still malleable.
2. Context scattered across `task.yml`, the oracle, `correct/`, `naive/` and
   `prereq/`.
3. Reading model responses means digging through results JSON or scrollback.

## Verified findings

Everything here was checked against the code, by running the vendored grammar,
or by measuring real run data. Several contradict what the design assumed before
checking, and one contradicts an earlier version of this spec.

### The candidate is one file of N objects, not N files

`src/parallel/compile-queue.ts:1081` writes the model's code to a single
`<taskId>.al`. AL permits many objects per file, so a response containing a
table, an enum and a codeunit is one file with three objects. **The unit the UI
must show is the object, not the file.**

`correct/` and `naive/`, by contrast, *are* directories of `.al` files. So
comparing a response to a reference cannot be file-to-file; it has to match
objects by type, id and name.

### What the bench compiles is not the raw response, and not `extract` alone

`templates/code-gen.md:9` mandates `BEGIN-CODE`/`END-CODE` output. That routes
to `CodeExtractor.extractFromCustomDelimiters`, which takes **only the last
matching block** (`src/llm/code-extractor.ts:51`). Concatenation of all blocks
happens only in the markdown-fence fallback (`:136-147`). So a model emitting
one block per object silently loses all but the last — a latent bench bug in its
own right (see Follow-ups).

More importantly, the artifact the bench actually compiles is the product of a
four-step pipeline sitting inline in `src/parallel/llm-work-pool.ts:286-309`:

1. `CodeExtractor.extract(continuationResult.response.content)` — note no second
   argument, so `expectedLanguage` defaults to `"al"` (`code-extractor.ts:13`).
2. `CodeExtractor.cleanCode(...)`.
3. A readiness gate: `confidence > 0.5 && cleanedCode` non-empty.
4. `classifyExtractionFailure` when that gate rejects.

A view built on step 1 alone shows code the bench then mutates or refuses to
compile. **The dashboard must consume the whole pipeline**, which is why
section 2b extracts it into a shared module rather than reimplementing it.

`ExtractionResult` (`code-extractor.ts:1-7`) carries `code`, `language`,
`extractedFromDelimiters`, `confidence` and `originalResponse` — **there is no
method field**, and `extractedFromDelimiters` is `true` for the custom-delimiter
path *and* every fence path (`:57`, `:143`, `:167`, `:193`, `:212`), so which
method fired is not recoverable today. Confidence does not disambiguate it
either: `0.9` is both the tagged-fence path and the greedy fallback.

### The attempt-2 diff path is dead code on the bench path

The fix path routes attempt ≥2 to `adapter.generateFix`
(`llm-work-pool.ts:452` non-streaming, `:492` streaming). The fix prompt demands
"the COMPLETE corrected AL code (not a diff)" in `BEGIN-CODE` fences (`:653`),
while `generateFix` extracts with `expectedLanguage: "diff"`
(`base-adapter.ts:260`, `:346`) — which looks for `BEGIN-DIFF`, misses, and can
fall through to a line filter that drops every column-0 line
(`code-extractor.ts:232-247`). No diff applier exists anywhere in `src/`.

**It cannot fire on the bench path.** `executeWork` never reads
`generateFix`'s returned `.code`; it re-extracts from
`continuationResult.response.content` — the raw accumulated response, built from
raw content at `src/llm/continuation.ts:141` — with the default `"al"`
(`llm-work-pool.ts:286-288`). Only `.response`, `.continuationCount` and
`.wasTruncated` are consumed. So the pool's own `"al"` re-extraction hits
`BEGIN-CODE` at confidence 0.95 and `generateFix`'s extraction is discarded
wholesale.

Two corrections to revision 1 of this spec, both of which mattered:

- Revision 1 argued the bug was latent because "models wrap output in markdown
  fences despite being told not to". That described the inside of a discarded
  extraction and was wrong. The guard is the pool's discard, which is
  structural and does not depend on model behaviour at all.
- Revision 1 cited a measurement — 12,561 attempt-2 records with `codeLanguage`
  never `"diff"` — as evidence. That signal is **vacuous**: `codeLanguage` is
  hardcoded `"al"` where the attempt record is built
  (`src/parallel/orchestrator.ts:1164`, `:1222`), on the only path bench uses.
  The scan reproduced (re-run 2026-08-17: 291 files, 222 with attempt-2 records,
  12,721 records, 11,240 non-empty, zero starting with whitespace, 1,481 empty),
  but the headline half of it could not have come out any other way.

The consequence for this design is unchanged and now better founded: **the
dashboard must not call `generateFix`.** The one caller that would have trusted
`generateFix().code` is the dashboard itself.

### Ingest is opt-out, and that is the hazard

`ingestRun` is imported in exactly two places: `cli/commands/bench-command.ts:39`
and `cli/commands/ingest-command.ts:8`. `--no-ingest` gates both the publish
(`bench-command.ts:676`) and the catalog precheck (`:567`).

The risk is not leakage but defaults: a button that forgets the flag publishes
calibration runs to production, which has happened in this repo. The building
blocks the dashboard needs never touch ingest, so the guarantee can be
structural. Note `src/ingest/` also carries admin catalog-write paths
(`sync-catalog`, `sync-taxonomy`, `populate-*`, `cluster-review`); the dashboard
needs none of it, so the whole directory is excluded.

### `tree-sitter-al` 4.0.1 supports everything the design needs

`vendor/tree-sitter-al/tree-sitter-al.wasm` with `web-tree-sitter@0.26.11`
(`deno.json:59`), already used by `src/container/test-routing.ts`.

Commit `77fbc7b1` bumped the grammar 2.5.1 → 4.0.1 and A/B-tested only
`(object_reference_type)`, which is the whole of `test-routing.ts`'s dependency.
The nodes this design needs were re-verified against 4.0.1 by running the wasm:

- Root children include `codeunit_declaration`, `enum_declaration`,
  `table_declaration`, `interface_declaration`, `tableextension_declaration`;
  `hasError` is false on multi-object concatenated text.
- `variable_declaration → type_specification → record_type →
  quoted_identifier` is intact.
- `member_expression`, `call_expression` with `argument_list`, and
  `assignment_statement` wrapping a member-expression target are all present.
- Prose parses to `source_file` with a single `ERROR` child, `hasError` true.
- `interface_declaration` carries a `quoted_identifier` and no integer,
  confirming that row keying cannot rely on ids.

**Record bindings also arrive via `parameter → type_specification →
record_type`** — the tier-1 example in section 5 is itself a parameter binding.
The binder must collect from parameter lists, local `var` sections and global
`var` sections, with per-procedure scope, because a local shadowing a global of
a different type mis-binds under a flat map.

What the grammar does not provide is name resolution. That gap defines the
flagging tiers in section 5.

### Escalation is serial on one container, and can corrupt a live bench

`src/workbench/probe.ts:108-111` and `scripts/trap-probe.ts:60` record
`Cronus28` as the only container with credentials wired for the probe; the
others return 401 on the web-service port. Candidates share publish state on a
container, so concurrent verifies are unsafe rather than merely slow.

Separately, and more seriously: **escalation publishes and unpublishes apps on
the same container a live bench uses.** This repo already treats that failure
class as real — container-touching tests mid-bench corrupt the run's BC NST
PSSession, `src/utils/bench-lock.ts` maintains a heartbeat marker at
`<output-dir>/.bench-running.json`, and a hook denies such test runs. Dashboard
escalation is the same hazard by a different door.

`probeDraft` is also **not** an in-process call: its default runner spawns
`deno run -A scripts/trap-probe.ts` as a subprocess
(`src/workbench/probe.ts:142-150`).

### "Save as the wrong answer" collides with a shipped refusal

`src/workbench/oracle-files.ts:129-139` (Refusal 2) rejects any
`<id>.`-prefixed `.al` in `naive/`, case-insensitively via `hasTaskPrefix`
(`:75-77`) — including `<id>.al`, exactly the name the bench writes. Promotion
must therefore derive filenames. Section 8.

## Design

### 1. Shape and host

A local web app served by the Deno CLI, opened fullscreen on a second monitor
while VS Code holds the AL editing on another. Not a VS Code extension: an
extension is Node against a Deno codebase, so it could only shell out to the
CLI and parse stdout, duplicating model config and adding VSIX packaging for no
capability gain. The dashboard deep-links into VS Code via `vscode://file/...`
(forward slashes, URL-encoded).

Running in-process in Deno means it calls the LLM adapters, the task loader and
the AL verifier directly. **The verifier seam is `handleAlVerify`**, importable
from `mcp/al-tools-server.ts` — which is what `trap-probe` itself drives. The
dashboard does not go through `probeDraft`, whose default runner spawns a
subprocess; consequently the serial-queue and publish-state discipline in
section 9 is the dashboard's own responsibility rather than something inherited
from the probe's exit-code protocol.

**The server binds `127.0.0.1` only.** It can spend API money and drive
container publishes; the MCP server needed exactly this hardening pass already.

### 2. Two run modes

**Ask N models** — LLM generate only. Seconds, no container, works with
containers down. The default, because it is what you run repeatedly while
iterating.

**Compile & test** — the full pipeline including the fix attempt. Minutes.
Available per response or for all of them.

### 2a. What it operates on, and which models it asks

**Task selection.** The dashboard works on a draft under `scratch/<id>/`. It
must **filter** what it lists: `scratch/` accumulates unrelated junk
(`fable-repro-req.json`, `fieldref-hunt/`, `premise-*`). A directory is a draft
only if it carries the scaffold markers — `task.yml`, `.meta.json` and
`correct/` (`src/workbench/scaffold.ts:194-213`). Promoted tasks are out of
scope: once committed, the question has moved from "is this calibrated" to "how
do models score", which is `bench`'s job.

**Model selection.** Reuse `benchmarkPresets` in `.centralgauge.yml`
(`.centralgauge.yml:83`, resolved at `bench-command.ts:275-326`) — the same
mechanism `bench --preset` uses — so the dashboard cannot drift from the models
actually benched. The UI picks a preset and may deselect individual models. It
does not invent its own model list or config file.

Unknown-model handling differs from `bench` deliberately: `bench`'s precheck
auto-seeds the catalog for an unseen model, which writes to production. The
dashboard never does. An unknown slug is simply callable or not, and a failure
is reported per model without touching the catalog.

### 2b. Shared candidate resolution — the refactor this design rests on

The dashboard's entire value claim is that the author reviews **what the bench
would compile**. A lookalike pipeline defeats that silently. So the four-step
sequence currently inline in `llm-work-pool.ts:286-309` moves into a shared
module, and both the pool and the dashboard call it.

```
resolveCandidate(rawResponse: string): CandidateResolution
```

returning, at minimum: the raw extraction, the cleaned code, **which extraction
method fired** (a new discriminant on `ExtractionResult`, since
`extractedFromDelimiters` cannot distinguish the paths), the confidence, the
readiness verdict from the `confidence > 0.5 && non-empty` gate, and the
`classifyExtractionFailure` result when it rejects.

Adding the method discriminant touches bench-shared code. That is accepted
deliberately: without it, section 4's "no extractable AL" state cannot name the
method, and the alternative — inferring method from confidence — is provably
ambiguous.

Two prompt-building paths move to a shared module for the same reason:

- The attempt-1 request path (`buildRequest`, TemplateRenderer,
  `prompt_template`, injection resolution). Sending `task.yml`'s description raw
  would calibrate against a prompt the bench never sends.
- `buildFixPrompt` (`llm-work-pool.ts:618-655`), currently private, whose exact
  behaviour is worth preserving: 4000-character previous-code truncation, a
  20-error cap, previous code taken from `extractedCode`, errors from
  `failureReasons`.

The dashboard then reproduces attempt 2 as `generateCode` with the shared fix
prompt, extracting through `resolveCandidate`. Per the Verified findings, that
combination *is* the bench's effective attempt-2 behaviour — the pool discards
`generateFix`'s extraction anyway.

This refactor is behaviour-preserving for the bench by construction: the pool
ends up calling the function its own inline code became.

### 3. One screen that gains columns

Object-per-row, model-per-column. **Model-level facts live in the column
header** ("Passed on 2nd try"); **object-level facts live in the cells**
("Made the mistake"). The attempt dimension is a matrix-level toggle that
re-renders the grid rather than adding columns.

A left rail carries the task files and the prereq reference. Clicking a cell
opens the detail and the per-response actions beneath the grid.

**Object identity.** Key is `(type, id?, normalizedName)`, id taking precedence,
name as fallback — interfaces and controladdins have no numeric id.
`normalizedName` strips surrounding quotes, collapses internal whitespace, and
compares case-insensitively. For `tableextension`/`enumextension` the
extends-target is part of the key.

**The row universe** is the reference objects from `correct/` — excluding
oracle-side files, which `classifyOracleFiles` already identifies — unioned with
every object any response produced. Two responses contributing objects that
normalize to the same name under different ids produce **one** row keyed by
name, with the id mismatch shown as an in-cell badge per response. A name match
under a different id, or an id match under a different name, is always an
in-cell badge and never a new row: splitting them would report the asked-for
object as missing and the near-miss as extra, which misreads the failure.

**A response with no extractable AL** gets an explicit column state naming the
extraction method and confidence from `resolveCandidate`, not an empty object
list — empty is indistinguishable from "wrote nothing", and refusals must be
legible as refusals. This cohort has a history of API-classifier refusals
invalidating a whole model's data.

### 4. Classifying a response against the trap

The naive approach — textual similarity to `correct/` — is weak, because
`correct/` is one valid implementation and a response can differ from it in
formatting, naming and comments while behaving identically. The trap is a
semantic difference, so the classifier works structurally.

**Step 1: derive the trap signature, once per draft.** Match `correct/` against
`naive/` using section 3's object identity, then procedures within matched
objects by signature, then locate the statement positions where the two diverge.
That set of `(object, procedure, position, correct-form, naive-form)` tuples
*is* the trap, expressed structurally rather than as a text diff.

**Step 2: classify each response at those sites.** Match the response's objects
and procedures the same way, then evaluate its statements at the signature's
positions:

- Matches the correct-form at every site → **Avoided the mistake**
- Matches the naive-form at any site → **Made the mistake**
- Matches neither, or the procedure is absent → **Different approach**
- No `naive/` written yet, so no signature can be derived → **Couldn't compare
  yet**

Three properties follow, and they are the reason for the extra work:

- **The label is trap-scoped by construction.** "Avoided the mistake" claims
  only that the trap was dodged, because the classifier looked nowhere else. It
  cannot be read as "this passes", which is the overclaim a similarity score
  invites.
- **It is explainable.** The UI names the deciding statement rather than
  showing a score, which is what makes a glance sufficient.
- **It reuses the parse pass** the object splitting already needs.

This is the most load-bearing heuristic in the design and it is the most likely
thing to disappoint. It requires fixtures (see Testing) and it is the component
most likely to need iteration after first contact with real responses.

### 5. The prereq rail, scoped to what each response touched

Read-only reference: prereq objects and their fields, chained prereqs included.
Scoped to the selected response, it lists only what that response references and
flags names that exist in no prereq — catching a hallucinated field before
spending minutes compiling to discover it, and distinguishing it from falling
for the trap, which matters when judging calibration.

Because the grammar gives no name resolution, flagging is tiered so a wrong
guess is never rendered as a confident accusation:

- **Hard flag** — `X.Y := …` where `X` binds to a prereq table. `Y` cannot be a
  procedure in assignment-target position, so an unknown `Y` is provably not a
  field.
- **Hard flag** — field-name arguments of a curated method set: `Validate`,
  `SetRange`, `SetFilter`, `TestField`, `CalcFields`, `CalcSums`, `FieldError`,
  `GetRangeMin`, `GetRangeMax`.
- **Soft label ("unknown member")** — `X.Y(...)` in call position, where `Y` may
  be a Record built-in or a table procedure. A stale built-in list then produces
  a soft mislabel rather than a false accusation.
- **Untracked** — everything else. Only variables bound to *prereq* tables are
  analysed, so base-app records, `RecordRef` and unresolvable bindings can never
  false-flag.

Bindings are collected from parameter lists, local `var` sections and global
`var` sections, **scoped per procedure** so a local shadowing a global of a
different type does not mis-bind. Prereq tables can declare procedures, so the
binder extracts both fields and procedures. A parse error degrades the rail to
the static file listing.

### 6. Vocabulary

Plain language with the real repo names in grey beside them, so a newcomer can
use it and a maintainer can map it to files and docs.

| Meaning | UI label |
|---|---|
| Response takes the naive form at a trap site | **Made the mistake** |
| Response takes the correct form at every trap site | **Avoided the mistake** |
| Response matches neither form at the trap sites | **Different approach** |
| No trap signature derivable yet (no `naive/`) | **Couldn't compare yet** |
| Object present that the task did not ask for | **Wrote extra object** |
| Identifier in no prereq | **Made up this field** |
| Object absent from this response | **not written** |
| Passed on the first attempt | **Passed first try** |
| Passed on the fix attempt | **Passed on 2nd try** |
| Failed both attempts | **Failed both tries** (n of m tests) |
| Compile failure | **Didn't compile** |
| Run the LLM calls | **Ask N models** |
| Run the full pipeline | **Compile & test** |
| Probe verdict | **right answer passes, wrong answer fails** |
| `correct/` | **Right answer** (correct/) |
| `naive/` | **Wrong answer** (naive/) |
| `prereq/` | **Already exists** (prereq) |
| oracle | **Test** (oracle) |
| Ingest guarantee | **Never published to the scoreboard** |

The left column defines each label by **trap-site behaviour**, not by
resemblance to a file. "Avoided the mistake" replaces revision 1's "Looks
right", which overclaimed: resembling the correct side of the trap says nothing
about whether the rest of the response is correct, or even whether it compiles.

Four models is the practical column limit at this wording.

### 7. Ingest safety, structurally

Two rules, both spec-level:

- The dashboard **never shells out to `centralgauge bench`**, and never imports
  `cli/commands/bench-command.ts`, `cli/commands/ingest-command.ts`, or anything
  under `src/ingest/`. The moment a convenience "real bench" button appears, the
  opt-out flag risk returns.
- Run artifacts are **not** written in the `benchmark-results-*.json` shape and
  **not** under `results/`. That shape is the input to the manual ingest replay,
  and a stray replay is the same pollution incident. They live under
  `scratch/<id>/.runs/`, which is gitignored (`.gitignore:143`).

Different shape plus different location is two independent barriers. Given both,
"Never published to the scoreboard" is an invariant displayed as a standing
statement, not a per-run status — a status field would imply the other value
exists.

### 8. Save as the wrong answer

A model's genuine mistake is a more authentic `naive/` than an invented one, so
a response can be promoted straight into the draft.

Because Refusal 2 rejects `<id>.`-prefixed names in `naive/`, promotion writes
**one file per top-level object**, named `<SanitizedObjectName>.<Type>.al`.
Sanitisation: strip surrounding quotes, replace any character invalid in a
filename with `-`, collapse runs of `-`, and refuse outright if the result would
start with `<id>.` (case-insensitively). Two objects of the same type
sanitising to the same name — which invalid-but-emittable model output can
produce — is a refusal, not a silent overwrite.

Promotion **replaces** the existing `.al` files in `naive/` rather than merging;
a merge leaves stale objects that silently change the next probe verdict. The
scaffolded `naive/app.json` is kept. Provenance (model, attempt, timestamp) is
stamped as a comment header.

The promoted content is the code from `resolveCandidate`, never the raw
response. The action is disabled when nothing extractable was produced.

### 9. Escalation queue

Serial, one container, with an honest estimate. At roughly 1.5-2.5 minutes per
verify, "Compile & test all" for four models with fix attempts is four to eight
verifies back to back. Results fill in as they land rather than waiting for the
slowest. Serialisation lives in the run manager and is not left to luck.

**Before any container work, the run manager checks the bench-lock marker**
(`src/utils/bench-lock.ts`, `<output-dir>/.bench-running.json`, stale after
120 s). If a bench is live, escalation is refused and the UI says so — a
dashboard verify mid-bench corrupts the running bench's BC NST PSSession exactly
as a container-touching test run does. Quick mode is unaffected and stays
available.

## Phasing

Three implementation plans along these lines. The parse layer is **not**
deferrable: object-per-row requires splitting the concatenated candidate into
objects, so it belongs to phase 1. Only the prereq *binder* is later.

**Plan 1 — the core loop.** The shared refactor (2b), server (1), quick run (2),
task and model selection (2a), parse layer and object identity (3), trap
classifier (4), vocabulary (6), ingest safety (7), and the static prereq file
listing, which is trivial and belongs beside the other task files.

If the classifier (4) proves harder than expected on contact, it splits into its
own plan and the matrix ships with **Couldn't compare yet** everywhere — the
degradation story already permits that, and the matrix still shows structure.

**Plan 2 — escalation.** Run modes' second half (2), the serial queue and
bench-lock discipline (9), and the verdict-derived column-header states.

**Plan 3 — depth.** The scoped prereq binder (5) replacing the static listing,
and save-as-wrong-answer (8).

Phase 1 vocabulary note: the verify-derived rows of section 6 (Passed first try,
Passed on 2nd try, Failed both tries, Didn't compile, probe verdict) have no
data source until plan 2. Plan 1 must mark them escalation-gated rather than
build dead UI for them.

## Out of scope

- Any change to `bench`'s behaviour. The refactor in 2b is behaviour-preserving
  extraction of code the pool already runs; the command's semantics do not
  change.
- A VS Code extension. Deep links only.
- Fixing the two latent extractor bugs below. They are recorded so the design
  works around them, and should be filed separately.

## Follow-ups to file separately

1. **`extractFromCustomDelimiters` takes only the last `BEGIN-CODE` block**
   (`src/llm/code-extractor.ts:51`) while `templates/code-gen.md:9` mandates
   that format. A model emitting one block per object loses all but the last.
2. **`generateFix` extracts with `expectedLanguage: "diff"`**
   (`src/llm/base-adapter.ts:260`, `:346`) while its own prompt demands complete
   AL in `BEGIN-CODE` fences, and no diff applier exists. This is **dead code**
   on the bench path — `llm-work-pool.ts:286-288` re-extracts from the raw
   response with `"al"` and discards `generateFix`'s result — so it cannot
   distort scores today. It becomes live the moment any new caller trusts
   `generateFix().code`. Either delete the diff path or fix its
   `expectedLanguage`; leaving a trap for the next caller is the worst option.
3. **`codeLanguage` is hardcoded `"al"`** at `src/parallel/orchestrator.ts:1164`
   and `:1222`, so the field records nothing. Either populate it from the
   extraction or drop it; as-is it invites exactly the false inference this
   spec's revision 1 made.
4. **1,481 of 12,721 attempt-2 records (11.6%) have empty extracted code.**
   Not investigated; may be refusals, truncation, or an extraction gap.

## Risks

- **The trap classifier is the most likely thing to disappoint.** Structural
  matching of `correct/` against `naive/` assumes the two differ in a
  locatable, statement-level way. A trap that is diffuse — spread across many
  positions, or expressed as an absence — may produce a signature too broad to
  classify against. Mitigated by fixtures drawn from committed X-series tasks
  and by the documented fallback to "Couldn't compare yet".
- **The prereq binder is second most likely.** If the soft "unknown member"
  tier proves noisy, drop call-position analysis and keep only the two provable
  tiers.
- **Cost.** Four models per iteration during authoring is real money. The header
  shows per-run spend; there is no budget cap in this design. Worth revisiting.
- **The 2b refactor touches bench-shared code.** Behaviour-preserving by
  construction, but the bench's unit suite is the gate, and it must stay at its
  current 1002 passed / 0 failed.

## Testing

- **The 2b refactor is behaviour-preserving**: the pool's candidate resolution
  produces byte-identical results before and after extraction, asserted over
  recorded raw responses drawn from `results/`. This is the highest-value test
  in the plan, because a silent change here alters benchmark scoring.
- **Parity**: the dashboard's view of a response equals `resolveCandidate`'s
  output — the full extract + clean + readiness pipeline, not `extract` alone.
- **Object splitting and identity** against fixtures: multi-object responses,
  interfaces (no id), `tableextension` with differing targets, the same
  normalized name under different ids across two responses, prose-only
  responses.
- **The trap classifier**, against signatures derived from committed X-series
  tasks whose `correct/`/`naive/` pairs already exist: a response matching the
  correct form at every site, one matching the naive form at one site, one
  matching neither, and one where the target procedure is absent. Plus the
  no-`naive/` degradation path.
- **The prereq binder's flagging tiers**, including that a base-app record, an
  unresolvable binding, and a global shadowed by a differently-typed local all
  produce no flag.
- **Promotion into `naive/`** produces filenames `classifyOracleFiles` accepts,
  asserted against the real function rather than a copy of its rules, plus the
  same-sanitized-name refusal.
- **Ingest safety as an import-graph assertion**: `deno info --json` on the
  dashboard entry point must not include `cli/commands/bench-command.ts`,
  `cli/commands/ingest-command.ts`, or anything under `src/ingest/`. Plus a unit
  test that the single artifact-writer module roots every path under
  `scratch/<id>/.runs/`. A runtime "no code path reaches X" claim is not
  directly assertable; this is the testable form.
- **Bench-lock refusal**: escalation refuses while a fresh
  `.bench-running.json` marker exists, and proceeds once it is stale.
