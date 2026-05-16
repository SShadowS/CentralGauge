# New Task-Set Uptake Checklist

End-to-end runbook for adding a new task set and onboarding models against it.
All `deno task start` = `centralgauge`.

## 0. Prep + Sanity (local)

- [ ] Edit `tasks/**/*.yml`, `tests/al/**`, prereq apps in `tests/al/dependencies/`
- [ ] Pre-seed `site/catalog/{models,model-families,pricing}.yml` for any new model
- [ ] `deno check`
- [ ] `deno lint`
- [ ] `deno fmt`
- [ ] `deno task test:unit`

## 1. Catalog Upload (models / families / pricing)

Bench auto-seeds missing catalog rows from real APIs, but YAML is the source of
truth. Commit YAML before pushing to D1.

- [ ] `deno task start sync-catalog --apply`
- [ ] On 429 (rate-limit on 7+ rows), pause 60s and retry

## 2. Verify Each Model Is Callable

- [ ] `deno task start models <vendor>/<slug> --check` for every model in scope

## 3. Doctor Pre-Flight

Verifies config, Ed25519 keys, connectivity, and catalog state in one signed
round-trip. Bench also runs this at startup unless `CENTRALGAUGE_BENCH_PRECHECK=0`.

- [ ] `deno task start doctor ingest`

## 4. Upload Task-Set + Per-Task Rows

Without this step, `/tasks/*`, matrix, and categories render empty even though
runs land successfully.

- [ ] `deno task start populate-task-set`

Computes local hash from `tasks/**/*.yml + tests/al/**`, signs with ingest key,
POSTs the full payload to `/api/v1/task-sets` (writes BOTH `task_sets` row AND
per-task `tasks` rows).

If the working tree drifted since the last bench, add `--force` (or
`--hash <prod-current>` to target an explicit hash).

## 5. Promote New Hash to Current

Without this, leaderboard still shows the prior set.

- [ ] `deno task start task-set set-current <hash>`
- [ ] (Optional) `deno task start task-set rename <hash> "May 2026"`

## 6. Run Cycle Per Model

Cycle internally passes `--debug` to bench
(`src/lifecycle/steps/bench-step.ts:113`). Debug session JSONL is required by
`debug-capture` + `analyze`. Resume-aware; checkpoints in `lifecycle_events`.

- [ ] `deno task start cycle --llms <vendor>/<slug>` for each model

Examples:

```bash
deno task start cycle --llms anthropic/claude-opus-4-7
deno task start cycle --llms openai/gpt-5.5
deno task start cycle --llms openrouter/deepseek/deepseek-v4-pro
```

### Cycle flag cheatsheet

- `--from <step>` resume at `bench | debug-capture | analyze | publish`
- `--force-rerun <step>` rerun a specific step even if last event was `*.completed`
- `--analyzer-model <slug>` override (default from `.centralgauge.yml` `lifecycle.analyzer_model`)
- `--dry-run` plan only, no events written
- `--yes` non-interactive (required with `--force-unlock`)

### Standalone bench (NOT recommended; skip cycle)

If you must run bench directly, `--debug` is mandatory or analyze breaks:

```bash
deno task start bench --llms <slug> --debug --tasks "tasks/**/*.yml"
deno task start verify debug/<session>/ --shortcomings-only --model <slug>
deno task start populate-shortcomings --only <slug>
```

## 7. Verify Final State

- [ ] `deno task start lifecycle status` shows green per `(model, task_set)`
- [ ] `curl -s https://ai.sshadows.dk/api/v1/leaderboard | jq '.data[].model.slug'`
      lists every onboarded model
- [ ] `https://ai.sshadows.dk/tasks/<task-id>` resolves (no 404)
- [ ] `https://ai.sshadows.dk/matrix` populated

## 8. Cluster Review (optional, post-publish)

Triage the 0.70-0.85 cosine-similarity review band for shortcomings.

- [ ] `deno task start lifecycle cluster-review`

## Recovery

| Symptom                           | Fix                                                                |
| --------------------------------- | ------------------------------------------------------------------ |
| Stuck cycle lock                  | `cycle --llms <slug> --force-unlock --yes`                         |
| Analyze missing debug bundle      | Re-run cycle from `--from debug-capture`                           |
| `/tasks/*` 404 after bench        | Step 4 (`populate-task-set`) was skipped; run it now               |
| Leaderboard still shows old set   | Step 5 (`task-set set-current`) was skipped                        |
| `SEED_NO_PRICING` at bench start  | Pricing missing for model; pre-seed `site/catalog/pricing.yml`     |
| `429` from admin endpoint         | ~10 req/min limit; pause 60s and retry                             |

## Reference

- Full lifecycle docs: `docs/site/lifecycle.md`
- Ingest pipeline: `docs/architecture/ingest-pipeline.md`
- Operator guide: `docs/site/operations.md`
- Project memory: `CLAUDE.md` (Lifecycle, Ingest, Catalog sync sections)
