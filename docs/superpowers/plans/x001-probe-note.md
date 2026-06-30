# CG-AL-X001 — Probe-Gate Outcome (frame-isolation experiment)

**Date:** 2026-07-01
**Container:** Cronus28 (BC 28.0.46665.50383, platform 28.0.50283.0)
**Source PR:** 50285
**Verdict:** Frame isolation does NOT reproduce. **Variant 2 (deterministic bind-must-be-bound) ships.**

## Experiment

Shared prereq (`tests/al/dependencies/CG-AL-X001/`) built first: table 69600
`"CG X001 Counter"`, codeunit 69601 `"CG X001 Publisher"` (`Raise()` raises
integration event `OnPing`), codeunit 69602 `"CG X001 Audit Sub"`
(`EventSubscriberInstance = Manual`, increments the Counter on `OnPing`).

A throwaway scratch app (`scratch/trap-probe/x001-gate-experiment/`, not
committed) exposed three probe workers, each measuring the Counter after a
single `Raise()`, cleared between measurements:

- **(A)** `X001 Probe Worker A` — `BindSubscription(AuditSub)` in the
  CALLER (`Measure()`), then `Codeunit.Run(Codeunit::"X001 Probe Worker A")`;
  `OnRun` just calls `Publisher.Raise()`.
- **(B)** `X001 Probe Worker B` — `Codeunit.Run(...)` first; `OnRun` itself
  does `BindSubscription(AuditSub)` → `Publisher.Raise()` →
  `UnbindSubscription(AuditSub)`.
- **(C)** `X001 Probe Worker C` — `Publisher.Raise()` directly, no
  `Codeunit.Run`, no `BindSubscription` anywhere (control).

The probe test codeunit (temporarily placed at the real oracle path,
`tests/al/hard/CG-AL-X001.Test.al`, codeunit 80290) deliberately asserted
every measurement against an impossible sentinel (`-999`) so the BC
`Assert.AreEqual` failure message reveals the true Counter value regardless
of which way each scenario behaves, without needing to guess in advance.

Driven via `scripts/trap-probe.ts` only, per constraint:

```
deno run -A scripts/trap-probe.ts --task CG-AL-X001 --solution scratch/trap-probe/x001-gate-experiment --expect fail --container Cronus28
```

## Measured Counter values

| Scenario | Description | Counter |
|---|---|---|
| (A) | Bind in CALLER, then `Codeunit.Run` | **1** |
| (B) | `Codeunit.Run` first, bind INSIDE `OnRun` | **1** |
| (C) | No bind anywhere (control) | **0** |

Raw evidence (BC `Assert.AreEqual` failure messages, `[trap-probe] test
failures:` block, single run, exit code 0 for `--expect fail`):

```
MeasureA_BindInCallerThenRun: Assert.AreEqual failed. Expected:<-999> (Integer). Actual:<1> (Integer). MeasureA actual count.
MeasureB_BindInsideRun: Assert.AreEqual failed. Expected:<-999> (Integer). Actual:<1> (Integer). MeasureB actual count.
MeasureC_NoBind: Assert.AreEqual failed. Expected:<-999> (Integer). Actual:<0> (Integer). MeasureC actual count.
```

`[trap-probe] CG-AL-X001: actual=fail expected=fail` / `[trap-probe] OK`
(exit 0) — confirms the run was a genuine oracle result (3/3 real test
failures with assertion mismatches), not an infra-classified
"inconclusive" (no `Verification error:` prefix, no infra signature match).

## Decision

Per the brief's rule: "If (A) = 1 (caller-bind propagates into Run) → frame
trap does NOT discriminate → ship Variant 2." (A) = 1, so the frame-isolation
trap does not reproduce on this BC build: a manual subscriber bound in the
CALLER before `Codeunit.Run` still observes events raised inside the
Run-spawned frame, identically to binding inside `OnRun` itself. This matches
the documented AL semantics of `BindSubscription` — the binding lasts for as
long as the codeunit instance that called it remains in scope (i.e., for the
duration of the call stack frame that issued the bind, including any nested
`Codeunit.Run` calls it makes), not scoped to a single dispatch frame.

**Variant 2 ships** (the deterministic "manual subscriber must be bound"
task): `codeunit 70900 "CG X001 Worker"` with `procedure RunAudited()` that
must `BindSubscription` the prereq's manual `"CG X001 Audit Sub"` around the
call to `"CG X001 Publisher".Raise()`. The realistic-naive discriminator
(wires the call, forgets to bind) is still genuinely deterministic and does
not depend on the frame question at all — confirmed separately via the
correct/naive discrimination probes (see `.superpowers/sdd/task-5-report.md`).

The gate-experiment scratch app (`scratch/trap-probe/x001-gate-experiment/`)
was never committed (gitignored, dev-only per the discrimination-probe
convention).
