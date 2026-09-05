# CG-AL-M023 - seeded reference solution

**Verified.** gold-ci recorded `pass`, 11/11 tests, at 2026-09-02T05:35:02Z
under harness fingerprint `0634e0ee1c1c` (`docs/reasoning-suite/gold-ci.json`),
against the oracle as repaired in 8a5896cd (2026-08-28: dedicated `ItemIter`
cursor in `TestSumItemInventory_CalculatesSum`). Re-probe after any oracle edit:

```
deno run -A scripts/trap-probe.ts --task CG-AL-M023 \
  --solution reference/solutions/CG-AL-M023 --expect pass
```

- source run: `results/benchmark-results-1778768545882.json`
- model: (not recorded)
- attempt score: 100
- seeded by: `scripts/seed-reference-solution.ts`
