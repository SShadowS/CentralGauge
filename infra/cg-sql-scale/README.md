# CG SQL scale scenarios (Q-06)

Harness-owned, private scale scenarios for the opt-in SQL-cost measurement (`analyze-campaign --sql-cost`). One
folder per task, `<task>/src/*.al`: test codeunit sources only, no app.json.

How they run: `--sql-cost` places a task's scenario sources as the only sources of the Test app (the Q-04
test-rerun path: the start tree's Test app.json, which depends on every production app) over the execution's
final production apps. It runs them with the measuring runner, which counts SQL statements per [Test] method.

Each scenario is two or more methods, run in declaration order:
- a setup method builds the data;
- each following method makes one measured call.

The runner (Test Runner - Isol. Codeunit) rolls back after the codeunit, not after each method, so the setup data
is there for the call methods. A call method's count is the call plus the constant per-method overhead.

Rules (owner/orchestrator 2026-10-25):

- Never under `tasks/` or `tests/al/`, never in a task summary, never scored. A scenario only measures.
- Only the task's tables and public API. About 100 records inside the set the required procedure walks.
- Success only is asserted (the call completes). Never the shape of the implementation.
- A scenario that fails or does not compile on an agent's solution is recorded as `scenario_failed`, with its
  error. It never changes a verdict or a pass rate.
- Validation (on a container, after 10-27):
  - each scenario passes on the task's reference solution;
  - its statement counts on the reference are recorded as the task's baseline;
  - the same run confirms that setup data survives into the call methods.

| Task | Codeunit | Methods (in order) |
| --- | --- | --- |
| HX-022 | 84980 | `Setup100Linked` (one vehicle, 100 linked records over 6 tables), `ChangeVehicleNo100` |
| HX-038 | 84981 | `Setup100DueLines` (one lease, 100 due schedule lines), `Propose100`, `Invoice100` |

The ids are inside the refapp Test app range (80000-84999). The scenario sources replace every Test source in that
run, so they cannot collide with agent or shipped tests.
