# CG-AL-M040 - reference solution (lifted by hand)

Lifted from a stored bench submission that compiled and published with the
correct `ExtendedDatatype = Task`, passed `TestTaskReferenceFieldRoundTrip`, and
failed only `TestTaskReferenceFieldZero` - which was the oracle's own defect
(Integer literal against a BigInteger field at Test.al:44, unsatisfiable by any
implementation; repaired 2026-09-05). No submission could ever score 100 before
that repair, so `scripts/seed-reference-solution.ts` had nothing to seed from.

Re-probe after any oracle edit:

```
deno run -A scripts/trap-probe.ts --task CG-AL-M040 \
  --solution reference/solutions/CG-AL-M040 --expect pass
```

- source run: `results/benchmark-results-1787828821306.json`
- model: ?
- attempt: 2, score 62.5 under the defective oracle
- lifted: 2026-09-05 (audit13/g1-report.md)
