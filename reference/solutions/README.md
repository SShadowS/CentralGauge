# Reference solutions (authoring artifacts)

One directory per promoted X-series task, holding the task's `correct/`
authoring project verbatim: the reference solution that passes the
task's oracle, plus that draft's `app.json` and a copy of the oracle
test file as it stood at authoring time (the committed oracle under
`tests/al/` is the canonical one; the copy here is incidental).

Why this exists: `task promote` deliberately leaves `correct/` behind in
the gitignored `scratch/` workspace, so before this directory the ONLY
copy of every reference fix lived untracked on one machine. These files
are read by:

- probe re-runs after oracle edits (the correct side of the gate),
- composite assembly (donor modules are taken from `correct/`),
- LethAL oracle bypass-audits (tooling-plan.md T1) and stubborn-mutant
  mining (T4).

Rules:

- **Not part of the benchmark.** Nothing under `reference/` is read at
  bench time, and this tree is deliberately OUTSIDE the task-set hash
  scope (`tasks/**` + `tests/al/**`), so editing here never invalidates
  scores or forces a re-bench.
- **Mirror, don't fork.** The source of truth while a task is being
  authored is its `scratch/<id>/correct/`; this directory is the
  durable mirror, refreshed at promotion time. If they ever disagree
  for a promoted task, the version that passes the task's probe wins.
- **Spoiler warning.** Every file here is the answer to a benchmark
  task. Never paste from here into task descriptions, starter code, or
  anything a benched model sees.
