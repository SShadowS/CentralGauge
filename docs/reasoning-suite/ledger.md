# Reasoning-100 candidate ledger

One row per candidate, cradle to promoted task. Append rows during mining;
update columns in place as a candidate advances. Keep rejected rows (with
reason in Notes) — they stop re-mining the same ground.

**Counts** (update when editing rows):

- Candidates mined: 0
- Passed Sonnet filter (Sonnet failed to solve): 0
- Passed Fable filter (Fable failed or struggled): 0
- Tasks built: 0 / 100
- Tasks promoted: 0 / 100

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
