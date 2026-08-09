# Task Authoring Dashboard

Date: 2026-08-09
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

Everything here was checked against the code or measured against real run data.
Each one constrains the design, and two of them contradict what the design
assumed before checking.

### The candidate is one file of N objects, not N files

`src/parallel/compile-queue.ts:1081` writes the model's code to a single
`<taskId>.al`. AL permits many objects per file, so a response containing a
table, an enum and a codeunit is one file with three objects. **The unit the UI
must show is the object, not the file.**

`correct/` and `naive/`, by contrast, *are* directories of `.al` files. So
comparing a response to a reference cannot be file-to-file; it has to match
objects by type, id and name.

### Extraction is the ground truth, and it is not the raw response

`templates/code-gen.md:9` mandates `BEGIN-CODE`/`END-CODE` output. That routes
to `CodeExtractor.extractFromCustomDelimiters`, which takes **only the last
matching block** (`src/llm/code-extractor.ts:51`,
`matches[matches.length - 1]`). Concatenation of all blocks happens only in the
markdown-fence fallback (`:136-147`).

So a model emitting one `BEGIN-CODE` block per object silently loses all but
the last, and the bench compiles something different from what the author would
see reading the response. **The dashboard must build its view from
`CodeExtractor.extract` output**, and surface the extraction method and
confidence per response — both already on `ExtractionResult`. Showing the raw
response would show objects the bench never compiled, which is mis-calibration
in exactly the direction this tool exists to prevent.

This last-block-wins behaviour is a latent bench bug in its own right. See
Follow-ups.

### The attempt-2 extraction path is confused, but has never fired

The production fix path routes attempt ≥2 to `adapter.generateFix`
(`src/parallel/llm-work-pool.ts:452` non-streaming, `:492` streaming). The fix
prompt demands "the COMPLETE corrected AL code (not a diff)" inside
`BEGIN-CODE` fences (`:653`). But `generateFix` extracts with
`expectedLanguage: "diff"` (`src/llm/base-adapter.ts:260`, `:346`), which makes
`extractFromCustomDelimiters` look for `BEGIN-DIFF`, miss, and fall through to
a line filter that keeps only lines starting with `---`, `+++`, `@@`, `+`, `-`
or a space (`code-extractor.ts:232-247`) — dropping every column-0 line. No
diff applier exists anywhere in `src/`.

**Measured against real data, this never happens.** Across 12,561 attempt-2
records in 237 result files under `results/`, `codeLanguage` is `"al"` in every
case and never `"diff"` — and the mangling path sets `"diff"` explicitly. Of
the 11,085 with non-empty extracted code, every one begins at column 0; the
indented-body signature appears zero times.

The reason is that models wrap output in markdown fences despite being told not
to, which routes to the untagged-fence branch and extracts correctly as AL at
confidence 0.6. The bug is real and latent, guarded only by models disobeying
the prompt. It is **not** a live scoring distortion, and existing scores do not
need to be distrusted on account of it.

Consequence for this design: the dashboard must not reuse `generateFix`. It
builds the fix prompt itself and extracts with `"al"`.

### Ingest is opt-out, and that is the hazard

Ingest lives in exactly two entry points: `bench`
(`cli/commands/bench-command.ts:567` precheck gate, `:676` auto-ingest) and the
manual `centralgauge ingest <file>` replay. `--no-ingest` does gate both the
publish and the catalog precheck — an earlier claim that it was insufficient
does not hold against the current code.

The risk is not leakage but defaults: a dashboard button that forgets the flag
publishes calibration runs to the production scoreboard, which has happened in
this repo before. The building blocks the dashboard needs — direct adapter
calls, `handleAlVerify` — never touch ingest, so the guarantee can be
structural rather than a flag.

### `tree-sitter-al` is already vendored and sufficient

`vendor/tree-sitter-al/tree-sitter-al.wasm` with `web-tree-sitter`
(`deno.json:59`), already used by `src/container/test-routing.ts` to detect
TestPage usage.

Verified by parsing representative AL: top-level `codeunit_declaration` /
`enum_declaration` are clean root children and multi-object concatenated text
parses with `hasError: false`; `variable_declaration → type_specification →
record_type → quoted_identifier` gives variable-to-table binding;
`member_expression` and `call_expression` expose `Quote.Discount` and
`Validate(Rate, …)`. Prose parses to a root ERROR node, so "no AL here" is
detectable.

What it does **not** give is name resolution. That gap defines the flagging
rules in section 4.

### Escalation is serial on one container

`src/workbench/probe.ts` and `scripts/trap-probe.ts` both record `Cronus28` as
the only container with credentials wired for the probe; the others return 401
on the web-service port. Candidates also share publish state on a container, so
concurrent verifies on one container are unsafe, not merely slow. Escalation is
a serial queue and the UI must say so.

### "Use as the wrong answer" collides with a shipped refusal

`src/workbench/oracle-files.ts` Refusal 2 rejects any `<id>.`-prefixed `.al` in
`naive/`, case-insensitively — including `<id>.al`, which is exactly the name
the bench writes. Promoting a model response into `naive/` must therefore
invent filenames. Section 6.

## Design

### 1. Shape and host

A local web app served by the Deno CLI, opened fullscreen on a second monitor
while VS Code holds the AL editing on another. Not a VS Code extension: an
extension is Node against a Deno codebase, so it could only shell out to the
CLI and parse stdout, duplicating model config and adding VSIX packaging for no
capability gain. The dashboard deep-links into VS Code via `vscode://file/...`
(forward slashes, URL-encoded) so clicking through to edit still lands in the
editor.

Running in-process in Deno means it calls the LLM adapters, the task loader and
the probe directly — no subprocess, no JSON round-trip.

### 2. Two run modes

**Ask N models** — LLM generate only. Seconds, no container, works with
containers down. This is the default because it is the one you run repeatedly
while iterating.

**Compile & test** — the full pipeline including the fix attempt. Minutes.
Available per response or for all of them.

Quick mode must render **the same prompt the bench renders** — reuse the
`llm-work-pool` request-building path (TemplateRenderer, `prompt_template`,
injection resolution) rather than sending `task.yml`'s description raw.
Otherwise the author calibrates against a prompt the bench never sends.

The fix attempt is reimplemented locally: build the fix prompt, extract with
`"al"`. Do not call `generateFix`.

### 2a. What it operates on, and which models it asks

**Task selection.** The dashboard works on a draft under `scratch/<id>/` — the
same drafts `centralgauge task new` scaffolds. It lists the drafts it finds and
opens one. Promoted tasks are out of scope: once a task is committed, the
question has moved from "is this calibrated" to "how do models score", which is
`bench`'s job.

**Model selection.** Reuse the existing `benchmarkPresets` in
`.centralgauge.yml` — the same mechanism `bench --preset` uses — so the
dashboard cannot drift from the models actually benched. The UI picks a preset
and may deselect individual models from it for a given run. It does not invent
its own model list or its own config file.

Unknown-model handling differs from `bench` deliberately: `bench`'s precheck
auto-seeds the catalog for a model it has not seen, which writes to production.
The dashboard never does that. An unknown slug is simply callable or not, and a
failure to call is reported per model without touching the catalog.

### 3. One screen that gains columns

Object-per-row, model-per-column. **Model-level facts live in the column
header** ("Passed on 2nd try"); **object-level facts live in the cells** ("Made
the mistake"). The attempt dimension is a matrix-level toggle that re-renders
the grid rather than adding columns.

A left rail carries the task files and the prereq reference. Clicking a cell
opens the diff and the per-response actions beneath the grid.

**Row identity** is `(type, id?, normalized name)`, id taking precedence, name
as fallback — AL interfaces and controladdins have no numeric id. A name match
under a different id, or an id match under a different name, is an **in-cell
badge**, not a new row: splitting them into two rows would report the
asked-for object as missing and the near-miss as extra, which misreads the
failure. For `tableextension`/`enumextension` the extends-target is part of the
row key.

**A response with no extractable AL** gets an explicit column state naming the
extraction method and confidence, not an empty object list — empty is
indistinguishable from "wrote nothing", and refusals need to be legible as
refusals. This cohort has a history of API-classifier refusals invalidating a
whole model's data; the dashboard is where that should become visible.

### 4. The prereq rail, scoped to what each response touched

The rail is read-only reference: prereq objects and their fields, chained
prereqs included. Scoped to the selected response, it lists only what that
response references and flags names that exist in no prereq.

That last part catches a hallucinated field before spending minutes compiling
to discover it — and it is a *different* failure from falling for the trap,
which matters when judging calibration.

Because tree-sitter gives no name resolution, flagging is tiered so a wrong
guess is never rendered as a confident accusation:

- **Hard flag** — `X.Y := …` where `X` is bound to a prereq table. `Y` cannot
  be a procedure in assignment-target position, so an unknown `Y` is provably
  not a field.
- **Hard flag** — field-name arguments of a curated method set: `Validate`,
  `SetRange`, `SetFilter`, `TestField`, `CalcFields`, `CalcSums`, `FieldError`,
  `GetRangeMin`, `GetRangeMax`.
- **Soft label ("unknown member")** — `X.Y(...)` call position, where `Y` may
  be a Record built-in or a table procedure. A stale built-in list then
  produces a soft mislabel rather than a false accusation.
- **Untracked** — everything else. Only variables bound to *prereq* tables are
  analysed, so base-app records, RecordRef and unresolvable bindings can never
  false-flag.

Prereq tables can declare procedures, so the binder extracts both fields and
procedures. A parse error degrades the rail to the static file listing.

### 5. Vocabulary

The UI uses plain language with the real repo names in grey beside them, so a
newcomer can use it and a maintainer can map it to files and docs.

| Concept | UI label |
|---|---|
| Response resembles the naive example | **Made the mistake** |
| Response resembles the correct example | **Looks right** |
| Resembles neither | **Different approach** |
| No reference to compare against yet | **Couldn't compare yet** |
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

"Looks right" carries its own hedge: before compiling, the cell is a
code-shape guess, and the word "looks" says so without a separate disclaimer.
After a verify, the *column header* carries the real verdict while the cell
keeps describing shape.

Four models is the practical column limit at this wording.

**Classification is comparative, not textual.** `correct/` is one valid
implementation, so textual similarity to it means little — a response can
differ from it in formatting and naming and still pass. Instead, diff
`correct/` against `naive/` once: that region *is* the trap. Each response is
then classified by which side of that region its code resembles. With no
`naive/` written yet, cells degrade to **Couldn't compare yet** and the matrix
still shows structure — it must be useful early, which is exactly when the
examples do not exist.

### 6. Save as the wrong answer

A model's genuine mistake is a more authentic `naive/` than an invented one, so
a response can be promoted straight into the draft.

Because Refusal 2 rejects `<id>.`-prefixed names in `naive/`, promotion writes
**one file per top-level object**, named `<SanitizedObjectName>.<Type>.al`,
refusing the pathological case where the sanitised name would itself start with
`<id>.`. It **replaces** the existing `.al` files in `naive/` rather than
merging — a merge leaves stale objects that silently change the next probe
verdict. The scaffolded `naive/app.json` is kept. Provenance (model, attempt,
timestamp) is stamped as a comment header.

The promoted content is the **extracted** code, never the raw response. The
action is disabled when nothing extractable was produced.

### 7. Ingest safety, structurally

Two rules, both spec-level:

- The dashboard **never shells out to `centralgauge bench`**. The moment a
  convenience "real bench" button appears, the opt-out flag risk returns.
- Run artifacts are **not** written in the `benchmark-results-*.json` shape and
  **not** under `results/`. That shape is the input to the manual ingest
  replay, and a stray replay is the same pollution incident. They live under
  `scratch/<id>/.runs/`.

Given both, "Never published to the scoreboard" is an invariant, displayed as a
standing statement rather than a per-run status — a status field would imply
the other value exists.

### 8. Escalation queue

Serial, one container, with an honest estimate. At roughly 1.5-2.5 minutes per
verify, "Compile & test all" for four models with fix attempts is four to eight
verifies back to back. Results fill in as they land rather than waiting for the
slowest. Serialisation lives in the run manager and is not left to luck, since
concurrent verifies share publish state on the container.

## Phasing

The core loop is sections 1-3, 5 and 7 — server, quick run, matrix, vocabulary,
ingest safety. That is useful on its own.

Additive afterwards, in order of value: escalation (2, 8), the scoped prereq
binder (4 — ship the static rail first, add scoping behind it), and save-as-
wrong-answer (6).

## Out of scope

- Any change to `bench`. The dashboard reuses its prompt-building path and its
  adapters; it does not modify the command.
- A VS Code extension. Deep links only.
- Fixing the two latent extractor bugs below — they are recorded here so the
  dashboard works around them, and should be filed separately.

## Follow-ups to file separately

1. **`extractFromCustomDelimiters` takes only the last `BEGIN-CODE` block**
   (`src/llm/code-extractor.ts:51`) while `templates/code-gen.md:9` mandates
   that format. A model emitting one block per object loses all but the last.
2. **`generateFix` extracts with `expectedLanguage: "diff"`**
   (`src/llm/base-adapter.ts:260`, `:346`) while the fix prompt demands
   complete AL in `BEGIN-CODE` fences, and no diff applier exists. Latent —
   measured as never firing across 12,561 attempt-2 records — but it fires the
   moment a model obeys the "no markdown" instruction.
3. Separately observed while measuring: **1,476 of 12,561 attempt-2 records
   (11.7%) have empty extracted code.** Not investigated; may be refusals,
   truncation, or an extraction gap. Worth a look.

## Risks

- **The prereq binder is the most likely thing to disappoint.** Mitigated by
  the flagging tiers and by shipping the static rail first, but if the soft
  "unknown member" case proves noisy in practice, drop call-position analysis
  entirely and keep only the two provable tiers.
- **Cost.** Four models per iteration during authoring is real money. The
  header shows per-run cost; there is no budget cap in this design.
- **The classification is a heuristic.** "Made the mistake" is a code-shape
  judgement, and a model can resemble `naive/` while still passing. That is
  what "Compile & test" is for, and why the cell never claims a verdict.

## Testing

- Object splitting and row identity against fixtures: multi-object responses,
  interfaces (no id), `tableextension` with differing targets, same name under
  different ids, prose-only responses.
- Extraction parity: the dashboard's view of a response matches what
  `CodeExtractor.extract` produces, asserted directly rather than assumed.
- The prereq binder's flagging tiers, including that a base-app record and an
  unresolvable binding produce no flag at all.
- Promotion into `naive/` produces filenames that `classifyOracleFiles`
  accepts — asserted against the real function, not a copy of its rules.
- Ingest safety as a structural test: no code path in the dashboard reaches
  `bench` or writes `results/benchmark-results-*.json`.
