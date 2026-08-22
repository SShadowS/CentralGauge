# Premise note: consumed-return-value error suppression (mining candidate #4)

Measured 2026-08-22 on Cronus28, BC 28.4.53241.53758, SOAP harness path
(`CG WS Test Runner` → `Test Suite Mgt.RunAllTests`). Probe source:
`scratch/probe-premise/correct/CG-AL-X090.Test.al` (re-runnable via
`scratch/premise-probe-runner.ts`). Every value below is a measurement, not
an inference.

## The rule, as measured

The documented AL calling convention — "omit the optional Boolean return
value and a failure raises a runtime error; consume it and the failure
returns false" — holds at the statement site for `Evaluate` and
`ChangeCompany`, but NOT for `Insert`, where bulk-insert buffering defers
the raise to the next read of the table.

| Probe | Result |
| --- | --- |
| bare `Evaluate(Int, 'not-a-number')` | RAISED: `The value "not-a-number" can't be evaluated into type Integer.` |
| consumed `Ok := Evaluate(Target, 'not-a-number')` with `Target = 42` before | `Ok = false`, `Target` still `42` after — previous value kept, not cleared |
| bare `Rec.ChangeCompany('ZZ-NO-SUCH-COMPANY')` | RAISED: `The company "ZZ-NO-SUCH-COMPANY" does not exist.` |
| consumed `Ok := Rec.ChangeCompany('ZZ-NO-SUCH-COMPANY')` | `Ok = false`, no error |
| bare duplicate `Rec.Insert()` | did NOT raise at the statement (`asserterror` tripped "An error was expected") |
| consumed duplicate `exit(Rec.Insert())` | `false` immediately |
| bare duplicate `Insert()` then `Reader.Count()` | the read RAISED: `The record in table CG Probe Data already exists. Identification fields and values: Code='DUP'` |

## What this settles

1. **PR 52473's human was right about `ChangeCompany`**: the statement form
   raises on a nonexistent company; it does not silently stay on the old
   one. The reviewer-error record stands.
2. **PR 52747's companion fact is confirmed**: a failed consumed `Evaluate`
   leaves the target holding its previous value. "Iteration i's malformed
   entry silently re-processes iteration i-1's value" is real.
3. **The earlier probe run was not a bug.** Bare duplicate `Insert()`
   genuinely does not raise at the call site on BC 28.4. The mechanism is
   bulk-insert buffering: the insert is queued, and the duplicate-key error
   surfaces wherever the buffer flushes — here a `Count()` on a different
   record variable. Consuming the return value forces immediate execution,
   which is why the consumed form correctly returns false.

## Task-shape consequences

- **Build the suppression task on `Evaluate` (primary) and/or
  `ChangeCompany`**, where the statement-site rule is clean and measured.
  The Evaluate shape is the stronger trap: the naive consumed-and-ignored
  form does not just lose the error, it silently reuses the previous
  iteration's value, which is a wrong-output oracle, not just an
  error-shape oracle.
- **Do NOT build the simple version on `Insert`.** A task asserting "bare
  Insert raises on duplicate" would pin the wrong semantics: at the
  statement site it does not.
- **The deferred-Insert behaviour is its own candidate** (error fires at a
  distant read with a stack trace pointing at innocent code). Moderate
  attempt-2 resistance: the error text names the table and key, so a second
  attempt can find the insert. Park it as a separate possible task rather
  than folding it into this one.
- Scope caveat: measured on the SOAP path only, same as the other 2026-08
  probes. `TestPermissions = Disabled`, test-runner isolation codeunit
  130450. Re-measure before relying on these under
  `CENTRALGAUGE_SOAP_TEST_RUNNER=0`.
