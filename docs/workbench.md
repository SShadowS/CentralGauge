# Workbench: Import, Model Selector, VS Code, LLM Exchange

This page covers additions to `centralgauge workbench serve` on top of the
core draft → probe → promote loop: pulling an already-promoted task back into
the workbench for editing, a slug-picker for the model list, a button to open
a draft directly in VS Code, and a per-model view of the raw LLM request and
response.

For scaffolding a brand-new task from scratch and the mechanics of the probe
gate, see [Authoring a Benchmark Trap Task](./task-authoring-guide.md). That
guide also covers the `--diagnose` scaffold flag and the starter-code task
shape it produces; see [Diagnose drafts](#diagnose-drafts) below for what
changes on this page's surfaces. For the full CLI reference (`workbench
serve` options, the matrix vocabulary, compile-and-test escalation, HTTP
endpoints), see [CLI Command Reference — workbench](./cli/commands.md#workbench).

## Launch

```bash
centralgauge workbench serve [--port <number>] [--preset <name>]
```

Opens the dashboard on `127.0.0.1` (an ephemeral port unless `--port` is
given). `--preset` pre-fills the model textarea from a `benchmarkPresets`
entry in `.centralgauge.yml`; a typo or missing preset just starts with an
empty model input rather than failing.

## Importing a promoted task

A workbench draft normally starts from `task new`. **Import** is the inverse:
it pulls a task that has already been promoted — its `task.yml` under
`tasks/<difficulty>/` and its oracle under `tests/al/<difficulty>/` — back
into `scratch/<id>/` as an editable draft, so an existing task can be fixed or
refined through the same edit → probe → promote loop instead of hand-editing
files scattered across the committed tree.

Two equivalent ways to trigger it:

- **CLI:** `centralgauge task import <id> [--container <name>]`
- **Dashboard:** the "Promoted tasks" rail lists every importable id, one row
  each with an **Import** button. The list is pre-filtered to exclude any id
  that already has a `scratch/<id>` draft, so nothing offered there can fail
  on click for that reason.

**X-series only.** Import understands only the `ado-trap-2026` cohort —
ids matching `/^CG-AL-X\d{2,3}$/` (`CG-AL-X052`, `CG-AL-X100`, …). That is the
only id shape the workbench's solution-`app.json` renderer knows how to
regenerate an app id for. The dashboard's Promoted-tasks list is filtered to
X-series ids up front, so it never shows a legacy row at all; the CLI command
refuses a legacy `E`/`M`/`H` id with a message pointing out that those tasks
are still editable, just directly under `tests/al/`, not through the
workbench.

**What gets copied in.** The committed `task.yml`, the oracle test codeunit
and any companion files (mocks, spies, helper enums under the reserved
`<id>.` prefix — see `.claude/rules/prereq-apps.md` for what counts as a
companion), and `prereq/` when the task has one land in a fresh
`scratch/<id>/`. `correct/app.json` and `naive/app.json` are never committed
anywhere (`promoteDraft` only ever moves the task manifest, the oracle-side
files, and the prereq), so import regenerates them with the exact same
renderer `task new` uses rather than copying anything stale. A
`<id>.code-workspace` is written just like a fresh scaffold, so "open in
VS Code" (below) works immediately.

Import always creates `naive/` (with a regenerated `app.json` and nothing
else) and never creates `starter/` at all, regardless of whether the
promoted task is diagnose-shaped. See [Diagnose drafts](#diagnose-drafts)
below for what to do about that.

Import refuses outright — before touching anything — when `scratch/<id>/`
already exists: it never overwrites in-progress authoring work. It also
refuses if no committed manifest can be found for the id, if more than one
matches (a task promoted twice under different difficulties would be
ambiguous), or if the manifest's test codeunit file is missing.

**The probe gate does not change** — but an imported draft does not start
probe-ready. Only the oracle is committed anywhere (`promoteDraft` only ever
moves `task.yml`, the oracle-side files, and the prereq — see "What gets
copied in" above); there is no committed reference solution or naive
solution to restore. So a freshly imported `correct/` holds the oracle, its
companions, and a regenerated `app.json`, and `naive/` holds an `app.json`
alone — nothing that compiles against the oracle. Running `task probe`
immediately after import reports `correct=compile_fail`, and the promote gate
refuses on that verdict exactly as it would for any other draft that has
never had a real solution written.

To close the loop: write a reference solution in `correct/` and a
plausible-wrong one in `naive/` — exactly as you would for a new draft — then
`centralgauge task probe <id>` (or the workspace's "probe" build task). If
you are only editing `task.yml` or the oracle test itself and do not intend
to touch either solution, skip the probe gate with `centralgauge task promote
<id> --difficulty <difficulty> --force` instead. Import buys you an editable
copy of what is already live; it does not relax anything about what counts as
discriminating.

## Re-promoting: overwrite only where it came from

Promotion normally refuses if _any_ destination path already exists, with no
`--force` override — silently overwriting a shipped task has no legitimate
use case. An imported draft is the one deliberate exception to that rule.

When you import a task, its `scratch/<id>/.meta.json` records exactly which
repo paths it came from (`importedFrom.taskYml`, `.testFile`, each entry in
`.companions`, and `.prereqDir` when the task has one). `task promote <id>
--difficulty <difficulty>` is allowed to overwrite _only_ those recorded
paths — nothing else. A draft that was hand-scaffolded via `task new`, or one
that was never imported, has no `importedFrom` at all, so every destination
for it still refuses unconditionally: the pre-import behavior is the default,
not a special case carved out by this feature.

Two edge cases the overwrite rule accounts for:

- **Renaming on re-promote.** Promoting under a `--slug` or `--difficulty`
  different from the one the draft was imported under writes to a _new_
  destination and then deletes the stale file(s) at the _old_ recorded path.
  This cleanup runs after the move has already committed, so a failure here
  is reported as a warning rather than rolling back a promotion that
  otherwise succeeded.
- **Dropping a companion.** A companion file that existed at import time but
  was removed from `correct/` before re-promoting is deleted from the
  committed tree too, rather than left behind — an orphaned companion would
  otherwise keep getting compiled into every model's candidate build forever
  (the bench copies every `<id>.`-prefixed file out of `tests/al/<difficulty>/`
  for every attempt), long after the draft stopped referencing it.

**Re-promoting still moves `task_sets.hash`.** An edited, re-promoted task is
new content by definition — same as any first-time promotion — so it still
prints the usual hash-change warning, and the models you care about still
need a fresh bench run against the new hash before their scores mean
anything for this task.

## Model selector

The "Ask models" rail has two controls:

- **The model textarea** (`#model-input`) — comma-separated slugs. This is
  unchanged from before this feature and remains the single source of truth:
  it is the field the "Ask models" button actually reads, and the only one
  that holds more than one slug at a time.
- **A picker** (`#model-picker`) — a text input backed by a browser
  `<datalist>` (`#model-slugs`), plus an **Add** button. Pick a suggestion or
  type a slug, then click Add (or press Enter) to append it to the textarea,
  deduplicated against whatever is already there. The picker clears itself
  after each add, including a no-op add of a slug already present.

The datalist is a convenience layered on top of free text, not a
replacement for it — the textarea keeps accepting anything you type directly,
whether or not it appears in the picker's suggestions.

**Why a separate control, rather than `list=` on the textarea itself:** a
`list` attribute only activates a `<datalist>` dropdown on an `<input>`,
never on a `<textarea>` — and the textarea has to stay a textarea because it
carries multiple comma-separated slugs at once.

**Where the suggestions come from.** `GET /api/models` merges two sources and
dedupes: the CLI's `--preset` defaults first (the same list `GET
/api/defaults` serves), so a preset model is never pushed below the fold by
an alphabetically-earlier catalog entry, followed by every `slug:` entry in
`site/catalog/models.yml`. A missing or malformed catalog file yields an
empty catalog contribution, never an error — worst case the picker only
offers the preset defaults, and free text on the textarea keeps working
regardless. This list is not validated against a live provider API; `models
<slug> --check` remains the tool for confirming a slug actually resolves.

## Open in VS Code

One button, `#open-vscode-btn`, launches VS Code on whichever draft is
currently selected in the "Choose a draft" dropdown — there is no per-row
list of drafts in the UI (unlike the Promoted-tasks rail above), so the
button is bound to the current selection rather than to a row. It is
disabled until a draft is selected.

The request names only the draft's `draftDir`, never a filesystem path chosen
by the client: `POST /api/open-vscode` resolves `<id>.code-workspace` itself,
server-side, from that same matched draft's `id`, and silently ignores any
path a client might send. It is keyed on `dir`, not `id` — a draft's `id`
alone is not guaranteed unique (two directories can report the same
`task.yml` id, e.g. a backup copy of a draft), so `dir` is what the "Choose a
draft" dropdown's option value actually carries, and it is what
`updateOpenVsCodeButton` stores on the button's `data-dir`. Failure modes:

| Status            | Meaning                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `404`             | No draft with that directory.                                                                     |
| `409`             | The draft has no `.code-workspace` file yet — re-run `task new` or `task import` to generate one. |
| `500` (JSON body) | Launching the editor itself failed — most commonly, the `code` CLI is not on `PATH`.              |

**Requires the `code` CLI on `PATH`.** On Windows, `code` ships as a `.cmd`
shim, which `Deno.Command` cannot exec directly without a shell — the server
launches it via `cmd /c code -- <workspace-path>` for that reason. The
launched process is detached; the request returns as soon as the editor has
been asked to start, not once it has actually opened.

## Reading a model's raw LLM request and response

Every model's column header in the matrix is a button. Clicking it opens the
full exchange for that model's call in the detail panel:

- **A metadata line** — the provider's finish reason (`stop`, `length`,
  `content_filter`, or `error` when the call threw), the code-extraction
  method and its confidence, and the prompt/response sizes in characters.
- **System prompt** — present only when the draft's `prompts` block declared
  a system injection for this model's provider. No section is rendered when
  the request carried none.
- **Prompt sent** — the exact prompt this model received, rendered
  server-side from the draft's `task.yml` through the bench's own attempt-1
  path. Prompt injections are provider-scoped, so two columns in one run can
  legitimately show different text.
- **Raw response** — the model's unprocessed answer, before any code
  extraction. An empty response renders as `(empty response)`; a thrown
  provider error (bad slug, missing API key, 401) is shown above the
  sections.

Each section is collapsible; the response starts expanded. "Use as wrong
answer" works from this view — it promotes the shown response's extracted
code into `naive/`, same as from a cell.

The same two fields back the saved run artifacts: every entry in
`scratch/<id>/.runs/<id>-<timestamp>.json` now records `systemPrompt` (when
one was sent) and `finishReason` alongside the `prompt` and `rawResponse` it
already carried, so past runs are inspectable without replaying them.

## Diagnose drafts

`task new --diagnose` scaffolds the other task shape this workbench
supports: a starter application the model must fix, instead of a
correct/naive pair. The scaffold, probe, and promote mechanics are covered in
full in [Authoring a Benchmark Trap Task: Diagnose
tasks](./task-authoring-guide.md#diagnose-tasks). This section covers only
what changes on the `workbench serve` surfaces documented above.

**Import does not reconstruct `starter/`.** Pulling an already-promoted
diagnose task back into the workbench (see "Importing a promoted task" above)
copies the oracle, its companions, and `prereq/` when present, but not
`tasks/starter/<id>/`. Copy that directory into `scratch/<id>/starter/` by
hand, alongside the `naive/` import always creates, before probing. The
leftover empty `naive/` is harmless, since diagnose detection looks only at
which directory actually holds `.al` files, not at which directories exist.
Without a manually restored `starter/`, an imported diagnose draft probes as
if it were trap-shaped, against an empty `naive/`, and reports the same
`correct=compile_fail` verdict any freshly imported draft reports before a
solution is written. See "The probe gate does not change" above: the
"write a reference solution in `correct/` and a plausible-wrong one in
`naive/`" instruction there does not apply to a diagnose task, which has no
`naive/` shape to write into. This also means the "overwrite only where it
came from" re-promote rule (above) never covers `starter/`: `importedFrom`
carries no starter path, so re-promoting a diagnose task through this
workflow hits `promoteDraft`'s ordinary unconditional refusal on
`tasks/starter/<id>/` if you reconstructed `starter/` by hand and it already
exists there.

**Quick-run and the exchange view are starter-aware.** "Ask models" loads the
draft's `starter/` directory once per run, not once per model, and renders it
into every model's prompt through the same `diagnose.md` template and
`buildGenerationPrompt` path the bench uses. The "Prompt sent" panel
described above shows that rendered starter application like any other
prompt. A starter directory that exists but fails to load (a permission
error, or `starter/` resolving to something that is not a directory) is
treated the same as no starter code at all: the per-model call fails with the
template's own missing-starter-code error rather than aborting the whole run.

**The generated workspace and promote summary are diagnose-aware.** The
`.code-workspace` a diagnose draft opens lists `starter (buggy application)`
where a trap-task draft would list `naive`, and `task promote`'s summary
prints the starter destination (`tasks/starter/<id>`) alongside the task
manifest and oracle it moves.
