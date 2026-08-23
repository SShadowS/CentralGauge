# Reasoning-100 candidate ledger

One row per candidate, cradle to promoted task. Append rows during mining;
update columns in place as a candidate advances. Keep rejected rows (with
reason in Notes) — they stop re-mining the same ground.

**Counts** (update when editing rows):

- Candidates mined: 1
- Passed Sonnet filter (Sonnet failed to solve): 0
- Passed Fable filter (Fable failed or struggled): 0
- Tasks built: 1 / 100
- Tasks promoted: 1 / 100

**Column vocabulary**

- `source`: `volotest:<dir>` | `pr:<id>` | `wi:<id>` | `probe:<note>` | `synth`
- `cat`: number from categories.md (1–12)
- `sonnet` / `fable`: `solved` | `partial` | `failed` | `-` (not run)
  — verdict comes from the JUDGE agent against ground truth, never the
  solver's self-report
- `status`: `raw` → `filtered` → `assigned:<CG-AL-Xnnn>` → `built` →
  `probed` → `promoted` | `rejected`

| id | source | cat | sonnet | fable | status | notes |
|---|---|---|---|---|---|---|
| R001 | pr:52841 (+52724, 52196) | 1 | - | - | promoted (CG-AL-X065) | PILOT of the diagnose format. var-record filter wipe: helper borrows the caller's var record as its aggregation cursor; only one line per category gets repriced. Probe: correct 6/6, starter fails 4/6 (single-line + direct-contract tests pass on starter by design). Auditor HIGH (unfiltered-aggregation hole) closed with the GAMMA test before promote. Skipped the model filter: format validation, not difficulty selection. |
