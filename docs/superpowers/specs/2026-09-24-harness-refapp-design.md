# Harness Bench: reference app and task set (spec 1b, content)

Status: design, approved in brainstorming 2026-09-24. Not implemented.
Depends on: `2026-09-24-harness-bench-design.md` (1a, infrastructure).

## 1. Goal

A public, generic reference app that feels like a real BC product, for
harness tasks to work against. Domain: **Vehicle Rental and Leasing**.
Concepts, flows and hotspots are borrowed from real solutions (posting
chains, ledgers, dimensions, approvals, integrations), but the code is
generic and public-safe.

The app is split into several apps, the way real products are, and the
apps are deliberately coupled in different styles so harnesses can later be
rated on how well they navigate each style.

## 2. Workspace layout

```
C:\workspace\
  Core\          setup, master data, number series, dimensions, events
  Rental\        depends Core: rental contracts, check-out/in, pricing, posting
  Leasing\       depends Core: lease contracts, schedules, invoicing, residual value
  Fleet\         depends Core: vehicles, maintenance, damage, availability
  Reporting\     depends Rental, Leasing, Fleet
  Integration\   depends Core: API pages, web-service/HTTP hooks, JSON
  Test\          depends on all modules; visible tests; agent may edit
  .alpackages\   pre-seeded symbols, including test toolkit
                 (Library Assert, Tests-TestLibraries, Test Runner)
```

No `AGENTS.md` or `CLAUDE.md` ships in the workspace. The task set stays
harness-neutral; configs bring their own rules through bundles.

## 3. Coupling matrix

| Edge | Style |
| --- | --- |
| Rental -> Core | integration events (publisher in Core, subscribers in Rental) |
| Leasing -> Core | direct procedure calls, `internal` access with `internalsVisibleTo` |
| Fleet -> Core | interface plus extensible enum implementing it (strategy) |
| Reporting -> Rental/Leasing/Fleet | queries, table extensions, cross-app FlowFields |
| Integration -> Core | facade codeunit, API pages, JSON, HTTP mock |
| Rental <-> Fleet | business events with the `IsHandled` pattern, plus one legacy direct call left in on purpose |

In-app styles to cover as well: posting codeunit chains, single-instance
state, temporary tables, `CommitBehavior`, event subscriber instance modes.

## 4. ID ranges

| Range | Use |
| --- | --- |
| 70000-74999 | refapp objects, sub-range per module |
| 80000-84999 | `Test\` app (visible tests) |
| 85000-89999 | hidden oracles and mutant support |

75000-79999 stays reserved (shared containers, see `prereq-apps.md`).
`deno task id-audit` is extended to know the harness set. App ids are static
hex GUIDs, one per module.

## 5. Repository layout

```
harness-tasks/
  refapp/                  reference app source; versions are git-tagged
                           (refapp-v1, refapp-v2 ...)
  tasks/HX-001/
    task.yml
    prompt.md              work-item style, written like a real ticket
    overlay/               files applied on the refapp snapshot
                           (injected bug, stub, removed feature)
    oracle/                hidden test app
    mutants/               test-authoring only: hidden buggy variants
    correct/               reference solution (authoring gate)
    naive/                 plausible wrong solution (authoring gate)
```

## 6. task.yml

```yaml
id: HX-001
refapp_version: refapp-v1
kind: feature | bugfix | refactor | test-authoring
prompt: prompt.md
touches: [Rental, Fleet]        # analysis only; not shown to the agent
coupling: [events, interface]   # analysis only; not hashed as scoring input
source: refapp                 # later: git (BC-Bench style)
attachments: []                # files under the task dir copied to C:\task
scorers: [build, pass_to_pass, fail_to_pass]   # or mutant_kill for test-authoring
pass_to_pass:                  # visible tests that must stay green
  - { codeunit: 80010, procedures: [RentalCheckoutPostsLedger, RentalPriceUsesSeason] }
fail_to_pass:                  # hidden oracle
  depends_on: [Rental, Fleet]
  tests:
    - { codeunit: 85001, procedures: [DamageBlocksCheckout, RepairReleasesVehicle] }
mutants: []                    # test-authoring only; mutant 0 = original buggy state, implicit
contamination: null            # reserved for a later probe result
limits: { timeout_min: 30 }
```

Validated with Zod on load. Unknown keys are an error. Test lists name
procedures, not just codeunits, so results and flakiness are tracked per
procedure.

Attachments (screenshots, sample import files) mirror real tickets. Each
harness adapter records whether it passed images to the model; a task with
image attachments run on a harness without image support is flagged in the
report.

## 7. Task-set hash

Covers `refapp/` at every pinned version used by a task, plus all of
`harness-tasks/tasks/**` except `correct/` and `naive/` (authoring aids, not
run inputs). Build artifacts are excluded (`.alpackages`, `output`, `*.app`).
`touches` and `coupling` are metadata; changing them does not force a
re-bench.

## 8. Authoring gate

A task is promoted only when:

- `correct/` passes every scorer,
- `naive/` fails the oracle by reaching assertions and losing them (not by a
  compile failure), same rule as workbench `--strict-fail-mode`,
- for test-authoring: the reference test solution kills every mutant and
  passes on correct code,
- the `al-test-auditor` agent has reviewed the oracle.

The `mock` harness image from 1a runs both solutions through the real
pipeline.

## 9. v1 task mix (~10 tasks, growing)

At least one task per kind, and every coupling style exercised by at least
two tasks. Prompts describe what to build or what users observe, never how
(same no-guiding-notes rule as `tasks/`). Target difficulty: frontier
harness configs should not saturate the set on day one.

10 tasks x 3 repeats is enough to prove the pipeline and to compare
efficiency on both-pass pairs, but BC-Bench found harness-level effects
small, so pass-rate deltas between configs will often be "not
distinguishable" at this size. Plan to grow the set toward 30+ after v1.

Tasks should give MCPs and skills room to matter: navigation across apps,
finding the right event to subscribe to, symbol lookup in `.alpackages`,
object ID allocation, and build/test iteration. A task solvable in one edit
with no lookup cannot show an efficiency difference.

## 10. Open for 1b planning

- Exact refapp v1 object list per module.
- Whether one refapp version serves all v1 tasks, or tasks pin v1 and v2.
